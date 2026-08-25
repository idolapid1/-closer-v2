import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './app/App';
import { CloserProvider } from './state/CloserContext';
import './styles.css';
import './components/product/ProductLayout.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <CloserProvider>
        <App />
      </CloserProvider>
    </BrowserRouter>
  </StrictMode>,
);
