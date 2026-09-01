import {
  Banknote,
  BriefcaseBusiness,
  CalendarDays,
  ChevronDown,
  CircleEllipsis,
  Inbox,
  Home,
  PlugZap,
  RotateCcw,
  Settings,
  Sparkles,
  UsersRound,
} from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';

const primaryLinks = [
  { to: '/actions', label: 'היום', icon: Home },
  { to: '/customers', label: 'לקוחות', icon: UsersRound },
  { to: '/work', label: 'יומן ועבודות', icon: CalendarDays },
  { to: '/money', label: 'כסף', icon: Banknote },
  { to: '/more', label: 'עוד', icon: CircleEllipsis },
] as const;

const revenueLinks = [
  { to: '/revenue', label: 'הכנסות', icon: Banknote },
  { to: '/opportunities', label: 'הזדמנויות', icon: Sparkles },
  { to: '/inbox', label: 'שיחות', icon: Inbox },
  { to: '/bookings', label: 'הזמנות', icon: CalendarDays },
  { to: '/customers', label: 'לקוחות', icon: UsersRound },
  { to: '/jobs', label: 'עבודות', icon: BriefcaseBusiness },
  { to: '/recovery', label: 'Recovery Plays', icon: RotateCcw },
  { to: '/connections', label: 'חיבורים', icon: PlugZap },
  { to: '/settings', label: 'הגדרות', icon: Settings },
] as const;

const revenueMobileLinks = [
  revenueLinks[0],
  revenueLinks[1],
  revenueLinks[2],
  revenueLinks[3],
  { to: '/settings', label: 'עוד', icon: CircleEllipsis },
] as const;

export interface OwnerShellBusiness {
  id: string;
  name: string;
}

export function OwnerShell({
  businesses,
  businessId,
  onBusinessChange,
  switcherLabel,
  statusText = 'CLOSER פעיל',
  navigationMode = 'owner',
}: {
  businesses: OwnerShellBusiness[];
  businessId: string;
  onBusinessChange: (businessId: string) => void;
  switcherLabel: string;
  statusText?: string;
  navigationMode?: 'owner' | 'revenue';
}) {
  const business = businesses.find((candidate) => candidate.id === businessId);
  const location = useLocation();
  const navigate = useNavigate();
  const mainRef = useRef<HTMLElement>(null);
  const navigationLinks = navigationMode === 'revenue' ? revenueLinks : primaryLinks;
  const mobileLinks = navigationMode === 'revenue' ? revenueMobileLinks : primaryLinks;
  const isCommandCenter = location.pathname === '/actions' || location.pathname === '/revenue';

  useEffect(() => {
    const titles: Record<string, string> = {
      '/actions': 'היום',
      '/revenue': 'הכנסות',
      '/opportunities': 'הזדמנויות',
      '/bookings': 'הזמנות',
      '/jobs': 'עבודות',
      '/recovery': 'Recovery Plays',
      '/connections': 'חיבורים',
      '/settings': 'הגדרות',
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
        <div className="product-brand" aria-label="CLOSER"><strong>CLOSER</strong></div>
        <nav className="product-nav" aria-label="ניווט ראשי">
          {navigationLinks.map(({ to, label, icon: Icon }) => (
            <Link
              key={label}
              to={to}
              aria-current={linkActive(to, location.pathname, navigationMode) ? 'page' : undefined}
              className={`product-nav-link${linkActive(to, location.pathname, navigationMode) ? ' active' : ''}`}
            >
              <Icon aria-hidden="true" /><span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="product-sidebar-footer"><BriefcaseBusiness aria-hidden="true" /><span>{business?.name ?? 'CLOSER'}</span></div>
      </aside>

      <div className="product-workspace">
        <header className="product-topbar">
          <span className="product-mobile-brand" aria-hidden="true">CLOSER</span>
          <label className="product-business-switcher">
            <span className="sr-only">{switcherLabel}</span>
            <select
              aria-label={switcherLabel}
              value={businessId}
              onChange={(event) => {
                onBusinessChange(event.target.value);
                if (location.pathname.startsWith('/customer/') || location.pathname.startsWith('/opportunity/') || location.pathname === '/inbox') {
                  navigate(navigationMode === 'revenue' ? '/revenue' : '/actions');
                }
              }}
            >
              {businesses.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
            </select>
            <ChevronDown aria-hidden="true" />
          </label>
          <div className="product-topbar-meta">
            <Sparkles aria-hidden="true" /><span>{statusText}</span><span className="product-topbar-dot" aria-hidden="true" />
            <strong>{business?.name ?? 'CLOSER'}</strong>
          </div>
        </header>
        <main ref={mainRef} id="product-main" className="product-main" tabIndex={-1}><Outlet /></main>
      </div>

      <nav className="product-mobile-nav" aria-label="ניווט ראשי לנייד">
        {mobileLinks.map(({ to, label, icon: Icon }) => (
          <Link
            key={label}
            to={to}
            aria-current={linkActive(to, location.pathname, navigationMode) ? 'page' : undefined}
            className={`product-mobile-nav-link${linkActive(to, location.pathname, navigationMode) ? ' active' : ''}`}
          >
            <Icon aria-hidden="true" /><span>{label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}

function linkActive(to: string, pathname: string, mode: 'owner' | 'revenue' = 'owner'): boolean {
  if (pathname === to) return true;
  if (mode === 'revenue') {
    if (to === '/opportunities' && pathname.startsWith('/opportunity/')) return true;
    if (to === '/customers' && pathname.startsWith('/customer/')) return true;
    if (to === '/settings' && ['/settings', '/connections'].includes(pathname)) return true;
    return false;
  }
  return to === '/customers' && (pathname.startsWith('/customer/') || pathname === '/inbox');
}
