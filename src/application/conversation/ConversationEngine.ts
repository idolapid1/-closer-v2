import {
  BusinessKind,
  ConversationIntent,
  ConversationStage,
  CustomerFactKey,
  HandoffReason,
  JobStatus,
  NextActionType,
  PaymentKind,
  PaymentStatus,
  WorkflowType,
} from '../../domain/entities';
import { remainingBalance } from '../../domain/rules';
import {
  AssistantRiskLevel,
  AssistantTool,
  AutonomyLevel,
  CustomerGoal,
  InternalReasonCode,
  type AssistantContext,
  type ConversationDecision,
} from '../../types/assistant';
import { KnowledgeService } from './KnowledgeService';

const contains = (body: string, terms: string[]): boolean =>
  terms.some((term) => body.includes(term));

export class ConversationEngine {
  private readonly knowledge = new KnowledgeService();

  decide(context: AssistantContext): ConversationDecision {
    const body = context.latestCustomerMessage.body.toLowerCase().trim();
    const service = this.knowledge.selectedService(context.lead, context.services, context.memory);
    const missing = this.knowledge.missingFacts(context.knowledge, service, context.memory);
    const knownFacts = context.memory.map((fact) => ({
      key: fact.key,
      value: fact.value,
      source: fact.source,
    }));
    const base = (): Omit<ConversationDecision, 'detectedIntent' | 'intent' | 'customerGoal' | 'suggestedReply' | 'internalReasonCode'> => ({
      secondaryIntents: secondaryIntents(body),
      confidence: 0.94,
      conversationStage: context.inferredStage,
      knownFacts,
      missingInformation: missing,
      suggestedNextAction: nextActionForStage(context.inferredStage),
      requestedTool: AssistantTool.CreateNextAction,
      toolArguments: {},
      requiresHumanReview: false,
      handoffReason: null,
      riskLevel: AssistantRiskLevel.Low,
      knowledgeSourcesUsed: [],
      shouldFollowUp: shouldFollowUp(context.inferredStage),
      recommendedFollowUpAt: shouldFollowUp(context.inferredStage)
        ? addHours(context.latestCustomerMessage.sentAt, 48)
        : null,
      autonomyLevel: AutonomyLevel.SafeInformation,
    });

    if (context.memoryConflicts.length > 0) {
      return handoffDecision(
        base(),
        ConversationIntent.UnsupportedRequest,
        CustomerGoal.ResolveProblem,
        'I have two different details here, so I’ll ask a team member to confirm before we continue.',
        InternalReasonCode.ConflictingInformation,
        HandoffReason.ConflictingInformation,
        0.99,
      );
    }

    if (contains(body, ['ignore the business rules', 'ignore previous', 'system prompt', 'developer message'])) {
      const discount = /\b\d{1,2}%|discount|free\b/.test(body);
      return handoffDecision(
        base(),
        ConversationIntent.UnsupportedRequest,
        CustomerGoal.ResolveProblem,
        'I can’t change business rules or approve that request. A team member can review it.',
        InternalReasonCode.PromptInjection,
        discount ? HandoffReason.UnusualDiscount : HandoffReason.SafetyConcern,
        0.99,
      );
    }
    if (contains(body, ['another customer', "someone else's", 'other customer', 'another business', 'other business'])) {
      return handoffDecision(
        base(),
        ConversationIntent.UnsupportedRequest,
        CustomerGoal.ResolveProblem,
        'I can only help with your conversation and this business. A team member can help if needed.',
        InternalReasonCode.UnsupportedRequest,
        HandoffReason.SafetyConcern,
        0.98,
      );
    }
    if (contains(body, ['human', 'real person', 'someone please', 'speak to the owner', 'talk to a person'])) {
      return handoffDecision(
        base(),
        ConversationIntent.HumanRequested,
        CustomerGoal.SpeakToHuman,
        'Of course. I’ll bring a team member into the conversation.',
        InternalReasonCode.HumanRequested,
        HandoffReason.HumanRequested,
        0.99,
      );
    }
    if (
      context.business.kind === BusinessKind.Clinic &&
      contains(body, [
        'medical',
        'pregnant',
        'allergy',
        'reaction',
        'diagnose',
        'safe for me',
        'medication',
        'skin condition',
      ])
    ) {
      return handoffDecision(
        base(),
        ConversationIntent.SensitiveQuestion,
        CustomerGoal.ResolveProblem,
        'A clinic team member needs to review that question before answering.',
        InternalReasonCode.MedicalOrSensitive,
        HandoffReason.SensitiveQuestion,
        0.98,
      );
    }
    if (contains(body, ['legal', 'lawyer', 'liable', 'safety hazard', 'dangerous'])) {
      return handoffDecision(
        base(),
        ConversationIntent.UnsupportedRequest,
        CustomerGoal.ResolveProblem,
        'A team member needs to review that before we answer.',
        InternalReasonCode.MedicalOrSensitive,
        contains(body, ['legal', 'lawyer', 'liable'])
          ? HandoffReason.LegalQuestion
          : HandoffReason.SafetyConcern,
        0.97,
      );
    }
    if (contains(body, ['refund', 'money back', 'chargeback'])) {
      return handoffDecision(
        base(),
        ConversationIntent.Refund,
        CustomerGoal.ResolvePayment,
        'I’ll ask a team member to review the refund request.',
        InternalReasonCode.RefundRequest,
        HandoffReason.Refund,
        0.99,
      );
    }
    if (contains(body, ['complaint', 'unhappy', 'terrible service', 'not acceptable'])) {
      return handoffDecision(
        base(),
        ConversationIntent.Complaint,
        CustomerGoal.ResolveProblem,
        'I’m sorry this needs attention. I’ll bring in a team member to help.',
        InternalReasonCode.Complaint,
        HandoffReason.Complaint,
        0.98,
      );
    }
    if (contains(body, ['idiot', 'stupid', 'useless', 'shut up', 'furious'])) {
      return handoffDecision(
        base(),
        ConversationIntent.Complaint,
        CustomerGoal.ResolveProblem,
        'A team member will take over from here.',
        InternalReasonCode.CustomerAggressive,
        HandoffReason.AggressiveOrConfused,
        0.96,
      );
    }
    if (/(?:50%|\bhalf price\b|\bspecial discount\b|\bunusual discount\b|\bmake it free\b)/i.test(body)) {
      return handoffDecision(
        base(),
        ConversationIntent.UnsupportedRequest,
        CustomerGoal.GetPrice,
        'I can’t approve discounts. A team member can review the request.',
        InternalReasonCode.UnsupportedPricing,
        HandoffReason.UnusualDiscount,
        0.97,
      );
    }
    if (body.length < 3 || contains(body, ['???', 'asdf', 'not sure what i mean', 'blah blah'])) {
      return handoffDecision(
        { ...base(), riskLevel: AssistantRiskLevel.Medium },
        ConversationIntent.Unknown,
        CustomerGoal.Unknown,
        'I’m not confident I understood that. A team member will take a look.',
        InternalReasonCode.LowConfidence,
        HandoffReason.LowConfidence,
        0.28,
      );
    }
    if (/\b(stop|unsubscribe|opt out|no marketing)\b/i.test(body)) {
      return {
        ...base(),
        detectedIntent: ConversationIntent.OptOut,
        intent: ConversationIntent.OptOut,
        customerGoal: CustomerGoal.StopMessages,
        suggestedReply: 'Understood. Marketing messages are now stopped.',
        suggestedNextAction: NextActionType.ReplyToCustomer,
        requestedTool: AssistantTool.CreateNextAction,
        toolArguments: { consent: 'MARKETING_BLOCKED' },
        shouldFollowUp: false,
        recommendedFollowUpAt: null,
        internalReasonCode: InternalReasonCode.OptOut,
      };
    }

    if (isUnverifiedPaymentClaim(body)) {
      return handoffDecision(
        {
          ...base(),
          suggestedNextAction: NextActionType.ReviewPaymentClaim,
          riskLevel: AssistantRiskLevel.High,
        },
        ConversationIntent.PaymentQuestion,
        CustomerGoal.ResolvePayment,
        'I can’t mark a payment as received from a message. A team member will verify it.',
        InternalReasonCode.PaymentClaimUnverified,
        HandoffReason.SafetyConcern,
        0.99,
      );
    }

    const outsideLocation = outsideServiceArea(context);
    if (outsideLocation) {
      return handoffDecision(
        {
          ...base(),
          suggestedNextAction: NextActionType.VerifyServiceArea,
          riskLevel: AssistantRiskLevel.Medium,
        },
        ConversationIntent.RequestQuote,
        CustomerGoal.GetQuote,
        `${outsideLocation} is not in the configured service-area list. A team member will confirm whether the job is possible.`,
        InternalReasonCode.OutsideServiceArea,
        HandoffReason.UnsupportedKnowledge,
        0.96,
      );
    }

    if (contains(body, ['did i pay', 'balance', 'amount due', 'payment status', 'still owe'])) {
      const paymentState = verifiedPaymentState(context);
      return {
        ...base(),
        detectedIntent: ConversationIntent.PaymentQuestion,
        intent: ConversationIntent.PaymentQuestion,
        customerGoal: CustomerGoal.ResolvePayment,
        suggestedReply: paymentState.reply,
        suggestedNextAction: paymentState.remainingCents > 0
          ? NextActionType.CollectBalance
          : nextActionForStage(context.inferredStage),
        requestedTool: AssistantTool.GetConversationContext,
        toolArguments: { remainingCents: paymentState.remainingCents },
        knowledgeSourcesUsed: paymentState.sources,
        internalReasonCode: InternalReasonCode.PaymentQuestion,
      };
    }

    if (contains(body, ['payment method', 'how can i pay', 'take card', 'pay by'])) {
      return safeInformation(
        base(),
        ConversationIntent.AskBusinessInfo,
        CustomerGoal.ResolvePayment,
        `You can pay by ${naturalList(context.knowledge.acceptedPaymentMethods)}.`,
        InternalReasonCode.ServiceInfo,
        AssistantTool.GetBusinessInfo,
        ['BusinessKnowledge.acceptedPaymentMethods'],
      );
    }
    if (contains(body, ['hours', 'open', 'closing'])) {
      return safeInformation(
        base(),
        ConversationIntent.AskBusinessInfo,
        CustomerGoal.LearnAboutBusiness,
        `We’re open ${context.knowledge.openingHours}.`,
        InternalReasonCode.ServiceInfo,
        AssistantTool.GetBusinessInfo,
        ['BusinessKnowledge.openingHours'],
      );
    }
    if (contains(body, ['address', 'located', 'where are you'])) {
      return safeInformation(
        base(),
        ConversationIntent.AskBusinessInfo,
        CustomerGoal.LearnAboutBusiness,
        `You can find us at ${context.knowledge.address}.`,
        InternalReasonCode.ServiceInfo,
        AssistantTool.GetBusinessInfo,
        ['BusinessKnowledge.address'],
      );
    }
    if (contains(body, ['service area', 'come to', 'travel to', 'cover my area'])) {
      return safeInformation(
        base(),
        ConversationIntent.AskBusinessInfo,
        CustomerGoal.LearnAboutBusiness,
        `Our configured service area is ${context.knowledge.serviceArea}.`,
        InternalReasonCode.ServiceInfo,
        AssistantTool.GetBusinessInfo,
        ['BusinessKnowledge.serviceArea'],
      );
    }
    if (contains(body, ['cancellation policy', 'cancel policy', 'notice to cancel'])) {
      return safeInformation(
        base(),
        ConversationIntent.AskBusinessInfo,
        CustomerGoal.CancelBooking,
        context.knowledge.cancellationPolicy,
        InternalReasonCode.ServiceInfo,
        AssistantTool.GetBusinessInfo,
        ['BusinessKnowledge.cancellationPolicy'],
      );
    }
    if (contains(body, ['deposit policy', 'need a deposit', 'deposit required'])) {
      return safeInformation(
        base(),
        ConversationIntent.AskBusinessInfo,
        CustomerGoal.ResolvePayment,
        context.knowledge.depositPolicy,
        InternalReasonCode.ServiceInfo,
        AssistantTool.GetBusinessInfo,
        ['BusinessKnowledge.depositPolicy'],
      );
    }

    if (contains(body, ['reschedule', 'move my appointment', 'change the time'])) {
      return handoffDecision(
        base(),
        ConversationIntent.RescheduleRequest,
        CustomerGoal.ChangeBooking,
        'A team member will help find a valid new time.',
        InternalReasonCode.RescheduleRequest,
        HandoffReason.Manual,
        0.96,
      );
    }
    if (/\b(cancel my|cancel the|cancel appointment|cancel booking)\b/i.test(body)) {
      return handoffDecision(
        base(),
        ConversationIntent.CancellationRequest,
        CustomerGoal.CancelBooking,
        'A team member will review the booking and cancellation policy with you.',
        InternalReasonCode.CancellationRequest,
        HandoffReason.Manual,
        0.97,
      );
    }

    if (contains(body, ['duration', 'how long', 'prepare', 'before the service', 'what is included'])) {
      if (!service) return missingServiceDecision(base(), context);
      const duration = this.knowledge.duration(context.knowledge, service);
      const preparation = context.knowledge.preparationInstructions[service.id] ?? [];
      const pieces = [
        context.knowledge.serviceDescriptions[service.id] ?? service.description,
        duration ? `It takes about ${duration} minutes.` : '',
        contains(body, ['prepare', 'before']) && preparation.length > 0
          ? preparation.join(' ')
          : '',
      ].filter(Boolean);
      return safeInformation(
        base(),
        ConversationIntent.ServiceInfo,
        CustomerGoal.UnderstandService,
        pieces.join(' '),
        InternalReasonCode.ServiceInfo,
        AssistantTool.GetServiceInfo,
        [
          `BusinessKnowledge.serviceDescriptions.${service.id}`,
          `BusinessKnowledge.serviceDurationsMinutes.${service.id}`,
          ...(contains(body, ['prepare', 'before'])
            ? [`BusinessKnowledge.preparationInstructions.${service.id}`]
            : []),
        ],
      );
    }

    if (contains(body, ['price', 'cost', 'how much', 'rate'])) {
      if (!service) return missingServiceDecision(base(), context, CustomerGoal.GetPrice);
      const fixedPrice = this.knowledge.fixedPrice(context.knowledge, service);
      if (fixedPrice !== null) {
        return safeInformation(
          base(),
          ConversationIntent.PriceQuestion,
          CustomerGoal.GetPrice,
          `${service.name} is ${formatMoney(fixedPrice, context.business.currency)}.`,
          InternalReasonCode.PriceQuestion,
          AssistantTool.GetServicePrice,
          [`BusinessKnowledge.fixedPricesCents.${service.id}`],
          true,
        );
      }
      const range = this.knowledge.priceRange(context.knowledge, service);
      if (range) {
        const reply = missing.length > 0
          ? `${service.name} is usually ${formatMoney(range.minCents, context.business.currency)}–${formatMoney(range.maxCents, context.business.currency)}. ${questionFor(missing[0]!)}`
          : `${service.name} is usually ${formatMoney(range.minCents, context.business.currency)}–${formatMoney(range.maxCents, context.business.currency)}. We have enough detail to prepare a quote.`;
        return {
          ...base(),
          detectedIntent: ConversationIntent.RequestQuote,
          intent: ConversationIntent.RequestQuote,
          customerGoal: CustomerGoal.GetQuote,
        suggestedReply: tone(context.business.kind, reply),
          suggestedNextAction: missing.length > 0
            ? nextActionForMissing(missing)
            : NextActionType.PrepareQuote,
          requestedTool: missing.length > 0
            ? toolForMissing(missing)
            : AssistantTool.CreateQuoteDraft,
          toolArguments: { serviceId: service.id, fields: missing },
          knowledgeSourcesUsed: [`BusinessKnowledge.priceRangesCents.${service.id}`],
          shouldFollowUp: true,
          recommendedFollowUpAt: addHours(context.latestCustomerMessage.sentAt, 48),
          internalReasonCode: missing.length > 0
            ? InternalReasonCode.MissingRequiredInformation
            : InternalReasonCode.InformationComplete,
          autonomyLevel: missing.length > 0
            ? AutonomyLevel.InformationCollection
            : AutonomyLevel.BusinessActionProposal,
        };
      }
      return handoffDecision(
        base(),
        ConversationIntent.PriceQuestion,
        CustomerGoal.GetPrice,
        'I don’t have a verified price for that service. A team member will confirm it.',
        InternalReasonCode.UnsupportedPricing,
        HandoffReason.UnsupportedKnowledge,
        0.97,
      );
    }

    const booking = contains(body, ['book', 'appointment', 'available', 'availability', 'slot']);
    if (booking) {
      if (!service) return missingServiceDecision(base(), context, CustomerGoal.BookAppointment);
      if (missing.length > 0) {
        return collectionDecision(
          base(),
          context,
          ConversationIntent.RequestAppointment,
          CustomerGoal.BookAppointment,
          missing,
          InternalReasonCode.BookingIntent,
        );
      }
      return {
        ...base(),
        detectedIntent: ConversationIntent.RequestAppointment,
        intent: ConversationIntent.RequestAppointment,
        customerGoal: CustomerGoal.BookAppointment,
        conversationStage: ConversationStage.ReadyToBook,
        suggestedReply: tone(
          context.business.kind,
          'I have the details. I’ll check the real availability for your preferred date.',
        ),
        suggestedNextAction: NextActionType.OfferAppointment,
        requestedTool: AssistantTool.GetAvailableSlots,
        toolArguments: { serviceId: service.id },
        missingInformation: [],
        shouldFollowUp: true,
        recommendedFollowUpAt: addHours(context.latestCustomerMessage.sentAt, 24),
        internalReasonCode: InternalReasonCode.BookingIntent,
        autonomyLevel: AutonomyLevel.BusinessActionProposal,
      };
    }

    const quoteRequest = contains(body, [
      'quote',
      'estimate',
      'detail my',
      'repair',
      'job',
      'leak',
      'problem',
    ]);
    if (quoteRequest || context.lead.workflowType === WorkflowType.QuoteJob) {
      if (!service && context.business.kind !== BusinessKind.HomeServices) {
        return missingServiceDecision(base(), context, CustomerGoal.GetQuote);
      }
      if (missing.length > 0) {
        return collectionDecision(
          base(),
          context,
          ConversationIntent.RequestQuote,
          CustomerGoal.GetQuote,
          missing,
          InternalReasonCode.QuoteRequest,
        );
      }
      return {
        ...base(),
        detectedIntent: ConversationIntent.RequestQuote,
        intent: ConversationIntent.RequestQuote,
        customerGoal: CustomerGoal.GetQuote,
        conversationStage: ConversationStage.ReadyForQuote,
        suggestedReply: tone(
          context.business.kind,
          'Thanks. We have the details needed to prepare a quote.',
        ),
        suggestedNextAction: NextActionType.PrepareQuote,
        requestedTool: AssistantTool.CreateQuoteDraft,
        toolArguments: { serviceId: service?.id ?? null },
        missingInformation: [],
        shouldFollowUp: true,
        recommendedFollowUpAt: addHours(context.latestCustomerMessage.sentAt, 48),
        internalReasonCode: InternalReasonCode.InformationComplete,
        autonomyLevel: AutonomyLevel.BusinessActionProposal,
      };
    }

    if (missing.length > 0) {
      return collectionDecision(
        base(),
        context,
        ConversationIntent.ProvideInformation,
        context.lead.workflowType === WorkflowType.AppointmentService
          ? CustomerGoal.BookAppointment
          : CustomerGoal.GetQuote,
        missing,
        InternalReasonCode.MissingRequiredInformation,
      );
    }
    return {
      ...base(),
      detectedIntent: ConversationIntent.ProvideInformation,
      intent: ConversationIntent.ProvideInformation,
      customerGoal:
        context.lead.workflowType === WorkflowType.AppointmentService
          ? CustomerGoal.BookAppointment
          : CustomerGoal.GetQuote,
      suggestedReply: tone(context.business.kind, 'Thanks. We have what we need to move forward.'),
      suggestedNextAction:
        context.lead.workflowType === WorkflowType.AppointmentService
          ? NextActionType.OfferAppointment
          : NextActionType.PrepareQuote,
      requestedTool:
        context.lead.workflowType === WorkflowType.AppointmentService
          ? AssistantTool.GetAvailableSlots
          : AssistantTool.CreateQuoteDraft,
      toolArguments: { serviceId: service?.id ?? null },
      internalReasonCode: InternalReasonCode.InformationComplete,
      autonomyLevel: AutonomyLevel.BusinessActionProposal,
    };
  }
}

