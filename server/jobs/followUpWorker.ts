import { randomUUID } from 'node:crypto';
import type { FollowUpJobRecord } from '../domain/model.js';
import type { ProductionStore } from '../application/store.js';

export interface FollowUpDispatcher {
  readonly mode: 'mock';
  send(job: FollowUpJobRecord, attemptKey: string): Promise<{ providerMessageId: string }>;
}

export class DeterministicMockFollowUpDispatcher implements FollowUpDispatcher {
  readonly mode = 'mock' as const;
  readonly sent: Array<{ followUpId: string; attemptKey: string }> = [];

  async send(job: FollowUpJobRecord, attemptKey: string): Promise<{ providerMessageId: string }> {
    if (this.sent.some((entry) => entry.attemptKey === attemptKey)) {
      return { providerMessageId: `mock:${attemptKey}` };
    }
    this.sent.push({ followUpId: job.id, attemptKey });
    return { providerMessageId: `mock:${attemptKey}` };
  }
}

export interface FollowUpWorkerOptions {
  workerId?: string;
  leaseMilliseconds?: number;
  now?: () => Date;
}

export class FollowUpWorker {
  private readonly workerId: string;
  private readonly leaseMilliseconds: number;
  private readonly now: () => Date;

  constructor(
    private readonly store: ProductionStore,
    private readonly dispatcher: FollowUpDispatcher,
    options: FollowUpWorkerOptions = {},
  ) {
    this.workerId = options.workerId ?? `worker-${randomUUID()}`;
    this.leaseMilliseconds = options.leaseMilliseconds ?? 30_000;
    this.now = options.now ?? (() => new Date());
  }

  async runOnce(): Promise<'idle' | 'completed' | 'failed'> {
    const startedAt = this.now();
    const job = await this.store.runAsSystem('follow-up-worker', (store) => (
      store.claimDueFollowUp(
        this.workerId,
        startedAt.toISOString(),
        new Date(startedAt.getTime() + this.leaseMilliseconds).toISOString(),
      )
    ));
    if (!job) return 'idle';
    const attemptKey = `${job.id}:attempt:${job.attemptCount + 1}`;
    try {
      await this.dispatcher.send(job, attemptKey);
      await this.store.runAsSystem('follow-up-worker', (store) => (
        store.completeFollowUp(job.id, this.workerId, attemptKey, this.now().toISOString())
      ));
      return 'completed';
    } catch {
      const retryAt = new Date(this.now().getTime() + 60_000).toISOString();
      await this.store.runAsSystem('follow-up-worker', (store) => (
        store.failFollowUp(
          job.id,
          this.workerId,
          attemptKey,
          'MOCK_DISPATCH_FAILED',
          retryAt,
          this.now().toISOString(),
        )
      ));
      return 'failed';
    }
  }
}
