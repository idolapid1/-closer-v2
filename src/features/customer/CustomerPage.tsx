import { useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Banknote,
  CalendarClock,
  Check,
  CheckCircle2,
  Clock3,
  FileText,
  History,
  Info,
  Mail,
  MessageCircleMore,
  Phone,
  Sparkles,
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
  handoffReasonLabel,
  jobStatusLabel,
  lostReasonLabel,
  nextActionCta,
  nextActionDescription,
  nextActionTitle,
  quoteStatusLabel,
} from '../../application/presentation/productCopy';
import type { ProductCustomerView } from '../../application/presentation/ProductReadService';
import { CustomerAvatar, ErrorBanner, SuccessBanner } from '../../components/product/ProductUi';
import {
  ConversationStage,
  HandoffReason,
  LeadStatus,
  WorkflowType,
} from '../../domain/entities';
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
      <section className="owner-page customer-not-found">
        <Link className="owner-back-link" to="/customers"><ArrowRight aria-hidden="true" /> חזרה ללקוחות</Link>
        <div className="owner-empty"><Info aria-hidden="true" /><div><strong>הלקוח לא נמצא</strong><span>הלקוח שייך לעסק אחר או שאינו קיים.</span></div></div>
      </section>
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
  const conversationUrl = `/inbox?conversation=${customer.conversationId}`;

  return (
    <section className="owner-page customer-page">
      <Link className="owner-back-link" to="/customers"><ArrowRight aria-hidden="true" /> כל הלקוחות</Link>
      <header className="customer-owner-header">
        <div className="customer-owner-identity">
          <CustomerAvatar name={customer.customerName} size="large" />
          <div>
            <p className="owner-eyebrow">המסע של הלקוח</p>
            <h1>{customer.customerName}</h1>
            <span>{customer.serviceName ?? 'השירות עדיין מתברר'} · {conversationStageLabel(customer.stage)}</span>
          </div>
        </div>
        <div className="customer-owner-contact">
          <a href={`tel:${customer.phone}`} aria-label={`התקשר אל ${customer.customerName}`}><Phone aria-hidden="true" /><bdi dir="ltr">{customer.phone}</bdi></a>
          <Link to={conversationUrl}><MessageCircleMore aria-hidden="true" /> פתח שיחה</Link>
        </div>
      </header>

      <ErrorBanner message={error} />
      <SuccessBanner message={success} />

      <section
        ref={statusRegion}
        tabIndex={-1}
        className={`customer-command${customer.automationStopped ? ' is-human' : ''}${isWon ? ' is-won' : ''}`}
      >
        <div className="customer-command-state">
          <span>
            {customer.automationStopped ? <UserRoundCog aria-hidden="true" /> : isWon ? <CheckCircle2 aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
            {customer.isHumanActive ? 'השיחה בטיפול אנושי' : customer.automationStopped ? 'CLOSER מושהה' : isWon ? 'העבודה הושלמה ושולמה' : isLost ? lostReasonLabel(customer.lostReason) : 'CLOSER ממשיך לקדם'}
          </span>
          <p>{customer.automationStopped ? 'הבעלים שולט בשיחה; שום הודעה אוטומטית לא תישלח.' : 'המצב נגזר מהשיחה, העבודה והתשלום המאומת.'}</p>
        </div>
        {customer.action ? (
          <div className="customer-command-action">
            <span>הפעולה הבאה</span>
            <strong>{nextActionTitle(customer.action.actionType, customer.customerName, customer.action.amountCents, currency)}</strong>
            <p>{nextActionDescription(customer.action.actionType)}</p>
            <Link to={conversationUrl}>{nextActionCta(customer.action.actionType)} <ArrowLeft aria-hidden="true" /></Link>
          </div>
        ) : isWon ? (
          <div className="customer-command-action is-complete"><span>מה קורה עכשיו</span><strong>אין פעולה שמחכה לך</strong><p>העבודה והתשלום הושלמו.</p></div>
        ) : (
          <div className="customer-command-action is-quiet">
            <span>מה קורה עכשיו</span><strong>{isLost ? lostReasonLabel(customer.lostReason) : 'הלקוח לא מחכה לפעולה מיידית'}</strong>
            {isLost ? <button type="button" onClick={() => run(() => {
              const lead = state.leads.find((candidate) => candidate.businessId === businessId && candidate.contactId === contactId);
              if (!lead) throw new Error('ההזדמנות לא נמצאה.');
              service.reopenOpportunity(businessId, lead.id);
            }, 'התהליך נפתח מחדש עבור הלקוח/ה החוזר/ת.')}>פתח מחדש</button> : null}
          </div>
        )}
      </section>

      <JourneyProgress customer={customer} />

      {customer.automationStopped ? (
        <section className="customer-handoff" aria-label={customer.isHumanActive ? 'טיפול אנושי פעיל' : 'CLOSER מושהה'}>
          <span className="customer-handoff-mark"><UserRoundCog aria-hidden="true" /></span>
          <div>
            <strong>{customer.isHumanActive ? 'אתם מנהלים את השיחה עכשיו' : 'CLOSER מושהה בשיחה הזו'}</strong>
            <p>{customer.handoff ? handoffReasonLabel(customer.handoff.reason) : 'אוטומציה ומעקבים נשארים מושהים עד להחזרה מפורשת.'}</p>
            {customer.handoff?.detail ? <small>{customer.handoff.detail}</small> : null}
            <span>אוטומציה ומעקבים יישארו מושהים עד להחזרה מפורשת.</span>
          </div>
          <button type="button" onClick={() => run(() => service.resumeAssistant(businessId, customer.conversationId), 'CLOSER חזר לפעול בשיחה.')}>החזר את CLOSER</button>
        </section>
      ) : !customer.isClosed ? (
        <div className="customer-autonomy-row"><span>CLOSER מטפל רק במה שמותר ובטוח.</span><button type="button" onClick={() => run(() => service.startHumanTakeover(businessId, customer.conversationId, HandoffReason.Manual, 'השיחה הועברה לטיפול של בעל/ת העסק.'), 'השיחה הועברה לטיפול אנושי.')}>אני מטפל/ת בשיחה</button></div>
      ) : null}

      <div className="customer-story-grid">
        <div className="customer-story-main">
          <OwnerSection title="מה קורה עכשיו" eyebrow="העבודה המסחרית" icon={<CalendarClock aria-hidden="true" />}>
            <CurrentWork customer={customer} currency={currency} timeZone={business?.timeZone} />
          </OwnerSection>

          <OwnerSection title="מה כבר ידוע" eyebrow="המידע ש־CLOSER אסף" icon={<Info aria-hidden="true" />}>
            <div className="customer-knowledge-grid">
              <div>
                <h3>ידוע</h3>
                {customer.facts.length === 0 ? <p className="owner-quiet-copy">עוד לא נאספו פרטים שימושיים.</p> : <dl className="owner-facts">{customer.facts.map((fact) => <div key={fact.id}><dt>{factLabel(fact.key)}</dt><dd dir="auto">{factValue(fact.value)}</dd></div>)}</dl>}
              </div>
              <div>
                <h3>מה חסר</h3>
                {customer.action?.missingInformation.length ? <ul className="owner-missing-list">{customer.action.missingInformation.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="owner-quiet-copy"><Check aria-hidden="true" /> אין כרגע מידע חסר שמונע התקדמות.</p>}
              </div>
            </div>
          </OwnerSection>

          <OwnerSection title="השיחה האחרונה" eyebrow="הקשר להחלטה" icon={<MessageCircleMore aria-hidden="true" />}>
            {customer.messages.length === 0 ? <div className="owner-empty owner-empty-compact"><MessageCircleMore aria-hidden="true" /><div><strong>עוד אין הודעות</strong><span>השיחה תופיע כאן כשיהיה הקשר מסחרי.</span></div></div> : (
              <div className="customer-conversation-context">
                {customer.messages.slice(-3).map((message) => <article key={message.id} className={`is-${message.side.toLowerCase()}`} dir="auto"><p>{message.body}</p><time dateTime={message.sentAt}>{formatProductDateTime(message.sentAt, business?.timeZone)}</time></article>)}
                <Link to={conversationUrl}>פתח את ההקשר המלא <ArrowLeft aria-hidden="true" /></Link>
              </div>
            )}
          </OwnerSection>

          <OwnerSection title="מה כבר קרה" eyebrow="היסטוריה עסקית" icon={<History aria-hidden="true" />}>
            {customer.activity.length === 0 ? <p className="owner-quiet-copy">אירועים משמעותיים יופיעו כאן.</p> : <ol className="owner-timeline">{[...customer.activity].reverse().map((activity) => <li key={activity.id}><span aria-hidden="true" /><div><strong>{activityLabel(activity.type)}</strong><time dateTime={activity.occurredAt}>{formatProductDateTime(activity.occurredAt, business?.timeZone)}</time></div></li>)}</ol>}
          </OwnerSection>
        </div>

        <aside className="customer-story-side">
          <section className={`customer-money-truth${(customer.remainingBalanceCents ?? 0) > 0 ? ' has-balance' : ''}`}>
            <p>כסף</p><h2>תשלום</h2>
            {customer.totalCents === null ? <div className="owner-empty owner-empty-compact"><Banknote aria-hidden="true" /><div><strong>עדיין אין סכום מאושר</strong><span>מחיר יופיע רק מאמת עסקית.</span></div></div> : <dl><div><dt>סה״כ</dt><dd><bdi dir="ltr">{formatProductMoney(customer.totalCents, currency)}</bdi></dd></div><div><dt>שולם</dt><dd><bdi dir="ltr">{formatProductMoney(customer.collectedCents, currency)}</bdi></dd></div><div className="is-balance"><dt>נותר</dt><dd><bdi dir="ltr">{formatProductMoney(customer.remainingBalanceCents ?? 0, currency)}</bdi></dd></div></dl>}
            {customer.refundCents > 0 ? <span>כולל החזרים בסך {formatProductMoney(customer.refundCents, currency)}</span> : null}
          </section>
          <section className="customer-communication">
            <p>הרשאות</p><h2>תקשורת</h2>
            <div><span>הודעות תפעוליות</span><strong>{customer.operationalAllowed ? 'מותרות' : 'חסומות'}</strong></div>
            <div><span>הודעות שיווקיות</span><strong>{customer.marketingAllowed ? 'מותרות' : 'חסומות'}</strong></div>
            {customer.marketingAllowed ? <button type="button" onClick={() => run(() => service.optOutMarketing(businessId, contactId), 'הודעות שיווקיות נחסמו.')}>חסום הודעות שיווקיות</button> : null}
          </section>
          <section className="customer-contact-truth">
            <p>פרטי קשר</p>
            <a href={`tel:${customer.phone}`}><Phone aria-hidden="true" /><bdi dir="ltr">{customer.phone}</bdi></a>
            {customer.email ? <a href={`mailto:${customer.email}`}><Mail aria-hidden="true" /><bdi dir="ltr">{customer.email}</bdi></a> : null}
          </section>
        </aside>
      </div>
    </section>
  );
}

function OwnerSection({ title, eyebrow, icon, children }: { title: string; eyebrow: string; icon: ReactNode; children: ReactNode }) {
  return <section className="customer-story-section"><header><span>{icon}</span><div><p>{eyebrow}</p><h2>{title}</h2></div></header>{children}</section>;
}

function JourneyProgress({ customer }: { customer: ProductCustomerView }) {
  const quoteJourney = customer.workflowType === WorkflowType.QuoteJob;
  const steps = quoteJourney
    ? ['פנייה', 'פרטים', 'הצעה', 'מקדמה', 'עבודה', 'יתרה', 'שולם']
    : ['פנייה', 'פרטים', 'תור', 'מקדמה', 'שירות', 'יתרה', 'שולם'];
  const current = journeyIndex(customer.stage);
  return (
    <section className="customer-journey" aria-labelledby="customer-journey-heading">
      <header><p>מכאן ועד תשלום</p><h2 id="customer-journey-heading">המסע הנוכחי</h2></header>
      <ol>{steps.map((step, index) => <li key={step} aria-current={index === current ? 'step' : undefined} className={index < current ? 'is-complete' : index === current ? 'is-current' : ''}><span>{index < current ? <Check aria-hidden="true" /> : index + 1}</span><strong>{step}</strong></li>)}</ol>
    </section>
  );
}

function journeyIndex(stage: ConversationStage): number {
  if (stage === ConversationStage.ClosedWon) return 6;
  if ([ConversationStage.AwaitingBalance, ConversationStage.ServiceComplete].includes(stage)) return 5;
  if ([ConversationStage.Booked, ConversationStage.JobScheduled].includes(stage)) return 4;
  if (stage === ConversationStage.AwaitingDeposit) return 3;
  if ([ConversationStage.ReadyToBook, ConversationStage.AppointmentProposed, ConversationStage.AwaitingConfirmation, ConversationStage.ReadyForQuote, ConversationStage.QuotePreparation, ConversationStage.QuoteSent].includes(stage)) return 2;
  if ([ConversationStage.Discovery, ConversationStage.Qualification, ConversationStage.InformationCollection, ConversationStage.HumanReview].includes(stage)) return 1;
  return 0;
}

function CurrentWork({ customer, currency, timeZone }: { customer: ProductCustomerView; currency: string; timeZone: string | undefined }) {
  if (customer.work.kind === 'APPOINTMENT' && customer.work.appointmentStatus) {
    return <div className="owner-work-summary"><span><CalendarClock aria-hidden="true" /></span><div><p>תור</p><strong>{appointmentStatusLabel(customer.work.appointmentStatus)}</strong>{customer.work.appointmentStartAt ? <time dateTime={customer.work.appointmentStartAt}>{formatProductDateTime(customer.work.appointmentStartAt, timeZone)}</time> : null}</div><Link to="/work">פתח ביומן <ArrowLeft aria-hidden="true" /></Link></div>;
  }
  if (customer.work.kind === 'QUOTE_JOB') {
    return <div className="owner-work-summary"><span><FileText aria-hidden="true" /></span><div><p>{customer.work.jobStatus ? 'עבודה' : 'הצעת מחיר'}</p><strong>{customer.work.jobStatus ? jobStatusLabel(customer.work.jobStatus) : customer.work.quoteStatus ? quoteStatusLabel(customer.work.quoteStatus) : 'בתהליך'}</strong>{customer.work.jobStartAt ? <time dateTime={customer.work.jobStartAt}>{formatProductDateTime(customer.work.jobStartAt, timeZone)}</time> : customer.work.quoteTotalCents !== null ? <bdi dir="ltr">{formatProductMoney(customer.work.quoteTotalCents, currency)}</bdi> : null}</div><Link to="/work">פתח עבודה <ArrowLeft aria-hidden="true" /></Link></div>;
  }
  return <div className="owner-empty owner-empty-compact"><Clock3 aria-hidden="true" /><div><strong>עוד לא נקבעה עבודה</strong><span>כשהפרטים יהיו מוכנים, התור או ההצעה יופיעו כאן.</span></div></div>;
}