function safeInformation(
  base: Omit<ConversationDecision, 'detectedIntent' | 'intent' | 'customerGoal' | 'suggestedReply' | 'internalReasonCode'>,
  intent: ConversationIntent,
  customerGoal: CustomerGoal,
  reply: string,
  reason: InternalReasonCode,
  tool: AssistantTool,
  sources: string[],
  followUp = false,
): ConversationDecision {
  return {
    ...base,
    detectedIntent: intent,
    intent,
    customerGoal,
    suggestedReply: reply,
    suggestedNextAction: nextActionForStage(base.conversationStage, NextActionType.AnswerQuestion),
    requestedTool: tool,
    toolArguments: {},
    knowledgeSourcesUsed: sources,
    shouldFollowUp: followUp,
    recommendedFollowUpAt: followUp ? base.recommendedFollowUpAt : null,
    internalReasonCode: reason,
    autonomyLevel: AutonomyLevel.SafeInformation,
  };
}

function collectionDecision(
  base: Omit<ConversationDecision, 'detectedIntent' | 'intent' | 'customerGoal' | 'suggestedReply' | 'internalReasonCode'>,
  context: AssistantContext,
  intent: ConversationIntent,
  customerGoal: CustomerGoal,
  missing: CustomerFactKey[],
  reason: InternalReasonCode,
): ConversationDecision {
  const first = missing[0]!;
  return {
    ...base,
    detectedIntent: intent,
    intent,
    customerGoal,
    conversationStage: ConversationStage.InformationCollection,
    missingInformation: missing,
    suggestedReply: tone(context.business.kind, questionFor(first)),
    suggestedNextAction: nextActionForMissing(missing),
    requestedTool: toolForMissing(missing),
    toolArguments: { fields: missing },
    shouldFollowUp: true,
    recommendedFollowUpAt: addHours(context.latestCustomerMessage.sentAt, 48),
    internalReasonCode:
      reason === InternalReasonCode.BookingIntent || reason === InternalReasonCode.QuoteRequest
        ? InternalReasonCode.MissingRequiredInformation
        : reason,
    autonomyLevel: AutonomyLevel.InformationCollection,
  };
}

