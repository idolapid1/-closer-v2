import {
  BusinessKind,
  CustomerFactKey,
  MemorySource,
  type CustomerFactValue,
  type CustomerMemoryItem,
  type Message,
  type Service,
  type TenantEntity,
} from '../../domain/entities';
import { DomainError } from '../../domain/rules';
import type { DatabasePort } from '../../repositories/contracts';
import type { MemoryConflict } from '../../types/assistant';

export interface MemoryCaptureResult {
  saved: CustomerMemoryItem[];
  conflicts: MemoryConflict[];
}

export class CustomerMemoryService {
  constructor(
    private readonly database: DatabasePort,
    private readonly now: () => string,
    private readonly id: () => string,
  ) {}

  list(businessId: string, contactId: string): CustomerMemoryItem[] {
    return this.database.repositories.customerMemory.find(
      businessId,
      (item) => item.contactId === contactId,
    );
  }

  remember(
    businessId: string,
    contactId: string,
    key: CustomerFactKey,
    value: CustomerFactValue,
    source: MemorySource = MemorySource.Manual,
    sourceMessageId: string | null = null,
    allowCorrection = true,
  ): CustomerMemoryItem {
    const repositories = this.database.repositories;
    if (!repositories.contacts.get(businessId, contactId)) {
      throw new DomainError('Contact not found', 'NOT_FOUND');
    }
    const existing = this.list(businessId, contactId).find((item) => item.key === key);
    if (existing && existing.value !== value && !allowCorrection) {
      throw new DomainError('Customer fact conflicts with known information', 'MEMORY_CONFLICT');
    }
    const item: CustomerMemoryItem = existing
      ? {
          ...existing,
          updatedAt: this.now(),
          value,
          source,
          sourceMessageId,
        }
      : {
          ...this.base(businessId),
          contactId,
          key,
          value,
          source,
          sourceMessageId,
        };
    return repositories.customerMemory.save(businessId, item);
  }

