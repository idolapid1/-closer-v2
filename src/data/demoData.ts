import {
  ActivityType,
  AppointmentStatus,
  BusinessKind,
  ConversationChannel,
  ConversationIntent,
  ConversationMode,
  ConversationStage,
  ConversationState,
  CustomerFactKey,
  FollowUpScenario,
  FollowUpStatus,
  HandoffReason,
  JobStatus,
  KnowledgeTopic,
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
  QuoteStatus,
  RevenueStage,
  TeamRole,
  Weekday,
  WorkflowType,
  type Activity,
  type Appointment,
  type AvailabilityRule,
  type Business,
  type BusinessKnowledge,
  type BusinessSettings,
  type ConsentRecord,
  type Contact,
  type Conversation,
  type CustomerMemoryItem,
  type HumanHandoff,
  type Job,
  type Lead,
  type Message,
  type NextAction,
  type Payment,
  type Quote,
  type RevenueEvent,
  type ScheduledFollowUp,
  type Service,
  type TeamMember,
  type TenantEntity,
} from '../domain/entities';
import { SCHEMA_VERSION, type DatabaseSchema } from '../repositories/contracts';
import type { ConversationDecisionRecord } from '../types/assistant';

export const DEMO_NOW = '2026-08-12T08:00:00.000Z';

type BaseInput = Pick<TenantEntity, 'id' | 'businessId'>;

function base({ id, businessId }: BaseInput): TenantEntity {
  return { id, businessId, createdAt: DEMO_NOW, updatedAt: DEMO_NOW };
}

interface DemoBusinessConfig {
  id: string;
  name: string;
  kind: BusinessKind;
  workflowType: WorkflowType;
  currency: Business['currency'];
  ownerName: string;
  serviceName: string;
  serviceDescription: string;
  fixedPriceCents: number | null;
  durationMinutes: number;
  address: string;
  serviceArea: string;
  requiredQualificationFields: string[];
  tone: string;
}

const HEBREW_SCENARIO_NAMES = {
  new: 'אלכס מור',
  waiting: 'דנה כהן',
  handoff: 'מאיה לוי',
  optout: 'נטע שמעון',
  completed: 'יובל רוזן',
  lost: 'רוני אברהם',
} as const;

const CONFIGS: DemoBusinessConfig[] = [
  {
    id: 'biz-clinic',
    name: 'Luma Aesthetics',
    kind: BusinessKind.Clinic,
    workflowType: WorkflowType.AppointmentService,
    currency: 'ILS',
    ownerName: 'מאיה כהן',
    serviceName: 'Signature facial',
    serviceDescription: 'A 60-minute non-medical facial treatment.',
    fixedPriceCents: 42000,
    durationMinutes: 60,
    address: '12 Fiction Lane, Tel Aviv',
    serviceArea: 'In-clinic only',
    requiredQualificationFields: ['serviceType', 'preferredTime'],
    tone: 'Warm, calm, and professional',
  },
  {
    id: 'biz-detailing',
    name: 'Northstar Auto Detail',
    kind: BusinessKind.AutoDetailing,
    workflowType: WorkflowType.QuoteJob,
    currency: 'ILS',
    ownerName: 'דניאל לוי',
    serviceName: 'Full interior detail',
    serviceDescription: 'Deep interior clean tailored to vehicle size and condition.',
    fixedPriceCents: null,
    durationMinutes: 180,
    address: '48 Fiction Road, Ramat Gan',
    serviceArea: 'Gush Dan',
    requiredQualificationFields: ['vehicleModel', 'vehicleYear', 'vehiclePhotos'],
    tone: 'Direct, helpful, and practical',
  },
  {
    id: 'biz-home',
    name: 'BrightHome Services',
    kind: BusinessKind.HomeServices,
    workflowType: WorkflowType.QuoteJob,
    currency: 'ILS',
    ownerName: 'נועה ברק',
    serviceName: 'Home repair visit',
    serviceDescription: 'Assessment and repair for common household maintenance issues.',
    fixedPriceCents: null,
    durationMinutes: 120,
    address: '7 Fiction Street, Petah Tikva',
    serviceArea: 'Central district',
    requiredQualificationFields: ['address', 'problemDescription', 'photos'],
    tone: 'Reassuring, concise, and respectful',
  },
];

