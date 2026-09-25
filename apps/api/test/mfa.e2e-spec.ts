import { generateTotp } from '@tontine/auth';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  PASSWORD,
  type TestContext,
  type TestUser,
  bearer,
  createTestContext,
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

/** Active le TOTP de bout en bout ; renvoie le secret et les codes de récupération. */
async function enableTotp(token: string): Promise<{ secret: string; recoveryCodes: string[] }> {
  const start = await ctx.http
    .post('/api/v1/auth/mfa/enable')
    .set(bearer(token))
    .send({ type: 'TOTP' });
  expect(start.status).toBe(200);
  const code = generateTotp(start.body.secret, ctx.clock.now());
  const verify = await ctx.http.post('/api/v1/auth/mfa/verify').set(bearer(token)).send({ code });
  expect(verify.status).toBe(200);
  return { secret: start.body.secret, recoveryCodes: verify.body.recoveryCodes };
}

async function passwordStep(user: TestUser) {
  const res = await ctx.http
    .post('/api/v1/auth/login')
    .send({ identifier: user.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return res.body as { mfaRequired?: boolean; challengeToken: string; mfaType: string };
}

describe('US-1.6 — activation du MFA', () => {
  let user: TestUser;
  let token: string;

  beforeEach(async () => {
    user = await ctx.createUser();
    token = await ctx.token(user);
  });

  it('TOTP : secret 160 bits + QR code, bon code → MFA actif, 10 codes XXXX-XXXX, événement et notification', async () => {
    const start = await ctx.http
      .post('/api/v1/auth/mfa/enable')
      .set(bearer(token))
      .send({ type: 'TOTP' });
    expect(start.body.qrCodeUrl).toMatch(/^data:image\/png;base64,/);
    expect(start.body.otpauthUrl).toContain('otpauth://totp/');
    expect(start.body.secret).toMatch(/^[A-Z2-7]{32}$/); // base32 de 160 bits
    const code = generateTotp(start.body.secret, ctx.clock.now());
    const verify = await ctx.http.post('/api/v1/auth/mfa/verify').set(bearer(token)).send({ code });
    expect(verify.status).toBe(200);
    expect(verify.body.recoveryCodes).toHaveLength(10);
    for (const c of verify.body.recoveryCodes) expect(c).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    const u = await ctx.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(u).toMatchObject({ mfaEnabled: true, mfaType: 'TOTP' });
    // codes stockés hachés, jamais en clair
    const stored = await ctx.prisma.recoveryCode.findMany({ where: { userId: user.id } });
    expect(stored).toHaveLength(10);
    expect(stored.every((s) => !verify.body.recoveryCodes.includes(s.codeHash))).toBe(true);
    expect(await ctx.prisma.outboxEvent.count({ where: { eventType: 'user.mfa.enabled' } })).toBe(
      1,
    );
    await ctx.drain();
    expect(
      await ctx.prisma.notification.count({
        where: { recipientId: user.id, templateKey: 'auth.mfa_enabled' },
      }),
    ).toBeGreaterThanOrEqual(1);
    const status = await ctx.http.get('/api/v1/auth/mfa').set(bearer(token));
    expect(status.body).toMatchObject({ enabled: true, type: 'TOTP' });
  });

  it('mauvais code TOTP : erreur, MFA non activé', async () => {
    await ctx.http.post('/api/v1/auth/mfa/enable').set(bearer(token)).send({ type: 'TOTP' });
    const res = await ctx.http
      .post('/api/v1/auth/mfa/verify')
      .set(bearer(token))
      .send({ code: '000000' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_MFA_CODE');
    expect((await ctx.prisma.user.findUniqueOrThrow({ where: { id: user.id } })).mfaEnabled).toBe(
      false,
    );
  });

  it('SMS : OTP envoyé au numéro enregistré, bon code → MFA SMS actif', async () => {
    const start = await ctx.http
      .post('/api/v1/auth/mfa/enable')
      .set(bearer(token))
      .send({ type: 'SMS' });
    expect(start.body).toMatchObject({ type: 'SMS', smsSent: true });
    const sms = await ctx.lastMessage(user.phone);
    const code = /\b(\d{6})\b/.exec(sms!.body)![1]!;
    const verify = await ctx.http.post('/api/v1/auth/mfa/verify').set(bearer(token)).send({ code });
    expect(verify.status).toBe(200);
    expect(verify.body.recoveryCodes).toHaveLength(10);
    expect((await ctx.prisma.user.findUniqueOrThrow({ where: { id: user.id } })).mfaType).toBe(
      'SMS',
    );
  });

  it('OTP SMS expiré (10 min) : refusé', async () => {
    await ctx.http.post('/api/v1/auth/mfa/enable').set(bearer(token)).send({ type: 'SMS' });
    const code = /\b(\d{6})\b/.exec((await ctx.lastMessage(user.phone))!.body)![1]!;
    ctx.clock.advance(11 * 60_000);
    const verify = await ctx.http
      .post('/api/v1/auth/mfa/verify')
      .set(bearer(await ctx.token(user)))
      .send({ code });
    expect(verify.status).toBe(401);
  });

  it('login avec TOTP, puis avec un code de récupération (consommé, non réutilisable)', async () => {
    const { secret, recoveryCodes } = await enableTotp(token);
    const step = await passwordStep(user);
    expect(step).toMatchObject({ mfaRequired: true, mfaType: 'TOTP' });
    const ok = await ctx.http
      .post('/api/v1/auth/login/mfa')
      .send({ challengeToken: step.challengeToken, code: generateTotp(secret, ctx.clock.now()) });
    expect(ok.status).toBe(200);
    expect(ok.body.accessToken).toBeTruthy();

    const step2 = await passwordStep(user);
    const rec = await ctx.http
      .post('/api/v1/auth/login/mfa')
      .send({ challengeToken: step2.challengeToken, code: recoveryCodes[0] });
    expect(rec.status).toBe(200);
    const step3 = await passwordStep(user);
    const reuse = await ctx.http
      .post('/api/v1/auth/login/mfa')
      .send({ challengeToken: step3.challengeToken, code: recoveryCodes[0] });
    expect(reuse.status).toBe(401);
  });

  it('10e code de récupération utilisé : alerte + régénération obligatoire', async () => {
    const { secret, recoveryCodes } = await enableTotp(token);
    let last: { body: { recoveryCodesExhausted?: boolean; accessToken: string } } | null = null;
    for (const code of recoveryCodes) {
      ctx.clock.advance(61_000); // limite de 10 tentatives de connexion / minute
      const step = await passwordStep(user);
      last = await ctx.http
        .post('/api/v1/auth/login/mfa')
        .send({ challengeToken: step.challengeToken, code });
    }
    expect(last!.body.recoveryCodesExhausted).toBe(true);
    expect(
      await ctx.prisma.outboxEvent.count({ where: { eventType: 'user.mfa.recovery.exhausted' } }),
    ).toBe(1);
    // (5 sessions maximum : on utilise le jeton de la dernière connexion)
    const current = last!.body.accessToken;
    const status = await ctx.http.get('/api/v1/auth/mfa').set(bearer(current));
    expect(status.body.mustRegenerate).toBe(true);
    const regen = await ctx.http
      .post('/api/v1/auth/mfa/recovery-codes')
      .set(bearer(current))
      .send({ code: generateTotp(secret, ctx.clock.now()) });
    expect(regen.status).toBe(200);
    expect(regen.body.recoveryCodes).toHaveLength(10);
  });

  it('désactivation : mot de passe + code valide requis, notification d’alerte', async () => {
    const { secret } = await enableTotp(token);
    const badPwd = await ctx.http
      .post('/api/v1/auth/mfa/disable')
      .set(bearer(token))
      .send({ password: 'mauvais-mot-de-passe', code: generateTotp(secret, ctx.clock.now()) });
    expect(badPwd.status).toBe(401);
    const badCode = await ctx.http
      .post('/api/v1/auth/mfa/disable')
      .set(bearer(token))
      .send({ password: PASSWORD, code: '123456' });
    expect(badCode.status).toBe(401);
    const ok = await ctx.http
      .post('/api/v1/auth/mfa/disable')
      .set(bearer(token))
      .send({ password: PASSWORD, code: generateTotp(secret, ctx.clock.now()) });
    expect(ok.status).toBe(204);
    expect((await ctx.prisma.user.findUniqueOrThrow({ where: { id: user.id } })).mfaEnabled).toBe(
      false,
    );
    await ctx.drain();
    expect(
      await ctx.prisma.notification.count({
        where: { recipientId: user.id, templateKey: 'auth.mfa_disabled' },
      }),
    ).toBeGreaterThanOrEqual(1);
  });

  it('activation déjà active : refusée', async () => {
    await enableTotp(token);
    const res = await ctx.http
      .post('/api/v1/auth/mfa/enable')
      .set(bearer(token))
      .send({ type: 'SMS' });
    expect(res.status).toBe(422);
  });
});
