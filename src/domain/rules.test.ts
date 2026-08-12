import { describe, expect, it } from 'vitest';
import { LeadStatus, NextActionStatus, type Lead, type NextAction } from './entities';
import { DomainError, assertNextActionInvariant } from './rules';
import { createHarness } from '../test/harness';

describe('Next Action invariant', () => {
  it('requires exactly one current pending action for an active lead', () => {
    const { database } = createHarness();
    const lead = database.repositories.leads.get('biz-clinic', 'biz-clinic-lead-new') as Lead;
    expect(() => assertNextActionInvariant({ ...lead, nextActionId: null }, [])).toThrowError(DomainError);
  });

  it('accepts the seeded active lead with one matching pending action', () => {
    const { database } = createHarness();
    const lead = database.repositories.leads.get('biz-clinic', 'biz-clinic-lead-new') as Lead;
    const actions = database.repositories.nextActions.list('biz-clinic') as NextAction[];
    expect(actions.find((action) => action.id === lead.nextActionId)?.status).toBe(NextActionStatus.Pending);
    expect(() => assertNextActionInvariant(lead, actions)).not.toThrow();
  });

  it('does not require a next action for a closed opportunity', () => {
    const { database } = createHarness();
    const lead = database.repositories.leads.get('biz-clinic', 'biz-clinic-lead-completed') as Lead;
    expect(lead.status).toBe(LeadStatus.Won);
    expect(() => assertNextActionInvariant(lead, [])).not.toThrow();
  });
});
