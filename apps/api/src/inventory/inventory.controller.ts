import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { uuidSchema } from '@schoolerp/core';
import { z } from 'zod';
import { CurrentAuth, RequirePermissions } from '../common/decorators';
import type { AppRequest, AuthPrincipal } from '../common/request';
import { zodBody } from '../common/zod.pipe';
import {
  InventoryService,
  createItemSchema,
  itemQuerySchema,
  stockMovementSchema,
  updateItemSchema,
} from './inventory.service';

const idParamSchema = z.object({ id: uuidSchema });
const transactionQuerySchema = z.object({ itemId: uuidSchema.optional() });

@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get('summary')
  @RequirePermissions('inventory:read')
  summary(@CurrentAuth() auth: AuthPrincipal) {
    return this.inventory.summary(auth);
  }

  @Get('items')
  @RequirePermissions('inventory:read')
  items(
    @CurrentAuth() auth: AuthPrincipal,
    @Query(zodBody(itemQuerySchema)) query: z.infer<typeof itemQuerySchema>,
  ) {
    return this.inventory.listItems(auth, query);
  }

  @Post('items')
  @RequirePermissions('inventory:write')
  createItem(
    @CurrentAuth() auth: AuthPrincipal,
    @Body(zodBody(createItemSchema)) body: z.infer<typeof createItemSchema>,
    @Req() request: AppRequest,
  ) {
    return this.inventory.createItem(auth, body, meta(request));
  }

  @Patch('items/:id')
  @RequirePermissions('inventory:write')
  updateItem(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(idParamSchema)) params: z.infer<typeof idParamSchema>,
    @Body(zodBody(updateItemSchema)) body: z.infer<typeof updateItemSchema>,
    @Req() request: AppRequest,
  ) {
    return this.inventory.updateItem(auth, params.id, body, meta(request));
  }

  @Post('items/:id/movements')
  @RequirePermissions('inventory:write')
  moveStock(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(idParamSchema)) params: z.infer<typeof idParamSchema>,
    @Body(zodBody(stockMovementSchema)) body: z.infer<typeof stockMovementSchema>,
    @Req() request: AppRequest,
  ) {
    return this.inventory.moveStock(auth, params.id, body, meta(request));
  }

  @Get('transactions')
  @RequirePermissions('inventory:read')
  transactions(
    @CurrentAuth() auth: AuthPrincipal,
    @Query(zodBody(transactionQuerySchema)) query: z.infer<typeof transactionQuerySchema>,
  ) {
    return this.inventory.transactions(auth, query.itemId);
  }
}

function meta(request: AppRequest) {
  return {
    requestId: request.requestId,
    ip: request.ip,
    userAgent: request.header('user-agent'),
  };
}