function missingServiceDecision(
  base: Omit<ConversationDecision, 'detectedIntent' | 'intent' | 'customerGoal' | 'suggestedReply' | 'internalReasonCode'>,
  context: AssistantContext,
  goal = CustomerGoal.UnderstandService,
): ConversationDecision {
  return collectionDecision(
    base,
    context,
    goal === CustomerGoal.GetQuote
      ? ConversationIntent.RequestQuote
      : goal === CustomerGoal.BookAppointment
        ? ConversationIntent.RequestAppointment
        : ConversationIntent.ServiceInfo,
    goal,
    [
      context.business.kind === BusinessKind.HomeServices
        ? CustomerFactKey.RequestedJob
        : CustomerFactKey.RequestedService,
    ],
    InternalReasonCode.MissingRequiredInformation,
  );
}

function handoffDecision(
  base: Omit<ConversationDecision, 'detectedIntent' | 'intent' | 'customerGoal' | 'suggestedReply' | 'internalReasonCode'>,
  intent: ConversationIntent,
  customerGoal: CustomerGoal,
  reply: string,
  reasonCode: InternalReasonCode,
  handoffReason: HandoffReason,
  confidence: number,
): ConversationDecision {
  return {
    ...base,
    detectedIntent: intent,
    intent,
    customerGoal,
    confidence,
    conversationStage: ConversationStage.HumanReview,
    suggestedReply: reply,
    suggestedNextAction: NextActionType.HumanReview,
    requestedTool: AssistantTool.HandoffToHuman,
    toolArguments: { reason: handoffReason },
    requiresHumanReview: true,
    handoffReason,
    riskLevel:
      handoffReason === HandoffReason.SensitiveQuestion || handoffReason === HandoffReason.SafetyConcern
        ? AssistantRiskLevel.Critical
        : AssistantRiskLevel.High,
    shouldFollowUp: false,
    recommendedFollowUpAt: null,
    internalReasonCode: reasonCode,
    autonomyLevel: AutonomyLevel.HumanHandoff,
  };
}

