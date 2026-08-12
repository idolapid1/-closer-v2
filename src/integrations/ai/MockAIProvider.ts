import {
  BusinessKind,
  ConversationIntent,
  HandoffReason,
  NextActionType,
} from '../../domain/entities';
import { AssistantTool, type AssistantContext, type AssistantDecision } from '../../types/assistant';
import type { AIProvider } from './AIProvider';

const contains = (body: string, terms: string[]): boolean => terms.some((term) => body.includes(term));

export class MockAIProvider implements AIProvider {
  async decide(context: AssistantContext): Promise<AssistantDecision> {
    const body = context.latestCustomerMessage.body.toLowerCase().trim();

    if (contains(body, ['refund', 'money back'])) {
      return handoff(ConversationIntent.Refund, HandoffReason.Refund, 'A refund request needs the owner.');
    }
    if (contains(body, ['complaint', 'unhappy', 'angry', 'terrible', 'lawyer', 'legal'])) {
      const reason = contains(body, ['lawyer', 'legal'])
        ? HandoffReason.LegalQuestion
        : HandoffReason.Complaint;
      return handoff(ConversationIntent.Complaint, reason, 'I’ll bring in the owner to help with this.');
    }
    if (
      context.business.kind === BusinessKind.Clinic &&
      contains(body, ['medical', 'pregnant', 'allergy', 'reaction', 'diagnose', 'safe for me'])
    ) {
      return handoff(
        ConversationIntent.SensitiveQuestion,
        HandoffReason.SensitiveQuestion,
        'A team member should review this sensitive question before we answer.',
      );
    }
    if (body.length < 3 || contains(body, ['???', 'not sure what i mean', 'asdf'])) {
      return handoff(
        ConversationIntent.Unknown,
        HandoffReason.LowConfidence,
        'I want to make sure we understand. A team member will take a look.',
        0.31,
      );
    }
    if (contains(body, ['hours', 'open', 'closing'])) {
      return information(
        ConversationIntent.AskBusinessInfo,
        `We’re open ${context.knowledge.openingHours}.`,
        AssistantTool.GetBusinessInfo,
      );
    }
    if (contains(body, ['address', 'located', 'where are you'])) {
      return information(
        ConversationIntent.AskBusinessInfo,
        `You can find us at ${context.knowledge.address}.`,
        AssistantTool.GetBusinessInfo,
      );
    }
    if (contains(body, ['price', 'cost', 'how much'])) {
      const pricedService = context.services.find(
        (service) => service.fixedPriceCents !== null && body.includes(service.name.split(' ')[0]?.toLowerCase() ?? ''),
      ) ?? context.services.find((service) => service.fixedPriceCents !== null);
      if (pricedService?.fixedPriceCents !== null && pricedService?.fixedPriceCents !== undefined) {
        return information(
          ConversationIntent.AskBusinessInfo,
          `${pricedService.name} is ${(pricedService.fixedPriceCents / 100).toFixed(2)} ${context.business.currency}.`,
          AssistantTool.GetServicePrice,
        );
      }
      return collect(
        ConversationIntent.RequestQuote,
        context.knowledge.requiredQualificationFields,
        'To prepare an accurate quote, could you share the details below?',
        context.knowledge.requiredQualificationFields.some((field) => field.toLowerCase().includes('photo'))
          ? AssistantTool.RequestPhotos
          : AssistantTool.RequestCustomerInformation,
      );
    }
    if (contains(body, ['book', 'appointment', 'available', 'slot'])) {
      return collect(
        ConversationIntent.RequestAppointment,
        ['preferredTime'],
        'What day or time would work best for you?',
        AssistantTool.RequestCustomerInformation,
      );
    }
    if (contains(body, ['quote', 'estimate', 'detail', 'repair', 'problem'])) {
      return collect(
        ConversationIntent.RequestQuote,
        context.knowledge.requiredQualificationFields,
        'I can help prepare that. Please share the missing details so we can move forward.',
        context.knowledge.requiredQualificationFields.some((field) => field.toLowerCase().includes('photo'))
          ? AssistantTool.RequestPhotos
          : AssistantTool.RequestCustomerInformation,
      );
    }
    return collect(
      ConversationIntent.ProvideInformation,
      context.knowledge.requiredQualificationFields,
      'Thanks. Could you share a little more detail so we can help?',
      AssistantTool.RequestCustomerInformation,
    );
  }
}

function information(
  intent: ConversationIntent,
  reply: string,
  tool: AssistantTool,
): AssistantDecision {
  return {
    intent,
    confidence: 0.98,
    missingInformation: [],
    suggestedReply: reply,
    suggestedNextAction: NextActionType.AnswerQuestion,
    requestedTool: tool,
    requiresHumanReview: false,
    handoffReason: null,
  };
}

function collect(
  intent: ConversationIntent,
  missingInformation: string[],
  reply: string,
  tool: AssistantTool,
): AssistantDecision {
  const requestPhotos = tool === AssistantTool.RequestPhotos;
  return {
    intent,
    confidence: 0.91,
    missingInformation,
    suggestedReply: reply,
    suggestedNextAction: requestPhotos
      ? NextActionType.RequestPhotos
      : NextActionType.CollectInformation,
    requestedTool: tool,
    requiresHumanReview: false,
    handoffReason: null,
  };
}

function handoff(
  intent: ConversationIntent,
  reason: HandoffReason,
  reply: string,
  confidence = 0.96,
): AssistantDecision {
  return {
    intent,
    confidence,
    missingInformation: [],
    suggestedReply: reply,
    suggestedNextAction: NextActionType.HumanReview,
    requestedTool: AssistantTool.HandoffToHuman,
    requiresHumanReview: true,
    handoffReason: reason,
  };
}
