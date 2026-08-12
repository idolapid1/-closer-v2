import { describe, expect, it } from 'vitest';
import {
  AppointmentStatus,
  PaymentKind,
  PaymentReferenceType,
  RevenueStage,
} from '../domain/entities';
import { createHarness } from '../test/harness';

function paidAppointment() {
  const harness = createHarness();
  const appointment = harness.service.createAppointment({
    businessId: 'biz-clinic',
    contactId: 'biz-clinic-contact-new',
    leadId: 'biz-clinic-lead-new',
    serviceId: 'biz-clinic-service-1',
    staffId: 'biz-clinic-owner',
    startAt: '2026-08-13T11:00:00.000Z',
  });
  const payment = harness.service.recordDeposit(
    'biz-clinic',
    PaymentReferenceType.Appointment,
    appointment.id,
  );
  return { ...harness, appointment, payment };
}

describe('financial truth', () => {
  it('refunds collected cash and increases the remaining balance', () => {
    const { service, database, appointment, payment } = paidAppointment();
    const before = service.balance('biz-clinic', PaymentReferenceType.Appointment, appointment.id);
    service.recordPayment({
      businessId: 'biz-clinic',
      contactId: appointment.contactId,
      referenceType: PaymentReferenceType.Appointment,
      referenceId: appointment.id,
      kind: PaymentKind.Refund,
      amountCents: 5_000,
      idempotencyKey: `${appointment.id}:refund-1`,
      originalPaymentId: payment.id,
    });
    expect(service.balance('biz-clinic', PaymentReferenceType.Appointment, appointment.id)).toBe(before + 5_000);
    expect(
      database.repositories.revenueEvents.find(
        'biz-clinic',
        (event) => event.referenceId === appointment.id && event.stage === RevenueStage.Refunded,
      )[0]?.amountCents,
    ).toBe(5_000);
  });

  it('makes payment and revenue events idempotent and rejects conflicting reuse', () => {
    const { service, database, appointment } = paidAppointment();
    service.completeAppointment('biz-clinic', appointment.id);
    service.completeAppointment('biz-clinic', appointment.id);
    expect(database.repositories.appointments.get('biz-clinic', appointment.id)?.status).toBe(AppointmentStatus.Completed);
    expect(
      database.repositories.revenueEvents.find(
        'biz-clinic',
        (event) => event.causationId === `${appointment.id}:completed`,
      ),
    ).toHaveLength(1);
    expect(() =>
      service.recordPayment({
        businessId: 'biz-clinic',
        contactId: appointment.contactId,
        referenceType: PaymentReferenceType.Appointment,
        referenceId: appointment.id,
        kind: PaymentKind.Balance,
        amountCents: 1_000,
        idempotencyKey: `${appointment.id}:deposit`,
      }),
    ).toThrowError(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }));
  });
});
