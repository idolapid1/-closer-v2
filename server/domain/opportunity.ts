import type {
  ConversationRecord,
  CustomerRecord,
  HumanHandoffRecord,
  RevenueLedgerEntry,
} from './model.js';

export const OPPORTUNITY_STATUSES = [
  'NEW',
  'CONTACTING',
  'ENGAGED',
  'QUALIFIED',
  'BOOKED',
  'ESTIMATE',
  'WON',
  'LOST',
  'SNOOZED',
  'DO_NOT_CONTACT',
] as const;

export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];

export const RECOVERY_STATES = [
  'NOT_AT_RISK',
  'AT_RISK',
  'RECOVERY_ACTIVE',
  'WAITING_FOR_CUSTOMER',
  'HUMAN_REQUIRED',
  'RECOVERED',
  'FAILED',
  'STOPPED',
] as const;

export type RecoveryState = (typeof RECOVERY_STATES)[number];

export const HVAC_OPPORTUNITY_TYPES = [
  'EMERGENCY_REPAIR',
  'STANDARD_REPAIR',
  'MAINTENANCE',
  'TUNE_UP',
  'SYSTEM_REPLACEMENT',
  'INSTALLATION',
  'INDOOR_AIR_QUALITY',
  'DUCT_WORK',
  'COMMERCIAL_SERVICE',
  'OTHER',
] as const;

export type HvacOpportunityType = (typeof HVAC_OPPORTUNITY_TYPES)[number];

export type OpportunitySource =
  | 'MISSED_CALL'
  | 'PHONE'
  | 'WEBSITE_FORM'
  | 'WHATSAPP'
  | 'INSTAGRAM'
  | 'EMAIL'
  | 'IMPORT'
  | 'MANUAL'
  | 'OTHER';

export type OpportunityAutonomyLevel = 'OBSERVE' | 'SUGGEST' | 'APPROVE_TO_SEND' | 'AUTOPILOT';

export type RevenueAttributionType = 'GENERATED' | 'RECOVERED' | 'ASSISTED' | 'ORGANIC';

export type RecoveryPlayType =
  | 'MISSED_CALL_RECOVERY'
  | 'NEW_LEAD_RECOVERY'
  | 'UNSOLD_ESTIMATE_RECOVERY'
  | 'OLD_LEAD_REACTIVATION';

export const RECOVERY_ACTION_STATUSES = [
  'PENDING',
  'READY',
  'WAITING_APPROVAL',
  'EXECUTING',
  'COMPLETED',
  'WAITING_CUSTOMER',
  'HUMAN_REQUIRED',
  'CANCELLED',
  'FAILED',
  'SUPPRESSED',
] as const;

export type RecoveryActionStatus = (typeof RECOVERY_ACTION_STATUSES)[number];

export type NextBestActionKind =
  | 'SEND_SMS'
  | 'SEND_EMAIL'
  | 'WAIT'
  | 'REQUEST_HUMAN'
  | 'ATTEMPT_BOOKING'
  | 'STOP_RECOVERY'
  | 'MARK_LOST'
  | 'ASK_QUALIFICATION';

export interface ExplainableScore {
  value: number;
  reasonCodes: string[];
  explanation: string;
  version: string;
}

export interface OpportunityScores {
  intent: ExplainableScore;
  revenue: ExplainableScore;
  recovery: ExplainableScore;
  urgency: ExplainableScore;
}

