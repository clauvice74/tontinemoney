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

/** Publie un user.registered comme le ferait le domaine Auth. */
async function emitRegistered(payload: Partial<Record<string, unknown>> = {}) {
  const userId = randomUUID();
  const outbox = ctx.app.get((await import('@tontine/platform')).OutboxService);
  const uow = ctx.app.get((await import('@tontine/platform')).UnitOfWork);
  const env = await uow.run((tx) =>
    outbox.add(tx, {
      type: 'user.registered',
      aggregateType: 'user',
      aggregateId: userId,
      payload: {
        userId,
        firstName: 'Jean',
        lastName: 'Kamga',
        email: `jean-${userId.slice(0, 6)}@example.test`,
        phone: null,
        country: null,
        language: null,
        role: 'MEMBER',
        preferredChannel: 'SMS',
        registeredBy: null,
        tontineId: null,
        ...payload,
      } as never,
    }),
  );
  return { userId, env };
}

describe('US-2.1 — création automatique du profil membre', () => {
  it('nominal +237 : pays CM, langue fr-CM, fuseau Africa/Douala, PENDING, NONE, version 1, member.created émis', async () => {
    const { userId } = await emitRegistered({ phone: '+237699554433' });
    await ctx.drain();
    const m = await ctx.prisma.member.findUnique({ where: { id: userId } });
    expect(m).toMatchObject({
      countryCode: 'CM',
      language: 'fr-CM',
      timezone: 'Africa/Douala',
      status: 'PENDING',
      kycLevel: 'NONE',
      version: 1,
    });
    expect(m?.notificationPrefs).toMatchObject({
      preferredChannel: 'SMS',
      quietHours: { start: '22:00', end: '07:00' },
    });
    const evt = await ctx.prisma.outboxEvent.findFirst({
      where: { eventType: 'member.created', aggregateId: userId },
    });
    expect(evt?.payload).toMatchObject({
      memberId: userId,
      country: 'CM',
      language: 'fr-CM',
      status: 'PENDING',
    });
  });

  it('+1 → Canada par défaut, fr-CA', async () => {
    const { userId } = await emitRegistered({ phone: '+15145550101' });
    await ctx.drain();
    expect(await ctx.prisma.member.findUnique({ where: { id: userId } })).toMatchObject({
      countryCode: 'CA',
      language: 'fr-CA',
      timezone: 'America/Toronto',
    });
  });

  it('idempotence : le même événement reçu deux fois ne crée pas de doublon', async () => {
    const { userId, env } = await emitRegistered({ phone: '+237699554433' });
    await ctx.drain();
    // Rejeu du même eventId (at-least-once) : remise en file manuelle
    await ctx.prisma.outboxEvent.update({
      where: { id: env.eventId },
      data: { status: 'PENDING', nextAttemptAt: new Date(0) },
    });
    await ctx.drain();
    expect(await ctx.prisma.member.count({ where: { id: userId } })).toBe(1);
    expect(
      await ctx.prisma.outboxEvent.count({
        where: { eventType: 'member.created', aggregateId: userId },
      }),
    ).toBe(1);
  });

  it('sans téléphone ni pays : country_code NULL, statut PENDING, aucun wallet', async () => {
    const { userId } = await emitRegistered();
    await ctx.drain();
    expect(await ctx.prisma.member.findUnique({ where: { id: userId } })).toMatchObject({
      countryCode: null,
      status: 'PENDING',
    });
    expect(await ctx.prisma.wallet.findUnique({ where: { memberId: userId } })).toBeNull();
  });
});

describe('US-5.1 — création automatique du wallet', () => {
  it('à la réception de member.created : solde 0, devise du pays, ACTIVE, wallet.created émis', async () => {
    const { userId } = await emitRegistered({ phone: '+2348031234567' });
    await ctx.drain();
    const w = await ctx.prisma.wallet.findUnique({ where: { memberId: userId } });
    expect(w).toMatchObject({ currency: 'NGN', status: 'ACTIVE', ownerType: 'MEMBER' });
    expect(w?.balanceMinor).toBe(0n);
    expect(w?.blockedMinor).toBe(0n);
    expect(
      await ctx.prisma.outboxEvent.count({
        where: { eventType: 'wallet.created', aggregateId: w!.id },
      }),
    ).toBe(1);
  });

  it('idempotent : rejeu de member.created sans second wallet', async () => {
    const { userId } = await emitRegistered({ phone: '+237699554433' });
    await ctx.drain();
    const evt = await ctx.prisma.outboxEvent.findFirstOrThrow({
      where: { eventType: 'member.created', aggregateId: userId },
    });
    await ctx.prisma.processedEvent.deleteMany({ where: { eventId: evt.id } });
    await ctx.prisma.outboxEvent.update({
      where: { id: evt.id },
      data: { status: 'PENDING', nextAttemptAt: new Date(0) },
    });
    await ctx.drain();
    expect(await ctx.prisma.wallet.count({ where: { memberId: userId } })).toBe(1);
  });

  it('création différée quand le pays est renseigné plus tard (profil)', async () => {
    const { userId } = await emitRegistered();
    await ctx.drain();
    await ctx.prisma.user.create({
      data: {
        id: userId,
        email: `late-${userId.slice(0, 6)}@example.test`,
        role: 'MEMBER',
        status: 'ACTIVE',
        firstName: 'Jean',
        lastName: 'Kamga',
        passwordHash: await (await import('@tontine/auth')).hashSecret('Tontine#2026-Secure', 4),
      },
    });
    const login = await ctx.http.post('/api/v1/auth/login').send({
      identifier: `late-${userId.slice(0, 6)}@example.test`,
      password: 'Tontine#2026-Secure',
    });
    const res = await ctx.http
      .patch('/api/v1/me/profile')
      .set(bearer(login.body.accessToken))
      .send({ version: 1, country: 'CI' });
    expect(res.status).toBe(200);
    await ctx.drain();
    expect(await ctx.prisma.wallet.findUnique({ where: { memberId: userId } })).toMatchObject({
      currency: 'XOF',
    });
  });

  it('le membre consulte son solde (total / disponible / bloqué)', async () => {
    const u = await ctx.createUser();
    const res = await ctx.http.get('/api/v1/me/wallet').set(bearer(await ctx.token(u)));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      currency: 'XAF',
      status: 'ACTIVE',
      balance: { amount: '0' },
      available: { amount: '0' },
      blocked: { amount: '0' },
    });
  });
});

