import { ArrowLeft, CircleUserRound, Search, Sparkles, UserRoundCog, WalletCards } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  conversationStageLabel,
  formatProductMoney,
  nextActionTitle,
} from '../../application/presentation/productCopy';
import type {
  ProductCustomerGroup,
  ProductCustomerSummaryView,
} from '../../application/presentation/ProductReadService';
import { CustomerAvatar } from '../../components/product/ProductUi';
import { useCloser } from '../../state/closerState';

const groups: Array<{ value: 'ALL' | ProductCustomerGroup; label: string }> = [
  { value: 'ALL', label: 'הכול' },
  { value: 'NEEDS_OWNER', label: 'צריך אותך' },
  { value: 'READY', label: 'מוכן להתקדם' },
  { value: 'WAITING', label: 'ממתין' },
  { value: 'IN_PROGRESS', label: 'בעבודה' },
  { value: 'PAYMENT', label: 'לגבייה' },
  { value: 'CLOSED', label: 'נסגר' },
];

const groupLabel: Record<ProductCustomerGroup, string> = {
  NEEDS_OWNER: 'צריך החלטה שלך',
  READY: 'מוכן להתקדם',
  WAITING: 'CLOSER ממשיך מכאן',
  IN_PROGRESS: 'התהליך כבר בתנועה',
  PAYMENT: 'מחכה לתשלום',
  CLOSED: 'התהליך נסגר',
};

export function CustomersPage() {
  const { businessId, service, state } = useCloser();
  const business = state.businesses.find((candidate) => candidate.id === businessId);
  const { customers } = service.productCustomers(businessId);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<'ALL' | ProductCustomerGroup>('ALL');
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('he');
    return customers.filter((customer) => {
      const matchesGroup = group === 'ALL' || customer.group === group;
      const matchesQuery = !normalized || [customer.customerName, customer.serviceName ?? '']
        .join(' ')
        .toLocaleLowerCase('he')
        .includes(normalized);
      return matchesGroup && matchesQuery;
    });
  }, [customers, group, query]);
  const needsOwner = customers.filter((customer) => customer.group === 'NEEDS_OWNER').length;

  return (
    <section className="owner-page customers-page">
      <header className="owner-page-header">
        <div>
          <p className="owner-eyebrow"><Sparkles aria-hidden="true" /> המסע המסחרי</p>
          <h1>לקוחות</h1>
          <p>כל לקוח לפי מה שקורה עכשיו ומה שצריך לקרות אחר כך.</p>
        </div>
        <div className="owner-page-signal" aria-label={`${needsOwner} לקוחות צריכים אותך`}>
          <strong><bdi dir="ltr">{needsOwner}</bdi></strong>
          <span>צריכים אותך</span>
        </div>
      </header>

      <div className="customer-controls">
        <label className="owner-search">
          <Search aria-hidden="true" />
          <span className="sr-only">חיפוש לקוחות</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="חיפוש לפי שם או שירות"
          />
        </label>
        <div className="owner-filter-row" aria-label="סינון לקוחות">
          {groups.map((item) => (
            <button
              key={item.value}
              type="button"
              aria-pressed={group === item.value}
              onClick={() => setGroup(item.value)}
            >
              {item.label}
              {item.value === 'ALL' ? <bdi dir="ltr">{customers.length}</bdi> : null}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="owner-empty owner-empty-compact">
          <CircleUserRound aria-hidden="true" />
          <div><strong>אין לקוחות בקבוצה הזו</strong><span>אפשר לבחור קבוצה אחרת או לשנות את החיפוש.</span></div>
        </div>
      ) : (
        <ol className="owner-customer-list">
          {filtered.map((customer) => (
            <CustomerOperatingItem
              key={customer.contactId}
              customer={customer}
              currency={business?.currency ?? 'ILS'}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

function CustomerOperatingItem({
  customer,
  currency,
}: {
  customer: ProductCustomerSummaryView;
  currency: string;
}) {
  const amount = (customer.remainingBalanceCents ?? 0) > 0
    ? `${formatProductMoney(customer.remainingBalanceCents ?? 0, currency)} לתשלום`
    : customer.totalCents !== null && customer.collectedCents > 0
      ? `${formatProductMoney(customer.collectedCents, currency)} שולמו`
      : null;
  return (
    <li className={`owner-customer-item is-${customer.group.toLowerCase()}`}>
      <article>
        <div className="owner-customer-person">
          <CustomerAvatar name={customer.customerName} />
          <div>
            <h2>{customer.customerName}</h2>
            <p>{customer.serviceName ?? 'השירות עדיין מתברר'}</p>
          </div>
        </div>
        <div className="owner-customer-state">
          <span>
            {customer.automationStopped ? <UserRoundCog aria-hidden="true" /> : customer.group === 'PAYMENT' ? <WalletCards aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
            {groupLabel[customer.group]}
          </span>
          <strong>
            {customer.action
              ? nextActionTitle(customer.action.actionType, customer.customerName, customer.action.amountCents, currency)
              : conversationStageLabel(customer.stage)}
          </strong>
        </div>
        {amount ? <bdi className="owner-customer-amount" dir="ltr">{amount}</bdi> : <span className="owner-customer-amount is-quiet">{conversationStageLabel(customer.stage)}</span>}
        <Link to={`/customer/${customer.contactId}`} aria-label={`פתח את ${customer.customerName}`}>
          <span>פתח</span><ArrowLeft aria-hidden="true" />
        </Link>
      </article>
    </li>
  );
}
