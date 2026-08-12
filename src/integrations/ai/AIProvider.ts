import type { AssistantContext, AssistantDecision } from '../../types/assistant';

export interface AIProvider {
  decide(context: AssistantContext): Promise<AssistantDecision>;
}
