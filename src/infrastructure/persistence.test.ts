import { describe, expect, it } from 'vitest';
import { createDemoDatabase } from '../data/demoData';
import { LocalDatabase, MemoryStorageAdapter, STORAGE_KEY } from './persistence';
import { SCHEMA_VERSION } from '../repositories/contracts';
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

  it('migrates a valid Phase 1 schema without losing tenant data', () => {
    const storage = new MemoryStorageAdapter();
    const seed = createDemoDatabase();
    const legacy = structuredClone(seed) as unknown as Record<string, unknown>;
    legacy.schemaVersion = 1;
    delete legacy.customerMemory;
    delete legacy.scheduledFollowUps;
    delete legacy.assistantDecisionRecords;
    (legacy.businessKnowledge as Array<Record<string, unknown>>).forEach((knowledge) => {
      delete knowledge.priceRangesCents;
      delete knowledge.serviceDurationsMinutes;
      delete knowledge.preparationInstructions;
      delete knowledge.serviceAreaLocations;
      delete knowledge.appointmentRules;
      delete knowledge.acceptedPaymentMethods;
      delete knowledge.serviceQualificationFields;
      delete knowledge.minimumAssistantConfidence;
    });
    (legacy.conversations as Array<Record<string, unknown>>).forEach((conversation) => {
      delete conversation.inferredStage;
    });
    (legacy.humanHandoffs as Array<Record<string, unknown>>).forEach((handoff) => {
      delete handoff.triggeringMessageId;
      delete handoff.confidence;
      delete handoff.responsibleState;
    });
    storage.write(STORAGE_KEY, JSON.stringify(legacy));

    const database = new LocalDatabase(storage, seed);
    const snapshot = database.snapshot();
    expect(snapshot.schemaVersion).toBe(SCHEMA_VERSION);
    expect(snapshot.contacts).toHaveLength(seed.contacts.length);
    expect(snapshot.customerMemory).toEqual([]);
    expect(snapshot.businessKnowledge[0]?.minimumAssistantConfidence).toBe(0.72);
    expect(snapshot.businessKnowledge[0]?.allowedAutomaticAnswers).toContain('SERVICE_DESCRIPTION');
    expect(snapshot.conversations[0]?.inferredStage).toBeDefined();
    expect(JSON.parse(storage.read(STORAGE_KEY) ?? '{}').schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('migrates a valid Phase 2 schema to commercial journey defaults', () => {
    const storage = new MemoryStorageAdapter();
    const seed = createDemoDatabase();
    const legacy = structuredClone(seed) as unknown as Record<string, unknown>;
    legacy.schemaVersion = 2;
    (legacy.leads as Array<Record<string, unknown>>).forEach((lead) => delete lead.lostReason);
    (legacy.services as Array<Record<string, unknown>>).forEach((service) => delete service.workflowType);
    (legacy.activities as Array<Record<string, unknown>>).forEach((activity) => {
      delete activity.occurredAt;
      delete activity.operationKey;
    });
    for (const collection of ['appointments', 'quotes', 'jobs']) {
      (legacy[collection] as Array<Record<string, unknown>>).forEach((entity) => delete entity.operationKey);
    }
    storage.write(STORAGE_KEY, JSON.stringify(legacy));
    const database = new LocalDatabase(storage, seed);
    const snapshot = database.snapshot();
    expect(snapshot.schemaVersion).toBe(SCHEMA_VERSION);
    expect(snapshot.leads.every((lead) => 'lostReason' in lead)).toBe(true);
    expect(snapshot.services.every((service) => service.workflowType)).toBe(true);
    expect(snapshot.activities.every((activity) => activity.occurredAt && 'operationKey' in activity)).toBe(true);
    expect(snapshot.appointments.every((appointment) => appointment.operationKey)).toBe(true);
    expect(snapshot.quotes.every((quote) => quote.operationKey)).toBe(true);
    expect(snapshot.jobs.every((job) => job.operationKey)).toBe(true);
  });

  it('migrates Phase 3 leads to normalized sales-source defaults', () => {
    const storage = new MemoryStorageAdapter();
    const seed = createDemoDatabase();
    const legacy = structuredClone(seed) as unknown as Record<string, unknown>;
    legacy.schemaVersion = 3;
    (legacy.leads as Array<Record<string, unknown>>).forEach((lead) => {
      delete lead.source;
      delete lead.sourceReferenceId;
      delete lead.priority;
      delete lead.objections;
    });
    (legacy.businessSettings as Array<Record<string, unknown>>).forEach(
      (settings) => {
        delete settings.followUpCadenceHours;
        delete settings.reactivationInactivityDays;
      },
    );
    (legacy.scheduledFollowUps as Array<Record<string, unknown>>).forEach((followUp) => {
      for (const field of [
        'sequenceKey',
        'sequenceStep',
        'channel',
        'attemptCount',
        'attempts',
        'nextAttemptAt',
        'lastAttemptAt',
        'lastResponseAt',
        'stopReason',
        'manualOverride',
        'owner',
        'ownerTeamMemberId',
        'draftMessage',
        'result',
      ]) {
        delete followUp[field];
      }
    });
    storage.write(STORAGE_KEY, JSON.stringify(legacy));

    const database = new LocalDatabase(storage, seed);
    const snapshot = database.snapshot();

    expect(snapshot.schemaVersion).toBe(SCHEMA_VERSION);
    expect(snapshot.leads.every((lead) => lead.source === 'WHATSAPP')).toBe(true);
    expect(snapshot.leads.every((lead) => lead.priority === 'NORMAL')).toBe(true);
    expect(snapshot.leads.every((lead) => lead.sourceReferenceId === null)).toBe(true);
    expect(snapshot.leads.every((lead) => lead.objections.length === 0)).toBe(true);
    expect(snapshot.businessSettings.every((settings) => settings.followUpCadenceHours)).toBe(true);
    expect(
      snapshot.businessSettings.every((settings) => settings.reactivationInactivityDays > 0),
    ).toBe(true);
    expect(snapshot.scheduledFollowUps.every((followUp) => followUp.nextAttemptAt)).toBe(true);
    expect(snapshot.scheduledFollowUps.every((followUp) => followUp.attemptCount === 0)).toBe(true);
  });

  it('migrates Phase 4 revenue events to tenant-linked attribution defaults', () => {
    const storage = new MemoryStorageAdapter();
    const seed = createDemoDatabase();
    const legacy = structuredClone(seed) as unknown as Record<string, unknown>;
    legacy.schemaVersion = 4;
    (legacy.revenueEvents as Array<Record<string, unknown>>).forEach((event) => {
      for (const field of [
        'leadId',
        'conversationId',
        'leadSource',
        'attributionStatus',
        'attributionKind',
        'contributingActivityIds',
        'attributionOperationKey',
        'attributedAt',
        'attributedByTeamMemberId',
      ]) {
        delete event[field];
      }
    });
    storage.write(STORAGE_KEY, JSON.stringify(legacy));

    const database = new LocalDatabase(storage, seed);
    const events = database.snapshot().revenueEvents;

    expect(events.every((event) => event.leadId && event.conversationId)).toBe(true);
    expect(events.every((event) => event.attributionStatus === 'UNATTRIBUTED')).toBe(true);
    expect(events.every((event) => event.contributingActivityIds.length === 0)).toBe(true);
  });
});
