import {
  ArrowLeft,
  ArrowRight,
  Banknote,
  CalendarClock,
  CheckCircle2,
  CircleUserRound,
  Clock3,
  LogOut,
  MessageCircleMore,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  Sparkles,
  Target,
  UserRoundCog,
  UsersRound,
} from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useProductionOwner } from '../../state/ProductionOwnerContext';
import type {
  ProductionConversationContract,
  ProductionCustomerContract,
  ProductionCustomerWorkspaceContract,
  ProductionFollowUpContract,
  ProductionOpportunityContract,
  ProductionOpportunityDetailContract,
  ProductionRecoveryState,
} from '../../types/productionApi';
import { CustomerAvatar } from '../../components/product/ProductUi';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export function ProductionRevenuePage() {
  const owner = useProductionOwner();
  const [commandCenter, setCommandCenter] = useState<Awaited<ReturnType<typeof owner.api.getRevenueCommandCenter>> | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void owner.api.getRevenueCommandCenter(owner.activeTenantId)
      .then((value) => { if (active) setCommandCenter(value); })
      .catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : 'Revenue data could not be loaded.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [owner.activeTenantId, owner.api]);
  if (loading) return <ProductionLoading label="מחשב הכנסה בסיכון…" />;
  if (!commandCenter) return <ProductionFailure message={error} />;
  const customers = new Map((owner.snapshot?.customers ?? []).map((customer) => [customer.id, customer]));
  return (
    <section className="owner-page production-owner-page revenue-command-center">
      <ProductionStatus />
      <header className="owner-page-header revenue-command-header">
        <div><p className="owner-eyebrow"><Target aria-hidden="true" /> Revenue Recovery OS</p><h1>הכנסה שאפשר להחזיר</h1><p>CLOSER מדרג רק הזדמנויות שמבוססות על נתוני העסק המאומתים.</p></div>
        <div className="revenue-command-total"><span>הכנסה בסיכון</span><strong><bdi dir="ltr">{usd.format(commandCenter.revenueAtRiskCents / 100)}</bdi></strong><small>{commandCenter.activeOpportunities} הזדמנויות פעילות</small></div>
      </header>
      <dl className="revenue-metric-strip" aria-label="מדדי recovery">
        <RevenueMetric label="הכנסה שהוחזרה" value={usd.format(commandCenter.actualRecoveredRevenueCents / 100)} />
        <RevenueMetric label="פוטנציאל בתהליך Recovery" value={usd.format(commandCenter.potentialRecoveredRevenueCents / 100)} />
        <RevenueMetric label="הכנסה מושפעת" value={usd.format(commandCenter.influencedRevenueCents / 100)} />
        <RevenueMetric label="הזמנות שהוחזרו" value={String(commandCenter.recoveredBookings)} />
        <RevenueMetric label="דורש אדם" value={String(commandCenter.humanInterventionRequired)} urgent={commandCenter.humanInterventionRequired > 0} />
      </dl>
      <section className="owner-operating-section revenue-risk-section" aria-labelledby="revenue-risk-title">
        <header><div><p>לפי ערך וסיכויי recovery</p><h2 id="revenue-risk-title">Revenue at risk</h2></div><Link to="/opportunities">כל ההזדמנויות <ArrowLeft aria-hidden="true" /></Link></header>
        {commandCenter.opportunitiesAtRisk.length === 0 ? (
          <div className="owner-empty owner-empty-compact"><CheckCircle2 aria-hidden="true" /><div><strong>אין כרגע הכנסה בסיכון</strong><span>הזדמנויות חדשות או estimates שלא נסגרו יופיעו כאן.</span></div></div>
        ) : (
          <ol className="revenue-risk-list">
            {commandCenter.opportunitiesAtRisk.map((opportunity, index) => {
              const customer = customers.get(opportunity.customerId);
              return (
                <li key={opportunity.id} className={opportunity.recoveryState === 'HUMAN_REQUIRED' ? 'is-human' : ''}>
                  <span className="revenue-risk-rank"><bdi dir="ltr">{String(index + 1).padStart(2, '0')}</bdi></span>
                  <div className="revenue-risk-value"><strong><bdi dir="ltr">{formatOpportunityMoney(opportunity)}</bdi></strong><small>{opportunityTypeLabel(opportunity.opportunityType)}</small></div>
                  <div className="revenue-risk-context"><strong>{customer?.displayName ?? 'לקוח HVAC'}</strong><span>{recoveryStateLabel(opportunity.recoveryState)}</span><small>{opportunity.scores.recovery.explanation}</small></div>
                  <div className="revenue-score"><span>Recovery</span><strong><bdi dir="ltr">{opportunity.scores.recovery.value}</bdi></strong></div>
                  <Link to={`/opportunity/${opportunity.id}`}>{opportunity.recoveryState === 'HUMAN_REQUIRED' ? 'בדיקה אישית' : 'פתח הזדמנות'} <ArrowLeft aria-hidden="true" /></Link>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </section>
  );
}

export function ProductionOpportunitiesPage() {
  const owner = useProductionOwner();
  const [opportunities, setOpportunities] = useState<ProductionOpportunityContract[]>([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'ALL' | ProductionOpportunityContract['status']>('ALL');
  const [recoveryState, setRecoveryState] = useState<'ALL' | ProductionRecoveryState>('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setLoading(true);
    void owner.api.listOpportunities(owner.activeTenantId)
      .then((value) => { if (active) setOpportunities(value); })
      .catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : 'ההזדמנויות לא נטענו.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [owner.activeTenantId, owner.api]);
  const customerMap = new Map((owner.snapshot?.customers ?? []).map((customer) => [customer.id, customer]));
  const visible = opportunities
    .filter((opportunity) => status === 'ALL' || opportunity.status === status)
    .filter((opportunity) => recoveryState === 'ALL' || opportunity.recoveryState === recoveryState)
    .filter((opportunity) => {
      const customer = customerMap.get(opportunity.customerId);
      const haystack = `${customer?.displayName ?? ''} ${opportunity.opportunityType} ${opportunity.source}`.toLowerCase();
      return haystack.includes(query.trim().toLowerCase());
    })
    .sort((left, right) => right.scores.recovery.value - left.scores.recovery.value || (right.estimatedValueCents ?? 0) - (left.estimatedValueCents ?? 0));
  return (
    <section className="owner-page production-owner-page">
      <ProductionStatus />
      <header className="owner-page-header"><div><p className="owner-eyebrow"><Target aria-hidden="true" /> Revenue opportunities</p><h1>הזדמנויות</h1><p>כל צורך מסחרי נשמר בנפרד, גם כשהלקוח חוזר לשירות נוסף.</p></div><div className="owner-page-signal"><strong><bdi dir="ltr">{opportunities.length}</bdi></strong><span>סה״כ</span></div></header>
      <div className="opportunity-filters" aria-label="סינון הזדמנויות">
        <label className="owner-search"><Search aria-hidden="true" /><span className="sr-only">חיפוש הזדמנויות</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="לקוח, שירות או מקור" /></label>
        <label><span>סטטוס</span><select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="ALL">הכול</option>{['NEW','CONTACTING','ENGAGED','QUALIFIED','BOOKED','ESTIMATE','WON','LOST','SNOOZED','DO_NOT_CONTACT'].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label><span>Recovery</span><select value={recoveryState} onChange={(event) => setRecoveryState(event.target.value as typeof recoveryState)}><option value="ALL">הכול</option>{['AT_RISK','RECOVERY_ACTIVE','WAITING_FOR_CUSTOMER','HUMAN_REQUIRED','RECOVERED','FAILED','STOPPED'].map((value) => <option key={value}>{value}</option>)}</select></label>
      </div>
      {loading ? <ProductionLoading label="טוענים הזדמנויות…" /> : error ? <ProductionFailure message={error} /> : visible.length === 0 ? <div className="owner-empty owner-empty-compact"><Target aria-hidden="true" /><div><strong>אין התאמות</strong><span>שנה את הסינון או צור הזדמנות חדשה דרך לקוח קיים.</span></div></div> : (
        <ol className="opportunity-list">
          {visible.map((opportunity) => {
            const customer = customerMap.get(opportunity.customerId);
            return <li key={opportunity.id} className={opportunity.recoveryState === 'HUMAN_REQUIRED' ? 'is-human' : ''}><div className="opportunity-list-person"><CustomerAvatar name={customer?.displayName ?? 'לקוח'} /><div><strong>{customer?.displayName ?? 'לקוח HVAC'}</strong><span>{opportunityTypeLabel(opportunity.opportunityType)} · {sourceLabel(opportunity.source)}</span></div></div><div><small>מצב</small><strong>{opportunityStatusLabel(opportunity.status)}</strong><span>{recoveryStateLabel(opportunity.recoveryState)}</span></div><div className="opportunity-list-score"><small>Recovery score</small><strong><bdi dir="ltr">{opportunity.scores.recovery.value}</bdi></strong></div><div className="opportunity-list-money"><small>ערך מוערך</small><strong><bdi dir="ltr">{formatOpportunityMoney(opportunity)}</bdi></strong></div><Link to={`/opportunity/${opportunity.id}`}>פתח <ArrowLeft aria-hidden="true" /></Link></li>;
          })}
        </ol>
      )}
    </section>
  );
}

export function ProductionOpportunityPage() {
  const { id = '' } = useParams();
  const owner = useProductionOwner();
  const [detail, setDetail] = useState<ProductionOpportunityDetailContract | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async () => {
    if (!owner.activeTenantId) return;
    setLoading(true);
    try { setDetail(await owner.api.getOpportunityDetail(owner.activeTenantId, id)); setMessage(''); }
    catch (caught) { setDetail(null); setMessage(caught instanceof Error ? caught.message : 'ההזדמנות לא נטענה.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [id, owner.activeTenantId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (loading) return <ProductionLoading label="טוענים הזדמנות…" />;
  if (!detail) return <section className="owner-page"><Link className="owner-back-link" to="/opportunities"><ArrowRight aria-hidden="true" /> כל ההזדמנויות</Link><ProductionFailure message={message} /></section>;
  const opportunity = detail.opportunity;
  const customer = detail.customer;
  const canOperate = owner.activeTenant?.role !== 'member';
  const canApprove = owner.activeTenant?.role === 'owner';
  const pendingAction = detail.recoveryActions.find((action) => action.status === 'WAITING_APPROVAL');
  const evaluate = async () => {
    setBusy(true);
    setMessage('');
    try { await owner.api.evaluateOpportunityRecovery(owner.activeTenantId, opportunity.id, `recovery:${crypto.randomUUID()}`); await load(); }
    catch (caught) { setMessage(caught instanceof Error ? caught.message : 'הערכת recovery לא הושלמה.'); }
    finally { setBusy(false); }
  };
  const approve = async () => {
    if (!pendingAction) return;
    setBusy(true);
    setMessage('');
    try {
      await owner.api.approveRecoveryAction(owner.activeTenantId, opportunity.id, pendingAction.id, `approve:${crypto.randomUUID()}`);
      await load();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'האישור לא נשמר.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="owner-page production-owner-page opportunity-detail-page">
      <Link className="owner-back-link" to="/opportunities"><ArrowRight aria-hidden="true" /> כל ההזדמנויות</Link>
      <header className="opportunity-detail-header"><div><p className="owner-eyebrow">{opportunityTypeLabel(opportunity.opportunityType)}</p><h1>{customer?.displayName ?? 'הזדמנות HVAC'}</h1><p>{opportunityStatusLabel(opportunity.status)} · {recoveryStateLabel(opportunity.recoveryState)}</p></div><div><strong><bdi dir="ltr">{formatOpportunityMoney(opportunity)}</bdi></strong><span>ערך מוערך</span></div></header>
      <section className={`opportunity-next-action${opportunity.recoveryState === 'HUMAN_REQUIRED' ? ' is-human' : ''}`}><div><span>{opportunity.recoveryState === 'HUMAN_REQUIRED' ? <ShieldAlert aria-hidden="true" /> : <RotateCcw aria-hidden="true" />}{opportunity.recoveryState === 'HUMAN_REQUIRED' ? 'נדרשת החלטה אנושית' : 'Next best action'}</span><strong>{detail.recoveryDecisions[0]?.nextBestAction.label ?? 'חשב את פעולת ה־recovery הבאה'}</strong><p>{pendingAction ? 'הפעולה מוכנה וממתינה לאישור בעל העסק. שליחה חיה כבויה.' : detail.recoveryDecisions[0]?.suppressionReason ? `Automation stopped: ${detail.recoveryDecisions[0].suppressionReason}` : 'החלטה מבוססת על אמת מסחרית, consent ומדיניות העסק.'}</p></div><div className="opportunity-action-buttons">{pendingAction ? <button type="button" className="production-primary-action" disabled={!canApprove || busy} onClick={() => void approve()}>{busy ? 'שומרים…' : canApprove ? 'אשר הכנה' : 'נדרשת הרשאת בעלים'}</button> : null}<button type="button" className="production-secondary-action" disabled={!canOperate || busy} onClick={() => void evaluate()}>{busy ? 'מחשב…' : canOperate ? 'חשב מחדש' : 'נדרשת הרשאת מנהל'}</button></div></section>
      {message ? <p className="production-status is-error" role="alert">{message}</p> : null}
      <dl className="opportunity-score-grid" aria-label="ציוני הזדמנות"><OpportunityScore label="כוונה" score={opportunity.scores.intent} /><OpportunityScore label="ערך" score={opportunity.scores.revenue} /><OpportunityScore label="Recovery" score={opportunity.scores.recovery} /><OpportunityScore label="דחיפות" score={opportunity.scores.urgency} /></dl>
      <div className="production-workspace-grid">
        <section className="owner-operating-section"><header><div><p>Observe → Score → Decide</p><h2>היסטוריית Recovery</h2></div></header>{detail.recoveryDecisions.length === 0 ? <p>עדיין לא התקבלה החלטת recovery.</p> : <ol className="opportunity-event-list">{detail.recoveryDecisions.map((decision) => { const action = detail.recoveryActions.find((item) => item.decisionId === decision.id); return <li key={decision.id}><span>{formatDateTime(decision.decidedAt)}</span><strong>{decision.nextBestAction.label}</strong><small>{decision.playType ?? decision.suppressionReason ?? 'POLICY_DECISION'} · {action?.status ?? decision.executionState} · {action?.deliveryState ?? 'ללא פעולה'}</small></li>; })}</ol>}</section>
        <section className="owner-operating-section"><header><div><p>Append-only ledger</p><h2>אירועי הכנסה</h2></div></header>{detail.revenueEvents.length === 0 ? <p>אין עדיין אירוע הכנסה שמקושר להזדמנות.</p> : <ol className="opportunity-event-list">{detail.revenueEvents.map((event) => <li key={event.id}><span>{formatDateTime(event.occurredAt)}</span><strong><bdi dir="ltr">{usd.format(event.amountCents / 100)}</bdi></strong><small>{event.eventType ?? event.stage} · {event.attributionType ?? 'לא יוחס'}</small></li>)}</ol>}</section>
      </div>
      <section className="owner-operating-section opportunity-linked-truth"><header><div><p>Server-backed commercial truth</p><h2>הקשרים מאומתים</h2></div></header><dl className="production-detail-list"><div><dt>לקוח</dt><dd>{customer.displayName}</dd></div><div><dt>מקור</dt><dd>{sourceLabel(opportunity.source)}</dd></div><div><dt>מדיניות פעולה</dt><dd><bdi dir="ltr">{opportunity.autonomyLevel}</bdi></dd></div><div><dt>פעילות לקוח אחרונה</dt><dd>{opportunity.lastCustomerActivityAt ? formatDateTime(opportunity.lastCustomerActivityAt) : 'אין פעילות מאומתת'}</dd></div><div><dt>פעולה מתוזמנת</dt><dd>{opportunity.nextActionAt ? formatDateTime(opportunity.nextActionAt) : 'אין פעולה מתוזמנת'}</dd></div><div><dt>נוצרה</dt><dd>{formatDateTime(opportunity.createdAt)}</dd></div><div><dt>שיחה</dt><dd>{detail.conversation ? `${detail.conversation.channel} · ${detail.conversation.mode}` : 'אין שיחה מקושרת'}</dd></div><div><dt>הזמנה</dt><dd>{detail.booking ? `${detail.booking.status} · ${usd.format(detail.booking.totalCents / 100)}` : 'אין הזמנה'}</dd></div><div><dt>Estimate / Job</dt><dd>{detail.estimate ? `${detail.estimate.status} · ${usd.format(detail.estimate.totalCents / 100)}` : detail.job ? `${detail.job.status} · ${usd.format(detail.job.totalCents / 100)}` : 'אין estimate או job'}</dd></div><div><dt>Human Takeover</dt><dd>{detail.activeHandoff ? `${detail.activeHandoff.reason} · פעיל` : 'לא פעיל'}</dd></div><div><dt>ייחוס</dt><dd>{opportunity.attributionType ? `${opportunity.attributionType} · ${opportunity.attributionReason ?? 'ללא נימוק'}` : 'טרם יוחס'}</dd></div></dl></section>
      <footer className="opportunity-detail-links">{customer ? <Link to={`/customer/${customer.id}`}>פתח לקוח <ArrowLeft aria-hidden="true" /></Link> : null}{opportunity.conversationId ? <Link to={`/inbox?conversation=${opportunity.conversationId}`}>פתח שיחה <ArrowLeft aria-hidden="true" /></Link> : null}</footer>
    </section>
  );
}

export function ProductionRecoveryPage() {
  const owner = useProductionOwner();
  const [opportunities, setOpportunities] = useState<ProductionOpportunityContract[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setError('');
    void owner.api.listOpportunities(owner.activeTenantId)
      .then((value) => { if (active) setOpportunities(value); })
      .catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : 'Recovery plays could not be loaded.'); });
    return () => { active = false; };
  }, [owner.activeTenantId, owner.api]);
  const counts = {
    missed: opportunities.filter((item) => item.source === 'MISSED_CALL' && !['WON','DO_NOT_CONTACT'].includes(item.status)).length,
    newLead: opportunities.filter((item) => ['NEW','CONTACTING','ENGAGED','QUALIFIED'].includes(item.status)).length,
    estimate: opportunities.filter((item) => item.status === 'ESTIMATE').length,
    old: opportunities.filter((item) => ['LOST','SNOOZED'].includes(item.status)).length,
  };
  return <section className="owner-page production-owner-page"><header className="owner-page-header"><div><p className="owner-eyebrow"><RotateCcw aria-hidden="true" /> Policy-bound recovery</p><h1>Recovery Plays</h1><p>ארבעה תהליכים ממוקדים — לא בונה אוטומציות כללי.</p></div></header>{error ? <ProductionFailure message={error} /> : <div className="recovery-play-grid"><RecoveryPlay title="Missed Call Recovery" count={counts.missed} description="חזרה מהירה לשיחה נכנסת שלא נענתה." /><RecoveryPlay title="New Lead Recovery" count={counts.newLead} description="ליד חדש שלא קיבל מענה אפקטיבי." /><RecoveryPlay title="Unsold Estimate Recovery" count={counts.estimate} description="Estimate פתוח עם הקשר, ערך ואובייקציות." /><RecoveryPlay title="Old Lead Reactivation" count={counts.old} description="חזרה מבוקרת ללידים ישנים שמותר ליצור איתם קשר." /></div>}<p className="recovery-safety-note"><ShieldAlert aria-hidden="true" /> Opt-out, Human Takeover, שעות קשר ו־idempotency גוברים תמיד על play פעיל. שליחה חיה עדיין כבויה.</p></section>;
}

export function ProductionTodayPage() {
  const owner = useProductionOwner();
  const snapshot = owner.snapshot;
  const actions = useMemo(() => {
    if (!snapshot) return [];
    const handoffs = snapshot.activeHandoffs.map((handoff) => ({
      key: `handoff:${handoff.id}`,
      kind: 'human' as const,
      conversationId: handoff.conversationId,
      customerId: snapshot.conversations.find((conversation) => conversation.id === handoff.conversationId)?.customerId ?? '',
      text: 'השיחה דורשת טיפול אנושי',
      dueAt: handoff.startedAt,
    }));
    const followUps = snapshot.followUps
      .filter((followUp) => ['scheduled', 'failed'].includes(followUp.status))
      .map((followUp) => ({
        key: `followup:${followUp.id}`,
        kind: 'followup' as const,
        conversationId: followUp.conversationId,
        customerId: followUp.customerId,
        text: followUp.reason,
        dueAt: followUp.retryAt ?? followUp.dueAt,
      }));
    return [...handoffs, ...followUps].sort((a, b) => a.kind === b.kind ? a.dueAt.localeCompare(b.dueAt) : a.kind === 'human' ? -1 : 1);
  }, [snapshot]);

  return (
    <section className="owner-page production-owner-page">
      <ProductionStatus />
      <header className="owner-page-header">
        <div><p className="owner-eyebrow"><Sparkles aria-hidden="true" /> CLOSER עובד</p><h1>מה צריך ממך עכשיו</h1><p>המידע נטען מהעסק המאומת — בלי נתוני דמו ובלי ניחוש.</p></div>
        <div className="owner-page-signal"><strong><bdi dir="ltr">{actions.length}</bdi></strong><span>פעולות פתוחות</span></div>
      </header>
      <section className="owner-operating-section" aria-labelledby="production-actions-title">
        <header><div><p>לפי דחיפות</p><h2 id="production-actions-title">דורש תשומת לב</h2></div></header>
        {!snapshot || actions.length === 0 ? (
          <div className="owner-empty owner-empty-compact"><CheckCircle2 aria-hidden="true" /><div><strong>אין פעולה פתוחה</strong><span>כשמעקב או טיפול אנושי ידרשו אותך, הם יופיעו כאן.</span></div></div>
        ) : (
          <ol className="production-action-list">
            {actions.map((action) => {
              const customer = snapshot.customers.find((candidate) => candidate.id === action.customerId);
              return (
                <li key={action.key} className={action.kind === 'human' ? 'is-human' : ''}>
                  <CustomerAvatar name={customer?.displayName ?? 'לקוח'} />
                  <div><strong>{customer?.displayName ?? 'לקוח'}</strong><span>{action.text}</span><small>{formatDateTime(action.dueAt)}</small></div>
                  <Link to={action.customerId ? `/customer/${action.customerId}` : `/inbox?conversation=${action.conversationId}`}>
                    {action.kind === 'human' ? 'פתח שיחה' : 'פתח לקוח'} <ArrowLeft aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
      </section>
      {snapshot ? (
        <section className="production-revenue-proof" aria-label="אמת כספית">
          <div><span>נאסף בפועל</span><strong><bdi dir="ltr">{usd.format(snapshot.revenue.collectedCents / 100)}</bdi></strong></div>
          <div><span>הוחזר</span><strong><bdi dir="ltr">{usd.format(snapshot.revenue.refundedCents / 100)}</bdi></strong></div>
          <p>הסכומים מגיעים מאירועי הכנסה מאומתים בלבד.</p>
        </section>
      ) : null}
    </section>
  );
}

export function ProductionCustomersPage() {
  const owner = useProductionOwner();
  const [query, setQuery] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const customers = (owner.snapshot?.customers ?? []).filter((customer) => (
    customer.displayName.toLowerCase().includes(query.trim().toLowerCase()) || customer.phone.includes(query.trim())
  ));
  return (
    <section className="owner-page production-owner-page">
      <ProductionStatus />
      <header className="owner-page-header">
        <div><p className="owner-eyebrow"><UsersRound aria-hidden="true" /> לקוחות והזדמנויות</p><h1>לקוחות</h1><p>כל לקוח כאן שייך לעסק הפעיל שאושר בשרת.</p></div>
        <button className="production-primary-action" type="button" onClick={() => setShowCreate((value) => !value)}><Plus aria-hidden="true" /> לקוח חדש</button>
      </header>
      {showCreate ? <CreateJourneyForm onDone={() => setShowCreate(false)} /> : null}
      <label className="owner-search"><Search aria-hidden="true" /><span className="sr-only">חיפוש לקוחות</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="שם או טלפון" /></label>
      {customers.length === 0 ? (
        <div className="owner-empty owner-empty-compact"><CircleUserRound aria-hidden="true" /><div><strong>אין לקוחות להצגה</strong><span>אפשר ליצור את מסע הלקוח הראשון דרך ה־API המאומת.</span></div></div>
      ) : (
        <ol className="owner-customer-list">
          {customers.map((customer) => <ProductionCustomerItem key={customer.id} customer={customer} />)}
        </ol>
      )}
    </section>
  );
}

function CreateJourneyForm({ onDone }: { onDone: () => void }) {
  const owner = useProductionOwner();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [workflowType, setWorkflowType] = useState<'APPOINTMENT_SERVICE' | 'QUOTE_JOB'>('APPOINTMENT_SERVICE');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const created = await owner.createJourney({
        idempotencyKey: `journey:${crypto.randomUUID()}`,
        customer: { displayName: name, phone, email: email || null },
        lead: { source: 'MANUAL', workflowType, serviceId: null },
        conversation: { channel: 'MANUAL' },
      });
      onDone();
      navigate(`/customer/${created.customerId}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'הלקוח לא נוצר.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="production-inline-form" onSubmit={submit} aria-label="יצירת לקוח והזדמנות">
      <label>שם<input value={name} onChange={(event) => setName(event.target.value)} required /></label>
      <label>טלפון<input value={phone} onChange={(event) => setPhone(event.target.value)} dir="ltr" required /></label>
      <label>אימייל<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} dir="ltr" /></label>
      <label>מסלול<select value={workflowType} onChange={(event) => setWorkflowType(event.target.value as typeof workflowType)}><option value="APPOINTMENT_SERVICE">תור ושירות</option><option value="QUOTE_JOB">הצעה ועבודה</option></select></label>
      {error ? <p role="alert">{error}</p> : null}
      <div><button type="submit" disabled={busy}>{busy ? 'יוצרים…' : 'צור מסע לקוח'}</button></div>
    </form>
  );
}

function ProductionCustomerItem({ customer }: { customer: ProductionCustomerContract }) {
  const owner = useProductionOwner();
  const conversation = owner.snapshot?.conversations.find((candidate) => candidate.customerId === customer.id);
  const followUp = owner.snapshot?.followUps.find((candidate) => candidate.customerId === customer.id && ['scheduled', 'failed'].includes(candidate.status));
  return (
    <li className={`owner-customer-item${conversation?.mode === 'HUMAN_ACTIVE' ? ' is-needs_owner' : ''}`}>
      <article>
        <div className="owner-customer-person"><CustomerAvatar name={customer.displayName} /><div><h2>{customer.displayName}</h2><p><bdi dir="ltr">{customer.phone}</bdi></p></div></div>
        <div className="owner-customer-state"><span>{conversation?.mode === 'HUMAN_ACTIVE' ? <UserRoundCog aria-hidden="true" /> : <Sparkles aria-hidden="true" />}{conversation?.mode === 'HUMAN_ACTIVE' ? 'טיפול אנושי' : stageLabel(conversation?.stage)}</span><strong>{followUp?.reason ?? 'המסע פעיל'}</strong></div>
        <span className="owner-customer-amount is-quiet">{conversation?.channel ?? 'ללא שיחה'}</span>
        <Link to={`/customer/${customer.id}`}>פתח <ArrowLeft aria-hidden="true" /></Link>
      </article>
    </li>
  );
}

export function ProductionCustomerPage() {
  const { id = '' } = useParams();
  const owner = useProductionOwner();
  const [workspace, setWorkspace] = useState<ProductionCustomerWorkspaceContract | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showOpportunityForm, setShowOpportunityForm] = useState(false);
  const [optingOut, setOptingOut] = useState(false);
  const load = async () => {
    if (!owner.activeTenantId) return;
    setLoading(true);
    setError('');
    try {
      setWorkspace(await owner.api.getCustomerWorkspace(owner.activeTenantId, id));
    } catch (caught) {
      setWorkspace(null);
      setError(caught instanceof Error ? caught.message : 'הלקוח לא נטען.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, [id, owner.activeTenantId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (loading) return <section className="owner-page"><div className="owner-empty owner-empty-compact" role="status">טוענים לקוח מהשרת…</div></section>;
  if (!workspace) return <section className="owner-page"><Link className="owner-back-link" to="/customers"><ArrowRight aria-hidden="true" /> כל הלקוחות</Link><div className="owner-empty owner-empty-compact" role="alert">{error || 'הלקוח לא נמצא בעסק הזה.'}</div></section>;
  const canOperate = owner.activeTenant?.role !== 'member';
  const opportunities = workspace.opportunities ?? [];
  const activeOpportunity = opportunities.find((opportunity) => !['WON', 'LOST', 'DO_NOT_CONTACT'].includes(opportunity.status))
    ?? opportunities[0] ?? null;
  const netCollected = workspace.payments.reduce((sum, payment) => sum + (payment.kind === 'REFUND' ? -payment.amountCents : payment.amountCents), 0);
  const refreshAll = async () => { await Promise.all([load(), owner.refresh()]); };
  const optOut = async () => {
    setOptingOut(true);
    setError('');
    try {
      await owner.api.recordCustomerOptOut(owner.activeTenantId, workspace.customer.id, `opt-out:${crypto.randomUUID()}`);
      await refreshAll();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'הפסקת התקשורת לא נשמרה.');
    } finally {
      setOptingOut(false);
    }
  };
  return (
    <section className="owner-page customer-page production-owner-page">
      <Link className="owner-back-link" to="/customers"><ArrowRight aria-hidden="true" /> כל הלקוחות</Link>
      <header className="customer-owner-header">
        <div className="customer-owner-identity"><CustomerAvatar name={workspace.customer.displayName} size="large" /><div><p className="owner-eyebrow">Customer revenue timeline</p><h1>{workspace.customer.displayName}</h1><span>{activeOpportunity ? opportunityTypeLabel(activeOpportunity.opportunityType) : 'אין הזדמנות פעילה'} · {activeOpportunity ? opportunityStatusLabel(activeOpportunity.status) : stageLabel(workspace.conversation?.stage)}</span></div></div>
        <div className="customer-header-actions"><button className="production-secondary-action" type="button" onClick={() => setShowOpportunityForm((value) => !value)}><Plus aria-hidden="true" /> הזדמנות חדשה</button>{workspace.conversation ? <Link className="production-primary-action" to={`/inbox?conversation=${workspace.conversation.id}`}><MessageCircleMore aria-hidden="true" /> פתח שיחה</Link> : null}</div>
      </header>
      {error ? <p className="production-status is-error" role="alert">{error}</p> : null}
      {showOpportunityForm ? <CreateOpportunityForm workspace={workspace} onDone={async () => { setShowOpportunityForm(false); await refreshAll(); }} /> : null}
      <section className={`customer-command${workspace.activeHandoff ? ' is-human' : ''}`}>
        <div className="customer-command-state"><span>{workspace.activeHandoff ? <UserRoundCog aria-hidden="true" /> : <Sparkles aria-hidden="true" />}{workspace.activeHandoff ? 'השיחה בטיפול אנושי' : 'CLOSER יכול להמשיך'}</span><p>{workspace.activeHandoff ? 'האוטומציה מושהית עד חזרה מפורשת.' : 'המצב מגיע מהשיחה והפעולות השמורות בשרת.'}</p></div>
        <div className="customer-command-action"><span>מה קורה עכשיו</span><strong>{activeFollowUp(workspace.followUps)?.reason ?? (workspace.activeHandoff ? 'נדרשת החלטת בעל העסק' : activeOpportunity ? recoveryStateLabel(activeOpportunity.recoveryState) : 'אין מעקב פתוח')}</strong><p>{activeOpportunity ? `${opportunityStatusLabel(activeOpportunity.status)} · ${formatOpportunityMoney(activeOpportunity)}` : stageLabel(workspace.conversation?.stage)}</p></div>
      </section>
      <section className="owner-operating-section customer-opportunities"><header><div><p>שירותים נפרדים לאורך זמן</p><h2>הזדמנויות</h2></div></header>{opportunities.length === 0 ? <p>אין עדיין הזדמנות מסחרית.</p> : <ol className="opportunity-list">{opportunities.map((opportunity) => <li key={opportunity.id}><div className="opportunity-list-person"><div><strong>{opportunityTypeLabel(opportunity.opportunityType)}</strong><span>{sourceLabel(opportunity.source)} · {opportunityStatusLabel(opportunity.status)}</span></div></div><div><small>Recovery</small><strong>{recoveryStateLabel(opportunity.recoveryState)}</strong></div><div className="opportunity-list-score"><small>Score</small><strong><bdi dir="ltr">{opportunity.scores.recovery.value}</bdi></strong></div><div className="opportunity-list-money"><small>ערך</small><strong><bdi dir="ltr">{formatOpportunityMoney(opportunity)}</bdi></strong></div><Link to={`/opportunity/${opportunity.id}`}>פתח <ArrowLeft aria-hidden="true" /></Link></li>)}</ol>}</section>
      <div className="production-workspace-grid">
        <section className="owner-operating-section"><header><div><p>אמת מסחרית</p><h2>מצב נוכחי</h2></div></header><dl className="production-detail-list"><div><dt>מקור</dt><dd>{workspace.lead?.source ?? '—'}</dd></div><div><dt>מסלול</dt><dd>{workspace.lead?.workflowType ?? '—'}</dd></div><div><dt>מצב שיחה</dt><dd>{workspace.conversation?.mode ?? '—'}</dd></div><div><dt>נאסף נטו</dt><dd><bdi dir="ltr">{usd.format(netCollected / 100)}</bdi></dd></div></dl></section>
        <section className="owner-operating-section"><header><div><p>מעקב</p><h2>הפעולה הבאה</h2></div></header><FollowUpPanel workspace={workspace} canOperate={canOperate} onChanged={refreshAll} /></section>
      </div>
      {activeOpportunity?.status !== 'DO_NOT_CONTACT' && canOperate ? <button type="button" className="production-quiet-danger" disabled={optingOut} onClick={() => void optOut()}>{optingOut ? 'שומרים…' : 'הפסק תקשורת לבקשת הלקוח'}</button> : activeOpportunity?.status === 'DO_NOT_CONTACT' ? <p className="production-status">הלקוח מסומן לאי־יצירת קשר. Recovery ומעקבים אוטומטיים הופסקו.</p> : null}
      {workspace.conversation ? <HandoffControls workspace={workspace} canOperate={canOperate} onChanged={refreshAll} /> : null}
    </section>
  );
}

function CreateOpportunityForm({
  workspace,
  onDone,
}: {
  workspace: ProductionCustomerWorkspaceContract;
  onDone: () => Promise<void>;
}) {
  const owner = useProductionOwner();
  const [type, setType] = useState<ProductionOpportunityContract['opportunityType']>('STANDARD_REPAIR');
  const [source, setSource] = useState<ProductionOpportunityContract['source']>('PHONE');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await owner.api.createOpportunity(owner.activeTenantId, workspace.customer.id, {
        idempotencyKey: `opportunity:${crypto.randomUUID()}`,
        source,
        workflowType: ['SYSTEM_REPLACEMENT', 'INSTALLATION', 'DUCT_WORK', 'COMMERCIAL_SERVICE'].includes(type)
          ? 'QUOTE_JOB'
          : 'APPOINTMENT_SERVICE',
        serviceId: null,
        opportunityType: type,
        estimatedValueCents: value ? Math.round(Number(value) * 100) : null,
        autonomyLevel: 'SUGGEST',
        channel: 'MANUAL',
      });
      await onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'ההזדמנות לא נוצרה.');
    } finally {
      setBusy(false);
    }
  };
  return <form className="production-inline-form opportunity-create-form" onSubmit={submit} aria-label="יצירת הזדמנות HVAC"><label>סוג שירות<select value={type} onChange={(event) => setType(event.target.value as typeof type)}>{['EMERGENCY_REPAIR','STANDARD_REPAIR','MAINTENANCE','TUNE_UP','SYSTEM_REPLACEMENT','INSTALLATION','INDOOR_AIR_QUALITY','DUCT_WORK','COMMERCIAL_SERVICE','OTHER'].map((item) => <option key={item} value={item}>{opportunityTypeLabel(item as typeof type)}</option>)}</select></label><label>מקור<select value={source} onChange={(event) => setSource(event.target.value as typeof source)}>{['MISSED_CALL','PHONE','WEBSITE_FORM','EMAIL','IMPORT','MANUAL'].map((item) => <option key={item} value={item}>{sourceLabel(item as typeof source)}</option>)}</select></label><label>ערך משוער בדולר<input type="number" min="0" step="1" dir="ltr" value={value} onChange={(event) => setValue(event.target.value)} placeholder="לא ידוע" /></label>{error ? <p role="alert">{error}</p> : null}<div><button type="submit" disabled={busy}>{busy ? 'יוצרים…' : 'צור הזדמנות'}</button></div></form>;
}

function FollowUpPanel({ workspace, canOperate, onChanged }: { workspace: ProductionCustomerWorkspaceContract; canOperate: boolean; onChanged: () => Promise<void> }) {
  const owner = useProductionOwner();
  const [reason, setReason] = useState('לחזור ללקוח ולהמשיך את התהליך');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const current = activeFollowUp(workspace.followUps);
  if (current) return <div className="production-current-followup"><Clock3 aria-hidden="true" /><div><strong>{current.reason}</strong><span>{formatDateTime(current.retryAt ?? current.dueAt)}</span><small>{current.status === 'failed' ? 'הניסיון האחרון נכשל; המעקב נשמר לניסיון חוזר.' : 'המעקב שמור בשרת.'}</small></div></div>;
  if (!workspace.conversation) return <p>אין שיחה שאפשר לקשר אליה מעקב.</p>;
  const schedule = async () => {
    setBusy(true);
    setMessage('');
    try {
      await owner.api.scheduleFollowUp(owner.activeTenantId, {
        idempotencyKey: `followup:${crypto.randomUUID()}`,
        conversationId: workspace.conversation!.id,
        customerId: workspace.customer.id,
        channel: normalizeFollowUpChannel(workspace.conversation!.channel),
        reason,
        dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        draftMessage: null,
      });
      await onChanged();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'המעקב לא נשמר.');
    } finally {
      setBusy(false);
    }
  };
  return <div className="production-followup-form"><label>סיבת המעקב<input value={reason} onChange={(event) => setReason(event.target.value)} /></label>{message ? <p role="alert">{message}</p> : null}<button type="button" disabled={!canOperate || busy} onClick={() => void schedule()}>{canOperate ? busy ? 'שומרים…' : 'קבע מעקב למחר' : 'נדרשת הרשאת מנהל'}</button></div>;
}

function HandoffControls({ workspace, canOperate, onChanged }: { workspace: ProductionCustomerWorkspaceContract; canOperate: boolean; onChanged: () => Promise<void> }) {
  const owner = useProductionOwner();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const execute = async () => {
    if (!workspace.conversation) return;
    setBusy(true);
    setMessage('');
    try {
      if (workspace.activeHandoff) {
        await owner.api.resumeAssistant(owner.activeTenantId, workspace.conversation.id, `resume:${crypto.randomUUID()}`);
      } else {
        await owner.api.startHumanTakeover(owner.activeTenantId, workspace.conversation.id, 'Owner took control', `handoff:${crypto.randomUUID()}`);
      }
      await onChanged();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'המצב לא השתנה.');
    } finally {
      setBusy(false);
    }
  };
  return <section className={`customer-handoff${workspace.activeHandoff ? '' : ' is-quiet'}`}><span className="customer-handoff-mark"><UserRoundCog aria-hidden="true" /></span><div><strong>{workspace.activeHandoff ? 'השליטה אצלך' : 'צריך שליטה אנושית?'}</strong><p>{workspace.activeHandoff ? 'CLOSER לא יבצע שליחה אוטומטית עד חזרה מפורשת.' : 'אפשר לעצור את האוטומציה ולנהל את השיחה ידנית.'}</p>{message ? <p role="alert">{message}</p> : null}</div><button type="button" disabled={!canOperate || busy} onClick={() => void execute()}>{workspace.activeHandoff ? 'החזר את CLOSER' : 'אני מטפל/ת בשיחה'}</button></section>;
}

export function ProductionInboxPage() {
  const owner = useProductionOwner();
  const [searchParams, setSearchParams] = useSearchParams();
  const conversations = owner.snapshot?.conversations ?? [];
  const requested = searchParams.get('conversation');
  const selected = conversations.find((conversation) => conversation.id === requested) ?? conversations[0] ?? null;
  useEffect(() => {
    if (!requested && selected) setSearchParams({ conversation: selected.id }, { replace: true });
  }, [requested, selected, setSearchParams]);
  return (
    <section className="owner-page production-owner-page">
      <ProductionStatus />
      <header className="owner-page-header"><div><p className="owner-eyebrow"><MessageCircleMore aria-hidden="true" /> שיחות בהקשר עסקי</p><h1>שיחות</h1><p>השיחה מוצגת כחלק ממסע הלקוח, לא כאפליקציית הודעות נפרדת.</p></div></header>
      {conversations.length === 0 ? <div className="owner-empty owner-empty-compact"><MessageCircleMore aria-hidden="true" /><div><strong>אין עדיין שיחות</strong><span>יצירת מסע לקוח תיצור שיחה שמורה בשרת.</span></div></div> : (
        <div className="production-inbox">
          <ol className="production-conversation-list">{conversations.map((conversation) => {
            const customer = owner.snapshot?.customers.find((candidate) => candidate.id === conversation.customerId);
            return <li key={conversation.id}><button type="button" aria-pressed={selected?.id === conversation.id} onClick={() => setSearchParams({ conversation: conversation.id })}><CustomerAvatar name={customer?.displayName ?? 'לקוח'} /><span><strong>{customer?.displayName ?? 'לקוח'}</strong><small>{stageLabel(conversation.stage)} · {conversation.channel}</small></span>{conversation.mode === 'HUMAN_ACTIVE' ? <UserRoundCog aria-label="טיפול אנושי" /> : null}</button></li>;
          })}</ol>
          {selected ? <ProductionConversationContext conversation={selected} /> : null}
        </div>
      )}
    </section>
  );
}

function ProductionConversationContext({ conversation }: { conversation: ProductionConversationContract }) {
  const owner = useProductionOwner();
  const customer = owner.snapshot?.customers.find((candidate) => candidate.id === conversation.customerId);
  const followUp = owner.snapshot?.followUps.find((candidate) => candidate.conversationId === conversation.id && ['scheduled', 'failed'].includes(candidate.status));
  return <article className="production-conversation-context"><header><div><CustomerAvatar name={customer?.displayName ?? 'לקוח'} size="large" /><div><h2>{customer?.displayName ?? 'לקוח'}</h2><p>{stageLabel(conversation.stage)} · {conversation.mode === 'HUMAN_ACTIVE' ? 'בטיפול אנושי' : 'CLOSER פעיל'}</p></div></div>{customer ? <Link to={`/customer/${customer.id}`}>פתח מסע לקוח <ArrowLeft aria-hidden="true" /></Link> : null}</header><section><p className="owner-eyebrow">למה השיחה חשובה עכשיו</p><h3>{followUp?.reason ?? (conversation.mode === 'HUMAN_ACTIVE' ? 'נדרשת תשובת בעל העסק' : 'אין פעולה פתוחה בשיחה')}</h3><p>תוכן הודעות יגיע דרך connector מאומת. בשלב זה לא מוצגת היסטוריה מומצאת.</p></section><footer><span>ערוץ: {conversation.channel}</span><span>עודכן: {formatDateTime(conversation.updatedAt)}</span></footer></article>;
}

export function ProductionWorkPage({ mode = 'bookings' }: { mode?: 'bookings' | 'jobs' }) {
  const bookings = mode === 'bookings';
  return <section className="owner-page production-owner-page"><header className="owner-page-header"><div><p className="owner-eyebrow"><CalendarClock aria-hidden="true" /> {bookings ? 'Recovery to booking' : 'Booking to revenue'}</p><h1>{bookings ? 'הזמנות' : 'עבודות'}</h1><p>{bookings ? 'הזמנה מאומתת נוצרת רק לאחר אישור זמינות בשרת.' : 'עבודה תוצג כאן רק לאחר יצירה מתוך הזדמנות והצעה תקפות.'}</p></div></header><div className="owner-empty owner-empty-compact"><CalendarClock aria-hidden="true" /><div><strong>{bookings ? 'אין כרגע הזמנות להצגה' : 'אין כרגע עבודות להצגה'}</strong><span>חיבור יומן חי נשאר כבוי עד לאישור connector. CLOSER אינו ממציא זמינות או עבודות.</span></div></div></section>;
}

export function ProductionMoneyPage() {
  const owner = useProductionOwner();
  const revenue = owner.snapshot?.revenue;
  return <section className="owner-page money-page production-owner-page"><ProductionStatus /><header className="money-hero"><div><p className="owner-eyebrow"><Banknote aria-hidden="true" /> כסף מאומת</p><h1><bdi dir="ltr">{usd.format((revenue?.collectedCents ?? 0) / 100)}</bdi></h1><p>הכנסה שנאספה בפועל לאחר החזרים. CLOSER לא מציג טענת לקוח כתשלום.</p></div><div className="money-proof"><span>החזרים מאומתים</span><strong><bdi dir="ltr">{usd.format((revenue?.refundedCents ?? 0) / 100)}</bdi></strong></div></header><section className="owner-operating-section"><header><div><p>ספר הכנסות</p><h2>שלבים נפרדים</h2></div></header><dl className="production-money-grid"><div><dt>פוטנציאל</dt><dd>{usd.format((revenue?.potentialCents ?? 0) / 100)}</dd></div><div><dt>בתהליך</dt><dd>{usd.format((revenue?.pipelineCents ?? 0) / 100)}</dd></div><div><dt>הוזמן</dt><dd>{usd.format((revenue?.bookedCents ?? 0) / 100)}</dd></div><div><dt>הוחזר לפעילות</dt><dd>{usd.format((revenue?.recoveredCents ?? 0) / 100)}</dd></div></dl></section></section>;
}

export function ProductionMorePage({ section = 'settings' }: { section?: 'settings' | 'connections' }) {
  const owner = useProductionOwner();
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const [message, setMessage] = useState('');
  const [inviteUrl, setInviteUrl] = useState('');
  const canInvite = owner.activeTenant?.role === 'owner' || owner.activeTenant?.role === 'admin';
  const [connectors, setConnectors] = useState<Awaited<ReturnType<typeof owner.api.listConnectorConfigurations>>>([]);
  const [connectorMessage, setConnectorMessage] = useState('');
  useEffect(() => {
    if (section !== 'connections' || !owner.activeTenantId || !canInvite) return;
    void owner.api.listConnectorConfigurations(owner.activeTenantId)
      .then(setConnectors)
      .catch((caught: unknown) => setConnectorMessage(caught instanceof Error ? caught.message : 'החיבורים לא נטענו.'));
  }, [canInvite, owner.activeTenantId, owner.api, section]);
  const invite = async (event: FormEvent) => {
    event.preventDefault();
    setMessage('');
    setInviteUrl('');
    try {
      const result = await owner.api.createInvitation(owner.activeTenantId, { email, role, idempotencyKey: `invite:${crypto.randomUUID()}` });
      setMessage(`ההזמנה עבור ${result.invitation.email} נוצרה ותפוג ב־${formatDateTime(result.invitation.expiresAt)}.`);
      setInviteUrl(result.developmentAcceptanceUrl ?? '');
      setEmail('');
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'ההזמנה לא נוצרה.');
    }
  };
  if (section === 'connections') {
    return <section className="owner-page production-owner-page"><header className="owner-page-header"><div><p className="owner-eyebrow"><Sparkles aria-hidden="true" /> Server-only connectors</p><h1>חיבורים</h1><p>פרטי גישה נשארים בשרת. שליחה חיה אינה מופעלת בלי configuration תקף ואישור נפרד.</p></div></header>{!canInvite ? <ProductionFailure message="רק בעלים או מנהל יכולים לצפות בהגדרות חיבור." /> : connectorMessage ? <ProductionFailure message={connectorMessage} /> : connectors.length === 0 ? <div className="owner-empty owner-empty-compact"><Sparkles aria-hidden="true" /><div><strong>אין חיבורים מוגדרים</strong><span>המערכת נשארת במצב NOT_CONFIGURED ואינה שולחת דבר.</span></div></div> : <ol className="connection-list">{connectors.map((connector) => <li key={connector.id}><div><strong><bdi dir="ltr">{connector.provider}</bdi></strong><span>{connector.enabled ? 'מוגדר' : 'כבוי'} · {connector.mode}</span></div><span className={connector.enabled ? 'is-ready' : ''}>{connector.secretConfigured ? 'Secret בשרת' : 'NOT_CONFIGURED'}</span></li>)}</ol>}</section>;
  }
  return <section className="owner-page production-owner-page"><header className="owner-page-header"><div><p className="owner-eyebrow"><Sparkles aria-hidden="true" /> העסק והגישה</p><h1>הגדרות</h1><p>חברות, הרשאות והפעלה — בלי כלי הנדסה במסלול הבעלים.</p></div></header><div className="production-settings-grid"><section className="owner-operating-section"><header><div><p>חשבון</p><h2>{owner.activeTenant?.tenantName}</h2></div></header><dl className="production-detail-list"><div><dt>משתמש</dt><dd><bdi dir="ltr">{auth.session?.user.email ?? auth.session?.user.id}</bdi></dd></div><div><dt>תפקיד</dt><dd>{roleLabel(owner.activeTenant?.role)}</dd></div></dl><button className="production-secondary-action" type="button" onClick={() => void auth.signOut()}><LogOut aria-hidden="true" /> יציאה</button></section><section className="owner-operating-section"><header><div><p>צוות</p><h2>הזמנת חבר/ת צוות</h2></div></header>{canInvite ? <form className="production-invite-form" onSubmit={invite}><label>אימייל<input type="email" dir="ltr" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label>תפקיד<select value={role} onChange={(event) => setRole(event.target.value as typeof role)}><option value="member">חבר/ת צוות</option><option value="admin">מנהל/ת</option></select></label><button type="submit">צור הזמנה</button>{message ? <p role="status">{message}</p> : null}{inviteUrl ? <label>קישור פיתוח בלבד<input dir="ltr" readOnly value={inviteUrl} /></label> : null}</form> : <p>רק בעלים או מנהל יכולים להזמין חברי צוות.</p>}</section></div></section>;
}

function ProductionStatus() {
  const owner = useProductionOwner();
  if (owner.loading) return <div className="production-status" role="status"><RefreshCw aria-hidden="true" /> מרעננים נתוני ייצור…</div>;
  if (!owner.error) return null;
  return <div className="production-status is-error" role="alert"><span>{owner.error}</span><button type="button" onClick={() => void (owner.errorKind === 'FORBIDDEN' ? owner.refreshTenants() : owner.refresh())}>נסה שוב</button></div>;
}

function activeFollowUp(followUps: ProductionFollowUpContract[]): ProductionFollowUpContract | undefined {
  return followUps.find((followUp) => ['scheduled', 'leased', 'failed'].includes(followUp.status));
}

function normalizeFollowUpChannel(channel: string): 'WHATSAPP' | 'INSTAGRAM' | 'EMAIL' | 'MANUAL' {
  return ['WHATSAPP', 'INSTAGRAM', 'EMAIL', 'MANUAL'].includes(channel)
    ? channel as 'WHATSAPP' | 'INSTAGRAM' | 'EMAIL' | 'MANUAL'
    : 'MANUAL';
}

function stageLabel(stage: string | undefined): string {
  const labels: Record<string, string> = {
    NEW_INQUIRY: 'פנייה חדשה',
    DISCOVERY: 'בירור צרכים',
    INFORMATION_COLLECTION: 'איסוף פרטים',
    READY_TO_BOOK: 'מוכן לקביעת תור',
    READY_FOR_QUOTE: 'מוכן להצעת מחיר',
    BOOKED: 'נקבע',
    HUMAN_REVIEW: 'טיפול אנושי',
    CLOSED_WON: 'נסגר בהצלחה',
    CLOSED_LOST: 'נסגר',
  };
  return stage ? labels[stage] ?? 'בתהליך' : 'טרם התחיל';
}

function roleLabel(role: string | undefined): string {
  return role === 'owner' ? 'בעלים' : role === 'admin' ? 'מנהל/ת' : 'חבר/ת צוות';
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('he-IL', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

function RevenueMetric({ label, value, urgent = false }: { label: string; value: string; urgent?: boolean }) {
  return <div className={urgent ? 'is-urgent' : ''}><dt>{label}</dt><dd><bdi dir="ltr">{value}</bdi></dd></div>;
}

function OpportunityScore({
  label,
  score,
}: {
  label: string;
  score: ProductionOpportunityContract['scores']['intent'];
}) {
  return <div><dt>{label}</dt><dd><strong><bdi dir="ltr">{score.value}</bdi></strong><progress max="100" value={score.value} aria-label={`${label}: ${score.value} מתוך 100`} /><small>{score.explanation}</small></dd></div>;
}

function RecoveryPlay({ title, count, description }: { title: string; count: number; description: string }) {
  return <article><span><RotateCcw aria-hidden="true" /></span><div><h2><bdi dir="ltr">{title}</bdi></h2><p>{description}</p></div><strong><bdi dir="ltr">{count}</bdi><small> eligible now</small></strong></article>;
}

function ProductionLoading({ label }: { label: string }) {
  return <section className="owner-page"><div className="owner-empty owner-empty-compact" role="status"><RefreshCw aria-hidden="true" /><div><strong>{label}</strong><span>המידע מגיע מהשרת המאומת.</span></div></div></section>;
}

function ProductionFailure({ message }: { message: string }) {
  return <div className="owner-empty owner-empty-compact production-failure" role="alert"><ShieldAlert aria-hidden="true" /><div><strong>לא הצלחנו להשלים את הפעולה</strong><span>{message}</span></div></div>;
}

function formatOpportunityMoney(opportunity: ProductionOpportunityContract): string {
  if (opportunity.estimatedValueCents === null) return 'Value unknown';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: opportunity.currency,
      maximumFractionDigits: 0,
    }).format(opportunity.estimatedValueCents / 100);
  } catch {
    return `${opportunity.estimatedValueCents / 100} ${opportunity.currency}`;
  }
}

function opportunityTypeLabel(type: ProductionOpportunityContract['opportunityType']): string {
  const labels: Record<ProductionOpportunityContract['opportunityType'], string> = {
    EMERGENCY_REPAIR: 'תיקון חירום',
    STANDARD_REPAIR: 'תיקון HVAC',
    MAINTENANCE: 'תחזוקה',
    TUNE_UP: 'Tune-up',
    SYSTEM_REPLACEMENT: 'החלפת מערכת',
    INSTALLATION: 'התקנה',
    INDOOR_AIR_QUALITY: 'איכות אוויר',
    DUCT_WORK: 'תעלות אוויר',
    COMMERCIAL_SERVICE: 'שירות מסחרי',
    OTHER: 'שירות HVAC',
  };
  return labels[type];
}

function opportunityStatusLabel(status: ProductionOpportunityContract['status']): string {
  const labels: Record<ProductionOpportunityContract['status'], string> = {
    NEW: 'חדש', CONTACTING: 'יוצרים קשר', ENGAGED: 'בשיחה', QUALIFIED: 'מוכן להתקדם',
    BOOKED: 'הוזמן', ESTIMATE: 'Estimate פתוח', WON: 'נסגר בהצלחה', LOST: 'אבד',
    SNOOZED: 'מושהה', DO_NOT_CONTACT: 'אין ליצור קשר',
  };
  return labels[status];
}

function recoveryStateLabel(state: ProductionRecoveryState): string {
  const labels: Record<ProductionRecoveryState, string> = {
    NOT_AT_RISK: 'לא בסיכון', AT_RISK: 'בסיכון', RECOVERY_ACTIVE: 'CLOSER עובד',
    WAITING_FOR_CUSTOMER: 'ממתין ללקוח', HUMAN_REQUIRED: 'נדרש טיפול אנושי',
    RECOVERED: 'הוחזר', FAILED: 'Recovery נכשל', STOPPED: 'Recovery נעצר',
  };
  return labels[state];
}

function sourceLabel(source: ProductionOpportunityContract['source']): string {
  const labels: Partial<Record<ProductionOpportunityContract['source'], string>> = {
    MISSED_CALL: 'שיחה שלא נענתה', PHONE: 'טלפון', WEBSITE_FORM: 'טופס אתר',
    WHATSAPP: 'WhatsApp', INSTAGRAM: 'Instagram', EMAIL: 'Email', IMPORT: 'ייבוא', MANUAL: 'ידני',
  };
  return labels[source] ?? 'מקור אחר';
}
