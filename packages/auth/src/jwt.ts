import {
  type JWK,
  type KeyLike,
  SignJWT,
  exportJWK,
  exportPKCS8,
  exportSPKI,
  generateKeyPair,
  importPKCS8,
  importSPKI,
  jwtVerify,
  createLocalJWKSet,
  errors as joseErrors,
} from 'jose';
import { randomUUID } from 'node:crypto';
import { type PlatformRole } from '@tontine/contracts';

/** Claims de l'access token (R-AUTH-LOGIN-05). */
export interface AccessTokenClaims {
  sub: string;
  role: PlatformRole;
  tontineIds: string[];
  sid: string;
  jti: string;
  iat: number;
  exp: number;
}

export interface KeyMaterial {
  kid: string;
  privateKeyPem: string;
  publicKeyPem: string;
}

export class TokenVerificationError extends Error {
  constructor(
    message: string,
    readonly expired = false,
  ) {
    super(message);
    this.name = 'TokenVerificationError';
  }
}

export async function generateRsaKeyMaterial(kid = `dev-${Date.now()}`): Promise<KeyMaterial> {
  const { privateKey, publicKey } = await generateKeyPair('RS256', {
    modulusLength: 2048,
    extractable: true,
  });
  return {
    kid,
    privateKeyPem: await exportPKCS8(privateKey),
    publicKeyPem: await exportSPKI(publicKey),
  };
}

/**
 * Magasin de clés RS256 avec rotation : une clé active pour signer, plusieurs clés publiques
 * acceptées en vérification (JWKS).
 */
export class JwtKeyStore {
  private constructor(
    private readonly active: { kid: string; privateKey: KeyLike },
    private readonly jwks: { keys: JWK[] },
    private readonly issuer: string,
  ) {}

  static async create(
    active: KeyMaterial,
    previous: KeyMaterial[] = [],
    issuer = 'tontinemoney',
  ): Promise<JwtKeyStore> {
    const privateKey = await importPKCS8(active.privateKeyPem, 'RS256');
    const keys: JWK[] = [];
    for (const km of [active, ...previous]) {
      const pub = await importSPKI(km.publicKeyPem, 'RS256', { extractable: true });
      const jwk = await exportJWK(pub);
      keys.push({ ...jwk, kid: km.kid, alg: 'RS256', use: 'sig' });
    }
    return new JwtKeyStore({ kid: active.kid, privateKey }, { keys }, issuer);
  }

  get publicJwks(): { keys: JWK[] } {
    return this.jwks;
  }

  async sign(
    claims: Omit<AccessTokenClaims, 'iat' | 'exp' | 'jti'> & { jti?: string },
    ttlSeconds: number,
    now: Date = new Date(),
  ): Promise<{ token: string; jti: string; expiresAt: Date }> {
    const iat = Math.floor(now.getTime() / 1000);
    const jti = claims.jti ?? randomUUID();
    const token = await new SignJWT({
      role: claims.role,
      tontineIds: claims.tontineIds,
      sid: claims.sid,
    })
      .setProtectedHeader({ alg: 'RS256', kid: this.active.kid, typ: 'JWT' })
      .setSubject(claims.sub)
      .setIssuer(this.issuer)
      .setJti(jti)
      .setIssuedAt(iat)
      .setExpirationTime(iat + ttlSeconds)
      .sign(this.active.privateKey);
    return { token, jti, expiresAt: new Date((iat + ttlSeconds) * 1000) };
  }

  async verify(token: string, now: Date = new Date()): Promise<AccessTokenClaims> {
    try {
      const { payload } = await jwtVerify(token, createLocalJWKSet(this.jwks), {
        issuer: this.issuer,
        algorithms: ['RS256'],
        currentDate: now,
      });
      if (
        typeof payload.sub !== 'string' ||
        typeof payload['role'] !== 'string' ||
        typeof payload['sid'] !== 'string' ||
        typeof payload.jti !== 'string' ||
        typeof payload.exp !== 'number' ||
        typeof payload.iat !== 'number'
      ) {
        throw new TokenVerificationError('Claims manquants');
      }
      const tontineIds = Array.isArray(payload['tontineIds'])
        ? (payload['tontineIds'] as unknown[]).filter((v): v is string => typeof v === 'string')
        : [];
      return {
        sub: payload.sub,
        role: payload['role'] as PlatformRole,
        sid: payload['sid'],
        jti: payload.jti,
        iat: payload.iat,
        exp: payload.exp,
        tontineIds,
      };
    } catch (e) {
      if (e instanceof TokenVerificationError) throw e;
      if (e instanceof joseErrors.JWTExpired)
        throw new TokenVerificationError('Jeton expiré', true);
      throw new TokenVerificationError('Jeton invalide');
    }
  }
}
