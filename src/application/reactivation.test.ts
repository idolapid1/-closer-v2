import { describe, expect, it } from 'vitest';
import {
  ActivityType,
  FollowUpScenario,
  FollowUpStatus,
  LeadStatus,
  MessagePurpose,
  NextActionStatus,
  NextActionType,
} from '../domain/entities';
import { createHarness } from '../test/harness';

function makeLostLeadEligible() {
  const harness = createHarness();
  const lead = harness.database.repositories.leads.get(
    'biz-clinic',
    'biz-clinic-lead-lost',
  )!;
  harness.database.repositories.leads.save('biz-clinic', {
    ...lead,
    updatedAt: '2026-05-01T08:00:00.000Z',
    closedAt: '2026-05-01T08:00:00.000Z',
  });
  return harness;
}

describe('consent-safe reactivation foundation', () => {
  it('prioritizes only eligible inactive opportunities without inventing value', () => {
    const { service } = makeLostLeadEligible();

    expect(service.reactivationCandidates('biz-clinic')).toEqual([
      expect.objectContaining({
        leadId: 'biz-clinic-lead-lost',
        reason: 'PAST_INTEREST',
        knownValueCents: null,
      }),
    ]);
    expect(service.reactivationCandidates('biz-detailing')).toEqual([]);
  });

  it('requires owner approval, respects cadence, and prepares one idempotent follow-up', () => {
    const { service, database } = makeLostLeadEligible();

    const first = service.prepareReactivation(
      'biz-clinic',
      'biz-clinic-lead-lost',
      'owner-reactivation-1',
    );
    const second = service.prepareReactivation(
      'biz-clinic',
      'biz-clinic-lead-lost',
      'owner-reactivation-1',
    );

    expect(second.id).toBe(first.id);
    expect(first.scenario).toBe(FollowUpScenario.Reactivation);
    expect(first.purpose).toBe(MessagePurpose.Marketing);
    expect(first.dueAt).toBe('2026-08-13T12:00:00.000Z');
    expect(first.draftMessage).toContain('רוני אברהם');
    expect(database.repositories.leads.get('biz-clinic', 'biz-clinic-lead-lost')?.status).toBe(
      LeadStatus.Active,
    );
    const actions = database.repositories.nextActions.find(
      'biz-clinic',
      (action) =>
        action.leadId === 'biz-clinic-lead-lost' &&
        action.status === NextActionStatus.Pending,
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]?.type).toBe(NextActionType.FutureReactivation);
    expect(
      database.repositories.scheduledFollowUps.find(
        'biz-clinic',
        (followUp) =>
          followUp.scenario === FollowUpScenario.Reactivation &&
          followUp.status === FollowUpStatus.Scheduled,
      ),
    ).toHaveLength(1);
    expect(
      database.repositories.activities.find(
        'biz-clinic',
        (activity) => activity.type === ActivityType.ReactivationPrepared,
      ),
    ).toHaveLength(1);
  });

  it('blocks opted-out customers and cross-tenant opportunity ids', () => {
    const { service, database } = makeLostLeadEligible();
    const consent = database.repositories.consentRecords.get(
      'biz-clinic',
      'biz-clinic-consent-lost',
    )!;
    database.repositories.consentRecords.save('biz-clinic', {
      ...consent,
      optedOut: true,
      marketingAllowed: false,
    });

    expect(service.reactivationCandidates('biz-clinic')).toEqual([]);
    expect(() =>
      service.prepareReactivation('biz-clinic', 'biz-clinic-lead-lost'),
    ).toThrowError(expect.objectContaining({ code: 'REACTIVATION_NOT_ELIGIBLE' }));
    expect(() =>
      service.prepareReactivation('biz-detailing', 'biz-clinic-lead-lost'),
    ).toThrowError(expect.objectContaining({ code: 'REACTIVATION_NOT_ELIGIBLE' }));
  });
});
