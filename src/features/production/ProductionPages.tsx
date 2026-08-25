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
  Search,
  Sparkles,
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
} from '../../types/productionApi';
import { CustomerAvatar } from '../../components/product/ProductUi';

const money = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 });

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
          <div><span>נאסף בפועל</span><strong><bdi dir="ltr">{money.format(snapshot.revenue.collectedCents / 100)}</bdi></strong></div>
          <div><span>הוחזר</span><strong><bdi dir="ltr">{money.format(snapshot.revenue.refundedCents / 100)}</bdi></strong></div>
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
  const netCollected = workspace.payments.reduce((sum, payment) => sum + (payment.kind === 'REFUND' ? -payment.amountCents : payment.amountCents), 0);
  const refreshAll = async () => { await Promise.all([load(), owner.refresh()]); };
  return (
    <section className="owner-page customer-page production-owner-page">
      <Link className="owner-back-link" to="/customers"><ArrowRight aria-hidden="true" /> כל הלקוחות</Link>
      <header className="customer-owner-header">
        <div className="customer-owner-identity"><CustomerAvatar name={workspace.customer.displayName} size="large" /><div><p className="owner-eyebrow">מסע לקוח מאומת</p><h1>{workspace.customer.displayName}</h1><span>{workspace.lead?.workflowType === 'QUOTE_JOB' ? 'הצעה ועבודה' : 'תור ושירות'} · {stageLabel(workspace.conversation?.stage)}</span></div></div>
        {workspace.conversation ? <Link className="production-primary-action" to={`/inbox?conversation=${workspace.conversation.id}`}><MessageCircleMore aria-hidden="true" /> פתח שיחה</Link> : null}
      </header>
      <section className={`customer-command${workspace.activeHandoff ? ' is-human' : ''}`}>
        <div className="customer-command-state"><span>{workspace.activeHandoff ? <UserRoundCog aria-hidden="true" /> : <Sparkles aria-hidden="true" />}{workspace.activeHandoff ? 'השיחה בטיפול אנושי' : 'CLOSER יכול להמשיך'}</span><p>{workspace.activeHandoff ? 'האוטומציה מושהית עד חזרה מפורשת.' : 'המצב מגיע מהשיחה והפעולות השמורות בשרת.'}</p></div>
        <div className="customer-command-action"><span>מה קורה עכשיו</span><strong>{activeFollowUp(workspace.followUps)?.reason ?? (workspace.activeHandoff ? 'נדרשת החלטת בעל העסק' : 'אין מעקב פתוח')}</strong><p>{stageLabel(workspace.conversation?.stage)}</p></div>
      </section>
      <div className="production-workspace-grid">
        <section className="owner-operating-section"><header><div><p>אמת מסחרית</p><h2>מצב נוכחי</h2></div></header><dl className="production-detail-list"><div><dt>מקור</dt><dd>{workspace.lead?.source ?? '—'}</dd></div><div><dt>מסלול</dt><dd>{workspace.lead?.workflowType ?? '—'}</dd></div><div><dt>מצב שיחה</dt><dd>{workspace.conversation?.mode ?? '—'}</dd></div><div><dt>נאסף נטו</dt><dd><bdi dir="ltr">{money.format(netCollected / 100)}</bdi></dd></div></dl></section>
        <section className="owner-operating-section"><header><div><p>מעקב</p><h2>הפעולה הבאה</h2></div></header><FollowUpPanel workspace={workspace} canOperate={canOperate} onChanged={refreshAll} /></section>
      </div>
      {workspace.conversation ? <HandoffControls workspace={workspace} canOperate={canOperate} onChanged={refreshAll} /> : null}
    </section>
  );
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

