import {
  BusinessKind,
  ConversationIntent,
  ConversationStage,
  CustomerFactKey,
  HandoffReason,
  KnowledgeTopic,
  NextActionType,
  WorkflowType,
} from '../../domain/entities';
import { DomainError } from '../../domain/rules';
import {
  AssistantRiskLevel,
  AssistantTool,
  AutonomyLevel,
  InternalReasonCode,
  ToolExecutionStatus,
  type AssistantContext,
  type AssistantDecision,
  type ToolExecutionResult,
} from '../../types/assistant';

/**
 * Treats every provider decision as untrusted input. This policy validates tool
 * permissions and rebuilds customer-facing text from validated tool results.
 */
export class AssistantDecisionPolicy {
  validate(context: AssistantContext, decision: AssistantDecision): AssistantDecision {
    if (!Number.isFinite(decision.confidence) || decision.confidence < 0 || decision.confidence > 1) {
      throw new DomainError(
        'Assistant confidence must be between zero and one',
        'INVALID_ASSISTANT_DECISION',
      );
    }
    if (decision.intent !== decision.detectedIntent) {
      throw new DomainError('Assistant intent aliases do not match', 'INVALID_ASSISTANT_DECISION');
    }
    if (
      decision.confidence < context.knowledge.minimumAssistantConfidence &&
      !decision.requiresHumanReview
    ) {
      return handoff(decision, HandoffReason.LowConfidence, InternalReasonCode.LowConfidence,
        'I’m not confident I understood that. A team member will take a look.');
    }
    const topics = automaticKnowledgeTopics(decision);
    if (
      [
        AssistantTool.GetBusinessInfo,
        AssistantTool.GetServiceInfo,
        AssistantTool.GetServicePrice,
      ].includes(decision.requestedTool) &&
      topics.length === 0
    ) {
      return unsupportedKnowledgeHandoff(decision);
    }
    if (topics.some((topic) => !context.knowledge.allowedAutomaticAnswers.includes(topic))) {
      return unsupportedKnowledgeHandoff(decision);
    }
    if (
      decision.requiresHumanReview !==
      (decision.requestedTool === AssistantTool.HandoffToHuman)
    ) {
      throw new DomainError(
        'Human review and handoff tool must agree',
        'INVALID_ASSISTANT_DECISION',
      );
    }
    if (!decisionMatchesPermission(context, decision)) {
      return handoff(
        decision,
        HandoffReason.SafetyConcern,
        InternalReasonCode.UnsupportedRequest,
        'A team member needs to review that request before anything changes.',
      );
    }
    return structuredClone(decision);
  }

