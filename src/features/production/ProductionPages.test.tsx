import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductionApiClient } from '../../infrastructure/api/ProductionApiClient';
import type { AuthClient, AuthSession } from '../../infrastructure/auth/AuthClient';
import { AuthProvider } from '../../state/AuthContext';
import { ProductionOwnerProvider } from '../../state/ProductionOwnerContext';
import { ProductionCustomerPage, ProductionTodayPage } from './ProductionPages';
import type { ProductionOwnerSnapshotContract } from '../../types/productionApi';

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
  return { customer: CUSTOMER, lead: { id: 'lead-a', tenantId: 'tenant-a', customerId: 'customer-a', conversationId: 'conversation-a', serviceId: null, source: 'MANUAL', workflowType: 'APPOINTMENT_SERVICE', salesState: 'new', status: 'NEW', priority: 'NORMAL', createdAt: CONVERSATION.createdAt, updatedAt: CONVERSATION.updatedAt }, conversation: { ...CONVERSATION, mode: 'AI_ACTIVE' as const, stage: 'NEW_INQUIRY' }, followUps, activeHandoff: null, payments: [] };
}

function followUp() {
  return { id: 'follow-up-a', tenantId: 'tenant-a', conversationId: 'conversation-a', customerId: 'customer-a', channel: 'WHATSAPP', reason: 'Follow up', status: 'scheduled' as const, dueAt: '2026-08-26T09:00:00.000Z', attemptCount: 0, maxAttempts: 5, leaseOwner: null, leaseExpiresAt: null, retryAt: null, lastError: null, stopReason: null, manualOverride: false, lastResponseAt: null, completedAt: null, cancelledAt: null, idempotencyKey: 'follow-up-a', draftMessage: null, createdAt: '2026-08-25T09:00:00.000Z' };
}

function response(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
