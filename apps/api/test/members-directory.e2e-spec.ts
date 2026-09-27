import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TestContext, bearer, createTestContext } from './support/test-app';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.app.close();
});
beforeEach(async () => {
  await ctx.reset();
});

describe('Annuaire plateforme — GET /members', () => {
  it('le personnel liste les membres avec coordonnées masquées ; accès journalisé', async () => {
    const sa = await ctx.createUser({ role: 'SUPER_ADMIN' });
    const m = await ctx.createUser({ firstName: 'Awa', country: 'CM' });
    const res = await ctx.http.get('/api/v1/members?limit=100').set(bearer(await ctx.token(sa)));
    expect(res.status).toBe(200);
    const row = res.body.data.find((r: { id: string }) => r.id === m.id);
    expect(row).toMatchObject({ firstName: 'Awa', country: 'CM', status: 'ACTIVE' });
    expect(row.email).toMatch(/^u\*\*\*@/);
    expect(row.address).toBeUndefined();
    expect(
      await ctx.prisma.auditLog.count({ where: { action: 'member.directory.read_by_staff' } }),
    ).toBe(1);
  });

  it('un agent KYC y a accès ; un membre ou un admin de tontine → 403', async () => {
    const agent = await ctx.createUser({ role: 'KYC_AGENT' });
    expect((await ctx.http.get('/api/v1/members').set(bearer(await ctx.token(agent)))).status).toBe(
      200,
    );
    for (const role of ['MEMBER', 'TONTINE_ADMIN'] as const) {
      const u = await ctx.createUser({ role });
      const res = await ctx.http.get('/api/v1/members').set(bearer(await ctx.token(u)));
      expect(res.status).toBe(403);
    }
  });

  it('filtres (statut, niveau KYC, pays) et pagination par curseur sans doublon', async () => {
    const sa = await ctx.createUser({ role: 'SUPER_ADMIN', country: 'SN' });
    const token = await ctx.token(sa);
    await ctx.createUser({ memberStatus: 'KYC_REQUIRED', kycLevel: 'TIER_1', country: 'NG' });
    const ids = new Set<string>();
    for (let i = 0; i < 5; i++) ids.add((await ctx.createUser({ country: 'CM' })).id);

    const filtered = await ctx.http
      .get('/api/v1/members?status=KYC_REQUIRED&kycLevel=TIER_1&country=NG')
      .set(bearer(token));
    expect(filtered.body.data).toHaveLength(1);

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: { body: { data: Array<{ id: string }>; page: { nextCursor: string | null } } } =
        await ctx.http
          .get(
            `/api/v1/members?country=CM&limit=2&sort=name_asc${cursor ? `&cursor=${cursor}` : ''}`,
          )
          .set(bearer(token));
      seen.push(...page.body.data.map((r) => r.id));
      cursor = page.body.page.nextCursor;
    } while (cursor);
    expect(new Set(seen)).toEqual(ids);
    expect(seen).toHaveLength(ids.size);
  });

  it('paramètre inconnu ou invalide → 400', async () => {
    const token = await ctx.token(await ctx.createUser({ role: 'SUPER_ADMIN' }));
    expect((await ctx.http.get('/api/v1/members?status=NOPE').set(bearer(token))).status).toBe(400);
    expect((await ctx.http.get('/api/v1/members?foo=1').set(bearer(token))).status).toBe(400);
  });
});

describe('Recherche — GET /members/search', () => {
  it('trouve par nom ; les caractères LIKE sont échappés ; q obligatoire', async () => {
    const token = await ctx.token(await ctx.createUser({ role: 'SUPER_ADMIN' }));
    const m = await ctx.createUser({ lastName: 'Nkoulou' });
    await ctx.createUser({ lastName: 'Fotso' });
    const res = await ctx.http.get('/api/v1/members/search?q=nkou').set(bearer(token));
    expect(res.status).toBe(200);
    expect(res.body.data.map((r: { id: string }) => r.id)).toEqual([m.id]);
    const wildcard = await ctx.http.get('/api/v1/members/search?q=%25%25').set(bearer(token));
    expect(wildcard.body.data).toHaveLength(0);
    expect((await ctx.http.get('/api/v1/members/search').set(bearer(token))).status).toBe(400);
  });

  it('interdit aux membres', async () => {
    const u = await ctx.createUser();
    const res = await ctx.http.get('/api/v1/members/search?q=ab').set(bearer(await ctx.token(u)));
    expect(res.status).toBe(403);
  });
});

