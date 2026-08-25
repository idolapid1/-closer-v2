import type { AccessTokenProvider } from '../api/ProductionApiClient';

export interface AuthUser {
  id: string;
  email: string | null;
}

export interface AuthSession {
  accessToken: string;
  expiresAt: number | null;
  user: AuthUser;
}

export type AuthSessionEvent = 'INITIAL_SESSION' | 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED' | 'USER_UPDATED';

export interface AuthClient extends AccessTokenProvider {
  getSession(): Promise<AuthSession | null>;
  signIn(email: string, password: string): Promise<AuthSession>;
  signUp(email: string, password: string): Promise<{ session: AuthSession | null; confirmationRequired: boolean }>;
  signOut(): Promise<void>;
  refreshAccessToken(): Promise<string | null>;
  subscribe(listener: (event: AuthSessionEvent, session: AuthSession | null) => void): () => void;
}

export class AuthClientError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}
