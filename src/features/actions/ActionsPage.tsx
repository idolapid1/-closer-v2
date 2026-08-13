import { Banknote, CalendarDays, CircleAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  ActionRow,
  EmptyState,
  ProductPage,
  SectionHeader,
} from '../../components/product/ProductUi';
import {
  formatProductLongDate,
  formatProductTime,
} from '../../application/presentation/productCopy';
import { useCloser } from '../../state/closerState';

export function ActionsPage() {
  const { state, businessId, service } = useCloser();
  const business = state.businesses.find((candidate) => candidate.id === businessId);
  const today = service.productToday(businessId);
  const currency = business?.currency ?? 'ILS';
  const now = '2026-08-13T08:00:00.000Z';
  const ownerName = state.teamMembers.find(
    (candidate) => candidate.businessId === businessId && candidate.active,
  )?.name.split(' ')[0] ?? '';

  return (
    <ProductPage
      eyebrow={formatProductLongDate(now, business?.timeZone)}
      title={ownerName ? `בוקר טוב, ${ownerName}` : 'בוקר טוב'}
      intro="מה דורש את תשומת הלב שלך היום?"
    >
      <section className="today-attention" aria-labelledby="attention-heading">
        <SectionHeader
          id="attention-heading"
          title="דורש טיפול"
          description="הפעולות שכדאי לסגור קודם."
          count={today.attention.length}
          icon={<CircleAlert aria-hidden="true" />}
        />
        {today.attention.length === 0 ? (
          <EmptyState title="הכול מטופל כרגע" variant="success">
            אין לקוחות שמחכים לפעולה מיידית.
          </EmptyState>
        ) : (
          <ul className="product-action-list">
            {today.attention.map((action) => (
              <ActionRow key={action.id} action={action} currency={currency} now={now} />
            ))}
          </ul>
        )}
      </section>

      <div className="today-support-grid">
        <section className="today-support-section" aria-labelledby="today-commitments-heading">
          <SectionHeader
            id="today-commitments-heading"
            title="היום"
            description="הפגישות והעבודות המתוכננות להיום."
            count={today.commitments.length}
            icon={<CalendarDays aria-hidden="true" />}
          />
          {today.commitments.length === 0 ? (
            <EmptyState title="היום עדיין פנוי">
              אין תורים או עבודות מתוכננות להיום.
            </EmptyState>
          ) : (
            <ol className="commitment-list">
              {today.commitments.map((commitment) => (
                <li key={commitment.id}>
                  <time dateTime={commitment.startsAt}>
                    <bdi dir="ltr">{formatProductTime(commitment.startsAt, business?.timeZone)}</bdi>
                  </time>
                  <div>
                    <strong>{commitment.customerName}</strong>
                    <span>{commitment.serviceName}</span>
                  </div>
                  <Link
                    aria-label={`פתח לקוח עבור ${commitment.customerName}`}
                    to={`/customer/${commitment.contactId}`}
                  >
                    פתח לקוח
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="today-support-section" aria-labelledby="payments-heading">
          <SectionHeader
            id="payments-heading"
            title="תשלומים"
            description="יתרות פתוחות שבאמת צריך לגבות."
            count={today.payments.length}
            icon={<Banknote aria-hidden="true" />}
          />
          {today.payments.length === 0 ? (
            <EmptyState title="אין תשלומים פתוחים" variant="success">
              כל העבודה שהושלמה משולמת במלואה.
            </EmptyState>
          ) : (
            <ul className="product-action-list payment-action-list">
              {today.payments.map((action) => (
                <ActionRow key={action.id} action={action} currency={currency} now={now} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </ProductPage>
  );
}