describe('Historique — GET /members/:id/history', () => {
  it('le membre lit son historique ; un autre membre → 403 + audit', async () => {
    const a = await ctx.createUser();
    const b = await ctx.createUser();
    const own = await ctx.http
      .get(`/api/v1/members/${a.id}/history`)
      .set(bearer(await ctx.token(a)));
    expect(own.status).toBe(200);
    expect(own.body.page).toMatchObject({ limit: 20 });
    const other = await ctx.http
      .get(`/api/v1/members/${a.id}/history`)
      .set(bearer(await ctx.token(b)));
    expect(other.status).toBe(403);
    expect(
      await ctx.prisma.auditLog.count({ where: { action: 'access.denied', resourceId: a.id } }),
    ).toBe(1);
  });

  it('le personnel voit les suspensions, pagine sans doublon ; lecture journalisée', async () => {
    const sa = await ctx.createUser({ role: 'SUPER_ADMIN' });
    const token = await ctx.token(sa);
    const m = await ctx.createUser();
    for (let i = 0; i < 2; i++) {
      await ctx.http
        .post(`/api/v1/members/${m.id}/suspend`)
        .set(bearer(token))
        .send({ reason: `Contrôle ${i}` });
      await ctx.http
        .post(`/api/v1/members/${m.id}/reactivate`)
        .set(bearer(token))
        .send({ reason: `Levée ${i}` });
    }
    const first = await ctx.http.get(`/api/v1/members/${m.id}/history?limit=3`).set(bearer(token));
    expect(first.status).toBe(200);
    expect(first.body.data).toHaveLength(3);
    expect(first.body.data[0].action).toBe('REACTIVATED');
    const second = await ctx.http
      .get(`/api/v1/members/${m.id}/history?limit=3&cursor=${first.body.page.nextCursor}`)
      .set(bearer(token));
    const ids = [...first.body.data, ...second.body.data].map((r: { id: string }) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(4);
    expect(
      await ctx.prisma.auditLog.count({
        where: { action: 'member.history.read_by_staff', resourceId: m.id },
      }),
    ).toBe(2);
  });

  it('curseur malformé ignoré ; membre inconnu → 404', async () => {
    const token = await ctx.token(await ctx.createUser({ role: 'SUPER_ADMIN' }));
    const m = await ctx.createUser();
    const bad = Buffer.from(JSON.stringify({ k: 'x', id: "1' OR 1=1" })).toString('base64url');
    expect(
      (await ctx.http.get(`/api/v1/members/${m.id}/history?cursor=${bad}`).set(bearer(token)))
        .status,
    ).toBe(200);
    expect(
      (await ctx.http.get(`/api/v1/members/${randomUUID()}/history`).set(bearer(token))).status,
    ).toBe(404);
  });
});

describe('Statut — GET/PATCH /members/:id/status', () => {
  it('PATCH SUSPENDED puis ACTIVE ; le motif est visible du personnel, pas du membre', async () => {
    const sa = await ctx.createUser({ role: 'SUPER_ADMIN' });
    const token = await ctx.token(sa);
    const m = await ctx.createUser();
    const suspended = await ctx.http
      .patch(`/api/v1/members/${m.id}/status`)
      .set(bearer(token))
      .send({ status: 'SUSPENDED', reason: 'Suspicion de fraude' });
    expect(suspended.status).toBe(200);
    expect(suspended.body.status).toBe('SUSPENDED');
    expect(
      await ctx.prisma.outboxEvent.count({
        where: { eventType: 'member.suspended', aggregateId: m.id },
      }),
    ).toBe(1);

    const staffView = await ctx.http.get(`/api/v1/members/${m.id}/status`).set(bearer(token));
    expect(staffView.body).toMatchObject({
      status: 'SUSPENDED',
      lastChange: { trigger: 'admin.suspend', reason: 'Suspicion de fraude', changedBy: sa.id },
    });
    const selfView = await ctx.http
      .get(`/api/v1/members/${m.id}/status`)
      .set(bearer(await ctx.token(m)));
    expect(selfView.status).toBe(200);
    expect(selfView.body.status).toBe('SUSPENDED');
    expect(selfView.body.lastChange.reason).toBeUndefined();

    const again = await ctx.http
      .patch(`/api/v1/members/${m.id}/status`)
      .set(bearer(token))
      .send({ status: 'SUSPENDED', reason: 'Doublon' });
    expect(again.status).toBe(422);

    const reactivated = await ctx.http
      .patch(`/api/v1/members/${m.id}/status`)
      .set(bearer(token))
      .send({ status: 'ACTIVE', reason: 'Vérification terminée' });
    expect(reactivated.body.status).toBe('ACTIVE');
  });

  it('seuls SUSPENDED et ACTIVE sont acceptés ; réservé au super-admin', async () => {
    const token = await ctx.token(await ctx.createUser({ role: 'SUPER_ADMIN' }));
    const m = await ctx.createUser();
    const bad = await ctx.http
      .patch(`/api/v1/members/${m.id}/status`)
      .set(bearer(token))
      .send({ status: 'KYC_IN_REVIEW', reason: 'x' });
    expect(bad.status).toBe(400);
    const agent = await ctx.createUser({ role: 'KYC_AGENT' });
    const denied = await ctx.http
      .patch(`/api/v1/members/${m.id}/status`)
      .set(bearer(await ctx.token(agent)))
      .send({ status: 'SUSPENDED', reason: 'x' });
    expect(denied.status).toBe(403);
  });

  it('un autre membre ne peut pas lire le statut', async () => {
    const a = await ctx.createUser();
    const b = await ctx.createUser();
    const res = await ctx.http
      .get(`/api/v1/members/${a.id}/status`)
      .set(bearer(await ctx.token(b)));
    expect(res.status).toBe(403);
  });
});

describe('Alias POST /members/:id/suspend et /reactivate', () => {
  it('équivalents aux routes /admin/members/* ; refusés au membre', async () => {
    const token = await ctx.token(await ctx.createUser({ role: 'SUPER_ADMIN' }));
    const m = await ctx.createUser();
    const s = await ctx.http
      .post(`/api/v1/members/${m.id}/suspend`)
      .set(bearer(token))
      .send({ reason: 'Test' });
    expect(s.status).toBe(200);
    expect(s.body.status).toBe('SUSPENDED');
    const r = await ctx.http
      .post(`/api/v1/admin/members/${m.id}/reactivate`)
      .set(bearer(token))
      .send({ reason: 'Test' });
    expect(r.body.status).toBe('ACTIVE');
    const other = await ctx.createUser();
    const denied = await ctx.http
      .post(`/api/v1/members/${m.id}/suspend`)
      .set(bearer(await ctx.token(other)))
      .send({ reason: 'Test' });
    expect(denied.status).toBe(403);
  });
});