export interface OpportunityRecord {
  id: string;
  tenantId: string;
  customerId: string;
  leadId: string | null;
  conversationId: string | null;
  source: OpportunitySource;
  opportunityType: HvacOpportunityType;
  estimatedValueCents: number | null;
  currency: string;
  scores: OpportunityScores;
  status: OpportunityStatus;
  recoveryState: RecoveryState;
  autonomyLevel: OpportunityAutonomyLevel;
  assignedHumanId: string | null;
  lastCustomerActivityAt: string | null;
  lastBusinessActivityAt: string | null;
  nextActionAt: string | null;
  bookingId: string | null;
  estimateId: string | null;
  jobId: string | null;
  wonAt: string | null;
  lostAt: string | null;
  lostReason: string | null;
  revenueAttributedCents: number;
  attributionType: RevenueAttributionType | null;
  attributionReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OpportunityObservation {
  now: string;
  source: OpportunitySource;
  status: OpportunityStatus;
  recoveryState: RecoveryState;
  opportunityType: HvacOpportunityType;
  estimatedValueCents: number | null;
  averageTicketCents: number | null;
  lastCustomerActivityAt: string | null;
  lastBusinessActivityAt: string | null;
  hasCustomerReply: boolean;
  hasExplicitServiceIntent: boolean;
  hasBookingRequest: boolean;
  hasEstimate: boolean;
  estimateViewedCount: number;
  estimateCreatedAt: string | null;
  hasExplicitRejection: boolean;
  hasActiveHandoff: boolean;
  humanRequired: boolean;
  optedOut: boolean;
  operationalCommunicationAllowed: boolean;
  withinContactWindow: boolean;
  followUpAttempts: number;
  hasOtherActiveOpportunity: boolean;
}

export interface NextBestAction {
  kind: NextBestActionKind;
  reasonCode: string;
  label: string;
  channel: 'SMS' | 'EMAIL' | 'MANUAL' | null;
  requiresApproval: boolean;
  dueAt: string | null;
}

export interface RecoveryActionRecord {
  id: string;
  tenantId: string;
  opportunityId: string;
  decisionId: string;
  actionKind: NextBestActionKind;
  channel: NextBestAction['channel'];
  status: RecoveryActionStatus;
  requiresApproval: boolean;
  requestedBy: 'POLICY' | 'COPILOT' | 'HUMAN';
  idempotencyKey: string;
  validUntil: string | null;
  approvedByUserId: string | null;
  approvedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  lastError: string | null;
  deliveryState: 'PREPARED_ONLY' | 'MOCK_ONLY' | 'LIVE_DISABLED';
  createdAt: string;
  updatedAt: string;
}

export interface RecoveryDecision {
  opportunityId: string;
  playType: RecoveryPlayType | null;
  eligible: boolean;
  suppressionReason: string | null;
  scores: OpportunityScores;
  nextBestAction: NextBestAction;
  policyVersion: string;
  idempotencyKey: string;
  decidedAt: string;
}

export interface RecoveryDecisionRecord extends RecoveryDecision {
  id: string;
  tenantId: string;
  executedAt: string | null;
  executionState: 'OBSERVED' | 'SUGGESTED' | 'PENDING_APPROVAL' | 'EXECUTED' | 'SUPPRESSED';
}

export interface RecoveryEvaluationRecord {
  decision: RecoveryDecisionRecord;
  action: RecoveryActionRecord;
}

export interface RevenueCommandCenterRecord {
  potentialRecoveredRevenueCents: number;
  actualRecoveredRevenueCents: number;
  influencedRevenueCents: number;
  revenueAtRiskCents: number;
  recoveredJobs: number;
  recoveredBookings: number;
  activeOpportunities: number;
  humanInterventionRequired: number;
  averageRecoveryTimeHours: number | null;
  opportunitiesAtRisk: OpportunityRecord[];
}

export interface OpportunityDetailRecord {
  opportunity: OpportunityRecord;
  recoveryDecisions: RecoveryDecisionRecord[];
  recoveryActions: RecoveryActionRecord[];
  revenueEvents: RevenueLedgerEntry[];
  customer: CustomerRecord;
  conversation: ConversationRecord | null;
  booking: OpportunityBookingSummary | null;
  estimate: OpportunityEstimateSummary | null;
  job: OpportunityJobSummary | null;
  activeHandoff: HumanHandoffRecord | null;
}

export interface OpportunityBookingSummary {
  id: string;
  status: string;
  startAt: string;
  endAt: string;
  totalCents: number;
}

export interface OpportunityEstimateSummary {
  id: string;
  status: string;
  totalCents: number;
  createdAt: string;
}

export interface OpportunityJobSummary {
  id: string;
  status: string;
  scheduledStartAt: string | null;
  totalCents: number;
}

const allowedStatusTransitions: Record<OpportunityStatus, readonly OpportunityStatus[]> = {
  NEW: ['CONTACTING', 'ENGAGED', 'QUALIFIED', 'BOOKED', 'SNOOZED', 'LOST', 'DO_NOT_CONTACT'],
  CONTACTING: ['ENGAGED', 'QUALIFIED', 'BOOKED', 'ESTIMATE', 'SNOOZED', 'LOST', 'DO_NOT_CONTACT'],
  ENGAGED: ['CONTACTING', 'QUALIFIED', 'BOOKED', 'ESTIMATE', 'SNOOZED', 'LOST', 'DO_NOT_CONTACT'],
  QUALIFIED: ['CONTACTING', 'BOOKED', 'ESTIMATE', 'SNOOZED', 'LOST', 'DO_NOT_CONTACT'],
  BOOKED: ['ENGAGED', 'ESTIMATE', 'WON', 'LOST', 'SNOOZED', 'DO_NOT_CONTACT'],
  ESTIMATE: ['CONTACTING', 'ENGAGED', 'BOOKED', 'WON', 'LOST', 'SNOOZED', 'DO_NOT_CONTACT'],
  WON: [],
  LOST: ['CONTACTING', 'ENGAGED', 'QUALIFIED', 'SNOOZED', 'DO_NOT_CONTACT'],
  SNOOZED: ['CONTACTING', 'ENGAGED', 'QUALIFIED', 'LOST', 'DO_NOT_CONTACT'],
  DO_NOT_CONTACT: [],
};

export function assertOpportunityTransition(from: OpportunityStatus, to: OpportunityStatus): void {
  if (from === to) return;
  if (!allowedStatusTransitions[from].includes(to)) {
    throw new Error(`INVALID_OPPORTUNITY_TRANSITION:${from}:${to}`);
  }
}

export function assertOpportunityState(status: OpportunityStatus, recoveryState: RecoveryState): void {
  if (status === 'WON' && !['RECOVERED', 'NOT_AT_RISK'].includes(recoveryState)) {
    throw new Error('WON_OPPORTUNITY_CANNOT_REMAIN_AT_RISK');
  }
  if (status === 'DO_NOT_CONTACT' && recoveryState !== 'STOPPED') {
    throw new Error('DO_NOT_CONTACT_REQUIRES_STOPPED_RECOVERY');
  }
  if (['WON', 'DO_NOT_CONTACT'].includes(status) && recoveryState === 'RECOVERY_ACTIVE') {
    throw new Error('CLOSED_OPPORTUNITY_CANNOT_RUN_RECOVERY');
  }
}
