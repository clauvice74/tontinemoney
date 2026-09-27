import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TestContext, type TestUser, bearer, createTestContext } from './support/test-app';

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

const validBody = (overrides: Record<string, unknown> = {}) => ({
  name: 'Tontine des commerçants',
  contributionAmount: '50000',
  frequency: 'MONTHLY',
  frequencyDetail: { day: 'wednesday', weekOfMonth: 1 },
  maxMembers: 10,
  startDate: '2026-10-07',
  drawMode: 'RANDOM',
  penaltyRules: { graceDays: 3, lateFeePercent: 5, suspendAfter: 2 },
  entryFee: '2000',
  collation: '1000',
  ...overrides,
});

async function createVia(token: string, body = validBody()) {
  return ctx.http.post('/api/v1/tontines').set(bearer(token)).send(body);
}

describe('US-4.1 — création d’une tontine', () => {
  let creator: TestUser;
  let token: string;

  beforeEach(async () => {
    creator = await ctx.createUser({ kycLevel: 'TIER_3' });
    token = await ctx.token(creator);
  });

  it('nominal : DRAFT, créateur admin, wallets pool/réserve, événement tontine.created', async () => {
    const res = await createVia(token);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: 'DRAFT',
      myRole: 'ADMIN',
      memberCount: 1,
      currency: 'XAF',
      contribution: { amountMinor: '50000', currency: 'XAF' },
      penaltyRules: { graceDays: 3, lateFeePercent: 5, suspendAfter: 2, defaultAfterDays: 7 },
      entryFee: { amountMinor: '2000' },
      collation: { amountMinor: '1000' },
      timezone: 'Africa/Douala',
    });
    const t = await ctx.prisma.tontine.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(t.lateFeeBps).toBe(500);
    expect(t.poolWalletId).not.toBeNull();
    expect(t.reserveWalletId).not.toBeNull();
    const m = await ctx.prisma.tontineMember.findFirstOrThrow({ where: { tontineId: t.id } });
    expect(m).toMatchObject({
      memberId: creator.id,
      role: 'ADMIN',
      status: 'ACTIVE',
      entryFeePaid: false,
    });
    expect(
      await ctx.prisma.outboxEvent.count({
        where: { eventType: 'tontine.created', aggregateId: t.id },
      }),
    ).toBe(1);
    const list = await ctx.http.get('/api/v1/tontines').set(bearer(token));
    expect(list.body.data).toHaveLength(1);
  });

  it('KYC TIER_2 : refusé (R-TON-02)', async () => {
    const m = await ctx.createUser({ kycLevel: 'TIER_2' });
    const res = await createVia(await ctx.token(m));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('KYC_LEVEL_INSUFFICIENT');
  });

  it('délégation du super-admin (A-04) : une seule tontine sans TIER_3', async () => {
    const admin = await ctx.createUser({ role: 'TONTINE_ADMIN', kycLevel: 'NONE' });
    await ctx.prisma.user.update({
      where: { id: admin.id },
      data: { delegatedTontineName: 'Tontine Solidarité' },
    });
    const t = await ctx.token(admin);
    const first = await createVia(t, validBody({ name: 'Tontine Solidarité' }));
    expect(first.status).toBe(201);
    expect(
      (await ctx.prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).delegatedTontineUsed,
    ).toBe(true);
    const second = await createVia(t, validBody({ name: 'Deuxième tontine' }));
    expect(second.status).toBe(422);
    expect(second.body.code).toBe('KYC_LEVEL_INSUFFICIENT');
  });

  it('date de début < aujourd’hui + 7 jours : refusée', async () => {
    const res = await createVia(token, validBody({ startDate: '2026-09-30' }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it.each([
    ['nom trop court', { name: 'ab' }],
    ['montant nul', { contributionAmount: '0' }],
    ['décimales XAF', { contributionAmount: '100.5' }],
    ['max membres < 3', { maxMembers: 2 }],
    ['max membres > 50', { maxMembers: 51 }],
    ['fréquence inconnue', { frequency: 'DAILY' }],
    ['hebdo sans jour', { frequency: 'WEEKLY', frequencyDetail: {} }],
    ['pénalité > 100 %', { penaltyRules: { graceDays: 3, lateFeePercent: 150, suspendAfter: 2 } }],
    ['droit d’entrée négatif', { entryFee: '-5' }],
    ['champ inconnu', { foo: 'bar' }],
  ])('validation serveur : %s', async (_label, patch) => {
    const res = await createVia(token, validBody(patch));
    expect(res.status).toBe(400);
  });

  it('collation ≥ pot minimal : refusée', async () => {
    const res = await createVia(token, validBody({ collation: '150000' }));
    expect(res.status).toBe(400);
  });

  it('nom unique par créateur', async () => {
    expect((await createVia(token)).status).toBe(201);
    const dup = await createVia(token);
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('DUPLICATE_NAME');
    const other = await ctx.createUser({ kycLevel: 'TIER_3' });
    expect((await createVia(await ctx.token(other))).status).toBe(201);
  });

  it('devise différente du wallet : CURRENCY_MISMATCH (A-11)', async () => {
    const res = await createVia(token, validBody({ currency: 'EUR', contributionAmount: '50' }));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('CURRENCY_MISMATCH');
  });

  it('agent KYC : route interdite', async () => {
    const agent = await ctx.createUser({ role: 'KYC_AGENT' });
    const res = await createVia(await ctx.token(agent));
    expect(res.status).toBe(403);
  });

  it('isolation : un non-participant reçoit 404', async () => {
    const res = await createVia(token);
    const outsider = await ctx.createUser();
    const other = await ctx.http
      .get(`/api/v1/tontines/${res.body.id}`)
      .set(bearer(await ctx.token(outsider)));
    expect(other.status).toBe(404);
  });

  it('annulation avant démarrage uniquement, par l’admin', async () => {
    const res = await createVia(token);
    const member = await ctx.createUser();
    await ctx.addParticipant(res.body.id, member.id);
    const forbidden = await ctx.http
      .post(`/api/v1/tontines/${res.body.id}/cancel`)
      .set(bearer(await ctx.token(member)))
      .send({ reason: 'Je veux annuler' });
    expect(forbidden.status).toBe(403);
    const ok = await ctx.http
      .post(`/api/v1/tontines/${res.body.id}/cancel`)
      .set(bearer(token))
      .send({ reason: 'Projet abandonné' });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('CANCELLED');
    const again = await ctx.http
      .post(`/api/v1/tontines/${res.body.id}/cancel`)
      .set(bearer(token))
      .send({ reason: 'Projet abandonné' });
    expect(again.status).toBe(422);
    expect(again.body.code).toBe('INVALID_STATE_TRANSITION');
  });
});

describe('US-4.2 — invitations', () => {
  let admin: TestUser;
  let adminToken: string;
  let tontineId: string;

  beforeEach(async () => {
    admin = await ctx.createUser({ kycLevel: 'TIER_3' });
    adminToken = await ctx.token(admin);
    tontineId = (await createVia(adminToken, validBody({ maxMembers: 4 }))).body.id;
  });

  const invite = (body: Record<string, unknown>, token = adminToken) =>
    ctx.http.post(`/api/v1/tontines/${tontineId}/invitations`).set(bearer(token)).send(body);

  it('invitation par email d’un membre existant : notification avec nom, montant, fréquence, date', async () => {
    const guest = await ctx.createUser({ firstName: 'Bello' });
    const res = await invite({ channel: 'EMAIL', email: guest.email });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      channel: 'EMAIL',
      status: 'PENDING',
      invitedUserId: guest.id,
    });
    expect(
      new Date(res.body.expiresAt).getTime() - new Date('2026-09-24T09:00:00Z').getTime(),
    ).toBe(7 * 86_400_000);
    const notif = await ctx.prisma.notification.findFirstOrThrow({
      where: { recipientId: guest.id, templateKey: 'tontine.invitation' },
    });
    expect(notif.body).toContain('Tontine des commerçants');
    expect(notif.body).toContain('2026-10-07');
    expect(notif.body).toMatch(/50\D000/);
    expect(
      await ctx.prisma.outboxEvent.count({ where: { eventType: 'tontine.invitation.sent' } }),
    ).toBe(1);
  });

  it('invitation par téléphone d’une personne sans compte : SMS direct', async () => {
    const res = await invite({ channel: 'PHONE', phone: '+237699887766' });
    expect(res.status).toBe(201);
    expect(res.body.invitedUserId).toBeNull();
    const sms = await ctx.lastMessage('+237699887766');
    expect(sms?.channel).toBe('SMS');
    expect(sms?.body).toContain('Tontine des commerçants');
  });

  it('acceptation : éligible → adhésion ACTIVE, tontine.member.added ; passage READY à 3 membres (A-05)', async () => {
    const b = await ctx.createUser();
    const c = await ctx.createUser();
    for (const u of [b, c]) {
      const inv = await invite({ channel: 'EMAIL', email: u.email });
      const token = await ctx.token(u);
      const mine = await ctx.http.get('/api/v1/me/invitations').set(bearer(token));
      expect(mine.body.data[0]).toMatchObject({
        id: inv.body.id,
        tontine: { name: 'Tontine des commerçants' },
      });
      const acc = await ctx.http
        .post(`/api/v1/invitations/${inv.body.id}/respond`)
        .set(bearer(token))
        .send({ accept: true });
      expect(acc.status).toBe(200);
      expect(acc.body.membership).toMatchObject({ status: 'ACTIVE', role: 'MEMBER' });
      expect(acc.body.invitation.status).toBe('ACCEPTED');
    }
    await ctx.drain();
    const t = await ctx.http.get(`/api/v1/tontines/${tontineId}`).set(bearer(adminToken));
    expect(t.body).toMatchObject({ status: 'READY', memberCount: 3 });
    const participants = await ctx.http
      .get(`/api/v1/tontines/${tontineId}/participants`)
      .set(bearer(await ctx.token(b)));
    expect(participants.body.data).toHaveLength(3);
    expect(participants.body.data[0]).not.toHaveProperty('email');
  });

  it('refus d’une invitation', async () => {
    const b = await ctx.createUser();
    const inv = await invite({ channel: 'EMAIL', email: b.email });
    const res = await ctx.http
      .post(`/api/v1/invitations/${inv.body.id}/respond`)
      .set(bearer(await ctx.token(b)))
      .send({ accept: false });
    expect(res.status).toBe(200);
    expect(res.body.invitation.status).toBe('DECLINED');
    expect(await ctx.prisma.tontineMember.count({ where: { tontineId, memberId: b.id } })).toBe(0);
  });

  it('non éligible (KYC TIER_1, devise incompatible) : 422 avec motifs, invitation toujours en attente', async () => {
    const low = await ctx.createUser({ kycLevel: 'TIER_1' });
    const inv = await invite({ channel: 'EMAIL', email: low.email });
    const res = await ctx.http
      .post(`/api/v1/invitations/${inv.body.id}/respond`)
      .set(bearer(await ctx.token(low)))
      .send({ accept: true });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('MEMBER_NOT_ELIGIBLE');
    expect(res.body.reasons.join(' ')).toContain('niveau 2');
    expect(
      (await ctx.prisma.tontineInvitation.findUniqueOrThrow({ where: { id: inv.body.id } })).status,
    ).toBe('PENDING');

    const ivorian = await ctx.createUser({ country: 'CI' });
    const inv2 = await invite({ channel: 'EMAIL', email: ivorian.email });
    const res2 = await ctx.http
      .post(`/api/v1/invitations/${inv2.body.id}/respond`)
      .set(bearer(await ctx.token(ivorian)))
      .send({ accept: true });
    expect(res2.status).toBe(422);
    expect(res2.body.reasons.join(' ')).toContain('XAF');
  });

  it('une invitation ne peut être acceptée que par son destinataire', async () => {
    const b = await ctx.createUser();
    const intruder = await ctx.createUser();
    const inv = await invite({ channel: 'EMAIL', email: b.email });
    const res = await ctx.http
      .post(`/api/v1/invitations/${inv.body.id}/respond`)
      .set(bearer(await ctx.token(intruder)))
      .send({ accept: true });
    expect(res.status).toBe(404);
  });

  it('lien partageable : aperçu public, adhésion, expiration à capacité maximale', async () => {
    const link = await invite({ channel: 'LINK' });
    expect(link.status).toBe(201);
    expect(link.body.url).toContain(`/invitations/${link.body.code}`);
    const preview = await ctx.http.get(`/api/v1/invitations/code/${link.body.code}`);
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({
      spotsLeft: 3,
      tontine: { name: 'Tontine des commerçants', startDate: '2026-10-07' },
    });
    const users = [
      await ctx.createUser(),
      await ctx.createUser(),
      await ctx.createUser(),
      await ctx.createUser(),
    ];
    for (const u of users.slice(0, 3)) {
      const r = await ctx.http
        .post(`/api/v1/invitations/code/${link.body.code}/accept`)
        .set(bearer(await ctx.token(u)))
        .send();
      expect(r.status).toBe(200);
    }
    // maxMembers = 4 atteint → le lien expire
    const late = await ctx.http
      .post(`/api/v1/invitations/code/${link.body.code}/accept`)
      .set(bearer(await ctx.token(users[3]!)))
      .send();
    expect(late.status).toBe(404);
    expect(
      (await ctx.prisma.tontineInvitation.findUniqueOrThrow({ where: { id: link.body.id } }))
        .status,
    ).toBe('EXPIRED');
    // capacité atteinte : nouvelle invitation impossible
    const full = await invite({ channel: 'EMAIL', email: users[3]!.email });
    expect(full.status).toBe(422);
    expect(full.body.code).toBe('TONTINE_FULL');
  });

  it('adhésions concurrentes : jamais plus que maxMembers', async () => {
    const link = await invite({ channel: 'LINK' });
    const users = await Promise.all(Array.from({ length: 6 }, () => ctx.createUser()));
    const tokens = await Promise.all(users.map((u) => ctx.token(u)));
    const results = await Promise.all(
      tokens.map((t) =>
        ctx.http.post(`/api/v1/invitations/code/${link.body.code}/accept`).set(bearer(t)).send(),
      ),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(3);
    expect(await ctx.prisma.tontineMember.count({ where: { tontineId, status: 'ACTIVE' } })).toBe(
      4,
    );
  });

  it('expiration après 7 jours', async () => {
    const b = await ctx.createUser();
    const inv = await invite({ channel: 'EMAIL', email: b.email });
    ctx.clock.advanceDays(8);
    const res = await ctx.http
      .post(`/api/v1/invitations/${inv.body.id}/respond`)
      .set(bearer(await ctx.token(b)))
      .send({ accept: true });
    expect(res.status).toBe(410);
    const other = await invite({ channel: 'LINK' }, await ctx.token(admin));
    ctx.clock.advanceDays(8);
    const job = await ctx.jobs.run('tontines.expire-invitations', 'test');
    expect(job.summary['expired']).toBe(1);
    expect(
      (await ctx.prisma.tontineInvitation.findUniqueOrThrow({ where: { id: other.body.id } }))
        .status,
    ).toBe('EXPIRED');
  });

  it('révocation d’une invitation non acceptée', async () => {
    const b = await ctx.createUser();
    const inv = await invite({ channel: 'EMAIL', email: b.email });
    const del = await ctx.http
      .delete(`/api/v1/tontines/${tontineId}/invitations/${inv.body.id}`)
      .set(bearer(adminToken));
    expect(del.status).toBe(200);
    expect(del.body.status).toBe('REVOKED');
    const res = await ctx.http
      .post(`/api/v1/invitations/${inv.body.id}/respond`)
      .set(bearer(await ctx.token(b)))
      .send({ accept: true });
    expect(res.status).toBe(422);
    const again = await ctx.http
      .delete(`/api/v1/tontines/${tontineId}/invitations/${inv.body.id}`)
      .set(bearer(adminToken));
    expect(again.status).toBe(422);
  });

  it('seul l’admin de la tontine invite ; doublon et membre existant refusés', async () => {
    const b = await ctx.createUser();
    await ctx.addParticipant(tontineId, b.id);
    const byMember = await invite({ channel: 'LINK' }, await ctx.token(b));
    expect(byMember.status).toBe(403);
    const existing = await invite({ channel: 'EMAIL', email: b.email });
    expect(existing.status).toBe(409);
    const c = await ctx.createUser();
    expect((await invite({ channel: 'PHONE', phone: c.phone })).status).toBe(201);
    expect((await invite({ channel: 'PHONE', phone: c.phone })).status).toBe(409);
  });

  it('invitations impossibles après démarrage (A-06)', async () => {
    await ctx.prisma.tontine.update({ where: { id: tontineId }, data: { status: 'ACTIVE' } });
    const res = await invite({ channel: 'LINK' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INVALID_STATE_TRANSITION');
  });
});