  applyToolResult(
    context: AssistantContext,
    decision: AssistantDecision,
    result: ToolExecutionResult,
  ): AssistantDecision {
    if (
      result.tool === AssistantTool.GetBusinessInfo &&
      result.status === ToolExecutionStatus.Completed
    ) {
      return { ...decision, suggestedReply: groundedBusinessReply(context, decision) };
    }
    if (
      result.tool === AssistantTool.GetServiceInfo &&
      result.status === ToolExecutionStatus.Completed
    ) {
      return { ...decision, suggestedReply: groundedServiceReply(context, decision, result) };
    }
    if (result.tool === AssistantTool.GetServicePrice) {
      if (result.status === ToolExecutionStatus.Blocked) {
        return handoff(
          decision,
          HandoffReason.UnsupportedKnowledge,
          InternalReasonCode.UnsupportedPricing,
          'I don’t have a verified price for that service. A team member will confirm it.',
        );
      }
      const fixedPriceCents = result.data.fixedPriceCents;
      if (typeof fixedPriceCents === 'number') {
        const serviceName = context.services.find(
          (service) => service.id === result.data.serviceId,
        )?.name;
        return {
          ...decision,
          suggestedReply: `${serviceName ?? 'That service'} is ${formatCurrency(
            fixedPriceCents,
            context.business.currency,
          )}.`,
        };
      }
    }
    if (
      [AssistantTool.GetAvailableSlots, AssistantTool.SuggestAppointment].includes(result.tool)
    ) {
      if (result.status === ToolExecutionStatus.Blocked) {
        return {
          ...decision,
          suggestedReply: 'Please share a specific date in YYYY-MM-DD format so I can check real availability.',
          suggestedNextAction: NextActionType.CollectInformation,
          missingInformation: [CustomerFactKey.PreferredDate],
        };
      }
      const slots = result.data.slots;
      if (Array.isArray(slots) && slots.length > 0) {
        return {
          ...decision,
          conversationStage: ConversationStage.AppointmentProposed,
          suggestedReply: `The first available options are ${slots
            .map((slot) => new Date(slot).toISOString().slice(11, 16))
            .join(', ')}. Which works best?`,
          suggestedNextAction: NextActionType.OfferAppointment,
          knowledgeSourcesUsed: [
            ...decision.knowledgeSourcesUsed,
            'DomainState.validatedAvailability',
          ],
        };
      }
      if (Array.isArray(slots)) {
        return {
          ...decision,
          suggestedReply: 'There are no verified openings on that date. Which other date could work?',
          suggestedNextAction: NextActionType.CollectInformation,
          missingInformation: [CustomerFactKey.PreferredDate],
        };
      }
    }
    if (
      result.tool === AssistantTool.GetConversationContext &&
      decision.detectedIntent === ConversationIntent.PaymentQuestion &&
      result.status === ToolExecutionStatus.Completed
    ) {
      const remainingCents = result.data.verifiedRemainingCents;
      const collectedCents = result.data.verifiedCollectedCents;
      return {
        ...decision,
        suggestedReply:
          typeof remainingCents === 'number' && typeof collectedCents === 'number'
            ? remainingCents > 0
              ? `The verified remaining balance is ${formatCurrency(remainingCents, context.business.currency)}. We have ${formatCurrency(collectedCents, context.business.currency)} recorded as collected.`
              : 'The verified balance is fully paid.'
            : 'I don’t see a validated appointment or job payment record yet.',
      };
    }
    if (
      result.tool === AssistantTool.RequestCustomerInformation &&
      result.status !== ToolExecutionStatus.Blocked &&
      decision.missingInformation[0]
    ) {
      return {
        ...decision,
        suggestedReply: groundedCollectionReply(
          context,
          decision,
          result,
          decision.missingInformation[0],
        ),
      };
    }
    if (
      result.tool === AssistantTool.RequestPhotos &&
      result.status !== ToolExecutionStatus.Blocked
    ) {
      return {
        ...decision,
        suggestedReply: groundedCollectionReply(
          context,
          decision,
          result,
          CustomerFactKey.PhotosReceived,
        ),
      };
    }
    if (
      result.tool === AssistantTool.CreateNextAction &&
      decision.internalReasonCode === InternalReasonCode.OptOut
    ) {
      return { ...decision, suggestedReply: 'Understood. Marketing messages are now stopped.' };
    }
    return decision;
  }

  canAutomaticallySend(decision: AssistantDecision, result: ToolExecutionResult): boolean {
    if (result.status === ToolExecutionStatus.Blocked || decision.requiresHumanReview) return false;
    if (decision.autonomyLevel === AutonomyLevel.InformationCollection) {
      return [
        AssistantTool.RequestCustomerInformation,
        AssistantTool.RequestPhotos,
      ].includes(decision.requestedTool);
    }
    if (decision.autonomyLevel !== AutonomyLevel.SafeInformation) return false;
    return [
      AssistantTool.GetBusinessInfo,
      AssistantTool.GetServiceInfo,
      AssistantTool.GetServicePrice,
      AssistantTool.GetConversationContext,
    ].includes(decision.requestedTool) ||
      (decision.requestedTool === AssistantTool.CreateNextAction &&
        decision.internalReasonCode === InternalReasonCode.OptOut);
  }
}

