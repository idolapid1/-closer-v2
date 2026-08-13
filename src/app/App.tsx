import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { ProductLayout } from '../components/product/ProductLayout';
import { AppointmentsPage } from '../features/appointments/AppointmentsPage';
import { CustomerPage } from '../features/customer/CustomerPage';
import { DebugPage } from '../features/debug/DebugPage';
import { DemoPage } from '../features/demo/DemoPage';
import { InboxPage } from '../features/inbox/InboxPage';
import { QuotesPage } from '../features/quotes/QuotesPage';
import { ActionsPage } from '../features/actions/ActionsPage';

export function App() {
  return (
    <Routes>
      <Route element={<ProductLayout />}>
        <Route index element={<Navigate to="/actions" replace />} />
        <Route path="inbox" element={<InboxPage />} />
        <Route path="actions" element={<ActionsPage />} />
        <Route path="customer/:id" element={<CustomerPage />} />
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
