import { z } from 'zod';

export const resourceIdSchema = z.string().min(1).max(120).regex(/^[A-Za-z0-9_-]+$/);
export const idempotencyKeySchema = z.string().min(8).max(200).regex(/^[A-Za-z0-9:._-]+$/);

export const tenantProvisionSchema = z.object({
  name: z.string().trim().min(2).max(160),
  idempotencyKey: idempotencyKeySchema,
});

export const invitationCreationSchema = z.object({
  email: z.email(),
  role: z.enum(['admin', 'member']),
  idempotencyKey: idempotencyKeySchema,
});

export const invitationAcceptanceSchema = z.object({
  token: z.string().min(32).max(256).regex(/^[A-Za-z0-9_-]+$/),
});

export const journeyCreationSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  customer: z.object({
    displayName: z.string().trim().min(1).max(160),
    phone: z.string().trim().min(5).max(40),
    email: z.email().nullable(),
  }),
  lead: z.object({
    source: z.enum(['MISSED_CALL', 'PHONE', 'WHATSAPP', 'INSTAGRAM', 'WEBSITE_FORM', 'EMAIL', 'MANUAL', 'IMPORT']),
    workflowType: z.enum(['APPOINTMENT_SERVICE', 'QUOTE_JOB']),
    serviceId: resourceIdSchema.nullable(),
    opportunityType: z.enum([
      'EMERGENCY_REPAIR', 'STANDARD_REPAIR', 'MAINTENANCE', 'TUNE_UP',
      'SYSTEM_REPLACEMENT', 'INSTALLATION', 'INDOOR_AIR_QUALITY', 'DUCT_WORK',
      'COMMERCIAL_SERVICE', 'OTHER',
    ]).optional(),
    estimatedValueCents: z.number().int().nonnegative().max(1_000_000_000).nullable().optional(),
    autonomyLevel: z.enum(['OBSERVE', 'SUGGEST', 'APPROVE_TO_SEND', 'AUTOPILOT']).optional(),
  }),
  conversation: z.object({
    channel: z.enum(['WHATSAPP', 'INSTAGRAM', 'WEBSITE_FORM', 'EMAIL', 'MANUAL']),
  }),
});

export const opportunityCreationSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  source: z.enum(['MISSED_CALL', 'PHONE', 'WHATSAPP', 'INSTAGRAM', 'WEBSITE_FORM', 'EMAIL', 'MANUAL', 'IMPORT', 'OTHER']),
  workflowType: z.enum(['APPOINTMENT_SERVICE', 'QUOTE_JOB']),
  serviceId: resourceIdSchema.nullable(),
  opportunityType: z.enum([
    'EMERGENCY_REPAIR', 'STANDARD_REPAIR', 'MAINTENANCE', 'TUNE_UP',
    'SYSTEM_REPLACEMENT', 'INSTALLATION', 'INDOOR_AIR_QUALITY', 'DUCT_WORK',
    'COMMERCIAL_SERVICE', 'OTHER',
  ]),
  estimatedValueCents: z.number().int().nonnegative().max(1_000_000_000).nullable(),
  autonomyLevel: z.enum(['OBSERVE', 'SUGGEST', 'APPROVE_TO_SEND', 'AUTOPILOT']),
  channel: z.enum(['WHATSAPP', 'INSTAGRAM', 'WEBSITE_FORM', 'EMAIL', 'MANUAL']),
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
export const recoveryEvaluationSchema = z.object({ idempotencyKey: idempotencyKeySchema });
export const recoveryActionApprovalSchema = z.object({ idempotencyKey: idempotencyKeySchema });
export const customerOptOutSchema = z.object({ idempotencyKey: idempotencyKeySchema });
export const customerResponseSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  providerMessageId: idempotencyKeySchema,
  body: z.string().trim().min(1).max(4_000),
});
export const opportunityListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

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
  opportunityId: resourceIdSchema.nullable().optional(),
  eventType: z.enum([
    'ESTIMATE_CREATED', 'POTENTIAL_REVENUE_AT_RISK', 'BOOKING_CREATED', 'BOOKING_RECOVERED',
    'JOB_WON', 'PAYMENT_RECEIVED', 'REFUND', 'ADJUSTMENT',
  ]).nullable().optional(),
  attributionType: z.enum(['GENERATED', 'RECOVERED', 'ASSISTED', 'ORGANIC']).nullable().optional(),
  attributionReason: z.string().trim().min(4).max(500).nullable().optional(),
}).superRefine((value, context) => {
  if (value.attributionType && !value.attributionReason) {
    context.addIssue({ code: 'custom', path: ['attributionReason'], message: 'Attribution requires evidence' });
  }
});

export const copilotExecutionSchema = z.object({
  tool: z.enum([
    'GET_HOT_LEADS',
    'GET_UNANSWERED_CONVERSATIONS',
    'GET_REVENUE_OVERVIEW',
    'GET_REACTIVATION_CANDIDATES',
    'GET_REVENUE_AT_RISK',
    'GET_PRIORITY_OPPORTUNITIES',
    'GET_HUMAN_REQUIRED_OPPORTUNITIES',
    'EXPLAIN_OPPORTUNITY_PRIORITY',
    'PREPARE_REACTIVATION',
    'PREPARE_OPPORTUNITY_RECOVERY',
  ]),
  arguments: z.record(z.string(), z.unknown()),
  approved: z.boolean(),
  idempotencyKey: idempotencyKeySchema,
});
