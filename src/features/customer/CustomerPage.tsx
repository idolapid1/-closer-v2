import { useRef, useState } from 'react';
import {
  ArrowLeft,
  Banknote,
  CalendarClock,
  CheckCircle2,
  Clock3,
  FileText,
  History,
  Info,
  Mail,
  MessageCircleMore,
  Phone,
  UserRoundCog,
} from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import {
  activityLabel,
  appointmentStatusLabel,
  conversationStageLabel,
  factLabel,
  factValue,
  formatProductDateTime,
  formatProductMoney,
  jobStatusLabel,
  lostReasonLabel,
  nextActionCta,
  nextActionDescription,
  nextActionTitle,
  quoteStatusLabel,
} from '../../application/presentation/productCopy';
import type { ProductCustomerView } from '../../application/presentation/ProductReadService';
import {
  CustomerAvatar,
  EmptyState,
  ErrorBanner,
  ProductPage,
  SectionHeader,
  SuccessBanner,
} from '../../components/product/ProductUi';
import { HandoffReason, LeadStatus } from '../../domain/entities';
import { useCloser } from '../../state/closerState';

export function CustomerPage() {
  const { id: contactId = '' } = useParams();
  const { state, businessId, service } = useCloser();
  const customer = service.productCustomer(businessId, contactId);
  const business = state.businesses.find((candidate) => candidate.id === businessId);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const statusRegion = useRef<HTMLElement>(null);

  if (!customer) {
    return (
      <ProductPage title="הלקוח לא נמצא" intro="הלקוח שייך לעסק אחר או שאינו קיים.">
        <EmptyState title="אין גישה ללקוח הזה">נסו לעבור לעסק המתאים.</EmptyState>
      </ProductPage>
    );
  }

  const run = (action: () => void, confirmation: string) => {
    setError('');
    try {
      action();
      setSuccess(confirmation);
      window.requestAnimationFrame(() => statusRegion.current?.focus());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'הפעולה לא הושלמה.');
    }
  };
  const currency = business?.currency ?? 'ILS';
  const isWon = customer.leadStatus === LeadStatus.Won;
  const isLost = customer.leadStatus === LeadStatus.Lost;

  return (
    <ProductPage
      eyebrow="מרחב לקוח"
      title={customer.customerName}
      intro={`${customer.serviceName ?? 'עדיין לא נבחר שירות'} · ${conversationStageLabel(customer.stage)}`}
      actions={(
        <div className="customer-header-actions">
          <a className="icon-button" href={`tel:${customer.phone}`} aria-label={`התקשר אל ${customer.customerName}`}>
            <Phone aria-hidden="true" />
          </a>
          <Link className="button button-secondary" to={`/inbox?conversation=${customer.conversationId}`}>
            <MessageCircleMore aria-hidden="true" />
            פתח שיחה
          </Link>
        </div>
      )}
    >
      <ErrorBanner message={error} />
      <SuccessBanner message={success} />

      <section
        ref={statusRegion}
        tabIndex={-1}
        className={`customer-hero${customer.automationStopped ? ' is-human' : ''}${isWon ? ' is-won' : ''}`}
      >
        <div className="customer-identity">
          <CustomerAvatar name={customer.customerName} size="large" />
          <div>
            <span className="customer-status-line">
              {customer.automationStopped ? <UserRoundCog aria-hidden="true" /> : isWon ? <CheckCircle2 aria-hidden="true" /> : <Clock3 aria-hidden="true" />}
              {customer.isHumanActive ? 'השיחה בטיפול אנושי' : customer.automationStopped ? 'העוזר מושהה' : isWon ? 'התהליך הושלם ושולם' : isLost ? lostReasonLabel(customer.lostReason) : conversationStageLabel(customer.stage)}
            </span>
            <div className="customer-contact-line">
              <a href={`tel:${customer.phone}`}><bdi dir="ltr">{customer.phone}</bdi></a>
              {customer.email ? (
                <a href={`mailto:${customer.email}`}>
                  <Mail aria-hidden="true" />
                  <bdi dir="ltr">{customer.email}</bdi>
                </a>
              ) : null}
            </div>
          </div>
        </div>
        {customer.action ? (
          <div className="customer-primary-action">
            <span>הפעולה הבאה</span>
            <strong>{nextActionTitle(customer.action.actionType, customer.customerName, customer.action.amountCents, currency)}</strong>
            <p>{nextActionDescription(customer.action.actionType)}</p>
            <Link className="button button-primary" to={`/inbox?conversation=${customer.conversationId}`}>
              {nextActionCta(customer.action.actionType)}
              <ArrowLeft aria-hidden="true" />
            </Link>
          </div>
        ) : isWon ? (
          <div className="customer-primary-action is-complete">
            <span>הכול סגור</span>
            <strong>העבודה הושלמה והתשלום התקבל</strong>
            <p>אין כרגע פעולה שדורשת תשומת לב.</p>
          </div>
        ) : (
          <div className="customer-primary-action is-muted">
            <span>אין פעולה מיידית</span>
            <strong>{isLost ? lostReasonLabel(customer.lostReason) : 'הלקוח/ה לא מחכה כרגע'}</strong>
            {isLost ? (
              <button
                className="button button-secondary"
                type="button"
                onClick={() => run(() => {
                  const lead = state.leads.find((candidate) => candidate.businessId === businessId && candidate.contactId === contactId);
                  if (!lead) throw new Error('ההזדמנות לא נמצאה.');
                  service.reopenOpportunity(businessId, lead.id);
                }, 'התהליך נפתח מחדש עבור הלקוח/ה החוזר/ת.')}
              >
                פתח מחדש
              </button>
            ) : null}
          </div>
        )}
      </section>

      {customer.automationStopped ? (
        <section className="customer-handoff-callout" aria-label={customer.isHumanActive ? 'טיפול אנושי פעיל' : 'העוזר מושהה'}>
          <UserRoundCog aria-hidden="true" />
          <div>
            <strong>{customer.isHumanActive ? 'אתם מנהלים את השיחה עכשיו' : 'העוזר מושהה בשיחה הזו'}</strong>
            <p>הודעות אוטומטיות ותזכורות מושהות עד להחזרה מפורשת של העוזר.</p>
          </div>
          <button
            className="button button-secondary"
            type="button"
            onClick={() => run(() => service.resumeAssistant(businessId, customer.conversationId), 'העוזר חזר לפעול.')}
          >
            החזר את העוזר
          </button>
        </section>
      ) : !customer.isClosed ? (
        <div className="customer-control-row">
          <span>העוזר מטפל בתשובות בטוחות. אפשר לקחת שליטה בכל רגע.</span>
          <button
            className="button button-quiet"
            type="button"
            onClick={() => run(
              () => service.startHumanTakeover(
                businessId,
                customer.conversationId,
                HandoffReason.Manual,
                'השיחה הועברה לטיפול של בעל/ת העסק.',
              ),
              'השיחה הועברה לטיפול אנושי.',
            )}
          >
            אני מטפל/ת בשיחה
          </button>
        </div>
      ) : null}

      <div className="customer-workspace-grid">
        <div className="customer-main-column">
          <section className="customer-section current-work-section">
            <SectionHeader title="מה קורה עכשיו" icon={<CalendarClock aria-hidden="true" />} />
            <CurrentWork customer={customer} currency={currency} timeZone={business?.timeZone} />
          </section>

          <section className="customer-section customer-conversation-preview">
            <SectionHeader title="השיחה האחרונה" icon={<MessageCircleMore aria-hidden="true" />} />
            {customer.messages.length === 0 ? (
              <EmptyState title="עוד אין הודעות">אפשר לפתוח שיחה מהכפתור למעלה.</EmptyState>
            ) : (
              <div className="customer-message-preview">
                {customer.messages.slice(-3).map((message) => (
                  <article key={message.id} className={`customer-preview-message is-${message.side.toLowerCase()}`} dir="auto">
                    <p>{message.body}</p>
                    <time dateTime={message.sentAt}>{formatProductDateTime(message.sentAt, business?.timeZone)}</time>
                  </article>
                ))}
                <Link to={`/inbox?conversation=${customer.conversationId}`}>לשיחה המלאה <ArrowLeft aria-hidden="true" /></Link>
              </div>
            )}
          </section>

          <section className="customer-section">
            <SectionHeader title="מה כבר קרה" icon={<History aria-hidden="true" />} />
            {customer.activity.length === 0 ? (
              <EmptyState title="ההיסטוריה עדיין קצרה">אירועים חשובים יופיעו כאן לפי הסדר.</EmptyState>
            ) : (
              <ol className="product-timeline">
                {[...customer.activity].reverse().map((activity) => (
                  <li key={activity.id}>
                    <span className="timeline-marker" aria-hidden="true" />
                    <div>
                      <strong>{activityLabel(activity.type)}</strong>
                      <time dateTime={activity.occurredAt}>{formatProductDateTime(activity.occurredAt, business?.timeZone)}</time>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <aside className="customer-side-column">
          <section className={`payment-summary${(customer.remainingBalanceCents ?? 0) > 0 ? ' has-balance' : ''}`}>
            <SectionHeader title="תשלום" icon={<Banknote aria-hidden="true" />} />
            {customer.totalCents === null ? (
              <EmptyState title="עדיין אין סכום מאושר">סכום יופיע אחרי קביעת תור או אישור הצעה.</EmptyState>
            ) : (
              <dl>
                <div><dt>סה״כ</dt><dd><bdi>{formatProductMoney(customer.totalCents, currency)}</bdi></dd></div>
                <div><dt>שולם</dt><dd><bdi>{formatProductMoney(customer.collectedCents, currency)}</bdi></dd></div>
                <div className="payment-balance-row"><dt>נותר לתשלום</dt><dd><bdi>{formatProductMoney(customer.remainingBalanceCents ?? 0, currency)}</bdi></dd></div>
              </dl>
            )}
            {customer.refundCents > 0 ? <p className="payment-note">כולל החזרים בסך {formatProductMoney(customer.refundCents, currency)}</p> : null}
          </section>

          <section className="customer-section facts-section">
            <SectionHeader title="פרטים שימושיים" icon={<Info aria-hidden="true" />} />
            {customer.facts.length === 0 ? (
              <EmptyState title="עוד לא נאספו פרטים">פרטים שהלקוח/ה מסר/ה יופיעו כאן.</EmptyState>
            ) : (
              <dl className="facts-list">
                {customer.facts.map((fact) => (
                    <div key={fact.id}><dt>{factLabel(fact.key)}</dt><dd dir="auto">{factValue(fact.value)}</dd></div>
                ))}
              </dl>
            )}
          </section>

          <section className="customer-section communication-section">
            <SectionHeader title="תקשורת" icon={<MessageCircleMore aria-hidden="true" />} />
            <div className="communication-status">
              <span>הודעות תפעוליות</span><strong>{customer.operationalAllowed ? 'מותרות' : 'חסומות'}</strong>
            </div>
            <div className="communication-status">
              <span>הודעות שיווקיות</span><strong>{customer.marketingAllowed ? 'מותרות' : 'חסומות'}</strong>
            </div>
            {customer.marketingAllowed ? (
              <button
                className="button button-quiet"
                type="button"
                onClick={() => run(() => service.optOutMarketing(businessId, contactId), 'הודעות שיווקיות נחסמו.')}
              >
                חסום הודעות שיווקיות
              </button>
            ) : null}
          </section>
        </aside>
      </div>
    </ProductPage>
  );
}

function CurrentWork({
  customer,
  currency,
  timeZone,
}: {
  customer: ProductCustomerView;
  currency: string;
  timeZone: string | undefined;
}) {
  if (customer.work.kind === 'APPOINTMENT' && customer.work.appointmentStatus) {
    return (
      <div className="work-summary">
        <div className="work-summary-icon"><CalendarClock aria-hidden="true" /></div>
        <div className="work-summary-copy">
          <span>תור</span>
          <strong>{appointmentStatusLabel(customer.work.appointmentStatus)}</strong>
          {customer.work.appointmentStartAt ? <time dateTime={customer.work.appointmentStartAt}>{formatProductDateTime(customer.work.appointmentStartAt, timeZone)}</time> : null}
        </div>
        <Link className="button button-secondary" to="/appointments">פרטי התור</Link>
      </div>
    );
  }
  if (customer.work.kind === 'QUOTE_JOB') {
    return (
      <div className="work-summary">
        <div className="work-summary-icon"><FileText aria-hidden="true" /></div>
        <div className="work-summary-copy">
          <span>{customer.work.jobStatus ? 'עבודה' : 'הצעת מחיר'}</span>
          <strong>{customer.work.jobStatus ? jobStatusLabel(customer.work.jobStatus) : customer.work.quoteStatus ? quoteStatusLabel(customer.work.quoteStatus) : 'בתהליך'}</strong>
          {customer.work.jobStartAt ? <time dateTime={customer.work.jobStartAt}>{formatProductDateTime(customer.work.jobStartAt, timeZone)}</time> : null}
          {!customer.work.jobStartAt && customer.work.quoteTotalCents !== null ? <span><bdi>{formatProductMoney(customer.work.quoteTotalCents, currency)}</bdi></span> : null}
        </div>
        <Link className="button button-secondary" to="/quotes">פרטי העבודה</Link>
      </div>
    );
  }
  return (
    <EmptyState title="עוד לא נקבעה עבודה">
      כשהפרטים יהיו מוכנים, התור או הצעת המחיר יופיעו כאן.
    </EmptyState>
  );
}
