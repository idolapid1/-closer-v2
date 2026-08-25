import {
  Banknote,
  BriefcaseBusiness,
  CalendarDays,
  ChevronDown,
  CircleEllipsis,
  Home,
  Sparkles,
  UsersRound,
} from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { productBusinessName } from '../../application/presentation/productCopy';
import { useCloser } from '../../state/closerState';

const primaryLinks = [
  { to: '/actions', label: 'היום', icon: Home },
  { to: '/customers', label: 'לקוחות', icon: UsersRound },
  { to: '/work', label: 'יומן ועבודות', icon: CalendarDays },
  { to: '/money', label: 'כסף', icon: Banknote },
  { to: '/more', label: 'עוד', icon: CircleEllipsis },
] as const;

export function ProductLayout() {
  const { state, businessId, setBusinessId } = useCloser();
  const business = state.businesses.find((candidate) => candidate.id === businessId);
  const location = useLocation();
  const navigate = useNavigate();
  const mainRef = useRef<HTMLElement>(null);
  const isCommandCenter = location.pathname === '/actions';

  useEffect(() => {
    const titles: Record<string, string> = {
      '/actions': 'היום',
      '/inbox': 'שיחה',
      '/customers': 'לקוחות',
      '/work': 'יומן ועבודות',
      '/money': 'כסף',
      '/more': 'עוד',
    };
    const pageName = location.pathname.startsWith('/customer/')
      ? 'לקוח'
      : titles[location.pathname] ?? 'CLOSER';
    document.title = `${pageName} · CLOSER`;
    mainRef.current?.focus({ preventScroll: true });
  }, [location.pathname]);

  return (
    <div className={`product-shell owner-shell${isCommandCenter ? ' command-center-shell' : ''}`} dir="rtl">
      <a className="skip-link" href="#product-main">דלג לתוכן הראשי</a>
      <aside className="product-sidebar">
        <div className="product-brand" aria-label="CLOSER">
          <strong>CLOSER</strong>
        </div>
        <nav className="product-nav" aria-label="ניווט ראשי">
          {primaryLinks.map(({ to, label, icon: Icon }) => (
            <Link
              key={label}
              to={to}
              aria-current={linkActive(to, location.pathname) ? 'page' : undefined}
              className={`product-nav-link${linkActive(to, location.pathname) ? ' active' : ''}`}
            >
              <Icon aria-hidden="true" />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="product-sidebar-footer">
          <BriefcaseBusiness aria-hidden="true" />
          <span>{business ? productBusinessName(business.kind, business.id, business.name) : 'CLOSER'}</span>
        </div>
      </aside>

      <div className="product-workspace">
        <header className="product-topbar">
          <span className="product-mobile-brand" aria-hidden="true">CLOSER</span>
          <label className="product-business-switcher">
            <span className="sr-only">עסק לדוגמה</span>
            <select
              aria-label="עסק לדוגמה"
              value={businessId}
              onChange={(event) => {
                setBusinessId(event.target.value);
                if (location.pathname.startsWith('/customer/') || location.pathname === '/inbox') {
                  navigate('/actions');
                }
              }}
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
            <Sparkles aria-hidden="true" />
            <span>CLOSER פעיל</span>
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
          <Link
            key={label}
            to={to}
            aria-current={linkActive(to, location.pathname) ? 'page' : undefined}
            className={`product-mobile-nav-link${linkActive(to, location.pathname) ? ' active' : ''}`}
          >
            <Icon aria-hidden="true" />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}

function sectionActive(to: string, pathname: string): boolean {
  if (to !== '/customers') return false;
  return pathname.startsWith('/customer/') || pathname === '/inbox';
}

function linkActive(to: string, pathname: string): boolean {
  return pathname === to || sectionActive(to, pathname);
}
