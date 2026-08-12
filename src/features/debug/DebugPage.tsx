import { useState } from 'react';
import { Card, Page, formatMoney, readable } from '../../components/ui';
import { useCloser } from '../../state/closerState';

export function DebugPage() {
  const { state, businessId, resetDemo } = useCloser();
  const [showRaw, setShowRaw] = useState(false);
  const business = state.businesses.find((candidate) => candidate.id === businessId);
  const events = state.revenueEvents
    .filter((event) => event.businessId === businessId)
    .sort((first, second) => second.occurredAt.localeCompare(first.occurredAt));
  const tenantSnapshot = Object.fromEntries(
    Object.entries(state).map(([key, value]) => [
      key,
      Array.isArray(value)
        ? value.filter((item) => typeof item === 'object' && item !== null && 'businessId' in item && item.businessId === businessId)
        : value,
    ]),
  );
  return (
    <Page title="Debug" intro="Versioned tenant state and immutable financial event history for internal inspection.">
      <Card title="Demo controls"><div className="button-row"><button type="button" onClick={() => { if (window.confirm('Reset all local changes to the deterministic demo seed?')) resetDemo(); }}>Reset demo data</button><button type="button" onClick={() => setShowRaw((value) => !value)}>{showRaw ? 'Hide' : 'Show'} tenant JSON</button></div><p>Schema version: {state.schemaVersion}</p></Card>
      <Card title="Revenue events">
        <div className="table-wrap"><table><thead><tr><th>Stage</th><th>Amount</th><th>Reference</th><th>Causation</th><th>Correlation</th></tr></thead><tbody>{events.map((event) => <tr key={event.id}><td>{readable(event.stage)}</td><td>{formatMoney(event.amountCents, business?.currency ?? 'ILS')}</td><td>{readable(event.referenceType)} · {event.referenceId}</td><td>{event.causationId}</td><td>{event.correlationId}</td></tr>)}</tbody></table></div>
      </Card>
      {showRaw ? <Card title="Tenant-scoped raw state"><pre>{JSON.stringify(tenantSnapshot, null, 2)}</pre></Card> : null}
    </Page>
  );
}
