import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  PASSWORD,
  type TestContext,
  bearer,
  createTestContext,
  extractCookie,
} from './support/test-app';

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

const adminPayload = (over: Record<string, unknown> = {}) => ({
  firstName: 'Marie',
  lastName: 'Ngono',
  email: 'marie.ngono@example.test',
  phone: '+237677001122',
  country: 'CM',
  language: 'fr-CM',
  tontineName: 'Solidarité Douala',
  ...over,
});

describe('US-1.1 — création d’un admin de tontine', () => {
  it('nominal : compte PENDING_ACTIVATION, lien envoyé par email ET SMS, user.registered émis', async () => {
    const sa = await ctx.createUser({ role: 'SUPER_ADMIN' });
    const token = await ctx.token(sa);
    const res = await ctx.http
      .post('/api/v1/admin/tontine-admins')
      .set(bearer(token))
      .send(adminPayload());
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: 'PENDING_ACTIVATION',
      role: 'TONTINE_ADMIN',
      tontineName: 'Solidarité Douala',
    });
    expect(res.body.activation.delivered.sort()).toEqual(['EMAIL', 'SMS']);

    const email = await ctx.lastMessage('marie.ngono@example.test');
    const sms = await ctx.lastMessage('+237677001122');
    expect(email?.body).toMatch(/\/activate\/[0-9a-f-]{36}/);
    expect(sms?.body).toMatch(/\/activate\/[0-9a-f-]{36}/);

    // Le jeton est stocké haché (SHA-256), jamais en clair
    const link = /activate\/([0-9a-f-]{36})/.exec(email!.body)![1]!;
    const stored = await ctx.prisma.authToken.findFirst({ where: { userId: res.body.id } });
    expect(stored?.tokenHash).not.toBe(link);
    expect(stored?.tokenHash).toHaveLength(64);
    expect(stored!.expiresAt.getTime() - ctx.clock.now().getTime()).toBe(48 * 3600 * 1000);

    const evt = await ctx.prisma.outboxEvent.findFirst({
      where: { eventType: 'user.registered', aggregateId: res.body.id },
    });
    expect(evt?.payload).toMatchObject({ role: 'TONTINE_ADMIN', registeredBy: sa.id });
  });

  it('email existant → 409 « Email déjà utilisé »', async () => {
    const sa = await ctx.createUser({ role: 'SUPER_ADMIN' });
    const token = await ctx.token(sa);
    await ctx.http
      .post('/api/v1/admin/tontine-admins')
      .set(bearer(token))
      .send(adminPayload())
      .expect(201);
    const res = await ctx.http
      .post('/api/v1/admin/tontine-admins')
      .set(bearer(token))
      .send(adminPayload({ phone: '+237677009999' }));
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'EMAIL_ALREADY_USED', title: 'Email déjà utilisé' });
  });

  it('téléphone non E.164 → 400 « Format téléphone invalide »', async () => {
    const sa = await ctx.createUser({ role: 'SUPER_ADMIN' });
    const res = await ctx.http
      .post('/api/v1/admin/tontine-admins')
      .set(bearer(await ctx.token(sa)))
      .send(adminPayload({ phone: '677001122' }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_PHONE');
  });

  it('champs manquants → 400 avec la liste des champs', async () => {
    const sa = await ctx.createUser({ role: 'SUPER_ADMIN' });
    const res = await ctx.http
      .post('/api/v1/admin/tontine-admins')
      .set(bearer(await ctx.token(sa)))
      .send(adminPayload({ firstName: '' }));
    expect(res.status).toBe(400);
    expect(res.body.errors.map((e: { path: string }) => e.path)).toContain('firstName');
  });

  it('SMS indisponible → lien envoyé par email uniquement + alerte interne', async () => {
    const sa = await ctx.createUser({ role: 'SUPER_ADMIN' });
    const token = await ctx.token(sa);
    ctx.sms.setAvailability(false);
    const res = await ctx.http
      .post('/api/v1/admin/tontine-admins')
      .set(bearer(token))
      .send(adminPayload());
    expect(res.status).toBe(201);
    expect(res.body.activation).toMatchObject({ delivered: ['EMAIL'], failed: ['SMS'] });
    const alert = await ctx.prisma.auditLog.findFirst({
      where: { action: 'notification.channel_failure' },
    });
    expect(alert?.result).toBe('FAILURE');
  });

  it('réservé au SUPER_ADMIN (403 pour un membre)', async () => {
    const m = await ctx.createUser();
    const res = await ctx.http
      .post('/api/v1/admin/tontine-admins')
      .set(bearer(await ctx.token(m)))
      .send(adminPayload());
    expect(res.status).toBe(403);
  });

  it('lien à usage unique, expiré après 48 h', async () => {
    const sa = await ctx.createUser({ role: 'SUPER_ADMIN' });
    const res = await ctx.http
      .post('/api/v1/admin/tontine-admins')
      .set(bearer(await ctx.token(sa)))
      .send(adminPayload());
    const link = /activate\/([0-9a-f-]{36})/.exec(
      (await ctx.lastMessage('marie.ngono@example.test'))!.body,
    )![1]!;
    ctx.clock.advance(48 * 3600 * 1000 + 1000);
    const expired = await ctx.http
      .post('/api/v1/auth/activate')
      .send({ token: link, password: PASSWORD });
    expect(expired.status).toBe(410);
    expect(expired.body.code).toBe('TOKEN_EXPIRED');
    void res;
  });

  it('activation : mot de passe défini, compte ACTIVE, connexion possible, lien non réutilisable', async () => {
    const sa = await ctx.createUser({ role: 'SUPER_ADMIN' });
    await ctx.http
      .post('/api/v1/admin/tontine-admins')
      .set(bearer(await ctx.token(sa)))
      .send(adminPayload())
      .expect(201);
    const link = /activate\/([0-9a-f-]{36})/.exec(
      (await ctx.lastMessage('marie.ngono@example.test'))!.body,
    )![1]!;
    await ctx.http
      .post('/api/v1/auth/activate')
      .send({ token: link, password: PASSWORD })
      .expect(200);
    const again = await ctx.http
      .post('/api/v1/auth/activate')
      .send({ token: link, password: PASSWORD });
    expect(again.status).toBe(410);
    expect(again.body.code).toBe('TOKEN_ALREADY_USED');
    const login = await ctx.http
      .post('/api/v1/auth/login')
      .send({ identifier: 'marie.ngono@example.test', password: PASSWORD });
    expect(login.status).toBe(200);
    await ctx.drain();
    const me = await ctx.http.get('/api/v1/auth/me').set(bearer(login.body.accessToken));
    expect(me.body).toMatchObject({
      role: 'TONTINE_ADMIN',
      status: 'ACTIVE',
      accessState: 'ACTIVE_PENDING_KYC',
      delegatedTontine: 'Solidarité Douala',
    });
  });
});

