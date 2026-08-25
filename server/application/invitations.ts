import { createHash, randomBytes } from 'node:crypto';
import type { ProductionStore } from './store.js';
import type {
  AuthenticatedIdentity,
  InvitationAcceptanceResult,
  OrganizationInvitationCreationInput,
  OrganizationInvitationRecord,
} from '../domain/model.js';
import { ApiError } from './errors.js';

export interface InvitationServiceOptions {
  lifetimeMilliseconds?: number;
  developmentAcceptanceBaseUrl?: string;
  exposeDevelopmentLink?: boolean;
  now?: () => Date;
}

export interface InvitationCreationResult {
  invitation: OrganizationInvitationRecord;
  developmentAcceptanceUrl?: string;
}

export class InvitationService {
  private readonly lifetimeMilliseconds: number;
  private readonly developmentAcceptanceBaseUrl: string | undefined;
  private readonly exposeDevelopmentLink: boolean;
  private readonly now: () => Date;

  constructor(
    private readonly store: ProductionStore,
    options: InvitationServiceOptions = {},
  ) {
    this.lifetimeMilliseconds = options.lifetimeMilliseconds ?? 7 * 24 * 60 * 60 * 1000;
    this.developmentAcceptanceBaseUrl = options.developmentAcceptanceBaseUrl;
    this.exposeDevelopmentLink = options.exposeDevelopmentLink ?? false;
    this.now = options.now ?? (() => new Date());
  }

  async create(
    tenantId: string,
    actor: AuthenticatedIdentity,
    input: OrganizationInvitationCreationInput,
  ): Promise<InvitationCreationResult> {
    if (!this.exposeDevelopmentLink) {
      throw new ApiError(503, 'INVITATION_DELIVERY_DISABLED', 'Invitation delivery is not configured');
    }
    const rawToken = randomBytes(32).toString('base64url');
    const current = this.now();
    const invitation = await this.store.createInvitation(
      tenantId,
      actor,
      {
        ...input,
        email: normalizeEmail(input.email),
        tokenHash: hashInvitationToken(rawToken),
        expiresAt: new Date(current.getTime() + this.lifetimeMilliseconds).toISOString(),
      },
      current.toISOString(),
    );
    if (invitation.replayed || !this.exposeDevelopmentLink || !this.developmentAcceptanceBaseUrl) return { invitation };
    const url = new URL(this.developmentAcceptanceBaseUrl);
    url.searchParams.set('token', rawToken);
    return { invitation, developmentAcceptanceUrl: url.toString() };
  }

  accept(rawToken: string, actor: AuthenticatedIdentity): Promise<InvitationAcceptanceResult> {
    return this.store.acceptInvitation(hashInvitationToken(rawToken), actor, this.now().toISOString());
  }

  revoke(
    tenantId: string,
    invitationId: string,
    actor: AuthenticatedIdentity,
  ): Promise<OrganizationInvitationRecord | null> {
    return this.store.revokeInvitation(tenantId, invitationId, actor, this.now().toISOString());
  }
}

export function hashInvitationToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
