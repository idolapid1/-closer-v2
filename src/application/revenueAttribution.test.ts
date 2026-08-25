import { describe, expect, it } from 'vitest';
import {
  ActivityType,
  PaymentKind,
  PaymentReferenceType,
  RevenueAttributionKind,
  RevenueAttributionStatus,
  RevenueStage,
} from '../domain/entities';
import { createHarness } from '../test/harness';

function collectedAppointment() {
  const harness = createHarness();
  const appointment = harness.service.createAppointment({
    businessId: 'biz-clinic',
    contactId: 'biz-clinic-contact-new',
    leadId: 'biz-clinic-lead-new',
    serviceId: 'biz-clinic-service-1',
    staffId: 'biz-clinic-owner',
    startAt: '2026-08-13T09:00:00.000Z',
    operationKey: 'attribution-appointment',
  });
  const payment = harness.service.recordDeposit(
    'biz-clinic',
    PaymentReferenceType.Appointment,
    appointment.id,
    'attribution-deposit',
  );
  const revenueEvent = harness.database.repositories.revenueEvents.find(
    'biz-clinic',
    (event) =>
      event.referenceId === appointment.id && event.stage === RevenueStage.Collected,
  )[0]!;
  const evidence = harness.database.repositories.activities.find(
    'biz-clinic',
    (activity) =>
      activity.conversationId === 'biz-clinic-conversation-new' &&
      activity.type === ActivityType.AppointmentCreated,
  )[0]!;
  return { ...harness, appointment, payment, revenueEvent, evidence };
}

describe('auditable revenue attribution', () => {
  it('verifies collected revenue once and exposes only verified CLOSER value', () => {
    const { service, database, revenueEvent, evidence } = collectedAppointment();
    const input = {
      businessId: 'biz-clinic',
      revenueEventId: revenueEvent.id,
      kind: RevenueAttributionKind.Generated,
      contributingActivityIds: [evidence.id],
      operationKey: 'verify-attribution-1',
      verifiedByTeamMemberId: 'biz-clinic-owner',
    };

    const first = service.verifyRevenueAttribution(input);
    const second = service.verifyRevenueAttribution(input);

    expect(second.id).toBe(first.id);
    expect(first.attributionStatus).toBe(RevenueAttributionStatus.Verified);
    expect(first.leadId).toBe('biz-clinic-lead-new');
    expect(first.conversationId).toBe('biz-clinic-conversation-new');
    expect(service.productRevenueOverview('biz-clinic').attribution).toEqual({
      status: 'AVAILABLE',
      generatedByCloserCents: first.amountCents,
      recoveredByCloserCents: 0,
    });
    expect(
      database.repositories.activities.find(
        'biz-clinic',
        (activity) => activity.type === ActivityType.RevenueAttributionVerified,
      ),
    ).toHaveLength(1);
  });

  it('rejects non-collected events and cross-context evidence', () => {
    const { service, database, appointment, evidence } = collectedAppointment();
    const booked = database.repositories.revenueEvents.find(
      'biz-clinic',
      (event) => event.referenceId === appointment.id && event.stage === RevenueStage.Booked,
    )[0]!;

    expect(() =>
      service.verifyRevenueAttribution({
        businessId: 'biz-clinic',
        revenueEventId: booked.id,
        kind: RevenueAttributionKind.Generated,
        contributingActivityIds: [evidence.id],
        operationKey: 'verify-booked',
      }),
    ).toThrowError(expect.objectContaining({ code: 'ATTRIBUTION_REQUIRES_COLLECTION' }));

    const foreignEvidence = database.repositories.activities.list('biz-detailing')[0]!;
    expect(() =>
      service.verifyRevenueAttribution({
        businessId: 'biz-clinic',
        revenueEventId: database.repositories.revenueEvents.find(
          'biz-clinic',
          (event) =>
            event.referenceId === appointment.id && event.stage === RevenueStage.Collected,
        )[0]!.id,
        kind: RevenueAttributionKind.Generated,
        contributingActivityIds: [foreignEvidence.id],
        operationKey: 'verify-foreign-evidence',
      }),
    ).toThrowError(expect.objectContaining({ code: 'ATTRIBUTION_EVIDENCE_MISMATCH' }));
  });

  it('nets valid refunds out of verified attributed collection', () => {
    const { service, appointment, payment, revenueEvent, evidence } = collectedAppointment();
    service.verifyRevenueAttribution({
      businessId: 'biz-clinic',
      revenueEventId: revenueEvent.id,
      kind: RevenueAttributionKind.Recovered,
      contributingActivityIds: [evidence.id],
      operationKey: 'verify-recovered',
    });
    service.recordPayment({
      businessId: 'biz-clinic',
      contactId: appointment.contactId,
      referenceType: PaymentReferenceType.Appointment,
      referenceId: appointment.id,
      kind: PaymentKind.Refund,
      amountCents: 1_000,
      idempotencyKey: 'attribution-refund',
      originalPaymentId: payment.id,
    });

    expect(service.productRevenueOverview('biz-clinic').attribution).toEqual({
      status: 'AVAILABLE',
      generatedByCloserCents: 0,
      recoveredByCloserCents: revenueEvent.amountCents - 1_000,
    });
  });
});
