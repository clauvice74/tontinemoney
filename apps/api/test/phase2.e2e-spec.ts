import { sha256Hex } from '@tontine/auth';
import { OutboxService, UnitOfWork } from '@tontine/platform';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PASSWORD, type TestContext, bearer, createTestContext } from './support/test-app';

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

const requestBody = (over: Record<string, unknown> = {}) => ({
  firstName: 'Rose',
  lastName: 'Atangana',
  email: 'rose@example.test',
  phone: '+237655443322',
  preferredChannel: 'EMAIL',
  captchaToken: 'ok-token',
  ...over,
});

async function emit(type: string, aggregateId: string, payload: Record<string, unknown>) {
  const outbox = ctx.app.get(OutboxService);
  const uow = ctx.app.get(UnitOfWork);
  await uow.run((tx) =>
    outbox.add(tx, {
      type: type as never,
      aggregateType: 'test',
      aggregateId,
      payload: payload as never,
    }),
  );
  await ctx.drain();
}

describe('US-1.3 — demande de compte par un invité', () => {
  it('avec code d’invitation : compte PENDING_APPROVAL, admin de la tontine notifié, message de confirmation', async () => {
    const admin = await ctx.createUser({ role: 'TONTINE_ADMIN' });
    const t = await ctx.createTontine(admin.id);
    await ctx.prisma.tontine.update({
      where: { id: t.id },
      data: {
        invitationLinkHash: sha256Hex('INVITE-CODE-1'),
        invitationLinkExpires: new Date('2027-01-01T00:00:00Z'),
      },
    });
    const res = await ctx.http
      .post('/api/v1/auth/request-account')
      .send(requestBody({ invitationCode: 'INVITE-CODE-1' }));
    expect(res.status).toBe(202);
    expect(res.body.message).toBe('Votre demande est en cours de validation');
    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'rose@example.test' } });
    expect(user.status).toBe('PENDING_APPROVAL');
    expect(user.passwordHash).toBeNull();
    const req = await ctx.prisma.accessRequest.findFirstOrThrow({ where: { userId: user.id } });
    expect(req).toMatchObject({ status: 'PENDING', targetTontineId: t.id });
    expect(req.expiresAt.getTime() - ctx.clock.now().getTime()).toBe(30 * 86_400_000);
    await ctx.drain();
    expect(
      await ctx.prisma.outboxEvent.count({ where: { eventType: 'user.approval.requested' } }),
    ).toBe(1);
    expect(
      await ctx.prisma.notification.count({
        where: { recipientId: admin.id, templateKey: 'auth.access_request_received' },
      }),
    ).toBeGreaterThan(0);
    // Aucun accès tant que la demande n'est pas approuvée
    expect(
      (
        await ctx.http
          .post('/api/v1/auth/login')
          .send({ identifier: 'rose@example.test', password: PASSWORD })
      ).status,
    ).toBe(401);
  });

  it('sans code : super-admin notifié', async () => {
    const sa = await ctx.createUser({ role: 'SUPER_ADMIN' });
    await ctx.http.post('/api/v1/auth/request-account').send(requestBody()).expect(202);
    await ctx.drain();
    expect(
      await ctx.prisma.notification.count({
        where: { recipientId: sa.id, templateKey: 'auth.access_request_received' },
      }),
    ).toBeGreaterThan(0);
  });

  it('email existant : réponse générique identique, aucun compte créé (pas de fuite)', async () => {
    const existing = await ctx.createUser();
    const res = await ctx.http
      .post('/api/v1/auth/request-account')
      .send(requestBody({ email: existing.email }));
    expect(res.status).toBe(202);
    expect(res.body.message).toBe('Votre demande est en cours de validation');
    expect(await ctx.prisma.accessRequest.count()).toBe(0);
  });

  it('captcha échoué : rejet silencieux', async () => {
    const res = await ctx.http
      .post('/api/v1/auth/request-account')
      .send(requestBody({ captchaToken: 'fail' }));
    expect(res.status).toBe(202);
    expect(await ctx.prisma.user.count({ where: { email: 'rose@example.test' } })).toBe(0);
  });

  it('au plus 3 demandes non traitées simultanément ; 5 demandes / heure / IP', async () => {
    for (let i = 0; i < 3; i++) {
      await ctx.http
        .post('/api/v1/auth/request-account')
        .set('X-Forwarded-For', '198.51.100.7')
        .send(requestBody({ email: `r${i}@example.test`, phone: `+23765544330${i}` }))
        .expect(202);
    }
    const fourth = await ctx.http
      .post('/api/v1/auth/request-account')
      .set('X-Forwarded-For', '198.51.100.7')
      .send(requestBody({ email: 'r9@example.test', phone: '+237655443309' }));
    expect(fourth.status).toBe(429);
  });

  it('expiration après 30 jours : EXPIRED + notification à l’utilisateur', async () => {
    await ctx.http.post('/api/v1/auth/request-account').send(requestBody()).expect(202);
    await ctx.drain();
    ctx.clock.advanceDays(31);
    const run = await ctx.jobs.run('auth.expire-access-requests', 'test');
    expect(run.summary).toEqual({ expired: 1 });
    await ctx.drain();
    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'rose@example.test' } });
    expect(user.status).toBe('EXPIRED');
    expect(
      await ctx.prisma.notification.count({
        where: { recipientId: user.id, templateKey: 'auth.access_expired' },
      }),
    ).toBeGreaterThan(0);
  });
});

