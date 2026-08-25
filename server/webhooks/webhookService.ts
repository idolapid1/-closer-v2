import { createHash } from 'node:crypto';
import { ApiError, assertFound } from '../application/errors.js';
import type { ProductionStore } from '../application/store.js';
import type { ServerSecretProvider } from '../security/secrets.js';
import type { WebhookAdapter } from './webhookAdapter.js';

export class WebhookService {
  private readonly adapters = new Map<string, WebhookAdapter>();

  constructor(
    private readonly store: ProductionStore,
    private readonly secrets: ServerSecretProvider,
    adapters: WebhookAdapter[],
    private readonly now: () => Date = () => new Date(),
  ) {
    for (const adapter of adapters) this.adapters.set(adapter.provider, adapter);
  }

  async ingest(input: {
    provider: string;
    endpointId: string;
    headers: Record<string, string | string[] | undefined>;
    rawBody: Buffer;
  }): Promise<{ eventId: string; replayed: boolean; processingState: string }> {
    const adapter = assertFound(this.adapters.get(input.provider) ?? null, 'UNKNOWN_WEBHOOK_PROVIDER');
    const endpoint = assertFound(
      await this.store.findWebhookEndpoint(input.provider, input.endpointId),
      'UNKNOWN_WEBHOOK_ENDPOINT',
    );
    if (!endpoint.enabled) throw new ApiError(404, 'UNKNOWN_WEBHOOK_ENDPOINT', 'Webhook endpoint not found');
    const secret = await this.secrets.get(endpoint.signingSecretReference);
    if (!secret || !adapter.verify(input.rawBody, input.headers, secret)) {
      throw new ApiError(401, 'INVALID_WEBHOOK_SIGNATURE', 'Webhook verification failed');
    }
    let envelope;
    try {
      envelope = adapter.extractEnvelope(input.rawBody);
    } catch {
      throw new ApiError(400, 'INVALID_WEBHOOK_PAYLOAD', 'Webhook payload is invalid');
    }
    const payloadHash = createHash('sha256').update(input.rawBody).digest('hex');
    const event = await this.store.recordWebhookEvent(
      endpoint,
      envelope.providerEventId,
      payloadHash,
      this.now().toISOString(),
    );
    if (!event.replayed) await this.store.markWebhookProcessed(event.id, this.now().toISOString());
    return { eventId: event.id, replayed: event.replayed, processingState: 'processed' };
  }
}