function automaticKnowledgeTopics(decision: AssistantDecision): KnowledgeTopic[] {
  const sources = decision.knowledgeSourcesUsed.join(' ');
  const topics: KnowledgeTopic[] = [];
  if (sources.includes('openingHours')) topics.push(KnowledgeTopic.OpeningHours);
  if (sources.includes('acceptedPaymentMethods')) topics.push(KnowledgeTopic.PaymentMethods);
  if (sources.includes('cancellationPolicy')) topics.push(KnowledgeTopic.CancellationPolicy);
  if (sources.includes('depositPolicy')) topics.push(KnowledgeTopic.DepositPolicy);
  if (sources.includes('serviceArea')) topics.push(KnowledgeTopic.ServiceArea);
  if (sources.includes('address')) topics.push(KnowledgeTopic.Address);
  if (sources.includes('fixedPricesCents')) topics.push(KnowledgeTopic.FixedPrice);
  if (sources.includes('priceRangesCents')) topics.push(KnowledgeTopic.PriceRange);
  if (sources.includes('serviceDescriptions')) topics.push(KnowledgeTopic.ServiceDescription);
  if (sources.includes('serviceDurationsMinutes')) topics.push(KnowledgeTopic.ServiceDuration);
  if (sources.includes('preparationInstructions')) topics.push(KnowledgeTopic.PreparationInstructions);
  return topics;
}

function unsupportedKnowledgeHandoff(decision: AssistantDecision): AssistantDecision {
  return handoff(
    decision,
    HandoffReason.UnsupportedKnowledge,
    InternalReasonCode.UnsupportedPolicy,
    'I don’t have an approved answer for that. A team member will confirm it.',
  );
}

function handoff(
  decision: AssistantDecision,
  reason: HandoffReason,
  reasonCode: InternalReasonCode,
  reply: string,
): AssistantDecision {
  return {
    ...decision,
    conversationStage: ConversationStage.HumanReview,
    suggestedReply: reply,
    suggestedNextAction: NextActionType.HumanReview,
    requestedTool: AssistantTool.HandoffToHuman,
    toolArguments: { reason },
    requiresHumanReview: true,
    handoffReason: reason,
    riskLevel: AssistantRiskLevel.High,
    shouldFollowUp: false,
    recommendedFollowUpAt: null,
    internalReasonCode: reasonCode,
    autonomyLevel: AutonomyLevel.HumanHandoff,
  };
}

function decisionMatchesPermission(
  context: AssistantContext,
  decision: AssistantDecision,
): boolean {
  const allowedTools: Record<AutonomyLevel, AssistantTool[]> = {
    [AutonomyLevel.SafeInformation]: [
      AssistantTool.GetBusinessInfo,
      AssistantTool.GetServiceInfo,
      AssistantTool.GetServicePrice,
      AssistantTool.GetCustomerContext,
      AssistantTool.GetConversationContext,
      AssistantTool.CreateNextAction,
    ],
    [AutonomyLevel.InformationCollection]: [
      AssistantTool.RequestCustomerInformation,
      AssistantTool.RequestPhotos,
    ],
    [AutonomyLevel.BusinessActionProposal]: [
      AssistantTool.GetAvailableSlots,
      AssistantTool.SuggestAppointment,
      AssistantTool.CreateQuoteDraft,
      AssistantTool.CreateNextAction,
    ],
    [AutonomyLevel.HumanHandoff]: [AssistantTool.HandoffToHuman],
  };
  if (!allowedTools[decision.autonomyLevel]?.includes(decision.requestedTool)) return false;
  if (
    decision.requestedTool === AssistantTool.CreateNextAction &&
    ![
      InternalReasonCode.OptOut,
      InternalReasonCode.PaymentQuestion,
    ].includes(decision.internalReasonCode)
  ) {
    return false;
  }
  if (
    decision.requestedTool === AssistantTool.GetConversationContext &&
    decision.detectedIntent !== ConversationIntent.PaymentQuestion
  ) {
    return false;
  }
  if (
    [AssistantTool.GetAvailableSlots, AssistantTool.SuggestAppointment].includes(
      decision.requestedTool,
    ) &&
    context.lead.workflowType !== WorkflowType.AppointmentService
  ) {
    return false;
  }
  if (
    decision.requestedTool === AssistantTool.CreateQuoteDraft &&
    context.lead.workflowType !== WorkflowType.QuoteJob
  ) {
    return false;
  }
  return true;
}

