import { describe, expect, it } from 'vitest';
import {
  ConversationIntent,
  ConversationMode,
  HandoffReason,
  MessageAuthor,
  MessagePurpose,
  NextActionStatus,
  NextActionType,
} from '../domain/entities';
import { AssistantTool } from '../types/assistant';
import { createHarness } from '../test/harness';

describe('conversation and assistant orchestration', () => {
  it('creates a new current next action when a customer replies', async () => {
    const { service, database } = createHarness();
    const conversationId = 'biz-clinic-conversation-new';
    const before = database.repositories.conversations.get('biz-clinic', conversationId)!;
    const decision = await service.receiveCustomerMessage('biz-clinic', conversationId, 'I would like to book');
    const after = database.repositories.conversations.get('biz-clinic', conversationId)!;
    const currentAction = database.repositories.nextActions.get('biz-clinic', after.nextActionId!)!;

    expect(decision.intent).toBe(ConversationIntent.RequestAppointment);
    expect(after.lastCustomerMessageAt).not.toBeNull();
    expect(after.nextActionId).not.toBe(before.nextActionId);
    expect(currentAction.status).toBe(NextActionStatus.Pending);
    expect(currentAction.type).toBe(NextActionType.CollectInformation);
  });

  it('answers safe information from the current business knowledge', async () => {
    const { service } = createHarness();
    const decision = await service.receiveCustomerMessage(
      'biz-clinic',
      'biz-clinic-conversation-new',
      'What are your opening hours?',
    );
    expect(decision.requiresHumanReview).toBe(false);
    expect(decision.requestedTool).toBe(AssistantTool.GetBusinessInfo);
    expect(decision.suggestedReply).toContain('Sunday–Thursday');
  });

  it('requests business-specific missing information for a quote', async () => {
    const { service } = createHarness();
    const decision = await service.receiveCustomerMessage(
      'biz-detailing',
      'biz-detailing-conversation-new',
      'How much does detailing cost?',
    );
    expect(decision.intent).toBe(ConversationIntent.RequestQuote);
    expect(decision.missingInformation).toEqual(['vehicleModel', 'vehicleYear', 'vehiclePhotos']);
    expect(decision.requestedTool).toBe(AssistantTool.RequestPhotos);
  });

  it('hands a sensitive clinic question to a human and pauses automation', async () => {
    const { service, database } = createHarness();
    const conversationId = 'biz-clinic-conversation-new';
    const decision = await service.receiveCustomerMessage(
      'biz-clinic',
      conversationId,
      'I am pregnant. Is this medically safe for me?',
    );
    const conversation = database.repositories.conversations.get('biz-clinic', conversationId)!;
    expect(decision.handoffReason).toBe(HandoffReason.SensitiveQuestion);
    expect(conversation.mode).toBe(ConversationMode.HumanActive);
    expect(conversation.automationEnabled).toBe(false);
  });

  it('hands low-confidence input to a human', async () => {
    const { service } = createHarness();
    const decision = await service.receiveCustomerMessage(
      'biz-home',
      'biz-home-conversation-new',
      '???',
    );
    expect(decision.confidence).toBeLessThan(0.5);
    expect(decision.handoffReason).toBe(HandoffReason.LowConfidence);
  });

  it('blocks assistant sends during human takeover and only resumes explicitly', async () => {
    const { service, database } = createHarness();
    const businessId = 'biz-clinic';
    const conversationId = 'biz-clinic-conversation-new';
    service.startHumanTakeover(businessId, conversationId, HandoffReason.Manual, 'Owner requested takeover.');
    const handoffAction = database.repositories.nextActions.get(
      businessId,
      database.repositories.conversations.get(businessId, conversationId)?.nextActionId ?? '',
    );
    expect(handoffAction).toMatchObject({ type: NextActionType.HumanReview, automatic: false });

    await expect(
      service.sendMessage(businessId, conversationId, 'Automatic follow-up', {
        author: MessageAuthor.Assistant,
      }),
    ).rejects.toMatchObject({ code: 'AUTOMATION_PAUSED' });
    expect(database.repositories.conversations.get(businessId, conversationId)?.mode).toBe(
      ConversationMode.HumanActive,
    );

    service.resumeAssistant(businessId, conversationId);
    expect(database.repositories.conversations.get(businessId, conversationId)?.mode).toBe(
      ConversationMode.AiActive,
    );
    await expect(
      service.sendMessage(businessId, conversationId, 'Assistant is back', {
        author: MessageAuthor.Assistant,
      }),
    ).resolves.toMatchObject({ body: 'Assistant is back' });
  });

  it('does not allow takeover to reopen a closed conversation', () => {
    const { service } = createHarness();
    expect(() =>
      service.startHumanTakeover(
        'biz-clinic',
        'biz-clinic-conversation-completed',
        HandoffReason.Manual,
        'Invalid reopen attempt.',
      ),
    ).toThrowError(expect.objectContaining({ code: 'CONVERSATION_CLOSED' }));
  });

  it('persists opt-out and prevents marketing sends while allowing operational messages', async () => {
    const { service, database } = createHarness();
    const businessId = 'biz-clinic';
    const conversationId = 'biz-clinic-conversation-new';
    service.optOutMarketing(businessId, 'biz-clinic-contact-new');
    expect(
      database.repositories.consentRecords.find(
        businessId,
        (record) => record.contactId === 'biz-clinic-contact-new',
      )[0]?.optedOut,
    ).toBe(true);
    await expect(
      service.sendMessage(businessId, conversationId, 'Special offer', {
        purpose: MessagePurpose.Marketing,
      }),
    ).rejects.toMatchObject({ code: 'MARKETING_BLOCKED' });
    await expect(service.sendMessage(businessId, conversationId, 'Your booking is confirmed.')).resolves.toBeDefined();
  });

  it('does not leak another business knowledge into a reply', async () => {
    const { service } = createHarness();
    const clinic = await service.receiveCustomerMessage(
      'biz-clinic',
      'biz-clinic-conversation-new',
      'Where are you located?',
    );
    const home = await service.receiveCustomerMessage(
      'biz-home',
      'biz-home-conversation-new',
      'Where are you located?',
    );
    expect(clinic.suggestedReply).toContain('12 Fiction Lane');
    expect(clinic.suggestedReply).not.toContain('7 Fiction Street');
    expect(home.suggestedReply).toContain('7 Fiction Street');
  });
});
