// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  RecoveryEngine,
  recoveryActionStatus,
  recoveryStateAfterDecision,
} from './application/recoveryEngine.js';
import { OpportunityScoringService } from './application/opportunityScoring.js';
import {
  assertOpportunityState,
  assertOpportunityTransition,
  type OpportunityObservation,
  type OpportunityRecord,
} from './domain/opportunity.js';

const NOW = '2026-08-30T14:00:00.000Z';

describe('HVAC opportunity lifecycle', () => {
  it('allows explicit commercial progression and rejects impossible transitions', () => {
    expect(() => assertOpportunityTransition('NEW', 'CONTACTING')).not.toThrow();
    expect(() => assertOpportunityTransition('ESTIMATE', 'BOOKED')).not.toThrow();
    expect(() => assertOpportunityTransition('WON', 'CONTACTING')).toThrow('INVALID_OPPORTUNITY_TRANSITION');
    expect(() => assertOpportunityTransition('DO_NOT_CONTACT', 'ENGAGED')).toThrow('INVALID_OPPORTUNITY_TRANSITION');
  });

  it('keeps recovery state compatible with commercial truth', () => {
    expect(() => assertOpportunityState('WON', 'RECOVERED')).not.toThrow();
    expect(() => assertOpportunityState('WON', 'AT_RISK')).toThrow('WON_OPPORTUNITY_CANNOT_REMAIN_AT_RISK');
    expect(() => assertOpportunityState('DO_NOT_CONTACT', 'RECOVERY_ACTIVE')).toThrow('DO_NOT_CONTACT_REQUIRES_STOPPED_RECOVERY');
  });
});

describe('explainable opportunity scoring', () => {
  const scoring = new OpportunityScoringService();

  it('separates intent, revenue, recovery, and urgency with stable reasons', () => {
    const scores = scoring.score(observation({
      source: 'MISSED_CALL',
      opportunityType: 'EMERGENCY_REPAIR',
      estimatedValueCents: 850_000,
      averageTicketCents: 300_000,
      hasCustomerReply: true,
      hasExplicitServiceIntent: true,
      hasBookingRequest: true,
      lastCustomerActivityAt: '2026-08-30T13:15:00.000Z',
    }));
    expect(scores.intent.value).toBeGreaterThanOrEqual(90);
    expect(scores.revenue.reasonCodes).toContain('HIGH_VALUE');
    expect(scores.recovery.reasonCodes).toContain('RECENT_CUSTOMER_ACTIVITY');
    expect(scores.urgency.reasonCodes).toEqual(expect.arrayContaining(['EMERGENCY_SERVICE', 'MISSED_INBOUND_CALL']));
    expect(new Set([scores.intent.version, scores.revenue.version, scores.recovery.version, scores.urgency.version]).size).toBe(1);
  });

  it('does not present opted-out or explicitly rejected leads as recoverable', () => {
    const scores = scoring.score(observation({ optedOut: true, hasExplicitRejection: true }));
    expect(scores.recovery.value).toBe(0);
    expect(scores.recovery.reasonCodes).toEqual(expect.arrayContaining(['CONTACT_SUPPRESSED', 'EXPLICIT_REJECTION']));
  });
});

