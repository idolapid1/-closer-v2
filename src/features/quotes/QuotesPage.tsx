import { useEffect, useState, type FormEvent } from 'react';
import { Card, Empty, ErrorNotice, Page, SuccessNotice, displayError, formatMoney, readable } from '../../components/ui';
import { JobStatus, PaymentReferenceType, QuoteStatus, WorkflowType } from '../../domain/entities';
import { useCloser } from '../../state/closerState';

export function QuotesPage() {
  const { state, businessId, service } = useCloser();
  const business = state.businesses.find((candidate) => candidate.id === businessId);
  const contacts = state.contacts.filter((contact) => contact.businessId === businessId);
  const leads = state.leads.filter((lead) => lead.businessId === businessId);
  const quotes = state.quotes.filter((quote) => quote.businessId === businessId);
  const jobs = state.jobs.filter((job) => job.businessId === businessId);
  const staff = state.teamMembers.filter((member) => member.businessId === businessId && member.active);
  const firstContactId = contacts[0]?.id ?? '';
  const [contactId, setContactId] = useState(firstContactId);
  const [description, setDescription] = useState('Service package');
  const [amount, setAmount] = useState('1000');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const currency = business?.currency ?? 'ILS';
  useEffect(() => {
    setContactId(firstContactId);
  }, [businessId, firstContactId]);

  const create = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    const lead = leads.find((candidate) => candidate.contactId === contactId);
    if (!lead) return setError('Select a contact with a lead.');
    try {
      service.createQuoteDraft({ businessId, contactId, leadId: lead.id, items: [{ id: crypto.randomUUID(), description, quantity: 1, unitPriceCents: Math.round(Number(amount) * 100) }] });
      setSuccess('Quote draft created.');
    } catch (caught) { setError(displayError(caught)); }
  };
  const run = (action: () => unknown, message: string) => {
    setError('');
    try { action(); setSuccess(message); } catch (caught) { setError(displayError(caught)); }
  };

  return (
    <Page title="Quotes & jobs" intro="Validated quote totals, acceptance, deposits, job state, completion, and collection.">
      <ErrorNotice message={error} /><SuccessNotice message={success} />
      {business?.workflowType !== WorkflowType.QuoteJob ? <p className="notice">This demo business uses appointments. Switch to an auto detailing or home services business for the quote/job flow.</p> : null}
      <Card title="Create quote draft">
        <form className="form-grid" onSubmit={create}>
          <label>Customer<select value={contactId} onChange={(event) => setContactId(event.target.value)}>{contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.displayName}</option>)}</select></label>
          <label>Description<input value={description} onChange={(event) => setDescription(event.target.value)} required /></label>
          <label>Amount ({currency})<input type="number" min="1" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} required /></label>
          <button type="submit" disabled={business?.workflowType !== WorkflowType.QuoteJob}>Create draft</button>
        </form>
      </Card>
      <Card title="Quotes">
        {quotes.length === 0 ? <Empty>No quotes for this business.</Empty> : <div className="table-wrap"><table><thead><tr><th>Customer</th><th>Total</th><th>Status</th><th>Actions</th></tr></thead><tbody>{quotes.map((quote) => <tr key={quote.id}>
          <td>{contacts.find((contact) => contact.id === quote.contactId)?.displayName}</td><td>{formatMoney(quote.totalCents, currency)}</td><td>{readable(quote.status)}</td>
          <td><div className="button-row compact"><button type="button" disabled={quote.status !== QuoteStatus.Draft && quote.status !== QuoteStatus.ChangeRequested} onClick={() => run(() => service.sendQuote(businessId, quote.id), 'Quote sent.')}>Send</button><button type="button" disabled={![QuoteStatus.Sent, QuoteStatus.Viewed, QuoteStatus.ChangeRequested].includes(quote.status)} onClick={() => run(() => service.acceptQuote(businessId, quote.id), 'Quote accepted and job created.')}>Accept + create job</button></div></td>
        </tr>)}</tbody></table></div>}
      </Card>
      <Card title="Jobs">
        {jobs.length === 0 ? <Empty>No jobs for this business.</Empty> : <div className="table-wrap"><table><thead><tr><th>Customer</th><th>Status</th><th>Balance</th><th>Actions</th></tr></thead><tbody>{jobs.map((job) => {
          const balance = service.balance(businessId, PaymentReferenceType.Job, job.id);
          return <tr key={job.id}><td>{contacts.find((contact) => contact.id === job.contactId)?.displayName}</td><td>{readable(job.status)}</td><td>{formatMoney(balance, currency)}</td><td><div className="button-row compact">
            <button type="button" disabled={job.depositRequiredCents === 0 || balance <= job.totalCents - job.depositRequiredCents} onClick={() => run(() => service.recordDeposit(businessId, PaymentReferenceType.Job, job.id), 'Job deposit recorded once.')}>Deposit</button>
            <button type="button" disabled={job.status !== JobStatus.ReadyToSchedule} onClick={() => run(() => service.scheduleJob(businessId, job.id, staff[0]?.id ?? '', '2026-08-18T09:00:00.000Z', '2026-08-18T12:00:00.000Z'), 'Job scheduled.')}>Schedule</button>
            <button type="button" disabled={job.status === JobStatus.Completed || job.status === JobStatus.Cancelled} onClick={() => run(() => service.completeJob(businessId, job.id), 'Job completed; payment remains separate.')}>Complete</button>
            <button type="button" disabled={balance === 0} onClick={() => run(() => service.collectRemainingBalance(businessId, PaymentReferenceType.Job, job.id), 'Remaining balance collected.')}>Collect balance</button>
          </div></td></tr>;
        })}</tbody></table></div>}
      </Card>
    </Page>
  );
}
