import {
  FollowUpScenario,
  FollowUpStatus,
  LeadStatus,
  OpportunityLostReason,
} from '../../domain/entities';
import { DomainError } from '../../domain/rules';
import type { DatabasePort } from '../../repositories/contracts';

export type ReactivationReason = 'PAST_INTEREST' | 'EXPIRED_QUOTE' | 'PREVIOUSLY_UNAVAILABLE';

export interface ReactivationCandidate {
  businessId: string;
  leadId: string;
  contactId: string;
  conversationId: string;
  customerName: string;
  serviceId: string | null;
  reason: ReactivationReason;
  inactiveSince: string;
  knownValueCents: number | null;
}

export class ReactivationService {
  constructor(
    private readonly database: DatabasePort,
    private readonly now: () => string,
  ) {}

  listCandidates(businessId: string): ReactivationCandidate[] {
    const repositories = this.database.repositories;
    const settings = repositories.businessSettings.list(businessId)[0];
    if (!settings) throw new DomainError('Business settings not found', 'NOT_FOUND');
    const cutoff = new Date(this.now()).getTime() - settings.reactivationInactivityDays * 86_400_000;

    return repositories.leads
      .find(
        businessId,
        (lead) =>
          lead.status === LeadStatus.Lost &&
          lead.closedAt !== null &&
          new Date(lead.closedAt).getTime() <= cutoff &&
          eligibleReason(lead.lostReason) !== null,
      )
      .map((lead): ReactivationCandidate | null => {
        const contact = repositories.contacts.get(businessId, lead.contactId);
        const consent = repositories.consentRecords.find(
          businessId,
          (record) => record.contactId === lead.contactId,
        )[0];
        const alreadyPrepared = repositories.scheduledFollowUps.find(
          businessId,
          (followUp) =>
            followUp.conversationId === lead.conversationId &&
            followUp.scenario === FollowUpScenario.Reactivation &&
            followUp.status === FollowUpStatus.Scheduled,
        )[0];
        if (!contact || !consent?.marketingAllowed || consent.optedOut || alreadyPrepared) {
          return null;
        }
        const quotes = repositories.quotes
          .find(businessId, (quote) => quote.leadId === lead.id)
          .sort((first, second) => second.updatedAt.localeCompare(first.updatedAt));
        return {
          businessId,
          leadId: lead.id,
          contactId: lead.contactId,
          conversationId: lead.conversationId,
          customerName: contact.displayName,
          serviceId: lead.serviceId,
          reason: eligibleReason(lead.lostReason)!,
          inactiveSince: lead.closedAt!,
          knownValueCents: quotes[0]?.totalCents ?? null,
        };
      })
      .filter((candidate): candidate is ReactivationCandidate => candidate !== null)
      .sort(
        (first, second) =>
          (second.knownValueCents ?? 0) - (first.knownValueCents ?? 0) ||
          first.inactiveSince.localeCompare(second.inactiveSince),
      );
  }

  requireCandidate(businessId: string, leadId: string): ReactivationCandidate {
    const candidate = this.listCandidates(businessId).find((item) => item.leadId === leadId);
    if (!candidate) {
      throw new DomainError(
        'Opportunity is not eligible for owner-approved reactivation',
        'REACTIVATION_NOT_ELIGIBLE',
      );
    }
    return candidate;
  }
}

function eligibleReason(reason: OpportunityLostReason | null): ReactivationReason | null {
  if (reason === OpportunityLostReason.NoLongerInterested) return 'PAST_INTEREST';
  if (reason === OpportunityLostReason.QuoteExpired) return 'EXPIRED_QUOTE';
  if (reason === OpportunityLostReason.Unavailable) return 'PREVIOUSLY_UNAVAILABLE';
  return null;
}
