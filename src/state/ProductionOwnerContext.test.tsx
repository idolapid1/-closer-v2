import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductionApiClient } from '../infrastructure/api/ProductionApiClient';
import type { AuthClient, AuthSession } from '../infrastructure/auth/AuthClient';
import { AuthProvider, useAuth } from './AuthContext';
import { ProductionOwnerProvider, useProductionOwner } from './ProductionOwnerContext';

const SESSION: AuthSession = { accessToken: 'token', expiresAt: null, user: { id: 'user-a', email: 'owner@example.test' } };
const EMPTY_REVENUE = { potentialCents: 0, pipelineCents: 0, bookedCents: 0, collectedCents: 0, refundedCents: 0, recoveredCents: 0 };

beforeEach(() => window.sessionStorage.clear());

describe('ProductionOwnerProvider', () => {
  it('selects only memberships returned by the server and rejects a guessed tenant ID', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => String(input).endsWith('/api/v1/tenants')
      ? json({ tenants: [{ tenantId: 'tenant-a', tenantName: 'Alpha', role: 'owner', active: true }] })
      : json({ snapshot: snapshot('customer-a', 'tenant-a') }));
    renderOwner(fetchMock);
    await screen.findByText('customer-a');
    await userEvent.click(screen.getByRole('button', { name: 'guess tenant' }));
    expect(screen.getByRole('alert')).toHaveTextContent('אין לך הרשאה');
    expect(fetchMock.mock.calls.every(([input]) => !String(input).includes('tenant-guessed'))).toBe(true);
  });

  it('never falls back to demo records when the production network is unavailable', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      if (String(input).endsWith('/api/v1/tenants')) {
        return json({ tenants: [{ tenantId: 'tenant-a', tenantName: 'Alpha', role: 'owner', active: true }] });
      }
      throw new TypeError('offline');
    });
    renderOwner(fetchMock);
    await screen.findByText(/אין כרגע חיבור/);
    expect(screen.getByTestId('snapshot')).toHaveTextContent('none');
    expect(screen.queryByText('לומה אסתטיקה')).not.toBeInTheDocument();
  });

  it('clears the selected tenant when the server reports removed membership', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => String(input).endsWith('/api/v1/tenants')
      ? json({ tenants: [{ tenantId: 'tenant-a', tenantName: 'Alpha', role: 'owner', active: true }] })
      : json({ error: { code: 'INSUFFICIENT_ROLE', message: 'Forbidden' } }, 403));
    renderOwner(fetchMock);
    await screen.findByText(/הגישה לעסק הוסרה/);
    expect(screen.getByTestId('tenant')).toHaveTextContent('none');
    expect(window.sessionStorage.getItem('closer.production.activeTenant')).toBeNull();
  });

  it('expires the authenticated session after a server 401 instead of showing demo data', async () => {
    const signOut = vi.fn(async () => undefined);
    const fetchMock = vi.fn<typeof fetch>(async (input) => String(input).endsWith('/api/v1/tenants')
      ? json({ tenants: [{ tenantId: 'tenant-a', tenantName: 'Alpha', role: 'owner', active: true }] })
      : json({ error: { code: 'UNAUTHENTICATED', message: 'Expired' } }, 401));
    renderOwner(fetchMock, { ...fakeAuthClient(), signOut });
    await screen.findByText('unauthenticated');
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('snapshot')).toHaveTextContent('none');
    expect(screen.queryByText('לומה אסתטיקה')).not.toBeInTheDocument();
  });

  it('ignores a stale snapshot response after the user switches to another authorized tenant', async () => {
    let resolveTenantA!: (response: Response) => void;
    const tenantAResponse = new Promise<Response>((resolve) => { resolveTenantA = resolve; });
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const url = String(input);
      if (url.endsWith('/api/v1/tenants')) {
        return Promise.resolve(json({ tenants: [
          { tenantId: 'tenant-a', tenantName: 'Alpha', role: 'owner', active: true },
          { tenantId: 'tenant-b', tenantName: 'Beta', role: 'owner', active: true },
        ] }));
      }
      if (url.includes('/tenant-a/')) return tenantAResponse;
      return Promise.resolve(json({ snapshot: snapshot('customer-b', 'tenant-b') }));
    });
    renderOwner(fetchMock);
    await waitFor(() => expect(screen.getByTestId('tenant')).toHaveTextContent('tenant-a'));
    await userEvent.click(screen.getByRole('button', { name: 'select tenant b' }));
    await screen.findByText('customer-b');
    await act(async () => { resolveTenantA(json({ snapshot: snapshot('customer-a', 'tenant-a') })); });
    await waitFor(() => expect(screen.getByTestId('snapshot')).toHaveTextContent('customer-b'));
  });
});

function OwnerProbe() {
  const auth = useAuth();
  const owner = useProductionOwner();
  return <div><span>{auth.status}</span><span data-testid="tenant">{owner.activeTenantId || 'none'}</span><span data-testid="snapshot">{owner.snapshot?.customers[0]?.id ?? 'none'}</span>{owner.error ? <span role="alert">{owner.error}</span> : null}<button type="button" onClick={() => owner.selectTenant('tenant-guessed')}>guess tenant</button><button type="button" onClick={() => owner.selectTenant('tenant-b')}>select tenant b</button></div>;
}

function renderOwner(fetchMock: typeof fetch, auth = fakeAuthClient()) {
  const api = new ProductionApiClient('https://api.example.test', auth, fetchMock);
  return render(<AuthProvider client={auth}><ProductionOwnerProvider api={api}><OwnerProbe /></ProductionOwnerProvider></AuthProvider>);
}

function fakeAuthClient(): AuthClient {
  return {
    getSession: async () => SESSION,
    getAccessToken: async () => SESSION.accessToken,
    refreshAccessToken: async () => SESSION.accessToken,
    signIn: async () => SESSION,
    signUp: async () => ({ session: SESSION, confirmationRequired: false }),
    signOut: async () => undefined,
    subscribe: () => () => undefined,
  };
}

function snapshot(customerId: string, tenantId: string) {
  return { customers: [{ id: customerId, tenantId, displayName: 'Dana', phone: '+972500000001', email: null, createdAt: '2026-08-25T09:00:00.000Z' }], conversations: [], followUps: [], activeHandoffs: [], revenue: EMPTY_REVENUE };
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}
