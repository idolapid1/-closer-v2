import type { LeadPriority } from '../../domain/entities';
import type { ReactivationCandidate } from '../reactivation/ReactivationService';
import type { ProductRevenueOverviewView } from '../presentation/ProductReadService';

export enum OwnerCopilotToolName {
  GetHotLeads = 'GET_HOT_LEADS',
  GetUnansweredConversations = 'GET_UNANSWERED_CONVERSATIONS',
  GetRevenueOverview = 'GET_REVENUE_OVERVIEW',
  GetReactivationCandidates = 'GET_REACTIVATION_CANDIDATES',
  PrepareReactivation = 'PREPARE_REACTIVATION',
}

export interface OwnerActionAuthorization {
  businessId: string;
  requestedByTeamMemberId: string;
  approved: boolean;
  operationKey: string;
}

export type OwnerCopilotToolRequest =
  | { tool: OwnerCopilotToolName.GetHotLeads }
  | { tool: OwnerCopilotToolName.GetUnansweredConversations }
  | { tool: OwnerCopilotToolName.GetRevenueOverview }
  | { tool: OwnerCopilotToolName.GetReactivationCandidates }
  | { tool: OwnerCopilotToolName.PrepareReactivation; leadId: string };

export type OwnerCopilotToolResult =
  | {
      tool: OwnerCopilotToolName.GetHotLeads;
      leads: Array<{
        leadId: string;
        contactId: string;
        conversationId: string;
        priority: LeadPriority;
        knownValueCents: number | null;
      }>;
    }
  | {
      tool: OwnerCopilotToolName.GetUnansweredConversations;
      conversations: Array<{
        conversationId: string;
        contactId: string;
        waitingSince: string;
      }>;
    }
  | {
      tool: OwnerCopilotToolName.GetRevenueOverview;
      revenue: ProductRevenueOverviewView;
    }
  | {
      tool: OwnerCopilotToolName.GetReactivationCandidates;
      candidates: ReactivationCandidate[];
    }
  | {
      tool: OwnerCopilotToolName.PrepareReactivation;
      followUpId: string;
      dueAt: string;
    };
