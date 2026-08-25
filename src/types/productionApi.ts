export interface ProductionTenantContract {
  tenantId: string;
  tenantName: string;
  role: 'owner' | 'admin' | 'member';
  active: boolean;
}

export interface ProductionCustomerContract {
  id: string;
  tenantId: string;
  displayName: string;
  phone: string;
  email: string | null;
  createdAt: string;
}

export interface ProductionJourneyCreationContract {
  idempotencyKey: string;
  customer: { displayName: string; phone: string; email: string | null };
  lead: {
    source: 'WHATSAPP' | 'INSTAGRAM' | 'WEBSITE_FORM' | 'EMAIL' | 'MANUAL' | 'IMPORT';
    workflowType: 'APPOINTMENT_SERVICE' | 'QUOTE_JOB';
    serviceId: string | null;
  };
  conversation: { channel: 'WHATSAPP' | 'INSTAGRAM' | 'WEBSITE_FORM' | 'EMAIL' | 'MANUAL' };
}

export interface ProductionJourneyResultContract {
  customerId: string;
  leadId: string;
  conversationId: string;
  replayed: boolean;
}

export interface ProductionCopilotExecutionContract {
  tool:
    | 'GET_HOT_LEADS'
    | 'GET_UNANSWERED_CONVERSATIONS'
    | 'GET_REVENUE_OVERVIEW'
    | 'GET_REACTIVATION_CANDIDATES'
    | 'PREPARE_REACTIVATION';
  arguments: Record<string, unknown>;
  approved: boolean;
  idempotencyKey: string;
}

export interface ProductionCopilotResultContract {
  auditId: string;
  status: 'executed' | 'replayed';
  result: Record<string, unknown>;
}