function groundedBusinessReply(
  context: AssistantContext,
  decision: AssistantDecision,
): string {
  const topics = automaticKnowledgeTopics(decision);
  if (topics.includes(KnowledgeTopic.OpeningHours)) {
    return `We’re open ${context.knowledge.openingHours}.`;
  }
  if (topics.includes(KnowledgeTopic.Address)) return `You can find us at ${context.knowledge.address}.`;
  if (topics.includes(KnowledgeTopic.ServiceArea)) {
    return `Our configured service area is ${context.knowledge.serviceArea}.`;
  }
  if (topics.includes(KnowledgeTopic.PaymentMethods)) {
    return `You can pay by ${naturalList(context.knowledge.acceptedPaymentMethods)}.`;
  }
  if (topics.includes(KnowledgeTopic.CancellationPolicy)) return context.knowledge.cancellationPolicy;
  if (topics.includes(KnowledgeTopic.DepositPolicy)) return context.knowledge.depositPolicy;
  return 'A team member will confirm that information.';
}

function groundedServiceReply(
  context: AssistantContext,
  decision: AssistantDecision,
  result: ToolExecutionResult,
): string {
  const topics = automaticKnowledgeTopics(decision);
  const parts: string[] = [];
  if (
    topics.includes(KnowledgeTopic.ServiceDescription) &&
    typeof result.data.description === 'string'
  ) parts.push(result.data.description);
  if (
    topics.includes(KnowledgeTopic.ServiceDuration) &&
    typeof result.data.durationMinutes === 'number'
  ) {
    parts.push(`It takes about ${result.data.durationMinutes} minutes.`);
  }
  const preparation = result.data.preparationInstructions;
  if (
    topics.includes(KnowledgeTopic.PreparationInstructions) &&
    Array.isArray(preparation)
  ) parts.push(...preparation);
  return parts.join(' ') || `A team member will confirm the ${context.business.name} service details.`;
}

function groundedCollectionQuestion(kind: BusinessKind, key: CustomerFactKey): string {
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
  const question = questions[key];
  if (kind === BusinessKind.Clinic) return `Of course — ${lowerFirst(question)}`;
  if (kind === BusinessKind.AutoDetailing) return `Sure — ${lowerFirst(question)}`;
  return `I can help — ${lowerFirst(question)}`;
}

function groundedCollectionReply(
  context: AssistantContext,
  decision: AssistantDecision,
  result: ToolExecutionResult,
  key: CustomerFactKey,
): string {
  const question = groundedCollectionQuestion(context.business.kind, key);
  const topics = automaticKnowledgeTopics(decision);
  const minCents = result.data.minCents;
  const maxCents = result.data.maxCents;
  const serviceName = result.data.serviceName;
  if (
    topics.includes(KnowledgeTopic.PriceRange) &&
    typeof minCents === 'number' &&
    typeof maxCents === 'number'
  ) {
    return `${typeof serviceName === 'string' ? serviceName : 'That service'} is usually ${formatCurrency(minCents, context.business.currency)}–${formatCurrency(maxCents, context.business.currency)}. ${question}`;
  }
  return question;
}

function naturalList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? 'the configured payment methods';
  return `${items.slice(0, -1).join(', ')} or ${items.at(-1)}`;
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function formatCurrency(cents: number, currency: string): string {
  return new Intl.NumberFormat('en', { style: 'currency', currency }).format(cents / 100);
}
