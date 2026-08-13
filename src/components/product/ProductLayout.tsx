import {
  CalendarDays,
  ChevronDown,
  CircleEllipsis,
  Clock3,
  Code2,
  FileText,
  Home,
  MessageCircleMore,
  UsersRound,
  Wrench,
} from 'lucide-react';
import { useEffect, useRef } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { productBusinessName } from '../../application/presentation/productCopy';
import { useCloser } from '../../state/closerState';

const primaryLinks = [
  { to: '/actions', label: 'היום', icon: Home },
  { to: '/inbox', label: 'פניות', icon: MessageCircleMore },
] as const;

const internalLinks = [
  { to: '/demo', label: 'לקוחות', icon: UsersRound },
  { to: '/appointments', label: 'תורים', icon: CalendarDays },
  { to: '/quotes', label: 'הצעות ועבודות', icon: FileText },
  { to: '/debug', label: 'כלי פיתוח', icon: Code2 },
] as const;

export function ProductLayout() {
  const { state, businessId, setBusinessId } = useCloser();
  const business = state.businesses.find((candidate) => candidate.id === businessId);
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const titles: Record<string, string> = {
      '/actions': 'היום',
      '/inbox': 'פניות',
    };
    const pageName = location.pathname.startsWith('/customer/')
      ? 'לקוח'
      : titles[location.pathname] ?? 'CLOSER';
    document.title = `${pageName} · CLOSER`;
    mainRef.current?.focus({ preventScroll: true });
  }, [location.pathname]);

  return (
    <div className="product-shell" dir="rtl">
      <a className="skip-link" href="#product-main">דלג לתוכן הראשי</a>
      <aside className="product-sidebar">
        <div className="product-brand" aria-label="CLOSER">
          <strong>CLOSER</strong>
        </div>
        <nav className="product-nav" aria-label="ניווט ראשי">
          {primaryLinks.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className="product-nav-link">
              <Icon aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="product-nav-divider" />
        <p className="product-nav-eyebrow">עוד</p>
        <nav className="product-nav product-nav-secondary" aria-label="כלים פנימיים">
          {internalLinks.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className="product-nav-link">
              <Icon aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="product-sidebar-footer">
          <Wrench aria-hidden="true" />
          <span>סביבת הדגמה</span>
        </div>
      </aside>

      <div className="product-workspace">
        <header className="product-topbar">
          <label className="product-business-switcher">
            <span className="sr-only">עסק לדוגמה</span>
            <select
              aria-label="עסק לדוגמה"
              value={businessId}
              onChange={(event) => setBusinessId(event.target.value)}
            >
              {state.businesses.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {productBusinessName(candidate.kind, candidate.id, candidate.name)}
                </option>
              ))}
            </select>
            <ChevronDown aria-hidden="true" />
          </label>
          <div className="product-topbar-meta">
            <Clock3 aria-hidden="true" />
            <span>סביבת עבודה מקומית</span>
            <span className="product-topbar-dot" aria-hidden="true" />
            <strong>{business ? productBusinessName(business.kind, business.id, business.name) : 'CLOSER'}</strong>
          </div>
        </header>
        <main ref={mainRef} id="product-main" className="product-main" tabIndex={-1}>
          <Outlet />
        </main>
      </div>

      <nav className="product-mobile-nav" aria-label="ניווט ראשי לנייד">
        {primaryLinks.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} className="product-mobile-nav-link">
            <Icon aria-hidden="true" />
            <span>{label}</span>
          </NavLink>
        ))}
        <NavLink to="/demo" className="product-mobile-nav-link">
          <CircleEllipsis aria-hidden="true" />
          <span>עוד</span>
        </NavLink>
      </nav>
    </div>
  );
}
