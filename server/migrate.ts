import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadDatabaseConfig } from './config.js';
import { createPostgresPool } from './infrastructure/postgres.js';

export async function runMigrations(databaseUrl: string): Promise<void> {
  const pool = createPostgresPool(databaseUrl);
  try {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS closer_schema_migrations (
         name text PRIMARY KEY,
         checksum text NOT NULL,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    const migrationDirectory = resolve(process.cwd(), 'server/migrations');
    const names = (await readdir(migrationDirectory))
      .filter((name) => name.endsWith('.sql'))
      .sort();
    for (const name of names) {
      const sql = await readFile(resolve(migrationDirectory, name), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const existing = await pool.query(
        'SELECT checksum FROM closer_schema_migrations WHERE name = $1',
        [name],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].checksum !== checksum) {
          throw new Error(`Applied migration checksum changed: ${name}`);
        }
        continue;
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          'INSERT INTO closer_schema_migrations (name, checksum) VALUES ($1, $2)',
          [name, checksum],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const config = loadDatabaseConfig();
  await runMigrations(config.DATABASE_URL);
}
