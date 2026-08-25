import { createHmac, timingSafeEqual } from 'node:crypto';

export interface VerifiedWebhookEnvelope {
  providerEventId: string;
  eventType: string;
}

export interface WebhookAdapter {
  readonly provider: string;
  verify(rawBody: Buffer, headers: Record<string, string | string[] | undefined>, secret: string): boolean;
  extractEnvelope(rawBody: Buffer): VerifiedWebhookEnvelope;
}

export class HmacWebhookAdapter implements WebhookAdapter {
  constructor(readonly provider: string) {}

  verify(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
    secret: string,
  ): boolean {
    const supplied = scalarHeader(headers['x-closer-signature']);
    if (!supplied || !/^[a-f0-9]{64}$/i.test(supplied)) return false;
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    return timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(expected, 'hex'));
  }

  extractEnvelope(rawBody: Buffer): VerifiedWebhookEnvelope {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new Error('INVALID_WEBHOOK_JSON');
    }
    if (!parsed || typeof parsed !== 'object') throw new Error('INVALID_WEBHOOK_ENVELOPE');
    const record = parsed as Record<string, unknown>;
    if (typeof record.eventId !== 'string' || record.eventId.trim() === '') {
      throw new Error('INVALID_WEBHOOK_EVENT_ID');
    }
    return {
      providerEventId: record.eventId,
      eventType: typeof record.type === 'string' ? record.type : 'unknown',
    };
  }
}

function scalarHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

