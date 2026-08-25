import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AuthClient, AuthSession, AuthSessionEvent } from '../infrastructure/auth/AuthClient';
import { AuthProvider, useAuth } from './AuthContext';

const SESSION: AuthSession = {
  accessToken: 'access-token',
  expiresAt: 1_900_000_000,
  user: { id: 'user-a', email: 'owner@example.test' },
};

describe('AuthProvider', () => {
  it('restores an authenticated session and signs out explicitly', async () => {
    const client = fakeAuthClient(SESSION);
    render(<AuthProvider client={client}><AuthProbe /></AuthProvider>);
    expect(screen.getByText('loading')).toBeInTheDocument();
    await screen.findByText('owner@example.test');
    await userEvent.click(screen.getByRole('button', { name: 'sign out' }));
    await screen.findByText('unauthenticated');
    expect(client.signOut).toHaveBeenCalledTimes(1);
  });

  it('updates on token refresh and clears an expired session safely', async () => {
    const client = fakeAuthClient(SESSION);
    render(<AuthProvider client={client}><AuthProbe /></AuthProvider>);
    await screen.findByText('owner@example.test');
    client.emit('TOKEN_REFRESHED', { ...SESSION, accessToken: 'refreshed-token' });
    await waitFor(() => expect(screen.getByTestId('token')).toHaveTextContent('refreshed-token'));
    await userEvent.click(screen.getByRole('button', { name: 'expire' }));
    await screen.findByText('unauthenticated');
    expect(screen.getByText(/פג תוקף/)).toBeInTheDocument();
  });
});

function AuthProbe() {
  const auth = useAuth();
  return <div><span>{auth.status}</span><span>{auth.session?.user.email}</span><span data-testid="token">{auth.session?.accessToken}</span><span>{auth.error}</span><button type="button" onClick={() => void auth.signOut()}>sign out</button><button type="button" onClick={() => void auth.expireSession()}>expire</button></div>;
}

function fakeAuthClient(initial: AuthSession | null) {
  let session = initial;
  let listener: ((event: AuthSessionEvent, session: AuthSession | null) => void) | null = null;
  const client: AuthClient & { emit(event: AuthSessionEvent, session: AuthSession | null): void } = {
    getSession: vi.fn(async () => session),
    getAccessToken: vi.fn(async () => session?.accessToken ?? null),
    refreshAccessToken: vi.fn(async () => session?.accessToken ?? null),
    signIn: vi.fn(async () => SESSION),
    signUp: vi.fn(async () => ({ session: SESSION, confirmationRequired: false })),
    signOut: vi.fn(async () => { session = null; }),
    subscribe: vi.fn((next) => { listener = next; return () => { listener = null; }; }),
    emit: (event, nextSession) => { session = nextSession; listener?.(event, nextSession); },
  };
  return client;
}
