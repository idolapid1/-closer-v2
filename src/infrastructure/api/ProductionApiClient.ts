import type {
  ProductionCopilotExecutionContract,
  ProductionCopilotResultContract,
  ProductionCustomerContract,
  ProductionCustomerWorkspaceContract,
  ProductionFollowUpContract,
  ProductionFollowUpCreationContract,
  ProductionInvitationContract,
  ProductionJourneyCreationContract,
  ProductionJourneyResultContract,
  ProductionOwnerSnapshotContract,
  ProductionTenantContract,
} from '../../types/productionApi';

export interface AccessTokenProvider {
  getAccessToken(): Promise<string | null>;
  refreshAccessToken?(): Promise<string | null>;
}

export class ProductionApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class ProductionApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly tokenProvider: AccessTokenProvider,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  async listTenants(): Promise<ProductionTenantContract[]> {
    const response = await this.request<{ tenants: ProductionTenantContract[] }>('/api/v1/tenants');
    if (!Array.isArray(response.tenants)) {
      throw new ProductionApiError(502, 'INVALID_RESPONSE', 'The production server returned an invalid tenant list');
    }
    return response.tenants;
  }

  async listCustomers(tenantId: string): Promise<ProductionCustomerContract[]> {
    const response = await this.request<{ customers: ProductionCustomerContract[] }>(
      `/api/v1/tenants/${encodeURIComponent(tenantId)}/customers`,
    );
    return response.customers;
  }

  async getOwnerSnapshot(tenantId: string): Promise<ProductionOwnerSnapshotContract> {
    const response = await this.request<{ snapshot: ProductionOwnerSnapshotContract }>(
      `/api/v1/tenants/${encodeURIComponent(tenantId)}/owner-snapshot`,
    );
    return response.snapshot;
  }

  async getCustomerWorkspace(
    tenantId: string,
    customerId: string,
  ): Promise<ProductionCustomerWorkspaceContract> {
    const response = await this.request<{ workspace: ProductionCustomerWorkspaceContract }>(
      `/api/v1/tenants/${encodeURIComponent(tenantId)}/customers/${encodeURIComponent(customerId)}`,
    );
    return response.workspace;
  }

  async provisionTenant(name: string, idempotencyKey: string): Promise<{ tenantId: string; role: 'owner'; replayed: boolean }> {
    return this.request('/api/v1/organizations', {
      method: 'POST',
      body: JSON.stringify({ name, idempotencyKey }),
    });
  }

  async createJourney(
    tenantId: string,
    input: ProductionJourneyCreationContract,
  ): Promise<ProductionJourneyResultContract> {
    return this.request<ProductionJourneyResultContract>(`/api/v1/tenants/${encodeURIComponent(tenantId)}/journeys`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async scheduleFollowUp(
    tenantId: string,
    input: ProductionFollowUpCreationContract,
  ): Promise<{ followUp: ProductionFollowUpContract; replayed: boolean }> {
    return this.request(`/api/v1/tenants/${encodeURIComponent(tenantId)}/follow-ups`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async startHumanTakeover(
    tenantId: string,
    conversationId: string,
    reason: string,
    idempotencyKey: string,
  ): Promise<{ conversationId: string; handoffId: string; mode: 'HUMAN_ACTIVE'; replayed: boolean }> {
    return this.request(
      `/api/v1/tenants/${encodeURIComponent(tenantId)}/conversations/${encodeURIComponent(conversationId)}/handoff`,
      { method: 'POST', body: JSON.stringify({ reason, idempotencyKey }) },
    );
  }

  async resumeAssistant(
    tenantId: string,
    conversationId: string,
    idempotencyKey: string,
  ): Promise<{ conversationId: string; mode: 'AI_ACTIVE'; replayed: boolean }> {
    return this.request(
      `/api/v1/tenants/${encodeURIComponent(tenantId)}/conversations/${encodeURIComponent(conversationId)}/resume`,
      { method: 'POST', body: JSON.stringify({ idempotencyKey }) },
    );
  }

  async createInvitation(
    tenantId: string,
    input: { email: string; role: 'admin' | 'member'; idempotencyKey: string },
  ): Promise<{ invitation: ProductionInvitationContract; developmentAcceptanceUrl?: string }> {
    return this.request(`/api/v1/tenants/${encodeURIComponent(tenantId)}/invitations`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async acceptInvitation(token: string): Promise<{ tenantId: string; role: 'admin' | 'member'; replayed: boolean }> {
    return this.request('/api/v1/invitations/accept', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  }

  async executeCopilot(
    tenantId: string,
    input: ProductionCopilotExecutionContract,
  ): Promise<ProductionCopilotResultContract> {
    return this.request<ProductionCopilotResultContract>(`/api/v1/tenants/${encodeURIComponent(tenantId)}/copilot/execute`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  private async request<T>(path: string, init: RequestInit = {}, mayRefresh = true): Promise<T> {
    const accessToken = await this.tokenProvider.getAccessToken();
    if (!accessToken) throw new ProductionApiError(401, 'UNAUTHENTICATED', 'Authentication is required');
    let response: Response;
    try {
      response = await this.fetchImplementation(new URL(path, this.baseUrl), {
        ...init,
        headers: {
          Accept: 'application/json',
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          Authorization: `Bearer ${accessToken}`,
          ...init.headers,
        },
        credentials: 'omit',
      });
    } catch {
      throw new ProductionApiError(0, 'NETWORK_FAILURE', 'CLOSER cannot reach the production server');
    }
    if (response.status === 401 && mayRefresh && this.tokenProvider.refreshAccessToken) {
      const refreshed = await this.tokenProvider.refreshAccessToken();
      if (refreshed) return this.request<T>(path, init, false);
    }
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const error = readApiError(payload);
      throw new ProductionApiError(response.status, error.code, error.message);
    }
    return payload as T;
  }
}

function readApiError(payload: unknown): { code: string; message: string } {
  if (payload && typeof payload === 'object') {
    const error = (payload as Record<string, unknown>).error;
    if (error && typeof error === 'object') {
      const record = error as Record<string, unknown>;
      if (typeof record.code === 'string' && typeof record.message === 'string') {
        return { code: record.code, message: record.message };
      }
    }
  }
  return { code: 'REQUEST_FAILED', message: 'The request could not be completed' };
}
