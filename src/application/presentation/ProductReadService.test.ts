import { describe, expect, it } from 'vitest';
import {
  AppointmentStatus,
  ConversationMode,
  ConversationStage,
  ConversationState,
  LeadStatus,
  MessageAuthor,
  MessageDirection,
  MessagePurpose,
  NextActionStatus,
  NextActionType,
  OpportunityLostReason,
  PaymentKind,
  PaymentReferenceType,
  PaymentStatus,
} from '../../domain/entities';
import { createHarness } from '../../test/harness';

const CLINIC = 'biz-clinic';
const DETAILING = 'biz-detailing';
const COMPLETED_CONTACT = `${CLINIC}-contact-completed`;
const COMPLETED_APPOINTMENT = `${CLINIC}-appointment-completed`;

describe('ProductReadService', () => {
  it('prioritizes human review and reports only tenant-scoped prepared automation work', () => {
    const { service, database } = createHarness();
    const today = service.productToday(CLINIC);
    const expectedPreparedActions = database.repositories.leads
      .list(CLINIC)
      .filter((lead) =>
        [LeadStatus.New, LeadStatus.Active, LeadStatus.Qualified].includes(lead.status),
      )
      .filter((lead) => {
        const action = lead.nextActionId
          ? database.repositories.nextActions.get(CLINIC, lead.nextActionId)
          : null;
        return action?.automatic === true;
      }).length;

    expect(today.attention[0]?.actionType).toBe(NextActionType.HumanReview);
    expect(today.asOf).toBe('2026-08-12T12:00:00.000Z');
    expect(today.automation.preparedActions).toBe(expectedPreparedActions);
    expect(today.automation.preparedActions).toBeGreaterThan(0);
  });

  it('projects operational and marketing consent independently and fails closed', () => {
    const { service, database } = createHarness();
    const consent = database.repositories.consentRecords.get(
      CLINIC,
      `${CLINIC}-consent-completed`,
    )!;

    database.repositories.consentRecords.save(CLINIC, {
      ...consent,
      marketingAllowed: false,
      operationalAllowed: false,
      optedOut: false,
    });

    expect(service.productCustomer(CLINIC, COMPLETED_CONTACT)).toMatchObject({
      marketingAllowed: false,
      operationalAllowed: false,
    });

    database.repositories.consentRecords.remove(CLINIC, consent.id);
    expect(service.productCustomer(CLINIC, COMPLETED_CONTACT)).toMatchObject({
      marketingAllowed: false,
      operationalAllowed: false,
    });
  });

  it('marks PAUSED automation as stopped without calling it human takeover', () => {
    const { service, database } = createHarness();
    const conversationId = `${CLINIC}-conversation-waiting`;
    const conversation = database.repositories.conversations.get(CLINIC, conversationId)!;
    database.repositories.conversations.save(CLINIC, {
      ...conversation,
      mode: ConversationMode.Paused,
      automationEnabled: false,
    });

    const inboxConversation = service.productInbox(CLINIC).conversations.find(
      (candidate) => candidate.id === conversationId,
    );
    expect(inboxConversation).toMatchObject({ automationStopped: true, isHumanActive: false });
    expect(service.productCustomer(CLINIC, conversation.contactId)).toMatchObject({
      automationStopped: true,
      isHumanActive: false,
    });
  });

  it('scopes payment metadata to the current reference and collected status', () => {
    const { service, database } = createHarness();
    const base = {
      businessId: CLINIC,
      contactId: COMPLETED_CONTACT,
      createdAt: '2026-08-12T12:00:00.000Z',
      updatedAt: '2026-08-12T12:00:00.000Z',
      collectedAt: '2026-08-12T12:00:00.000Z',
      originalPaymentId: null,
    } as const;

    database.repositories.payments.save(CLINIC, {
      ...base,
      id: 'unrelated-collected-payment',
      referenceType: PaymentReferenceType.Quote,
      referenceId: 'an-unrelated-quote',
      kind: PaymentKind.Balance,
      status: PaymentStatus.Collected,
      amountCents: 90_000,
      idempotencyKey: 'unrelated-collected-payment',
    });
    database.repositories.payments.save(CLINIC, {
      ...base,
      id: 'failed-current-payment',
      referenceType: PaymentReferenceType.Appointment,
      referenceId: COMPLETED_APPOINTMENT,
      kind: PaymentKind.Balance,
      status: PaymentStatus.Failed,
      amountCents: 31_500,
      idempotencyKey: 'failed-current-payment',
    });
    database.repositories.payments.save(CLINIC, {
      ...base,
      id: 'voided-current-refund',
      referenceType: PaymentReferenceType.Appointment,
      referenceId: COMPLETED_APPOINTMENT,
      kind: PaymentKind.Refund,
      status: PaymentStatus.Voided,
      amountCents: 2_000,
      idempotencyKey: 'voided-current-refund',
      originalPaymentId: `${COMPLETED_APPOINTMENT}-deposit`,
    });
    database.repositories.payments.save(CLINIC, {
      ...base,
      id: 'collected-current-refund',
      referenceType: PaymentReferenceType.Appointment,
      referenceId: COMPLETED_APPOINTMENT,
      kind: PaymentKind.Refund,
      status: PaymentStatus.Collected,
      amountCents: 2_500,
      idempotencyKey: 'collected-current-refund',
      originalPaymentId: `${COMPLETED_APPOINTMENT}-deposit`,
    });

    expect(service.productCustomer(CLINIC, COMPLETED_CONTACT)).toMatchObject({
      paymentCount: 1,
      refundCents: 2_500,
      collectedCents: 8_000,
      remainingBalanceCents: 34_000,
    });
  });

  it('selects the active opportunity and its exact conversation for a returning contact', () => {
    const { service, database } = createHarness();
    const contactId = `${CLINIC}-contact-lost`;
    const priorLead = database.repositories.leads.get(CLINIC, `${CLINIC}-lead-lost`)!;
    const priorConversation = database.repositories.conversations.get(
      CLINIC,
      `${CLINIC}-conversation-lost`,
    )!;
    const actionTemplate = database.repositories.nextActions.get(
      CLINIC,
      `${CLINIC}-action-waiting`,
    )!;
    const activeLeadId = `${CLINIC}-lead-returning`;
    const activeConversationId = `${CLINIC}-conversation-returning`;
    const activeActionId = `${CLINIC}-action-returning`;

    database.repositories.conversations.save(CLINIC, {
      ...priorConversation,
      id: activeConversationId,
      updatedAt: '2026-08-11T12:00:00.000Z',
      state: ConversationState.NewInquiry,
      inferredStage: ConversationStage.NewInquiry,
      mode: ConversationMode.AiActive,
      automationEnabled: true,
      nextActionId: activeActionId,
      handoffId: null,
    });
    database.repositories.leads.save(CLINIC, {
      ...priorLead,
      id: activeLeadId,
      updatedAt: '2026-08-11T12:00:00.000Z',
      conversationId: activeConversationId,
      status: LeadStatus.Active,
      nextActionId: activeActionId,
      closedAt: null,
      lostReason: null,
    });
    database.repositories.nextActions.save(CLINIC, {
      ...actionTemplate,
      id: activeActionId,
      leadId: activeLeadId,
      conversationId: activeConversationId,
      type: NextActionType.ReplyToCustomer,
      status: NextActionStatus.Pending,
    });
    database.repositories.messages.save(CLINIC, {
      id: `${CLINIC}-message-returning`,
      businessId: CLINIC,
      createdAt: '2026-08-11T12:00:00.000Z',
      updatedAt: '2026-08-11T12:00:00.000Z',
      conversationId: activeConversationId,
      direction: MessageDirection.Inbound,
      author: MessageAuthor.Customer,
      purpose: MessagePurpose.Operational,
      body: 'חזרתי ואני רוצה להמשיך עם השירות.',
      providerMessageId: 'returning-customer-message',
      sentAt: '2026-08-11T12:00:00.000Z',
    });

    const customer = service.productCustomer(CLINIC, contactId);
    expect(customer).toMatchObject({
      conversationId: activeConversationId,
      leadStatus: LeadStatus.Active,
    });
    expect(customer?.messages.map((message) => message.body)).toEqual([
      'חזרתי ואני רוצה להמשיך עם השירות.',
    ]);
    expect(customer?.lostReason).not.toBe(OpportunityLostReason.NoLongerInterested);
  });

  it('does not silently drop an active action whose contact is missing', () => {
    const { service, database } = createHarness();
    database.repositories.contacts.remove(CLINIC, `${CLINIC}-contact-waiting`);

    expect(() => service.actionCenter(CLINIC)).toThrow(
      `Active lead ${CLINIC}-lead-waiting references a missing contact`,
    );
  });

  it('uses the validated appointment service when the lead did not yet store a service', () => {
    const { service, database } = createHarness();
    const template = database.repositories.appointments.get(CLINIC, COMPLETED_APPOINTMENT)!;
    const leadId = `${CLINIC}-lead-new`;
    const contactId = `${CLINIC}-contact-new`;

    database.repositories.appointments.save(CLINIC, {
      ...template,
      id: `${CLINIC}-appointment-new`,
      leadId,
      contactId,
      status: AppointmentStatus.Confirmed,
      startAt: '2026-08-20T09:00:00.000Z',
      endAt: '2026-08-20T10:00:00.000Z',
      completedAt: null,
      operationKey: `${CLINIC}-appointment-new`,
    });

    expect(service.productCustomer(CLINIC, contactId)?.serviceName).toBe('טיפול פנים קלאסי');
  });

  it('keeps Customers, schedule, and Money read models tenant scoped', () => {
    const { service, database } = createHarness();
    const clinicContactIds = new Set(database.repositories.contacts.list(CLINIC).map((contact) => contact.id));
    const otherContactIds = new Set(database.repositories.contacts.list('biz-detailing').map((contact) => contact.id));

    const customers = service.productCustomers(CLINIC).customers;
    const schedule = service.productSchedule(CLINIC).items;
    const money = service.productMoney(CLINIC).items;

    expect(customers.every((customer) => clinicContactIds.has(customer.contactId))).toBe(true);
    expect(schedule.every((item) => clinicContactIds.has(item.contactId))).toBe(true);
    expect(money.every((item) => clinicContactIds.has(item.contactId))).toBe(true);
    expect(customers.some((customer) => otherContactIds.has(customer.contactId))).toBe(false);
    expect(schedule.some((item) => otherContactIds.has(item.contactId))).toBe(false);
    expect(money.some((item) => otherContactIds.has(item.contactId))).toBe(false);
  });

  it('surfaces Human Takeover first and keeps the verified balance in owner read models', () => {
    const { service } = createHarness();

    const customers = service.productCustomers(CLINIC).customers;
    const money = service.productMoney(CLINIC);

    expect(customers[0]).toMatchObject({
      contactId: `${CLINIC}-contact-handoff`,
      group: 'NEEDS_OWNER',
      automationStopped: true,
    });
    expect(money.waitingTotalCents).toBe(31_500);
    expect(money.items.find((item) => item.contactId === COMPLETED_CONTACT)).toMatchObject({
      totalCents: 42_000,
      collectedCents: 10_500,
      remainingBalanceCents: 31_500,
      collectionDueCents: 31_500,
    });
  });

  it('reports only validated financial truth and leaves CLOSER attribution unavailable', () => {
    const { service } = createHarness();

    expect(service.productRevenueOverview(CLINIC)).toEqual({
      validatedCollectedCents: 10_500,
      collectionDueCents: 31_500,
      openPipelineCents: 42_000,
      bookedOpportunityCount: 0,
      wonOpportunityCount: 0,
      attribution: {
        status: 'NOT_AVAILABLE',
        generatedByCloserCents: null,
        recoveredByCloserCents: null,
      },
    });
    expect(service.productRevenueOverview(DETAILING).validatedCollectedCents).toBe(30_000);
  });

  it('does not present a declined quote as money due for collection', () => {
    const { service } = createHarness();
    const baselineDue = service.productMoney(DETAILING).waitingTotalCents;
    const created = service.createCustomerOpportunity({
      businessId: DETAILING,
      displayName: 'Declined quote customer',
    });
    const quote = service.createQuoteDraft({
      businessId: DETAILING,
      contactId: created.contact.id,
      leadId: created.lead.id,
      items: [{ id: 'declined-item', description: 'PPF', quantity: 1, unitPriceCents: 80_000 }],
      operationKey: 'declined-money-read-model',
    });

    service.sendQuote(DETAILING, quote.id);
    service.declineQuote(DETAILING, quote.id);

    const money = service.productMoney(DETAILING);
    expect(money.waitingTotalCents).toBe(baselineDue);
    expect(money.items.find((item) => item.leadId === created.lead.id)).toMatchObject({
      remainingBalanceCents: 0,
      collectionDueCents: 0,
      leadStatus: LeadStatus.Lost,
    });
  });

  it('projects appointment and quote/job work through the same schedule contract', () => {
    const { service } = createHarness();

    expect(service.productSchedule(CLINIC).items.some((item) => item.kind === 'APPOINTMENT')).toBe(true);
    expect(service.productSchedule('biz-detailing').items.some((item) => item.kind === 'JOB')).toBe(true);
    expect(service.productSchedule('biz-home').items.some((item) => item.kind === 'JOB')).toBe(true);
  });
});
