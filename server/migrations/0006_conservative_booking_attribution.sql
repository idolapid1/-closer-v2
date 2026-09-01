-- Migration 0004 mapped every legacy booked-stage event to BOOKING_RECOVERED.
-- A booking is not evidence of a CLOSER recovery action. Correct legacy labels
-- conservatively while preserving genuinely recovered bookings.

UPDATE revenue_ledger_events
SET event_type = 'BOOKING_CREATED'
WHERE stage = 'booked'
  AND event_type = 'BOOKING_RECOVERED'
  AND attribution_type IS DISTINCT FROM 'RECOVERED'::revenue_attribution_type;
