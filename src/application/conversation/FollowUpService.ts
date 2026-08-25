import {
  ConversationChannel,
  ConversationMode,
  ConversationStage,
  FollowUpChannel,
  FollowUpOwner,
  FollowUpResult,
  FollowUpScenario,
  FollowUpStatus,
  FollowUpStopReason,
  MessagePurpose,
  NextActionType,
  type Conversation,
  type ScheduledFollowUp,
  type TenantEntity,
} from '../../domain/entities';
import { DomainError } from '../../domain/rules';
import type { DatabasePort } from '../../repositories/contracts';
import { InternalReasonCode, type ConversationDecision } from '../../types/assistant';

export interface ScheduleFollowUpInput {
  businessId: string;
  conversationId: string;
  scenario: FollowUpScenario;
  dueAt: string;
  purpose?: MessagePurpose;
  triggeringMessageId?: string;
  reason: string;
  draftMessage?: string;
}

export class FollowUpService {
  constructor(
    private readonly database: DatabasePort,
    private readonly now: () => string,
    private readonly id: () => string,
  ) {}

  schedule(input: ScheduleFollowUpInput): ScheduledFollowUp {
    const repositories = this.database.repositories;
    const conversation = required(
      repositories.conversations.get(input.businessId, input.conversationId),
      'Conversation not found',
    );
    if (
      conversation.mode !== ConversationMode.AiActive ||
      conversation.state === 'COMPLETE'
    ) {
      throw new DomainError('Follow-up is blocked for this conversation state', 'FOLLOW_UP_BLOCKED');
    }
    const currentAction = conversation.nextActionId
      ? repositories.nextActions.get(input.businessId, conversation.nextActionId)
      : null;
    if (currentAction?.type === NextActionType.HumanReview) {
      throw new DomainError('Human review blocks automated follow-up', 'FOLLOW_UP_BLOCKED');
    }
    const consent = repositories.consentRecords.find(
      input.businessId,
      (record) => record.contactId === conversation.contactId,
    )[0];
    const purpose = input.purpose ?? MessagePurpose.Operational;
    if (purpose === MessagePurpose.Marketing && (!consent?.marketingAllowed || consent.optedOut)) {
      throw new DomainError('Marketing follow-up is blocked', 'MARKETING_BLOCKED');
    }
    if (purpose === MessagePurpose.Operational && consent && !consent.operationalAllowed) {
      throw new DomainError('Operational follow-up is blocked', 'OPERATIONAL_BLOCKED');
    }
    const existing = repositories.scheduledFollowUps.find(
      input.businessId,
      (followUp) =>
        followUp.conversationId === input.conversationId &&
        followUp.scenario === input.scenario &&
        followUp.status === FollowUpStatus.Scheduled,
    )[0];
    if (existing) return existing;
    const idempotencyKey = `${input.conversationId}:${input.scenario}:${input.triggeringMessageId ?? 'state'}`;
    const followUp: ScheduledFollowUp = {
      ...this.base(input.businessId),
      contactId: conversation.contactId,
      conversationId: input.conversationId,
      scenario: input.scenario,
      status: FollowUpStatus.Scheduled,
      purpose,
      dueAt: new Date(input.dueAt).toISOString(),
      idempotencyKey,
      triggeringMessageId: input.triggeringMessageId ?? null,
      reason: input.reason,
      sequenceKey: input.scenario,
      sequenceStep: 0,
      channel: followUpChannel(conversation.channel),
      attemptCount: 0,
      attempts: [],
      nextAttemptAt: new Date(input.dueAt).toISOString(),
      lastAttemptAt: null,
      lastResponseAt: null,
      stopReason: null,
      manualOverride: false,
      owner: FollowUpOwner.Assistant,
      ownerTeamMemberId: conversation.ownerTeamMemberId,
      draftMessage: input.draftMessage?.trim() || null,
      result: FollowUpResult.Pending,
    };
    return repositories.scheduledFollowUps.save(input.businessId, followUp);
  }

  scheduleForDecision(
    businessId: string,
    conversation: Conversation,
    triggeringMessageId: string,
    decision: ConversationDecision,
  ): ScheduledFollowUp | null {
    if (!decision.shouldFollowUp) return null;
    const scenario = scenarioForDecision(decision);
    if (!scenario) return null;
    return this.schedule({
      businessId,
      conversationId: conversation.id,
      scenario,
      dueAt: this.configuredDueAt(businessId, scenario),
      purpose: MessagePurpose.Operational,
      triggeringMessageId,
      reason: followUpReason(scenario),
    });
  }

