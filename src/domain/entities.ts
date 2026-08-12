export interface TenantEntity {
  id: string;
  businessId: string;
  createdAt: string;
  updatedAt: string;
}

export enum WorkflowType {
  AppointmentService = 'APPOINTMENT_SERVICE',
  QuoteJob = 'QUOTE_JOB',
}

export enum BusinessKind {
  Clinic = 'CLINIC',
  AutoDetailing = 'AUTO_DETAILING',
  HomeServices = 'HOME_SERVICES',
}

export interface Business extends TenantEntity {
  name: string;
  kind: BusinessKind;
  workflowType: WorkflowType;
  currency: 'ILS' | 'USD' | 'EUR' | 'GBP';
  timeZone: string;
}

export interface BusinessSettings extends TenantEntity {
  taxEnabled: boolean;
  taxRateBasisPoints: number;
  defaultDepositBasisPoints: number;
  paymentMethods: string[];
}

export interface KnowledgeFaq {
  question: string;
  answer: string;
}

export interface BusinessKnowledge extends TenantEntity {
  businessName: string;
  serviceDescriptions: Record<string, string>;
  fixedPricesCents: Record<string, number>;
  pricingRules: string[];
  openingHours: string;
  address: string;
  serviceArea: string;
  cancellationPolicy: string;
  depositPolicy: string;
  faq: KnowledgeFaq[];
  toneOfVoice: string;
  allowedAutomaticAnswers: KnowledgeTopic[];
  answersRequiringHumanReview: string[];
  prohibitedAutonomousActions: string[];
  requiredQualificationFields: string[];
}

export enum KnowledgeTopic {
  OpeningHours = 'OPENING_HOURS',
  Address = 'ADDRESS',
  FixedPrice = 'FIXED_PRICE',
  ServiceDuration = 'SERVICE_DURATION',
  PaymentMethods = 'PAYMENT_METHODS',
  CancellationPolicy = 'CANCELLATION_POLICY',
  ServiceArea = 'SERVICE_AREA',
}

export enum TeamRole {
  Owner = 'OWNER',
  Staff = 'STAFF',
}

export interface TeamMember extends TenantEntity {
  name: string;
  role: TeamRole;
  active: boolean;
  serviceIds: string[];
}

export interface Contact extends TenantEntity {
  displayName: string;
  phone: string;
  email: string | null;
  address: string | null;
  notes: string[];
}

export enum LeadStatus {
  New = 'NEW',
  Active = 'ACTIVE',
  Qualified = 'QUALIFIED',
  Won = 'WON',
  Lost = 'LOST',
  Archived = 'ARCHIVED',
}

export interface Lead extends TenantEntity {
  contactId: string;
  conversationId: string;
  workflowType: WorkflowType;
  status: LeadStatus;
  serviceId: string | null;
  nextActionId: string | null;
  closedAt: string | null;
}

export enum ConversationChannel {
  WhatsApp = 'WHATSAPP_MOCK',
  Instagram = 'INSTAGRAM_MOCK',
  WebsiteForm = 'WEBSITE_FORM_MOCK',
  Manual = 'MANUAL',
}

export enum ConversationMode {
  AiActive = 'AI_ACTIVE',
  HumanActive = 'HUMAN_ACTIVE',
  Paused = 'PAUSED',
  Closed = 'CLOSED',
}

export enum ConversationState {
  NewInquiry = 'NEW_INQUIRY',
  Qualifying = 'QUALIFYING',
  ReadyToBook = 'READY_TO_BOOK',
  AppointmentScheduled = 'APPOINTMENT_SCHEDULED',
  QuoteInProgress = 'QUOTE_IN_PROGRESS',
  QuoteSent = 'QUOTE_SENT',
  JobScheduled = 'JOB_SCHEDULED',
  AwaitingPayment = 'AWAITING_PAYMENT',
  Complete = 'COMPLETE',
}

export enum ConversationIntent {
  AskBusinessInfo = 'ASK_BUSINESS_INFO',
  RequestAppointment = 'REQUEST_APPOINTMENT',
  RequestQuote = 'REQUEST_QUOTE',
  ProvideInformation = 'PROVIDE_INFORMATION',
  Complaint = 'COMPLAINT',
  Refund = 'REFUND',
  SensitiveQuestion = 'SENSITIVE_QUESTION',
  Unknown = 'UNKNOWN',
}