describe('US-1.2 — inscription d’un membre par l’admin', () => {
  async function adminWithTontine() {
    const admin = await ctx.createUser({ role: 'TONTINE_ADMIN', kycLevel: 'TIER_3' });
    const tontine = await ctx.createTontine(admin.id);
    return { admin, tontine, token: await ctx.token(admin) };
  }

  it('nominal SMS : OTP 6 chiffres envoyé, profil PENDING_ACTIVATION pré-associé, user.registered avec contexte', async () => {
    const { admin, tontine, token } = await adminWithTontine();
    const res = await ctx.http
      .post(`/api/v1/tontines/${tontine.id}/members`)
      .set(bearer(token))
      .send({
        firstName: 'Paul',
        lastName: 'Eto',
        phone: '+237699112233',
        preferredChannel: 'SMS',
      });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: 'PENDING_ACTIVATION',
      channel: 'SMS',
      delivered: ['SMS'],
    });
    const sms = await ctx.lastMessage('+237699112233');
    expect(sms?.body).toMatch(/\b\d{6}\b/);
    const token2 = await ctx.prisma.authToken.findFirst({
      where: { userId: res.body.id, type: 'ACTIVATION_OTP' },
    });
    expect(token2?.tokenHash.startsWith('$2')).toBe(true); // bcrypt
    expect(token2!.expiresAt.getTime() - ctx.clock.now().getTime()).toBe(15 * 60 * 1000);

    await ctx.drain();
    const evt = await ctx.prisma.outboxEvent.findFirst({
      where: { eventType: 'user.registered', aggregateId: res.body.id },
    });
    expect(evt?.payload).toMatchObject({ registeredBy: admin.id, tontineId: tontine.id });
    const membership = await ctx.prisma.tontineMember.findUnique({
      where: { tontineId_memberId: { tontineId: tontine.id, memberId: res.body.id } },
    });
    expect(membership?.status).toBe('PENDING_ACTIVATION');

    // Le membre apparaît dans la liste de l'admin avec le statut en attente
    const list = await ctx.http.get(`/api/v1/tontines/${tontine.id}/members`).set(bearer(token));
    const row = list.body.data.find((m: { id: string }) => m.id === res.body.id);
    expect(row).toMatchObject({ membershipStatus: 'PENDING_ACTIVATION', status: 'PENDING' });
  });

  it('nominal email : lien d’activation envoyé par email', async () => {
    const { tontine, token } = await adminWithTontine();
    const res = await ctx.http
      .post(`/api/v1/tontines/${tontine.id}/members`)
      .set(bearer(token))
      .send({
        firstName: 'Lina',
        lastName: 'Mba',
        email: 'lina@example.test',
        preferredChannel: 'EMAIL',
      });
    expect(res.status).toBe(201);
    expect((await ctx.lastMessage('lina@example.test'))?.body).toMatch(/\/activate\//);
  });

  it('doublon → 409 « Ce membre existe déjà »', async () => {
    const { tontine, token } = await adminWithTontine();
    const existing = await ctx.createUser();
    const res = await ctx.http
      .post(`/api/v1/tontines/${tontine.id}/members`)
      .set(bearer(token))
      .send({ firstName: 'X', lastName: 'Y', email: existing.email, preferredChannel: 'EMAIL' });
    expect(res.status).toBe(409);
    expect(res.body.title).toBe('Ce membre existe déjà');
  });

  it('admin d’une autre tontine → 403', async () => {
    const { tontine } = await adminWithTontine();
    const other = await ctx.createUser({ role: 'TONTINE_ADMIN' });
    await ctx.createTontine(other.id);
    const res = await ctx.http
      .post(`/api/v1/tontines/${tontine.id}/members`)
      .set(bearer(await ctx.token(other)))
      .send({ firstName: 'X', lastName: 'Y', email: 'x@example.test', preferredChannel: 'EMAIL' });
    expect(res.status).toBe(403);
    expect(
      await ctx.prisma.auditLog.count({ where: { result: 'DENIED', resourceId: tontine.id } }),
    ).toBe(1);
  });

  it('ni email ni téléphone → 400 « Au moins un identifiant requis »', async () => {
    const { tontine, token } = await adminWithTontine();
    const res = await ctx.http
      .post(`/api/v1/tontines/${tontine.id}/members`)
      .set(bearer(token))
      .send({ firstName: 'X', lastName: 'Y', preferredChannel: 'EMAIL' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MISSING_IDENTIFIER');
  });

  it('OTP expiré après 15 min → 410', async () => {
    const { tontine, token } = await adminWithTontine();
    await ctx.http
      .post(`/api/v1/tontines/${tontine.id}/members`)
      .set(bearer(token))
      .send({ firstName: 'P', lastName: 'E', phone: '+237699112233', preferredChannel: 'SMS' })
      .expect(201);
    const otp = /\b(\d{6})\b/.exec((await ctx.lastMessage('+237699112233'))!.body)![1];
    ctx.clock.advance(15 * 60 * 1000 + 1);
    const res = await ctx.http
      .post('/api/v1/auth/activate')
      .send({ identifier: '+237699112233', otp, password: PASSWORD });
    expect(res.status).toBe(410);
    expect(res.body).toMatchObject({
      code: 'OTP_EXPIRED',
      title: 'Code expiré, demandez un renvoi',
    });
  });

  it('3 codes erronés → blocage 15 min et notification de l’admin', async () => {
    const { admin, tontine, token } = await adminWithTontine();
    await ctx.http
      .post(`/api/v1/tontines/${tontine.id}/members`)
      .set(bearer(token))
      .send({ firstName: 'P', lastName: 'E', phone: '+237699112233', preferredChannel: 'SMS' })
      .expect(201);
    const good = /\b(\d{6})\b/.exec((await ctx.lastMessage('+237699112233'))!.body)![1]!;
    const bad = good === '000000' ? '111111' : '000000';
    const r1 = await ctx.http
      .post('/api/v1/auth/activate')
      .send({ identifier: '+237699112233', otp: bad, password: PASSWORD });
    const r2 = await ctx.http
      .post('/api/v1/auth/activate')
      .send({ identifier: '+237699112233', otp: bad, password: PASSWORD });
    const r3 = await ctx.http
      .post('/api/v1/auth/activate')
      .send({ identifier: '+237699112233', otp: bad, password: PASSWORD });
    expect([r1.status, r2.status, r3.status]).toEqual([401, 401, 423]);
    // Même le bon code est refusé pendant le blocage
    const locked = await ctx.http
      .post('/api/v1/auth/activate')
      .send({ identifier: '+237699112233', otp: good, password: PASSWORD });
    expect(locked.status).toBe(423);
    const alert = await ctx.prisma.notification.findFirst({
      where: { recipientId: admin.id, templateKey: 'ops.alert' },
    });
    expect(alert).not.toBeNull();
    ctx.clock.advance(15 * 60 * 1000 + 1);
    // L'OTP a aussi expiré (15 min) : il faut demander un renvoi
    const after = await ctx.http
      .post('/api/v1/auth/activate')
      .send({ identifier: '+237699112233', otp: good, password: PASSWORD });
    expect(after.status).toBe(410);
  });

  it('activation par OTP puis adhésion active', async () => {
    const { tontine, token } = await adminWithTontine();
    const reg = await ctx.http
      .post(`/api/v1/tontines/${tontine.id}/members`)
      .set(bearer(token))
      .send({ firstName: 'P', lastName: 'E', phone: '+237699112233', preferredChannel: 'SMS' });
    await ctx.drain();
    const otp = /\b(\d{6})\b/.exec((await ctx.lastMessage('+237699112233'))!.body)![1];
    await ctx.http
      .post('/api/v1/auth/activate')
      .send({ identifier: '+237699112233', otp, password: PASSWORD })
      .expect(200);
    await ctx.drain();
    const membership = await ctx.prisma.tontineMember.findUnique({
      where: { tontineId_memberId: { tontineId: tontine.id, memberId: reg.body.id } },
    });
    expect(membership?.status).toBe('ACTIVE');
    const member = await ctx.prisma.member.findUnique({ where: { id: reg.body.id } });
    expect(member).toMatchObject({ kycLevel: 'TIER_1', status: 'KYC_REQUIRED', countryCode: 'CM' });
  });

  it('renvois d’OTP limités à 3 par heure', async () => {
    const { tontine, token } = await adminWithTontine();
    await ctx.http
      .post(`/api/v1/tontines/${tontine.id}/members`)
      .set(bearer(token))
      .send({ firstName: 'P', lastName: 'E', phone: '+237699112233', preferredChannel: 'SMS' });
    for (let i = 0; i < 3; i++)
      await ctx.http
        .post('/api/v1/auth/activation/resend')
        .send({ identifier: '+237699112233' })
        .expect(202);
    const res = await ctx.http
      .post('/api/v1/auth/activation/resend')
      .send({ identifier: '+237699112233' });
    expect(res.status).toBe(429);
  });
});

describe('US-1.4 — connexion et déconnexion', () => {
  it('login nominal : access token RS256 + refresh token en cookie HttpOnly Strict, user.login émis', async () => {
    const u = await ctx.createUser();
    const res = await ctx.http
      .post('/api/v1/auth/login')
      .set('User-Agent', 'vitest')
      .send({ identifier: u.email, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ tokenType: 'Bearer', expiresIn: 900 });
    expect(res.body.refreshToken).toBeUndefined();
    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('tm_rt='),
    )!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    const [header, payload] = res.body.accessToken
      .split('.')
      .slice(0, 2)
      .map((p: string) => JSON.parse(Buffer.from(p, 'base64url').toString()));
    expect(header.alg).toBe('RS256');
    expect(payload).toMatchObject({ sub: u.id, role: 'MEMBER' });
    expect(payload.tontineIds).toEqual([]);
    expect(payload.exp - payload.iat).toBe(900);
    const evt = await ctx.prisma.outboxEvent.findFirst({
      where: { eventType: 'user.login', aggregateId: u.id },
    });
    expect(evt?.payload).toMatchObject({ userId: u.id, mfaUsed: false });
    const session = await ctx.prisma.refreshSession.findFirst({ where: { userId: u.id } });
    expect(session?.tokenHash).toHaveLength(64);
  });

  it('identifiant téléphone accepté', async () => {
    const u = await ctx.createUser();
    await ctx.http
      .post('/api/v1/auth/login')
      .send({ identifier: u.phone, password: PASSWORD })
      .expect(200);
  });

  it('mauvais mot de passe et identifiant inconnu → même message générique (401)', async () => {
    const u = await ctx.createUser();
    const a = await ctx.http
      .post('/api/v1/auth/login')
      .send({ identifier: u.email, password: 'Mauvais#Mot2passe' });
    const b = await ctx.http
      .post('/api/v1/auth/login')
      .send({ identifier: 'inconnu@example.test', password: 'Mauvais#Mot2passe' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.detail).toBe(b.body.detail);
    expect(a.body.title).toBe('Identifiants incorrects');
  });

  it('5 échecs en 10 min → 423 à la 6e tentative, déverrouillage après 15 min', async () => {
    const u = await ctx.createUser();
    for (let i = 0; i < 5; i++) {
      await ctx.http
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', `10.0.0.${i}`)
        .send({ identifier: u.email, password: 'Mauvais#Mot2passe' })
        .expect(401);
    }
    const sixth = await ctx.http
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', '10.0.1.1')
      .send({ identifier: u.email, password: PASSWORD });
    expect(sixth.status).toBe(423);
    expect(sixth.body.title).toBe('Compte temporairement verrouillé');
    ctx.clock.advance(15 * 60 * 1000 + 1000);
    await ctx.http
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', '10.0.1.2')
      .send({ identifier: u.email, password: PASSWORD })
      .expect(200);
  });

  it('15 échecs en 1 h → verrouillage du compte + user.locked ; seul un admin peut déverrouiller', async () => {
    const u = await ctx.createUser();
    for (let i = 0; i < 15; i++) {
      await ctx.http
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', `10.1.${i}.1`)
        .send({ identifier: u.email, password: 'Mauvais#Mot2passe' });
      if (i % 5 === 4) ctx.clock.advance(16 * 60 * 1000); // laisse passer le verrou court
    }
    const locked = await ctx.prisma.outboxEvent.findFirst({
      where: { eventType: 'user.locked', aggregateId: u.id },
    });
    expect(locked).not.toBeNull();
    ctx.clock.advance(2 * 3600 * 1000);
    const res = await ctx.http
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', '10.9.9.9')
      .send({ identifier: u.email, password: PASSWORD });
    expect(res.status).toBe(423);
    const sa = await ctx.createUser({ role: 'SUPER_ADMIN' });
    await ctx.http
      .post(`/api/v1/admin/users/${u.id}/unlock`)
      .set(bearer(await ctx.token(sa)))
      .send({ reason: 'Vérifié par téléphone' })
      .expect(204);
    await ctx.http
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', '10.9.9.8')
      .send({ identifier: u.email, password: PASSWORD })
      .expect(200);
  });

  it('rate limiting : 10 tentatives / min / IP', async () => {
    const u = await ctx.createUser();
    for (let i = 0; i < 10; i++)
      await ctx.http
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', '172.16.0.1')
        .send({ identifier: `x${i}@example.test`, password: 'x' });
    const res = await ctx.http
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', '172.16.0.1')
      .send({ identifier: u.email, password: PASSWORD });
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
  });

  it('« se souvenir de moi » (A-57) : cookie persistant par défaut, de session sinon — conservé à la rotation', async () => {
    const rawCookie = (h: unknown) => (h as string[]).find((c) => c.startsWith('tm_rt='))!;
    const u = await ctx.createUser();
    const remembered = await ctx.http
      .post('/api/v1/auth/login')
      .send({ identifier: u.email, password: PASSWORD, rememberMe: true });
    expect(rawCookie(remembered.headers['set-cookie'])).toMatch(/Expires=/);
    const legacy = await ctx.http
      .post('/api/v1/auth/login')
      .send({ identifier: u.email, password: PASSWORD });
    expect(rawCookie(legacy.headers['set-cookie'])).toMatch(/Expires=/);

    const session = await ctx.http
      .post('/api/v1/auth/login')
      .send({ identifier: u.email, password: PASSWORD, rememberMe: false });
    const first = rawCookie(session.headers['set-cookie']);
    expect(first).not.toMatch(/Expires=|Max-Age=/);
    const rotated = await ctx.http.post('/api/v1/auth/refresh').set('Cookie', first.split(';')[0]!);
    expect(rotated.status).toBe(200);
    expect(rawCookie(rotated.headers['set-cookie'])).not.toMatch(/Expires=|Max-Age=/);
    // La session serveur garde sa durée de 7 jours (US-1.4)
    const row = await ctx.prisma.refreshSession.findFirstOrThrow({
      where: { userId: u.id, persistent: false, rotatedAt: null },
    });
    expect(row.expiresAt.getTime() - ctx.clock.now().getTime()).toBe(7 * 86_400_000);
  });

  it('refresh : rotation du refresh token, l’ancien devient inutilisable et sa réutilisation révoque la famille', async () => {
    const u = await ctx.createUser();
    const { cookie } = await ctx.login(u);
    const r1 = await ctx.http.post('/api/v1/auth/refresh').set('Cookie', cookie);
    expect(r1.status).toBe(200);
    const cookie2 = extractCookie(r1.headers['set-cookie']);
    expect(cookie2).not.toBe(cookie);
    // Réutilisation de l'ancien → 401 et révocation de toute la famille
    const reuse = await ctx.http.post('/api/v1/auth/refresh').set('Cookie', cookie);
    expect(reuse.status).toBe(401);
    const r2 = await ctx.http.post('/api/v1/auth/refresh').set('Cookie', cookie2);
    expect(r2.status).toBe(401);
    // L'access token issu de la famille révoquée est aussi refusé
    const me = await ctx.http.get('/api/v1/auth/me').set(bearer(r1.body.accessToken));
    expect(me.status).toBe(401);
  });

  it('refresh token de 8 jours → 401, re-login nécessaire', async () => {
    const u = await ctx.createUser();
    const { cookie } = await ctx.login(u);
    ctx.clock.advance(8 * 24 * 3600 * 1000);
    const res = await ctx.http.post('/api/v1/auth/refresh').set('Cookie', cookie);
    expect(res.status).toBe(401);
  });

  it('un access token expiré ne permet pas de rafraîchir (R-AUTH-03)', async () => {
    const u = await ctx.createUser();
    const { token } = await ctx.login(u);
    const res = await ctx.http.post('/api/v1/auth/refresh').send({ refreshToken: token });
    expect(res.status).toBe(401);
  });

  it('déconnexion : 204, refresh révoqué, access token blacklisté', async () => {
    const u = await ctx.createUser();
    const { token, cookie } = await ctx.login(u);
    await ctx.http.post('/api/v1/auth/logout').set(bearer(token)).expect(204);
    expect((await ctx.http.get('/api/v1/auth/me').set(bearer(token))).status).toBe(401);
    expect((await ctx.http.post('/api/v1/auth/refresh').set('Cookie', cookie)).status).toBe(401);
    expect(await ctx.prisma.outboxEvent.count({ where: { eventType: 'user.logout' } })).toBe(1);
  });

  it('5 sessions actives maximum : la plus ancienne est révoquée', async () => {
    const u = await ctx.createUser();
    const sessions = [];
    for (let i = 0; i < 6; i++) {
      ctx.clock.advance(1000);
      sessions.push(await ctx.login(u));
    }
    expect((await ctx.http.get('/api/v1/auth/me').set(bearer(sessions[0]!.token))).status).toBe(
      401,
    );
    expect((await ctx.http.get('/api/v1/auth/me').set(bearer(sessions[5]!.token))).status).toBe(
      200,
    );
    const active = await ctx.prisma.refreshSession.count({
      where: { userId: u.id, revokedAt: null },
    });
    expect(active).toBe(5);
  });

  it('nouveau device → notification de sécurité', async () => {
    const u = await ctx.createUser();
    await ctx.http
      .post('/api/v1/auth/login')
      .set('User-Agent', 'Téléphone A')
      .send({ identifier: u.email, password: PASSWORD })
      .expect(200);
    await ctx.http
      .post('/api/v1/auth/login')
      .set('User-Agent', 'Ordinateur B')
      .send({ identifier: u.email, password: PASSWORD })
      .expect(200);
    await ctx.drain();
    const alerts = await ctx.prisma.notification.findMany({
      where: { recipientId: u.id, templateKey: 'auth.new_device' },
    });
    expect(alerts.length).toBeGreaterThanOrEqual(1);
    expect(alerts.some((n) => n.channel === 'SMS' && n.priority === 'URGENT')).toBe(true);
  });

  it('super-admin : connexion en deux étapes (TOTP) obligatoire', async () => {
    const sa = await ctx.createUser({ role: 'SUPER_ADMIN' });
    const res = await ctx.http
      .post('/api/v1/auth/login')
      .send({ identifier: sa.email, password: PASSWORD });
    expect(res.body).toMatchObject({ mfaRequired: true, mfaType: 'TOTP' });
    const wrong = await ctx.http
      .post('/api/v1/auth/login/mfa')
      .send({ challengeToken: res.body.challengeToken, code: '000000' });
    expect(wrong.status).toBe(401);
    const { token } = await ctx.login(sa);
    const claims = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString());
    expect(claims.role).toBe('SUPER_ADMIN');
    const evt = await ctx.prisma.outboxEvent.findFirst({
      where: { eventType: 'user.login', aggregateId: sa.id },
      orderBy: { seq: 'desc' },
    });
    expect(evt?.payload).toMatchObject({ mfaUsed: true });
  });

  it('super-admin sans MFA : opérations d’administration refusées', async () => {
    const sa = await ctx.createUser({ role: 'SUPER_ADMIN', mfa: false });
    const { token } = await ctx.login(sa);
    const res = await ctx.http
      .post('/api/v1/admin/tontine-admins')
      .set(bearer(token))
      .send(adminPayload());
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('MFA_REQUIRED');
  });

  it('JWKS publié pour la vérification des jetons', async () => {
    const res = await ctx.http.get('/.well-known/jwks.json');
    expect(res.status).toBe(200);
    expect(res.body.keys[0]).toMatchObject({ kty: 'RSA', alg: 'RS256', use: 'sig' });
  });
});
