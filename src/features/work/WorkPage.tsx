import { ArrowLeft, CalendarDays, CheckCircle2, Clock3, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  appointmentStatusLabel,
  formatProductDateTime,
  formatProductMoney,
  jobStatusLabel,
} from '../../application/presentation/productCopy';
import type { ProductScheduleItemView } from '../../application/presentation/ProductReadService';
import { useCloser } from '../../state/closerState';

export function WorkPage() {
  const { businessId, service, state } = useCloser();
  const business = state.businesses.find((candidate) => candidate.id === businessId);
  const schedule = service.productSchedule(businessId);
  const timeZone = business?.timeZone ?? 'Asia/Jerusalem';
  const currency = business?.currency ?? 'ILS';
  const todayKey = dayKey(schedule.asOf, timeZone);
  const today = schedule.items.filter((item) => item.startsAt && dayKey(item.startsAt, timeZone) === todayKey);
  const upcoming = schedule.items.filter((item) => item.startsAt && item.startsAt > schedule.asOf && dayKey(item.startsAt, timeZone) !== todayKey);
  const recent = schedule.items.filter((item) => item.startsAt && item.startsAt <= schedule.asOf && dayKey(item.startsAt, timeZone) !== todayKey).reverse();
  const waiting = schedule.items.filter((item) => item.startsAt === null);

  return (
    <section className="owner-page work-page">
      <header className="owner-page-header">
        <div>
          <p className="owner-eyebrow"><CalendarDays aria-hidden="true" /> העבודה בפועל</p>
          <h1>יומן ועבודות</h1>
          <p>מה קורה היום, מה מגיע אחר כך, ומה עדיין צריך מועד.</p>
        </div>
        <div className="owner-page-signal">
          <strong><bdi dir="ltr">{today.length}</bdi></strong>
          <span>היום</span>
        </div>
      </header>

      <ScheduleSection title="היום" eyebrow="המחויבויות הקרובות" items={today} currency={currency} timeZone={timeZone} empty="אין תורים או עבודות להיום." />
      {waiting.length > 0 ? <ScheduleSection title="ממתינים לתיאום" eyebrow="מוכנים לשלב הבא" items={waiting} currency={currency} timeZone={timeZone} /> : null}
      {upcoming.length > 0 ? <ScheduleSection title="בהמשך" eyebrow="העבודה הבאה" items={upcoming} currency={currency} timeZone={timeZone} /> : null}
      {recent.length > 0 ? <ScheduleSection title="מה כבר קרה" eyebrow="עבודה אחרונה" items={recent.slice(0, 5)} currency={currency} timeZone={timeZone} quiet /> : null}
    </section>
  );
}

function ScheduleSection({
  title,
  eyebrow,
  items,
  currency,
  timeZone,
  empty,
  quiet = false,
}: {
  title: string;
  eyebrow: string;
  items: ProductScheduleItemView[];
  currency: string;
  timeZone: string;
  empty?: string;
  quiet?: boolean;
}) {
  return (
    <section className={`owner-operating-section${quiet ? ' is-quiet' : ''}`} aria-labelledby={`schedule-${title}`}>
      <header><div><p>{eyebrow}</p><h2 id={`schedule-${title}`}>{title}</h2></div><span>{items.length}</span></header>
      {items.length === 0 ? (
        <div className="owner-empty owner-empty-compact"><CheckCircle2 aria-hidden="true" /><div><strong>{empty}</strong><span>CLOSER יציג כאן כל התחייבות ברגע שתיקבע.</span></div></div>
      ) : (
        <ol className="owner-schedule-list">
          {items.map((item) => <ScheduleItem key={item.id} item={item} currency={currency} timeZone={timeZone} />)}
        </ol>
      )}
    </section>
  );
}

function ScheduleItem({ item, currency, timeZone }: { item: ProductScheduleItemView; currency: string; timeZone: string }) {
  const status = item.appointmentStatus
    ? appointmentStatusLabel(item.appointmentStatus)
    : item.jobStatus
      ? jobStatusLabel(item.jobStatus)
      : 'ממתין לתיאום';
  const paidDeposit = item.depositRequiredCents > 0 && item.collectedCents >= item.depositRequiredCents;
  return (
    <li>
      <article>
        <time dateTime={item.startsAt ?? undefined}>
          {item.startsAt ? <bdi dir="ltr">{formatProductDateTime(item.startsAt, timeZone)}</bdi> : <Clock3 aria-hidden="true" />}
        </time>
        <span className="owner-schedule-line" aria-hidden="true" />
        <div className="owner-schedule-copy">
          <h3>{item.customerName}</h3>
          <p>{item.serviceName}</p>
          <span>{status}</span>
        </div>
        <div className="owner-schedule-money">
          {paidDeposit ? <span><CheckCircle2 aria-hidden="true" /> מקדמה שולמה</span> : item.remainingBalanceCents > 0 ? <span><Sparkles aria-hidden="true" /> {formatProductMoney(item.remainingBalanceCents, currency)} נותרו</span> : <span>אין יתרה פתוחה</span>}
        </div>
        <Link to={`/customer/${item.contactId}`} aria-label={`פתח את ${item.customerName}`}><ArrowLeft aria-hidden="true" /></Link>
      </article>
    </li>
  );
}

function dayKey(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone }).format(new Date(value));
}
