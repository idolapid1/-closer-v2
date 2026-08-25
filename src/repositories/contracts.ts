import type {
  Activity,
  Appointment,
  AvailabilityRule,
  Business,
  BusinessKnowledge,
  BusinessSettings,
  ConsentRecord,
  Contact,
  Conversation,
  CustomerMemoryItem,
  EntityCollectionName,
  HumanHandoff,
  Job,
  Lead,
  Message,
  NextAction,
  Payment,
  Quote,
  RevenueEvent,
  ScheduledFollowUp,
  Service,
  TeamMember,
  TenantEntity,
} from '../domain/entities';
import type { ConversationDecisionRecord } from '../types/assistant';

export const SCHEMA_VERSION = 5 as const;

export interface DatabaseSchema {
  schemaVersion: typeof SCHEMA_VERSION;
  businesses: Business[];
  businessSettings: BusinessSettings[];
  businessKnowledge: BusinessKnowledge[];
  teamMembers: TeamMember[];
  contacts: Contact[];
  leads: Lead[];
  conversations: Conversation[];
  messages: Message[];
  nextActions: NextAction[];
  activities: Activity[];
  services: Service[];
  appointments: Appointment[];
  availabilityRules: AvailabilityRule[];
  quotes: Quote[];
  jobs: Job[];
  payments: Payment[];
  consentRecords: ConsentRecord[];
  humanHandoffs: HumanHandoff[];
  revenueEvents: RevenueEvent[];
  customerMemory: CustomerMemoryItem[];
  scheduledFollowUps: ScheduledFollowUp[];
  assistantDecisionRecords: ConversationDecisionRecord[];
}

export type EntityByCollection = {
  [K in EntityCollectionName]: DatabaseSchema[K][number];
};

export interface TenantRepository<T extends TenantEntity> {
  list(businessId: string): T[];
  get(businessId: string, id: string): T | null;
  save(businessId: string, entity: T): T;
  remove(businessId: string, id: string): void;
  find(businessId: string, predicate: (entity: T) => boolean): T[];
}

export interface RepositoryBundle {
  businesses: TenantRepository<Business>;
  businessSettings: TenantRepository<BusinessSettings>;
  businessKnowledge: TenantRepository<BusinessKnowledge>;
  teamMembers: TenantRepository<TeamMember>;
  contacts: TenantRepository<Contact>;
  leads: TenantRepository<Lead>;
  conversations: TenantRepository<Conversation>;
  messages: TenantRepository<Message>;
  nextActions: TenantRepository<NextAction>;
  activities: TenantRepository<Activity>;
  services: TenantRepository<Service>;
  appointments: TenantRepository<Appointment>;
  availabilityRules: TenantRepository<AvailabilityRule>;
  quotes: TenantRepository<Quote>;
  jobs: TenantRepository<Job>;
  payments: TenantRepository<Payment>;
  consentRecords: TenantRepository<ConsentRecord>;
  humanHandoffs: TenantRepository<HumanHandoff>;
  revenueEvents: TenantRepository<RevenueEvent>;
  customerMemory: TenantRepository<CustomerMemoryItem>;
  scheduledFollowUps: TenantRepository<ScheduledFollowUp>;
  assistantDecisionRecords: TenantRepository<ConversationDecisionRecord>;
}

export interface StoragePort {
  read(key: string): string | null;
  write(key: string, value: string): void;
  remove(key: string): void;
}

export interface DatabasePort {
  readonly repositories: RepositoryBundle;
  snapshot(): DatabaseSchema;
  reset(seed?: DatabaseSchema): void;
  subscribe(listener: () => void): () => void;
}
