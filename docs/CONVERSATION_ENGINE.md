# Conversation engine

Conversation is a first-class tenant entity with channel, owner, state, mode, automation state, customer/business response timestamps, current intent, missing information, handoff, and NextAction references.

Phase 1 channels are mock WhatsApp, mock Instagram, mock website form, and manual. Outgoing sends use the messaging port; `MockWhatsAppProvider` records deterministic provider IDs and performs no network calls.

`MockAIProvider` returns a structured decision containing intent, confidence, missing information, suggested reply, suggested next action, requested tool, and review requirement. It can answer safe business facts and request qualification details. Clinic-sensitive questions, complaints, refunds, legal questions, unsupported input, and low confidence produce a human-handoff proposal.

The provider never mutates state. `CloserService` assembles tenant-scoped context, validates the proposal, updates conversation state, replaces the NextAction, or starts handoff. This prevents cross-business knowledge access and keeps financial/business actions within application validation.

The internal customer route exposes customer-message simulation, mock business sends, suggested reply inspection, takeover, explicit resume, and opt-out.
