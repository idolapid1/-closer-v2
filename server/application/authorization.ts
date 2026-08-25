import { ApiError } from './errors.js';
import type {
  AuthenticatedIdentity,
  OrganizationMembership,
  OrganizationRole,
} from '../domain/model.js';
import type { ProductionStore } from './store.js';

const ROLE_RANK: Record<OrganizationRole, number> = {
  member: 1,
  admin: 2,
  owner: 3,
};

export class AuthorizationService {
  constructor(private readonly store: ProductionStore) {}

  async requireMembership(
    identity: AuthenticatedIdentity,
    tenantId: string,
    minimumRole: OrganizationRole = 'member',
  ): Promise<OrganizationMembership> {
    const membership = await this.store.getMembership(identity.userId, tenantId);
    if (!membership?.active) {
      throw new ApiError(404, 'RESOURCE_NOT_FOUND', 'The requested resource was not found');
    }
    if (ROLE_RANK[membership.role] < ROLE_RANK[minimumRole]) {
      throw new ApiError(403, 'INSUFFICIENT_ROLE', 'This action is not permitted');
    }
    return membership;
  }
}

