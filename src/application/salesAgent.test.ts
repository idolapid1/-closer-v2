import { describe, expect, it } from 'vitest';
import {
  ConversationChannel,
  LeadPriority,
  LeadSource,
  SalesObjection,
} from '../domain/entities';
import { LocalDatabase, MemoryStorageAdapter } from '../infrastructure/persistence';
import { createDemoDatabase } from '../data/demoData';
import { createHarness } from '../test/harness';

const CLINIC = 'biz-clinic';
const DETAILING = 'biz-detailing';

describe('sales opportunity identity and context', () => {
  it('persists normalized source, priority, and objections on the existing Lead opportunity', () => {
    const { service, database } = createHarness();
    const created = service.createCustomerOpportunity({
      businessId: DETAILING,
      displayName: 'Source customer',
      source: LeadSource.Instagram,
      sourceReferenceId: 'meta-lead-42',
    });

    expect(created.lead).toMatchObject({
      source: LeadSource.Instagram,
      sourceReferenceId: 'meta-lead-42',
      priority: LeadPriority.Normal,
      objections: [],
    });
    expect(created.conversation.channel).toBe(ConversationChannel.Instagram);

    service.setLeadPriority(DETAILING, created.lead.id, LeadPriority.High);
    service.recordLeadObjection(DETAILING, created.lead.id, SalesObjection.Price);
    service.recordLeadObjection(DETAILING, created.lead.id, SalesObjection.Price);

    expect(service.opportunity(DETAILING, created.lead.id).leadStatus).toBe('NEW');
    expect(database.repositories.leads.get(DETAILING, created.lead.id)).toMatchObject({
      priority: LeadPriority.High,
      objections: [SalesObjection.Price],
    });
    expect(
      service.productCustomers(DETAILING).customers.find(
        (customer) => customer.contactId === created.contact.id,
      ),
    ).toBeDefined();
  });

  it('deduplicates an external source reference within a tenant without crossing tenants', () => {
    const { service, database } = createHarness();
    const first = service.createCustomerOpportunity({
      businessId: DETAILING,
      displayName: 'First delivery',
      source: LeadSource.WebsiteForm,
      sourceReferenceId: 'form-submission-7',
    });
    const duplicate = service.createCustomerOpportunity({
      businessId: DETAILING,
      displayName: 'Repeated delivery',
      source: LeadSource.WebsiteForm,
      sourceReferenceId: 'form-submission-7',
    });
    const otherTenant = service.createCustomerOpportunity({
      businessId: CLINIC,
      displayName: 'Same external id, different tenant',
      source: LeadSource.WebsiteForm,
      sourceReferenceId: 'form-submission-7',
    });

    expect(duplicate.lead.id).toBe(first.lead.id);
    expect(duplicate.contact.id).toBe(first.contact.id);
    expect(otherTenant.lead.id).not.toBe(first.lead.id);
    expect(
      database.repositories.leads.find(
        DETAILING,
        (lead) =>
          lead.source === LeadSource.WebsiteForm &&
          lead.sourceReferenceId === 'form-submission-7',
      ),
    ).toHaveLength(1);
  });

  it('restores sales context after persistence refresh and keeps mutations tenant scoped', () => {
    const storage = new MemoryStorageAdapter();
    const first = createHarness(storage);
    const created = first.service.createCustomerOpportunity({
      businessId: DETAILING,
      displayName: 'Persistent source',
      source: LeadSource.WhatsApp,
      sourceReferenceId: 'wamid.100',
    });
    first.service.setLeadPriority(DETAILING, created.lead.id, LeadPriority.Urgent);
    first.service.recordLeadObjection(DETAILING, created.lead.id, SalesObjection.Timing);

    const restored = new LocalDatabase(storage, createDemoDatabase());
    expect(restored.repositories.leads.get(DETAILING, created.lead.id)).toMatchObject({
      source: LeadSource.WhatsApp,
      sourceReferenceId: 'wamid.100',
      priority: LeadPriority.Urgent,
      objections: [SalesObjection.Timing],
    });
    expect(() => first.service.setLeadPriority(CLINIC, created.lead.id, LeadPriority.High)).toThrow(
      'Lead not found',
    );
  });
});