describe('US-2.5 — isolation des données du membre', () => {
  it('un membre accède à son propre profil, jamais à celui d’un autre (403 + audit)', async () => {
    const a = await ctx.createUser();
    const b = await ctx.createUser();
    const token = await ctx.token(a);
    expect((await ctx.http.get(`/api/v1/members/${a.id}`).set(bearer(token))).status).toBe(200);
    const res = await ctx.http.get(`/api/v1/members/${b.id}`).set(bearer(token));
    expect(res.status).toBe(403);
    const audit = await ctx.prisma.auditLog.findFirst({
      where: { action: 'access.denied', resourceId: b.id },
    });
    expect(audit?.actorId).toBe(a.id);
  });

  it('injection d’identifiant / manipulation d’URL → toujours refusé', async () => {
    const a = await ctx.createUser();
    const token = await ctx.token(a);
    for (const id of ['../admin', `${a.id}' OR '1'='1`, 'not-a-uuid']) {
      const res = await ctx.http
        .get(`/api/v1/members/${encodeURIComponent(id)}`)
        .set(bearer(token));
      expect([400, 403, 404]).toContain(res.status);
    }
    const random = await ctx.http.get(`/api/v1/members/${randomUUID()}`).set(bearer(token));
    expect(random.status).toBe(403);
  });

  it('le wallet et l’historique sont toujours ceux du porteur du jeton', async () => {
    const a = await ctx.createUser();
    const b = await ctx.createUser({ country: 'NG' });
    const res = await ctx.http.get('/api/v1/me/wallet').set(bearer(await ctx.token(b)));
    expect(res.body.currency).toBe('NGN');
    const resA = await ctx.http.get('/api/v1/me/wallet').set(bearer(await ctx.token(a)));
    expect(resA.body.id).not.toBe(res.body.id);
  });

  it('co-participant d’une tontine : nom et prénom uniquement ; admin de la tontine : vue restreinte sans données sensibles', async () => {
    const admin = await ctx.createUser({ role: 'TONTINE_ADMIN' });
    const t = await ctx.createTontine(admin.id);
    const a = await ctx.createUser({ firstName: 'Awa' });
    const b = await ctx.createUser({ firstName: 'Bello' });
    await ctx.addParticipant(t.id, a.id);
    await ctx.addParticipant(t.id, b.id);
    await ctx.prisma.member.update({ where: { id: b.id }, data: { address: '12 rue secrète' } });
    const peer = await ctx.http.get(`/api/v1/members/${b.id}`).set(bearer(await ctx.token(a)));
    expect(peer.status).toBe(200);
    expect(peer.body).toEqual({
      id: b.id,
      firstName: 'Bello',
      lastName: expect.any(String),
      view: 'NAME_ONLY',
    });
    const adminView = await ctx.http
      .get(`/api/v1/members/${b.id}`)
      .set(bearer(await ctx.token(admin)));
    expect(adminView.body.view).toBe('LIMITED');
    expect(adminView.body.address).toBeUndefined();
    expect(adminView.body.email).toMatch(/^u\*\*\*@/);
  });

  it('un super-admin peut consulter un profil (accès journalisé)', async () => {
    const sa = await ctx.createUser({ role: 'SUPER_ADMIN' });
    const m = await ctx.createUser();
    const res = await ctx.http.get(`/api/v1/members/${m.id}`).set(bearer(await ctx.token(sa)));
    expect(res.status).toBe(200);
    expect(
      await ctx.prisma.auditLog.count({
        where: { action: 'member.profile.read_by_staff', resourceId: m.id },
      }),
    ).toBe(1);
  });

  it('sans jeton → 401 ; jeton falsifié → 401', async () => {
    const m = await ctx.createUser();
    expect((await ctx.http.get('/api/v1/me/profile')).status).toBe(401);
    const token = await ctx.token(m);
    const forged = `${token.slice(0, -4)}AAAA`;
    expect((await ctx.http.get('/api/v1/me/profile').set(bearer(forged))).status).toBe(401);
  });

  it('alerte si fréquence anormale de refus d’accès (> 20 en 10 min)', async () => {
    const a = await ctx.createUser();
    const b = await ctx.createUser();
    const token = await ctx.token(a);
    for (let i = 0; i < 21; i++) await ctx.http.get(`/api/v1/members/${b.id}`).set(bearer(token));
    expect(
      await ctx.prisma.auditLog.count({
        where: { action: 'security.alert.access_denied_burst', resourceId: a.id },
      }),
    ).toBe(1);
  });
});
