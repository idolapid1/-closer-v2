import type {
  ExplainableScore,
  OpportunityObservation,
  OpportunityScores,
} from '../domain/opportunity.js';

export const OPPORTUNITY_SCORING_VERSION = 'hvac-rules-v1';

interface ScoreAccumulator {
  value: number;
  reasons: string[];
  explanations: string[];
}

function add(accumulator: ScoreAccumulator, points: number, code: string, explanation: string): void {
  accumulator.value += points;
  accumulator.reasons.push(code);
  accumulator.explanations.push(explanation);
}

function finish(accumulator: ScoreAccumulator): ExplainableScore {
  return {
    value: Math.max(0, Math.min(100, Math.round(accumulator.value))),
    reasonCodes: accumulator.reasons,
    explanation: accumulator.explanations.join(' · ') || 'No strong signal is available yet',
    version: OPPORTUNITY_SCORING_VERSION,
  };
}

function elapsedHours(now: string, value: string | null): number | null {
  if (!value) return null;
  const difference = new Date(now).getTime() - new Date(value).getTime();
  if (!Number.isFinite(difference)) return null;
  return Math.max(0, difference / 3_600_000);
}

export class OpportunityScoringService {
  score(observation: OpportunityObservation): OpportunityScores {
    return {
      intent: this.intentScore(observation),
      revenue: this.revenueScore(observation),
      recovery: this.recoveryScore(observation),
      urgency: this.urgencyScore(observation),
    };
  }

  private intentScore(observation: OpportunityObservation): ExplainableScore {
    const score: ScoreAccumulator = { value: 15, reasons: ['INQUIRY_EXISTS'], explanations: ['Customer inquiry exists'] };
    if (observation.hasCustomerReply) add(score, 20, 'CUSTOMER_REPLIED', 'Customer has engaged in the conversation');
    if (observation.hasExplicitServiceIntent) add(score, 25, 'EXPLICIT_SERVICE_INTENT', 'Customer named a service need');
    if (observation.hasBookingRequest) add(score, 30, 'BOOKING_REQUESTED', 'Customer requested an appointment');
    if (observation.hasEstimate && observation.estimateViewedCount > 0) {
      add(score, Math.min(20, 8 + observation.estimateViewedCount * 4), 'ESTIMATE_ENGAGED', 'Customer viewed the estimate');
    }
    if (observation.hasExplicitRejection) add(score, -60, 'EXPLICIT_REJECTION', 'Customer explicitly rejected the opportunity');
    if (observation.status === 'DO_NOT_CONTACT') add(score, -100, 'DO_NOT_CONTACT', 'Customer must not be contacted');
    return finish(score);
  }

  private revenueScore(observation: OpportunityObservation): ExplainableScore {
    const score: ScoreAccumulator = { value: 10, reasons: [], explanations: [] };
    const value = observation.estimatedValueCents;
    const average = observation.averageTicketCents;
    if (value !== null) {
      if (value >= 1_500_000) add(score, 80, 'VERY_HIGH_VALUE', 'Estimated value is at least $15,000');
      else if (value >= 750_000) add(score, 65, 'HIGH_VALUE', 'Estimated value is at least $7,500');
      else if (value >= 250_000) add(score, 45, 'MEANINGFUL_VALUE', 'Estimated value is at least $2,500');
      else add(score, 25, 'KNOWN_VALUE', 'Opportunity has a known value');
      if (average && value >= average * 1.5) add(score, 10, 'ABOVE_AVERAGE_TICKET', 'Value is materially above the business average');
    } else {
      add(score, 10, 'VALUE_NOT_YET_KNOWN', 'Value has not been validated yet');
    }
    if (['SYSTEM_REPLACEMENT', 'INSTALLATION', 'COMMERCIAL_SERVICE'].includes(observation.opportunityType)) {
      add(score, 15, 'HIGH_VALUE_SERVICE_TYPE', 'Service type commonly carries higher revenue value');
    }
    return finish(score);
  }

  private recoveryScore(observation: OpportunityObservation): ExplainableScore {
    const score: ScoreAccumulator = { value: 35, reasons: [], explanations: [] };
    const customerAge = elapsedHours(observation.now, observation.lastCustomerActivityAt);
    const businessAge = elapsedHours(observation.now, observation.lastBusinessActivityAt);
    if (observation.hasCustomerReply) add(score, 20, 'CUSTOMER_ENGAGED', 'Customer has already replied');
    if (customerAge !== null && customerAge <= 2) add(score, 20, 'RECENT_CUSTOMER_ACTIVITY', 'Customer was active within two hours');
    if (businessAge !== null && businessAge >= 12 && businessAge <= 72) add(score, 15, 'FOLLOW_UP_WINDOW_OPEN', 'The opportunity is in a useful follow-up window');
    if (observation.hasEstimate && observation.estimateViewedCount >= 2) add(score, 20, 'ESTIMATE_VIEWED_REPEATEDLY', 'Estimate was viewed more than once');
    if (observation.followUpAttempts >= 3) add(score, -20, 'MULTIPLE_ATTEMPTS', 'Several recovery attempts have already occurred');
    if (observation.hasExplicitRejection) add(score, -70, 'EXPLICIT_REJECTION', 'Customer explicitly rejected the offer');
    if (observation.optedOut || !observation.operationalCommunicationAllowed) add(score, -100, 'CONTACT_SUPPRESSED', 'Automated contact is not allowed');
    if (observation.hasActiveHandoff || observation.humanRequired) add(score, -15, 'HUMAN_REVIEW_ACTIVE', 'Human judgment is required before automation');
    return finish(score);
  }

  private urgencyScore(observation: OpportunityObservation): ExplainableScore {
    const score: ScoreAccumulator = { value: 10, reasons: [], explanations: [] };
    if (observation.opportunityType === 'EMERGENCY_REPAIR') add(score, 80, 'EMERGENCY_SERVICE', 'Customer reported an emergency repair need');
    if (observation.source === 'MISSED_CALL') add(score, 25, 'MISSED_INBOUND_CALL', 'An inbound call was missed');
    const customerAge = elapsedHours(observation.now, observation.lastCustomerActivityAt);
    if (customerAge !== null && customerAge <= 1) add(score, 20, 'CUSTOMER_ACTIVE_NOW', 'Customer activity is less than one hour old');
    if (observation.hasBookingRequest) add(score, 15, 'BOOKING_REQUESTED', 'Customer is ready to schedule');
    return finish(score);
  }
}
