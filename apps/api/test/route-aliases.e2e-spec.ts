import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TestContext, bearer, createTestContext } from './support/test-app';
import { payCurrent, startTontine } from './support/tontine';

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

describe('Auth — alias', () => {
  it('GET /auth/profile = GET /auth/me ; PATCH /auth/profile = PATCH /me/profile', async () => {
    const m = await ctx.createUser();
    const token = await ctx.token(m);
    const me = await ctx.http.get('/api/v1/auth/me').set(bearer(token));
    const profile = await ctx.http.get('/api/v1/auth/profile').set(bearer(token));
    expect(profile.status).toBe(200);
    expect(profile.body).toEqual(me.body);
    const current = await ctx.http.get('/api/v1/me/profile').set(bearer(token));
    const patched = await ctx.http
      .patch('/api/v1/auth/profile')
      .set(bearer(token))
      .send({ version: current.body.version, city: 'Douala' });
    expect(patched.status).toBe(200);
    expect(patched.body.city).toBe('Douala');
  });

  it('POST /auth/register = demande de compte (réponse générique, soumise à validation)', async () => {
    const res = await ctx.http.post('/api/v1/auth/register').send({
      firstName: 'Rose',
      lastName: 'Atangana',
      email: 'rose@example.test',
      phone: '+237655443322',
      preferredChannel: 'EMAIL',
      captchaToken: 'ok-token',
    });
    expect(res.status).toBe(202);
    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'rose@example.test' } });
    expect(user.status).toBe('PENDING_APPROVAL');
  });

  it('POST /auth/enable-mfa = /auth/mfa/enable ; verify-email et verify-otp se comportent comme leurs routes', async () => {
    const m = await ctx.createUser();
    const res = await ctx.http
      .post('/api/v1/auth/enable-mfa')
      .set(bearer(await ctx.token(m)))
      .send({ type: 'TOTP' });
    expect(res.status).toBe(200);
    expect(res.body.secret).toEqual(expect.any(String));

    const bogusActivation = { token: 'x'.repeat(43), password: 'Tontine#2026-Secure' };
    const a = await ctx.http.post('/api/v1/auth/activate').send(bogusActivation);
    const b = await ctx.http.post('/api/v1/auth/verify-email').send(bogusActivation);
    expect(b.status).toBe(a.status);
    expect(b.body.code).toBe(a.body.code);

    const bogusMfa = { challengeId: randomUUID(), code: '123456' };
    const c = await ctx.http.post('/api/v1/auth/login/mfa').send(bogusMfa);
    const d = await ctx.http.post('/api/v1/auth/verify-otp').send(bogusMfa);
    expect(d.status).toBe(c.status);
  });
});

describe('KYC — alias et vue personnel', () => {
  it('status/history = me ; pending = reviews ; vue d’un membre par l’agent, journalisée', async () => {
    const m = await ctx.createUser();
    const token = await ctx.token(m);
    const me = await ctx.http.get('/api/v1/kyc/me').set(bearer(token));
    for (const path of ['status', 'history']) {
      const res = await ctx.http.get(`/api/v1/kyc/${path}`).set(bearer(token));
      expect(res.body).toEqual(me.body);
    }
    const agent = await ctx.createUser({ role: 'KYC_AGENT' });
    const agentToken = await ctx.token(agent);
    const pending = await ctx.http.get('/api/v1/kyc/pending').set(bearer(agentToken));
    expect(pending.body).toEqual(
      (await ctx.http.get('/api/v1/kyc/reviews').set(bearer(agentToken))).body,
    );
    const staff = await ctx.http.get(`/api/v1/kyc/${m.id}`).set(bearer(agentToken));
    expect(staff.status).toBe(200);
    expect(staff.body).toEqual({ memberId: m.id, ...me.body });
    expect(
      await ctx.prisma.auditLog.count({
        where: { action: 'kyc.status.read_by_staff', resourceId: m.id },
      }),
    ).toBe(1);
  });

  it('vue d’un membre : interdite aux membres ; membre inconnu → 404', async () => {
    const m = await ctx.createUser();
    const other = await ctx.createUser();
    expect(
      (await ctx.http.get(`/api/v1/kyc/${m.id}`).set(bearer(await ctx.token(other)))).status,
    ).toBe(403);
    const agent = await ctx.createUser({ role: 'KYC_AGENT' });
    expect(
      (await ctx.http.get(`/api/v1/kyc/${randomUUID()}`).set(bearer(await ctx.token(agent))))
        .status,
    ).toBe(404);
  });

  it('verify / reject : validation, dossier inconnu → 404, interdits aux membres', async () => {
    const agentToken = await ctx.token(await ctx.createUser({ role: 'KYC_AGENT' }));
    const short = await ctx.http
      .post('/api/v1/kyc/verify')
      .set(bearer(agentToken))
      .send({ requestId: randomUUID(), annotation: 'ok' });
    expect(short.status).toBe(400);
    const unknown = await ctx.http
      .post('/api/v1/kyc/verify')
      .set(bearer(agentToken))
      .send({ requestId: randomUUID(), annotation: 'Pièce et visage conformes' });
    expect(unknown.status).toBe(404);
    const noComment = await ctx.http
      .post('/api/v1/kyc/reject')
      .set(bearer(agentToken))
      .send({ requestId: randomUUID(), category: 'DOCUMENT_FALSIFIE', comment: '' });
    expect(noComment.status).toBe(400);
    const member = await ctx.createUser();
    const denied = await ctx.http
      .post('/api/v1/kyc/reject')
      .set(bearer(await ctx.token(member)))
      .send({ requestId: randomUUID(), category: 'DOCUMENT_FALSIFIE', comment: 'x' });
    expect(denied.status).toBe(403);
  });
});