export function createDemoDatabase(): DatabaseSchema {
  const businesses: Business[] = [];
  const businessSettings: BusinessSettings[] = [];
  const businessKnowledge: BusinessKnowledge[] = [];
  const teamMembers: TeamMember[] = [];
  const contacts: Contact[] = [];
  const leads: Lead[] = [];
  const conversations: Conversation[] = [];
  const messages: Message[] = [];
  const nextActions: NextAction[] = [];
  const activities: Activity[] = [];
  const services: Service[] = [];
  const appointments: Appointment[] = [];
  const availabilityRules: AvailabilityRule[] = [];
  const quotes: Quote[] = [];
  const jobs: Job[] = [];
  const payments: Payment[] = [];
  const consentRecords: ConsentRecord[] = [];
  const humanHandoffs: HumanHandoff[] = [];
  const revenueEvents: RevenueEvent[] = [];
  const customerMemory: CustomerMemoryItem[] = [];
  const scheduledFollowUps: ScheduledFollowUp[] = [];
  const assistantDecisionRecords: ConversationDecisionRecord[] = [];

  for (const config of CONFIGS) {
    const serviceId = `${config.id}-service-1`;
    const ownerId = `${config.id}-owner`;
    businesses.push({
      ...base({ id: config.id, businessId: config.id }),
      name: config.name,
      kind: config.kind,
      workflowType: config.workflowType,
      currency: config.currency,
      timeZone: 'Asia/Jerusalem',
    });
    businessSettings.push({
      ...base({ id: `${config.id}-settings`, businessId: config.id }),
      taxEnabled: false,
      taxRateBasisPoints: 0,
      defaultDepositBasisPoints: 2500,
      paymentMethods: ['Card', 'Bank transfer', 'Cash'],
    });
    businessKnowledge.push({
      ...base({ id: `${config.id}-knowledge`, businessId: config.id }),
      businessName: config.name,
      serviceDescriptions: { [serviceId]: config.serviceDescription },
      fixedPricesCents: config.fixedPriceCents === null ? {} : { [serviceId]: config.fixedPriceCents },
      priceRangesCents:
        config.fixedPriceCents === null
          ? {
              [serviceId]:
                config.kind === BusinessKind.AutoDetailing
                  ? { minCents: 60000, maxCents: 180000 }
                  : { minCents: 35000, maxCents: 150000 },
            }
          : {},
      pricingRules:
        config.fixedPriceCents === null
          ? ['Exact pricing requires the configured qualification details and human-approved quote.']
          : ['The listed fixed price may be answered automatically.'],
      serviceDurationsMinutes: { [serviceId]: config.durationMinutes },
      preparationInstructions: {
        [serviceId]:
          config.kind === BusinessKind.Clinic
            ? [
                'Arrive with clean skin when practical.',
                'Share medical or treatment-suitability questions with the clinic team.',
              ]
            : config.kind === BusinessKind.AutoDetailing
              ? ['Remove valuables and personal items from the vehicle.']
              : ['Make sure the work area can be accessed safely.'],
      },
      openingHours: 'Sunday–Thursday 09:00–18:00, Friday 09:00–13:00',
      address: config.address,
      serviceArea: config.serviceArea,
      serviceAreaLocations:
        config.kind === BusinessKind.HomeServices
          ? ['Petah Tikva', 'Ramat Gan', 'Tel Aviv', 'Givat Shmuel']
          : config.kind === BusinessKind.AutoDetailing
            ? ['Ramat Gan', 'Tel Aviv', 'Givatayim', 'Bnei Brak']
            : ['In-clinic'],
      appointmentRules: [
        'Appointment options must come from validated availability.',
        'A booking is not confirmed until its required deposit is recorded.',
      ],
      cancellationPolicy: 'Please give at least 24 hours notice when possible.',
      depositPolicy: 'A 25% deposit confirms a booking or job.',
      acceptedPaymentMethods: ['Card', 'Bank transfer', 'Cash'],
      faq: [
        { question: 'How can I pay?', answer: 'Card, bank transfer, or cash.' },
        { question: 'Do I need a deposit?', answer: 'A 25% deposit is used to confirm work.' },
      ],
      toneOfVoice: config.tone,
      allowedAutomaticAnswers: [
        KnowledgeTopic.OpeningHours,
        KnowledgeTopic.Address,
        KnowledgeTopic.ServiceDescription,
        KnowledgeTopic.FixedPrice,
        KnowledgeTopic.PriceRange,
        KnowledgeTopic.ServiceDuration,
        KnowledgeTopic.PreparationInstructions,
        KnowledgeTopic.PaymentMethods,
        KnowledgeTopic.CancellationPolicy,
        KnowledgeTopic.DepositPolicy,
        KnowledgeTopic.ServiceArea,
      ],
      answersRequiringHumanReview:
        config.kind === BusinessKind.Clinic
          ? ['medical advice', 'treatment suitability', 'adverse reaction']
          : ['complaint', 'refund', 'unusual discount'],
      prohibitedAutonomousActions: ['Issue refunds', 'Promise medical outcomes', 'Approve unusual discounts'],
      requiredQualificationFields: config.requiredQualificationFields,
      serviceQualificationFields: { [serviceId]: qualificationFields(config.kind) },
      minimumAssistantConfidence: 0.72,
    });
    teamMembers.push({
      ...base({ id: ownerId, businessId: config.id }),
      name: config.ownerName,
      role: TeamRole.Owner,
      active: true,
      serviceIds: [serviceId],
    });
      services.push({
      ...base({ id: serviceId, businessId: config.id }),
      name: config.serviceName,
      description: config.serviceDescription,
      durationMinutes: config.durationMinutes,
      fixedPriceCents: config.fixedPriceCents,
      active: true,
      requiresDeposit: true,
      workflowType: config.workflowType,
    });
    availabilityRules.push({
      ...base({ id: `${config.id}-availability`, businessId: config.id }),
      staffId: ownerId,
      weekdays: [Weekday.Sunday, Weekday.Monday, Weekday.Tuesday, Weekday.Wednesday, Weekday.Thursday],
      startTime: '09:00',
      endTime: '18:00',
      slotIntervalMinutes: 30,
    });

    const scenarios = [
      ['new', HEBREW_SCENARIO_NAMES.new, LeadStatus.New, ConversationMode.AiActive, ConversationState.NewInquiry],
      ['waiting', HEBREW_SCENARIO_NAMES.waiting, LeadStatus.Active, ConversationMode.AiActive, ConversationState.Qualifying],
      ['handoff', HEBREW_SCENARIO_NAMES.handoff, LeadStatus.Active, ConversationMode.HumanActive, ConversationState.Qualifying],
      ['optout', HEBREW_SCENARIO_NAMES.optout, LeadStatus.Active, ConversationMode.AiActive, ConversationState.Qualifying],
      ['completed', HEBREW_SCENARIO_NAMES.completed, LeadStatus.Active, ConversationMode.AiActive, ConversationState.AwaitingPayment],
      ['lost', HEBREW_SCENARIO_NAMES.lost, LeadStatus.Lost, ConversationMode.Closed, ConversationState.Complete],
    ] as const;

    for (const [key, name, leadStatus, mode, conversationState] of scenarios) {
      const contactId = `${config.id}-contact-${key}`;
      const conversationId = `${config.id}-conversation-${key}`;
      const leadId = `${config.id}-lead-${key}`;
      const actionId = `${config.id}-action-${key}`;
      const isClosed = [LeadStatus.Won, LeadStatus.Lost, LeadStatus.Archived].includes(leadStatus);
      const hasOutstandingBalance = key === 'completed';
      const isHandoff = key === 'handoff';
      contacts.push({
        ...base({ id: contactId, businessId: config.id }),
        displayName: name,
        phone: `+972-555-${config.id.length}${key.length}00`,
        email: `${key}.${config.id}@example.test`,
        address: config.kind === BusinessKind.HomeServices ? `${key.length} Example Avenue` : null,
        notes: [],
      });
      conversations.push({
        ...base({ id: conversationId, businessId: config.id }),
        contactId,
        channel: ConversationChannel.WhatsApp,
        ownerTeamMemberId: isHandoff ? ownerId : null,
        state: conversationState,
        inferredStage: isHandoff
          ? ConversationStage.HumanReview
          : hasOutstandingBalance
            ? ConversationStage.AwaitingBalance
            : isClosed
              ? ConversationStage.ClosedLost
            : key === 'new'
              ? ConversationStage.NewInquiry
              : ConversationStage.InformationCollection,
        mode,
        automationEnabled: mode === ConversationMode.AiActive,
        lastCustomerMessageAt: key === 'new' ? null : DEMO_NOW,
        lastBusinessResponseAt: key === 'completed' ? DEMO_NOW : null,
        currentIntent: key === 'waiting' ? ConversationIntent.RequestAppointment : null,
        missingInformation: key === 'waiting' ? config.requiredQualificationFields.slice(0, 1) : [],
        nextActionId: isClosed ? null : actionId,
        handoffId: isHandoff ? `${config.id}-handoff-1` : null,
      });
      leads.push({
        ...base({ id: leadId, businessId: config.id }),
        contactId,
        conversationId,
        workflowType: config.workflowType,
        status: leadStatus,
        serviceId: key === 'new' ? null : serviceId,
        nextActionId: isClosed ? null : actionId,
        closedAt: isClosed ? DEMO_NOW : null,
        lostReason: isClosed ? OpportunityLostReason.NoLongerInterested : null,
      });
      if (!isClosed) {
        nextActions.push({
          ...base({ id: actionId, businessId: config.id }),
          leadId,
          conversationId,
          type:
            key === 'new'
              ? NextActionType.ReplyToCustomer
              : key === 'completed'
                ? NextActionType.CollectBalance
              : key === 'handoff'
                ? NextActionType.HumanReview
                : NextActionType.CollectInformation,
          status: NextActionStatus.Pending,
          reason:
            key === 'completed'
              ? 'Service is complete; collect the remaining balance.'
              : key === 'handoff'
              ? 'Customer asked a question that requires the owner.'
              : 'Keep this active opportunity moving.',
          dueAt: DEMO_NOW,
          automatic: !isHandoff,
        });
        if (hasOutstandingBalance) {
          scheduledFollowUps.push({
            ...base({ id: `${config.id}-follow-up-balance`, businessId: config.id }),
            contactId,
            conversationId,
            scenario: FollowUpScenario.OutstandingBalance,
            status: FollowUpStatus.Scheduled,
            purpose: MessagePurpose.Operational,
            dueAt: '2026-08-13T08:00:00.000Z',
            idempotencyKey: `${conversationId}:${FollowUpScenario.OutstandingBalance}:seed`,
            triggeringMessageId: null,
            reason: 'Request the remaining payment for completed work.',
          });
        }
      }
      consentRecords.push({
        ...base({ id: `${config.id}-consent-${key}`, businessId: config.id }),
        contactId,
        marketingAllowed: key !== 'optout',
        operationalAllowed: true,
        optedOut: key === 'optout',
        source: key === 'optout' ? 'CUSTOMER_MESSAGE' : 'IMPORT',
        changedAt: DEMO_NOW,
      });
      if (key !== 'new') {
        messages.push({
          ...base({ id: `${config.id}-message-${key}`, businessId: config.id }),
          conversationId,
          direction: MessageDirection.Inbound,
          author: MessageAuthor.Customer,
          purpose: MessagePurpose.Operational,
          body:
            key === 'handoff'
              ? 'אני לא מרוצה ורוצה לדבר עם בעלת העסק.'
              : key === 'optout'
                ? 'בבקשה להפסיק לשלוח לי הודעות שיווקיות.'
                : key === 'lost'
                  ? 'תודה, החלטתי לא להמשיך כרגע.'
                : config.kind === BusinessKind.Clinic
                  ? 'היי, אני מתעניינת בטיפול פנים ורוצה להבין מה מתאים לי.'
                  : config.kind === BusinessKind.AutoDetailing
                    ? 'היי, אני רוצה דיטיילינג פנימי לרכב שלי.'
                    : 'שלום, יש לי תקלה בבית ואני רוצה לקבל הצעת מחיר.',
          providerMessageId: `mock-${config.id}-${key}`,
          sentAt: DEMO_NOW,
        });
      }
    }

    humanHandoffs.push({
      ...base({ id: `${config.id}-handoff-1`, businessId: config.id }),
      conversationId: `${config.id}-conversation-handoff`,
      reason: HandoffReason.Complaint,
      detail: 'Customer asked to speak with the owner.',
      startedAt: DEMO_NOW,
      resolvedAt: null,
      startedBy: 'ASSISTANT',
      triggeringMessageId: `${config.id}-message-handoff`,
      confidence: 0.96,
      responsibleState: ConversationStage.HumanReview,
    });
    activities.push({
      ...base({ id: `${config.id}-activity-handoff`, businessId: config.id }),
      contactId: `${config.id}-contact-handoff`,
      conversationId: `${config.id}-conversation-handoff`,
      type: ActivityType.HandoffStarted,
      summary: 'Assistant paused and handed the conversation to a human.',
      metadata: { reason: HandoffReason.Complaint },
      occurredAt: DEMO_NOW,
      operationKey: `${config.id}:seed:handoff`,
    });

    const completedContactId = `${config.id}-contact-completed`;
    const completedLeadId = `${config.id}-lead-completed`;
    const totalCents = config.fixedPriceCents ?? 120000;
    if (config.workflowType === WorkflowType.AppointmentService) {
      const appointmentId = `${config.id}-appointment-completed`;
      appointments.push({
        ...base({ id: appointmentId, businessId: config.id }),
        contactId: completedContactId,
        leadId: completedLeadId,
        serviceId,
        staffId: ownerId,
        startAt: '2026-08-11T07:00:00.000Z',
        endAt: '2026-08-11T08:00:00.000Z',
        status: AppointmentStatus.Completed,
        totalCents,
        depositRequiredCents: Math.round(totalCents * 0.25),
        confirmedAt: '2026-08-10T08:00:00.000Z',
        completedAt: DEMO_NOW,
        operationKey: `${appointmentId}:seed`,
      });
      addDeposit(
        config.id,
        completedContactId,
        PaymentReferenceType.Appointment,
        appointmentId,
        Math.round(totalCents * 0.25),
        payments,
        revenueEvents,
      );
      revenueEvents.push({
        ...base({ id: `${appointmentId}-completed-event`, businessId: config.id }),
        contactId: completedContactId,
        referenceType: PaymentReferenceType.Appointment,
        referenceId: appointmentId,
        stage: RevenueStage.Completed,
        amountCents: totalCents,
        causationId: `${appointmentId}:complete`,
        correlationId: appointmentId,
        occurredAt: DEMO_NOW,
      });
    } else {
      const quoteId = `${config.id}-quote-accepted`;
      const jobId = `${config.id}-job-completed`;
      quotes.push({
        ...base({ id: quoteId, businessId: config.id }),
        contactId: completedContactId,
        leadId: completedLeadId,
        items: [{ id: `${quoteId}-item`, description: config.serviceName, quantity: 1, unitPriceCents: totalCents }],
        subtotalCents: totalCents,
        discountCents: 0,
        taxCents: 0,
        depositRequiredCents: Math.round(totalCents * 0.25),
        totalCents,
        status: QuoteStatus.Accepted,
        expiresAt: null,
        acceptedAt: '2026-08-10T08:00:00.000Z',
        operationKey: `${quoteId}:seed`,
      });
      jobs.push({
        ...base({ id: jobId, businessId: config.id }),
        contactId: completedContactId,
        leadId: completedLeadId,
        quoteId,
        address: config.kind === BusinessKind.HomeServices ? '5 Example Lane' : config.address,
        scheduledStartAt: '2026-08-11T07:00:00.000Z',
        scheduledEndAt: '2026-08-11T10:00:00.000Z',
        assignedStaffId: ownerId,
        status: JobStatus.Completed,
        totalCents,
        depositRequiredCents: Math.round(totalCents * 0.25),
        completedAt: DEMO_NOW,
        operationKey: `${jobId}:seed`,
      });
      addDeposit(
        config.id,
        completedContactId,
        PaymentReferenceType.Job,
        jobId,
        Math.round(totalCents * 0.25),
        payments,
        revenueEvents,
      );
      revenueEvents.push({
        ...base({ id: `${jobId}-completed-event`, businessId: config.id }),
        contactId: completedContactId,
        referenceType: PaymentReferenceType.Job,
        referenceId: jobId,
        stage: RevenueStage.Completed,
        amountCents: totalCents,
        causationId: `${jobId}:complete`,
        correlationId: jobId,
        occurredAt: DEMO_NOW,
      });
    }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    businesses,
    businessSettings,
    businessKnowledge,
    teamMembers,
    contacts,
    leads,
    conversations,
    messages,
    nextActions,
    activities,
    services,
    appointments,
    availabilityRules,
    quotes,
    jobs,
    payments,
    consentRecords,
    humanHandoffs,
    revenueEvents,
    customerMemory,
    scheduledFollowUps,
    assistantDecisionRecords,
  };
}

