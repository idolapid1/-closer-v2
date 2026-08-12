import { createContext, useContext } from 'react';
import type { CloserService } from '../application/CloserService';
import type { DatabaseSchema } from '../repositories/contracts';

export interface CloserContextValue {
  service: CloserService;
  state: DatabaseSchema;
  businessId: string;
  setBusinessId: (businessId: string) => void;
  resetDemo: () => void;
}

export const CloserContext = createContext<CloserContextValue | null>(null);

export function useCloser(): CloserContextValue {
  const context = useContext(CloserContext);
  if (!context) throw new Error('useCloser must be used within CloserProvider');
  return context;
}
