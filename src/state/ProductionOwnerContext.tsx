import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ProductionApiError } from '../infrastructure/api/ProductionApiClient';
import type { ProductionApiClient } from '../infrastructure/api/ProductionApiClient';
import type {
  ProductionJourneyCreationContract,
  ProductionJourneyResultContract,
  ProductionOwnerSnapshotContract,
  ProductionTenantContract,
} from '../types/productionApi';
import { useAuth } from './AuthContext';

const ACTIVE_TENANT_KEY = 'closer.production.activeTenant';

export type ProductionDataErrorKind = 'NETWORK' | 'FORBIDDEN' | 'SERVER' | null;

export interface ProductionOwnerContextValue {
  api: ProductionApiClient;
  tenants: ProductionTenantContract[];
  activeTenantId: string;
  activeTenant: ProductionTenantContract | null;
  snapshot: ProductionOwnerSnapshotContract | null;
  loading: boolean;
  error: string;
  errorKind: ProductionDataErrorKind;
  selectTenant(tenantId: string): void;
  refresh(): Promise<void>;
  refreshTenants(preferredTenantId?: string): Promise<ProductionTenantContract[]>;
  provisionTenant(name: string): Promise<void>;
  createJourney(input: ProductionJourneyCreationContract): Promise<ProductionJourneyResultContract>;
}

const ProductionOwnerContext = createContext<ProductionOwnerContextValue | null>(null);

export function ProductionOwnerProvider({
  children,
  api,
}: {
  children: ReactNode;
  api: ProductionApiClient;
}) {
  const auth = useAuth();
  const [tenants, setTenants] = useState<ProductionTenantContract[]>([]);
  const [activeTenantId, setActiveTenantId] = useState('');
  const [snapshot, setSnapshot] = useState<ProductionOwnerSnapshotContract | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [errorKind, setErrorKind] = useState<ProductionDataErrorKind>(null);
  const snapshotRequestSequence = useRef(0);

  const handleFailure = useCallback(async (caught: unknown) => {
    if (caught instanceof ProductionApiError && caught.status === 401) {
      await auth.expireSession();
      return;
    }
    if (caught instanceof ProductionApiError && caught.status === 403) {
      sessionStorage.removeItem(ACTIVE_TENANT_KEY);
      setTenants([]);
      setActiveTenantId('');
      setSnapshot(null);
      setErrorKind('FORBIDDEN');
      setError('הגישה לעסק הוסרה. CLOSER לא הציג נתונים מעסק אחר.');
      return;
    }
    if (caught instanceof ProductionApiError && caught.status === 0) {
      setErrorKind('NETWORK');
      setError('אין כרגע חיבור לשרת CLOSER. הנתונים המקומיים לא הוצגו במקום נתוני הייצור.');
      return;
    }
    setErrorKind('SERVER');
    setError('לא הצלחנו לטעון את נתוני העסק. אפשר לנסות שוב.');
  }, [auth]);

  const loadSnapshot = useCallback(async (tenantId: string) => {
    const requestSequence = ++snapshotRequestSequence.current;
    setLoading(true);
    setError('');
    setErrorKind(null);
    try {
      const next = await api.getOwnerSnapshot(tenantId);
      if (requestSequence !== snapshotRequestSequence.current) return;
      setSnapshot(next);
    } catch (caught) {
      if (requestSequence !== snapshotRequestSequence.current) return;
      await handleFailure(caught);
    } finally {
      if (requestSequence === snapshotRequestSequence.current) setLoading(false);
    }
  }, [api, handleFailure]);

  const refreshTenants = useCallback(async (preferredTenantId?: string) => {
    setLoading(true);
    setError('');
    setErrorKind(null);
    try {
      const next = await api.listTenants();
      setTenants(next);
      const stored = sessionStorage.getItem(ACTIVE_TENANT_KEY);
      const authorizedId = preferredTenantId && next.some((tenant) => tenant.tenantId === preferredTenantId)
        ? preferredTenantId
        : next.some((tenant) => tenant.tenantId === activeTenantId)
        ? activeTenantId
        : next.some((tenant) => tenant.tenantId === stored)
          ? stored ?? ''
          : next[0]?.tenantId ?? '';
      setActiveTenantId(authorizedId);
      if (authorizedId) sessionStorage.setItem(ACTIVE_TENANT_KEY, authorizedId);
      else sessionStorage.removeItem(ACTIVE_TENANT_KEY);
      return next;
    } catch (caught) {
      await handleFailure(caught);
      return [];
    } finally {
      setLoading(false);
    }
  }, [activeTenantId, api, handleFailure]);

  useEffect(() => {
    if (auth.status === 'authenticated') void refreshTenants();
  }, [auth.session?.user.id, auth.status]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeTenantId) void loadSnapshot(activeTenantId);
    else {
      snapshotRequestSequence.current += 1;
      setSnapshot(null);
    }
  }, [activeTenantId, loadSnapshot]);

  const selectTenant = useCallback((tenantId: string) => {
    if (!tenants.some((tenant) => tenant.tenantId === tenantId)) {
      setErrorKind('FORBIDDEN');
      setError('אי אפשר לבחור עסק שאין לך הרשאה אליו.');
      return;
    }
    sessionStorage.setItem(ACTIVE_TENANT_KEY, tenantId);
    setActiveTenantId(tenantId);
  }, [tenants]);

  const value = useMemo<ProductionOwnerContextValue>(() => ({
    api,
    tenants,
    activeTenantId,
    activeTenant: tenants.find((tenant) => tenant.tenantId === activeTenantId) ?? null,
    snapshot,
    loading,
    error,
    errorKind,
    selectTenant,
    refresh: async () => {
      if (activeTenantId) await loadSnapshot(activeTenantId);
    },
    refreshTenants,
    provisionTenant: async (name) => {
      const key = `tenant:${crypto.randomUUID()}`;
      const created = await api.provisionTenant(name, key);
      const next = await refreshTenants(created.tenantId);
      if (!next.some((tenant) => tenant.tenantId === created.tenantId)) {
        throw new Error('העסק נוצר אך החברות בו עדיין לא זמינה.');
      }
    },
    createJourney: async (input) => {
      if (!activeTenantId) throw new Error('יש לבחור עסק.');
      const result = await api.createJourney(activeTenantId, input);
      await loadSnapshot(activeTenantId);
      return result;
    },
  }), [
    activeTenantId,
    api,
    error,
    errorKind,
    loadSnapshot,
    loading,
    refreshTenants,
    selectTenant,
    snapshot,
    tenants,
  ]);

  return <ProductionOwnerContext.Provider value={value}>{children}</ProductionOwnerContext.Provider>;
}

export function useProductionOwner(): ProductionOwnerContextValue {
  const context = useContext(ProductionOwnerContext);
  if (!context) throw new Error('useProductionOwner must be used inside ProductionOwnerProvider');
  return context;
}