  scheduleForStage(
    businessId: string,
    conversationId: string,
    stage: ConversationStage,
    dueAt?: string,
  ): ScheduledFollowUp {
    const scenario = scenarioForStage(stage);
    if (!scenario) throw new DomainError('This stage does not need a follow-up', 'FOLLOW_UP_NOT_REQUIRED');
    return this.schedule({
      businessId,
      conversationId,
      scenario,
      dueAt: dueAt ?? this.configuredDueAt(businessId, scenario),
      reason: followUpReason(scenario),
    });
  }

  scheduleReactivation(
    businessId: string,
    conversationId: string,
    operationKey: string,
    draftMessage: string,
  ): ScheduledFollowUp {
    return this.schedule({
      businessId,
      conversationId,
      scenario: FollowUpScenario.Reactivation,
      dueAt: this.configuredDueAt(businessId, FollowUpScenario.Reactivation),
      purpose: MessagePurpose.Marketing,
      triggeringMessageId: operationKey,
      reason: followUpReason(FollowUpScenario.Reactivation),
      draftMessage,
    });
  }

  completeForCustomerResponse(
    businessId: string,
    conversationId: string,
  ): ScheduledFollowUp[] {
    const repositories = this.database.repositories;
    return repositories.scheduledFollowUps
      .find(
        businessId,
        (followUp) =>
          followUp.conversationId === conversationId &&
          followUp.status === FollowUpStatus.Scheduled,
      )
      .map((followUp) =>
        repositories.scheduledFollowUps.save(businessId, {
          ...followUp,
          updatedAt: this.now(),
          status: FollowUpStatus.Completed,
          nextAttemptAt: null,
          lastResponseAt: this.now(),
          stopReason: FollowUpStopReason.CustomerReplied,
          result: FollowUpResult.ResponseReceived,
        }),
      );
  }

  recordAttempt(
    businessId: string,
    followUpId: string,
    result: FollowUpResult.Sent | FollowUpResult.Failed,
    operationKey: string,
  ): ScheduledFollowUp {
    const repositories = this.database.repositories;
    const followUp = required(
      repositories.scheduledFollowUps.get(businessId, followUpId),
      'Follow-up not found',
    );
    const normalizedOperationKey = operationKey.trim();
    if (!normalizedOperationKey) {
      throw new DomainError('Follow-up attempt operation key is required', 'INVALID_OPERATION_KEY');
    }
    const existingAttempt = followUp.attempts.find(
      (attempt) => attempt.operationKey === normalizedOperationKey,
    );
    if (existingAttempt) {
      if (existingAttempt.result !== result) {
        throw new DomainError(
          'Follow-up attempt operation key was reused with different facts',
          'IDEMPOTENCY_CONFLICT',
        );
      }
      return followUp;
    }
    if (followUp.status !== FollowUpStatus.Scheduled) {
      throw new DomainError('Only a scheduled follow-up can record an attempt', 'FOLLOW_UP_NOT_SCHEDULED');
    }
    const settings = required(
      repositories.businessSettings.list(businessId)[0] ?? null,
      'Business settings not found',
    );
    const nextStep = followUp.sequenceStep + 1;
    const nextDelayHours = settings.followUpCadenceHours[followUp.scenario]?.[nextStep];
    const nextAttemptAt =
      nextDelayHours === undefined ? null : addHours(this.now(), nextDelayHours);
    return repositories.scheduledFollowUps.save(businessId, {
      ...followUp,
      updatedAt: this.now(),
      status: nextAttemptAt ? FollowUpStatus.Scheduled : FollowUpStatus.Completed,
      dueAt: nextAttemptAt ?? followUp.dueAt,
      sequenceStep: nextStep,
      attemptCount: followUp.attemptCount + 1,
      attempts: [
        ...followUp.attempts,
        { operationKey: normalizedOperationKey, result, attemptedAt: this.now() },
      ],
      nextAttemptAt,
      lastAttemptAt: this.now(),
      result,
    });
  }

