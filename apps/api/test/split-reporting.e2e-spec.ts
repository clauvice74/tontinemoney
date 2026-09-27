import { type AddressInfo } from 'node:net';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { signInternalRequest } from '@tontine/auth';
import { testConfig } from '@tontine/config';
import {
  DeadLetterStore,
  EventDispatcher,
  OutboxRelay,
  PostgresTransport,
  encodeWire,
} from '@tontine/platform';
import { createReportingService } from '@tontine/reporting-service';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TestContext, bearer, createTestContext } from './support/test-app';
import { startTontine } from './support/tontine';

/**
 * Étape 7 (A-55) : le reporting dans son propre processus. Deux applications Nest distinctes,
 * reliées uniquement par le journal d'événements PostgreSQL (un groupe chacune) et par des
 * appels internes signés vers les ports du monolithe (jetons, comptes, membres, tontines).
 */
let ctx: TestContext;
let reporting: NestExpressApplication;
let reportingRelay: OutboxRelay;
let monolithUrl: string;

beforeAll(async () => {
  ctx = await createTestContext({
    EVENT_TRANSPORT: 'postgres',
    EVENT_GROUP: 'api',
    EXTRACTED_SERVICES: 'reporting',
  });
  await ctx.app.listen(0, '127.0.0.1');
  monolithUrl = `http://127.0.0.1:${(ctx.app.getHttpServer().address() as AddressInfo).port}`;
  reporting = await createReportingService({
    config: testConfig({
      EVENT_TRANSPORT: 'postgres',
      EVENT_GROUP: 'reporting',
      SERVICE_NAME: 'reporting',
      PORTS_UPSTREAM_URL: monolithUrl,
    }),
    clock: ctx.clock,
  });
  await reporting.init();
  reportingRelay = reporting.get(OutboxRelay);
});
afterAll(async () => {
  await reporting?.close();
  await ctx?.app.close();
});
beforeEach(async () => {
  await ctx.reset();
  await ctx.prisma.eventSubscription.deleteMany();
});

/** Publication du journal puis consommation par chacun des deux processus. */
async function sync() {
  for (let i = 0; i < 4; i++) {
    await ctx.drain();
    await reportingRelay.drain();
  }
}

describe('Reporting extrait (processus distinct)', () => {
  it('le monolithe ne sert plus les rapports ; le reporting-service les sert à partir du journal', async () => {
    const admin = await ctx.token(await ctx.createUser({ role: 'SUPER_ADMIN' }));
    const u = await ctx.createUser();
    await ctx.fund(u.id, 42_000n);
    await sync();

    await ctx.http.get('/api/v1/reports/financial').set(bearer(admin)).expect(404);
    const res = await request(reporting.getHttpServer())
      .get('/api/v1/reports/financial?from=2026-09-01&to=2026-09-30')
      .set(bearer(admin));
    expect(res.status).toBe(200);
    const deposit = res.body.rows.find(
      (r: { section: string; indicator: string }) =>
        r.section === 'Transactions réalisées' && r.indicator === 'DEPOSIT',
    );
    expect(deposit).toMatchObject({ count: 1, amountMinor: '42000' });

    // Chaque groupe avance sa propre position dans le journal
    const groups = await ctx.prisma.eventSubscription.findMany({ orderBy: { group: 'asc' } });
    expect(groups.map((g) => g.group)).toEqual(['api', 'reporting']);
    const last = await ctx.prisma.outboxEvent.aggregate({ _max: { deliverySeq: true } });
    for (const g of groups) expect(g.position).toBe(last._max.deliverySeq);
    // Tableau de bord : comptes obtenus par appel interne (port ACCOUNT_DIRECTORY)
    const dash = await request(reporting.getHttpServer())
      .get('/api/v1/admin/dashboard')
      .set(bearer(admin))
      .expect(200);
    expect(dash.body.accounts.byStatus['ACTIVE']).toBeGreaterThanOrEqual(2);
  });

  it('jeton vérifié par le propriétaire (Auth) : absent → 401, révoqué → 401, rôle insuffisant → 403', async () => {
    const http = () => request(reporting.getHttpServer());
    await http().get('/api/v1/reports/financial').expect(401);
    const member = await ctx.createUser();
    await http()
      .get('/api/v1/reports/financial')
      .set(bearer(await ctx.token(member)))
      .expect(403);
    const sa = await ctx.createUser({ role: 'SUPER_ADMIN' });
    const token = await ctx.token(sa);
    await ctx.prisma.refreshSession.updateMany({
      where: { userId: sa.id },
      data: { revokedAt: ctx.clock.now() },
    });
    await http().get('/api/v1/reports/financial').set(bearer(token)).expect(401);
  });

  it('rapport de tontine : droit d’administration vérifié par le domaine Tontine', async () => {
    const s = await startTontine(ctx);
    await sync();
    const http = () => request(reporting.getHttpServer());
    const ok = await http()
      .get(`/api/v1/tontines/${s.tontineId}/reports?kind=CYCLE`)
      .set(bearer(await ctx.token(s.admin)));
    expect(ok.status).toBe(200);
    expect(ok.body.table.columns).toContain('Bénéficiaire');
    await http()
      .get(`/api/v1/tontines/${s.tontineId}/reports?kind=CYCLE`)
      .set(bearer(await ctx.token(s.users[1]!)))
      .expect(403);
    await http()
      .get(`/api/v1/tontines/${crypto.randomUUID()}/reports?kind=CYCLE`)
      .set(bearer(await ctx.token(s.admin)))
      .expect(404);
  });
});

