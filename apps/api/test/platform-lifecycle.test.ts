import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PlatformService,
  purgeSchoolSchema,
  schoolDeletionSchema,
} from '../src/platform/platform.service';

const db = vi.hoisted(() => {
  const tx = {
    school: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    subscription: { updateMany: vi.fn() },
    backgroundJob: { create: vi.fn(), updateMany: vi.fn() },
    $queryRaw: vi.fn(),
  };
  return {
    tx,
    prisma: { school: { findMany: vi.fn() } },
  };
});

vi.mock('@schoolerp/db', () => ({
  prisma: db.prisma,
  withPlatform: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db.tx)),
}));

const schoolId = '11111111-1111-7111-8111-111111111111';
const meta = {
  platformUserId: '22222222-2222-7222-8222-222222222222',
  requestId: 'req-1',
  ip: '127.0.0.1',
};

function service() {
  const audit = { recordPlatform: vi.fn().mockResolvedValue(undefined) };
  const platform = new PlatformService({} as never, audit as never);
  return { platform, audit };
}

describe('tenant deletion lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('schedules deletion with the configured grace period and queues a job', async () => {
    const { platform, audit } = service();
    db.tx.school.findFirst.mockResolvedValue({ id: schoolId, status: 'ACTIVE' });
    db.tx.school.update.mockResolvedValue({
      status: 'CANCELLED',
      deletionRequestedAt: new Date('2026-01-01T00:00:00.000Z'),
      purgeAfter: new Date('2026-01-31T00:00:00.000Z'),
    });
    db.tx.subscription.updateMany.mockResolvedValue({ count: 1 });
    db.tx.backgroundJob.create.mockResolvedValue({ id: 'job-1' });

    const result = await platform.requestSchoolDeletion(
      schoolId,
      { reason: 'School closed permanently', graceDays: 30 },
      meta,
    );

    expect(db.tx.school.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: schoolId },
        data: expect.objectContaining({
          status: 'CANCELLED',
          deletionReason: 'School closed permanently',
        }),
      }),
    );
    expect(db.tx.subscription.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'CANCELLED' } }),
    );
    expect(db.tx.backgroundJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ schoolId, type: 'TENANT_DELETION', status: 'QUEUED' }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({ schoolId, graceDays: 30, jobId: 'job-1' }),
    );
    expect(audit.recordPlatform).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'platform.school_deletion_requested', schoolId }),
    );
  });

  it('refuses a second deletion request', async () => {
    const { platform } = service();
    db.tx.school.findFirst.mockResolvedValue({
      id: schoolId,
      status: 'CANCELLED',
      deletionRequestedAt: new Date(),
    });

    await expect(
      platform.requestSchoolDeletion(schoolId, { reason: 'Duplicate request' }, meta),
    ).rejects.toThrow('already scheduled');
    expect(db.tx.school.update).not.toHaveBeenCalled();
  });

  it('cancels a scheduled deletion and re-activates the tenant', async () => {
    const { platform, audit } = service();
    db.tx.school.findFirst.mockResolvedValue({
      id: schoolId,
      status: 'CANCELLED',
      deletionRequestedAt: new Date(),
      purgeAfter: new Date(Date.now() + 86_400_000),
    });
    db.tx.school.update.mockResolvedValue({ status: 'ACTIVE' });
    db.tx.subscription.updateMany.mockResolvedValue({ count: 1 });
    db.tx.backgroundJob.updateMany.mockResolvedValue({ count: 1 });

    const result = await platform.cancelSchoolDeletion(schoolId, meta);

    expect(result).toEqual({ schoolId, status: 'ACTIVE', cancelledJobs: 1 });
    expect(audit.recordPlatform).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'platform.school_deletion_cancelled' }),
    );
  });

  it('requires force during the grace period and refuses an unrequested purge', async () => {
    const { platform } = service();
    db.tx.school.findUnique.mockResolvedValueOnce({
      id: schoolId,
      name: 'Grace School',
      deletionRequestedAt: new Date(),
      purgeAfter: new Date(Date.now() + 86_400_000),
      deletedAt: null,
    });

    await expect(
      platform.purgeSchool(
        schoolId,
        { confirmation: 'PURGE', force: false },
        { ...meta, force: false },
      ),
    ).rejects.toThrow('grace period has not ended');
    expect(db.tx.$queryRaw).not.toHaveBeenCalled();

    db.tx.school.findUnique.mockResolvedValueOnce({
      id: schoolId,
      name: 'Grace School',
      deletionRequestedAt: null,
      purgeAfter: null,
      deletedAt: null,
    });
    await expect(
      platform.purgeSchool(
        schoolId,
        { confirmation: 'PURGE', force: true },
        { ...meta, force: true },
      ),
    ).rejects.toThrow('Request tenant deletion');
  });

  it('purges through the SQL function and anonymises the school shell', async () => {
    const { platform, audit } = service();
    db.tx.school.findUnique.mockResolvedValue({
      id: schoolId,
      name: 'Grace School',
      deletionRequestedAt: new Date('2026-01-01T00:00:00.000Z'),
      purgeAfter: new Date('2026-01-31T00:00:00.000Z'),
      deletedAt: null,
    });
    db.tx.$queryRaw.mockResolvedValue([
      { table_name: 'students', deleted: 12n },
      { table_name: 'invoices', deleted: 4n },
    ]);
    db.tx.school.update.mockResolvedValue({ id: schoolId });

    const result = await platform.purgeSchool(
      schoolId,
      { confirmation: 'PURGE', force: true },
      { ...meta, force: true },
    );

    expect(db.tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(db.tx.school.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: schoolId },
        data: expect.objectContaining({
          slug: 'deleted-11111111',
          status: 'CANCELLED',
          planId: null,
        }),
      }),
    );
    expect(result.deletedRows).toBe(16);
    expect(audit.recordPlatform).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'platform.school_purged', schoolId }),
    );
  });

  it('purges every due tenant and isolates failures during a retention run', async () => {
    const { platform, audit } = service();
    const failingId = '33333333-3333-7333-8333-333333333333';
    db.prisma.school.findMany.mockResolvedValue([
      { id: schoolId, name: 'Due School', purgeAfter: new Date('2026-01-31T00:00:00.000Z') },
      { id: failingId, name: 'Broken School', purgeAfter: new Date('2026-01-31T00:00:00.000Z') },
    ]);
    db.tx.school.findUnique.mockImplementation(
      async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        name: where.id === schoolId ? 'Due School' : 'Broken School',
        deletionRequestedAt: new Date('2026-01-01T00:00:00.000Z'),
        purgeAfter: new Date('2026-01-31T00:00:00.000Z'),
        deletedAt: null,
      }),
    );
    db.tx.$queryRaw
      .mockResolvedValueOnce([{ table_name: 'students', deleted: 2n }])
      .mockRejectedValueOnce(new Error('foreign key deadlock'));
    db.tx.school.update.mockResolvedValue({ id: schoolId });

    const result = await platform.runRetention({ dryRun: false }, { ...meta, force: true });

    expect(result.checked).toBe(2);
    expect(result.purged).toHaveLength(1);
    expect(result.failed).toEqual([
      expect.objectContaining({ schoolId: failingId, error: 'foreign key deadlock' }),
    ]);
    expect(audit.recordPlatform).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'platform.retention_run' }),
    );
  });
});

describe('tenant lifecycle contracts', () => {
  it('requires a reason and bounds the grace period', () => {
    expect(schoolDeletionSchema.safeParse({ reason: 'shut' }).success).toBe(false);
    expect(schoolDeletionSchema.safeParse({ reason: 'School closed', graceDays: 366 }).success).toBe(
      false,
    );
    expect(schoolDeletionSchema.safeParse({ reason: 'School closed', graceDays: 7 }).success).toBe(
      true,
    );
  });

  it('requires the literal PURGE confirmation', () => {
    expect(purgeSchoolSchema.safeParse({ confirmation: 'purge' }).success).toBe(false);
    expect(purgeSchoolSchema.safeParse({ confirmation: 'PURGE' }).success).toBe(true);
  });
});
