import { NavLink, Outlet } from 'react-router-dom';
import { BusinessSwitcher } from './BusinessSwitcher';

const links = [
  ['/demo', 'Demo'],
  ['/inbox', 'Inbox'],
  ['/appointments', 'Appointments'],
  ['/quotes', 'Quotes & jobs'],
  ['/debug', 'Debug'],
] as const;

export function Layout() {
  return (
    <div className="shell">
      <header className="topbar">
        <div>
          <strong>CLOSER v2</strong>
          <small>Phase 2 engineering simulator</small>
        </div>
        <BusinessSwitcher />
      </header>
      <nav className="nav" aria-label="Primary">
        {links.map(([to, label]) => (
          <NavLink key={to} to={to} className={({ isActive }) => (isActive ? 'active' : undefined)}>
            {label}
          </NavLink>
        ))}
      </nav>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
