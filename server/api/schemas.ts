import { z } from 'zod';

export const resourceIdSchema = z.string().min(1).max(120).regex(/^[A-Za-z0-9_-]+$/);
export const idempotencyKeySchema = z.string().min(8).max(200).regex(/^[A-Za-z0-9:._-]+$/);

export const tenantProvisionSchema = z.object({
  name: z.string().trim().min(2).max(160),
  idempotencyKey: idempotencyKeySchema,
});

export const journeyCreationSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  customer: z.object({
    displayName: z.string().trim().min(1).max(160),
    phone: z.string().trim().min(5).max(40),
    email: z.email().nullable(),
  }),
  lead: z.object({
    source: z.enum(['WHATSAPP', 'INSTAGRAM', 'WEBSITE_FORM', 'EMAIL', 'MANUAL', 'IMPORT']),
    workflowType: z.enum(['APPOINTMENT_SERVICE', 'QUOTE_JOB']),
    serviceId: resourceIdSchema.nullable(),
  }),
  conversation: z.object({
    channel: z.enum(['WHATSAPP', 'INSTAGRAM', 'WEBSITE_FORM', 'EMAIL', 'MANUAL']),
  }),
});

export const followUpCreationSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  conversationId: resourceIdSchema,
  customerId: resourceIdSchema,
  channel: z.enum(['WHATSAPP', 'INSTAGRAM', 'EMAIL', 'MANUAL']),
  reason: z.string().trim().min(1).max(240),
  dueAt: z.iso.datetime(),
  draftMessage: z.string().trim().min(1).max(2_000).nullable(),
});

export const cancellationSchema = z.object({ idempotencyKey: idempotencyKeySchema });

export const handoffSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  reason: z.string().trim().min(2).max(240),
});

export const resumeSchema = z.object({ idempotencyKey: idempotencyKeySchema });

export const bookingCreationSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  customerId: resourceIdSchema,
  leadId: resourceIdSchema,
  serviceId: resourceIdSchema,
  staffId: resourceIdSchema,
  startAt: z.iso.datetime(),
  endAt: z.iso.datetime(),
  totalCents: z.number().int().nonnegative().max(1_000_000_000),
  depositRequiredCents: z.number().int().nonnegative().max(1_000_000_000),
}).refine((value) => value.endAt > value.startAt, {
  path: ['endAt'],
  message: 'End must be after start',
}).refine((value) => value.depositRequiredCents <= value.totalCents, {
  path: ['depositRequiredCents'],
  message: 'Deposit cannot exceed total',
});

export const paymentCreationSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  customerId: resourceIdSchema,
  leadId: resourceIdSchema,
  conversationId: resourceIdSchema,
  referenceType: z.enum(['APPOINTMENT', 'QUOTE', 'JOB']),
  referenceId: resourceIdSchema,
  kind: z.enum(['DEPOSIT', 'BALANCE', 'REFUND']),
  amountCents: z.number().int().positive().max(1_000_000_000),
  originalPaymentId: resourceIdSchema.nullable(),
}).superRefine((value, context) => {
  if (value.kind === 'REFUND' && !value.originalPaymentId) {
    context.addIssue({ code: 'custom', path: ['originalPaymentId'], message: 'Refund requires original payment' });
  }
  if (value.kind !== 'REFUND' && value.originalPaymentId) {
    context.addIssue({ code: 'custom', path: ['originalPaymentId'], message: 'Only refunds may reference a payment' });
  }
});

export const revenueEntrySchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  customerId: resourceIdSchema,
  leadId: resourceIdSchema,
  conversationId: resourceIdSchema,
  paymentId: resourceIdSchema.nullable(),
  stage: z.enum(['potential', 'pipeline', 'booked', 'collected', 'refunded', 'recovered']),
  amountCents: z.number().int().nonnegative().max(1_000_000_000),
  causationKey: idempotencyKeySchema,
});

export const copilotExecutionSchema = z.object({
  tool: z.enum([
    'GET_HOT_LEADS',
    'GET_UNANSWERED_CONVERSATIONS',
    'GET_REVENUE_OVERVIEW',
    'GET_REACTIVATION_CANDIDATES',
    'PREPARE_REACTIVATION',
  ]),
  arguments: z.record(z.string(), z.unknown()),
  approved: z.boolean(),
  idempotencyKey: idempotencyKeySchema,
});
