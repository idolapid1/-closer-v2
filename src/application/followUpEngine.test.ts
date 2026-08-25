import { describe, expect, it } from 'vitest';
import {
  FollowUpChannel,
  FollowUpOwner,
  FollowUpResult,
  FollowUpStatus,
  FollowUpStopReason,
  HandoffReason,
} from '../domain/entities';
import { createHarness } from '../test/harness';

const CLINIC = 'biz-clinic';
const DETAILING = 'biz-detailing';
const QUOTE_CONVERSATION = `${DETAILING}-conversation-new`;

function createQuoteFollowUp(harness: ReturnType<typeof createHarness>) {
  const quote = harness.service.createQuoteDraft({
    businessId: DETAILING,
    contactId: `${DETAILING}-contact-new`,
    leadId: `${DETAILING}-lead-new`,
    items: [
      { id: 'follow-up-item', description: 'Detailing', quantity: 1, unitPriceCents: 100_000 },
    ],
    operationKey: 'follow-up-quote',
  });
  harness.service.sendQuote(DETAILING, quote.id);
  return harness.database.repositories.scheduledFollowUps.find(
    DETAILING,
    (followUp) =>
      followUp.conversationId === QUOTE_CONVERSATION &&
      followUp.status === FollowUpStatus.Scheduled,
  )[0]!;
}

describe('configurable follow-up execution state', () => {
  it('schedules tenant-configured attempts with explicit ownership and channel', () => {
    const harness = createHarness();
    const followUp = createQuoteFollowUp(harness);

    expect(followUp).toMatchObject({
      channel: FollowUpChannel.WhatsApp,
      owner: FollowUpOwner.Assistant,
      attemptCount: 0,
      attempts: [],
      sequenceStep: 0,
      nextAttemptAt: '2026-08-13T12:00:00.000Z',
      status: FollowUpStatus.Scheduled,
      result: FollowUpResult.Pending,
    });
    expect(
      harness.database.repositories.businessSettings.list(CLINIC)[0]?.followUpCadenceHours,
    ).not.toEqual(
      harness.database.repositories.businessSettings.list('biz-home')[0]?.followUpCadenceHours,
    );
  });

  it('records attempts idempotently and advances using the tenant cadence', () => {
    const harness = createHarness();
    const followUp = createQuoteFollowUp(harness);
    const sent = harness.service.recordFollowUpAttempt(
      DETAILING,
      followUp.id,
      FollowUpResult.Sent,
      'provider-send-1',
    );
    const duplicate = harness.service.recordFollowUpAttempt(
      DETAILING,
      followUp.id,
      FollowUpResult.Sent,
      'provider-send-1',
    );

    expect(sent).toMatchObject({
      attemptCount: 1,
      sequenceStep: 1,
      nextAttemptAt: '2026-08-15T12:00:00.000Z',
      status: FollowUpStatus.Scheduled,
    });
    expect(sent.attempts).toEqual([
      {
        operationKey: 'provider-send-1',
        result: FollowUpResult.Sent,
        attemptedAt: '2026-08-12T12:00:00.000Z',
      },
    ]);
    expect(duplicate.attemptCount).toBe(1);
    expect(() =>
      harness.service.recordFollowUpAttempt(
        DETAILING,
        followUp.id,
        FollowUpResult.Failed,
        'provider-send-1',
      ),
    ).toThrow('operation key was reused with different facts');
  });

  it('records why automation stopped for replies, Human Takeover, and manual override', async () => {
    const replyHarness = createHarness();
    const replyFollowUp = createQuoteFollowUp(replyHarness);
    await replyHarness.service.receiveCustomerMessage(
      DETAILING,
      QUOTE_CONVERSATION,
      'I can send the missing details tomorrow.',
      { providerMessageId: 'reply-stops-follow-up' },
    );
    expect(
      replyHarness.database.repositories.scheduledFollowUps.get(DETAILING, replyFollowUp.id),
    ).toMatchObject({
      status: FollowUpStatus.Completed,
      stopReason: FollowUpStopReason.CustomerReplied,
      result: FollowUpResult.ResponseReceived,
      lastResponseAt: '2026-08-12T12:00:00.000Z',
    });

    const handoffHarness = createHarness();
    const handoffFollowUp = createQuoteFollowUp(handoffHarness);
    handoffHarness.service.startHumanTakeover(
      DETAILING,
      QUOTE_CONVERSATION,
      HandoffReason.Manual,
      'Owner review',
    );
    expect(
      handoffHarness.database.repositories.scheduledFollowUps.get(DETAILING, handoffFollowUp.id),
    ).toMatchObject({
      status: FollowUpStatus.Cancelled,
      stopReason: FollowUpStopReason.HumanTakeover,
      result: FollowUpResult.Stopped,
    });

    const manualHarness = createHarness();
    const manualFollowUp = createQuoteFollowUp(manualHarness);
    manualHarness.service.cancelFollowUpsManually(DETAILING, QUOTE_CONVERSATION);
    expect(
      manualHarness.database.repositories.scheduledFollowUps.get(DETAILING, manualFollowUp.id),
    ).toMatchObject({
      status: FollowUpStatus.Cancelled,
      stopReason: FollowUpStopReason.ManualOverride,
      manualOverride: true,
      owner: FollowUpOwner.Human,
    });
  });
});
