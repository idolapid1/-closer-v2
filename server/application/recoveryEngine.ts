import type {
  NextBestAction,
  OpportunityObservation,
  OpportunityRecord,
  RecoveryActionStatus,
  RecoveryDecision,
  RecoveryDecisionRecord,
  RecoveryPlayType,
  RecoveryState,
} from '../domain/opportunity.js';
import { OpportunityScoringService } from './opportunityScoring.js';

export const RECOVERY_POLICY_VERSION = 'hvac-recovery-v1';
export const HIGH_VALUE_APPROVAL_THRESHOLD_CENTS = 1_000_000;

export interface RecoveryEvaluationInput {
  opportunity: OpportunityRecord;
  observation: OpportunityObservation;
  operationKey: string;
}

export class RecoveryEngine {
  constructor(private readonly scoring = new OpportunityScoringService()) {}

  evaluate(input: RecoveryEvaluationInput): RecoveryDecision {
    const scores = this.scoring.score(input.observation);
    const suppressionReason = suppression(input.observation);
    const playType = choosePlay(input.observation);
    const eligible = !suppressionReason && playType !== null;
    return {
      opportunityId: input.opportunity.id,
      playType,
      eligible,
      suppressionReason,
      scores,
      nextBestAction: nextAction(input.opportunity, input.observation, scores.recovery.value, eligible, suppressionReason),
      policyVersion: RECOVERY_POLICY_VERSION,
      idempotencyKey: input.operationKey,
      decidedAt: input.observation.now,
    };
  }
}

function suppression(observation: OpportunityObservation): string | null {
  if (observation.optedOut || !observation.operationalCommunicationAllowed) return 'CONTACT_SUPPRESSED';
  if (observation.status === 'DO_NOT_CONTACT') return 'DO_NOT_CONTACT';
  if (observation.status === 'WON') return 'OPPORTUNITY_WON';
  if (observation.hasExplicitRejection && observation.status === 'LOST') return 'EXPLICIT_REJECTION';
  if (observation.hasActiveHandoff || observation.humanRequired) return 'HUMAN_TAKEOVER_ACTIVE';
  if (!observation.withinContactWindow) return 'OUTSIDE_CONTACT_WINDOW';
  if (observation.recoveryState === 'RECOVERY_ACTIVE' || observation.recoveryState === 'WAITING_FOR_CUSTOMER') {
    return 'RECOVERY_ALREADY_ACTIVE';
  }
  return null;
}

function choosePlay(observation: OpportunityObservation): RecoveryPlayType | null {
  if (observation.source === 'MISSED_CALL' && ['NEW', 'CONTACTING'].includes(observation.status)) {
    return 'MISSED_CALL_RECOVERY';
  }
  if (observation.hasEstimate && observation.status === 'ESTIMATE') return 'UNSOLD_ESTIMATE_RECOVERY';
  if (['LOST', 'SNOOZED'].includes(observation.status)) return 'OLD_LEAD_REACTIVATION';
  if (['NEW', 'CONTACTING', 'ENGAGED', 'QUALIFIED'].includes(observation.status)) return 'NEW_LEAD_RECOVERY';
  return null;
}

