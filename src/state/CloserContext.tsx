import {
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { CloserService } from '../application/CloserService';
import { DEMO_DATABASE } from '../data/demoData';
import { BrowserStorageAdapter, LocalDatabase } from '../infrastructure/persistence';
import { MockAIProvider } from '../integrations/ai/MockAIProvider';
import { MockWhatsAppProvider } from '../integrations/messaging/MockWhatsAppProvider';
import { CloserContext, type CloserContextValue } from './closerState';

function createBrowserService(): CloserService {
  const database = new LocalDatabase(new BrowserStorageAdapter(), DEMO_DATABASE);
  return new CloserService(
    database,
    new MockAIProvider(),
    new MockWhatsAppProvider(),
  );
}

export function CloserProvider({
  children,
  service: providedService,
}: {
  children: ReactNode;
  service?: CloserService;
}) {
  const service = useMemo(() => providedService ?? createBrowserService(), [providedService]);
  const [state, setState] = useState(() => service.snapshot());
  const [businessId, setBusinessId] = useState(() => state.businesses[0]?.id ?? '');

  useEffect(() => service.subscribe(() => setState(service.snapshot())), [service]);

  const value = useMemo<CloserContextValue>(
    () => ({
      service,
      state,
      businessId,
      setBusinessId,
      resetDemo: () => {
        service.resetDemo();
        setBusinessId(DEMO_DATABASE.businesses[0]?.id ?? '');
      },
    }),
    [businessId, service, state],
  );

  return <CloserContext.Provider value={value}>{children}</CloserContext.Provider>;
}
