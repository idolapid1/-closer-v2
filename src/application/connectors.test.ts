import { describe, expect, it } from 'vitest';
import { ConversationChannel, LeadSource, LeadStatus } from '../domain/entities';
import {
  DeterministicMockLeadConnector,
  DisabledProductionLeadConnector,
  type InboundLeadEvent,
} from '../integrations/connectors/LeadConnector';
import { createHarness } from '../test/harness';

function fixture(source: LeadSource, suffix: string = source): InboundLeadEvent {
  return {
    businessId: 'biz-clinic',
    source,
    providerEventId: `provider-event-${suffix}`,
    externalConversationId: `external-conversation-${suffix}`,
    occurredAt: '2026-08-12T11:30:00.000Z',
    customer: {
      displayName: 'נועה ישראלי',
      phone: '+972-50-555-0199',
      email: 'noa@example.test',
    },
    message: 'What are your opening hours?',
  };
}

describe('disabled production connectors and deterministic ingestion', () => {
  it.each([
    [LeadSource.WhatsApp, ConversationChannel.WhatsApp],
    [LeadSource.Instagram, ConversationChannel.Instagram],
    [LeadSource.WebsiteForm, ConversationChannel.WebsiteForm],
    [LeadSource.Email, ConversationChannel.Email],
  ])('normalizes and ingests %s through one tenant-safe opportunity path', async (source, channel) => {
    const { service, database } = createHarness();
    const connector = new DeterministicMockLeadConnector(source);
    const event = connector.normalize(fixture(source));

    const first = await service.ingestInboundLeadEvent('biz-clinic', event);
    const second = await service.ingestInboundLeadEvent('biz-clinic', event);

    expect(second.lead.id).toBe(first.lead.id);
    expect(first.lead.source).toBe(source);
    expect(first.conversation.channel).toBe(channel);
    expect(first.contact.email).toBe('noa@example.test');
    expect(
      database.repositories.messages.find(
        'biz-clinic',
        (message) => message.providerMessageId === `${source}:${event.providerEventId}`,
      ),
    ).toHaveLength(1);
  });

  it('rejects tenant mismatch before creating any customer data', async () => {
    const { service, database } = createHarness();
    const before = database.repositories.contacts.list('biz-detailing').length;
    const event = fixture(LeadSource.WhatsApp, 'tenant-mismatch');

    await expect(service.ingestInboundLeadEvent('biz-detailing', event)).rejects.toMatchObject({
      code: 'TENANT_MISMATCH',
    });
    expect(database.repositories.contacts.list('biz-detailing')).toHaveLength(before);
  });

  it('continues a matching lost opportunity when the customer returns', async () => {
    const { service, database } = createHarness();
    const event: InboundLeadEvent = {
      ...fixture(LeadSource.WhatsApp, 'return'),
      providerEventId: 'return-event-1',
      externalConversationId: 'mock-biz-clinic-lost',
      customer: { displayName: 'רוני אברהם' },
      message: 'I would like to continue after all',
    };

    const result = await service.ingestInboundLeadEvent('biz-clinic', event);

    expect(result.lead.id).toBe('biz-clinic-lead-lost');
    expect(database.repositories.leads.get('biz-clinic', result.lead.id)?.status).toBe(
      LeadStatus.Active,
    );
    expect(
      database.repositories.leads.find(
        'biz-clinic',
        (lead) => lead.sourceReferenceId === event.externalConversationId,
      ),
    ).toHaveLength(1);
  });

  it('keeps production execution disabled until server credentials and verification exist', () => {
    const connector = new DisabledProductionLeadConnector(LeadSource.WhatsApp);
    expect(connector.mode).toBe('PRODUCTION_DISABLED');
    expect(() => connector.normalize(fixture(LeadSource.WhatsApp))).toThrow(/disabled/);
  });
});
