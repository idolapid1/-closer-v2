import type {
  Business,
  BusinessKnowledge,
  BusinessSettings,
  Contact,
  Conversation,
  ConversationIntent,
  HandoffReason,
  Message,
  NextActionType,
  Service,
} from '../domain/entities';

export enum AssistantTool {
  GetBusinessInfo = 'GET_BUSINESS_INFO',
  GetServiceInfo = 'GET_SERVICE_INFO',
  GetServicePrice = 'GET_SERVICE_PRICE',
  GetCustomer = 'GET_CUSTOMER',
  GetConversationContext = 'GET_CONVERSATION_CONTEXT',
  RequestCustomerInformation = 'REQUEST_CUSTOMER_INFORMATION',
  RequestPhotos = 'REQUEST_PHOTOS',
  GetAvailableSlots = 'GET_AVAILABLE_SLOTS',
  SuggestAppointment = 'SUGGEST_APPOINTMENT',
  CreateQuoteDraft = 'CREATE_QUOTE_DRAFT',
  CreateNextAction = 'CREATE_NEXT_ACTION',
  HandoffToHuman = 'HANDOFF_TO_HUMAN',
}

export interface AssistantContext {
  business: Business;
  settings: BusinessSettings;
  knowledge: BusinessKnowledge;
  services: Service[];
  contact: Contact;
  conversation: Conversation;
  messages: Message[];
  latestCustomerMessage: Message;
}

export interface AssistantDecision {
  intent: ConversationIntent;
  confidence: number;
  missingInformation: string[];
  suggestedReply: string;
  suggestedNextAction: NextActionType;
  requestedTool: AssistantTool;
  requiresHumanReview: boolean;
  handoffReason: HandoffReason | null;
}
