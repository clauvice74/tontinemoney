import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { type AddressInfo } from 'node:net';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { type KeyLike, SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import pino from 'pino';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createGateway } from './bootstrap';
import { CircuitBreaker } from './circuit-breaker';
import { loadGatewayConfig } from './config';
import { FixedWindowRateLimiter } from './rate-limiter';
import { RouteTable, clientIp } from './routes';

type Handler = (req: IncomingMessage, res: ServerResponse, body: Buffer) => void;

/** Service amont factice : renvoie ce qu'il a reçu, sauf comportement imposé par le test. */
let upstream: Server;
let upstreamUrl: string;
let behaviour: Handler | null = null;
const echo: Handler = (req, res, body) => {
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'X-Powered-By': 'Express',
    'Set-Cookie': 'tm_rt=abc; HttpOnly; Path=/api/v1/auth',
  });
  res.end(
    JSON.stringify({ method: req.method, url: req.url, headers: req.headers, bytes: body.length }),
  );
};

let privateKey: KeyLike;
let keys: ReturnType<typeof createLocalJWKSet>;
let foreignKey: KeyLike;

async function token(
  claims: Record<string, unknown> = {},
  opts: { key?: KeyLike; issuer?: string; exp?: string } = {},
) {
  return new SignJWT({ role: 'MEMBER', sid: 'session-1', ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setSubject('11111111-1111-4111-8111-111111111111')
    .setIssuer(opts.issuer ?? 'tontinemoney')
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? '10m')
    .sign(opts.key ?? privateKey);
}

let app: NestExpressApplication;
async function gateway(env: Record<string, string> = {}) {
  app = await createGateway({
    config: loadGatewayConfig({
      NODE_ENV: 'test',
      API_UPSTREAM_URL: upstreamUrl,
      GATEWAY_TRUST_PROXY_HOPS: '0',
      ...env,
    }),
    keys,
    logger: pino({ level: 'silent' }),
  });
  await app.init();
  return request(app.getHttpServer());
}

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  keys = createLocalJWKSet({
    keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' }],
  });
  foreignKey = (await generateKeyPair('RS256')).privateKey;
  upstream = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => (behaviour ?? echo)(req, res, Buffer.concat(chunks)));
  });
  await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
  upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((r) => upstream.close(r));
});
afterEach(async () => {
  behaviour = null;
  await app?.close();
});

