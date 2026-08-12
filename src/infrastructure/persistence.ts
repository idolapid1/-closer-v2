import type { EntityCollectionName, TenantEntity } from '../domain/entities';
import type {
  DatabasePort,
  DatabaseSchema,
  EntityByCollection,
  RepositoryBundle,
  StoragePort,
  TenantRepository,
} from '../repositories/contracts';
import { SCHEMA_VERSION } from '../repositories/contracts';

export const STORAGE_KEY = 'closer-v2:database';

const COLLECTIONS: EntityCollectionName[] = [
  'businesses',
  'businessSettings',
  'businessKnowledge',
  'teamMembers',
  'contacts',
  'leads',
  'conversations',
  'messages',
  'nextActions',
  'activities',
  'services',
  'appointments',
  'availabilityRules',
  'quotes',
  'jobs',
  'payments',
  'consentRecords',
  'humanHandoffs',
  'revenueEvents',
];

export class BrowserStorageAdapter implements StoragePort {
  read(key: string): string | null {
    return window.localStorage.getItem(key);
  }

  write(key: string, value: string): void {
    window.localStorage.setItem(key, value);
  }

  remove(key: string): void {
    window.localStorage.removeItem(key);
  }
}

export class MemoryStorageAdapter implements StoragePort {
  private readonly entries = new Map<string, string>();

  read(key: string): string | null {
    return this.entries.get(key) ?? null;
  }

  write(key: string, value: string): void {
    this.entries.set(key, value);
  }

  remove(key: string): void {
    this.entries.delete(key);
  }
}

function isTenantEntity(value: unknown): value is TenantEntity {
  if (!value || typeof value !== 'object') return false;
  const entity = value as Record<string, unknown>;
  return ['id', 'businessId', 'createdAt', 'updatedAt'].every(
    (field) => typeof entity[field] === 'string' && entity[field] !== '',
  );
}

export function isDatabaseSchema(value: unknown): value is DatabaseSchema {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== SCHEMA_VERSION) return false;
  return COLLECTIONS.every(
    (collection) =>
      Array.isArray(candidate[collection]) && candidate[collection].every(isTenantEntity),
  );
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

class LocalTenantRepository<K extends EntityCollectionName>
  implements TenantRepository<EntityByCollection[K]>
{
  constructor(
    private readonly collection: K,
    private readonly getState: () => DatabaseSchema,
    private readonly commit: (state: DatabaseSchema) => void,
  ) {}

  list(businessId: string): EntityByCollection[K][] {
    const collection = this.getState()[this.collection] as EntityByCollection[K][];
    return clone(collection.filter((entity) => entity.businessId === businessId));
  }

  get(businessId: string, id: string): EntityByCollection[K] | null {
    const collection = this.getState()[this.collection] as EntityByCollection[K][];
    const entity = collection.find(
      (candidate) => candidate.businessId === businessId && candidate.id === id,
    );
    return entity ? clone(entity) : null;
  }

  save(businessId: string, entity: EntityByCollection[K]): EntityByCollection[K] {
    if (entity.businessId !== businessId) {
      throw new Error(`Tenant mismatch while saving ${this.collection}`);
    }
    const state = clone(this.getState());
    const collection = state[this.collection] as EntityByCollection[K][];
    const index = collection.findIndex(
      (candidate) => candidate.businessId === businessId && candidate.id === entity.id,
    );
    const saved = clone(entity);
    if (index >= 0) collection[index] = saved;
    else collection.push(saved);
    this.commit(state);
    return clone(saved);
  }

  remove(businessId: string, id: string): void {
    const state = clone(this.getState());
    const collection = state[this.collection] as EntityByCollection[K][];
    const index = collection.findIndex(
      (candidate) => candidate.businessId === businessId && candidate.id === id,
    );
    if (index >= 0) {
      collection.splice(index, 1);
      this.commit(state);
    }
  }

  find(
    businessId: string,
    predicate: (entity: EntityByCollection[K]) => boolean,
  ): EntityByCollection[K][] {
    return this.list(businessId).filter(predicate);
  }
}

export class LocalDatabase implements DatabasePort {
  private state: DatabaseSchema;
  private readonly listeners = new Set<() => void>();
  readonly repositories: RepositoryBundle;

  constructor(
    private readonly storage: StoragePort,
    private readonly seed: DatabaseSchema,
  ) {
    this.state = this.load();
    const make = <K extends EntityCollectionName>(collection: K) =>
      new LocalTenantRepository(collection, () => this.state, (state) => this.commit(state));
    this.repositories = {
      businesses: make('businesses'),
      businessSettings: make('businessSettings'),
      businessKnowledge: make('businessKnowledge'),
      teamMembers: make('teamMembers'),
      contacts: make('contacts'),
      leads: make('leads'),
      conversations: make('conversations'),
      messages: make('messages'),
      nextActions: make('nextActions'),
      activities: make('activities'),
      services: make('services'),
      appointments: make('appointments'),
      availabilityRules: make('availabilityRules'),
      quotes: make('quotes'),
      jobs: make('jobs'),
      payments: make('payments'),
      consentRecords: make('consentRecords'),
      humanHandoffs: make('humanHandoffs'),
      revenueEvents: make('revenueEvents'),
    };
  }

  snapshot(): DatabaseSchema {
    return clone(this.state);
  }

  reset(seed: DatabaseSchema = this.seed): void {
    this.storage.remove(STORAGE_KEY);
    this.commit(clone(seed));
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private load(): DatabaseSchema {
    const raw = this.storage.read(STORAGE_KEY);
    if (!raw) {
      const initial = clone(this.seed);
      this.storage.write(STORAGE_KEY, JSON.stringify(initial));
      return initial;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isDatabaseSchema(parsed)) return clone(parsed);
    } catch {
      // Fall through to a clean, deterministic seed.
    }
    const fallback = clone(this.seed);
    this.storage.write(STORAGE_KEY, JSON.stringify(fallback));
    return fallback;
  }

  private commit(state: DatabaseSchema): void {
    if (!isDatabaseSchema(state)) throw new Error('Refusing to persist an invalid database schema');
    this.state = clone(state);
    this.storage.write(STORAGE_KEY, JSON.stringify(this.state));
    this.listeners.forEach((listener) => listener());
  }
}