export interface Conversation extends TenantEntity {
  contactId: string;
  channel: ConversationChannel;
  ownerTeamMemberId: string | null;
  state: ConversationState;
  mode: ConversationMode;
  automationEnabled: boolean;
  lastCustomerMessageAt: string | null;
  lastBusinessResponseAt: string | null;
  currentIntent: ConversationIntent | null;
  missingInformation: string[];
  nextActionId: string | null;
  handoffId: string | null;
}

export enum MessageDirection {
  Inbound = 'INBOUND',
  Outbound = 'OUTBOUND',
}

export enum MessageAuthor {
  Customer = 'CUSTOMER',
  Business = 'BUSINESS',
  Assistant = 'ASSISTANT',
  System = 'SYSTEM',
}

export enum MessagePurpose {
  Operational = 'OPERATIONAL',
  Marketing = 'MARKETING',
}

export interface Message extends TenantEntity {
  conversationId: string;
  direction: MessageDirection;
  author: MessageAuthor;
  purpose: MessagePurpose;
  body: string;
  providerMessageId: string | null;
  sentAt: string;
}

export enum NextActionType {
  ReplyToCustomer = 'REPLY_TO_CUSTOMER',
  AnswerQuestion = 'ANSWER_QUESTION',
  CollectInformation = 'COLLECT_INFORMATION',
  RequestPhotos = 'REQUEST_PHOTOS',
  OfferAppointment = 'OFFER_APPOINTMENT',
  ConfirmAppointment = 'CONFIRM_APPOINTMENT',
  FollowUpQuote = 'FOLLOW_UP_QUOTE',
  RequestDeposit = 'REQUEST_DEPOSIT',
  ScheduleJob = 'SCHEDULE_JOB',
  CollectBalance = 'COLLECT_BALANCE',
  HumanReview = 'HUMAN_REVIEW',
  FutureReactivation = 'FUTURE_REACTIVATION',
}

export enum NextActionStatus {
  Pending = 'PENDING',
  Completed = 'COMPLETED',
  Cancelled = 'CANCELLED',
}

export interface NextAction extends TenantEntity {
  leadId: string;
  conversationId: string;
  type: NextActionType;
  status: NextActionStatus;
  reason: string;
  dueAt: string | null;
  automatic: boolean;
}

export enum ActivityType {
  LeadCreated = 'LEAD_CREATED',
  MessageReceived = 'MESSAGE_RECEIVED',
  MessageSent = 'MESSAGE_SENT',
  NextActionChanged = 'NEXT_ACTION_CHANGED',
  HandoffStarted = 'HANDOFF_STARTED',
  AssistantResumed = 'ASSISTANT_RESUMED',
  ConsentChanged = 'CONSENT_CHANGED',
  AppointmentChanged = 'APPOINTMENT_CHANGED',
  QuoteChanged = 'QUOTE_CHANGED',
  JobChanged = 'JOB_CHANGED',
  PaymentChanged = 'PAYMENT_CHANGED',
}

export interface Activity extends TenantEntity {
  contactId: string | null;
  conversationId: string | null;
  type: ActivityType;
  summary: string;
  metadata: Record<string, string | number | boolean | null>;
}

export interface Service extends TenantEntity {
  name: string;
  description: string;
  durationMinutes: number;
  fixedPriceCents: number | null;
  active: boolean;
  requiresDeposit: boolean;
}

export enum AppointmentStatus {
  Tentative = 'TENTATIVE',
  Confirmed = 'CONFIRMED',
  Cancelled = 'CANCELLED',
  Completed = 'COMPLETED',
  NoShow = 'NO_SHOW',
}

export interface Appointment extends TenantEntity {
  contactId: string;
  leadId: string;
  serviceId: string;
  staffId: string;
  startAt: string;
  endAt: string;
  status: AppointmentStatus;
  totalCents: number;
  depositRequiredCents: number;
  confirmedAt: string | null;
  completedAt: string | null;
}

export enum Weekday {
  Sunday = 0,
  Monday = 1,
  Tuesday = 2,
  Wednesday = 3,
  Thursday = 4,
  Friday = 5,
  Saturday = 6,
}