function nextActionForMissing(missing: CustomerFactKey[]): NextActionType {
  return missing.includes(CustomerFactKey.PhotosReceived)
    ? NextActionType.RequestPhotos
    : NextActionType.CollectInformation;
}

function toolForMissing(missing: CustomerFactKey[]): AssistantTool {
  return missing[0] === CustomerFactKey.PhotosReceived
    ? AssistantTool.RequestPhotos
    : AssistantTool.RequestCustomerInformation;
}

function nextActionForStage(
  stage: ConversationStage,
  fallback = NextActionType.ReplyToCustomer,
): NextActionType {
  if (stage === ConversationStage.AwaitingBalance) return NextActionType.CollectBalance;
  if (stage === ConversationStage.AwaitingDeposit) return NextActionType.RequestDeposit;
  if (stage === ConversationStage.QuoteSent) return NextActionType.FollowUpQuote;
  if (stage === ConversationStage.ReadyForQuote) return NextActionType.PrepareQuote;
  if (stage === ConversationStage.ReadyToBook) return NextActionType.OfferAppointment;
  if (stage === ConversationStage.JobScheduled) return NextActionType.ReplyToCustomer;
  return fallback;
}

function shouldFollowUp(stage: ConversationStage): boolean {
  return [
    ConversationStage.InformationCollection,
    ConversationStage.QuoteSent,
    ConversationStage.AwaitingDeposit,
    ConversationStage.AwaitingConfirmation,
    ConversationStage.AwaitingBalance,
  ].includes(stage);
}

