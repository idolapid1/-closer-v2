import { Link } from 'react-router-dom';
import { Card, Page, readable } from '../../components/ui';
import { LeadStatus, NextActionStatus } from '../../domain/entities';
import { useCloser } from '../../state/closerState';

export function DemoPage() {
  const { state, businessId } = useCloser();
  const business = state.businesses.find((candidate) => candidate.id === businessId);
  const contacts = state.contacts.filter((contact) => contact.businessId === businessId);
  const leads = state.leads.filter((lead) => lead.businessId === businessId);
  const actions = state.nextActions.filter(
    (action) => action.businessId === businessId && action.status === NextActionStatus.Pending,
  );
  const knowledge = state.businessKnowledge.find((entry) => entry.businessId === businessId);

  if (!business || !knowledge) return null;
  return (
    <Page
      title={business.name}
      intro="A deterministic tenant dataset for inspecting one complete revenue workflow."
    >
      <div className="summary-grid">
        <Card title="Workflow">
          <strong>{readable(business.workflowType)}</strong>
          <p>{contacts.length} fictional contacts · {leads.filter((lead) => lead.status !== LeadStatus.Won).length} active opportunities</p>
        </Card>
        <Card title="Business knowledge">
          <p>{knowledge.openingHours}</p>
          <p>{knowledge.address}</p>
          <p>Tone: {knowledge.toneOfVoice}</p>
        </Card>
        <Card title="Needs attention">
          <strong>{actions.length} current actions</strong>
          <p>Each active opportunity has one explicit next action.</p>
        </Card>
      </div>

      <Card title="Scenario contacts">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Customer</th><th>Lead</th><th>Next action</th><th /></tr></thead>
            <tbody>
              {contacts.map((contact) => {
                const lead = leads.find((candidate) => candidate.contactId === contact.id);
                const action = actions.find((candidate) => candidate.leadId === lead?.id);
                return (
                  <tr key={contact.id}>
                    <td>{contact.displayName}</td>
                    <td>{lead ? readable(lead.status) : '—'}</td>
                    <td>{action ? readable(action.type) : 'No immediate action'}</td>
                    <td><Link to={`/customer/${contact.id}`}>Open</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </Page>
  );
}
