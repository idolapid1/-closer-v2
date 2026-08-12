import type { MessagingProvider, OutgoingProviderMessage } from './MessagingProvider';

export class MockWhatsAppProvider implements MessagingProvider {
  readonly sent: OutgoingProviderMessage[] = [];

  constructor(private readonly now: () => string = () => new Date().toISOString()) {}

  async send(message: OutgoingProviderMessage): Promise<{ providerMessageId: string; sentAt: string }> {
    this.sent.push(structuredClone(message));
    return {
      providerMessageId: `mock-wa-${this.sent.length}`,
      sentAt: this.now(),
    };
  }
}
