import { describe, expect, it } from 'vitest';
import { ActivityType } from '../domain/entities';
import {
  OwnerCopilotToolName,
  type OwnerActionAuthorization,
} from './owner/OwnerCopilotTools';
import { createHarness } from '../test/harness';

const authorization: OwnerActionAuthorization = {
  businessId: 'biz-clinic',
  requestedByTeamMemberId: 'biz-clinic-owner',
  approved: false,
  operationKey: 'owner-tool-test',
};

describe('owner copilot tool boundary', () => {
  it('returns tenant-scoped operational truth without exposing message content', () => {
    const { service } = createHarness();

    const hot = service.executeOwnerCopilotTool(authorization, {
      tool: OwnerCopilotToolName.GetHotLeads,
    });
    const unanswered = service.executeOwnerCopilotTool(
      { ...authorization, operationKey: 'owner-unanswered' },
      { tool: OwnerCopilotToolName.GetUnansweredConversations },
    );
    const revenue = service.executeOwnerCopilotTool(
      { ...authorization, operationKey: 'owner-revenue' },
      { tool: OwnerCopilotToolName.GetRevenueOverview },
    );

    expect(hot.tool).toBe(OwnerCopilotToolName.GetHotLeads);
    if (hot.tool === OwnerCopilotToolName.GetHotLeads) {
      expect(hot.leads).toEqual([
        expect.objectContaining({ leadId: 'biz-clinic-lead-handoff' }),
      ]);
      expect(JSON.stringify(hot.leads)).not.toContain('אני לא מרוצה');
    }
    expect(unanswered.tool).toBe(OwnerCopilotToolName.GetUnansweredConversations);
    expect(revenue.tool).toBe(OwnerCopilotToolName.GetRevenueOverview);
  });

  it('rejects cross-tenant owner identity and unapproved mutations', () => {
    const { service, database } = createHarness();
    const before = database.repositories.scheduledFollowUps.list('biz-clinic').length;

    expect(() =>
      service.executeOwnerCopilotTool(
        { ...authorization, requestedByTeamMemberId: 'biz-detailing-owner' },
        { tool: OwnerCopilotToolName.GetRevenueOverview },
      ),
    ).toThrowError(expect.objectContaining({ code: 'OWNER_ACTION_UNAUTHORIZED' }));
    expect(() =>
      service.executeOwnerCopilotTool(authorization, {
        tool: OwnerCopilotToolName.PrepareReactivation,
        leadId: 'biz-clinic-lead-lost',
      }),
    ).toThrowError(expect.objectContaining({ code: 'OWNER_APPROVAL_REQUIRED' }));
    expect(database.repositories.scheduledFollowUps.list('biz-clinic')).toHaveLength(before);
  });

  it('executes an explicitly approved business action and records an idempotent audit event', () => {
    const { service, database } = createHarness();
    const lead = database.repositories.leads.get('biz-clinic', 'biz-clinic-lead-lost')!;
    database.repositories.leads.save('biz-clinic', {
      ...lead,
      updatedAt: '2026-05-01T08:00:00.000Z',
      closedAt: '2026-05-01T08:00:00.000Z',
    });
    const approved = {
      ...authorization,
      approved: true,
      operationKey: 'owner-approved-reactivation',
    };

    const first = service.executeOwnerCopilotTool(approved, {
      tool: OwnerCopilotToolName.PrepareReactivation,
      leadId: lead.id,
    });
    const second = service.executeOwnerCopilotTool(approved, {
      tool: OwnerCopilotToolName.PrepareReactivation,
      leadId: lead.id,
    });

    expect(first).toEqual(second);
    expect(
      database.repositories.activities.find(
        'biz-clinic',
        (activity) => activity.type === ActivityType.OwnerToolExecuted,
      ),
    ).toHaveLength(1);
  });
});
