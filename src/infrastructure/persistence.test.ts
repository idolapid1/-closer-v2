import { describe, expect, it } from 'vitest';
import { createDemoDatabase } from '../data/demoData';
import { LocalDatabase, MemoryStorageAdapter, STORAGE_KEY } from './persistence';
import { createHarness } from '../test/harness';

describe('versioned persistence', () => {
  it('survives a repository re-instantiation (refresh)', () => {
    const storage = new MemoryStorageAdapter();
    const first = createHarness(storage);
    first.service.optOutMarketing('biz-clinic', 'biz-clinic-contact-new');
    const second = new LocalDatabase(storage, createDemoDatabase());
    const consent = second.repositories.consentRecords.find(
      'biz-clinic',
      (record) => record.contactId === 'biz-clinic-contact-new',
    )[0];
    expect(consent?.optedOut).toBe(true);
  });

  it('falls back to deterministic demo data when persisted data is corrupt', () => {
    const storage = new MemoryStorageAdapter();
    storage.write(STORAGE_KEY, '{broken-json');
    const database = new LocalDatabase(storage, createDemoDatabase());
    expect(database.repositories.businesses.list('biz-clinic')[0]?.name).toBe('Luma Aesthetics');
  });

  it('reset demo restores the seed and discards local mutations', () => {
    const { service, database } = createHarness();
    service.optOutMarketing('biz-clinic', 'biz-clinic-contact-new');
    service.resetDemo();
    const consent = database.repositories.consentRecords.find(
      'biz-clinic',
      (record) => record.contactId === 'biz-clinic-contact-new',
    )[0];
    expect(consent?.optedOut).toBe(false);
  });
});
