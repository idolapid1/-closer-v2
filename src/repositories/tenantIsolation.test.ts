import { describe, expect, it } from 'vitest';
import type { TenantEntity } from '../domain/entities';
import type { TenantRepository } from './contracts';
import { createHarness } from '../test/harness';

describe('tenant-scoped repositories', () => {
  it('prevents cross-business reads for every required major entity', () => {
    const { database } = createHarness();
    const repositories = database.repositories;
    const clinicId = 'biz-clinic';
    const detailingId = 'biz-detailing';
    const hidden = <T extends TenantEntity>(
      repository: TenantRepository<T>,
      sourceBusinessId: string,
      otherBusinessId: string,
    ) => {
      const entity = repository.list(sourceBusinessId)[0];
      expect(entity).toBeDefined();
      expect(repository.get(otherBusinessId, entity!.id)).toBeNull();
      expect(repository.list(otherBusinessId).some((candidate) => candidate.businessId === sourceBusinessId)).toBe(false);
    };

    hidden(repositories.contacts, clinicId, detailingId);
    hidden(repositories.leads, clinicId, detailingId);
    hidden(repositories.conversations, clinicId, detailingId);
    hidden(repositories.appointments, clinicId, detailingId);
    hidden(repositories.quotes, detailingId, clinicId);
    hidden(repositories.jobs, detailingId, clinicId);
    hidden(repositories.payments, clinicId, detailingId);
    hidden(repositories.businessKnowledge, clinicId, detailingId);
  });

  it('rejects a write whose entity belongs to another business', () => {
    const { database } = createHarness();
    const contact = database.repositories.contacts.list('biz-clinic')[0];
    expect(contact).toBeDefined();
    expect(() => database.repositories.contacts.save('biz-detailing', contact!)).toThrow('Tenant mismatch');
  });
});
