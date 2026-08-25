import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AuthClient, AuthSession } from '../infrastructure/auth/AuthClient';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'error';

export interface AuthContextValue {
  client: AuthClient;
  status: AuthStatus;
  session: AuthSession | null;
  error: string;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string): Promise<boolean>;
  signOut(): Promise<void>;
  expireSession(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children, client }: { children: ReactNode; client: AuthClient }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [session, setSession] = useState<AuthSession | null>(null);
  const [error, setError] = useState('');
  const expiryInFlight = useRef<Promise<void> | null>(null);
  const expiredSessionHandled = useRef(false);

  useEffect(() => {
    let active = true;
    const unsubscribe = client.subscribe((_event, nextSession) => {
      if (!active) return;
      if (nextSession) expiredSessionHandled.current = false;
      setSession(nextSession);
      setStatus(nextSession ? 'authenticated' : 'unauthenticated');
      setError('');
    });
    void client.getSession().then((restored) => {
      if (!active) return;
      if (restored) expiredSessionHandled.current = false;
      setSession(restored);
      setStatus(restored ? 'authenticated' : 'unauthenticated');
    }).catch(() => {
      if (!active) return;
      setSession(null);
      setStatus('error');
      setError('לא הצלחנו לשחזר את ההתחברות. אפשר לנסות שוב.');
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [client]);

  const value = useMemo<AuthContextValue>(() => ({
    client,
    status,
    session,
    error,
    signIn: async (email, password) => {
      setError('');
      const nextSession = await client.signIn(email, password);
      expiredSessionHandled.current = false;
      setSession(nextSession);
      setStatus('authenticated');
    },
    signUp: async (email, password) => {
      setError('');
      const result = await client.signUp(email, password);
      if (result.session) expiredSessionHandled.current = false;
      setSession(result.session);
      setStatus(result.session ? 'authenticated' : 'unauthenticated');
      return result.confirmationRequired;
    },
    signOut: async () => {
      await client.signOut();
      setSession(null);
      setStatus('unauthenticated');
    },
    expireSession: async () => {
      if (expiredSessionHandled.current) return;
      expiredSessionHandled.current = true;
      if (!expiryInFlight.current) {
        expiryInFlight.current = client.signOut()
          .catch(() => undefined)
          .then(() => {
            setSession(null);
            setStatus('unauthenticated');
            setError('פג תוקף ההתחברות. יש להתחבר מחדש.');
          })
          .finally(() => {
            expiryInFlight.current = null;
          });
      }
      await expiryInFlight.current;
    },
  }), [client, error, session, status]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
