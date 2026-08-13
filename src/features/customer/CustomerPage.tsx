import { useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { Card, Empty, ErrorNotice, Page, SuccessNotice, displayError, formatMoney, readable } from '../../components/ui';
import {
  ConversationMode,
  HandoffReason,
  LeadStatus,
  MessageAuthor,
  MessagePurpose,
} from '../../domain/entities';
import { useCloser } from '../../state/closerState';
import type { AssistantDecision } from '../../types/assistant';

export function CustomerPage() {
  const { id: contactId = '' } = useParams();
  const { state, businessId, service } = useCloser();
  const contact = state.contacts.find((candidate) => candidate.businessId === businessId && candidate.id === contactId);
  const conversation = state.conversations.find(
    (candidate) => candidate.businessId === businessId && candidate.contactId === contactId,
  );
  const lead = state.leads.find((candidate) => candidate.businessId === businessId && candidate.contactId === contactId);
  const action = state.nextActions.find((candidate) => candidate.id === conversation?.nextActionId);
  const consent = state.consentRecords.find(
    (candidate) => candidate.businessId === businessId && candidate.contactId === contactId,
  );
  const handoff = state.humanHandoffs.find((candidate) => candidate.id === conversation?.handoffId);
  const business = state.businesses.find((candidate) => candidate.id === businessId);
  const selectedService = state.services.find((candidate) => candidate.businessId === businessId && candidate.id === lead?.serviceId);
  const opportunity = lead ? service.opportunity(businessId, lead.id) : null;
  const appointment = state.appointments.find((candidate) => candidate.businessId === businessId && candidate.id === opportunity?.appointmentId);
  const quote = state.quotes.find((candidate) => candidate.businessId === businessId && candidate.id === opportunity?.quoteId);
  const job = state.jobs.find((candidate) => candidate.businessId === businessId && candidate.id === opportunity?.jobId);
  const memory = state.customerMemory.filter((candidate) => candidate.businessId === businessId && candidate.contactId === contactId);
  const payments = state.payments.filter((candidate) => candidate.businessId === businessId && candidate.contactId === contactId);
  const activities = contact ? service.activityTimeline(businessId, contact.id) : [];
  const messages = state.messages
    .filter((message) => message.businessId === businessId && message.conversationId === conversation?.id)
    .sort((first, second) => first.sentAt.localeCompare(second.sentAt));
  const [customerMessage, setCustomerMessage] = useState('');
  const [businessMessage, setBusinessMessage] = useState('');
  const [marketing, setMarketing] = useState(false);
  const [decision, setDecision] = useState<AssistantDecision | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  if (!contact || !conversation || !lead) {
    return <Page title="Customer not found" intro="Switch back to the business that owns this contact."><Empty>This tenant cannot access that customer.</Empty></Page>;
  }

  const simulateCustomer = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setSuccess('');
    try {
      const result = await service.receiveCustomerMessage(businessId, conversation.id, customerMessage);
      setDecision(result);
      setCustomerMessage('');
      setSuccess('Customer reply processed and next action updated.');
    } catch (caught) {
      setError(displayError(caught));
    }
  };

  const sendBusiness = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      await service.sendMessage(businessId, conversation.id, businessMessage, {
        author: MessageAuthor.Business,
        purpose: marketing ? MessagePurpose.Marketing : MessagePurpose.Operational,
      });
      setBusinessMessage('');
      setSuccess('Mock business message sent.');
    } catch (caught) {
      setError(displayError(caught));
    }
  };

  const run = (actionToRun: () => void, message: string) => {
    setError('');
    try {
      actionToRun();
      setSuccess(message);
    } catch (caught) {
      setError(displayError(caught));
    }
  };

  return (
    <Page title={contact.displayName} intro={`${contact.phone} · ${readable(conversation.channel)}`}>
      <ErrorNotice message={error} />
      <SuccessNotice message={success} />
      <div className="summary-grid">
        <Card title="Conversation">
          <dl><dt>Mode</dt><dd>{readable(conversation.mode)}</dd><dt>State</dt><dd>{readable(conversation.state)}</dd><dt>Intent</dt><dd>{conversation.currentIntent ? readable(conversation.currentIntent) : 'Unknown'}</dd></dl>
          {handoff ? <p className="notice">Handoff: {handoff.detail}</p> : null}
        </Card>
        <Card title="Next action">
          <strong>{action ? readable(action.type) : 'No immediate action'}</strong>
          <p>{action?.reason ?? 'This opportunity is closed.'}</p>
          {lead.status === LeadStatus.Lost ? <button type="button" onClick={() => run(() => service.reopenOpportunity(businessId, lead.id), 'Opportunity reopened for the returning customer.')}>Reopen opportunity</button> : null}
        </Card>
        <Card title="Consent">
          <p>Marketing: {consent?.marketingAllowed && !consent.optedOut ? 'allowed' : 'blocked'}</p>
          <button type="button" disabled={consent?.optedOut} onClick={() => run(() => service.optOutMarketing(businessId, contact.id), 'Marketing opt-out saved.')}>Opt out</button>
        </Card>
        <Card title="Commercial journey">
          <dl>
            <dt>Journey</dt><dd>{readable(lead.workflowType)}</dd>
            <dt>Phase</dt><dd>{opportunity ? readable(opportunity.stage) : '—'}</dd>
            <dt>Service</dt><dd>{selectedService?.name ?? 'Not selected'}</dd>
            <dt>Total</dt><dd>{opportunity?.totalCents === null || opportunity?.totalCents === undefined ? 'Not validated' : formatMoney(opportunity.totalCents, business?.currency ?? 'ILS')}</dd>
            <dt>Collected</dt><dd>{formatMoney(opportunity?.collectedCents ?? 0, business?.currency ?? 'ILS')}</dd>
            <dt>Remaining</dt><dd>{opportunity?.remainingBalanceCents === null || opportunity?.remainingBalanceCents === undefined ? '—' : formatMoney(opportunity.remainingBalanceCents, business?.currency ?? 'ILS')}</dd>
          </dl>
        </Card>
      </div>

      <div className="two-column">
        <Card title="Known facts">
          {memory.length === 0 ? <Empty>No structured facts yet.</Empty> : <dl>{memory.map((fact) => <div key={fact.id}><dt>{readable(fact.key)}</dt><dd>{String(fact.value)}</dd></div>)}</dl>}
        </Card>
        <Card title="Work and payments">
          <p>Appointment: {appointment ? readable(appointment.status) : '—'}</p>
          <p>Quote: {quote ? `${readable(quote.status)} · ${formatMoney(quote.totalCents, business?.currency ?? 'ILS')}` : '—'}</p>
          <p>Job: {job ? readable(job.status) : '—'}</p>
          <p>Payments: {payments.length}</p>
        </Card>
      </div>

      <Card title="Conversation messages">
        <div className="messages">
          {messages.length === 0 ? <Empty>No messages yet.</Empty> : messages.map((message) => (
            <article key={message.id} className={`message ${message.direction.toLowerCase()}`}>
              <small>{readable(message.author)} · {message.purpose.toLowerCase()}</small>
              <p>{message.body}</p>
            </article>
          ))}
        </div>
      </Card>

      <div className="two-column">
        <Card title="Simulate customer reply">
          <form onSubmit={simulateCustomer} className="stack">
            <textarea aria-label="Customer message" value={customerMessage} onChange={(event) => setCustomerMessage(event.target.value)} placeholder="Ask about hours, price, a quote, or a sensitive issue" required />
            <button type="submit">Process customer message</button>
          </form>
        </Card>
        <Card title="Send mock business message">
          <form onSubmit={sendBusiness} className="stack">
            <textarea aria-label="Business message" value={businessMessage} onChange={(event) => setBusinessMessage(event.target.value)} required />
            <label className="checkbox"><input type="checkbox" checked={marketing} onChange={(event) => setMarketing(event.target.checked)} /> Marketing message</label>
            <button type="submit">Send through mock provider</button>
          </form>
        </Card>
      </div>

      {decision ? (
        <Card title="Latest assistant proposal">
          <dl><dt>Intent</dt><dd>{readable(decision.intent)}</dd><dt>Confidence</dt><dd>{Math.round(decision.confidence * 100)}%</dd><dt>Missing</dt><dd>{decision.missingInformation.join(', ') || 'None'}</dd><dt>Tool request</dt><dd>{readable(decision.requestedTool)}</dd><dt>Review</dt><dd>{decision.requiresHumanReview ? 'Required' : 'Not required'}</dd></dl>
          <blockquote>{decision.suggestedReply}</blockquote>
          <button
            type="button"
            disabled={conversation.mode !== ConversationMode.AiActive || decision.requiresHumanReview}
            onClick={() => {
              setBusinessMessage(decision.suggestedReply);
              setMarketing(false);
            }}
          >Use suggested reply</button>
        </Card>
      ) : null}

      <Card title="Human control">
        <div className="button-row">
          <button type="button" disabled={conversation.mode === ConversationMode.HumanActive || conversation.mode === ConversationMode.Closed} onClick={() => run(() => service.startHumanTakeover(businessId, conversation.id, HandoffReason.Manual, 'Owner manually took over.'), 'Automation stopped; human takeover is active.')}>Start Human Takeover</button>
          <button type="button" disabled={conversation.mode === ConversationMode.AiActive || conversation.mode === ConversationMode.Closed} onClick={() => run(() => service.resumeAssistant(businessId, conversation.id), 'Assistant mode explicitly resumed.')}>Resume AI</button>
        </div>
      </Card>

      <Card title="Activity">
        {activities.length === 0 ? <Empty>No journey activity yet.</Empty> : (
          <ol className="timeline">
            {activities.map((activity) => (
              <li key={activity.id}>
                <strong>{activity.summary}</strong><br />
                <small>{new Date(activity.occurredAt).toLocaleString()} · {readable(activity.type)}</small>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </Page>
  );
}
