import { describe, expect, it } from 'vitest';
import {
  ActivityType,
  ConversationMode,
  CustomerFactKey,
  FollowUpStatus,
  JobStatus,
  LeadStatus,
  HandoffReason,
  NextActionStatus,
  NextActionType,
  OpportunityLostReason,
  PaymentKind,
  PaymentReferenceType,
  QuoteStatus,
} from '../domain/entities';
import { LocalDatabase, MemoryStorageAdapter, STORAGE_KEY } from '../infrastructure/persistence';
import { SCHEMA_VERSION } from '../repositories/contracts';
import { DEMO_DATABASE } from '../data/demoData';
import { MockAIProvider } from '../integrations/ai/MockAIProvider';
import { MockWhatsAppProvider } from '../integrations/messaging/MockWhatsAppProvider';
import { CloserService } from './CloserService';
import { createHarness } from '../test/harness';

const CLINIC = 'biz-clinic';
const DETAILING = 'biz-detailing';
const HOME = 'biz-home';

describe('Phase 3 end-to-end commercial journeys', () => {
  it('moves an appointment inquiry through deposit, completion, collection, and closed won', async () => {
    const { service, database } = createHarness();
    const opportunity = service.createCustomerOpportunity({ businessId: CLINIC, displayName: 'Noa Test' });
    await service.receiveCustomerMessage(CLINIC, opportunity.conversation.id, 'I want a signature facial on 2026-08-20, first time', { providerMessageId: 'clinic-e2e-message' });
    service.selectServiceForLead(CLINIC, opportunity.lead.id, `${CLINIC}-service-1`);
    service.rememberCustomerFact(CLINIC, opportunity.contact.id, CustomerFactKey.CustomerType, 'first-time');
    service.rememberCustomerFact(CLINIC, opportunity.contact.id, CustomerFactKey.PreferredDate, '2026-08-20');
    expect(service.reconcileOpportunity(CLINIC, opportunity.lead.id).stage).toBe('APPOINTMENT_PROPOSED');
    expect(currentAction(database, CLINIC, opportunity.lead.id)?.type).toBe(NextActionType.OfferAppointment);
    const appointment = service.createAppointment({
      businessId: CLINIC,
      contactId: opportunity.contact.id,
      leadId: opportunity.lead.id,
      serviceId: `${CLINIC}-service-1`,
      staffId: `${CLINIC}-owner`,
      startAt: '2026-08-20T09:00:00.000Z',
      operationKey: 'clinic-e2e-appointment',
    });
    expect(currentAction(database, CLINIC, opportunity.lead.id)?.type).toBe(NextActionType.RequestDeposit);
    const firstDeposit = service.recordDeposit(CLINIC, PaymentReferenceType.Appointment, appointment.id, 'clinic-e2e-deposit');
    expect(service.recordDeposit(CLINIC, PaymentReferenceType.Appointment, appointment.id, 'clinic-e2e-deposit').id).toBe(firstDeposit.id);
    service.confirmAppointment(CLINIC, appointment.id);
    expect(service.opportunity(CLINIC, opportunity.lead.id).stage).toBe('BOOKED');
    service.completeAppointment(CLINIC, appointment.id);
    expect(service.opportunity(CLINIC, opportunity.lead.id).remainingBalanceCents).toBe(31_500);
    expect(currentAction(database, CLINIC, opportunity.lead.id)?.type).toBe(NextActionType.CollectBalance);
    service.collectRemainingBalance(CLINIC, PaymentReferenceType.Appointment, appointment.id, 'clinic-e2e-balance');
    const settled = service.opportunity(CLINIC, opportunity.lead.id);
    expect(settled.leadStatus).toBe(LeadStatus.Won);
    expect(settled.remainingBalanceCents).toBe(0);
    expect(database.repositories.nextActions.find(CLINIC, (action) => action.leadId === opportunity.lead.id && action.status === NextActionStatus.Pending)).toHaveLength(0);
    expect(database.repositories.scheduledFollowUps.find(CLINIC, (followUp) => followUp.conversationId === opportunity.conversation.id && followUp.status === FollowUpStatus.Scheduled)).toHaveLength(0);
    const activities = service.activityTimeline(CLINIC, opportunity.contact.id);
    expect(activities.map((activity) => activity.type)).toEqual(expect.arrayContaining([
      ActivityType.AppointmentCreated,
      ActivityType.DepositCollected,
      ActivityType.AppointmentConfirmed,
      ActivityType.AppointmentCompleted,
      ActivityType.BalanceCollected,
      ActivityType.OpportunityWon,
    ]));
    expect(activities).toEqual([...activities].sort((first, second) => first.occurredAt.localeCompare(second.occurredAt) || first.id.localeCompare(second.id)));
  });

  it.each([
    [DETAILING, 'Full detail', 100_000],
    [HOME, 'Repair leaking sink', 160_000],
  ])('moves %s from quote draft through accepted job and full collection', (businessId, description, totalCents) => {
    const { service, database } = createHarness();
    const created = service.createCustomerOpportunity({ businessId, displayName: `Journey ${businessId}` });
    service.selectServiceForLead(businessId, created.lead.id, `${businessId}-service-1`);
    if (businessId === HOME) {
      service.rememberCustomerFact(businessId, created.contact.id, CustomerFactKey.Address, '10 Test Street');
    }
    const quote = service.createQuoteDraft({
      businessId,
      contactId: created.contact.id,
      leadId: created.lead.id,
      items: [{ id: 'item', description, quantity: 1, unitPriceCents: totalCents }],
      operationKey: `${businessId}:e2e:quote`,
    });
    expect(currentAction(database, businessId, created.lead.id)?.type).toBe(NextActionType.SendQuote);
    service.sendQuote(businessId, quote.id);
    expect(currentAction(database, businessId, created.lead.id)?.type).toBe(NextActionType.FollowUpQuote);
    const job = service.acceptQuote(businessId, quote.id);
    if (businessId === HOME) expect(job.address).toBe('10 Test Street');
    expect(service.acceptQuote(businessId, quote.id).id).toBe(job.id);
    service.recordDeposit(businessId, PaymentReferenceType.Job, job.id, `${businessId}:e2e:deposit`);
    expect(currentAction(database, businessId, created.lead.id)?.type).toBe(NextActionType.ScheduleJob);
    service.scheduleJob(businessId, job.id, `${businessId}-owner`, '2026-08-21T09:00:00.000Z', '2026-08-21T12:00:00.000Z');
    service.completeJob(businessId, job.id);
    expect(service.opportunity(businessId, created.lead.id).remainingBalanceCents).toBe(Math.round(totalCents * 0.75));
    service.collectRemainingBalance(businessId, PaymentReferenceType.Job, job.id, `${businessId}:e2e:balance`);
    expect(service.opportunity(businessId, created.lead.id)).toMatchObject({ leadStatus: LeadStatus.Won, remainingBalanceCents: 0, stage: 'CLOSED_WON' });
  });

  it('supports appointment reschedule, cancellation, customer return, and idempotent activities', () => {
    const { service, database } = createHarness();
    const appointment = service.createAppointment({
      businessId: CLINIC,
      contactId: `${CLINIC}-contact-new`,
      leadId: `${CLINIC}-lead-new`,
      serviceId: `${CLINIC}-service-1`,
      staffId: `${CLINIC}-owner`,
      startAt: '2026-08-22T09:00:00.000Z',
      operationKey: 'recovery-appointment',
    });
    const same = service.createAppointment({
      businessId: CLINIC,
      contactId: `${CLINIC}-contact-new`,
      leadId: `${CLINIC}-lead-new`,
      serviceId: `${CLINIC}-service-1`,
      staffId: `${CLINIC}-owner`,
      startAt: '2026-08-22T09:00:00.000Z',
      operationKey: 'recovery-appointment',
    });
    expect(same.id).toBe(appointment.id);
    service.rescheduleAppointment(CLINIC, appointment.id, '2026-08-24T09:00:00.000Z');
    service.rescheduleAppointment(CLINIC, appointment.id, '2026-08-24T09:00:00.000Z');
    expect(database.repositories.activities.find(CLINIC, (activity) => activity.type === ActivityType.AppointmentRescheduled && activity.metadata.appointmentId === appointment.id)).toHaveLength(1);
    service.cancelAppointment(CLINIC, appointment.id);
    expect(database.repositories.leads.get(CLINIC, appointment.leadId)).toMatchObject({ status: LeadStatus.Lost, lostReason: OpportunityLostReason.Cancelled });
    expect(database.repositories.scheduledFollowUps.find(CLINIC, (followUp) => followUp.conversationId === `${CLINIC}-conversation-new` && followUp.status === FollowUpStatus.Scheduled)).toHaveLength(0);
    service.reopenOpportunity(CLINIC, appointment.leadId, 'customer-return');
    expect(database.repositories.leads.get(CLINIC, appointment.leadId)?.status).toBe(LeadStatus.Active);
    expect(currentAction(database, CLINIC, appointment.leadId)).not.toBeNull();
  });

  it('supports quote decline, return, job reschedule and cancellation without stale actions', () => {
    const { service, database } = createHarness();
    const created = service.createCustomerOpportunity({ businessId: DETAILING, displayName: 'Return customer' });
    const quote = service.createQuoteDraft({
      businessId: DETAILING,
      contactId: created.contact.id,
      leadId: created.lead.id,
      items: [{ id: 'q', description: 'Detail', quantity: 1, unitPriceCents: 80_000 }],
      operationKey: 'decline-return-quote',
    });
    service.sendQuote(DETAILING, quote.id);
    service.declineQuote(DETAILING, quote.id);
    expect(database.repositories.leads.get(DETAILING, created.lead.id)?.status).toBe(LeadStatus.Lost);
    expect(database.repositories.scheduledFollowUps.find(DETAILING, (followUp) => followUp.conversationId === created.conversation.id && followUp.status === FollowUpStatus.Scheduled)).toHaveLength(0);
    service.reopenOpportunity(DETAILING, created.lead.id, 'return-after-decline');
    const nextQuote = service.createQuoteDraft({
      businessId: DETAILING,
      contactId: created.contact.id,
      leadId: created.lead.id,
      items: [{ id: 'q2', description: 'Updated detail', quantity: 1, unitPriceCents: 90_000 }],
      operationKey: 'return-quote',
    });
    service.sendQuote(DETAILING, nextQuote.id);
    const job = service.acceptQuote(DETAILING, nextQuote.id);
    service.recordDeposit(DETAILING, PaymentReferenceType.Job, job.id, 'return-deposit');
    service.scheduleJob(DETAILING, job.id, `${DETAILING}-owner`, '2026-08-25T09:00:00.000Z', '2026-08-25T12:00:00.000Z');
    service.rescheduleJob(DETAILING, job.id, '2026-08-26T09:00:00.000Z', '2026-08-26T12:00:00.000Z');
    expect(database.repositories.jobs.get(DETAILING, job.id)?.scheduledStartAt).toBe('2026-08-26T09:00:00.000Z');
    service.cancelJob(DETAILING, job.id);
    expect(database.repositories.jobs.get(DETAILING, job.id)?.status).toBe(JobStatus.Cancelled);
    expect(database.repositories.leads.get(DETAILING, created.lead.id)?.status).toBe(LeadStatus.Lost);
  });

  it('enforces takeover during a journey and resumes the domain-derived action explicitly', () => {
    const { service, database } = createHarness();
    const quote = service.createQuoteDraft({
      businessId: DETAILING,
      contactId: `${DETAILING}-contact-new`,
      leadId: `${DETAILING}-lead-new`,
      items: [{ id: 'q', description: 'Detail', quantity: 1, unitPriceCents: 100_000 }],
      operationKey: 'handoff-quote',
    });
    service.sendQuote(DETAILING, quote.id);
    service.startHumanTakeover(DETAILING, `${DETAILING}-conversation-new`, HandoffReason.Manual, 'Owner review');
    expect(currentAction(database, DETAILING, `${DETAILING}-lead-new`)?.type).toBe(NextActionType.HumanReview);
    expect(database.repositories.scheduledFollowUps.find(DETAILING, (followUp) => followUp.conversationId === `${DETAILING}-conversation-new` && followUp.status === FollowUpStatus.Scheduled)).toHaveLength(0);
    service.resumeAssistant(DETAILING, `${DETAILING}-conversation-new`);
    expect(database.repositories.conversations.get(DETAILING, `${DETAILING}-conversation-new`)?.mode).toBe(ConversationMode.AiActive);
    expect(currentAction(database, DETAILING, `${DETAILING}-lead-new`)?.type).toBe(NextActionType.FollowUpQuote);
  });

  it('rejects cross-customer payments, wrong workflow links, and conflicting idempotency', () => {
    const { service, database } = createHarness();
    const appointment = service.createAppointment({
      businessId: CLINIC,
      contactId: `${CLINIC}-contact-new`,
      leadId: `${CLINIC}-lead-new`,
      serviceId: `${CLINIC}-service-1`,
      staffId: `${CLINIC}-owner`,
      startAt: '2026-08-27T09:00:00.000Z',
      operationKey: 'ownership-appointment',
    });
    expect(() => service.recordPayment({
      businessId: CLINIC,
      contactId: `${CLINIC}-contact-waiting`,
      referenceType: PaymentReferenceType.Appointment,
      referenceId: appointment.id,
      kind: PaymentKind.Deposit,
      amountCents: appointment.depositRequiredCents,
      idempotencyKey: 'wrong-customer-payment',
    })).toThrowError(expect.objectContaining({ code: 'CONTACT_MISMATCH' }));
    expect(database.repositories.payments.find(CLINIC, (payment) => payment.idempotencyKey === 'wrong-customer-payment')).toHaveLength(0);
    expect(() => service.createQuoteDraft({
      businessId: CLINIC,
      contactId: `${CLINIC}-contact-new`,
      leadId: `${CLINIC}-lead-new`,
      items: [{ id: 'bad', description: 'bad', quantity: 1, unitPriceCents: 100 }],
    })).toThrowError(expect.objectContaining({ code: 'WORKFLOW_MISMATCH' }));
    expect(() => service.createAppointment({
      businessId: CLINIC,
      contactId: `${CLINIC}-contact-new`,
      leadId: `${CLINIC}-lead-new`,
      serviceId: `${CLINIC}-service-1`,
      staffId: `${CLINIC}-owner`,
      startAt: '2026-08-28T09:00:00.000Z',
      operationKey: 'ownership-appointment',
    })).toThrowError(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }));
  });

  it('reopens a settled opportunity when a refund creates a real outstanding balance', () => {
    const { service, database } = createHarness();
    const appointment = service.createAppointment({
      businessId: CLINIC,
      contactId: `${CLINIC}-contact-new`,
      leadId: `${CLINIC}-lead-new`,
      serviceId: `${CLINIC}-service-1`,
      staffId: `${CLINIC}-owner`,
      startAt: '2026-08-31T09:00:00.000Z',
      operationKey: 'refund-reopen-appointment',
    });
    const deposit = service.recordDeposit(CLINIC, PaymentReferenceType.Appointment, appointment.id, 'refund-reopen-deposit');
    service.confirmAppointment(CLINIC, appointment.id);
    service.completeAppointment(CLINIC, appointment.id);
    service.collectRemainingBalance(CLINIC, PaymentReferenceType.Appointment, appointment.id, 'refund-reopen-balance');
    expect(database.repositories.leads.get(CLINIC, appointment.leadId)?.status).toBe(LeadStatus.Won);
    service.recordPayment({
      businessId: CLINIC,
      contactId: appointment.contactId,
      referenceType: PaymentReferenceType.Appointment,
      referenceId: appointment.id,
      kind: PaymentKind.Refund,
      amountCents: 2_000,
      idempotencyKey: 'refund-after-win',
      originalPaymentId: deposit.id,
    });
    expect(service.opportunity(CLINIC, appointment.leadId)).toMatchObject({ leadStatus: LeadStatus.Active, remainingBalanceCents: 2_000, stage: 'AWAITING_BALANCE' });
    expect(currentAction(database, CLINIC, appointment.leadId)?.type).toBe(NextActionType.CollectBalance);
    expect(database.repositories.scheduledFollowUps.find(CLINIC, (followUp) => followUp.conversationId === `${CLINIC}-conversation-new` && followUp.status === FollowUpStatus.Scheduled)).toHaveLength(1);
    expect(service.recordPayment({
      businessId: CLINIC,
      contactId: appointment.contactId,
      referenceType: PaymentReferenceType.Appointment,
      referenceId: appointment.id,
      kind: PaymentKind.Refund,
      amountCents: 2_000,
      idempotencyKey: 'refund-after-win',
      originalPaymentId: deposit.id,
    }).id).toBe(database.repositories.payments.find(CLINIC, (payment) => payment.idempotencyKey === 'refund-after-win')[0]?.id);
    expect(database.repositories.activities.find(CLINIC, (activity) => activity.type === ActivityType.RefundRecorded && activity.metadata.referenceId === appointment.id)).toHaveLength(1);
  });

  it('survives persistence restore mid-journey without duplicating state', () => {
    const storage = new MemoryStorageAdapter();
    const firstDatabase = new LocalDatabase(storage, structuredClone(DEMO_DATABASE));
    const first = new CloserService(firstDatabase, new MockAIProvider(), new MockWhatsAppProvider(), () => '2026-08-13T12:00:00.000Z', () => crypto.randomUUID());
    const quote = first.createQuoteDraft({
      businessId: HOME,
      contactId: `${HOME}-contact-new`,
      leadId: `${HOME}-lead-new`,
      items: [{ id: 'restore', description: 'Repair', quantity: 1, unitPriceCents: 120_000 }],
      operationKey: 'restore-quote',
    });
    first.sendQuote(HOME, quote.id);
    const restoredDatabase = new LocalDatabase(storage, structuredClone(DEMO_DATABASE));
    const restored = new CloserService(restoredDatabase, new MockAIProvider(), new MockWhatsAppProvider());
    expect(restoredDatabase.repositories.quotes.get(HOME, quote.id)?.status).toBe(QuoteStatus.Sent);
    expect(restored.actionCenter(HOME).some((action) => action.leadId === `${HOME}-lead-new` && action.actionType === NextActionType.FollowUpQuote)).toBe(true);
    expect(JSON.parse(storage.read(STORAGE_KEY) ?? '{}').schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('keeps complete journey projections tenant scoped', () => {
    const { service } = createHarness();
    expect(() => service.opportunity(HOME, `${DETAILING}-lead-new`)).toThrow();
    expect(() => service.activityTimeline(HOME, `${DETAILING}-contact-new`)).toThrow();
    expect(service.actionCenter(HOME).every((action) => action.businessId === HOME)).toBe(true);
  });

  it('rejects wrong-reference refunds and duplicate keys with changed payment facts', () => {
    const { service, database } = createHarness();
    const appointment = service.createAppointment({
      businessId: CLINIC,
      contactId: `${CLINIC}-contact-new`,
      leadId: `${CLINIC}-lead-new`,
      serviceId: `${CLINIC}-service-1`,
      staffId: `${CLINIC}-owner`,
      startAt: '2026-09-01T09:00:00.000Z',
      operationKey: 'refund-boundary-appointment',
    });
    const deposit = service.recordDeposit(CLINIC, PaymentReferenceType.Appointment, appointment.id, 'refund-boundary-deposit');
    expect(() => service.recordPayment({
      businessId: CLINIC,
      contactId: appointment.contactId,
      referenceType: PaymentReferenceType.Appointment,
      referenceId: appointment.id,
      kind: PaymentKind.Refund,
      amountCents: 1_000,
      idempotencyKey: 'refund-boundary-deposit',
      originalPaymentId: deposit.id,
    })).toThrowError(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }));
    const otherAppointment = service.createAppointment({
      businessId: CLINIC,
      contactId: `${CLINIC}-contact-waiting`,
      leadId: `${CLINIC}-lead-waiting`,
      serviceId: `${CLINIC}-service-1`,
      staffId: `${CLINIC}-owner`,
      startAt: '2026-09-02T09:00:00.000Z',
      operationKey: 'refund-boundary-other',
    });
    expect(() => service.recordPayment({
      businessId: CLINIC,
      contactId: otherAppointment.contactId,
      referenceType: PaymentReferenceType.Appointment,
      referenceId: otherAppointment.id,
      kind: PaymentKind.Refund,
      amountCents: 1_000,
      idempotencyKey: 'wrong-reference-refund',
      originalPaymentId: deposit.id,
    })).toThrowError(expect.objectContaining({ code: 'INVALID_REFUND' }));
    expect(database.repositories.payments.find(CLINIC, (payment) => payment.idempotencyKey === 'wrong-reference-refund')).toHaveLength(0);
  });

  it('validates job scheduling, explicit rescheduling, completion state, and schedule conflicts', () => {
    const { service } = createHarness();
    const first = service.createQuoteDraft({
      businessId: DETAILING,
      contactId: `${DETAILING}-contact-new`,
      leadId: `${DETAILING}-lead-new`,
      items: [{ id: 'one', description: 'Detail one', quantity: 1, unitPriceCents: 100_000 }],
      operationKey: 'schedule-first-quote',
    });
    service.sendQuote(DETAILING, first.id);
    const firstJob = service.acceptQuote(DETAILING, first.id);
    expect(() => service.completeJob(DETAILING, firstJob.id)).toThrowError(expect.objectContaining({ code: 'INVALID_JOB_STATE' }));
    service.recordDeposit(DETAILING, PaymentReferenceType.Job, firstJob.id, 'schedule-first-deposit');
    expect(() => service.scheduleJob(DETAILING, firstJob.id, `${DETAILING}-owner`, 'bad', 'also-bad')).toThrowError();
    service.scheduleJob(DETAILING, firstJob.id, `${DETAILING}-owner`, '2026-09-03T09:00:00.000Z', '2026-09-03T12:00:00.000Z');
    expect(service.scheduleJob(DETAILING, firstJob.id, `${DETAILING}-owner`, '2026-09-03T09:00:00.000Z', '2026-09-03T12:00:00.000Z').id).toBe(firstJob.id);
    expect(() => service.scheduleJob(DETAILING, firstJob.id, `${DETAILING}-owner`, '2026-09-04T09:00:00.000Z', '2026-09-04T12:00:00.000Z')).toThrowError(expect.objectContaining({ code: 'INVALID_JOB_STATE' }));

    const created = service.createCustomerOpportunity({ businessId: DETAILING, displayName: 'Conflict customer' });
    const second = service.createQuoteDraft({
      businessId: DETAILING,
      contactId: created.contact.id,
      leadId: created.lead.id,
      items: [{ id: 'two', description: 'Detail two', quantity: 1, unitPriceCents: 80_000 }],
      operationKey: 'schedule-second-quote',
    });
    service.sendQuote(DETAILING, second.id);
    const secondJob = service.acceptQuote(DETAILING, second.id);
    service.recordDeposit(DETAILING, PaymentReferenceType.Job, secondJob.id, 'schedule-second-deposit');
    expect(() => service.scheduleJob(DETAILING, secondJob.id, `${DETAILING}-owner`, '2026-09-03T10:00:00.000Z', '2026-09-03T11:00:00.000Z')).toThrowError(expect.objectContaining({ code: 'SCHEDULE_CONFLICT' }));
  });
});

function currentAction(
  database: ReturnType<typeof createHarness>['database'],
  businessId: string,
  leadId: string,
) {
  return database.repositories.nextActions.find(
    businessId,
    (action) => action.leadId === leadId && action.status === NextActionStatus.Pending,
  )[0] ?? null;
}