function qualificationFields(kind: BusinessKind): CustomerFactKey[] {
  if (kind === BusinessKind.Clinic) {
    return [
      CustomerFactKey.RequestedService,
      CustomerFactKey.CustomerType,
      CustomerFactKey.PreferredDate,
    ];
  }
  if (kind === BusinessKind.AutoDetailing) {
    return [
      CustomerFactKey.RequestedService,
      CustomerFactKey.VehicleMake,
      CustomerFactKey.VehicleModel,
      CustomerFactKey.VehicleYear,
      CustomerFactKey.VehicleCondition,
      CustomerFactKey.PhotosReceived,
      CustomerFactKey.PreferredDate,
    ];
  }
  return [
    CustomerFactKey.RequestedJob,
    CustomerFactKey.Location,
    CustomerFactKey.JobDetails,
    CustomerFactKey.PhotosReceived,
    CustomerFactKey.Urgency,
  ];
}

function addDeposit(
  businessId: string,
  contactId: string,
  referenceType: PaymentReferenceType,
  referenceId: string,
  amountCents: number,
  payments: Payment[],
  revenueEvents: RevenueEvent[],
): void {
  const paymentId = `${referenceId}-deposit`;
  payments.push({
    ...base({ id: paymentId, businessId }),
    contactId,
    referenceType,
    referenceId,
    kind: PaymentKind.Deposit,
    status: PaymentStatus.Collected,
    amountCents,
    idempotencyKey: `${referenceId}:deposit`,
    originalPaymentId: null,
    collectedAt: DEMO_NOW,
  });
  revenueEvents.push({
    ...base({ id: `${paymentId}-event`, businessId }),
    contactId,
    referenceType,
    referenceId,
    stage: RevenueStage.Collected,
    amountCents,
    causationId: paymentId,
    correlationId: referenceId,
    occurredAt: DEMO_NOW,
  });
}

export const DEMO_DATABASE = createDemoDatabase();
