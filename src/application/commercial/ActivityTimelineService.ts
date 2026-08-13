import { type Activity, type ActivityType, type TenantEntity } from '../../domain/entities';
import { DomainError } from '../../domain/rules';
import type { DatabasePort } from '../../repositories/contracts';

export interface RecordActivityInput {
  businessId: string;
  contactId: string | null;
  conversationId: string | null;
  type: ActivityType;
  summary: string;
  metadata?: Record<string, string | number | boolean | null>;
  operationKey?: string;
}

export class ActivityTimelineService {
  constructor(
    private readonly database: DatabasePort,
    private readonly now: () => string,
    private readonly id: () => string,
  ) {}

  record(input: RecordActivityInput): Activity {
    const operationKey = input.operationKey ?? null;
    if (operationKey) {
      const existing = this.database.repositories.activities.find(
        input.businessId,
        (activity) => activity.operationKey === operationKey,
      )[0];
      if (existing) {
        if (
          existing.type !== input.type ||
          existing.contactId !== input.contactId ||
          existing.conversationId !== input.conversationId
        ) {
          throw new DomainError(
            'Activity operation key was reused for a different event',
            'IDEMPOTENCY_CONFLICT',
          );
        }
        return existing;
      }
    }
    const at = this.now();
    const activity: Activity = {
      ...this.base(input.businessId, at),
      contactId: input.contactId,
      conversationId: input.conversationId,
      type: input.type,
      summary: input.summary,
      metadata: input.metadata ?? {},
      occurredAt: at,
      operationKey,
    };
    return this.database.repositories.activities.save(input.businessId, activity);
  }

  list(businessId: string, contactId: string): Activity[] {
    return this.database.repositories.activities
      .find(businessId, (activity) => activity.contactId === contactId)
      .sort((first, second) =>
        first.occurredAt.localeCompare(second.occurredAt) || first.id.localeCompare(second.id),
      );
  }

  private base(businessId: string, at: string): TenantEntity {
    return { id: this.id(), businessId, createdAt: at, updatedAt: at };
  }
}
