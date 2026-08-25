import {
  ConversationChannel,
  ConversationMode,
  ConversationStage,
  FollowUpChannel,
  FollowUpOwner,
  FollowUpResult,
  FollowUpStopReason,
  LeadPriority,
  LeadSource,
  RevenueAttributionKind,
  RevenueAttributionStatus,
  SalesObjection,
  type EntityCollectionName,
  type KnowledgeTopic,
  type TenantEntity,
} from '../domain/entities';
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
  'customerMemory',
  'scheduledFollowUps',
  'assistantDecisionRecords',
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
      Array.isArray(candidate[collection]) &&
      candidate[collection].every((entity: unknown) =>
        collection === 'leads'
          ? isLeadEntity(entity)
          : collection === 'businessSettings'
            ? isBusinessSettingsEntity(entity)
            : collection === 'scheduledFollowUps'
              ? isScheduledFollowUpEntity(entity)
              : collection === 'revenueEvents'
                ? isRevenueEventEntity(entity)
              : isTenantEntity(entity),
      ),
  );
}

export function migrateDatabaseSchema(
  value: unknown,
  seed: DatabaseSchema,
): DatabaseSchema | null {
  if (isDatabaseSchema(value)) return clone(value);
  if (!value || typeof value !== 'object') return null;
  const legacy = value as Record<string, unknown>;
  if (![1, 2, 3, 4].includes(legacy.schemaVersion as number)) return null;
  const legacyCollections = legacy.schemaVersion === 1
    ? COLLECTIONS.filter(
        (collection) => !['customerMemory', 'scheduledFollowUps', 'assistantDecisionRecords'].includes(collection),
      )
    : COLLECTIONS;
  if (
    !legacyCollections.every(
      (collection) =>
        Array.isArray(legacy[collection]) && (legacy[collection] as unknown[]).every(isTenantEntity),
    )
  ) {
    return null;
  }

  const migrated = clone(legacy) as Record<string, unknown>;
  if (legacy.schemaVersion === 1) {
    migrated.customerMemory = [];
    migrated.scheduledFollowUps = [];
    migrated.assistantDecisionRecords = [];
  }
  migrated.businessSettings = (
    legacy.businessSettings as Array<Record<string, unknown>>
  ).map((settings) => ({
    ...settings,
    followUpCadenceHours:
      settings.followUpCadenceHours ??
      seed.businessSettings.find((candidate) => candidate.businessId === settings.businessId)
        ?.followUpCadenceHours ??
      {},
    reactivationInactivityDays:
      typeof settings.reactivationInactivityDays === 'number'
        ? settings.reactivationInactivityDays
        : seed.businessSettings.find((candidate) => candidate.businessId === settings.businessId)
            ?.reactivationInactivityDays ?? 30,
  }));
  migrated.businessKnowledge = (legacy.businessKnowledge as Array<Record<string, unknown>>).map(
    (knowledge) => {
      const defaults = seed.businessKnowledge.find(
        (candidate) => candidate.businessId === knowledge.businessId,
      );
      return {
        ...defaults,
        ...knowledge,
        priceRangesCents: knowledge.priceRangesCents ?? defaults?.priceRangesCents ?? {},
        serviceDurationsMinutes:
          knowledge.serviceDurationsMinutes ?? defaults?.serviceDurationsMinutes ?? {},
        preparationInstructions:
          knowledge.preparationInstructions ?? defaults?.preparationInstructions ?? {},
        serviceAreaLocations:
          knowledge.serviceAreaLocations ?? defaults?.serviceAreaLocations ?? [],
        appointmentRules: knowledge.appointmentRules ?? defaults?.appointmentRules ?? [],
        acceptedPaymentMethods:
          knowledge.acceptedPaymentMethods ?? defaults?.acceptedPaymentMethods ?? [],
        serviceQualificationFields:
          knowledge.serviceQualificationFields ?? defaults?.serviceQualificationFields ?? {},
        minimumAssistantConfidence:
          knowledge.minimumAssistantConfidence ?? defaults?.minimumAssistantConfidence ?? 0.72,
        allowedAutomaticAnswers: Array.from(new Set([
          ...((knowledge.allowedAutomaticAnswers as KnowledgeTopic[] | undefined) ?? []),
          ...(defaults?.allowedAutomaticAnswers ?? []),
        ])),
      };
    },
  );
  migrated.conversations = (legacy.conversations as Array<Record<string, unknown>>).map(
    (conversation) => ({
      ...conversation,
      inferredStage:
        conversation.inferredStage ??
        (conversation.mode === ConversationMode.HumanActive
          ? ConversationStage.HumanReview
          : conversation.mode === ConversationMode.Closed
            ? ConversationStage.ClosedWon
            : ConversationStage.Discovery),
    }),
  );
  migrated.humanHandoffs = (legacy.humanHandoffs as Array<Record<string, unknown>>).map(
    (handoff) => ({
      ...handoff,
      triggeringMessageId: handoff.triggeringMessageId ?? null,
      confidence: handoff.confidence ?? null,
      responsibleState: handoff.responsibleState ?? ConversationStage.HumanReview,
    }),
  );
  const legacyConversations = new Map(
    (legacy.conversations as Array<Record<string, unknown>>).map((conversation) => [
      conversation.id,
      conversation,
    ]),
  );
  migrated.scheduledFollowUps = (
    (migrated.scheduledFollowUps as Array<Record<string, unknown>> | undefined) ?? []
  ).map((followUp) => {
    const conversation = legacyConversations.get(followUp.conversationId);
    return {
      ...followUp,
      sequenceKey: followUp.sequenceKey ?? followUp.scenario,
      sequenceStep:
        typeof followUp.sequenceStep === 'number' ? followUp.sequenceStep : 0,
      channel: isFollowUpChannel(followUp.channel)
        ? followUp.channel
        : followUpChannelForConversation(conversation?.channel),
      attemptCount:
        typeof followUp.attemptCount === 'number' ? followUp.attemptCount : 0,
      attempts: Array.isArray(followUp.attempts) ? followUp.attempts : [],
      nextAttemptAt: followUp.nextAttemptAt ?? followUp.dueAt ?? null,
      lastAttemptAt: followUp.lastAttemptAt ?? null,
      lastResponseAt: followUp.lastResponseAt ?? null,
      stopReason: isFollowUpStopReason(followUp.stopReason) ? followUp.stopReason : null,
      manualOverride:
        typeof followUp.manualOverride === 'boolean' ? followUp.manualOverride : false,
      owner: isFollowUpOwner(followUp.owner) ? followUp.owner : FollowUpOwner.Assistant,
      ownerTeamMemberId:
        typeof followUp.ownerTeamMemberId === 'string' ? followUp.ownerTeamMemberId : null,
      draftMessage:
        typeof followUp.draftMessage === 'string' ? followUp.draftMessage : null,
      result: isFollowUpResult(followUp.result) ? followUp.result : FollowUpResult.Pending,
    };
  });
  migrated.leads = (legacy.leads as Array<Record<string, unknown>>).map((lead) => {
    const conversation = legacyConversations.get(lead.conversationId);
    const source = isLeadSource(lead.source)
      ? lead.source
      : leadSourceForChannel(conversation?.channel);
    return {
      ...lead,
      lostReason: lead.lostReason ?? null,
      source,
      sourceReferenceId:
        typeof lead.sourceReferenceId === 'string' && lead.sourceReferenceId !== ''
          ? lead.sourceReferenceId
          : null,
      priority: isLeadPriority(lead.priority) ? lead.priority : LeadPriority.Normal,
      objections: Array.isArray(lead.objections)
        ? lead.objections.filter(isSalesObjection)
        : [],
    };
  });
  const migratedLeads = new Map(
    (migrated.leads as Array<Record<string, unknown>>).map((lead) => [lead.id, lead]),
  );
  const referenceLeadIds = new Map<string, string>();
  for (const collection of ['appointments', 'quotes', 'jobs'] as const) {
    for (const reference of legacy[collection] as Array<Record<string, unknown>>) {
      if (typeof reference.id === 'string' && typeof reference.leadId === 'string') {
        referenceLeadIds.set(reference.id, reference.leadId);
      }
    }
  }
  migrated.revenueEvents = (legacy.revenueEvents as Array<Record<string, unknown>>).map(
    (event) => {
      const leadId =
        typeof event.leadId === 'string'
          ? event.leadId
          : referenceLeadIds.get(String(event.referenceId)) ?? '';
      const lead = migratedLeads.get(leadId);
      return {
        ...event,
        leadId,
        conversationId:
          typeof event.conversationId === 'string'
            ? event.conversationId
            : typeof lead?.conversationId === 'string'
              ? lead.conversationId
              : '',
        leadSource: isLeadSource(event.leadSource)
          ? event.leadSource
          : isLeadSource(lead?.source)
            ? lead.source
            : LeadSource.Manual,
        attributionStatus: isRevenueAttributionStatus(event.attributionStatus)
          ? event.attributionStatus
          : RevenueAttributionStatus.Unattributed,
        attributionKind: isRevenueAttributionKind(event.attributionKind)
          ? event.attributionKind
          : null,
        contributingActivityIds: Array.isArray(event.contributingActivityIds)
          ? event.contributingActivityIds.filter((id): id is string => typeof id === 'string')
          : [],
        attributionOperationKey:
          typeof event.attributionOperationKey === 'string'
            ? event.attributionOperationKey
            : null,
        attributedAt: typeof event.attributedAt === 'string' ? event.attributedAt : null,
        attributedByTeamMemberId:
          typeof event.attributedByTeamMemberId === 'string'
            ? event.attributedByTeamMemberId
            : null,
      };
    },
  );
  migrated.services = (legacy.services as Array<Record<string, unknown>>).map((service) => ({
    ...service,
    workflowType:
      service.workflowType ??
      seed.services.find((candidate) => candidate.id === service.id)?.workflowType ??
      seed.businesses.find((candidate) => candidate.id === service.businessId)?.workflowType,
  }));
  for (const collection of ['appointments', 'quotes', 'jobs'] as const) {
    migrated[collection] = (legacy[collection] as Array<Record<string, unknown>>).map((entity) => ({
      ...entity,
      operationKey: entity.operationKey ?? `migrated:${collection}:${String(entity.id)}`,
    }));
  }
  migrated.activities = (legacy.activities as Array<Record<string, unknown>>).map((activity) => ({
    ...activity,
    occurredAt: activity.occurredAt ?? activity.createdAt,
    operationKey: activity.operationKey ?? null,
  }));
  migrated.schemaVersion = SCHEMA_VERSION;
  return isDatabaseSchema(migrated) ? clone(migrated) : null;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function isLeadEntity(value: unknown): boolean {
  if (!isTenantEntity(value)) return false;
  const lead = value as unknown as Record<string, unknown>;
  return (
    isLeadSource(lead.source) &&
    (lead.sourceReferenceId === null || typeof lead.sourceReferenceId === 'string') &&
    isLeadPriority(lead.priority) &&
    Array.isArray(lead.objections) &&
    lead.objections.every(isSalesObjection)
  );
}

function isBusinessSettingsEntity(value: unknown): boolean {
  if (!isTenantEntity(value)) return false;
  const settings = value as unknown as Record<string, unknown>;
  if (!settings.followUpCadenceHours || typeof settings.followUpCadenceHours !== 'object') {
    return false;
  }
  if (
    !Number.isSafeInteger(settings.reactivationInactivityDays) ||
    (settings.reactivationInactivityDays as number) < 1
  ) {
    return false;
  }
  return Object.values(settings.followUpCadenceHours).every(
    (cadence) =>
      Array.isArray(cadence) &&
      cadence.every((hours) => Number.isSafeInteger(hours) && (hours as number) >= 0),
  );
}

function isScheduledFollowUpEntity(value: unknown): boolean {
  if (!isTenantEntity(value)) return false;
  const followUp = value as unknown as Record<string, unknown>;
  return (
    typeof followUp.sequenceKey === 'string' &&
    Number.isSafeInteger(followUp.sequenceStep) &&
    isFollowUpChannel(followUp.channel) &&
    Number.isSafeInteger(followUp.attemptCount) &&
    Array.isArray(followUp.attempts) &&
    followUp.attempts.every(isFollowUpAttempt) &&
    (followUp.nextAttemptAt === null || typeof followUp.nextAttemptAt === 'string') &&
    (followUp.lastAttemptAt === null || typeof followUp.lastAttemptAt === 'string') &&
    (followUp.lastResponseAt === null || typeof followUp.lastResponseAt === 'string') &&
    (followUp.stopReason === null || isFollowUpStopReason(followUp.stopReason)) &&
    typeof followUp.manualOverride === 'boolean' &&
    isFollowUpOwner(followUp.owner) &&
    (followUp.ownerTeamMemberId === null || typeof followUp.ownerTeamMemberId === 'string') &&
    (followUp.draftMessage === null || typeof followUp.draftMessage === 'string') &&
    isFollowUpResult(followUp.result)
  );
}

function isRevenueEventEntity(value: unknown): boolean {
  if (!isTenantEntity(value)) return false;
  const event = value as unknown as Record<string, unknown>;
  return (
    typeof event.leadId === 'string' &&
    event.leadId !== '' &&
    typeof event.conversationId === 'string' &&
    event.conversationId !== '' &&
    isLeadSource(event.leadSource) &&
    isRevenueAttributionStatus(event.attributionStatus) &&
    (event.attributionKind === null || isRevenueAttributionKind(event.attributionKind)) &&
    Array.isArray(event.contributingActivityIds) &&
    event.contributingActivityIds.every((id) => typeof id === 'string') &&
    (event.attributionOperationKey === null || typeof event.attributionOperationKey === 'string') &&
    (event.attributedAt === null || typeof event.attributedAt === 'string') &&
    (event.attributedByTeamMemberId === null ||
      typeof event.attributedByTeamMemberId === 'string')
  );
}

function isRevenueAttributionKind(value: unknown): value is RevenueAttributionKind {
  return Object.values(RevenueAttributionKind).includes(value as RevenueAttributionKind);
}

function isRevenueAttributionStatus(value: unknown): value is RevenueAttributionStatus {
  return Object.values(RevenueAttributionStatus).includes(value as RevenueAttributionStatus);
}

function isFollowUpAttempt(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const attempt = value as Record<string, unknown>;
  return (
    typeof attempt.operationKey === 'string' &&
    isFollowUpResult(attempt.result) &&
    attempt.result !== FollowUpResult.Pending &&
    attempt.result !== FollowUpResult.ResponseReceived &&
    attempt.result !== FollowUpResult.Stopped &&
    typeof attempt.attemptedAt === 'string'
  );
}

function isLeadSource(value: unknown): value is LeadSource {
  return Object.values(LeadSource).includes(value as LeadSource);
}

function isLeadPriority(value: unknown): value is LeadPriority {
  return Object.values(LeadPriority).includes(value as LeadPriority);
}

function isSalesObjection(value: unknown): value is SalesObjection {
  return Object.values(SalesObjection).includes(value as SalesObjection);
}

function isFollowUpChannel(value: unknown): value is FollowUpChannel {
  return Object.values(FollowUpChannel).includes(value as FollowUpChannel);
}

function isFollowUpOwner(value: unknown): value is FollowUpOwner {
  return Object.values(FollowUpOwner).includes(value as FollowUpOwner);
}

function isFollowUpResult(value: unknown): value is FollowUpResult {
  return Object.values(FollowUpResult).includes(value as FollowUpResult);
}

function isFollowUpStopReason(value: unknown): value is FollowUpStopReason {
  return Object.values(FollowUpStopReason).includes(value as FollowUpStopReason);
}

function leadSourceForChannel(channel: unknown): LeadSource {
  if (channel === ConversationChannel.WhatsApp) return LeadSource.WhatsApp;
  if (channel === ConversationChannel.Instagram) return LeadSource.Instagram;
  if (channel === ConversationChannel.WebsiteForm) return LeadSource.WebsiteForm;
  if (channel === ConversationChannel.Email) return LeadSource.Email;
  return LeadSource.Manual;
}

function followUpChannelForConversation(channel: unknown): FollowUpChannel {
  if (channel === ConversationChannel.WhatsApp) return FollowUpChannel.WhatsApp;
  if (channel === ConversationChannel.Instagram) return FollowUpChannel.Instagram;
  if (channel === ConversationChannel.Email) return FollowUpChannel.Email;
  return FollowUpChannel.Manual;
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
      customerMemory: make('customerMemory'),
      scheduledFollowUps: make('scheduledFollowUps'),
      assistantDecisionRecords: make('assistantDecisionRecords'),
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
      const migrated = migrateDatabaseSchema(parsed, this.seed);
      if (migrated) {
        this.storage.write(STORAGE_KEY, JSON.stringify(migrated));
        return migrated;
      }
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
