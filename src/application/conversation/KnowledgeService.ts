import {
  CustomerFactKey,
  type BusinessKnowledge,
  type CustomerMemoryItem,
  type Lead,
  type Service,
} from '../../domain/entities';

export class KnowledgeService {
  selectedService(
    lead: Lead,
    services: Service[],
    memory: CustomerMemoryItem[],
  ): Service | null {
    if (lead.serviceId) return services.find((service) => service.id === lead.serviceId) ?? null;
    const remembered = memory.find((fact) => fact.key === CustomerFactKey.RequestedService)?.value;
    if (typeof remembered !== 'string') return null;
    return (
      services.find((service) => service.id === remembered) ??
      services.find((service) => service.name.toLowerCase() === remembered.toLowerCase()) ??
      null
    );
  }

  requiredFacts(
    knowledge: BusinessKnowledge,
    service: Service | null,
  ): CustomerFactKey[] {
    if (service) return knowledge.serviceQualificationFields[service.id] ?? [];
    return Object.values(knowledge.serviceQualificationFields)[0] ?? [];
  }

  missingFacts(
    knowledge: BusinessKnowledge,
    service: Service | null,
    memory: CustomerMemoryItem[],
  ): CustomerFactKey[] {
    const known = new Set(memory.map((fact) => fact.key));
    return this.requiredFacts(knowledge, service).filter((key) => !known.has(key));
  }

  factValue(
    memory: CustomerMemoryItem[],
    key: CustomerFactKey,
  ): string | number | boolean | null {
    return memory.find((fact) => fact.key === key)?.value ?? null;
  }

  fixedPrice(knowledge: BusinessKnowledge, service: Service | null): number | null {
    if (!service) return null;
    return knowledge.fixedPricesCents[service.id] ?? null;
  }

  priceRange(
    knowledge: BusinessKnowledge,
    service: Service | null,
  ): { minCents: number; maxCents: number } | null {
    if (!service) return null;
    return knowledge.priceRangesCents[service.id] ?? null;
  }

  duration(knowledge: BusinessKnowledge, service: Service | null): number | null {
    if (!service) return null;
    return knowledge.serviceDurationsMinutes[service.id] ?? service.durationMinutes;
  }
}
