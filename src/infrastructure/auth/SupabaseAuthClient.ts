import { createClient, type Session } from '@supabase/supabase-js';
import { AuthClientError, type AuthClient, type AuthSession, type AuthSessionEvent } from './AuthClient';

const clients = new Map<string, SupabaseAuthClient>();

export function getSupabaseAuthClient(url: string, publishableKey: string): SupabaseAuthClient {
  const key = `${url}\u0000${publishableKey}`;
  const existing = clients.get(key);
  if (existing) return existing;
  const client = new SupabaseAuthClient(url, publishableKey);
  clients.set(key, client);
  return client;
}

export class SupabaseAuthClient implements AuthClient {
  private readonly client;

  constructor(url: string, publishableKey: string) {
    this.client = createClient(url, publishableKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    });
  }

  async getSession(): Promise<AuthSession | null> {
    const { data, error } = await this.client.auth.getSession();
    if (error) throw new AuthClientError('SESSION_RESTORE_FAILED', 'Could not restore the signed-in session');
    return mapSession(data.session);
  }

  async signIn(email: string, password: string): Promise<AuthSession> {
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error || !data.session) throw new AuthClientError('SIGN_IN_FAILED', 'The email or password is incorrect');
    return mapRequiredSession(data.session);
  }

  async signUp(
    email: string,
    password: string,
  ): Promise<{ session: AuthSession | null; confirmationRequired: boolean }> {
    const { data, error } = await this.client.auth.signUp({ email, password });
    if (error) throw new AuthClientError('SIGN_UP_FAILED', 'The account could not be created');
    return {
      session: mapSession(data.session),
      confirmationRequired: data.session === null,
    };
  }

  async signOut(): Promise<void> {
    const { error } = await this.client.auth.signOut();
    if (error) throw new AuthClientError('SIGN_OUT_FAILED', 'The session could not be closed');
  }

  async getAccessToken(): Promise<string | null> {
    const session = await this.getSession();
    if (!session) return null;
    if (session.expiresAt !== null && session.expiresAt * 1000 <= Date.now() + 30_000) {
      return this.refreshAccessToken();
    }
    return session.accessToken;
  }

  async refreshAccessToken(): Promise<string | null> {
    const { data, error } = await this.client.auth.refreshSession();
    if (error || !data.session) return null;
    return data.session.access_token;
  }

  subscribe(listener: (event: AuthSessionEvent, session: AuthSession | null) => void): () => void {
    const { data } = this.client.auth.onAuthStateChange((event, session) => {
      if (isSupportedEvent(event)) listener(event, mapSession(session));
    });
    return () => data.subscription.unsubscribe();
  }
}

function mapRequiredSession(session: Session): AuthSession {
  return {
    accessToken: session.access_token,
    expiresAt: session.expires_at ?? null,
    user: {
      id: session.user.id,
      email: session.user.email ?? null,
    },
  };
}

function mapSession(session: Session | null): AuthSession | null {
  return session ? mapRequiredSession(session) : null;
}

function isSupportedEvent(event: string): event is AuthSessionEvent {
  return ['INITIAL_SESSION', 'SIGNED_IN', 'SIGNED_OUT', 'TOKEN_REFRESHED', 'USER_UPDATED'].includes(event);
}
