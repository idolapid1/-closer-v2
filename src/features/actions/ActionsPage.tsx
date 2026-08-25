import {
  ArrowLeft,
  Banknote,
  CalendarDays,
  CalendarPlus,
  Check,
  CircleAlert,
  Clock3,
  FileText,
  Image,
  MapPin,
  MessageCircle,
  Send,
  UserRound,
  WalletCards,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import liquidMetalHeading from '../../assets/closer-liquid-metal-heading.jpg';
import {
  formatActionAge,
  formatProductLongDate,
  formatProductMoney,
  formatProductTime,
  nextActionCta,
  nextActionDescription,
  nextActionTitle,
} from '../../application/presentation/productCopy';
import type {
  ProductActionView,
  ProductCommitmentView,
} from '../../application/presentation/ProductReadService';
import { MoltenMetal } from '../../components/visual/MoltenMetal';
import { MaskedHeading } from '../../components/visual/MaskedHeading';
import { NextActionType } from '../../domain/entities';
import { useCloser } from '../../state/closerState';

interface ActionVisual {
  label: string;
  Icon: LucideIcon;
  tone: 'human' | 'progress' | 'follow-up' | 'money' | 'information' | 'default';
}

function actionVisual(action: ProductActionView): ActionVisual {
  switch (action.actionType) {
    case NextActionType.HumanReview:
      return { label: 'AI מושהה', Icon: UserRound, tone: 'human' };
    case NextActionType.OfferAppointment:
    case NextActionType.ConfirmAppointment:
    case NextActionType.ScheduleJob:
      return { label: 'מוכנה להתקדם', Icon: CalendarPlus, tone: 'progress' };
    case NextActionType.PrepareQuote:
    case NextActionType.SendQuote:
      return { label: 'מוכנה להצעה', Icon: FileText, tone: 'progress' };
    case NextActionType.FollowUpQuote:
    case NextActionType.FollowUpCustomer:
    case NextActionType.FutureReactivation:
      return { label: 'נדרש מעקב', Icon: Send, tone: 'follow-up' };
    case NextActionType.CollectBalance:
    case NextActionType.RequestDeposit:
    case NextActionType.ReviewPaymentClaim:
      return { label: 'נדרשת גבייה', Icon: WalletCards, tone: 'money' };
    case NextActionType.RequestPhotos:
      return { label: 'חסרות תמונות', Icon: Image, tone: 'information' };
    case NextActionType.VerifyServiceArea:
      return { label: 'נדרשת בדיקה', Icon: MapPin, tone: 'information' };
    case NextActionType.CollectInformation:
      return { label: 'חסרים פרטים', Icon: MessageCircle, tone: 'information' };
    default:
      return { label: 'צריך פעולה', Icon: CircleAlert, tone: 'default' };
  }
}

function CommandActionCard({
  action,
  currency,
  priority,
  now,
}: {
  action: ProductActionView;
  currency: string;
  priority: boolean;
  now: string;
}) {
  const visual = actionVisual(action);
  const amount = action.amountCents === null
    ? null
    : formatProductMoney(action.amountCents, currency);

  return (
    <li className={`command-action-card tone-${visual.tone}${priority ? ' is-priority' : ''}`}>
      <article>
        <header className="command-action-status">
          <span className="command-action-signal" aria-hidden="true" />
          <visual.Icon aria-hidden="true" />
          <span>{visual.label}</span>
          <time dateTime={action.dueAt ?? action.createdAt}>
            {formatActionAge(action.dueAt ?? action.createdAt, now)}
          </time>
        </header>

        <div className="command-action-identity">
          <h3>{action.customerName}</h3>
          <p>{action.serviceName ?? 'שירות חדש'}</p>
        </div>

        <div className="command-action-why">
          <strong>{nextActionTitle(action.actionType, action.customerName, action.amountCents, currency)}</strong>
          <p>{nextActionDescription(action.actionType)}</p>
        </div>

        <dl className="command-action-data">
          {amount ? (
            <div>
              <dt>סכום</dt>
              <dd><bdi dir="ltr">{amount}</bdi></dd>
            </div>
          ) : null}
          {action.missingInformation.length > 0 ? (
            <div>
              <dt>חסר כדי להתקדם</dt>
              <dd>{action.missingInformation.length === 1 ? 'פרט אחד' : `${action.missingInformation.length} פרטים`}</dd>
            </div>
          ) : (
            <div>
              <dt>מצב</dt>
              <dd>{action.isHumanReview ? 'מחכה להחלטה שלך' : 'מוכן לפעולה'}</dd>
            </div>
          )}
        </dl>

        <Link
          className="command-action-cta"
          aria-label={`${nextActionCta(action.actionType)} עבור ${action.customerName}`}
          to={`/customer/${action.contactId}`}
        >
          <span>{nextActionCta(action.actionType)}</span>
          <ArrowLeft aria-hidden="true" />
        </Link>
      </article>
    </li>
  );
}

function TodayCommitment({
  commitment,
  timeZone,
}: {
  commitment: ProductCommitmentView;
  timeZone: string | undefined;
}) {
  return (
    <li className="command-commitment">
      <time dateTime={commitment.startsAt}>
        <bdi dir="ltr">{formatProductTime(commitment.startsAt, timeZone)}</bdi>
      </time>
      <span className="command-commitment-line" aria-hidden="true" />
      <div>
        <strong>{commitment.customerName}</strong>
        <span>{commitment.serviceName}</span>
      </div>
      <span className={`command-commitment-state${commitment.depositPaid ? ' is-paid' : ''}`}>
        {commitment.depositPaid ? <Check aria-hidden="true" /> : <Clock3 aria-hidden="true" />}
        {commitment.depositPaid ? 'מקדמה שולמה' : 'מתוכנן להיום'}
      </span>
      <Link
        to={`/customer/${commitment.contactId}`}
        aria-label={`פתח לקוח עבור ${commitment.customerName}`}
      >
        <ArrowLeft aria-hidden="true" />
      </Link>
    </li>
  );
}

export function ActionsPage() {
  const { state, businessId, service } = useCloser();
  const business = state.businesses.find((candidate) => candidate.id === businessId);
  const today = service.productToday(businessId);
  const currency = business?.currency ?? 'ILS';
  const ownerName = state.teamMembers.find(
    (candidate) => candidate.businessId === businessId && candidate.active,
  )?.name.split(' ')[0] ?? '';
  const ownerActionCount = today.attention.length + today.payments.length;
  const outstandingTotal = today.payments.reduce(
    (total, payment) => total + (payment.amountCents ?? 0),
    0,
  );

  return (
    <div className="command-center" dir="rtl">
      <div className="command-environment" aria-hidden="true">
        <MoltenMetal
          color1="#15102A"
          color2="#5227FF"
          color3="#B9C7FF"
          speed={0.2}
          scale={4.8}
          detail={3}
          glow={1.18}
          coreSize={0.075}
          blackPoint={0.09}
          brightness={1.1}
          opacity={0.68}
          mouseStrength={0.1}
        />
      </div>

      <section className="command-hero" aria-labelledby="command-center-title">
        <div className="command-hero-copy">
          <p className="command-kicker">
            <span className="command-live-dot" aria-hidden="true" />
            CLOSER פעיל
            <span aria-hidden="true">·</span>
            {ownerName ? `בוקר טוב, ${ownerName}` : 'בוקר טוב'}
          </p>
          <MaskedHeading
            id="command-center-title"
            text="CLOSER עובד. אתה רק מחליט."
            src={liquidMetalHeading}
            tag="h1"
            reveal="rise"
            trigger="mount"
            textScale={0.094}
            fillScale={1.15}
            parallax={8}
            drift={5}
            brightness={1.36}
            saturation={1.1}
          />
          <p className="command-hero-date">
            {formatProductLongDate(today.asOf, business?.timeZone)}
          </p>
        </div>

        <div className="command-operating-summary" role="status" aria-live="polite">
          <div className="command-orbit" aria-hidden="true">
            <span />
          </div>
          <p>כסף שנגבה ואומת</p>
          <strong><bdi dir="ltr">{formatProductMoney(today.revenue.validatedCollectedCents, currency)}</bdi></strong>
          <div className="command-attention-count">
            <bdi dir="ltr">{ownerActionCount}</bdi>
            <span>דברים צריכים החלטה שלך</span>
          </div>
          <small>
            <bdi dir="ltr">{formatProductMoney(today.revenue.openPipelineCents, currency)}</bdi>
            {' '}בערך פתוח ידוע · <bdi dir="ltr">{today.activeOpportunityCount}</bdi> פניות פעילות
          </small>
        </div>
      </section>

      <div className="command-content">
        <section className="command-attention" aria-labelledby="attention-heading">
          <header className="command-section-heading">
            <div>
              <p>החלטות וחריגים</p>
              <h2 id="attention-heading">צריך אותך עכשיו</h2>
            </div>
            <span><bdi dir="ltr">{today.attention.length}</bdi> פעולות</span>
          </header>

          {today.attention.length === 0 ? (
            <div className="command-empty">
              <Check aria-hidden="true" />
              <div>
                <strong>הכול מתקדם כרגע</strong>
                <p>CLOSER לא צריך ממך החלטה מיידית.</p>
              </div>
            </div>
          ) : (
            <ol className="command-action-grid">
              {today.attention.map((action, index) => (
                <CommandActionCard
                  key={action.id}
                  action={action}
                  currency={currency}
                  priority={index === 0}
                  now={today.asOf}
                />
              ))}
            </ol>
          )}
        </section>

        <div className="command-lower-grid">
          <section className="command-panel command-today" aria-labelledby="today-heading">
            <header className="command-panel-heading">
              <div className="command-panel-icon"><CalendarDays aria-hidden="true" /></div>
              <div>
                <p>העבודה היום</p>
                <h2 id="today-heading">היום</h2>
              </div>
              <span>{today.commitments.length} התחייבויות</span>
            </header>
            {today.commitments.length === 0 ? (
              <div className="command-panel-empty">אין תורים או עבודות מתוכננות להיום.</div>
            ) : (
              <ol className="command-commitment-list">
                {today.commitments.map((commitment) => (
                  <TodayCommitment
                    key={commitment.id}
                    commitment={commitment}
                    timeZone={business?.timeZone}
                  />
                ))}
              </ol>
            )}
          </section>

          <section className="command-panel command-money" aria-labelledby="money-heading">
            <header className="command-panel-heading">
              <div className="command-panel-icon"><Banknote aria-hidden="true" /></div>
              <div>
                <p>כסף שמחכה</p>
                <h2 id="money-heading">תשלומים</h2>
              </div>
            </header>
            <div className="command-money-total">
              <strong><bdi dir="ltr">{formatProductMoney(outstandingTotal, currency)}</bdi></strong>
              <span>מחכים לגבייה</span>
            </div>
            {today.payments.length === 0 ? (
              <div className="command-panel-empty">אין יתרות פתוחות שדורשות פעולה.</div>
            ) : (
              <ul className="command-money-list">
                {today.payments.slice(0, 3).map((payment) => (
                  <li key={payment.id}>
                    <div>
                      <strong>{payment.customerName}</strong>
                      <span>יתרה לאחר שירות</span>
                    </div>
                    <bdi dir="ltr">
                      {formatProductMoney(payment.amountCents ?? 0, currency)}
                    </bdi>
                    <Link
                      to={`/customer/${payment.contactId}`}
                      aria-label={`בקש תשלום עבור ${payment.customerName}`}
                    >
                      בקש תשלום
                      <ArrowLeft aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="command-panel command-revenue" aria-labelledby="revenue-heading">
            <header className="command-panel-heading">
              <div className="command-panel-icon"><Banknote aria-hidden="true" /></div>
              <div>
                <p>כסף, לא הבטחות</p>
                <h2 id="revenue-heading">תמונת הכנסות</h2>
              </div>
            </header>
            <dl className="command-revenue-strip">
              <div>
                <dt>נגבה ואומת</dt>
                <dd><bdi dir="ltr">{formatProductMoney(today.revenue.validatedCollectedCents, currency)}</bdi></dd>
              </div>
              <div>
                <dt>ערך פתוח ידוע</dt>
                <dd><bdi dir="ltr">{formatProductMoney(today.revenue.openPipelineCents, currency)}</bdi></dd>
              </div>
              <div>
                <dt>נסגרו ושולמו</dt>
                <dd><bdi dir="ltr">{today.revenue.wonOpportunityCount}</bdi></dd>
              </div>
            </dl>
            {today.revenue.attribution.status === 'AVAILABLE' ? (
              <p className="command-attribution-note is-verified">
                לפי אירועים שאומתו: CLOSER יצר{' '}
                <bdi dir="ltr">{formatProductMoney(today.revenue.attribution.generatedByCloserCents ?? 0, currency)}</bdi>
                {' '}והחזיר{' '}
                <bdi dir="ltr">{formatProductMoney(today.revenue.attribution.recoveredByCloserCents ?? 0, currency)}</bdi>.
              </p>
            ) : (
              <p className="command-attribution-note">
                שיוך הכנסה שנוצרה או הוחזרה על ידי CLOSER יוצג רק אחרי חיבור מקורות מאומתים.
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