function questionFor(key: CustomerFactKey): string {
  const questions: Record<CustomerFactKey, string> = {
    [CustomerFactKey.RequestedService]: 'Which service are you interested in?',
    [CustomerFactKey.CustomerType]: 'Is this your first visit, or have you been with us before?',
    [CustomerFactKey.PreferredDate]: 'Which date would work best for you?',
    [CustomerFactKey.PreferredTime]: 'What time of day works best?',
    [CustomerFactKey.TreatmentPreference]: 'Do you have a general treatment preference?',
    [CustomerFactKey.VehicleMake]: 'What is the vehicle make?',
    [CustomerFactKey.VehicleModel]: 'What is the vehicle model?',
    [CustomerFactKey.VehicleYear]: 'What year is the vehicle?',
    [CustomerFactKey.VehicleCondition]: 'How would you describe the vehicle’s current condition?',
    [CustomerFactKey.PhotosReceived]: 'Please send a few clear photos so we can assess it accurately.',
    [CustomerFactKey.RequestedJob]: 'What job do you need help with?',
    [CustomerFactKey.Location]: 'Which city or area is the property in?',
    [CustomerFactKey.Address]: 'What is the service address?',
    [CustomerFactKey.JobDetails]: 'Could you describe the problem or work needed?',
    [CustomerFactKey.Urgency]: 'How urgent is the job?',
    [CustomerFactKey.AccessConsiderations]: 'Is there anything we should know about access?',
    [CustomerFactKey.SpecialRequirements]: 'Are there any special requirements?',
  };
  return questions[key];
}