describe('US-10.1 / US-2.4 — validation des demandes d’accès', () => {
  async function pendingRequest(targetTontineId?: string) {
    if (targetTontineId) {
      await ctx.prisma.tontine.update({
        where: { id: targetTontineId },
        data: {
          invitationLinkHash: sha256Hex('CODE-X'),
          invitationLinkExpires: new Date('2027-01-01T00:00:00Z'),
        },
      });
    }
    await ctx.http
      .post('/api/v1/auth/request-account')
      .send(requestBody(targetTontineId ? { invitationCode: 'CODE-X' } : {}))
      .expect(202);
    await ctx.drain();
    return ctx.prisma.accessRequest.findFirstOrThrow({
      where: { user: { email: 'rose@example.test' } },
    });
  }

  it('super-admin : liste, acceptation → PENDING_ACTIVATION + lien d’activation', async () => {
    const sa = await ctx.createUser({ role: 'SUPER_ADMIN' });
    const req = await pendingRequest();
    const token = await ctx.token(sa);
    const list = await ctx.http.get('/api/v1/access-requests').set(bearer(token));
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].user).toMatchObject({ firstName: 'Rose', email: 'rose@example.test' });
    const res = await ctx.http
      .post(`/api/v1/access-requests/${req.id}/decision`)
      .set(bearer(token))
      .send({ decision: 'APPROVE' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'APPROVED', userStatus: 'PENDING_ACTIVATION' });
    expect((await ctx.lastMessage('rose@example.test'))?.body).toMatch(/\/activate\//);
  });

  it('refus sans motif → 400 ; avec motif → REJECTED, données archivées, notification avec motif', async () => {
    const sa = await ctx.createUser({ role: 'SUPER_ADMIN' });
    const req = await pendingRequest();
    const token = await ctx.token(sa);
    const noReason = await ctx.http
      .post(`/api/v1/access-requests/${req.id}/decision`)
      .set(bearer(token))
      .send({ decision: 'REJECT', reason: '' });
    expect(noReason.status).toBe(400);
    expect(noReason.body.code).toBe('REASON_REQUIRED');
    await ctx.http
      .post(`/api/v1/access-requests/${req.id}/decision`)
      .set(bearer(token))
      .send({ decision: 'REJECT', reason: 'Profil incomplet' })
      .expect(200);
    await ctx.drain();
    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'rose@example.test' } });
    expect(user.status).toBe('REJECTED'); // archivé, pas supprimé
    const n = await ctx.prisma.notification.findFirst({
      where: { recipientId: user.id, templateKey: 'auth.access_rejected' },
    });
    expect(n?.body).toContain('Profil incomplet');
  });

  it('US-2.4 : l’admin de la tontine ciblée accepte ; adhésion en attente d’activation ; journalisé dans MemberAuditLog', async () => {
    const admin = await ctx.createUser({ role: 'TONTINE_ADMIN' });
    const t = await ctx.createTontine(admin.id);
    const req = await pendingRequest(t.id);
    const res = await ctx.http
      .post(`/api/v1/access-requests/${req.id}/decision`)
      .set(bearer(await ctx.token(admin)))
      .send({ decision: 'APPROVE' });
    expect(res.status).toBe(200);
    await ctx.drain();
    const membership = await ctx.prisma.tontineMember.findFirstOrThrow({
      where: { tontineId: t.id, memberId: req.userId },
    });
    expect(membership.status).toBe('PENDING_ACTIVATION');
    expect(
      await ctx.prisma.memberAuditLog.count({
        where: { memberId: req.userId, trigger: 'access.decision' },
      }),
    ).toBe(1);
    expect(
      await ctx.prisma.notification.count({
        where: { recipientId: req.userId, templateKey: 'member.accepted' },
      }),
    ).toBeGreaterThan(0);
  });

  it('US-2.4 : admin d’une autre tontine → 403', async () => {
    const admin = await ctx.createUser({ role: 'TONTINE_ADMIN' });
    const t = await ctx.createTontine(admin.id);
    const other = await ctx.createUser({ role: 'TONTINE_ADMIN' });
    await ctx.createTontine(other.id);
    const req = await pendingRequest(t.id);
    const res = await ctx.http
      .post(`/api/v1/access-requests/${req.id}/decision`)
      .set(bearer(await ctx.token(other)))
      .send({ decision: 'APPROVE' });
    expect(res.status).toBe(403);
  });

  it('parcours complet : acceptation → activation → connexion', async () => {
    const sa = await ctx.createUser({ role: 'SUPER_ADMIN' });
    const req = await pendingRequest();
    await ctx.http
      .post(`/api/v1/access-requests/${req.id}/decision`)
      .set(bearer(await ctx.token(sa)))
      .send({ decision: 'APPROVE' });
    const link = /activate\/([0-9a-f-]{36})/.exec(
      (await ctx.lastMessage('rose@example.test'))!.body,
    )![1];
    await ctx.http
      .post('/api/v1/auth/activate')
      .send({ token: link, password: PASSWORD })
      .expect(200);
    await ctx.http
      .post('/api/v1/auth/login')
      .send({ identifier: 'rose@example.test', password: PASSWORD })
      .expect(200);
  });
});

