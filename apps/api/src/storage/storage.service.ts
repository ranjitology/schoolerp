import { Injectable } from '@nestjs/common';
import {
  NotFoundError,
  buildStorageKey,
  isAllowedUpload,
  uuidv7,
} from '@schoolerp/core';
import { z } from 'zod';
import { withTenant } from '@schoolerp/db';
import { AuditService } from '../audit/audit.service';
import { loadEnv } from '../config/env';
import type { AuthPrincipal } from '../common/request';

interface AuditMeta {
  requestId: string;
  ip?: string;
  userAgent?: string;
}

export const createUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  mimeType: z.string().trim().min(3).max(120),
  sizeBytes: z.number().int().min(1).max(15 * 1024 * 1024),
  kind: z.string().trim().min(1).max(40).default('documents'),
});

export const registerObjectSchema = createUploadSchema.extend({
  key: z.string().trim().min(1).max(500),
  checksum: z.string().trim().length(64).optional(),
});

export const objectQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  kind: z.string().trim().max(40).optional(),
});

@Injectable()
export class StorageService {
  constructor(private readonly audit: AuditService) {}

  private config() {
    const env = loadEnv();
    return {
      bucket: env.S3_BUCKET,
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      publicBaseUrl: env.S3_PUBLIC_BASE_URL,
    };
  }

  async createUpload(auth: AuthPrincipal, input: z.infer<typeof createUploadSchema>) {
    if (!isAllowedUpload(input.mimeType, input.sizeBytes)) {
      throw new NotFoundError('Allowed file type');
    }
    const config = this.config();
    const id = uuidv7();
    const key = buildStorageKey(auth.schoolId, input.kind, input.fileName, id);
    const base = config.publicBaseUrl?.replace(/\/+$/, '');
    const uploadUrl = base
      ? `${base}/${key}`
      : config.endpoint
        ? `${config.endpoint.replace(/\/+$/, '')}/${config.bucket}/${key}`
        : null;
    return {
      id,
      key,
      bucket: config.bucket,
      uploadUrl,
      method: 'PUT',
      expiresInSeconds: 900,
      headers: { 'Content-Type': input.mimeType },
      // The browser uploads directly to object storage, then calls register.
      configured: Boolean(uploadUrl),
    };
  }

  async register(
    auth: AuthPrincipal,
    input: z.infer<typeof registerObjectSchema>,
    meta: AuditMeta,
  ) {
    if (!isAllowedUpload(input.mimeType, input.sizeBytes)) {
      throw new NotFoundError('Allowed file type');
    }
    if (!input.key.startsWith(`tenants/${auth.schoolId}/`)) {
      throw new NotFoundError('Storage key');
    }
    const config = this.config();
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const object = await tx.storageObject.create({
        data: {
          id: uuidv7(),
          schoolId: auth.schoolId,
          key: input.key,
          bucket: config.bucket,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          checksum: input.checksum ?? null,
          uploadedByUserId: auth.userId,
        },
      });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'storage.object_registered',
        entity: 'StorageObject',
        entityId: object.id,
        after: { key: object.key, sizeBytes: object.sizeBytes },
      });
      return object;
    });
  }

  async list(auth: AuthPrincipal, query: z.infer<typeof objectQuerySchema>) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const where = {
        schoolId: auth.schoolId,
        ...(query.kind ? { key: { contains: `/tenants/${auth.schoolId}/${query.kind}/` } } : {}),
      };
      const [items, total] = await Promise.all([
        tx.storageObject.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.storageObject.count({ where }),
      ]);
      return { items, page: query.page, pageSize: query.pageSize, total };
    });
  }

  async remove(auth: AuthPrincipal, id: string, meta: AuditMeta) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const object = await tx.storageObject.findFirst({
        where: { id, schoolId: auth.schoolId },
      });
      if (!object) throw new NotFoundError('File');
      await tx.storageObject.delete({ where: { id } });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'storage.object_deleted',
        entity: 'StorageObject',
        entityId: id,
        before: { key: object.key },
      });
      return { deleted: true };
    });
  }

  async downloadUrl(auth: AuthPrincipal, id: string) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const object = await tx.storageObject.findFirst({
        where: { id, schoolId: auth.schoolId },
      });
      if (!object) throw new NotFoundError('File');
      const config = this.config();
      const base = config.publicBaseUrl?.replace(/\/+$/, '');
      const url = base
        ? `${base}/${object.key}`
        : config.endpoint
          ? `${config.endpoint.replace(/\/+$/, '')}/${object.bucket}/${object.key}`
          : null;
      return { url, key: object.key, expiresInSeconds: 900, configured: Boolean(url) };
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