function tone(kind: BusinessKind, message: string): string {
  if (kind === BusinessKind.Clinic) return `Of course — ${lowerFirst(message)}`;
  if (kind === BusinessKind.AutoDetailing) return `Sure — ${lowerFirst(message)}`;
  return `I can help — ${lowerFirst(message)}`;
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function secondaryIntents(body: string): ConversationIntent[] {
  const intents: ConversationIntent[] = [];
  if (contains(body, ['price', 'cost', 'how much'])) intents.push(ConversationIntent.PriceQuestion);
  if (contains(body, ['book', 'appointment', 'slot'])) intents.push(ConversationIntent.RequestAppointment);
  if (contains(body, ['quote', 'estimate'])) intents.push(ConversationIntent.RequestQuote);
  return intents.slice(1);
}

function addHours(value: string, hours: number): string {
  return new Date(new Date(value).getTime() + hours * 60 * 60 * 1000).toISOString();
}

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat('en', { style: 'currency', currency }).format(cents / 100);
}

function naturalList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? 'the configured payment methods';
  return `${items.slice(0, -1).join(', ')} or ${items.at(-1)}`;
}

function isUnverifiedPaymentClaim(body: string): boolean {
  return /\b(i (?:already )?paid|mark (?:it|me) (?:as )?paid|payment was sent)\b/i.test(body);
}

