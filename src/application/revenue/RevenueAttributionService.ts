import {
  PaymentKind,
  RevenueAttributionKind,
  RevenueAttributionStatus,
  RevenueStage,
  type RevenueEvent,
} from '../../domain/entities';
import { DomainError } from '../../domain/rules';
import type { DatabasePort } from '../../repositories/contracts';

export interface VerifyRevenueAttributionInput {
  businessId: string;
  revenueEventId: string;
  kind: RevenueAttributionKind;
  contributingActivityIds: string[];
  operationKey: string;
  verifiedByTeamMemberId?: string;
}

export interface RevenueAttributionSummary {
  status: 'AVAILABLE' | 'NOT_AVAILABLE';
  generatedCents: number;
  recoveredCents: number;
  protectedCents: number;
  reactivatedCents: number;
  verifiedEventCount: number;
}

export class RevenueAttributionService {
  constructor(
    private readonly database: DatabasePort,
    private readonly now: () => string,
  ) {}

  verify(input: VerifyRevenueAttributionInput): RevenueEvent {
    if (!input.operationKey.trim()) {
      throw new DomainError('Attribution operation key is required', 'OPERATION_KEY_REQUIRED');
    }
    const repositories = this.database.repositories;
    const event = repositories.revenueEvents.get(input.businessId, input.revenueEventId);
    if (!event) throw new DomainError('Revenue event not found', 'REVENUE_EVENT_NOT_FOUND');
    if (event.stage !== RevenueStage.Collected) {
      throw new DomainError(
        'Only collected revenue can receive commercial attribution',
        'ATTRIBUTION_REQUIRES_COLLECTION',
      );
    }

    const reusedOperation = repositories.revenueEvents.find(
      input.businessId,
      (candidate) => candidate.attributionOperationKey === input.operationKey,
    )[0];
    const activityIds = [...new Set(input.contributingActivityIds)];
    if (activityIds.length === 0) {
      throw new DomainError(
        'Verified attribution requires auditable business activity',
        'ATTRIBUTION_EVIDENCE_REQUIRED',
      );
    }
    if (reusedOperation && reusedOperation.id !== event.id) {
      throw new DomainError(
        'Attribution operation key was reused for another revenue event',
        'IDEMPOTENCY_CONFLICT',
      );
    }
    if (event.attributionStatus === RevenueAttributionStatus.Verified) {
      if (
        event.attributionOperationKey === input.operationKey &&
        event.attributionKind === input.kind &&
        sameValues(event.contributingActivityIds, activityIds) &&
        event.attributedByTeamMemberId === (input.verifiedByTeamMemberId ?? null)
      ) {
        return event;
      }
      throw new DomainError(
        'Verified revenue attribution is immutable',
        'ATTRIBUTION_ALREADY_VERIFIED',
      );
    }

    const lead = repositories.leads.get(input.businessId, event.leadId);
    const conversation = repositories.conversations.get(input.businessId, event.conversationId);
    if (
      !lead ||
      !conversation ||
      lead.contactId !== event.contactId ||
      lead.conversationId !== conversation.id ||
      conversation.contactId !== event.contactId
    ) {
      throw new DomainError('Revenue context does not match the opportunity', 'REFERENCE_MISMATCH');
    }
    for (const activityId of activityIds) {
      const activity = repositories.activities.get(input.businessId, activityId);
      if (
        !activity ||
        activity.contactId !== event.contactId ||
        activity.conversationId !== event.conversationId ||
        activity.occurredAt > event.occurredAt
      ) {
        throw new DomainError(
          'Attribution evidence does not match the revenue context',
          'ATTRIBUTION_EVIDENCE_MISMATCH',
        );
      }
    }
    if (
      input.verifiedByTeamMemberId &&
      !repositories.teamMembers.get(input.businessId, input.verifiedByTeamMemberId)
    ) {
      throw new DomainError('Attribution verifier not found', 'TEAM_MEMBER_NOT_FOUND');
    }

    return repositories.revenueEvents.save(input.businessId, {
      ...event,
      updatedAt: this.now(),
      attributionStatus: RevenueAttributionStatus.Verified,
      attributionKind: input.kind,
      contributingActivityIds: activityIds,
      attributionOperationKey: input.operationKey,
      attributedAt: this.now(),
      attributedByTeamMemberId: input.verifiedByTeamMemberId ?? null,
    });
  }

  summarize(businessId: string): RevenueAttributionSummary {
    const repositories = this.database.repositories;
    const verified = repositories.revenueEvents.find(
      businessId,
      (event) =>
        event.stage === RevenueStage.Collected &&
        event.attributionStatus === RevenueAttributionStatus.Verified &&
        event.attributionKind !== null,
    );
    const totals = new Map<RevenueAttributionKind, number>();
    for (const event of verified) {
      const refundedCents = repositories.payments
        .find(
          businessId,
          (payment) =>
            payment.kind === PaymentKind.Refund && payment.originalPaymentId === event.causationId,
        )
        .reduce((total, payment) => total + payment.amountCents, 0);
      totals.set(
        event.attributionKind!,
        (totals.get(event.attributionKind!) ?? 0) + Math.max(0, event.amountCents - refundedCents),
      );
    }
    return {
      status: verified.length > 0 ? 'AVAILABLE' : 'NOT_AVAILABLE',
      generatedCents: totals.get(RevenueAttributionKind.Generated) ?? 0,
      recoveredCents: totals.get(RevenueAttributionKind.Recovered) ?? 0,
      protectedCents: totals.get(RevenueAttributionKind.Protected) ?? 0,
      reactivatedCents: totals.get(RevenueAttributionKind.Reactivated) ?? 0,
      verifiedEventCount: verified.length,
    };
  }
}

function sameValues(first: string[], second: string[]): boolean {
  return first.length === second.length && first.every((value) => second.includes(value));
}