export function ProductionWorkPage() {
  return <section className="owner-page production-owner-page"><header className="owner-page-header"><div><p className="owner-eyebrow"><CalendarClock aria-hidden="true" /> עבודה מתוכננת</p><h1>יומן ועבודות</h1><p>חיבור יומן חי נשאר כבוי עד לאישור connector מתאים.</p></div></header><div className="owner-empty owner-empty-compact"><CalendarClock aria-hidden="true" /><div><strong>אין תצוגת יומן מומצאת</strong><span>המסלול הייצורי שומר לקוחות, לידים, שיחות ומעקבים. יומן חי יופעל לאחר חיבור מאומת.</span></div></div></section>;
}

export function ProductionMoneyPage() {
  const owner = useProductionOwner();
  const revenue = owner.snapshot?.revenue;
  return <section className="owner-page money-page production-owner-page"><ProductionStatus /><header className="money-hero"><div><p className="owner-eyebrow"><Banknote aria-hidden="true" /> כסף מאומת</p><h1><bdi dir="ltr">{money.format((revenue?.collectedCents ?? 0) / 100)}</bdi></h1><p>הכנסה שנאספה בפועל לאחר החזרים. CLOSER לא מציג טענת לקוח כתשלום.</p></div><div className="money-proof"><span>החזרים מאומתים</span><strong><bdi dir="ltr">{money.format((revenue?.refundedCents ?? 0) / 100)}</bdi></strong></div></header><section className="owner-operating-section"><header><div><p>ספר הכנסות</p><h2>שלבים נפרדים</h2></div></header><dl className="production-money-grid"><div><dt>פוטנציאל</dt><dd>{money.format((revenue?.potentialCents ?? 0) / 100)}</dd></div><div><dt>בתהליך</dt><dd>{money.format((revenue?.pipelineCents ?? 0) / 100)}</dd></div><div><dt>הוזמן</dt><dd>{money.format((revenue?.bookedCents ?? 0) / 100)}</dd></div><div><dt>הוחזר לפעילות</dt><dd>{money.format((revenue?.recoveredCents ?? 0) / 100)}</dd></div></dl></section></section>;
}

export function ProductionMorePage() {
  const owner = useProductionOwner();
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const [message, setMessage] = useState('');
  const [inviteUrl, setInviteUrl] = useState('');
  const canInvite = owner.activeTenant?.role === 'owner' || owner.activeTenant?.role === 'admin';
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
  return <section className="owner-page production-owner-page"><header className="owner-page-header"><div><p className="owner-eyebrow"><Sparkles aria-hidden="true" /> העסק והגישה</p><h1>עוד</h1><p>חברות, הרשאות והפעלה — בלי כלי הנדסה במסלול הבעלים.</p></div></header><div className="production-settings-grid"><section className="owner-operating-section"><header><div><p>חשבון</p><h2>{owner.activeTenant?.tenantName}</h2></div></header><dl className="production-detail-list"><div><dt>משתמש</dt><dd><bdi dir="ltr">{auth.session?.user.email ?? auth.session?.user.id}</bdi></dd></div><div><dt>תפקיד</dt><dd>{roleLabel(owner.activeTenant?.role)}</dd></div></dl><button className="production-secondary-action" type="button" onClick={() => void auth.signOut()}><LogOut aria-hidden="true" /> יציאה</button></section><section className="owner-operating-section"><header><div><p>צוות</p><h2>הזמנת חבר/ת צוות</h2></div></header>{canInvite ? <form className="production-invite-form" onSubmit={invite}><label>אימייל<input type="email" dir="ltr" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label>תפקיד<select value={role} onChange={(event) => setRole(event.target.value as typeof role)}><option value="member">חבר/ת צוות</option><option value="admin">מנהל/ת</option></select></label><button type="submit">צור הזמנה</button>{message ? <p role="status">{message}</p> : null}{inviteUrl ? <label>קישור פיתוח בלבד<input dir="ltr" readOnly value={inviteUrl} /></label> : null}</form> : <p>רק בעלים או מנהל יכולים להזמין חברי צוות.</p>}</section></div></section>;
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