function outsideServiceArea(context: AssistantContext): string | null {
  if (context.business.kind !== BusinessKind.HomeServices) return null;
  const location = context.memory.find((fact) => fact.key === CustomerFactKey.Location)?.value;
  if (typeof location !== 'string') return null;
  const normalized = location.toLowerCase();
  const inside = context.knowledge.serviceAreaLocations.some(
    (area) => normalized.includes(area.toLowerCase()) || area.toLowerCase().includes(normalized),
  );
  return inside ? null : location;
}

function verifiedPaymentState(context: AssistantContext): {
  remainingCents: number;
  reply: string;
  sources: string[];
} {
  const job = [...context.jobs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const appointment = [...context.appointments].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const reference = job ?? appointment;
  if (!reference) {
    return {
      remainingCents: 0,
      reply: 'I don’t see a validated appointment or job payment record yet.',
      sources: ['DomainState.noPaymentReference'],
    };
  }
  const remainingCents = remainingBalance(reference.totalCents, context.payments, reference.id);
  const collected = context.payments
    .filter((payment) => payment.referenceId === reference.id && payment.status === PaymentStatus.Collected)
    .reduce(
      (sum, payment) => sum + (payment.kind === PaymentKind.Refund ? -payment.amountCents : payment.amountCents),
      0,
    );
  return {
    remainingCents,
    reply: remainingCents > 0
      ? `The verified remaining balance is ${formatMoney(remainingCents, context.business.currency)}. We have ${formatMoney(collected, context.business.currency)} recorded as collected.`
      : 'The verified balance is fully paid.',
    sources: [`DomainState.${job && job.status === JobStatus.Completed ? 'job' : 'appointment'}.${reference.id}`],
  };
}
