import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { AppointmentsPage } from '../features/appointments/AppointmentsPage';
import { CustomerPage } from '../features/customer/CustomerPage';
import { DebugPage } from '../features/debug/DebugPage';
import { DemoPage } from '../features/demo/DemoPage';
import { InboxPage } from '../features/inbox/InboxPage';
import { QuotesPage } from '../features/quotes/QuotesPage';

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/demo" replace />} />
        <Route path="demo" element={<DemoPage />} />
        <Route path="inbox" element={<InboxPage />} />
        <Route path="customer/:id" element={<CustomerPage />} />
        <Route path="appointments" element={<AppointmentsPage />} />
        <Route path="quotes" element={<QuotesPage />} />
        <Route path="debug" element={<DebugPage />} />
        <Route path="*" element={<Navigate to="/demo" replace />} />
      </Route>
    </Routes>
  );
}
