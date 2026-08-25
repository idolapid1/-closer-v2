import type { LeadSource } from '../../domain/entities';

export interface InboundLeadEvent {
  businessId: string;
  source: LeadSource;
  providerEventId: string;
  externalConversationId: string;
  occurredAt: string;
  customer: {
    displayName: string;
    phone?: string;
    email?: string;
  };
  message: string;
}

export interface LeadConnector {
  readonly source: LeadSource;
  readonly mode: 'MOCK' | 'PRODUCTION_DISABLED';
  normalize(payload: unknown): InboundLeadEvent;
}

export class DeterministicMockLeadConnector implements LeadConnector {
  readonly mode = 'MOCK' as const;

  constructor(readonly source: LeadSource) {}

  normalize(payload: unknown): InboundLeadEvent {
    if (!isInboundLeadEvent(payload) || payload.source !== this.source) {
      throw new Error(`Invalid deterministic ${this.source} fixture`);
    }
    return structuredClone(payload);
  }
}

export class DisabledProductionLeadConnector implements LeadConnector {
  readonly mode = 'PRODUCTION_DISABLED' as const;

  constructor(readonly source: LeadSource) {}

  normalize(payload?: unknown): never {
    void payload;
    throw new Error(
      `${this.source} production connector is disabled until server-side credentials and webhook verification are configured`,
    );
  }
}

function isInboundLeadEvent(value: unknown): value is InboundLeadEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Record<string, unknown>;
  const customer = event.customer as Record<string, unknown> | undefined;
  return (
    typeof event.businessId === 'string' &&
    event.businessId !== '' &&
    typeof event.source === 'string' &&
    typeof event.providerEventId === 'string' &&
    event.providerEventId !== '' &&
    typeof event.externalConversationId === 'string' &&
    event.externalConversationId !== '' &&
    typeof event.occurredAt === 'string' &&
    !Number.isNaN(new Date(event.occurredAt).getTime()) &&
    typeof event.message === 'string' &&
    event.message.trim() !== '' &&
    Boolean(customer) &&
    typeof customer?.displayName === 'string' &&
    customer.displayName.trim() !== '' &&
    (customer.phone === undefined || typeof customer.phone === 'string') &&
    (customer.email === undefined || typeof customer.email === 'string')
  );
}
