import { ConversationEngine } from '../../application/conversation/ConversationEngine';
import type { AssistantContext, AssistantDecision } from '../../types/assistant';
import type { AIProvider } from './AIProvider';

/**
 * Deterministic Phase 2 provider. It has no repository, network, clock, or mutation access.
 * All context is assembled and tenant-scoped by the application layer.
 */
export class MockAIProvider implements AIProvider {
  private readonly engine = new ConversationEngine();

  async decide(context: AssistantContext): Promise<AssistantDecision> {
    return this.engine.decide(context);
  }
}
