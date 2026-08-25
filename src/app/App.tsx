import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { ProductLayout } from '../components/product/ProductLayout';
import { AppointmentsPage } from '../features/appointments/AppointmentsPage';
import { CustomerPage } from '../features/customer/CustomerPage';
import { CustomersPage } from '../features/customers/CustomersPage';
import { DebugPage } from '../features/debug/DebugPage';
import { DemoPage } from '../features/demo/DemoPage';
import { InboxPage } from '../features/inbox/InboxPage';
import { MoneyPage } from '../features/money/MoneyPage';
import { MorePage } from '../features/more/MorePage';
import { QuotesPage } from '../features/quotes/QuotesPage';
import { WorkPage } from '../features/work/WorkPage';

const ActionsPage = lazy(() => import('../features/actions/ActionsPage').then((module) => ({
  default: module.ActionsPage,
})));

export function App() {
  return (
    <Routes>
      <Route element={<ProductLayout />}>
        <Route index element={<Navigate to="/actions" replace />} />
        <Route path="inbox" element={<InboxPage />} />
        <Route path="actions" element={<Suspense fallback={<div className="owner-route-loading" role="status">CLOSER מכין את היום…</div>}><ActionsPage /></Suspense>} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="customer/:id" element={<CustomerPage />} />
        <Route path="work" element={<WorkPage />} />
        <Route path="money" element={<MoneyPage />} />
        <Route path="more" element={<MorePage />} />
      </Route>
      <Route element={<Layout />}>
        <Route path="demo" element={<DemoPage />} />
        <Route path="appointments" element={<AppointmentsPage />} />
        <Route path="quotes" element={<QuotesPage />} />
        <Route path="debug" element={<DebugPage />} />
        <Route path="*" element={<Navigate to="/actions" replace />} />
      </Route>
    </Routes>
  );
}
