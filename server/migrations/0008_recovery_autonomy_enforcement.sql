-- OBSERVE and SUGGEST are intentionally non-executable autonomy modes. Correct
-- prepared actions created before this boundary was made explicit without
-- changing approved or completed historical work.

UPDATE recovery_actions action
SET status = 'PENDING', updated_at = now()
FROM opportunities opportunity
WHERE action.tenant_id = opportunity.tenant_id
  AND action.opportunity_id = opportunity.id
  AND opportunity.autonomy_level IN ('OBSERVE', 'SUGGEST')
  AND action.status = 'WAITING_APPROVAL'
  AND action.approved_at IS NULL;

UPDATE recovery_decisions decision
SET execution_state = CASE
      WHEN opportunity.autonomy_level = 'OBSERVE' THEN 'OBSERVED'
      ELSE 'SUGGESTED'
    END
FROM opportunities opportunity
WHERE decision.tenant_id = opportunity.tenant_id
  AND decision.opportunity_id = opportunity.id
  AND opportunity.autonomy_level IN ('OBSERVE', 'SUGGEST')
  AND decision.execution_state = 'PENDING_APPROVAL'
  AND decision.executed_at IS NULL;