  cancelPending(
    businessId: string,
    conversationId: string,
    stopReason: FollowUpStopReason = FollowUpStopReason.StateChanged,
    manualOverride = false,
  ): ScheduledFollowUp[] {
    const repositories = this.database.repositories;
    return repositories.scheduledFollowUps
      .find(
        businessId,
        (followUp) =>
          followUp.conversationId === conversationId &&
          followUp.status === FollowUpStatus.Scheduled,
      )
      .map((followUp) =>
        repositories.scheduledFollowUps.save(businessId, {
          ...followUp,
          updatedAt: this.now(),
          status: FollowUpStatus.Cancelled,
          nextAttemptAt: null,
          stopReason,
          manualOverride,
          owner: manualOverride ? FollowUpOwner.Human : followUp.owner,
          result: FollowUpResult.Stopped,
        }),
      );
  }

  private configuredDueAt(businessId: string, scenario: FollowUpScenario): string {
    const settings = required(
      this.database.repositories.businessSettings.list(businessId)[0] ?? null,
      'Business settings not found',
    );
    const firstDelayHours = settings.followUpCadenceHours[scenario]?.[0];
    if (firstDelayHours === undefined) {
      throw new DomainError(
        `No follow-up cadence is configured for ${scenario}`,
        'FOLLOW_UP_CADENCE_MISSING',
      );
    }
    return addHours(this.now(), firstDelayHours);
  }

  private base(businessId: string): TenantEntity {
    const at = this.now();
    return { id: this.id(), businessId, createdAt: at, updatedAt: at };
  }
}

function followUpChannel(channel: ConversationChannel): FollowUpChannel {
  if (channel === ConversationChannel.WhatsApp) return FollowUpChannel.WhatsApp;
  if (channel === ConversationChannel.Instagram) return FollowUpChannel.Instagram;
  if (channel === ConversationChannel.Email) return FollowUpChannel.Email;
  return FollowUpChannel.Manual;
}

function addHours(value: string, hours: number): string {
  return new Date(new Date(value).getTime() + hours * 60 * 60 * 1000).toISOString();
}

function scenarioForDecision(decision: ConversationDecision): FollowUpScenario | null {
  if (decision.internalReasonCode === InternalReasonCode.PriceQuestion) {
    return FollowUpScenario.PriceInquiry;
  }
  if (decision.internalReasonCode === InternalReasonCode.BookingIntent) {
    return FollowUpScenario.BookingConfirmation;
  }
  if (decision.internalReasonCode === InternalReasonCode.MissingRequiredInformation) {
    return FollowUpScenario.MissingInformation;
  }
  return scenarioForStage(decision.conversationStage);
}

function scenarioForStage(stage: ConversationStage): FollowUpScenario | null {
  if (stage === ConversationStage.QuoteSent) return FollowUpScenario.QuoteResponse;
  if (stage === ConversationStage.AwaitingDeposit) return FollowUpScenario.DepositRequest;
  if (stage === ConversationStage.AwaitingBalance) return FollowUpScenario.OutstandingBalance;
  if (stage === ConversationStage.AwaitingConfirmation) {
    return FollowUpScenario.BookingConfirmation;
  }
  if (stage === ConversationStage.InformationCollection) {
    return FollowUpScenario.MissingInformation;
  }
  return null;
}

function followUpReason(scenario: FollowUpScenario): string {
  const reasons: Record<FollowUpScenario, string> = {
    [FollowUpScenario.PriceInquiry]: 'Check whether the customer still needs help after the price question.',
    [FollowUpScenario.BookingConfirmation]: 'Check whether the customer wants to confirm the booking.',
    [FollowUpScenario.MissingInformation]: 'Ask for the remaining detail needed to move forward.',
    [FollowUpScenario.QuoteResponse]: 'Follow up on the quote if the customer has not replied.',
    [FollowUpScenario.DepositRequest]: 'Remind the customer about the required deposit.',
    [FollowUpScenario.OutstandingBalance]: 'Request the remaining payment for completed work.',
    [FollowUpScenario.Reactivation]: 'Reconnect with an eligible past customer after owner approval.',
  };
  return reasons[scenario];
}

function required<T>(value: T | null, message: string): T {
  if (value === null) throw new DomainError(message, 'NOT_FOUND');
  return value;
}
