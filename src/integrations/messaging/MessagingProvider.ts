import type { ConversationChannel } from '../../domain/entities';

export interface OutgoingProviderMessage {
  businessId: string;
  conversationId: string;
  channel: ConversationChannel;
  to: string;
  body: string;
}

export interface MessagingProvider {
  send(message: OutgoingProviderMessage): Promise<{ providerMessageId: string; sentAt: string }>;
}
