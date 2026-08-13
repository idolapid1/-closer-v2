import {
  AppointmentStatus,
  LeadStatus,
  NextActionStatus,
  PaymentKind,
  PaymentStatus,
  QuoteStatus,
  type Appointment,
  type Lead,
  type NextAction,
  type Payment,
  type PaymentReferenceType,
  type QuoteItem,
} from './entities';

export class DomainError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export function isLeadActive(status: LeadStatus): boolean {
  return ![LeadStatus.Won, LeadStatus.Lost, LeadStatus.Archived].includes(status);
}

export function assertNextActionInvariant(lead: Lead, actions: NextAction[]): void {
  if (!isLeadActive(lead.status)) return;
  const pending = actions.filter(
    (action) => action.leadId === lead.id && action.status === NextActionStatus.Pending,
  );
  if (pending.length !== 1 || lead.nextActionId !== pending[0]?.id) {
    throw new DomainError(
      `Active lead ${lead.id} must have exactly one current next action`,
      'NEXT_ACTION_REQUIRED',
    );
  }
}

export function assertMoney(amountCents: number, field: string): void {
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) {
    throw new DomainError(`${field} must be a non-negative integer in cents`, 'INVALID_MONEY');
  }
}

export function calculateQuoteTotals(
  items: QuoteItem[],
  discountCents: number,
  taxRateBasisPoints: number,
): { subtotalCents: number; discountCents: number; taxCents: number; totalCents: number } {
  if (items.length === 0) throw new DomainError('A quote needs at least one item', 'EMPTY_QUOTE');
  const subtotalCents = items.reduce((total, item) => {
    assertMoney(item.unitPriceCents, 'unitPriceCents');
    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
      throw new DomainError('Quote item quantity must be a positive integer', 'INVALID_QUANTITY');
    }
    return total + item.quantity * item.unitPriceCents;
  }, 0);
  assertMoney(discountCents, 'discountCents');
  if (discountCents > subtotalCents) {
    throw new DomainError('Discount cannot exceed subtotal', 'INVALID_DISCOUNT');
  }
  const taxableCents = subtotalCents - discountCents;
  const taxCents = Math.round((taxableCents * taxRateBasisPoints) / 10_000);
  return { subtotalCents, discountCents, taxCents, totalCents: taxableCents + taxCents };
}

export function overlaps(first: Appointment, second: Appointment): boolean {
  if (first.staffId !== second.staffId) return false;
  if (
    first.status === AppointmentStatus.Cancelled ||
    second.status === AppointmentStatus.Cancelled
  ) {
    return false;
  }
  return new Date(first.startAt).getTime() < new Date(second.endAt).getTime()
    && new Date(second.startAt).getTime() < new Date(first.endAt).getTime();
}

export function assertNoDoubleBooking(candidate: Appointment, existing: Appointment[]): void {
  if (existing.some((appointment) => appointment.id !== candidate.id && overlaps(candidate, appointment))) {
    throw new DomainError('The staff member is already booked for that time', 'DOUBLE_BOOKING');
  }
}

export function collectedForReference(
  payments: Payment[],
  referenceId: string,
  referenceType?: PaymentReferenceType,
): number {
  return payments
    .filter(
      (payment) =>
        payment.referenceId === referenceId &&
        (referenceType === undefined || payment.referenceType === referenceType) &&
        payment.status === PaymentStatus.Collected,
    )
    .reduce(
      (total, payment) =>
        total + (payment.kind === PaymentKind.Refund ? -payment.amountCents : payment.amountCents),
      0,
    );
}

export function remainingBalance(
  totalCents: number,
  payments: Payment[],
  referenceId: string,
  referenceType?: PaymentReferenceType,
): number {
  assertMoney(totalCents, 'totalCents');
  return Math.max(0, totalCents - collectedForReference(payments, referenceId, referenceType));
}

export function canAcceptQuote(status: QuoteStatus): boolean {
  return [QuoteStatus.Sent, QuoteStatus.Viewed, QuoteStatus.ChangeRequested].includes(status);
}
