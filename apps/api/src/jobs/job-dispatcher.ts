import { Injectable } from '@nestjs/common';

export interface DispatchJobInput {
  jobId: string;
  schoolId: string;
  type: string;
  payload: unknown;
}

export interface DispatchResult {
  driver: 'db' | 'webhook';
  dispatched: boolean;
  error?: string;
}

/**
 * Queue abstraction. The durable source of truth is always `background_jobs`
 * inside the tenant; `webhook` is an optional low-latency hint to an external
 * worker (BullMQ, Cloud Tasks, ...). A failed dispatch never loses work because
 * the row stays QUEUED for the polling worker.
 */
@Injectable()
export class JobDispatcher {
  async dispatch(input: DispatchJobInput): Promise<DispatchResult> {
    const driver = process.env.QUEUE_DRIVER === 'webhook' ? 'webhook' : 'db';
    if (driver === 'db') return { driver, dispatched: false };

    const url = process.env.QUEUE_WEBHOOK_URL?.trim();
    if (!url) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('QUEUE_WEBHOOK_URL is required when QUEUE_DRIVER=webhook');
      }
      return { driver, dispatched: false, error: 'QUEUE_WEBHOOK_URL is not configured' };
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        return { driver, dispatched: false, error: `Queue gateway responded ${response.status}` };
      }
      return { driver, dispatched: true };
    } catch (error) {
      return {
        driver,
        dispatched: false,
        error: (error instanceof Error ? error.message : 'Queue dispatch failed').slice(0, 500),
      };
    }
  }
}
