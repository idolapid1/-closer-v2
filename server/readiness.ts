import type { Pool } from 'pg';
import { verifyDatabaseSchema } from './verifyDatabase.js';

export class DatabaseReadinessProbe {
  private lastSchemaVerificationAt = 0;

  constructor(
    private readonly pool: Pool,
    private readonly cacheMilliseconds = 15_000,
    private readonly now: () => number = Date.now,
  ) {}

  async check(): Promise<{ status: 'ready' } | { status: 'not_ready'; reason: string }> {
    try {
      await this.pool.query('SELECT 1');
      if (this.now() - this.lastSchemaVerificationAt >= this.cacheMilliseconds) {
        await verifyDatabaseSchema(this.pool);
        this.lastSchemaVerificationAt = this.now();
      }
      return { status: 'ready' };
    } catch {
      return { status: 'not_ready', reason: 'DATABASE_OR_SCHEMA_UNAVAILABLE' };
    }
  }
}
