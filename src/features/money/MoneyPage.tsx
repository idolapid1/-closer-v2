import { ArrowLeft, CheckCircle2, RotateCcw, WalletCards } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  conversationStageLabel,
  formatProductMoney,
} from '../../application/presentation/productCopy';
import type { ProductMoneyItemView } from '../../application/presentation/ProductReadService';
import { useCloser } from '../../state/closerState';

export function MoneyPage() {
  const { businessId, service, state } = useCloser();
  const business = state.businesses.find((candidate) => candidate.id === businessId);
  const money = service.productMoney(businessId);
  const currency = business?.currency ?? 'ILS';
  const waiting = money.items.filter((item) => item.collectionDueCents > 0);
  const settled = money.items.filter((item) => item.remainingBalanceCents === 0 && item.collectedCents > 0);

  return (
    <section className="owner-page money-page">
      <header className="money-hero">
        <div>
          <p className="owner-eyebrow"><WalletCards aria-hidden="true" /> כסף שמחכה</p>
          <h1><bdi dir="ltr">{formatProductMoney(money.waitingTotalCents, currency)}</bdi></h1>
          <p>יתרות מאומתות שמחכות לגבייה — לא הצעות ולא הבטחות תשלום.</p>
        </div>
        <div className="money-proof">
          <span>כבר נאסף בתהליכים האלה</span>
          <strong><bdi dir="ltr">{formatProductMoney(money.collectedTotalCents, currency)}</bdi></strong>
        </div>
      </header>

      <section className="owner-operating-section money-waiting" aria-labelledby="money-waiting-heading">
        <header><div><p>הפעולה עכשיו</p><h2 id="money-waiting-heading">ממתינים לגבייה</h2></div><span>{waiting.length}</span></header>
        {waiting.length === 0 ? (
          <div className="owner-empty owner-empty-compact"><CheckCircle2 aria-hidden="true" /><div><strong>אין יתרות פתוחות</strong><span>כל עבודה שהושלמה כרגע שולמה.</span></div></div>
        ) : <ol className="owner-money-list">{waiting.map((item) => <MoneyItem key={item.leadId} item={item} currency={currency} />)}</ol>}
      </section>

      {settled.length > 0 ? (
        <section className="owner-operating-section is-quiet" aria-labelledby="money-settled-heading">
          <header><div><p>אמת כספית</p><h2 id="money-settled-heading">שולם במלואו</h2></div><span>{settled.length}</span></header>
          <ol className="owner-money-list is-settled">{settled.slice(0, 5).map((item) => <MoneyItem key={item.leadId} item={item} currency={currency} />)}</ol>
        </section>
      ) : null}
    </section>
  );
}

function MoneyItem({ item, currency }: { item: ProductMoneyItemView; currency: string }) {
  return (
    <li>
      <article>
        <div className="owner-money-person"><h3>{item.customerName}</h3><p>{item.serviceName ?? conversationStageLabel(item.stage)}</p></div>
        <dl>
          <div><dt>סה״כ</dt><dd><bdi dir="ltr">{formatProductMoney(item.totalCents, currency)}</bdi></dd></div>
          <div><dt>שולם</dt><dd><bdi dir="ltr">{formatProductMoney(item.collectedCents, currency)}</bdi></dd></div>
          <div className="is-balance"><dt>לגבייה עכשיו</dt><dd><bdi dir="ltr">{formatProductMoney(item.collectionDueCents, currency)}</bdi></dd></div>
        </dl>
        {item.refundCents > 0 ? <span className="owner-refund"><RotateCcw aria-hidden="true" /> כולל החזר {formatProductMoney(item.refundCents, currency)}</span> : null}
        <Link to={`/customer/${item.contactId}`} aria-label={`פתח תשלום של ${item.customerName}`}>
          <span>{item.collectionDueCents > 0 ? 'בקש תשלום' : 'פתח לקוח'}</span><ArrowLeft aria-hidden="true" />
        </Link>
      </article>
    </li>
  );
}
