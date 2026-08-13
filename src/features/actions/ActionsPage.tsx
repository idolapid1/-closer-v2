import { Link } from 'react-router-dom';
import { Card, Empty, Page, formatMoney, readable } from '../../components/ui';
import { useCloser } from '../../state/closerState';

export function ActionsPage() {
  const { state, businessId, service } = useCloser();
  const business = state.businesses.find((candidate) => candidate.id === businessId);
  const actions = service.actionCenter(businessId);
  const currency = business?.currency ?? 'ILS';

  return (
    <Page title="What needs attention" intro="One clear action for each active customer opportunity.">
      <Card>
        {actions.length === 0 ? <Empty>Nothing needs immediate attention.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Customer</th><th>What to do</th><th>Amount</th><th>Due</th><th /></tr></thead>
              <tbody>
                {actions.map((action) => (
                  <tr key={action.id}>
                    <td>{action.customerName}</td>
                    <td><strong>{readable(action.actionType)}</strong><br /><small>{action.reason}</small></td>
                    <td>{action.amountCents === null ? '—' : formatMoney(action.amountCents, currency)}</td>
                    <td>{action.dueAt ? new Date(action.dueAt).toLocaleString() : 'Now'}</td>
                    <td><Link to={`/customer/${action.contactId}`}>Open customer</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Page>
  );
}