describe('Ports internes (monolithe)', () => {
  const call = (
    path: string,
    args: unknown[],
    caller = 'reporting',
    secret = ctx.config.INTERNAL_SERVICE_SECRET,
  ) => {
    const body = encodeWire(args);
    return request(monolithUrl)
      .post(`/api/v1/internal/ports/${path}`)
      .set('content-type', 'application/json')
      .set(signInternalRequest(secret, caller, body, ctx.clock.now()))
      .send(body);
  };

  it('signature, appelant et méthode vérifiés ; méthodes hors liste refusées', async () => {
    const u = await ctx.createUser();
    const ok = await call('members.query/snapshots', [[u.id]]);
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.text).v).toMatchObject({ ok: true });
    expect((await call('members.query/snapshots', [[u.id]], 'intrus')).status).toBe(401);
    expect(
      (await call('members.query/snapshots', [[u.id]], 'reporting', 'x'.repeat(40))).status,
    ).toBe(401);
    expect((await call('wallets.query/memberBalance', [u.id])).status).toBe(200);
    expect((await call('tontines.access/resolveInvitationCode', ['x'])).status).toBe(404);
    expect((await call('auth.tokens/issue', [u.id])).status).toBe(404);
    const unsigned = await request(monolithUrl)
      .post('/api/v1/internal/ports/members.query/snapshots')
      .send(encodeWire([[u.id]]));
    expect(unsigned.status).toBe(401);
  });

  it('erreur métier du propriétaire relayée à l’identique (code)', async () => {
    const res = await call('auth.tokens/verify', ['jeton-invalide']);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.text).v).toMatchObject({ ok: false, error: { code: 'INVALID_TOKEN' } });
  });
});

describe('Transport PostgreSQL', () => {
  it('deux instances d’un même groupe : une seule consomme (bail) ; l’autre reprend après expiration', async () => {
    const dispatcher = ctx.app.get(EventDispatcher);
    const store = ctx.app.get(DeadLetterStore);
    const opts = { group: 'bail-test', maxAttempts: 1, pollIntervalMs: 1000 };
    const a = new PostgresTransport(ctx.prisma, dispatcher, store, opts);
    const b = new PostgresTransport(ctx.prisma, dispatcher, store, opts);
    await ctx.createUser();
    await ctx.drain();
    expect(await a.consumeOnce()).toBeGreaterThan(0);
    expect(await b.consumeOnce()).toBe(0);
    await ctx.prisma.eventSubscription.update({
      where: { group: 'bail-test' },
      data: { leaseUntil: new Date(Date.now() - 1000) },
    });
    await ctx.createUser();
    await ctx.drain();
    expect(await b.consumeOnce()).toBeGreaterThan(0);
    expect(await a.consumeOnce()).toBe(0);
  });
});
