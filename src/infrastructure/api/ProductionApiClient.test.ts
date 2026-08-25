import { describe, expect, it, vi } from 'vitest';
import {
  ProductionApiClient,
  ProductionApiError,
  resolveCloserDataMode,
} from './ProductionApiClient';

describe('ProductionApiClient', () => {
  it('keeps demo and production data modes explicit and defaults safely to demo', () => {
    expect(resolveCloserDataMode(undefined)).toBe('DEMO');
    expect(resolveCloserDataMode('anything-else')).toBe('DEMO');
    expect(resolveCloserDataMode('PRODUCTION')).toBe('PRODUCTION');
  });

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
});

