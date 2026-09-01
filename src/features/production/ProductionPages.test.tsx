import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductionApiClient } from '../../infrastructure/api/ProductionApiClient';
import type { AuthClient, AuthSession } from '../../infrastructure/auth/AuthClient';
import { AuthProvider } from '../../state/AuthContext';
import { ProductionOwnerProvider } from '../../state/ProductionOwnerContext';
import {
  ProductionCustomerPage,
  ProductionOpportunitiesPage,
  ProductionOpportunityPage,
  ProductionRecoveryPage,
  ProductionRevenuePage,
  ProductionTodayPage,
} from './ProductionPages';
import type { ProductionOpportunityContract, ProductionOwnerSnapshotContract } from '../../types/productionApi';

const SESSION: AuthSession = { accessToken: 'token', expiresAt: null, user: { id: 'owner-a', email: 'owner@example.test' } };
const CUSTOMER = { id: 'customer-a', tenantId: 'tenant-a', displayName: 'מאיה לוי', phone: '+972501234567', email: null, createdAt: '2026-08-25T09:00:00.000Z' };
const CONVERSATION = { id: 'conversation-a', tenantId: 'tenant-a', customerId: 'customer-a', leadId: 'lead-a', channel: 'WHATSAPP', mode: 'HUMAN_ACTIVE' as const, stage: 'HUMAN_REVIEW', lastCustomerMessageAt: null, lastBusinessResponseAt: null, createdAt: '2026-08-25T09:00:00.000Z', updatedAt: '2026-08-25T09:00:00.000Z' };
const REVENUE = { potentialCents: 0, pipelineCents: 0, bookedCents: 0, collectedCents: 25_000, refundedCents: 5_000, recoveredCents: 0 };

beforeEach(() => window.sessionStorage.clear());

describe('production owner pages', () => {
  it('prioritizes Human Takeover before a scheduled follow-up on Today', async () => {
    const snapshot = {
      customers: [CUSTOMER],
      conversations: [CONVERSATION],
      followUps: [followUp()],
      activeHandoffs: [{ id: 'handoff-a', tenantId: 'tenant-a', conversationId: 'conversation-a', reason: 'MANUAL', detail: 'Owner required', startedAt: '2026-08-25T09:00:00.000Z', resolvedAt: null }],
      revenue: REVENUE,
    };
    renderProduction(<ProductionTodayPage />, '/actions', apiFetch(snapshot));
    const list = await screen.findByRole('list');
    const items = within(list).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('השיחה דורשת טיפול אנושי');
    expect(within(screen.getByLabelText('אמת כספית')).getByText((text) => text.includes('250'))).toBeInTheDocument();
  });

  it('creates a durable follow-up from the authenticated customer workspace', async () => {
    let scheduled = false;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/v1/tenants')) return tenants();
      if (url.includes('/owner-snapshot')) return response({ snapshot: baseSnapshot() });
      if (url.includes('/follow-ups') && init?.method === 'POST') {
        scheduled = true;
        return response({ followUp: followUp(), replayed: false });
      }
      if (url.includes('/customers/customer-a')) {
        return response({ workspace: workspace(scheduled ? [followUp()] : []) });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    renderProduction(
      <Routes><Route path="customer/:id" element={<ProductionCustomerPage />} /></Routes>,
      '/customer/customer-a',
      fetchMock,
    );
    await screen.findByRole('heading', { name: 'מאיה לוי' });
    await userEvent.click(screen.getByRole('button', { name: 'קבע מעקב למחר' }));
    expect((await screen.findAllByText('Follow up')).length).toBeGreaterThanOrEqual(1);
    expect(fetchMock.mock.calls.some(([input, init]) => String(input).includes('/follow-ups') && init?.method === 'POST')).toBe(true);
  });

  it('renders the Revenue Command Center from server-calculated opportunity truth', async () => {
    const opportunity = hvacOpportunity();
    renderProduction(<ProductionRevenuePage />, '/revenue', revenueFetch([opportunity]));
    expect(await screen.findByRole('heading', { name: 'הכנסה שאפשר להחזיר' })).toBeInTheDocument();
    expect(screen.getAllByText('$9,400')).toHaveLength(2);
    expect(screen.getByText('נדרש טיפול אנושי')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /בדיקה אישית/ })).toHaveAttribute('href', '/opportunity/opportunity-a');
  });

  it('filters opportunities without collapsing multiple commercial needs into the customer record', async () => {
    const second = { ...hvacOpportunity(), id: 'opportunity-b', opportunityType: 'MAINTENANCE' as const, recoveryState: 'WAITING_FOR_CUSTOMER' as const };
    renderProduction(<ProductionOpportunitiesPage />, '/opportunities', revenueFetch([hvacOpportunity(), second]));
    expect(await screen.findByText('תיקון חירום · שיחה שלא נענתה')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('searchbox', { name: 'חיפוש הזדמנויות' }), 'MAINTENANCE');
    expect(screen.queryByText('תיקון חירום · שיחה שלא נענתה')).not.toBeInTheDocument();
    expect(screen.getByText('תחזוקה · שיחה שלא נענתה')).toBeInTheDocument();
  });

  it('keeps Human Takeover and append-only revenue evidence visible on opportunity detail', async () => {
    renderProduction(
      <Routes><Route path="opportunity/:id" element={<ProductionOpportunityPage />} /></Routes>,
      '/opportunity/opportunity-a',
      revenueFetch([hvacOpportunity()], true),
    );
    expect(await screen.findByText('נדרשת החלטה אנושית')).toBeInTheDocument();
    expect(screen.getAllByText('בעל העסק צריך לבדוק את הבקשה')).toHaveLength(2);
    expect(screen.getByText('PAYMENT_RECEIVED · RECOVERED')).toBeInTheDocument();
    expect(screen.getAllByText('שיחה שלא נענתה')).toHaveLength(2);
    expect(screen.getByText('SUGGEST')).toBeInTheDocument();
    expect(screen.getByText('פעולה מתוזמנת')).toBeInTheDocument();
  });

  it('shows the four bounded recovery plays and states that live delivery is disabled', async () => {
    renderProduction(<ProductionRecoveryPage />, '/recovery', revenueFetch([hvacOpportunity()]));
    expect(await screen.findByRole('heading', { name: 'Missed Call Recovery' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'New Lead Recovery' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Unsold Estimate Recovery' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Old Lead Reactivation' })).toBeInTheDocument();
    expect(screen.getByText(/שליחה חיה עדיין כבויה/)).toBeInTheDocument();
  });
});

