import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { AuthenticatedIdentity } from '../domain/model.js';

export interface Authenticator {
  authenticate(authorizationHeader: string | undefined): Promise<AuthenticatedIdentity | null>;
}

export interface JwksAuthenticatorOptions {
  jwksUrl: string;
  issuer: string;
  audience?: string;
}

export class JwtAuthenticator implements Authenticator {
  constructor(
    private readonly verificationKey: JWTVerifyGetKey,
    private readonly options: Omit<JwksAuthenticatorOptions, 'jwksUrl'>,
  ) {}

  async authenticate(authorizationHeader: string | undefined): Promise<AuthenticatedIdentity | null> {
    const token = bearerToken(authorizationHeader);
    if (!token) return null;
    try {
      const verification = await jwtVerify(token, this.verificationKey, {
        issuer: this.options.issuer,
        ...(this.options.audience ? { audience: this.options.audience } : {}),
      });
      if (!verification.payload.sub) return null;
      return {
        userId: verification.payload.sub,
        email: typeof verification.payload.email === 'string' ? verification.payload.email : null,
        tokenId: typeof verification.payload.jti === 'string' ? verification.payload.jti : null,
      };
    } catch {
      return null;
    }
  }
}

export class JwksAuthenticator extends JwtAuthenticator {
  constructor(options: JwksAuthenticatorOptions) {
    super(createRemoteJWKSet(new URL(options.jwksUrl)), options);
  }
}

export class StaticTokenAuthenticator implements Authenticator {
  constructor(private readonly identities: ReadonlyMap<string, AuthenticatedIdentity>) {}

  async authenticate(authorizationHeader: string | undefined): Promise<AuthenticatedIdentity | null> {
    const token = bearerToken(authorizationHeader);
    return token ? this.identities.get(token) ?? null : null;
  }
}

function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+([^\s]+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}
