import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './app/App';
import { loadClientRuntimeConfig, type ClientRuntimeConfig } from './config/runtimeConfig';
import { CloserProvider } from './state/CloserContext';
import './styles.css';
import './components/product/ProductLayout.css';

const ProductionApp = lazy(() => import('./app/ProductionApp').then((module) => ({ default: module.ProductionApp })));

let runtimeConfig: ClientRuntimeConfig | Error;
try {
  runtimeConfig = loadClientRuntimeConfig(import.meta.env);
} catch (error) {
  runtimeConfig = error instanceof Error ? error : new Error('Invalid CLOSER client configuration');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <RuntimeApplication config={runtimeConfig} />
    </BrowserRouter>
  </StrictMode>,
);

function RuntimeApplication({ config }: { config: ClientRuntimeConfig | Error }) {
  if (config instanceof Error) {
    return (
      <main className="production-auth" dir="rtl">
        <section className="production-auth-panel" role="alert">
          <strong className="product-brand">CLOSER</strong>
          <h1>הגדרת הייצור חסרה</h1>
          <p>האפליקציה לא עברה למצב דמו. יש להשלים את משתני הסביבה הציבוריים.</p>
          <code dir="ltr">{config.message}</code>
        </section>
      </main>
    );
  }
  if (config.mode === 'DEMO') {
    return <CloserProvider><App /></CloserProvider>;
  }
  return (
    <Suspense fallback={<main className="production-auth" dir="rtl"><section className="production-auth-panel" role="status">טוענים CLOSER…</section></main>}>
      <ProductionApp config={config} />
    </Suspense>
  );
}