function renderProduction(children: ReactNode, route: string, fetchMock: typeof fetch) {
  const auth = authClient();
  const api = new ProductionApiClient('https://api.example.test', auth, fetchMock);
  return render(<AuthProvider client={auth}><ProductionOwnerProvider api={api}><MemoryRouter initialEntries={[route]}>{children}</MemoryRouter></ProductionOwnerProvider></AuthProvider>);
}

function authClient(): AuthClient {
  return { getSession: async () => SESSION, getAccessToken: async () => SESSION.accessToken, refreshAccessToken: async () => SESSION.accessToken, signIn: async () => SESSION, signUp: async () => ({ session: SESSION, confirmationRequired: false }), signOut: async () => undefined, subscribe: () => () => undefined };
}

function apiFetch(snapshot: ProductionOwnerSnapshotContract): typeof fetch {
  return vi.fn<typeof fetch>(async (input) => String(input).endsWith('/api/v1/tenants') ? tenants() : response({ snapshot }));
}

function tenants(): Response {
  return response({ tenants: [{ tenantId: 'tenant-a', tenantName: 'Alpha', role: 'owner', active: true }] });
}

function baseSnapshot(): ProductionOwnerSnapshotContract {
  return { customers: [CUSTOMER], conversations: [CONVERSATION], followUps: [], activeHandoffs: [], revenue: REVENUE };
}

function workspace(followUps: ReturnType<typeof followUp>[]) {
  return { customer: CUSTOMER, opportunities: [], lead: { id: 'lead-a', tenantId: 'tenant-a', customerId: 'customer-a', conversationId: 'conversation-a', serviceId: null, source: 'MANUAL', workflowType: 'APPOINTMENT_SERVICE', salesState: 'new', status: 'NEW', priority: 'NORMAL', createdAt: CONVERSATION.createdAt, updatedAt: CONVERSATION.updatedAt }, conversation: { ...CONVERSATION, mode: 'AI_ACTIVE' as const, stage: 'NEW_INQUIRY' }, followUps, activeHandoff: null, payments: [] };
}

function hvacOpportunity(): ProductionOpportunityContract {
  const score = (value: number, explanation: string) => ({ value, reasonCodes: ['MISSED_CALL'], explanation, version: 'hvac-rules-v1' });
  return {
    id: 'opportunity-a', tenantId: 'tenant-a', customerId: 'customer-a', leadId: 'lead-a', conversationId: 'conversation-a',
    source: 'MISSED_CALL', opportunityType: 'EMERGENCY_REPAIR', estimatedValueCents: 940_000, currency: 'USD',
    scores: { intent: score(85, 'בקשת שירות מפורשת'), revenue: score(92, 'ערך מאומת'), recovery: score(90, 'שיחה שלא נענתה'), urgency: score(95, 'תיקון חירום') },
    status: 'NEW', recoveryState: 'HUMAN_REQUIRED', autonomyLevel: 'SUGGEST', assignedHumanId: 'owner-a',
    lastCustomerActivityAt: null, lastBusinessActivityAt: null, nextActionAt: '2026-08-25T09:00:00.000Z', bookingId: null,
    estimateId: null, jobId: null, wonAt: null, lostAt: null, lostReason: null, revenueAttributedCents: 25_000,
    attributionType: 'RECOVERED', attributionReason: 'VALIDATED_PAYMENT_AFTER_RECOVERY', createdAt: '2026-08-25T09:00:00.000Z', updatedAt: '2026-08-25T09:00:00.000Z',
  };
}

