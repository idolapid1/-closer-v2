import type {
  ProductionCopilotExecutionContract,
  ProductionCopilotResultContract,
  ProductionCustomerContract,
  ProductionJourneyCreationContract,
  ProductionJourneyResultContract,
  ProductionTenantContract,
} from '../../types/productionApi';

export type CloserDataMode = 'DEMO' | 'PRODUCTION';

export interface AccessTokenProvider {
  getAccessToken(): Promise<string | null>;
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
    return response.tenants;
  }

  async listCustomers(tenantId: string): Promise<ProductionCustomerContract[]> {
    const response = await this.request<{ customers: ProductionCustomerContract[] }>(
      `/api/v1/tenants/${encodeURIComponent(tenantId)}/customers`,
    );
    return response.customers;
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

  async executeCopilot(
    tenantId: string,
    input: ProductionCopilotExecutionContract,
  ): Promise<ProductionCopilotResultContract> {
    return this.request<ProductionCopilotResultContract>(`/api/v1/tenants/${encodeURIComponent(tenantId)}/copilot/execute`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const accessToken = await this.tokenProvider.getAccessToken();
    if (!accessToken) throw new ProductionApiError(401, 'UNAUTHENTICATED', 'Authentication is required');
    const response = await this.fetchImplementation(new URL(path, this.baseUrl), {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        Authorization: `Bearer ${accessToken}`,
        ...init.headers,
      },
      credentials: 'omit',
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const error = readApiError(payload);
      throw new ProductionApiError(response.status, error.code, error.message);
    }
    return payload as T;
  }
}

export function resolveCloserDataMode(value: string | undefined): CloserDataMode {
  return value === 'PRODUCTION' ? 'PRODUCTION' : 'DEMO';
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
