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
  followUpCadenceHours: Partial<Record<FollowUpScenario, number[]>>;
  reactivationInactivityDays: number;
}

export interface KnowledgeFaq {
  question: string;
  answer: string;
}

export interface BusinessKnowledge extends TenantEntity {
  businessName: string;
  serviceDescriptions: Record<string, string>;
  fixedPricesCents: Record<string, number>;
  priceRangesCents: Record<string, { minCents: number; maxCents: number }>;
  pricingRules: string[];
  serviceDurationsMinutes: Record<string, number>;
  preparationInstructions: Record<string, string[]>;
  openingHours: string;
  address: string;
  serviceArea: string;
  serviceAreaLocations: string[];
  appointmentRules: string[];
  cancellationPolicy: string;
  depositPolicy: string;
  acceptedPaymentMethods: string[];
  faq: KnowledgeFaq[];
  toneOfVoice: string;
  allowedAutomaticAnswers: KnowledgeTopic[];
  answersRequiringHumanReview: string[];
  prohibitedAutonomousActions: string[];
  requiredQualificationFields: string[];
  serviceQualificationFields: Record<string, CustomerFactKey[]>;
  minimumAssistantConfidence: number;
}

export enum KnowledgeTopic {
  OpeningHours = 'OPENING_HOURS',
  Address = 'ADDRESS',
  ServiceDescription = 'SERVICE_DESCRIPTION',
  FixedPrice = 'FIXED_PRICE',
  PriceRange = 'PRICE_RANGE',
  ServiceDuration = 'SERVICE_DURATION',
  PreparationInstructions = 'PREPARATION_INSTRUCTIONS',
  PaymentMethods = 'PAYMENT_METHODS',
  CancellationPolicy = 'CANCELLATION_POLICY',
  DepositPolicy = 'DEPOSIT_POLICY',
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

export enum LeadSource {
  WhatsApp = 'WHATSAPP',
  Instagram = 'INSTAGRAM',
  WebsiteForm = 'WEBSITE_FORM',
  Email = 'EMAIL',
  Manual = 'MANUAL',
  Import = 'IMPORT',
}

export enum LeadPriority {
  Normal = 'NORMAL',
  High = 'HIGH',
  Urgent = 'URGENT',
}

export enum SalesObjection {
  Price = 'PRICE',
  Timing = 'TIMING',
  Trust = 'TRUST',
  ServiceFit = 'SERVICE_FIT',
  Competitor = 'COMPETITOR',
  Other = 'OTHER',
}

export interface Lead extends TenantEntity {
  contactId: string;
  conversationId: string;
  workflowType: WorkflowType;
  status: LeadStatus;
  serviceId: string | null;
  nextActionId: string | null;
  closedAt: string | null;
  lostReason: OpportunityLostReason | null;
  source: LeadSource;
  sourceReferenceId: string | null;
  priority: LeadPriority;
  objections: SalesObjection[];
}

export enum OpportunityLostReason {
  CustomerDeclined = 'CUSTOMER_DECLINED',
  Cancelled = 'CANCELLED',
  OutsideServiceArea = 'OUTSIDE_SERVICE_AREA',
  NoLongerInterested = 'NO_LONGER_INTERESTED',
  QuoteExpired = 'QUOTE_EXPIRED',
  Unavailable = 'UNAVAILABLE',
}

export enum ConversationChannel {
  WhatsApp = 'WHATSAPP_MOCK',
  Instagram = 'INSTAGRAM_MOCK',
  WebsiteForm = 'WEBSITE_FORM_MOCK',
  Email = 'EMAIL_MOCK',
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

export enum ConversationStage {
  NewInquiry = 'NEW_INQUIRY',
  Discovery = 'DISCOVERY',
  Qualification = 'QUALIFICATION',
  InformationCollection = 'INFORMATION_COLLECTION',
  ReadyToBook = 'READY_TO_BOOK',
  AppointmentProposed = 'APPOINTMENT_PROPOSED',
  AwaitingConfirmation = 'AWAITING_CONFIRMATION',
  ReadyForQuote = 'READY_FOR_QUOTE',
  QuotePreparation = 'QUOTE_PREPARATION',
  QuoteSent = 'QUOTE_SENT',
  AwaitingDeposit = 'AWAITING_DEPOSIT',
  Booked = 'BOOKED',
  JobScheduled = 'JOB_SCHEDULED',
  ServiceComplete = 'SERVICE_COMPLETE',
  AwaitingBalance = 'AWAITING_BALANCE',
  ClosedWon = 'CLOSED_WON',
  ClosedLost = 'CLOSED_LOST',
  HumanReview = 'HUMAN_REVIEW',
}

export enum ConversationIntent {
  AskBusinessInfo = 'ASK_BUSINESS_INFO',
  PriceQuestion = 'PRICE_QUESTION',
  ServiceInfo = 'SERVICE_INFO',
  AvailabilityRequest = 'AVAILABILITY_REQUEST',
  RequestAppointment = 'REQUEST_APPOINTMENT',
  RequestQuote = 'REQUEST_QUOTE',
  PaymentQuestion = 'PAYMENT_QUESTION',
  RescheduleRequest = 'RESCHEDULE_REQUEST',
  CancellationRequest = 'CANCELLATION_REQUEST',
  ProvideInformation = 'PROVIDE_INFORMATION',
  Complaint = 'COMPLAINT',
  Refund = 'REFUND',
  SensitiveQuestion = 'SENSITIVE_QUESTION',
  OptOut = 'OPT_OUT',
  HumanRequested = 'HUMAN_REQUESTED',
  UnsupportedRequest = 'UNSUPPORTED_REQUEST',
  Unknown = 'UNKNOWN',
}

export interface Conversation extends TenantEntity {
  contactId: string;
  channel: ConversationChannel;
  ownerTeamMemberId: string | null;
  state: ConversationState;
  inferredStage: ConversationStage;
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
  FollowUpCustomer = 'FOLLOW_UP_CUSTOMER',
  PrepareQuote = 'PREPARE_QUOTE',
  VerifyServiceArea = 'VERIFY_SERVICE_AREA',
  ReviewPaymentClaim = 'REVIEW_PAYMENT_CLAIM',
  RequestDeposit = 'REQUEST_DEPOSIT',
  ScheduleJob = 'SCHEDULE_JOB',
  CollectBalance = 'COLLECT_BALANCE',
  HumanReview = 'HUMAN_REVIEW',
  FutureReactivation = 'FUTURE_REACTIVATION',
  SendQuote = 'SEND_QUOTE',
  ServiceScheduled = 'SERVICE_SCHEDULED',
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
  MemoryChanged = 'MEMORY_CHANGED',
  FollowUpScheduled = 'FOLLOW_UP_SCHEDULED',
  FollowUpCancelled = 'FOLLOW_UP_CANCELLED',
  AssistantToolRequested = 'ASSISTANT_TOOL_REQUESTED',
  AppointmentCreated = 'APPOINTMENT_CREATED',
  AppointmentRescheduled = 'APPOINTMENT_RESCHEDULED',
  AppointmentConfirmed = 'APPOINTMENT_CONFIRMED',
  AppointmentCompleted = 'APPOINTMENT_COMPLETED',
  AppointmentCancelled = 'APPOINTMENT_CANCELLED',
  QuoteCreated = 'QUOTE_CREATED',
  QuoteSent = 'QUOTE_SENT',
  QuoteAccepted = 'QUOTE_ACCEPTED',
  QuoteDeclined = 'QUOTE_DECLINED',
  QuoteExpired = 'QUOTE_EXPIRED',
  JobCreated = 'JOB_CREATED',
  JobScheduled = 'JOB_SCHEDULED',
  JobRescheduled = 'JOB_RESCHEDULED',
  JobCompleted = 'JOB_COMPLETED',
  JobCancelled = 'JOB_CANCELLED',
  DepositCollected = 'DEPOSIT_COLLECTED',
  BalanceCollected = 'BALANCE_COLLECTED',
  RefundRecorded = 'REFUND_RECORDED',
  OpportunityWon = 'OPPORTUNITY_WON',
  OpportunityLost = 'OPPORTUNITY_LOST',
  OpportunityReopened = 'OPPORTUNITY_REOPENED',
  RevenueAttributionVerified = 'REVENUE_ATTRIBUTION_VERIFIED',
  ReactivationPrepared = 'REACTIVATION_PREPARED',
  OwnerToolExecuted = 'OWNER_TOOL_EXECUTED',
}

export interface Activity extends TenantEntity {
  contactId: string | null;
  conversationId: string | null;
  type: ActivityType;
  summary: string;
  metadata: Record<string, string | number | boolean | null>;
  occurredAt: string;
  operationKey: string | null;
}

export interface Service extends TenantEntity {
  name: string;
  description: string;
  durationMinutes: number;
  fixedPriceCents: number | null;
  active: boolean;
  requiresDeposit: boolean;
  workflowType: WorkflowType;
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
  operationKey: string;
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
  operationKey: string;
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
  operationKey: string;
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
  HumanRequested = 'HUMAN_REQUESTED',
  ConflictingInformation = 'CONFLICTING_INFORMATION',
  SafetyConcern = 'SAFETY_CONCERN',
  Manual = 'MANUAL',
}

export interface HumanHandoff extends TenantEntity {
  conversationId: string;
  reason: HandoffReason;
  detail: string;
  startedAt: string;
  resolvedAt: string | null;
  startedBy: 'ASSISTANT' | 'HUMAN';
  triggeringMessageId: string | null;
  confidence: number | null;
  responsibleState: ConversationStage;
}

export enum CustomerFactKey {
  RequestedService = 'REQUESTED_SERVICE',
  CustomerType = 'CUSTOMER_TYPE',
  PreferredDate = 'PREFERRED_DATE',
  PreferredTime = 'PREFERRED_TIME',
  TreatmentPreference = 'TREATMENT_PREFERENCE',
  VehicleMake = 'VEHICLE_MAKE',
  VehicleModel = 'VEHICLE_MODEL',
  VehicleYear = 'VEHICLE_YEAR',
  VehicleCondition = 'VEHICLE_CONDITION',
  PhotosReceived = 'PHOTOS_RECEIVED',
  RequestedJob = 'REQUESTED_JOB',
  Location = 'LOCATION',
  Address = 'ADDRESS',
  JobDetails = 'JOB_DETAILS',
  Urgency = 'URGENCY',
  AccessConsiderations = 'ACCESS_CONSIDERATIONS',
  SpecialRequirements = 'SPECIAL_REQUIREMENTS',
}

export type CustomerFactValue = string | number | boolean;

export enum MemorySource {
  CustomerMessage = 'CUSTOMER_MESSAGE',
  Manual = 'MANUAL',
  DomainState = 'DOMAIN_STATE',
}

export interface CustomerMemoryItem extends TenantEntity {
  contactId: string;
  key: CustomerFactKey;
  value: CustomerFactValue;
  source: MemorySource;
  sourceMessageId: string | null;
}

export enum FollowUpScenario {
  PriceInquiry = 'PRICE_INQUIRY',
  BookingConfirmation = 'BOOKING_CONFIRMATION',
  MissingInformation = 'MISSING_INFORMATION',
  QuoteResponse = 'QUOTE_RESPONSE',
  DepositRequest = 'DEPOSIT_REQUEST',
  OutstandingBalance = 'OUTSTANDING_BALANCE',
  Reactivation = 'REACTIVATION',
}

export enum FollowUpStatus {
  Scheduled = 'SCHEDULED',
  Completed = 'COMPLETED',
  Cancelled = 'CANCELLED',
}

export enum FollowUpChannel {
  WhatsApp = 'WHATSAPP',
  Instagram = 'INSTAGRAM',
  Email = 'EMAIL',
  Manual = 'MANUAL',
}

export enum FollowUpOwner {
  Assistant = 'ASSISTANT',
  Human = 'HUMAN',
}

export enum FollowUpResult {
  Pending = 'PENDING',
  Sent = 'SENT',
  ResponseReceived = 'RESPONSE_RECEIVED',
  Stopped = 'STOPPED',
  Failed = 'FAILED',
}

export enum FollowUpStopReason {
  CustomerReplied = 'CUSTOMER_REPLIED',
  HumanTakeover = 'HUMAN_TAKEOVER',
  OpportunityClosed = 'OPPORTUNITY_CLOSED',
  ConsentBlocked = 'CONSENT_BLOCKED',
  ManualOverride = 'MANUAL_OVERRIDE',
  StateChanged = 'STATE_CHANGED',
}

export interface FollowUpAttempt {
  operationKey: string;
  result: FollowUpResult.Sent | FollowUpResult.Failed;
  attemptedAt: string;
}

export interface ScheduledFollowUp extends TenantEntity {
  contactId: string;
  conversationId: string;
  scenario: FollowUpScenario;
  status: FollowUpStatus;
  purpose: MessagePurpose;
  dueAt: string;
  idempotencyKey: string;
  triggeringMessageId: string | null;
  reason: string;
  sequenceKey: string;
  sequenceStep: number;
  channel: FollowUpChannel;
  attemptCount: number;
  attempts: FollowUpAttempt[];
  nextAttemptAt: string | null;
  lastAttemptAt: string | null;
  lastResponseAt: string | null;
  stopReason: FollowUpStopReason | null;
  manualOverride: boolean;
  owner: FollowUpOwner;
  ownerTeamMemberId: string | null;
  draftMessage: string | null;
  result: FollowUpResult;
}

export enum RevenueStage {
  Potential = 'POTENTIAL',
  Booked = 'BOOKED',
  Completed = 'COMPLETED',
  Collected = 'COLLECTED',
  Refunded = 'REFUNDED',
}

export enum RevenueAttributionKind {
  Generated = 'GENERATED',
  Recovered = 'RECOVERED',
  Protected = 'PROTECTED',
  Reactivated = 'REACTIVATED',
}

export enum RevenueAttributionStatus {
  Unattributed = 'UNATTRIBUTED',
  Candidate = 'CANDIDATE',
  Verified = 'VERIFIED',
  Rejected = 'REJECTED',
}

export interface RevenueEvent extends TenantEntity {
  contactId: string;
  leadId: string;
  conversationId: string;
  leadSource: LeadSource;
  referenceType: PaymentReferenceType;
  referenceId: string;
  stage: RevenueStage;
  amountCents: number;
  causationId: string;
  correlationId: string;
  attributionStatus: RevenueAttributionStatus;
  attributionKind: RevenueAttributionKind | null;
  contributingActivityIds: string[];
  attributionOperationKey: string | null;
  attributedAt: string | null;
  attributedByTeamMemberId: string | null;
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
  | 'revenueEvents'
  | 'customerMemory'
  | 'scheduledFollowUps'
  | 'assistantDecisionRecords';