describe('Invitations — accept / reject imbriqués', () => {
  async function tontineWithInvite() {
    const admin = await ctx.createUser({ kycLevel: 'TIER_3' });
    const adminToken = await ctx.token(admin);
    const t = await ctx.http
      .post('/api/v1/tontines')
      .set(bearer(adminToken))
      .send({
        name: `Tontine ${randomUUID().slice(0, 6)}`,
        contributionAmount: '10000',
        frequency: 'MONTHLY',
        frequencyDetail: { day: 'wednesday', weekOfMonth: 1 },
        maxMembers: 5,
        startDate: '2026-10-07',
        drawMode: 'RANDOM',
        penaltyRules: { graceDays: 3, lateFeePercent: 5, suspendAfter: 2, defaultAfterDays: 7 },
      });
    expect(t.status).toBe(201);
    const guest = await ctx.createUser();
    const inv = await ctx.http
      .post(`/api/v1/tontines/${t.body.id}/invitations`)
      .set(bearer(adminToken))
      .send({ channel: 'EMAIL', email: guest.email });
    expect(inv.status).toBe(201);
    return { tontineId: t.body.id as string, invitationId: inv.body.id as string, guest };
  }

  it('accept : adhésion créée ; reject : invitation refusée', async () => {
    const a = await tontineWithInvite();
    const acc = await ctx.http
      .post(`/api/v1/tontines/${a.tontineId}/invitations/${a.invitationId}/accept`)
      .set(bearer(await ctx.token(a.guest)));
    expect(acc.status).toBe(200);
    expect(
      await ctx.prisma.tontineMember.count({
        where: { tontineId: a.tontineId, memberId: a.guest.id },
      }),
    ).toBe(1);

    const b = await tontineWithInvite();
    const rej = await ctx.http
      .post(`/api/v1/tontines/${b.tontineId}/invitations/${b.invitationId}/reject`)
      .set(bearer(await ctx.token(b.guest)));
    expect(rej.status).toBe(200);
    expect(rej.body.invitation.status).toBe('DECLINED');
  });

  it('invitation d’une autre tontine via la route imbriquée → 404', async () => {
    const a = await tontineWithInvite();
    const b = await tontineWithInvite();
    const res = await ctx.http
      .post(`/api/v1/tontines/${b.tontineId}/invitations/${a.invitationId}/accept`)
      .set(bearer(await ctx.token(a.guest)));
    expect(res.status).toBe(404);
    expect(await ctx.prisma.tontineMember.count({ where: { memberId: a.guest.id } })).toBe(0);
  });
});

describe('Contributions — routes à plat', () => {
  it('GET /contributions = /me/contributions ; /contributions/:id : débiteur et admin, 404 pour un autre participant', async () => {
    const s = await startTontine(ctx);
    const [admin, bella, carl] = s.users;
    const token = await ctx.token(bella!);
    const list = await ctx.http.get('/api/v1/contributions').set(bearer(token));
    expect(list.body).toEqual(
      (await ctx.http.get('/api/v1/me/contributions').set(bearer(token))).body,
    );
    const id = list.body.data[0].id as string;
    const own = await ctx.http.get(`/api/v1/contributions/${id}`).set(bearer(token));
    expect(own.status).toBe(200);
    expect(own.body).toEqual(list.body.data[0]);
    const byAdmin = await ctx.http
      .get(`/api/v1/contributions/${id}`)
      .set(bearer(await ctx.token(admin!)));
    expect(byAdmin.status).toBe(200);
    const byPeer = await ctx.http
      .get(`/api/v1/contributions/${id}`)
      .set(bearer(await ctx.token(carl!)));
    expect(byPeer.status).toBe(404);
  });

  it('POST /contributions/:id/pay règle l’échéance ; clé d’idempotence obligatoire ; pas celle d’autrui', async () => {
    const s = await startTontine(ctx);
    const [, bella, carl] = s.users;
    const c = await ctx.prisma.contribution.findFirstOrThrow({
      where: { tontineId: s.tontineId, memberId: bella!.id },
    });
    const token = await ctx.token(bella!);
    expect(
      (await ctx.http.post(`/api/v1/contributions/${c.id}/pay`).set(bearer(token)).send()).status,
    ).toBe(400);
    const peer = await ctx.http
      .post(`/api/v1/contributions/${c.id}/pay`)
      .set(bearer(await ctx.token(carl!)))
      .set('Idempotency-Key', randomUUID())
      .send();
    expect(peer.status).toBe(404);
    const paid = await ctx.http
      .post(`/api/v1/contributions/${c.id}/pay`)
      .set(bearer(token))
      .set('Idempotency-Key', randomUUID())
      .send();
    expect(paid.status).toBe(200);
    expect((await ctx.prisma.contribution.findUniqueOrThrow({ where: { id: c.id } })).status).toBe(
      'PAID',
    );
    // la route imbriquée voit la même échéance déjà réglée
    expect((await payCurrent(ctx, s, bella!)).status).toBe(200);
  });
});