  captureFromMessage(
    businessId: string,
    contactId: string,
    message: Message,
    kind: BusinessKind,
    services: Service[],
  ): MemoryCaptureResult {
    if (message.businessId !== businessId) {
      throw new DomainError('Message tenant does not match memory tenant', 'TENANT_MISMATCH');
    }
    const extracted = extractFacts(message.body, kind, services);
    const correction = /\b(actually|correction|i meant|update that|not .+[,;] (?:it is|it's))\b/i.test(
      message.body,
    );
    const existing = this.list(businessId, contactId);
    const saved: CustomerMemoryItem[] = [];
    const conflicts: MemoryConflict[] = [];

    for (const [key, value] of extracted) {
      const current = existing.find((item) => item.key === key);
      const mayRefine = REFINABLE_FACTS.has(key);
      if (current && current.value !== value && !correction && !mayRefine) {
        conflicts.push({ key, existingValue: current.value, proposedValue: value });
        continue;
      }
      saved.push(
        this.remember(
          businessId,
          contactId,
          key,
          value,
          MemorySource.CustomerMessage,
          message.id,
          correction || mayRefine,
        ),
      );
    }
    return { saved, conflicts };
  }

  private base(businessId: string): TenantEntity {
    const at = this.now();
    return { id: this.id(), businessId, createdAt: at, updatedAt: at };
  }
}

const REFINABLE_FACTS = new Set<CustomerFactKey>([
  CustomerFactKey.JobDetails,
  CustomerFactKey.VehicleCondition,
  CustomerFactKey.AccessConsiderations,
  CustomerFactKey.SpecialRequirements,
]);

function extractFacts(
  body: string,
  kind: BusinessKind,
  services: Service[],
): Map<CustomerFactKey, CustomerFactValue> {
  const facts = new Map<CustomerFactKey, CustomerFactValue>();
  const lower = body.toLowerCase();
  const selectedService = services.find((service) => serviceMatches(lower, service));
  if (selectedService) {
    facts.set(
      kind === BusinessKind.HomeServices
        ? CustomerFactKey.RequestedJob
        : CustomerFactKey.RequestedService,
      selectedService.id,
    );
  }
  if (!selectedService && services.length === 1) {
    const asksForCoreOutcome =
      /\b(book|appointment|quote|estimate|price|cost|how much|detail|repair|service|job)\b/i.test(
        body,
      );
    if (asksForCoreOutcome) {
      facts.set(
        kind === BusinessKind.HomeServices
          ? CustomerFactKey.RequestedJob
          : CustomerFactKey.RequestedService,
        services[0]!.id,
      );
    }
  }

  if (/\b(first[- ]?time|never been|new customer)\b/i.test(body)) {
    facts.set(CustomerFactKey.CustomerType, 'FIRST_TIME');
  } else if (/\b(returning|been before|again|existing customer)\b/i.test(body)) {
    facts.set(CustomerFactKey.CustomerType, 'RETURNING');
  }

  const isoDate = /\b(20\d{2}-\d{2}-\d{2})\b/.exec(body)?.[1];
  const namedDate = /\b(today|tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i.exec(
    body,
  )?.[1];
  if (isoDate ?? namedDate) {
    facts.set(CustomerFactKey.PreferredDate, isoDate ?? namedDate!.toUpperCase());
  }
  const preferredTime = /\b(\d{1,2}(?::\d{2})?\s*(?:am|pm)|morning|afternoon|evening)\b/i.exec(
    body,
  )?.[1];
  if (preferredTime) facts.set(CustomerFactKey.PreferredTime, preferredTime.toUpperCase());

  if (kind === BusinessKind.Clinic) {
    const preference = /\b(gentle|deep clean|hydrating|brightening|relaxing)\b/i.exec(body)?.[1];
    if (preference) facts.set(CustomerFactKey.TreatmentPreference, preference.toLowerCase());
  }

  if (kind === BusinessKind.AutoDetailing) {
    const vehicle = /\b(toyota|honda|ford|bmw|mercedes|audi|tesla|kia|hyundai|mazda|nissan|volkswagen|vw)\b(?:\s+([a-z][a-z0-9-]*))?/i.exec(
      body,
    );
    if (vehicle?.[1]) facts.set(CustomerFactKey.VehicleMake, vehicle[1].toUpperCase());
    if (vehicle?.[2]) {
      facts.set(CustomerFactKey.VehicleModel, vehicle[2].toUpperCase());
    }
    const year = /\b(19\d{2}|20\d{2})\b/.exec(body)?.[1];
    if (year) facts.set(CustomerFactKey.VehicleYear, Number(year));
    if (/\b(stain|dirty|pet hair|sand|odor|smell|mould|mold|condition)\b/i.test(body)) {
      facts.set(CustomerFactKey.VehicleCondition, conciseValue(body));
    }
  }

  if (/\b(sent|attached|upload(?:ed)?|here (?:are|is)|\[photo\])\b.*\b(photo|picture|image)s?\b/i.test(body)
    || /\b(photo|picture|image)s?\b.*\b(sent|attached|upload(?:ed)?|here)\b/i.test(body)) {
    facts.set(CustomerFactKey.PhotosReceived, true);
  }

  if (kind === BusinessKind.HomeServices) {
    const address = /\b(?:address is|service address is|at)\s+(\d+\s+[a-z0-9 .'-]+?)(?:[,;]|$)/i.exec(
      body,
    )?.[1];
    if (address) facts.set(CustomerFactKey.Address, address.trim());
    const location = /\b(?:location is|i(?:'m| am) in|property is in|in)\s+([a-z][a-z .'-]+?)(?:[,;.]|$)/i.exec(
      body,
    )?.[1];
    if (location) facts.set(CustomerFactKey.Location, location.trim());
    if (/\b(leak|pipe|tap|faucet|electrical|socket|repair|broken|blocked|drain|door|wall)\b/i.test(body)) {
      facts.set(CustomerFactKey.JobDetails, conciseValue(body));
      if (!selectedService) {
        facts.set(
          CustomerFactKey.RequestedJob,
          services.length === 1 ? services[0]!.id : 'HOME_REPAIR',
        );
      }
    }
    if (/\b(urgent|emergency|as soon as possible|asap)\b/i.test(body)) {
      facts.set(CustomerFactKey.Urgency, 'URGENT');
    } else if (/\b(not urgent|whenever|no rush)\b/i.test(body)) {
      facts.set(CustomerFactKey.Urgency, 'ROUTINE');
    }
    if (/\b(access|gate|key|parking|stairs|tenant|concierge)\b/i.test(body)) {
      facts.set(CustomerFactKey.AccessConsiderations, conciseValue(body));
    }
  }

  if (/\b(special requirement|wheelchair|child seat|fragile|pet)\b/i.test(body)) {
    facts.set(CustomerFactKey.SpecialRequirements, conciseValue(body));
  }
  return facts;
}

function serviceMatches(body: string, service: Service): boolean {
  const meaningfulWords = service.name
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length >= 4 && !['full', 'home', 'visit'].includes(word));
  return meaningfulWords.some((word) => body.includes(word));
}

function conciseValue(value: string): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, 240);
}
