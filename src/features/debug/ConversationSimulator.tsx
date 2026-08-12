import { Fragment, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ConversationMode,
  FollowUpStatus,
  HandoffReason,
  MessageAuthor,
  MessagePurpose,
} from '../../domain/entities';
import { Card, Empty, ErrorNotice, SuccessNotice, displayError, readable } from '../../components/ui';
import { useCloser } from '../../state/closerState';

export function ConversationSimulator() {
  const { state, businessId, service, resetDemo } = useCloser();
  const contacts = useMemo(
    () => state.contacts.filter((contact) => contact.businessId === businessId),
    [businessId, state.contacts],
  );
  const [contactId, setContactId] = useState('');
  const [customerMessage, setCustomerMessage] = useState('');
  const [newCustomerName, setNewCustomerName] = useState('Scenario customer');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (!contacts.some((contact) => contact.id === contactId)) {
      setContactId(contacts[0]?.id ?? '');
    }
  }, [contactId, contacts]);

  const contact = contacts.find((candidate) => candidate.id === contactId);
  const conversation = state.conversations.find(
    (candidate) => candidate.businessId === businessId && candidate.contactId === contactId,
  );
  const lead = state.leads.find(
    (candidate) => candidate.businessId === businessId && candidate.contactId === contactId,
  );
  const services = state.services.filter(
    (candidate) => candidate.businessId === businessId && candidate.active,
  );
  const selectedServiceId = lead?.serviceId ?? '';
  const record = conversation
    ? state.assistantDecisionRecords
        .filter(
          (candidate) =>
            candidate.businessId === businessId &&
            candidate.conversationId === conversation.id,
        )
        .at(-1) ?? null
    : null;
  const nextAction = state.nextActions.find(
    (candidate) => candidate.businessId === businessId && candidate.id === conversation?.nextActionId,
  );
  const handoff = state.humanHandoffs.find(
    (candidate) => candidate.businessId === businessId && candidate.id === conversation?.handoffId,
  );
  const memory = state.customerMemory.filter(
    (item) => item.businessId === businessId && item.contactId === contactId,
  );
  const followUps = state.scheduledFollowUps.filter(
    (item) =>
      item.businessId === businessId &&
      item.conversationId === conversation?.id &&
      item.status === FollowUpStatus.Scheduled,
  );
  const messages = state.messages
    .filter(
      (message) =>
        message.businessId === businessId && message.conversationId === conversation?.id,
    )
    .sort((first, second) => first.sentAt.localeCompare(second.sentAt));
  const consent = state.consentRecords.find(
    (item) => item.businessId === businessId && item.contactId === contactId,
  );

  const clearNotices = () => {
    setError('');
    setSuccess('');
  };

  const run = (action: () => void, message: string) => {
    clearNotices();
    try {
      action();
      setSuccess(message);
    } catch (caught) {
      setError(displayError(caught));
    }
  };

  const createCustomer = (event: FormEvent) => {
    event.preventDefault();
    clearNotices();
    try {
      const created = service.createCustomerOpportunity({
        businessId,
        displayName: newCustomerName,
      });
      setContactId(created.contact.id);
      setSuccess('A clean WhatsApp scenario was created.');
    } catch (caught) {
      setError(displayError(caught));
    }
  };

  const simulateCustomer = async (event: FormEvent) => {
    event.preventDefault();
    clearNotices();
    if (!conversation) return;
    try {
      await service.receiveCustomerMessage(businessId, conversation.id, customerMessage);
      setCustomerMessage('');
      setSuccess('Customer message processed.');
    } catch (caught) {
      setError(displayError(caught));
    }
  };

  const sendSuggestion = async () => {
    if (!conversation || !record) return;
    clearNotices();
    try {
      await service.sendMessage(businessId, conversation.id, record.decision.suggestedReply, {
        author: MessageAuthor.Assistant,
        purpose: MessagePurpose.Operational,
      });
      setSuccess('Suggested reply sent through the mock provider.');
    } catch (caught) {
      setError(displayError(caught));
    }
  };

  return (
    <Card title="Conversation simulator">
      <p>
        Run deterministic multi-turn WhatsApp scenarios and inspect the grounded decision, tool
        validation, memory, follow-up, and handoff state.
      </p>
      <ErrorNotice message={error} />
      <SuccessNotice message={success} />

      <div className="simulator-controls">
        <label>
          <span>Customer</span>
          <select
            aria-label="Simulator customer"
            value={contactId}
            onChange={(event) => {
              clearNotices();
              setContactId(event.target.value);
            }}
          >
            {contacts.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.displayName}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Service</span>
          <select
            aria-label="Simulator service"
            value={selectedServiceId}
            disabled={!lead}
            onChange={(event) => {
              if (!lead || !event.target.value) return;
              run(
                () => service.selectServiceForLead(businessId, lead.id, event.target.value),
                'Service context saved.',
              );
            }}
          >
            <option value="">Let the conversation identify it</option>
            {services.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <form className="inline-form" onSubmit={createCustomer}>
        <input
          aria-label="New simulator customer name"
          value={newCustomerName}
          onChange={(event) => setNewCustomerName(event.target.value)}
          required
        />
        <button type="submit">Create clean customer</button>
        <button
          type="button"
          onClick={() => {
            resetDemo();
            setSuccess('All scenarios reset to the deterministic Phase 2 seed.');
          }}
        >
          Reset scenarios
        </button>
      </form>

      {!contact || !conversation || !lead ? (
        <Empty>Select or create a customer with an active opportunity.</Empty>
      ) : (
        <>
          <div className="summary-grid">
            <div>
              <strong>Conversation</strong>
              <dl>
                <dt>Mode</dt><dd>{readable(conversation.mode)}</dd>
                <dt>Stage</dt><dd>{readable(conversation.inferredStage)}</dd>
                <dt>Intent</dt><dd>{conversation.currentIntent ? readable(conversation.currentIntent) : 'Not detected'}</dd>
              </dl>
            </div>
            <div>
              <strong>What needs attention</strong>
              <p>{nextAction ? readable(nextAction.type) : 'No immediate action'}</p>
              <small>{nextAction?.reason ?? 'The opportunity is closed.'}</small>
            </div>
            <div>
              <strong>Controls</strong>
              <p>Marketing: {consent?.optedOut ? 'opted out' : 'current consent applies'}</p>
              <div className="button-row compact">
                <button
                  type="button"
                  disabled={conversation.mode !== ConversationMode.AiActive}
                  onClick={() =>
                    run(
                      () => service.startHumanTakeover(
                        businessId,
                        conversation.id,
                        HandoffReason.Manual,
                        'Manual simulator takeover.',
                      ),
                      'Human Takeover is active.',
                    )
                  }
                >
                  Human Takeover
                </button>
                <button
                  type="button"
                  disabled={
                    conversation.mode !== ConversationMode.HumanActive &&
                    conversation.mode !== ConversationMode.Paused
                  }
                  onClick={() =>
                    run(
                      () => service.resumeAssistant(businessId, conversation.id),
                      'Assistant explicitly resumed.',
                    )
                  }
                >
                  Resume AI
                </button>
                <button
                  type="button"
                  disabled={consent?.optedOut}
                  onClick={() =>
                    run(
                      () => service.optOutMarketing(businessId, contact.id),
                      'Marketing opt-out recorded.',
                    )
                  }
                >
                  Opt out
                </button>
              </div>
            </div>
          </div>

          <div className="two-column">
            <div>
              <h3>WhatsApp mock</h3>
              <div className="messages simulator-messages">
                {messages.length === 0 ? <Empty>No messages yet.</Empty> : messages.map((message) => (
                  <article key={message.id} className={`message ${message.direction.toLowerCase()}`}>
                    <small>{readable(message.author)}</small>
                    <p>{message.body}</p>
                  </article>
                ))}
              </div>
              <form onSubmit={simulateCustomer} className="stack">
                <textarea
                  aria-label="Simulator customer message"
                  value={customerMessage}
                  onChange={(event) => setCustomerMessage(event.target.value)}
                  placeholder="Type the next customer WhatsApp message"
                  required
                />
                <button type="submit">Simulate customer message</button>
              </form>
            </div>

            <div>
              <h3>Latest grounded decision</h3>
              {!record ? <Empty>Send a customer message to create a decision.</Empty> : (
                <>
                  <dl>
                    <dt>Intent</dt><dd>{readable(record.decision.detectedIntent)}</dd>
                    <dt>Confidence</dt><dd>{Math.round(record.decision.confidence * 100)}%</dd>
                    <dt>Stage</dt><dd>{readable(record.decision.conversationStage)}</dd>
                    <dt>Goal</dt><dd>{readable(record.decision.customerGoal)}</dd>
                    <dt>Missing</dt><dd>{record.decision.missingInformation.map(readable).join(', ') || 'None'}</dd>
                    <dt>Tool</dt><dd>{readable(record.decision.requestedTool)}</dd>
                    <dt>Tool result</dt><dd>{readable(record.toolResult.status)} — {record.toolResult.summary}</dd>
                    <dt>Reason code</dt><dd>{record.decision.internalReasonCode}</dd>
                    <dt>Review</dt><dd>{record.decision.requiresHumanReview ? 'Required' : 'Not required'}</dd>
                  </dl>
                  <blockquote>{record.decision.suggestedReply}</blockquote>
                  <button
                    type="button"
                    disabled={
                      conversation.mode !== ConversationMode.AiActive ||
                      record.decision.requiresHumanReview
                    }
                    onClick={() => void sendSuggestion()}
                  >
                    Send suggested reply
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="two-column simulator-state">
            <div>
              <h3>Known customer facts</h3>
              {memory.length === 0 ? <Empty>No structured facts yet.</Empty> : (
                <dl>{memory.map((item) => (
                  <Fragment key={item.id}>
                    <dt>{readable(item.key)}</dt>
                    <dd>{String(item.value)} <small>({readable(item.source)})</small></dd>
                  </Fragment>
                ))}</dl>
              )}
            </div>
            <div>
              <h3>Automation state</h3>
              {handoff ? <p>Handoff: {readable(handoff.reason)} — {handoff.detail}</p> : <p>No active handoff.</p>}
              {followUps.length === 0 ? <p>No scheduled follow-up.</p> : followUps.map((followUp) => (
                <p key={followUp.id}>{readable(followUp.scenario)} at {followUp.dueAt}</p>
              ))}
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
