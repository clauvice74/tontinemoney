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

async function saToken() {
  return ctx.token(await ctx.createUser({ role: 'SUPER_ADMIN' }));
}

describe('PATCH /admin/users/:id/status', () => {
  it('suspension : sessions révoquées, jeton refusé aussitôt, connexion impossible ; réactivation', async () => {
    const sa = await saToken();
    const m = await ctx.createUser();
    const memberToken = await ctx.token(m);
    expect((await ctx.http.get('/api/v1/auth/me').set(bearer(memberToken))).status).toBe(200);

    const res = await ctx.http
      .patch(`/api/v1/admin/users/${m.id}/status`)
      .set(bearer(sa))
      .send({ status: 'SUSPENDED', reason: 'Enquête en cours' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: m.id, status: 'SUSPENDED' });
    expect(res.body.revokedSessions).toBeGreaterThanOrEqual(1);
    expect((await ctx.http.get('/api/v1/auth/me').set(bearer(memberToken))).status).toBe(401);
    expect(
      await ctx.prisma.outboxEvent.count({
        where: { eventType: 'user.status.changed', aggregateId: m.id },
      }),
    ).toBe(1);
    expect(
      await ctx.prisma.auditLog.count({ where: { action: 'user.suspended', resourceId: m.id } }),
    ).toBe(1);

    const again = await ctx.http
      .patch(`/api/v1/admin/users/${m.id}/status`)
      .set(bearer(sa))
      .send({ status: 'SUSPENDED', reason: 'Doublon' });
    expect(again.status).toBe(422);

    await ctx.http
      .patch(`/api/v1/admin/users/${m.id}/status`)
      .set(bearer(sa))
      .send({ status: 'ACTIVE', reason: 'Enquête close' })
      .expect(200);
    expect((await ctx.http.get('/api/v1/auth/me').set(bearer(await ctx.token(m)))).status).toBe(
      200,
    );
  });

  it('garde-fous : pas son propre compte, motif obligatoire, statut limité, réservé au super-admin', async () => {
    const saUser = await ctx.createUser({ role: 'SUPER_ADMIN' });
    const sa = await ctx.token(saUser);
    const m = await ctx.createUser();
    await ctx.http
      .patch(`/api/v1/admin/users/${saUser.id}/status`)
      .set(bearer(sa))
      .send({ status: 'SUSPENDED', reason: 'Test' })
      .expect(403);
    await ctx.http
      .patch(`/api/v1/admin/users/${m.id}/status`)
      .set(bearer(sa))
      .send({ status: 'SUSPENDED', reason: '' })
      .expect(400);
    await ctx.http
      .patch(`/api/v1/admin/users/${m.id}/status`)
      .set(bearer(sa))
      .send({ status: 'REJECTED', reason: 'Test' })
      .expect(400);
    await ctx.http
      .patch(`/api/v1/admin/users/${randomUUID()}/status`)
      .set(bearer(sa))
      .send({ status: 'SUSPENDED', reason: 'Test' })
      .expect(404);
    const agent = await ctx.createUser({ role: 'COMPLIANCE_AGENT' });
    await ctx.http
      .patch(`/api/v1/admin/users/${m.id}/status`)
      .set(bearer(await ctx.token(agent)))
      .send({ status: 'SUSPENDED', reason: 'Test' })
      .expect(403);
  });
});