describe('US-1.5 — réinitialisation du mot de passe', () => {
  it('email existant ou non : même réponse générique ; lien 1 h envoyé si le compte existe', async () => {
    const u = await ctx.createUser();
    const a = await ctx.http.post('/api/v1/auth/forgot-password').send({ identifier: u.email });
    const b = await ctx.http
      .post('/api/v1/auth/forgot-password')
      .send({ identifier: 'personne@example.test' });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body).toEqual(b.body);
    expect(a.body.message).toBe('Si un compte existe, un lien vous a été envoyé');
    expect((await ctx.lastMessage(u.email))?.body).toMatch(/reset-password\/[0-9a-f-]{36}/);
    expect(await ctx.lastMessage('personne@example.test')).toBeNull();
  });

  async function resetToken(email: string) {
    await ctx.http.post('/api/v1/auth/forgot-password').send({ identifier: email });
    return /reset-password\/([0-9a-f-]{36})/.exec((await ctx.lastMessage(email))!.body)![1]!;
  }

  it('nominal : nouveau mot de passe, toutes les sessions fermées, jeton consommé, confirmation envoyée', async () => {
    const u = await ctx.createUser();
    const s1 = await ctx.login(u);
    const token = await resetToken(u.email);
    await ctx.http
      .post('/api/v1/auth/reset-password')
      .send({ token, newPassword: 'Nouveau#Secret2026' })
      .expect(204);
    expect((await ctx.http.get('/api/v1/auth/me').set(bearer(s1.token))).status).toBe(401);
    expect(
      (await ctx.http.post('/api/v1/auth/login').send({ identifier: u.email, password: PASSWORD }))
        .status,
    ).toBe(401);
    await ctx.http
      .post('/api/v1/auth/login')
      .send({ identifier: u.email, password: 'Nouveau#Secret2026' })
      .expect(200);
    const reuse = await ctx.http
      .post('/api/v1/auth/reset-password')
      .send({ token, newPassword: 'Encore#Autre2026x' });
    expect(reuse.status).toBe(410);
    expect(reuse.body.title).toBe('Lien déjà utilisé');
    await ctx.drain();
    expect(
      await ctx.prisma.notification.count({
        where: { recipientId: u.id, templateKey: 'auth.password_reset_done' },
      }),
    ).toBeGreaterThan(0);
  });

  it('jeton expiré après 1 h → 410 « Lien expiré »', async () => {
    const u = await ctx.createUser();
    const token = await resetToken(u.email);
    ctx.clock.advance(3600_000 + 1);
    const res = await ctx.http
      .post('/api/v1/auth/reset-password')
      .send({ token, newPassword: 'Nouveau#Secret2026' });
    expect(res.status).toBe(410);
    expect(res.body.title).toBe('Lien expiré, refaites une demande');
  });

  it('mot de passe trop simple → 400 ; identique à un des 5 derniers → 400', async () => {
    const u = await ctx.createUser();
    const token = await resetToken(u.email);
    const weak = await ctx.http
      .post('/api/v1/auth/reset-password')
      .send({ token, newPassword: '123456' });
    expect(weak.status).toBe(400);
    expect(weak.body.code).toBe('WEAK_PASSWORD');
    const same = await ctx.http
      .post('/api/v1/auth/reset-password')
      .send({ token, newPassword: PASSWORD });
    expect(same.status).toBe(400);
    expect(same.body.title).toBe('Le mot de passe doit être différent des 5 derniers');
  });

  it('3 demandes par heure maximum (silencieux au-delà)', async () => {
    const u = await ctx.createUser();
    for (let i = 0; i < 5; i++)
      await ctx.http.post('/api/v1/auth/forgot-password').send({ identifier: u.email }).expect(200);
    expect(
      await ctx.prisma.authToken.count({ where: { userId: u.id, type: 'PASSWORD_RESET' } }),
    ).toBe(3);
  });
});

