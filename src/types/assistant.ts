import type {
  Appointment,
  Business,
  BusinessKnowledge,
  BusinessSettings,
  Contact,
  Conversation,
  ConversationIntent,
  ConversationStage,
  CustomerFactKey,
  CustomerFactValue,
  CustomerMemoryItem,
  HandoffReason,
  Job,
  Lead,
  Message,
  NextActionType,
  Payment,
  Quote,
  Service,
  TeamMember,
  TenantEntity,
} from '../domain/entities';

export enum AssistantTool {
  GetBusinessInfo = 'GET_BUSINESS_INFO',
  GetServiceInfo = 'GET_SERVICE_INFO',
  GetServicePrice = 'GET_SERVICE_PRICE',
  GetCustomerContext = 'GET_CUSTOMER_CONTEXT',
  GetConversationContext = 'GET_CONVERSATION_CONTEXT',
  RequestCustomerInformation = 'REQUEST_CUSTOMER_INFORMATION',
  RequestPhotos = 'REQUEST_PHOTOS',
  GetAvailableSlots = 'GET_AVAILABLE_SLOTS',
  SuggestAppointment = 'SUGGEST_APPOINTMENT',
  CreateQuoteDraft = 'CREATE_QUOTE_DRAFT',
  CreateNextAction = 'CREATE_NEXT_ACTION',
  HandoffToHuman = 'HANDOFF_TO_HUMAN',
}

export enum AutonomyLevel {
  SafeInformation = 1,
  InformationCollection = 2,
  BusinessActionProposal = 3,
  HumanHandoff = 4,
}

export enum AssistantRiskLevel {
  Low = 'LOW',
  Medium = 'MEDIUM',
  High = 'HIGH',
  Critical = 'CRITICAL',
}

export enum CustomerGoal {
  LearnAboutBusiness = 'LEARN_ABOUT_BUSINESS',
  UnderstandService = 'UNDERSTAND_SERVICE',
  GetPrice = 'GET_PRICE',
  BookAppointment = 'BOOK_APPOINTMENT',
  GetQuote = 'GET_QUOTE',
  ChangeBooking = 'CHANGE_BOOKING',
  CancelBooking = 'CANCEL_BOOKING',
  ResolvePayment = 'RESOLVE_PAYMENT',
  ResolveProblem = 'RESOLVE_PROBLEM',
  SpeakToHuman = 'SPEAK_TO_HUMAN',
  StopMessages = 'STOP_MESSAGES',
  Unknown = 'UNKNOWN',
}

export enum InternalReasonCode {
  PriceQuestion = 'PRICE_QUESTION',
  ServiceInfo = 'SERVICE_INFO',
  AvailabilityRequest = 'AVAILABILITY_REQUEST',
  BookingIntent = 'BOOKING_INTENT',
  QuoteRequest = 'QUOTE_REQUEST',
  PaymentQuestion = 'PAYMENT_QUESTION',
  RescheduleRequest = 'RESCHEDULE_REQUEST',
  CancellationRequest = 'CANCELLATION_REQUEST',
  Complaint = 'COMPLAINT',
  RefundRequest = 'REFUND_REQUEST',
  MedicalOrSensitive = 'MEDICAL_OR_SENSITIVE',
  UnsupportedRequest = 'UNSUPPORTED_REQUEST',
  UnsupportedPricing = 'UNSUPPORTED_PRICING',
  UnsupportedPolicy = 'UNSUPPORTED_POLICY',
  LowConfidence = 'LOW_CONFIDENCE',
  CustomerConfused = 'CUSTOMER_CONFUSED',
  CustomerAggressive = 'CUSTOMER_AGGRESSIVE',
  OptOut = 'OPT_OUT',
  HumanRequested = 'HUMAN_REQUESTED',
  MissingRequiredInformation = 'MISSING_REQUIRED_INFORMATION',
  InformationComplete = 'INFORMATION_COMPLETE',
  OutsideServiceArea = 'OUTSIDE_SERVICE_AREA',
  ConflictingInformation = 'CONFLICTING_INFORMATION',
  PromptInjection = 'PROMPT_INJECTION',
  PaymentClaimUnverified = 'PAYMENT_CLAIM_UNVERIFIED',
}

export interface KnownFact {
  key: CustomerFactKey;
  value: CustomerFactValue;
  source: CustomerMemoryItem['source'];
}

export interface MemoryConflict {
  key: CustomerFactKey;
  existingValue: CustomerFactValue;
  proposedValue: CustomerFactValue;
}

export type AssistantToolArgument = string | number | boolean | string[] | null;

export interface ConversationDecision {
  detectedIntent: ConversationIntent;
  /** Compatibility alias for Phase 1 consumers. */
  intent: ConversationIntent;
  secondaryIntents: ConversationIntent[];
  confidence: number;
  conversationStage: ConversationStage;
  customerGoal: CustomerGoal;
  knownFacts: KnownFact[];
  missingInformation: CustomerFactKey[];
  suggestedReply: string;
  suggestedNextAction: NextActionType;
  requestedTool: AssistantTool;
  toolArguments: Record<string, AssistantToolArgument>;
  requiresHumanReview: boolean;
  handoffReason: HandoffReason | null;
  riskLevel: AssistantRiskLevel;
  knowledgeSourcesUsed: string[];
  shouldFollowUp: boolean;
  recommendedFollowUpAt: string | null;
  internalReasonCode: InternalReasonCode;
  autonomyLevel: AutonomyLevel;
}

export type AssistantDecision = ConversationDecision;

export interface AssistantContext {
  business: Business;
  settings: BusinessSettings;
  knowledge: BusinessKnowledge;
  services: Service[];
  teamMembers: TeamMember[];
  contact: Contact;
  lead: Lead;
  conversation: Conversation;
  messages: Message[];
  latestCustomerMessage: Message;
  memory: CustomerMemoryItem[];
  memoryConflicts: MemoryConflict[];
  appointments: Appointment[];
  quotes: Quote[];
  jobs: Job[];
  payments: Payment[];
  inferredStage: ConversationStage;
}

export enum ToolExecutionStatus {
  Completed = 'COMPLETED',
  Proposed = 'PROPOSED',
  Blocked = 'BLOCKED',
  RequiresValidation = 'REQUIRES_VALIDATION',
}

export interface ToolExecutionResult {
  tool: AssistantTool;
  status: ToolExecutionStatus;
  summary: string;
  data: Record<string, AssistantToolArgument>;
}

export interface ConversationDecisionRecord extends TenantEntity {
  contactId: string;
  conversationId: string;
  triggeringMessageId: string;
  decision: ConversationDecision;
  toolResult: ToolExecutionResult;
}