describe('Paramètres — /admin/configurations', () => {
  it('liste : 4 paramètres avec défaut, description et version 0', async () => {
    const res = await ctx.http.get('/api/v1/admin/configurations').set(bearer(await saToken()));
    expect(res.status).toBe(200);
    expect(res.body.data.map((c: { key: string }) => c.key).sort()).toEqual([
      'auth.sessions.max',
      'compliance.violations.suspendAfter',
      'notifications.sms.dailyLimit',
      'tontines.invitations.ttlDays',
    ]);
    expect(res.body.data.find((c: { key: string }) => c.key === 'auth.sessions.max')).toMatchObject(
      {
        value: 5,
        default: 5,
        overridden: false,
        version: 0,
      },
    );
  });

  it('auth.sessions.max = 1 : la session précédente est révoquée à la connexion suivante', async () => {
    const sa = await saToken();
    await ctx.http
      .patch('/api/v1/admin/configurations/auth.sessions.max')
      .set(bearer(sa))
      .send({ value: 1, reason: 'Une seule session par compte', version: 0 })
      .expect(200);
    const m = await ctx.createUser();
    const first = await ctx.login(m);
    await ctx.login(m);
    const refresh = await ctx.http
      .post('/api/v1/auth/refresh')
      .set('Cookie', first.cookie)
      .send({});
    expect(refresh.status).toBe(401);
    expect(
      await ctx.prisma.refreshSession.count({ where: { userId: m.id, revokedAt: null } }),
    ).toBe(1);
  });

  it('tontines.invitations.ttlDays = 2 : nouvelle invitation valable 2 jours', async () => {
    const sa = await saToken();
    await ctx.http
      .patch('/api/v1/admin/configurations/tontines.invitations.ttlDays')
      .set(bearer(sa))
      .send({ value: 2, reason: 'Relances plus rapides', version: 0 })
      .expect(200);
    const admin = await ctx.createUser({ kycLevel: 'TIER_3' });
    const t = await ctx.createTontine(admin.id);
    const guest = await ctx.createUser();
    const inv = await ctx.http
      .post(`/api/v1/tontines/${t.id}/invitations`)
      .set(bearer(await ctx.token(admin)))
      .send({ channel: 'EMAIL', email: guest.email });
    expect(inv.status).toBe(201);
    const row = await ctx.prisma.tontineInvitation.findUniqueOrThrow({
      where: { id: inv.body.id },
    });
    expect(row.expiresAt.getTime() - ctx.clock.now().getTime()).toBe(2 * 86_400_000);
  });

  it('bornes, clé inconnue, conflit de version, historique en ajout seul, audit et événement', async () => {
    const sa = await saToken();
    const url = '/api/v1/admin/configurations/notifications.sms.dailyLimit';
    for (const value of [0, 101, 2.5, '10', null]) {
      const res = await ctx.http
        .patch(url)
        .set(bearer(sa))
        .send({ value, reason: 'Test', version: 0 });
      expect(res.status, JSON.stringify(value)).toBe(400);
    }
    await ctx.http
      .patch('/api/v1/admin/configurations/auth.otp.maxAttempts')
      .set(bearer(sa))
      .send({ value: 10, reason: 'Test', version: 0 })
      .expect(404);
    const ok = await ctx.http
      .patch(url)
      .set(bearer(sa))
      .send({ value: 20, reason: 'Campagne', version: 0 });
    expect(ok.body).toMatchObject({ value: 20, overridden: true, version: 1 });
    const stale = await ctx.http
      .patch(url)
      .set(bearer(sa))
      .send({ value: 30, reason: 'Autre', version: 0 });
    expect(stale.status).toBe(409);
    await ctx.http
      .patch(url)
      .set(bearer(sa))
      .send({ value: 5, reason: 'Retour', version: 1 })
      .expect(200);
    const history = await ctx.http.get(`${url}/history`).set(bearer(sa));
    expect(history.body.data.map((h: { newValue: number }) => h.newValue)).toEqual([5, 20]);
    expect(history.body.data[1]).toMatchObject({ oldValue: 10, reason: 'Campagne' });
    await expect(
      ctx.prisma.configurationHistory.updateMany({ data: { reason: 'falsifié' } }),
    ).rejects.toThrow();
    expect(
      await ctx.prisma.outboxEvent.count({ where: { eventType: 'admin.configuration.updated' } }),
    ).toBe(2);
    expect(
      await ctx.prisma.auditLog.count({ where: { action: 'admin.configuration.updated' } }),
    ).toBe(2);
  });

  it('réservé au super-admin', async () => {
    const agent = await ctx.createUser({ role: 'COMPLIANCE_AGENT' });
    await ctx.http
      .get('/api/v1/admin/configurations')
      .set(bearer(await ctx.token(agent)))
      .expect(403);
  });
});

describe('GET /admin/dashboard', () => {
  it('comptes par statut, demandes en attente, dossiers non assignés, exploitation', async () => {
    const sa = await saToken();
    const suspended = await ctx.createUser();
    await ctx.http
      .patch(`/api/v1/admin/users/${suspended.id}/status`)
      .set(bearer(sa))
      .send({ status: 'SUSPENDED', reason: 'Test' })
      .expect(200);
    const res = await ctx.http.get('/api/v1/admin/dashboard').set(bearer(sa));
    expect(res.status).toBe(200);
    expect(res.body.accounts.byStatus).toMatchObject({ SUSPENDED: 1 });
    expect(res.body.accounts.byStatus.ACTIVE).toBeGreaterThanOrEqual(1);
    expect(res.body).toMatchObject({
      accounts: { pendingAccessRequests: 0 },
      compliance: { unassignedOpenCases: 0 },
      operations: { deadEvents: 0 },
    });
    const member = await ctx.createUser();
    await ctx.http
      .get('/api/v1/admin/dashboard')
      .set(bearer(await ctx.token(member)))
      .expect(403);
  });
});
