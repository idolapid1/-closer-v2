import { describe, expect, it } from 'vitest';
import { JobStatus, PaymentReferenceType, QuoteStatus, RevenueStage } from '../domain/entities';
import { createHarness } from '../test/harness';

function createAcceptedJob() {
  const harness = createHarness();
  const quote = harness.service.createQuoteDraft({
    businessId: 'biz-detailing',
    contactId: 'biz-detailing-contact-new',
    leadId: 'biz-detailing-lead-new',
    items: [{ id: 'item-1', description: 'Full detail', quantity: 1, unitPriceCents: 100_000 }],
  });
  harness.service.sendQuote('biz-detailing', quote.id);
  const job = harness.service.acceptQuote('biz-detailing', quote.id);
  return { ...harness, quote, job };
}

describe('quote and job workflow', () => {
  it('accepts a sent quote and creates one job idempotently', () => {
    const { service, database, quote, job } = createAcceptedJob();
    expect(database.repositories.quotes.get('biz-detailing', quote.id)?.status).toBe(QuoteStatus.Accepted);
    expect(job.status).toBe(JobStatus.PendingDeposit);
    expect(service.acceptQuote('biz-detailing', quote.id).id).toBe(job.id);
    expect(database.repositories.jobs.find('biz-detailing', (candidate) => candidate.quoteId === quote.id)).toHaveLength(1);
  });

  it('reduces remaining balance by the deposit exactly once', () => {
    const { service, database, job } = createAcceptedJob();
    service.recordDeposit('biz-detailing', PaymentReferenceType.Job, job.id);
    service.recordDeposit('biz-detailing', PaymentReferenceType.Job, job.id);
    expect(service.balance('biz-detailing', PaymentReferenceType.Job, job.id)).toBe(75_000);
    expect(database.repositories.jobs.get('biz-detailing', job.id)?.status).toBe(JobStatus.ReadyToSchedule);
    expect(database.repositories.payments.find('biz-detailing', (payment) => payment.referenceId === job.id)).toHaveLength(1);
  });

  it('completes a scheduled job without treating it as collected cash', () => {
    const { service, database, job } = createAcceptedJob();
    service.recordDeposit('biz-detailing', PaymentReferenceType.Job, job.id);
    service.scheduleJob(
      'biz-detailing',
      job.id,
      'biz-detailing-owner',
      '2026-08-14T09:00:00.000Z',
      '2026-08-14T12:00:00.000Z',
    );
    service.completeJob('biz-detailing', job.id);
    expect(service.balance('biz-detailing', PaymentReferenceType.Job, job.id)).toBe(75_000);
    expect(
      database.repositories.revenueEvents.find(
        'biz-detailing',
        (event) => event.referenceId === job.id && event.stage === RevenueStage.Completed,
      ),
    ).toHaveLength(1);
    service.collectRemainingBalance('biz-detailing', PaymentReferenceType.Job, job.id);
    expect(service.balance('biz-detailing', PaymentReferenceType.Job, job.id)).toBe(0);
    expect(database.repositories.leads.get('biz-detailing', job.leadId)?.status).toBe('WON');
    expect(database.repositories.leads.get('biz-detailing', job.leadId)?.nextActionId).toBeNull();
  });
});