describe('US-2.2 — complétion du profil', () => {
  it('changement de langue : profil mis à jour, delta émis, communications futures en anglais', async () => {
    const u = await ctx.createUser();
    const token = await ctx.token(u);
    const me = await ctx.http.get('/api/v1/me/profile').set(bearer(token));
    const res = await ctx.http
      .patch('/api/v1/me/profile')
      .set(bearer(token))
      .send({ version: me.body.version, language: 'en-CM' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ language: 'en-CM', version: me.body.version + 1 });
    const evt = await ctx.prisma.outboxEvent.findFirstOrThrow({
      where: { eventType: 'member.updated', aggregateId: u.id },
    });
    expect(evt.payload).toMatchObject({
      changedFields: ['language'],
      oldValues: { language: 'fr-CM' },
      newValues: { language: 'en-CM' },
    });
    const audit = await ctx.prisma.memberAuditLog.findFirstOrThrow({
      where: { memberId: u.id, action: 'UPDATED' },
    });
    expect(audit.oldValues).toEqual({ language: 'fr-CM' });
    await ctx.drain();
    await ctx.prisma.outboxEvent.deleteMany({}); // isole la suite
    // notification suivante rendue en anglais
    await emit('member.kyc.required', u.id, { memberId: u.id });
    const n = await ctx.prisma.notification.findFirstOrThrow({
      where: { recipientId: u.id, templateKey: 'member.kyc_required', channel: 'IN_APP' },
    });
    expect(n.title).toBe('Verify your identity');
  });

  it('profil complet : PENDING → KYC_REQUIRED', async () => {
    const u = await ctx.createUser({ memberStatus: 'PENDING', kycLevel: 'TIER_1' });
    await ctx.prisma.member.update({
      where: { id: u.id },
      data: { countryCode: null, countrySource: null },
    });
    const token = await ctx.token(u);
    const res = await ctx.http
      .patch('/api/v1/me/profile')
      .set(bearer(token))
      .send({ version: 1, country: 'CM', city: 'Douala' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('KYC_REQUIRED');
    expect(
      await ctx.prisma.outboxEvent.count({
        where: { eventType: 'member.kyc.required', aggregateId: u.id },
      }),
    ).toBe(1);
  });

  it('conflit de version → 409 « Profil modifié entre-temps »', async () => {
    const u = await ctx.createUser();
    const token = await ctx.token(u);
    await ctx.http
      .patch('/api/v1/me/profile')
      .set(bearer(token))
      .send({ version: 1, city: 'Yaoundé' })
      .expect(200);
    const res = await ctx.http
      .patch('/api/v1/me/profile')
      .set(bearer(token))
      .send({ version: 1, city: 'Douala' });
    expect(res.status).toBe(409);
    expect(res.body.title).toBe('Profil modifié entre-temps');
  });

  it('modification concurrente : une seule écriture l’emporte (verrou optimiste)', async () => {
    const u = await ctx.createUser();
    const token = await ctx.token(u);
    const results = await Promise.all(
      ['Bafoussam', 'Garoua', 'Kribi'].map((city) =>
        ctx.http.patch('/api/v1/me/profile').set(bearer(token)).send({ version: 1, city }),
      ),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(2);
  });

  it('changement de nom après KYC → 403 « Modification interdite après KYC »', async () => {
    const u = await ctx.createUser({ kycLevel: 'TIER_2' });
    const res = await ctx.http
      .patch('/api/v1/me/profile')
      .set(bearer(await ctx.token(u)))
      .send({ version: 1, lastName: 'Autre' });
    expect(res.status).toBe(403);
    expect(res.body.title).toBe('Modification interdite après KYC');
  });

  it('photo trop grande (15 Mo) → 413 ; type non image → 415 ; PNG valide accepté', async () => {
    const u = await ctx.createUser();
    const token = await ctx.token(u);
    const big = Buffer.alloc(15 * 1024 * 1024, 0xff);
    const tooBig = await ctx.http
      .post('/api/v1/me/profile/photo')
      .set(bearer(token))
      .attach('file', big, 'photo.jpg');
    expect(tooBig.status).toBe(413);
    const bad = await ctx.http
      .post('/api/v1/me/profile/photo')
      .set(bearer(token))
      .attach('file', Buffer.from('%PDF-1.7'), 'doc.png');
    expect(bad.status).toBe(415);
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(100),
    ]);
    await ctx.http
      .post('/api/v1/me/profile/photo')
      .set(bearer(token))
      .attach('file', png, 'p.png')
      .expect(201);
    const photo = await ctx.http.get('/api/v1/me/profile/photo').set(bearer(token));
    expect(photo.status).toBe(200);
    expect(photo.headers['content-type']).toContain('image/png');
  });

  it('validation : email RFC 5322, téléphone E.164, pays ISO, âge ≥ 18 ans', async () => {
    const u = await ctx.createUser();
    const token = await ctx.token(u);
    expect(
      (
        await ctx.http
          .patch('/api/v1/me/profile')
          .set(bearer(token))
          .send({ version: 1, email: 'pas-un-email' })
      ).status,
    ).toBe(400);
    expect(
      (
        await ctx.http
          .patch('/api/v1/me/profile')
          .set(bearer(token))
          .send({ version: 1, phone: '0612' })
      ).status,
    ).toBe(400);
    expect(
      (
        await ctx.http
          .patch('/api/v1/me/profile')
          .set(bearer(token))
          .send({ version: 1, country: 'XX' })
      ).status,
    ).toBe(400);
    const minor = await ctx.http
      .patch('/api/v1/me/profile')
      .set(bearer(token))
      .send({ version: 1, dateOfBirth: '2010-01-01' });
    expect(minor.status).toBe(422);
    const unknown = await ctx.http
      .patch('/api/v1/me/profile')
      .set(bearer(token))
      .send({ version: 1, role: 'SUPER_ADMIN' });
    expect(unknown.status).toBe(400);
  });

  it('préférences de notification : la sécurité n’est jamais désactivable (US-8.5)', async () => {
    const u = await ctx.createUser();
    const res = await ctx.http
      .put('/api/v1/me/notification-preferences')
      .set(bearer(await ctx.token(u)))
      .send({
        preferredChannel: 'EMAIL',
        frequency: 'IMMEDIATE',
        enabledTypes: ['TONTINE'],
        quietHours: { start: '21:00', end: '06:30' },
      });
    expect(res.status).toBe(200);
    expect(res.body.notificationPrefs.enabledTypes).toEqual(
      expect.arrayContaining(['TONTINE', 'SECURITY']),
    );
  });
});

describe('US-9.1 — détection du pays', () => {
  it('KYC > profil : le pays du document KYC remplace et verrouille le pays du profil', async () => {
    const u = await ctx.createUser({ memberStatus: 'KYC_IN_REVIEW', kycLevel: 'TIER_1' });
    await emit('kyc.verified', u.id, {
      memberId: u.id,
      requestId: '00000000-0000-4000-8000-000000000001',
      kycLevel: 'TIER_2',
      verifiedAt: ctx.clock.now().toISOString(),
      verifiedBy: 'auto',
      documentCountry: 'SN',
    });
    const m = await ctx.prisma.member.findUniqueOrThrow({ where: { id: u.id } });
    expect(m).toMatchObject({
      countryCode: 'SN',
      countrySource: 'KYC',
      status: 'ACTIVE',
      kycLevel: 'TIER_2',
    });
    const res = await ctx.http
      .patch('/api/v1/me/profile')
      .set(bearer(await ctx.token(u)))
      .send({ version: m.version, country: 'CM' });
    expect(res.status).toBe(403);
  });

  it('IP en dernier recours (demande de compte sans indicatif connu)', async () => {
    await ctx.http
      .post('/api/v1/auth/request-account')
      .set('x-dev-country', 'FR')
      .send(requestBody({ phone: '+999123456789' }));
    await ctx.drain();
    // numéro non attribué → la requête est valide (E.164) mais aucun pays déduit du téléphone
    const user = await ctx.prisma.user.findUnique({ where: { email: 'rose@example.test' } });
    expect(user?.countryCode).toBe('FR');
  });
});

describe('US-2.3 — liste des membres pour l’admin', () => {
  async function populated() {
    const admin = await ctx.createUser({
      role: 'TONTINE_ADMIN',
      firstName: 'Zoé',
      lastName: 'Zadmin',
    });
    const t = await ctx.createTontine(admin.id);
    const names = ['Jean', 'Jeanne', 'Paul', 'Alice', 'Bruno'];
    for (const [i, n] of names.entries()) {
      const u = await ctx.createUser({
        firstName: n,
        lastName: `Nom${i}`,
        memberStatus: i === 4 ? 'SUSPENDED' : i === 3 ? 'KYC_REQUIRED' : 'ACTIVE',
        kycLevel: i === 3 ? 'TIER_1' : 'TIER_2',
      });
      await ctx.addParticipant(t.id, u.id);
    }
    return { admin, t, token: await ctx.token(admin) };
  }

  it('pagination par curseur, masquage, compteurs', async () => {
    const { t, token } = await populated();
    const p1 = await ctx.http.get(`/api/v1/tontines/${t.id}/members?limit=4`).set(bearer(token));
    expect(p1.status).toBe(200);
    expect(p1.body.data).toHaveLength(4);
    expect(p1.body.page.nextCursor).toBeTruthy();
    const p2 = await ctx.http
      .get(`/api/v1/tontines/${t.id}/members?limit=4&cursor=${p1.body.page.nextCursor}`)
      .set(bearer(token));
    expect(p2.body.data).toHaveLength(2);
    expect(p2.body.page.nextCursor).toBeNull();
    const ids = [...p1.body.data, ...p2.body.data].map((m: { id: string }) => m.id);
    expect(new Set(ids).size).toBe(6);
    const row = p1.body.data[0];
    expect(row.email).toMatch(/^u\*\*\*@example\.test$/);
    expect(row.phone).toMatch(/^\+237 6\*\* \*\*\* \*\*\d\d$/);
    expect(row.address).toBeUndefined();
    expect(p1.body.meta).toMatchObject({ total: 6, active: 4, pending: 1, suspended: 1 });
    expect(p1.body.meta.summary).toBe('6 membres (4 actifs, 1 en attente, 1 suspendu)');
  });

  it('filtres statut / niveau KYC, recherche partielle, tri', async () => {
    const { t, token } = await populated();
    const susp = await ctx.http
      .get(`/api/v1/tontines/${t.id}/members?status=SUSPENDED`)
      .set(bearer(token));
    expect(susp.body.data.map((m: { firstName: string }) => m.firstName)).toEqual(['Bruno']);
    const kyc = await ctx.http
      .get(`/api/v1/tontines/${t.id}/members?kycLevel=TIER_1`)
      .set(bearer(token));
    expect(kyc.body.data.map((m: { firstName: string }) => m.firstName)).toEqual(['Alice']);
    const search = await ctx.http
      .get(`/api/v1/tontines/${t.id}/members?search=jea`)
      .set(bearer(token));
    expect(search.body.data.map((m: { firstName: string }) => m.firstName).sort()).toEqual([
      'Jean',
      'Jeanne',
    ]);
    const desc = await ctx.http
      .get(`/api/v1/tontines/${t.id}/members?sort=name_desc`)
      .set(bearer(token));
    expect(desc.body.data[0].lastName).toBe('Zadmin');
  });

  it('un admin ne voit que les membres de SES tontines (403 sinon)', async () => {
    const { t } = await populated();
    const other = await ctx.createUser({ role: 'TONTINE_ADMIN' });
    await ctx.createTontine(other.id);
    const res = await ctx.http
      .get(`/api/v1/tontines/${t.id}/members`)
      .set(bearer(await ctx.token(other)));
    expect(res.status).toBe(403);
    const member = await ctx.createUser();
    await ctx.addParticipant(t.id, member.id);
    expect(
      (await ctx.http.get(`/api/v1/tontines/${t.id}/members`).set(bearer(await ctx.token(member))))
        .status,
    ).toBe(403);
  });

  it('performance : 1 000 membres listés en moins de 500 ms', async () => {
    const admin = await ctx.createUser({ role: 'TONTINE_ADMIN' });
    const t = await ctx.createTontine(admin.id);
    const rows = Array.from({ length: 1000 }, (_, i) => ({
      id: crypto.randomUUID(),
      firstName: `Perf${i}`,
      lastName: `Membre${String(i).padStart(4, '0')}`,
      email: `perf${i}@example.test`,
      phone: `+2376${String(70000000 + i)}`,
      countryCode: 'CM',
      language: 'fr-CM',
      timezone: 'Africa/Douala',
      status: 'ACTIVE' as const,
      kycLevel: 'TIER_2' as const,
      notificationPrefs: {},
    }));
    await ctx.prisma.member.createMany({ data: rows });
    await ctx.prisma.tontineMember.createMany({
      data: rows.map((r) => ({
        tontineId: t.id,
        memberId: r.id,
        role: 'MEMBER' as const,
        status: 'ACTIVE' as const,
      })),
    });
    await ctx.prisma.$executeRawUnsafe(
      'ANALYZE "mbr_members"; ANALYZE "ton_members";'.split(';')[0]!,
    );
    const token = await ctx.token(admin);
    await ctx.http.get(`/api/v1/tontines/${t.id}/members?search=membre05`).set(bearer(token));
    const started = performance.now();
    const res = await ctx.http
      .get(`/api/v1/tontines/${t.id}/members?search=membre05&sort=name_asc`)
      .set(bearer(token));
    const elapsed = performance.now() - started;
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(1001);
    expect(elapsed).toBeLessThan(500);
  });
});

describe('US-2.6 — transitions de statut automatiques', () => {
  const req = '00000000-0000-4000-8000-000000000002';

  it('matrice : review.required, verified, rejected, fraude, conformité ; audit + member.status.changed', async () => {
    const u = await ctx.createUser({ memberStatus: 'KYC_REQUIRED', kycLevel: 'TIER_1' });
    await emit('kyc.review.required', u.id, {
      memberId: u.id,
      requestId: req,
      failedSteps: ['FACE_MATCH'],
      scores: { FACE_MATCH: 78 },
    });
    expect((await ctx.prisma.member.findUniqueOrThrow({ where: { id: u.id } })).status).toBe(
      'KYC_IN_REVIEW',
    );
    await emit('kyc.rejected', u.id, {
      memberId: u.id,
      requestId: req,
      rejectCategory: 'FACE_MATCH_ECHOUE',
      rejectReason: 'Selfie non conforme',
      rejectedBy: 'agent',
    });
    expect((await ctx.prisma.member.findUniqueOrThrow({ where: { id: u.id } })).status).toBe(
      'KYC_REJECTED',
    );
    await emit('fraud.user.flagged', u.id, {
      memberId: u.id,
      reason: 'Usurpation',
      flaggedBy: 'test',
    });
    expect((await ctx.prisma.member.findUniqueOrThrow({ where: { id: u.id } })).status).toBe(
      'SUSPENDED',
    );
    const logs = await ctx.prisma.memberAuditLog.findMany({
      where: { memberId: u.id, action: { in: ['STATUS_CHANGED', 'SUSPENDED'] } },
      orderBy: { createdAt: 'asc' },
    });
    expect(logs.map((l) => (l.newValues as { status: string }).status)).toEqual([
      'KYC_IN_REVIEW',
      'KYC_REJECTED',
      'SUSPENDED',
    ]);
    expect(
      await ctx.prisma.outboxEvent.count({
        where: { eventType: 'member.status.changed', aggregateId: u.id },
      }),
    ).toBe(3);
    // Fraude : sessions révoquées et compte suspendu côté Auth
    expect((await ctx.prisma.user.findUniqueOrThrow({ where: { id: u.id } })).status).toBe(
      'SUSPENDED',
    );
  });

  it('transition invalide ignorée et journalisée (kyc.verified sur un membre ACTIVE)', async () => {
    const u = await ctx.createUser({ memberStatus: 'ACTIVE' });
    await emit('kyc.verified', u.id, {
      memberId: u.id,
      requestId: req,
      kycLevel: 'TIER_2',
      verifiedAt: ctx.clock.now().toISOString(),
      verifiedBy: 'auto',
      documentCountry: null,
    });
    expect((await ctx.prisma.member.findUniqueOrThrow({ where: { id: u.id } })).status).toBe(
      'ACTIVE',
    );
    expect(
      await ctx.prisma.memberAuditLog.count({
        where: { memberId: u.id, action: 'INVALID_TRANSITION' },
      }),
    ).toBe(1);
  });

  it('suspension par conformité puis levée par le super-admin', async () => {
    const u = await ctx.createUser();
    const sa = await ctx.createUser({ role: 'SUPER_ADMIN' });
    const { token } = await ctx.login(u);
    await emit('compliance.user.suspended', u.id, { memberId: u.id, reason: 'Liste de sanctions' });
    expect((await ctx.http.get('/api/v1/me/profile').set(bearer(token))).status).toBe(401);
    const res = await ctx.http
      .post(`/api/v1/admin/members/${u.id}/reactivate`)
      .set(bearer(await ctx.token(sa)))
      .send({ reason: 'Faux positif confirmé' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ACTIVE');
    await ctx.drain();
    await ctx.http
      .post('/api/v1/auth/login')
      .send({ identifier: u.email, password: PASSWORD })
      .expect(200);
  });
});
