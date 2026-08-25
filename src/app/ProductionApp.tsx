import { useMemo, useState, type FormEvent } from 'react';
import { Navigate, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom';
import type { ClientRuntimeConfig } from '../config/runtimeConfig';
import { ProductionApiClient } from '../infrastructure/api/ProductionApiClient';
import { getSupabaseAuthClient } from '../infrastructure/auth/SupabaseAuthClient';
import { AuthProvider, useAuth } from '../state/AuthContext';
import { ProductionOwnerProvider, useProductionOwner } from '../state/ProductionOwnerContext';
import {
  ProductionCustomerPage,
  ProductionCustomersPage,
  ProductionInboxPage,
  ProductionMoneyPage,
  ProductionMorePage,
  ProductionTodayPage,
  ProductionWorkPage,
} from '../features/production/ProductionPages';
import { OwnerShell } from '../components/product/OwnerShell';

export function ProductionApp({ config }: { config: Extract<ClientRuntimeConfig, { mode: 'PRODUCTION' }> }) {
  const authClient = useMemo(
    () => getSupabaseAuthClient(config.supabaseUrl, config.supabasePublishableKey),
    [config.supabasePublishableKey, config.supabaseUrl],
  );
  const api = useMemo(
    () => new ProductionApiClient(config.apiUrl, authClient),
    [authClient, config.apiUrl],
  );
  return (
    <AuthProvider client={authClient}>
      <ProductionAuthGate api={api} />
    </AuthProvider>
  );
}

function ProductionAuthGate({ api }: { api: ProductionApiClient }) {
  const auth = useAuth();
  if (auth.status === 'loading') return <FullPageState title="CLOSER מתחבר…" detail="משחזרים חיבור מאובטח." />;
  if (auth.status !== 'authenticated') return <ProductionLoginPage />;
  return (
    <ProductionOwnerProvider api={api}>
      <ProductionRoutes />
    </ProductionOwnerProvider>
  );
}

function ProductionRoutes() {
  const owner = useProductionOwner();
  if (owner.loading && owner.tenants.length === 0) {
    return <FullPageState title="CLOSER טוען את העסק…" detail="המידע מגיע מהשרת המאומת." />;
  }
  return (
    <Routes>
      <Route path="accept-invite" element={<InvitationAcceptancePage />} />
      {owner.tenants.length === 0 ? (
        <Route path="*" element={<ProductionOnboardingPage />} />
      ) : (
        <Route element={<ProductionLayout />}>
          <Route index element={<Navigate to="/actions" replace />} />
          <Route path="actions" element={<ProductionTodayPage />} />
          <Route path="customers" element={<ProductionCustomersPage />} />
          <Route path="customer/:id" element={<ProductionCustomerPage />} />
          <Route path="inbox" element={<ProductionInboxPage />} />
          <Route path="work" element={<ProductionWorkPage />} />
          <Route path="money" element={<ProductionMoneyPage />} />
          <Route path="more" element={<ProductionMorePage />} />
          <Route path="*" element={<Navigate to="/actions" replace />} />
        </Route>
      )}
    </Routes>
  );
}

function ProductionLayout() {
  const owner = useProductionOwner();
  return (
    <OwnerShell
      businesses={owner.tenants.map((tenant) => ({ id: tenant.tenantId, name: tenant.tenantName }))}
      businessId={owner.activeTenantId}
      onBusinessChange={owner.selectTenant}
      switcherLabel="עסק פעיל"
      statusText="מחובר לנתוני הייצור"
    />
  );
}

function ProductionLoginPage() {
  const auth = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(auth.error);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      if (mode === 'signin') await auth.signIn(email, password);
      else {
        const confirmationRequired = await auth.signUp(email, password);
        if (confirmationRequired) setMessage('נשלח אימייל לאישור החשבון. לאחר האישור אפשר להתחבר.');
      }
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'ההתחברות לא הושלמה.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="production-auth" dir="rtl">
      <section className="production-auth-panel" aria-labelledby="auth-title">
        <strong className="product-brand">CLOSER</strong>
        <p>Revenue AI לעסק שלך</p>
        <h1 id="auth-title">{mode === 'signin' ? 'כניסה מאובטחת' : 'יצירת חשבון'}</h1>
        <form onSubmit={submit}>
          <label>אימייל<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label>סיסמה<input type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
          {message ? <p className="production-form-message" role="status">{message}</p> : null}
          <button type="submit" disabled={busy}>{busy ? 'מתבצע…' : mode === 'signin' ? 'כניסה' : 'יצירת חשבון'}</button>
        </form>
        <button className="production-text-action" type="button" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
          {mode === 'signin' ? 'אין חשבון? יצירת חשבון' : 'כבר יש חשבון? כניסה'}
        </button>
      </section>
    </main>
  );
}

function ProductionOnboardingPage() {
  const owner = useProductionOwner();
  const auth = useAuth();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(owner.error);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      await owner.provisionTenant(name);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'העסק לא נוצר.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="production-auth" dir="rtl">
      <section className="production-auth-panel" aria-labelledby="onboarding-title">
        <strong className="product-brand">CLOSER</strong>
        <p>{auth.session?.user.email}</p>
        <h1 id="onboarding-title">יצירת העסק הראשון</h1>
        <p>החשבון שלך יהיה הבעלים. כל גישה נוספת תדרוש חברות מאומתת.</p>
        <form onSubmit={submit}>
          <label>שם העסק<input value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={160} required /></label>
          {message ? <p className="production-form-message" role="alert">{message}</p> : null}
          <button type="submit" disabled={busy}>{busy ? 'יוצרים…' : 'צור עסק והמשך'}</button>
        </form>
        <button className="production-text-action" type="button" onClick={() => void auth.signOut()}>יציאה</button>
      </section>
    </main>
  );
}

function InvitationAcceptancePage() {
  const owner = useProductionOwner();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const accept = async () => {
    setState('busy');
    try {
      const accepted = await owner.api.acceptInvitation(token);
      await owner.refreshTenants(accepted.tenantId);
      setState('done');
      navigate('/actions', { replace: true });
    } catch (caught) {
      setState('error');
      setMessage(caught instanceof Error ? caught.message : 'ההזמנה לא התקבלה.');
    }
  };
  return (
    <main className="production-auth" dir="rtl">
      <section className="production-auth-panel">
        <strong className="product-brand">CLOSER</strong>
        <h1>הצטרפות לעסק</h1>
        {!token ? <p role="alert">קישור ההזמנה אינו תקין.</p> : <button type="button" disabled={state === 'busy' || state === 'done'} onClick={() => void accept()}>{state === 'busy' ? 'בודקים הרשאה…' : 'אישור הצטרפות'}</button>}
        {message ? <p className="production-form-message" role="alert">{message}</p> : null}
      </section>
    </main>
  );
}

function FullPageState({ title, detail }: { title: string; detail: string }) {
  return <main className="production-auth" dir="rtl"><section className="production-auth-panel" role="status"><strong className="product-brand">CLOSER</strong><h1>{title}</h1><p>{detail}</p></section></main>;
}