export interface AvailabilityRule extends TenantEntity {
  staffId: string;
  weekdays: Weekday[];
  startTime: string;
  endTime: string;
  slotIntervalMinutes: number;
}

export enum QuoteStatus {
  Draft = 'DRAFT',
  Sent = 'SENT',
  Viewed = 'VIEWED',
  ChangeRequested = 'CHANGE_REQUESTED',
  Accepted = 'ACCEPTED',
  Rejected = 'REJECTED',
  Expired = 'EXPIRED',
}

export interface QuoteItem {
  id: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
}

export interface Quote extends TenantEntity {
  contactId: string;
  leadId: string;
  items: QuoteItem[];
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  depositRequiredCents: number;
  totalCents: number;
  status: QuoteStatus;
  expiresAt: string | null;
  acceptedAt: string | null;
}

export enum JobStatus {
  PendingDeposit = 'PENDING_DEPOSIT',
  ReadyToSchedule = 'READY_TO_SCHEDULE',
  Scheduled = 'SCHEDULED',
  InProgress = 'IN_PROGRESS',
  Completed = 'COMPLETED',
  Cancelled = 'CANCELLED',
}

export interface Job extends TenantEntity {
  contactId: string;
  leadId: string;
  quoteId: string;
  address: string | null;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  assignedStaffId: string | null;
  status: JobStatus;
  totalCents: number;
  depositRequiredCents: number;
  completedAt: string | null;
}

export enum PaymentKind {
  Deposit = 'DEPOSIT',
  Balance = 'BALANCE',
  Refund = 'REFUND',
}

export enum PaymentStatus {
  Collected = 'COLLECTED',
  Failed = 'FAILED',
  Voided = 'VOIDED',
}

export enum PaymentReferenceType {
  Appointment = 'APPOINTMENT',
  Quote = 'QUOTE',
  Job = 'JOB',
}

export interface Payment extends TenantEntity {
  contactId: string;
  referenceType: PaymentReferenceType;
  referenceId: string;
  kind: PaymentKind;
  status: PaymentStatus;
  amountCents: number;
  idempotencyKey: string;
  originalPaymentId: string | null;
  collectedAt: string;
}

export interface ConsentRecord extends TenantEntity {
  contactId: string;
  marketingAllowed: boolean;
  operationalAllowed: boolean;
  optedOut: boolean;
  source: 'CUSTOMER_MESSAGE' | 'MANUAL' | 'IMPORT';
  changedAt: string;
}

export enum HandoffReason {
  SensitiveQuestion = 'SENSITIVE_QUESTION',
  LegalQuestion = 'LEGAL_QUESTION',
  Complaint = 'COMPLAINT',
  Refund = 'REFUND',
  UnusualDiscount = 'UNUSUAL_DISCOUNT',
  AggressiveOrConfused = 'AGGRESSIVE_OR_CONFUSED',
  LowConfidence = 'LOW_CONFIDENCE',
  UnsupportedKnowledge = 'UNSUPPORTED_KNOWLEDGE',
  Manual = 'MANUAL',
}

export interface HumanHandoff extends TenantEntity {
  conversationId: string;
  reason: HandoffReason;
  detail: string;
  startedAt: string;
  resolvedAt: string | null;
  startedBy: 'ASSISTANT' | 'HUMAN';
}

export enum RevenueStage {
  Potential = 'POTENTIAL',
  Booked = 'BOOKED',
  Completed = 'COMPLETED',
  Collected = 'COLLECTED',
  Refunded = 'REFUNDED',
}

export interface RevenueEvent extends TenantEntity {
  contactId: string;
  referenceType: PaymentReferenceType;
  referenceId: string;
  stage: RevenueStage;
  amountCents: number;
  causationId: string;
  correlationId: string;
  occurredAt: string;
}

export type EntityCollectionName =
  | 'businesses'
  | 'businessSettings'
  | 'businessKnowledge'
  | 'teamMembers'
  | 'contacts'
  | 'leads'
  | 'conversations'
  | 'messages'
  | 'nextActions'
  | 'activities'
  | 'services'
  | 'appointments'
  | 'availabilityRules'
  | 'quotes'
  | 'jobs'
  | 'payments'
  | 'consentRecords'
  | 'humanHandoffs'
  | 'revenueEvents';
