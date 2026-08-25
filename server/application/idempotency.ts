import { createHash } from 'node:crypto';
import { ApiError } from './errors.js';
import type { ProductionStore } from './store.js';

export class IdempotencyService {
  constructor(
    private readonly store: ProductionStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute<T>(input: {
    tenantId: string;
    scope: string;
    key: string;
    request: unknown;
    operation: () => Promise<T>;
  }): Promise<{ value: T; replayed: boolean }> {
    const now = this.now().toISOString();
    const requestHash = stableHash(input.request);
    const begin = await this.store.beginIdempotency(
      input.tenantId,
      input.scope,
      input.key,
      requestHash,
      now,
    );
    if (begin.state === 'conflict') {
      throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'The idempotency key was reused with different input');
    }
    if (begin.state === 'in_progress') {
      throw new ApiError(409, 'IDEMPOTENCY_IN_PROGRESS', 'The operation is already in progress');
    }
    if (begin.state === 'replay') {
      return { value: begin.response as T, replayed: true };
    }
    try {
      const value = await input.operation();
      await this.store.completeIdempotency(input.tenantId, input.scope, input.key, value, now);
      return { value, replayed: false };
    } catch (error) {
      await this.store.abandonIdempotency(input.tenantId, input.scope, input.key);
      throw error;
    }
  }
}

export function stableHash(value: unknown): string {
  return createHash('sha256').update(stableSerialize(value)).digest('hex');
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
    .join(',')}}`;
}

