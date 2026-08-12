import { describe, expect, it } from 'vitest';
import { AppointmentStatus, PaymentReferenceType, RevenueStage } from '../domain/entities';
import { createHarness } from '../test/harness';

function createAppointment() {
  const harness = createHarness();
  const appointment = harness.service.createAppointment({
    businessId: 'biz-clinic',
    contactId: 'biz-clinic-contact-new',
    leadId: 'biz-clinic-lead-new',
    serviceId: 'biz-clinic-service-1',
    staffId: 'biz-clinic-owner',
    startAt: '2026-08-13T09:00:00.000Z',
  });
  return { ...harness, appointment };
}

describe('appointment workflow', () => {
  it('returns available slots and prevents overlapping staff bookings', () => {
    const { service } = createAppointment();
    const slots = service.getAvailableSlots(
      'biz-clinic',
      'biz-clinic-service-1',
      'biz-clinic-owner',
      '2026-08-13',
    );
    expect(slots).not.toContain('2026-08-13T09:00:00.000Z');
    expect(() =>
      service.createAppointment({
        businessId: 'biz-clinic',
        contactId: 'biz-clinic-contact-waiting',
        leadId: 'biz-clinic-lead-waiting',
        serviceId: 'biz-clinic-service-1',
        staffId: 'biz-clinic-owner',
        startAt: '2026-08-13T09:30:00.000Z',
      }),
    ).toThrowError(expect.objectContaining({ code: 'DOUBLE_BOOKING' }));
  });

  it('records an appointment deposit exactly once and supports confirmation', () => {
    const { service, database, appointment } = createAppointment();
    const first = service.recordDeposit('biz-clinic', PaymentReferenceType.Appointment, appointment.id);
    const second = service.recordDeposit('biz-clinic', PaymentReferenceType.Appointment, appointment.id);
    expect(second.id).toBe(first.id);
    expect(
      database.repositories.payments.find('biz-clinic', (payment) => payment.referenceId === appointment.id),
    ).toHaveLength(1);
    expect(
      database.repositories.revenueEvents.find(
        'biz-clinic',
        (event) => event.referenceId === appointment.id && event.stage === RevenueStage.Collected,
      ),
    ).toHaveLength(1);
    expect(service.confirmAppointment('biz-clinic', appointment.id).status).toBe(AppointmentStatus.Confirmed);
  });

  it('keeps completion distinct from collection and updates balance when collected', () => {
    const { service, database, appointment } = createAppointment();
    service.recordDeposit('biz-clinic', PaymentReferenceType.Appointment, appointment.id);
    service.confirmAppointment('biz-clinic', appointment.id);
    service.completeAppointment('biz-clinic', appointment.id);
    expect(service.balance('biz-clinic', PaymentReferenceType.Appointment, appointment.id)).toBe(31_500);
    expect(
      database.repositories.revenueEvents.find(
        'biz-clinic',
        (event) => event.referenceId === appointment.id && event.stage === RevenueStage.Completed,
      ),
    ).toHaveLength(1);
    expect(
      database.repositories.revenueEvents
        .find('biz-clinic', (event) => event.referenceId === appointment.id && event.stage === RevenueStage.Collected)
        .reduce((sum, event) => sum + event.amountCents, 0),
    ).toBe(10_500);

    service.collectRemainingBalance('biz-clinic', PaymentReferenceType.Appointment, appointment.id);
    expect(service.balance('biz-clinic', PaymentReferenceType.Appointment, appointment.id)).toBe(0);
    expect(database.repositories.leads.get('biz-clinic', appointment.leadId)?.status).toBe('WON');
    expect(database.repositories.leads.get('biz-clinic', appointment.leadId)?.nextActionId).toBeNull();
  });
});
