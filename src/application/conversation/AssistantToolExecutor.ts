import { CustomerFactKey, PaymentKind, PaymentStatus } from '../../domain/entities';
import { DomainError, remainingBalance } from '../../domain/rules';
import {
  AssistantTool,
  ToolExecutionStatus,
  type AssistantContext,
  type ConversationDecision,
  type ToolExecutionResult,
} from '../../types/assistant';
import { KnowledgeService } from './KnowledgeService';

export type AvailableSlotResolver = (
  businessId: string,
  serviceId: string,
  staffId: string,
  date: string,
) => string[];

export class AssistantToolExecutor {
  private readonly knowledge = new KnowledgeService();

  execute(
    businessId: string,
    context: AssistantContext,
    decision: ConversationDecision,
    resolveSlots: AvailableSlotResolver,
  ): ToolExecutionResult {
    this.assertTenantContext(businessId, context);
    const service = this.knowledge.selectedService(
      context.lead,
      context.services,
      context.memory,
    );

    switch (decision.requestedTool) {
      case AssistantTool.GetBusinessInfo:
        return completed(decision.requestedTool, 'Verified business information retrieved.', {
          businessName: context.knowledge.businessName,
          openingHours: context.knowledge.openingHours,
          address: context.knowledge.address,
          serviceArea: context.knowledge.serviceArea,
          paymentMethods: context.knowledge.acceptedPaymentMethods,
        });
      case AssistantTool.GetServiceInfo:
        if (!service) return blocked(decision.requestedTool, 'A service must be identified first.');
        return completed(decision.requestedTool, 'Verified service information retrieved.', {
          serviceId: service.id,
          name: service.name,
          description: context.knowledge.serviceDescriptions[service.id] ?? service.description,
          durationMinutes:
            context.knowledge.serviceDurationsMinutes[service.id] ?? service.durationMinutes,
          preparationInstructions:
            context.knowledge.preparationInstructions[service.id] ?? [],
        });
      case AssistantTool.GetServicePrice: {
        if (!service) return blocked(decision.requestedTool, 'A service must be identified first.');
        const fixedPriceCents = this.knowledge.fixedPrice(context.knowledge, service);
        const range = this.knowledge.priceRange(context.knowledge, service);
        if (fixedPriceCents !== null) {
          return completed(decision.requestedTool, 'Configured fixed price retrieved.', {
            serviceId: service.id,
            fixedPriceCents,
            currency: context.business.currency,
          });
        }
        if (range) {
          return completed(decision.requestedTool, 'Configured price range retrieved.', {
            serviceId: service.id,
            minCents: range.minCents,
            maxCents: range.maxCents,
            currency: context.business.currency,
          });
        }
        return blocked(decision.requestedTool, 'No verified price is configured.');
      }
      case AssistantTool.GetCustomerContext:
        return completed(decision.requestedTool, 'Tenant-scoped customer context retrieved.', {
          contactId: context.contact.id,
          displayName: context.contact.displayName,
          knownFactCount: context.memory.length,
        });
      case AssistantTool.GetConversationContext: {
        const reference = [...context.jobs, ...context.appointments]
          .sort((first, second) => second.updatedAt.localeCompare(first.updatedAt))[0];
        const verifiedRemainingCents = reference
          ? remainingBalance(reference.totalCents, context.payments, reference.id)
          : null;
        const verifiedCollectedCents = reference
          ? context.payments
              .filter(
                (payment) =>
                  payment.referenceId === reference.id &&
                  payment.status === PaymentStatus.Collected,
              )
              .reduce(
                (total, payment) =>
                  total +
                  (payment.kind === PaymentKind.Refund
                    ? -payment.amountCents
                    : payment.amountCents),
                0,
              )
          : null;
        return completed(decision.requestedTool, 'Conversation context retrieved.', {
          conversationId: context.conversation.id,
          stage: context.inferredStage,
          mode: context.conversation.mode,
          messageCount: context.messages.length,
          paymentReferenceId: reference?.id ?? null,
          verifiedRemainingCents,
          verifiedCollectedCents,
          currency: context.business.currency,
        });
      }
      case AssistantTool.RequestCustomerInformation:
        {
          const range = service
            ? this.knowledge.priceRange(context.knowledge, service)
            : null;
        return proposed(decision.requestedTool, 'Safe information request prepared.', {
          fields: decision.missingInformation,
          serviceName: service?.name ?? null,
          minCents: range?.minCents ?? null,
          maxCents: range?.maxCents ?? null,
          currency: context.business.currency,
        });
        }
      case AssistantTool.RequestPhotos:
        {
          const range = service
            ? this.knowledge.priceRange(context.knowledge, service)
            : null;
        return proposed(decision.requestedTool, 'Photo request prepared.', {
          fields: [CustomerFactKey.PhotosReceived],
          serviceName: service?.name ?? null,
          minCents: range?.minCents ?? null,
          maxCents: range?.maxCents ?? null,
          currency: context.business.currency,
        });
        }
      case AssistantTool.GetAvailableSlots:
      case AssistantTool.SuggestAppointment: {
        if (!service) return blocked(decision.requestedTool, 'A service must be identified first.');
        const staff = context.teamMembers.find(
          (member) => member.active && member.serviceIds.includes(service.id),
        );
        const preferredDate = this.knowledge.factValue(
          context.memory,
          CustomerFactKey.PreferredDate,
        );
        if (!staff || typeof preferredDate !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(preferredDate)) {
          return blocked(
            decision.requestedTool,
            'Validated staff and an ISO preferred date are required before checking availability.',
          );
        }
        const slots = resolveSlots(businessId, service.id, staff.id, preferredDate);
        return completed(decision.requestedTool, 'Availability checked against current appointments.', {
          serviceId: service.id,
          staffId: staff.id,
          date: preferredDate,
          slots: slots.slice(0, 3),
        });
      }
      case AssistantTool.CreateQuoteDraft:
        return {
          tool: decision.requestedTool,
          status:
            decision.missingInformation.length === 0
              ? ToolExecutionStatus.RequiresValidation
              : ToolExecutionStatus.Blocked,
          summary:
            decision.missingInformation.length === 0
              ? 'Quote draft proposed; prices and line items still require application validation.'
              : 'Quote draft blocked until required information is collected.',
          data: { missingInformation: decision.missingInformation },
        };
      case AssistantTool.CreateNextAction:
        return proposed(decision.requestedTool, 'Next action proposed for application validation.', {
          nextAction: decision.suggestedNextAction,
        });
      case AssistantTool.HandoffToHuman:
        return proposed(decision.requestedTool, 'Human handoff proposed.', {
          reason: decision.handoffReason,
          confidence: decision.confidence,
        });
    }
  }

  private assertTenantContext(businessId: string, context: AssistantContext): void {
    const entities = [
      context.business,
      context.settings,
      context.knowledge,
      context.contact,
      context.lead,
      context.conversation,
      ...context.services,
      ...context.teamMembers,
      ...context.messages,
      ...context.memory,
      ...context.appointments,
      ...context.quotes,
      ...context.jobs,
      ...context.payments,
    ];
    if (entities.some((entity) => entity.businessId !== businessId)) {
      throw new DomainError('Assistant tool context crossed a tenant boundary', 'TENANT_MISMATCH');
    }
  }
}

function completed(
  tool: AssistantTool,
  summary: string,
  data: ToolExecutionResult['data'],
): ToolExecutionResult {
  return { tool, status: ToolExecutionStatus.Completed, summary, data };
}

function proposed(
  tool: AssistantTool,
  summary: string,
  data: ToolExecutionResult['data'],
): ToolExecutionResult {
  return { tool, status: ToolExecutionStatus.Proposed, summary, data };
}

function blocked(tool: AssistantTool, summary: string): ToolExecutionResult {
  return { tool, status: ToolExecutionStatus.Blocked, summary, data: {} };
}