function nextAction(
  opportunity: OpportunityRecord,
  observation: OpportunityObservation,
  recoveryScore: number,
  eligible: boolean,
  suppressionReason: string | null,
): NextBestAction {
  if (suppressionReason === 'HUMAN_TAKEOVER_ACTIVE') {
    return action('REQUEST_HUMAN', 'HUMAN_REVIEW_REQUIRED', 'Review this opportunity personally', null, false, observation.now);
  }
  if (!eligible) {
    return action('STOP_RECOVERY', suppressionReason ?? 'NO_RECOVERY_PLAY', 'Do not send an automated recovery message', null, false, null);
  }
  if (observation.hasBookingRequest || opportunity.status === 'QUALIFIED') {
    return action('ATTEMPT_BOOKING', 'READY_TO_BOOK', 'Offer a validated appointment time', null, true, observation.now);
  }
  if (!observation.hasExplicitServiceIntent) {
    return action('ASK_QUALIFICATION', 'SERVICE_NEED_UNKNOWN', 'Ask what HVAC service is needed', 'SMS', requiresApproval(opportunity), observation.now);
  }
  if (recoveryScore < 30) {
    return action('WAIT', 'LOW_RECOVERY_PROBABILITY', 'Wait before another recovery attempt', null, false, addHours(observation.now, 24));
  }
  if (observation.hasEstimate) {
    return action('SEND_SMS', 'UNSOLD_ESTIMATE_FOLLOW_UP', 'Follow up with estimate context', 'SMS', requiresApproval(opportunity), observation.now);
  }
  return action('SEND_SMS', 'TIMELY_RECOVERY_FOLLOW_UP', 'Contact the customer while intent is still fresh', 'SMS', requiresApproval(opportunity), observation.now);
}

function requiresApproval(opportunity: OpportunityRecord): boolean {
  return opportunity.autonomyLevel !== 'AUTOPILOT'
    || (opportunity.estimatedValueCents ?? 0) >= HIGH_VALUE_APPROVAL_THRESHOLD_CENTS;
}

export function recoveryActionStatus(
  opportunity: OpportunityRecord,
  decision: RecoveryDecision,
): RecoveryActionStatus {
  if (decision.nextBestAction.kind === 'REQUEST_HUMAN') return 'HUMAN_REQUIRED';
  if (!decision.eligible) return 'SUPPRESSED';
  if (['OBSERVE', 'SUGGEST'].includes(opportunity.autonomyLevel)) return 'PENDING';
  if (decision.nextBestAction.requiresApproval) return 'WAITING_APPROVAL';
  return 'READY';
}

export function recoveryDecisionExecutionState(
  opportunity: OpportunityRecord,
  decision: RecoveryDecision,
): RecoveryDecisionRecord['executionState'] {
  if (!decision.eligible) return 'SUPPRESSED';
  if (opportunity.autonomyLevel === 'OBSERVE') return 'OBSERVED';
  if (opportunity.autonomyLevel === 'SUGGEST') return 'SUGGESTED';
  return decision.nextBestAction.requiresApproval ? 'PENDING_APPROVAL' : 'SUGGESTED';
}

export function recoveryStateAfterDecision(
  opportunity: OpportunityRecord,
  decision: RecoveryDecision,
): RecoveryState {
  const actionStatus = recoveryActionStatus(opportunity, decision);
  if (actionStatus === 'HUMAN_REQUIRED') return 'HUMAN_REQUIRED';
  if (decision.eligible) return actionStatus === 'READY' ? 'RECOVERY_ACTIVE' : 'AT_RISK';
  if (decision.suppressionReason === 'RECOVERY_ALREADY_ACTIVE') return opportunity.recoveryState;
  if (decision.suppressionReason === 'OUTSIDE_CONTACT_WINDOW') return 'AT_RISK';
  if (decision.suppressionReason === 'OPPORTUNITY_WON') return 'NOT_AT_RISK';
  if (['CONTACT_SUPPRESSED', 'DO_NOT_CONTACT', 'EXPLICIT_REJECTION'].includes(decision.suppressionReason ?? '')) {
    return 'STOPPED';
  }
  return opportunity.recoveryState;
}

export function recoveryActionValidUntil(decision: RecoveryDecision): string | null {
  if (!decision.eligible || decision.nextBestAction.kind === 'WAIT') return decision.nextBestAction.dueAt;
  return addHours(decision.decidedAt, 24);
}

function action(
  kind: NextBestAction['kind'],
  reasonCode: string,
  label: string,
  channel: NextBestAction['channel'],
  requiresApprovalValue: boolean,
  dueAt: string | null,
): NextBestAction {
  return { kind, reasonCode, label, channel, requiresApproval: requiresApprovalValue, dueAt };
}

function addHours(value: string, hours: number): string {
  return new Date(new Date(value).getTime() + hours * 3_600_000).toISOString();
}
