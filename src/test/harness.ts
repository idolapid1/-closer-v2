import { CloserService } from '../application/CloserService';
import { createDemoDatabase } from '../data/demoData';
import { LocalDatabase, MemoryStorageAdapter } from '../infrastructure/persistence';
import { MockAIProvider } from '../integrations/ai/MockAIProvider';
import { MockWhatsAppProvider } from '../integrations/messaging/MockWhatsAppProvider';

export function createHarness(storage = new MemoryStorageAdapter()) {
  let sequence = 0;
  const now = () => '2026-08-12T12:00:00.000Z';
  const id = () => `test-${++sequence}`;
  const seed = createDemoDatabase();
  const database = new LocalDatabase(storage, seed);
  const messaging = new MockWhatsAppProvider(now);
  const service = new CloserService(database, new MockAIProvider(), messaging, now, id);
  return { service, database, storage, messaging, seed };
}