describe('routage et en-têtes', () => {
  it('transmet /api/v1/* avec méthode, chemin, requête et corps', async () => {
    const api = await gateway();
    const res = await api
      .post('/api/v1/tontines/abc?x=1')
      .set('Content-Type', 'application/json')
      .send({ a: 1 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ method: 'POST', url: '/api/v1/tontines/abc?x=1', bytes: 7 });
  });

  it('404 hors /api/v1, chemins suspects et versions inconnues', async () => {
    const api = await gateway();
    for (const p of [
      '/',
      '/api/v2/tontines',
      '/internal/admin',
      '/api/v1/a/%2e%2e/b',
      '/api/v1/x/%2E%2E/admin/users',
      '/api/v1/a%2fb',
      '/api/v1/%61dmin/users',
      '/api/v1/%41DMIN',
      '/api/v1/internal/payments/notifications',
      '/api/v1/payments/webhooks/simulated',
      '/api/v1/webhooks/payments/simulated',
    ]) {
      const res = await api.get(p);
      expect(res.status, p).toBe(404);
      expect(res.headers['content-type']).toContain('application/problem+json');
    }
  });

  it('route un préfixe extrait vers son service, le reste vers le service par défaut', async () => {
    const other = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"service":"reporting"}');
    });
    await new Promise<void>((r) => other.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(other.address() as AddressInfo).port}`;
    try {
      const api = await gateway({
        GATEWAY_ROUTES: JSON.stringify([{ prefix: '/api/v1/tontines/', upstream: url }]),
      });
      expect((await api.get('/api/v1/tontines/x')).body).toEqual({ service: 'reporting' });
      expect((await api.get('/api/v1/wallets/x')).body.url).toBe('/api/v1/wallets/x');
    } finally {
      await new Promise((r) => other.close(r));
    }
  });

  it('corrélation : identifiant valide propagé, sinon généré ; renvoyé au client', async () => {
    const api = await gateway();
    const kept = await api.get('/api/v1/x').set('X-Correlation-Id', 'abcd-1234-efgh');
    expect(kept.headers['x-correlation-id']).toBe('abcd-1234-efgh');
    expect(kept.body.headers['x-correlation-id']).toBe('abcd-1234-efgh');
    const replaced = await api.get('/api/v1/x').set('X-Correlation-Id', 'bad value!');
    expect(replaced.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('retire les en-têtes d’identité forgés et la politique CORS du service amont', async () => {
    const api = await gateway();
    const res = await api
      .get('/api/v1/x')
      .set('X-User-Id', 'attacker')
      .set('X-User-Role', 'SUPER_ADMIN')
      .set('X-Forwarded-For', '6.6.6.6')
      .set('Forwarded', 'for=6.6.6.6');
    expect(res.body.headers['x-user-id']).toBeUndefined();
    expect(res.body.headers['x-user-role']).toBeUndefined();
    expect(res.body.headers['forwarded']).toBeUndefined();
    expect(res.body.headers['x-forwarded-for']).not.toContain('6.6.6.6');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['set-cookie']?.[0]).toContain('HttpOnly');
  });

  it('CORS : seule l’origine du web est autorisée, avec identifiants', async () => {
    const api = await gateway({ WEB_ORIGIN: 'http://web.test' });
    const ok = await api.options('/api/v1/x').set('Origin', 'http://web.test');
    expect(ok.headers['access-control-allow-origin']).toBe('http://web.test');
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    const evil = await api.get('/api/v1/x').set('Origin', 'http://evil.test');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('authentification et autorisation au bord', () => {
  it('jeton valide : contexte utilisateur propagé', async () => {
    const api = await gateway();
    const res = await api.get('/api/v1/me/wallet').set('Authorization', `Bearer ${await token()}`);
    expect(res.status).toBe(200);
    expect(res.body.headers).toMatchObject({
      'x-user-id': '11111111-1111-4111-8111-111111111111',
      'x-user-role': 'MEMBER',
      'x-session-id': 'session-1',
    });
    expect(res.body.headers.authorization).toMatch(/^Bearer /);
  });

  it('jeton falsifié, expiré, d’un autre émetteur ou mal formé → 401 sans appeler le service', async () => {
    const api = await gateway();
    let calls = 0;
    behaviour = (req, res, body) => {
      calls++;
      echo(req, res, body);
    };
    const bad = [
      `Bearer ${await token({}, { key: foreignKey })}`,
      `Bearer ${await token({}, { exp: '-1m' })}`,
      `Bearer ${await token({}, { issuer: 'someone-else' })}`,
      'Bearer not-a-jwt',
      'Basic dXNlcjpwYXNz',
    ];
    for (const h of bad) {
      const res = await api.get('/api/v1/me/wallet').set('Authorization', h);
      expect(res.status, h.slice(0, 20)).toBe(401);
      expect(res.headers['www-authenticate']).toContain('Bearer');
    }
    const noRole = await api
      .get('/api/v1/me/wallet')
      .set('Authorization', `Bearer ${await token({ role: undefined })}`);
    expect(noRole.status).toBe(401);
    expect(calls).toBe(0);
  });

  it('routes publiques sans jeton transmises (le service décide)', async () => {
    const api = await gateway();
    expect((await api.post('/api/v1/auth/login').send({})).status).toBe(200);
  });

  it('/admin et /reports : 401 sans jeton, 403 hors SUPER_ADMIN, transmis pour SUPER_ADMIN', async () => {
    const api = await gateway();
    expect((await api.get('/api/v1/admin/users')).status).toBe(401);
    for (const role of ['MEMBER', 'KYC_AGENT', 'TONTINE_ADMIN']) {
      const res = await api
        .get('/api/v1/reports/financial')
        .set('Authorization', `Bearer ${await token({ role })}`);
      expect(res.status, role).toBe(403);
    }
    const sa = await api
      .get('/api/v1/admin/users')
      .set('Authorization', `Bearer ${await token({ role: 'SUPER_ADMIN' })}`);
    expect(sa.status).toBe(200);
  });
});

describe('protections', () => {
  it('rate limiting global et plus strict sur /auth, avec Retry-After', async () => {
    const api = await gateway({
      GATEWAY_RATE_LIMIT_PER_MINUTE: '5',
      GATEWAY_AUTH_RATE_LIMIT_PER_MINUTE: '2',
    });
    expect((await api.post('/api/v1/auth/login')).status).toBe(200);
    expect((await api.post('/api/v1/auth/login')).status).toBe(200);
    const auth = await api.post('/api/v1/auth/login');
    expect(auth.status).toBe(429);
    expect(Number(auth.headers['retry-after'])).toBeGreaterThan(0);
    // 3 requêtes /auth déjà comptées dans la limite globale (5)
    expect((await api.get('/api/v1/x')).status).toBe(200);
    expect((await api.get('/api/v1/x')).status).toBe(200);
    expect((await api.get('/api/v1/x')).status).toBe(429);
  });

  it('corps trop volumineux → 413 (déclaré ou en flux)', async () => {
    const api = await gateway({ GATEWAY_MAX_BODY_BYTES: '2048' });
    const declared = await api
      .post('/api/v1/x')
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.alloc(4096));
    expect(declared.status).toBe(413);
  });

  it('service arrêté → 503 ; disjoncteur ouvert après N échecs, sans appel', async () => {
    const api = await gateway({
      API_UPSTREAM_URL: 'http://127.0.0.1:1',
      GATEWAY_CIRCUIT_FAILURES: '2',
    });
    expect((await api.get('/api/v1/x')).status).toBe(503);
    expect((await api.get('/api/v1/x')).status).toBe(503);
    const open = await api.get('/api/v1/x');
    expect(open.status).toBe(503);
    expect(open.headers['retry-after']).toBeDefined();
  });

  it('service trop lent → 504', async () => {
    behaviour = () => undefined; // ne répond jamais
    const api = await gateway({ GATEWAY_UPSTREAM_TIMEOUT_MS: '200' });
    const res = await api.get('/api/v1/x');
    expect(res.status).toBe(504);
    expect(res.body.code).toBe('UPSTREAM_TIMEOUT');
  });

  it('statut et corps d’erreur du service transmis tels quels', async () => {
    behaviour = (_req, res) => {
      res.writeHead(422, { 'Content-Type': 'application/problem+json' });
      res.end('{"code":"INSUFFICIENT_FUNDS"}');
    };
    const api = await gateway();
    const res = await api.post('/api/v1/me/wallet/transfers').send({});
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INSUFFICIENT_FUNDS');
  });
});

describe('santé et métriques', () => {
  it('/health, /health/ready (service amont), /metrics', async () => {
    behaviour = (req, res, body) => {
      if (req.url === '/health/ready') {
        res.writeHead(200).end('{"status":"ok"}');
      } else echo(req, res, body);
    };
    const api = await gateway();
    expect((await api.get('/health')).body).toEqual({ status: 'ok', service: 'api-gateway' });
    expect((await api.get('/health/ready')).status).toBe(200);
    await api.get('/api/v1/x');
    const m = await api.get('/metrics');
    expect(m.text).toContain('gateway_http_requests_total');
  });

  it('/health/ready → 503 si un service amont est indisponible', async () => {
    const api = await gateway({ API_UPSTREAM_URL: 'http://127.0.0.1:1' });
    const res = await api.get('/health/ready');
    expect(res.status).toBe(503);
  });
});

describe('composants', () => {
  it('adresse client : X-Forwarded-For ignoré sans proxy de confiance ; entrée du proxy retenue sinon', () => {
    expect(clientIp('::ffff:10.0.0.1', '6.6.6.6', 0)).toBe('10.0.0.1');
    expect(clientIp('10.0.0.1', '6.6.6.6, 41.1.1.1', 1)).toBe('41.1.1.1');
    expect(clientIp('10.0.0.1', '6.6.6.6, 41.1.1.1, 10.0.0.9', 2)).toBe('41.1.1.1');
    expect(clientIp('10.0.0.1', undefined, 1)).toBe('10.0.0.1');
  });

  it('limiteur : fenêtre d’une minute', () => {
    let t = 0;
    const l = new FixedWindowRateLimiter(2, 60_000, () => t);
    expect([l.hit('a').allowed, l.hit('a').allowed, l.hit('a').allowed]).toEqual([
      true,
      true,
      false,
    ]);
    expect(l.hit('b').allowed).toBe(true);
    t = 60_000;
    expect(l.hit('a').allowed).toBe(true);
  });

  it('disjoncteur : ouvert, semi-ouvert (un seul essai), refermé', () => {
    let t = 0;
    const b = new CircuitBreaker(2, 1000, () => t);
    b.failure();
    expect(b.current).toBe('CLOSED');
    b.failure();
    expect(b.tryAcquire()).toBe(false);
    t = 1000;
    expect(b.current).toBe('HALF_OPEN');
    expect(b.tryAcquire()).toBe(true);
    expect(b.tryAcquire()).toBe(false);
    b.success();
    expect(b.current).toBe('CLOSED');
    expect(b.tryAcquire()).toBe(true);
  });

  it('routes des services extraits : joker d’un segment, préfixe le plus long, défaut sinon', () => {
    const t = new RouteTable(
      [
        { prefix: '/api/v1/reports/', upstream: 'http://reporting' },
        { prefix: '/api/v1/tontines/*/reports', upstream: 'http://reporting' },
        { prefix: '/api/v1/admin/dashboard', upstream: 'http://reporting' },
      ],
      'http://api',
      false,
    );
    const up = (p: string) => t.resolve(p)?.upstream;
    expect(up('/api/v1/reports/financial')).toBe('http://reporting');
    expect(up('/api/v1/tontines/7b2c/reports?kind=CYCLE')).toBe('http://reporting');
    expect(up('/api/v1/tontines/7b2c/cycles')).toBe('http://api');
    expect(up('/api/v1/tontines//reports')).toBe('http://api');
    expect(up('/api/v1/tontines/a/b/reports')).toBe('http://api');
    expect(up('/api/v1/admin/dashboard')).toBe('http://reporting');
    expect(up('/api/v1/admin/users')).toBe('http://api');
    expect(t.upstreams()).toEqual(['http://api', 'http://reporting']);
  });

  it('configuration : JSON invalide ou préfixe hors /api/v1 refusés', () => {
    expect(() => loadGatewayConfig({ GATEWAY_ROUTES: '[' })).toThrow(/invalide/);
    expect(() =>
      loadGatewayConfig({
        GATEWAY_ROUTES: JSON.stringify([{ prefix: '/internal/', upstream: 'http://x' }]),
      }),
    ).toThrow(/invalide/);
    expect(() =>
      loadGatewayConfig({
        GATEWAY_ROUTES: JSON.stringify([{ prefix: '/api/v1/a*b/', upstream: 'http://x' }]),
      }),
    ).toThrow(/invalide/);
    expect(loadGatewayConfig({ NODE_ENV: 'production' }).exposeDocs).toBe(false);
  });
});
