import { describe, expect, it, vi } from 'vitest';
import {
  ProductionApiClient,
  ProductionApiError,
} from './ProductionApiClient';

describe('ProductionApiClient', () => {
  it('sends the access token to the authenticated API without exposing a database contract', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ tenants: [{ tenantId: 'tenant-a', tenantName: 'A', role: 'owner', active: true }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = new ProductionApiClient(
      'https://api.example.test',
      { getAccessToken: async () => 'short-lived-access-token' },
      fetchMock,
    );
    await expect(client.listTenants()).resolves.toHaveLength(1);
    const request = fetchMock.mock.calls[0];
    expect(String(request?.[0])).toBe('https://api.example.test/api/v1/tenants');
    expect(new Headers(request?.[1]?.headers).get('Authorization')).toBe('Bearer short-lived-access-token');
  });

  it('fails closed without a session and preserves safe API error codes', async () => {
    const noSessionClient = new ProductionApiClient('https://api.example.test', {
      getAccessToken: async () => null,
    });
    await expect(noSessionClient.listTenants()).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
    });

    const deniedClient = new ProductionApiClient(
      'https://api.example.test',
      { getAccessToken: async () => 'token' },
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: 'RESOURCE_NOT_FOUND', message: 'Not found' } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    await expect(deniedClient.listCustomers('tenant-b')).rejects.toEqual(
      new ProductionApiError(404, 'RESOURCE_NOT_FOUND', 'Not found'),
    );
  });

  it('refreshes one expired access token and never retries authorization indefinitely', async () => {
    let token = 'expired';
    const tokenProvider = {
      getAccessToken: async () => token,
      refreshAccessToken: vi.fn(async () => {
        token = 'fresh';
        return token;
      }),
    };
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Expired' } }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ tenants: [] }), { status: 200 }));
    const client = new ProductionApiClient('https://api.example.test', tokenProvider, fetchMock);
    await expect(client.listTenants()).resolves.toEqual([]);
    expect(tokenProvider.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get('Authorization')).toBe('Bearer fresh');
  });

  it('reports a network failure without returning demo data', async () => {
    const client = new ProductionApiClient(
      'https://api.example.test',
      { getAccessToken: async () => 'token' },
      vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline')),
    );
    await expect(client.listTenants()).rejects.toMatchObject({ status: 0, code: 'NETWORK_FAILURE' });
  });

  it('uses only authenticated tenant API routes for revenue recovery operations', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ opportunities: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ commandCenter: { opportunitiesAtRisk: [] } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ decision: { id: 'decision-a' }, action: { id: 'action-a' }, replayed: false }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ action: { id: 'action-a', status: 'READY' }, replayed: false }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ customerId: 'customer/a', stoppedOpportunities: 1, cancelledFollowUps: 1, replayed: false }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ messageId: 'message-a', opportunityId: 'opportunity/a', conversationId: 'conversation-a', providerReplay: false, replayed: false }), { status: 200 }));
    const client = new ProductionApiClient(
      'https://api.example.test',
      { getAccessToken: async () => 'token' },
      fetchMock,
    );
    await client.listOpportunities('tenant a');
    await client.getRevenueCommandCenter('tenant a');
    await client.evaluateOpportunityRecovery('tenant a', 'opportunity/a', 'evaluate-001');
    await client.approveRecoveryAction('tenant a', 'opportunity/a', 'action/a', 'approve-001');
    await client.recordCustomerOptOut('tenant a', 'customer/a', 'opt-out-001');
    await client.recordCustomerResponse('tenant a', 'opportunity/a', {
      idempotencyKey: 'response-001',
      providerMessageId: 'provider-response-001',
      body: 'Still interested',
    });

    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      'https://api.example.test/api/v1/tenants/tenant%20a/opportunities?limit=50&offset=0',
      'https://api.example.test/api/v1/tenants/tenant%20a/revenue-command-center',
      'https://api.example.test/api/v1/tenants/tenant%20a/opportunities/opportunity%2Fa/evaluate-recovery',
      'https://api.example.test/api/v1/tenants/tenant%20a/opportunities/opportunity%2Fa/recovery-actions/action%2Fa/approve',
      'https://api.example.test/api/v1/tenants/tenant%20a/customers/customer%2Fa/opt-out',
      'https://api.example.test/api/v1/tenants/tenant%20a/opportunities/opportunity%2Fa/customer-responses',
    ]);
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({ idempotencyKey: 'evaluate-001' });
    expect(JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body))).toEqual({ idempotencyKey: 'approve-001' });
    expect(JSON.parse(String(fetchMock.mock.calls[4]?.[1]?.body))).toEqual({ idempotencyKey: 'opt-out-001' });
    expect(JSON.parse(String(fetchMock.mock.calls[5]?.[1]?.body))).toEqual({
      idempotencyKey: 'response-001',
      providerMessageId: 'provider-response-001',
      body: 'Still interested',
    });
  });
});
