import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ConflictError, NotFoundError, uuidv7 } from '@schoolerp/core';
import { z } from 'zod';
import { withTenant } from '@schoolerp/db';
import { AuditService } from '../audit/audit.service';
import type { AuthPrincipal } from '../common/request';

interface AuditMeta {
  requestId: string;
  ip?: string;
  userAgent?: string;
}

export const createItemSchema = z.object({
  sku: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(160),
  category: z.string().trim().min(1).max(80),
  quantity: z.number().int().min(0).max(1_000_000).default(0),
  reorderLevel: z.number().int().min(0).max(1_000_000).default(0),
  unitPriceMinor: z.number().int().min(0).max(1_000_000_000).default(0),
  location: z.string().trim().max(120).optional(),
});

export const updateItemSchema = createItemSchema.partial();

export const stockMovementSchema = z.object({
  type: z.enum(['IN', 'OUT', 'ADJUST']),
  quantity: z.number().int().min(1).max(1_000_000),
  reference: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(500).optional(),
});

export const itemQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(100).optional(),
  category: z.string().trim().max(80).optional(),
  lowStock: z.enum(['true', 'false']).default('false'),
});

@Injectable()
export class InventoryService {
  constructor(private readonly audit: AuditService) {}

  async listItems(auth: AuthPrincipal, query: z.infer<typeof itemQuerySchema>) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const where: Prisma.InventoryItemWhereInput = {
        schoolId: auth.schoolId,
        ...(query.category ? { category: query.category } : {}),
        ...(query.lowStock === 'true'
          ? { quantity: { lte: tx.inventoryItem.fields.reorderLevel } }
          : {}),
        ...(query.q
          ? {
              OR: [
                { name: { contains: query.q, mode: 'insensitive' } },
                { sku: { contains: query.q, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
      const [items, total] = await Promise.all([
        tx.inventoryItem.findMany({
          where,
          orderBy: { name: 'asc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.inventoryItem.count({ where }),
      ]);
      return { items, page: query.page, pageSize: query.pageSize, total };
    });
  }

  async createItem(auth: AuthPrincipal, input: z.infer<typeof createItemSchema>, meta: AuditMeta) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const existing = await tx.inventoryItem.findFirst({
        where: { schoolId: auth.schoolId, sku: input.sku },
        select: { id: true },
      });
      if (existing) throw new ConflictError('That SKU is already in use');
      const item = await tx.inventoryItem.create({
        data: {
          id: uuidv7(),
          schoolId: auth.schoolId,
          sku: input.sku,
          name: input.name,
          category: input.category,
          quantity: input.quantity,
          reorderLevel: input.reorderLevel,
          unitPriceMinor: input.unitPriceMinor,
          location: input.location ?? null,
        },
      });
      if (input.quantity > 0) {
        await tx.inventoryTransaction.create({
          data: {
            id: uuidv7(),
            schoolId: auth.schoolId,
            itemId: item.id,
            type: 'IN',
            quantity: input.quantity,
            reference: 'Opening stock',
            performedByUserId: auth.userId,
          },
        });
      }
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'inventory.item_created',
        entity: 'InventoryItem',
        entityId: item.id,
        after: { sku: item.sku, quantity: item.quantity },
      });
      return item;
    });
  }

  async updateItem(
    auth: AuthPrincipal,
    id: string,
    input: z.infer<typeof updateItemSchema>,
    meta: AuditMeta,
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const current = await tx.inventoryItem.findFirst({
        where: { id, schoolId: auth.schoolId },
      });
      if (!current) throw new NotFoundError('Inventory item');
      const item = await tx.inventoryItem.update({
        where: { id },
        data: {
          ...(input.sku !== undefined ? { sku: input.sku } : {}),
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.category !== undefined ? { category: input.category } : {}),
          ...(input.reorderLevel !== undefined ? { reorderLevel: input.reorderLevel } : {}),
          ...(input.unitPriceMinor !== undefined ? { unitPriceMinor: input.unitPriceMinor } : {}),
          ...(input.location !== undefined ? { location: input.location ?? null } : {}),
        },
      });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'inventory.item_updated',
        entity: 'InventoryItem',
        entityId: id,
        before: { name: current.name, reorderLevel: current.reorderLevel },
        after: { name: item.name, reorderLevel: item.reorderLevel },
      });
      return item;
    });
  }

  async moveStock(
    auth: AuthPrincipal,
    id: string,
    input: z.infer<typeof stockMovementSchema>,
    meta: AuditMeta,
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const item = await tx.inventoryItem.findFirst({ where: { id, schoolId: auth.schoolId } });
      if (!item) throw new NotFoundError('Inventory item');
      const delta = input.type === 'OUT' ? -input.quantity : input.quantity;
      if (input.type === 'OUT' && item.quantity < input.quantity) {
        throw new ConflictError('Not enough stock for this movement');
      }
      const updated = await tx.inventoryItem.update({
        where: { id },
        data: { quantity: input.type === 'ADJUST' ? input.quantity : { increment: delta } },
      });
      const transaction = await tx.inventoryTransaction.create({
        data: {
          id: uuidv7(),
          schoolId: auth.schoolId,
          itemId: id,
          type: input.type,
          quantity: input.quantity,
          reference: input.reference ?? null,
          notes: input.notes ?? null,
          performedByUserId: auth.userId,
        },
      });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'inventory.stock_moved',
        entity: 'InventoryItem',
        entityId: id,
        before: { quantity: item.quantity },
        after: { quantity: updated.quantity, type: input.type, change: input.quantity },
      });
      return { item: updated, transaction };
    });
  }

  async transactions(auth: AuthPrincipal, itemId?: string) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      return tx.inventoryTransaction.findMany({
        where: { schoolId: auth.schoolId, ...(itemId ? { itemId } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
    });
  }

  async summary(auth: AuthPrincipal) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const items = await tx.inventoryItem.findMany({ where: { schoolId: auth.schoolId } });
      const lowStock = items.filter((item) => item.quantity <= item.reorderLevel);
      return {
        items: items.length,
        lowStock: lowStock.length,
        units: items.reduce((sum, item) => sum + item.quantity, 0),
        valueMinor: items.reduce((sum, item) => sum + item.quantity * item.unitPriceMinor, 0),
        lowStockItems: lowStock.slice(0, 20),
      };
    });
  }
}

export function auditCtx(auth: AuthPrincipal, meta: AuditMeta) {
  return {
    schoolId: auth.schoolId,
    userId: auth.userId,
    actorType: auth.actorType,
    requestId: meta.requestId,
    ip: meta.ip,
    userAgent: meta.userAgent,
    impersonationId: auth.impersonationId,
  };
}