function revenueFetch(opportunities: ProductionOpportunityContract[], includeDetail = false): typeof fetch {
  return vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url.endsWith('/api/v1/tenants')) return tenants();
    if (url.includes('/owner-snapshot')) return response({ snapshot: baseSnapshot() });
    if (includeDetail && url.endsWith('/opportunities/opportunity-a')) return response({
      opportunity: opportunities[0],
      recoveryDecisions: [{
        id: 'decision-a', tenantId: 'tenant-a', opportunityId: 'opportunity-a', playType: null, eligible: false,
        suppressionReason: 'HUMAN_TAKEOVER', scores: opportunities[0]!.scores,
        nextBestAction: { kind: 'REQUEST_HUMAN', reasonCode: 'HUMAN_REQUIRED', label: 'בעל העסק צריך לבדוק את הבקשה', channel: 'MANUAL', requiresApproval: true, dueAt: null },
        policyVersion: 'hvac-recovery-v1', idempotencyKey: 'decision-a', decidedAt: '2026-08-25T09:00:00.000Z', executedAt: null, executionState: 'SUPPRESSED',
      }],
      recoveryActions: [{
        id: 'action-a', tenantId: 'tenant-a', opportunityId: 'opportunity-a', decisionId: 'decision-a',
        actionKind: 'REQUEST_HUMAN', channel: 'MANUAL', status: 'HUMAN_REQUIRED', requiresApproval: false,
        requestedBy: 'POLICY', idempotencyKey: 'decision-a:action', validUntil: null, approvedByUserId: null,
        approvedAt: null, startedAt: null, completedAt: null, cancelledAt: null, lastError: null,
        deliveryState: 'LIVE_DISABLED', createdAt: '2026-08-25T09:00:00.000Z', updatedAt: '2026-08-25T09:00:00.000Z',
      }],
      revenueEvents: [{ id: 'event-a', tenantId: 'tenant-a', customerId: 'customer-a', leadId: 'lead-a', conversationId: 'conversation-a', paymentId: 'payment-a', stage: 'collected', amountCents: 25_000, causationKey: 'payment-a', occurredAt: '2026-08-25T09:00:00.000Z', opportunityId: 'opportunity-a', eventType: 'PAYMENT_RECEIVED', attributionType: 'RECOVERED', attributionReason: 'VALIDATED_PAYMENT_AFTER_RECOVERY' }],
      customer: CUSTOMER,
      conversation: CONVERSATION,
      booking: null,
      estimate: null,
      job: null,
      activeHandoff: { id: 'handoff-a', tenantId: 'tenant-a', conversationId: 'conversation-a', reason: 'MANUAL', detail: 'Owner required', startedAt: '2026-08-25T09:00:00.000Z', resolvedAt: null },
    });
    if (url.includes('/opportunities?')) return response({ opportunities });
    if (url.endsWith('/revenue-command-center')) return response({ commandCenter: {
      potentialRecoveredRevenueCents: 0, actualRecoveredRevenueCents: 25_000, influencedRevenueCents: 25_000,
      revenueAtRiskCents: 940_000, recoveredJobs: 0, recoveredBookings: 0, activeOpportunities: opportunities.length,
      humanInterventionRequired: 1, averageRecoveryTimeHours: null, opportunitiesAtRisk: opportunities,
    } });
    throw new Error(`Unexpected request: ${url}`);
  });
}

function followUp() {
  return { id: 'follow-up-a', tenantId: 'tenant-a', conversationId: 'conversation-a', customerId: 'customer-a', channel: 'WHATSAPP', reason: 'Follow up', status: 'scheduled' as const, dueAt: '2026-08-26T09:00:00.000Z', attemptCount: 0, maxAttempts: 5, leaseOwner: null, leaseExpiresAt: null, retryAt: null, lastError: null, stopReason: null, manualOverride: false, lastResponseAt: null, completedAt: null, cancelledAt: null, idempotencyKey: 'follow-up-a', draftMessage: null, createdAt: '2026-08-25T09:00:00.000Z' };
}

function response(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
