/** Background job vocabulary shared by the API queue adapter and the UI. */

export const JOB_TYPES = [
  'REPORT_CARDS',
  'FEE_REMINDERS',
  'ATTENDANCE_DIGEST',
  'DATA_EXPORT',
  'TENANT_DELETION',
  'USAGE_ROLLUP',
  'REPORT_ROLLUP',
  'WAREHOUSE_EXPORT',
] as const;

export type JobType = (typeof JOB_TYPES)[number];

export const JOB_STATUSES = [
  'QUEUED',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export function isTerminalJobStatus(status: JobStatus): boolean {
  return status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED';
}

export function jobPercent(progress: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((progress / total) * 100)));
}
