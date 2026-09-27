import { type JWTVerifyGetKey, createRemoteJWKSet, jwtVerify } from 'jose';
import { type EdgeRule } from './config';

export interface GatewayIdentity {
  userId: string;
  role: string;
  sessionId: string;
}

export type AuthResult =
  | { kind: 'anonymous' }
  | { kind: 'authenticated'; identity: GatewayIdentity }
  | { kind: 'invalid' };

/**
 * Validation des access tokens au bord : signature RS256 par le JWKS du service
 * d'authentification (mis en cache par jose, rafraîchi à la rotation), émetteur, expiration,
 * claims obligatoires. La révocation de session reste contrôlée par les services.
 */
export class TokenVerifier {
  constructor(
    private readonly keys: JWTVerifyGetKey,
    private readonly issuer: string,
  ) {}

  static remote(jwksUrl: string, issuer: string, timeoutMs = 3000): TokenVerifier {
    return new TokenVerifier(
      createRemoteJWKSet(new URL(jwksUrl), {
        timeoutDuration: timeoutMs,
        cooldownDuration: 30_000,
      }),
      issuer,
    );
  }

  async check(authorization: string | undefined): Promise<AuthResult> {
    if (!authorization) return { kind: 'anonymous' };
    const m = /^Bearer ([A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+)$/.exec(authorization);
    if (!m?.[1]) return { kind: 'invalid' };
    try {
      const { payload } = await jwtVerify(m[1], this.keys, {
        issuer: this.issuer,
        algorithms: ['RS256'],
      });
      const role = payload['role'];
      const sid = payload['sid'];
      if (typeof payload.sub !== 'string' || typeof role !== 'string' || typeof sid !== 'string')
        return { kind: 'invalid' };
      return { kind: 'authenticated', identity: { userId: payload.sub, role, sessionId: sid } };
    } catch {
      return { kind: 'invalid' };
    }
  }
}

/** Règle la plus spécifique applicable au chemin, sinon null. */
export function edgeRuleFor(rules: EdgeRule[], path: string): EdgeRule | null {
  let best: EdgeRule | null = null;
  for (const r of rules)
    if (path.startsWith(r.prefix) && (!best || r.prefix.length > best.prefix.length)) best = r;
  return best;
}