describe('recovery engine', () => {
  const engine = new RecoveryEngine();

  it.each([
    ['MISSED_CALL', false, 'NEW', 'MISSED_CALL_RECOVERY'],
    ['WEBSITE_FORM', false, 'NEW', 'NEW_LEAD_RECOVERY'],
    ['WEBSITE_FORM', true, 'ESTIMATE', 'UNSOLD_ESTIMATE_RECOVERY'],
    ['IMPORT', false, 'LOST', 'OLD_LEAD_REACTIVATION'],
  ] as const)('selects the %s recovery play deterministically', (source, hasEstimate, status, expectedPlay) => {
    const opportunity = record({ source, status });
    const decision = engine.evaluate({
      opportunity,
      observation: observation({ source, status, hasEstimate }),
      operationKey: `evaluate:${expectedPlay}`,
    });
    expect(decision.playType).toBe(expectedPlay);
    expect(decision.eligible).toBe(true);
    expect(decision.policyVersion).toBe('hvac-recovery-v1');
  });

  it.each([
    [{ optedOut: true }, 'CONTACT_SUPPRESSED'],
    [{ withinContactWindow: false }, 'OUTSIDE_CONTACT_WINDOW'],
    [{ hasActiveHandoff: true }, 'HUMAN_TAKEOVER_ACTIVE'],
    [{ recoveryState: 'RECOVERY_ACTIVE' as const }, 'RECOVERY_ALREADY_ACTIVE'],
  ])('suppresses unsafe or duplicate automation', (overrides, expectedReason) => {
    const opportunity = record();
    const decision = engine.evaluate({
      opportunity,
      observation: observation(overrides),
      operationKey: `suppressed:${expectedReason}`,
    });
    expect(decision.eligible).toBe(false);
    expect(decision.suppressionReason).toBe(expectedReason);
  });

  it('routes Human Takeover to the owner instead of sending', () => {
    const opportunity = record({ recoveryState: 'HUMAN_REQUIRED' });
    const decision = engine.evaluate({
      opportunity,
      observation: observation({ recoveryState: 'HUMAN_REQUIRED', humanRequired: true }),
      operationKey: 'human-review-1',
    });
    expect(decision.nextBestAction).toMatchObject({ kind: 'REQUEST_HUMAN', requiresApproval: false });
  });

  it('keeps active recovery monotonic and reserves STOPPED for explicit stop reasons', () => {
    const activeOpportunity = record({ recoveryState: 'RECOVERY_ACTIVE' });
    const repeated = engine.evaluate({
      opportunity: activeOpportunity,
      observation: observation({ recoveryState: 'RECOVERY_ACTIVE' }),
      operationKey: 'repeat-active-recovery',
    });
    expect(repeated).toMatchObject({ eligible: false, suppressionReason: 'RECOVERY_ALREADY_ACTIVE' });
    expect(recoveryStateAfterDecision(activeOpportunity, repeated)).toBe('RECOVERY_ACTIVE');

    const outsideWindow = engine.evaluate({
      opportunity: record(),
      observation: observation({ withinContactWindow: false }),
      operationKey: 'outside-contact-window',
    });
    expect(recoveryStateAfterDecision(record(), outsideWindow)).toBe('AT_RISK');

    const contactStopped = engine.evaluate({
      opportunity: record(),
      observation: observation({ optedOut: true }),
      operationKey: 'contact-stopped',
    });
    expect(contactStopped.suppressionReason).toBe('CONTACT_SUPPRESSED');
    expect(recoveryStateAfterDecision(record(), contactStopped)).toBe('STOPPED');
  });

  it('enforces autonomy without allowing high-value AUTOPILOT to bypass approval', () => {
    const observeOpportunity = record({ autonomyLevel: 'OBSERVE' });
    const observeDecision = engine.evaluate({
      opportunity: observeOpportunity,
      observation: observation(),
      operationKey: 'observe-action',
    });
    expect(recoveryActionStatus(observeOpportunity, observeDecision)).toBe('PENDING');

    const suggestOpportunity = record({ autonomyLevel: 'SUGGEST' });
    const suggestDecision = engine.evaluate({
      opportunity: suggestOpportunity,
      observation: observation(),
      operationKey: 'suggest-action',
    });
    expect(recoveryActionStatus(suggestOpportunity, suggestDecision)).toBe('PENDING');

    const approvalOpportunity = record({ autonomyLevel: 'APPROVE_TO_SEND' });
    const approvalDecision = engine.evaluate({
      opportunity: approvalOpportunity,
      observation: observation(),
      operationKey: 'approval-action',
    });
    expect(recoveryActionStatus(approvalOpportunity, approvalDecision)).toBe('WAITING_APPROVAL');

    const safeAutopilot = record({ autonomyLevel: 'AUTOPILOT', estimatedValueCents: 250_000 });
    const safeDecision = engine.evaluate({
      opportunity: safeAutopilot,
      observation: observation({ estimatedValueCents: 250_000 }),
      operationKey: 'autopilot-safe-action',
    });
    expect(safeDecision.nextBestAction.requiresApproval).toBe(false);
    expect(recoveryActionStatus(safeAutopilot, safeDecision)).toBe('READY');

    const highValueAutopilot = record({ autonomyLevel: 'AUTOPILOT', estimatedValueCents: 1_000_000 });
    const highValueDecision = engine.evaluate({
      opportunity: highValueAutopilot,
      observation: observation({ estimatedValueCents: 1_000_000 }),
      operationKey: 'autopilot-high-value-action',
    });
    expect(highValueDecision.nextBestAction.requiresApproval).toBe(true);
    expect(recoveryActionStatus(highValueAutopilot, highValueDecision)).toBe('WAITING_APPROVAL');
  });
});

function observation(overrides: Partial<OpportunityObservation> = {}): OpportunityObservation {
  return {
    now: NOW,
    source: 'WEBSITE_FORM',
    status: 'NEW',
    recoveryState: 'AT_RISK',
    opportunityType: 'STANDARD_REPAIR',
    estimatedValueCents: 250_000,
    averageTicketCents: 300_000,
    lastCustomerActivityAt: '2026-08-30T12:00:00.000Z',
    lastBusinessActivityAt: null,
    hasCustomerReply: false,
    hasExplicitServiceIntent: true,
    hasBookingRequest: false,
    hasEstimate: false,
    estimateViewedCount: 0,
    estimateCreatedAt: null,
    hasExplicitRejection: false,
    hasActiveHandoff: false,
    humanRequired: false,
    optedOut: false,
    operationalCommunicationAllowed: true,
    withinContactWindow: true,
    followUpAttempts: 0,
    hasOtherActiveOpportunity: false,
    ...overrides,
  };
}

function record(overrides: Partial<OpportunityRecord> = {}): OpportunityRecord {
  const emptyScore = { value: 0, reasonCodes: [], explanation: '', version: 'unscored' };
  return {
    id: 'opportunity-a',
    tenantId: 'tenant-a',
    customerId: 'customer-a',
    leadId: 'lead-a',
    conversationId: 'conversation-a',
    source: 'WEBSITE_FORM',
    opportunityType: 'STANDARD_REPAIR',
    estimatedValueCents: 250_000,
    currency: 'USD',
    scores: { intent: emptyScore, revenue: emptyScore, recovery: emptyScore, urgency: emptyScore },
    status: 'NEW',
    recoveryState: 'AT_RISK',
    autonomyLevel: 'SUGGEST',
    assignedHumanId: null,
    lastCustomerActivityAt: null,
    lastBusinessActivityAt: null,
    nextActionAt: null,
    bookingId: null,
    estimateId: null,
    jobId: null,
    wonAt: null,
    lostAt: null,
    lostReason: null,
    revenueAttributedCents: 0,
    attributionType: null,
    attributionReason: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}
