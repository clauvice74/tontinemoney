import { randomUUID } from 'node:crypto';
import { COMMUNICATION, type CommunicationPort } from '@tontine/platform';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TestContext, createTestContext } from './support/test-app';

/** Communication-service (A-51) : transport, adresse, limite anti-spam, journal de livraison. */
let ctx: TestContext;
let communication: CommunicationPort;

beforeAll(async () => {
  ctx = await createTestContext();
  communication = ctx.app.get<CommunicationPort>(COMMUNICATION);
  // Le premier numéro de test se termine par « 0000 », que le simulateur SMS fait échouer exprès
  await ctx.createUser();
});
afterAll(async () => {
  await ctx.app.close();
});
beforeEach(async () => {
  await ctx.reset();
  ctx.sms.setAvailability(true);
});

const request = (recipientId: string, over: Record<string, unknown> = {}) => ({
  notificationId: randomUUID(),
  recipientId,
  channel: 'SMS' as const,
  priority: 'MEDIUM' as const,
  subject: 'Rappel',
  body: 'Votre contribution est due demain.',
  ...over,
});

describe('COMMUNICATION.send', () => {
  it('adresse résolue par le port Membres ; journal de livraison avec destinataire et priorité', async () => {
    const m = await ctx.createUser();
    const r = request(m.id);
    const res = await communication.send(r);
    expect(res).toMatchObject({ status: 'SENT', providerRef: expect.any(String) });
    const log = await ctx.prisma.outboundMessage.findFirstOrThrow({
      where: { notificationId: r.notificationId },
    });
    expect(log).toMatchObject({
      recipientId: m.id,
      priority: 'MEDIUM',
      channel: 'SMS',
      recipient: m.phone,
      status: 'DELIVERED',
    });
  });

  it('limite anti-spam par destinataire (paramètre) : THROTTLED sauf urgence', async () => {
    const m = await ctx.createUser();
    const sa = await ctx.createUser({ role: 'SUPER_ADMIN' });
    await ctx.http
      .patch('/api/v1/admin/configurations/notifications.sms.dailyLimit')
      .set({ Authorization: `Bearer ${await ctx.token(sa)}` })
      .send({ value: 2, reason: 'Test', version: 0 })
      .expect(200);
    expect((await communication.send(request(m.id))).status).toBe('SENT');
    expect((await communication.send(request(m.id))).status).toBe('SENT');
    expect(await communication.send(request(m.id))).toMatchObject({
      status: 'THROTTLED',
      reason: expect.stringContaining('2 SMS/jour'),
    });
    expect((await communication.send(request(m.id, { priority: 'URGENT' }))).status).toBe('SENT');
    // autre destinataire : compteur distinct
    const other = await ctx.createUser();
    expect((await communication.send(request(other.id))).status).toBe('SENT');
  });

  it('panne du fournisseur : échec réessayable ; destinataire inconnu : échec définitif ; PUSH simulé', async () => {
    const m = await ctx.createUser();
    ctx.sms.setAvailability(false);
    expect(await communication.send(request(m.id))).toMatchObject({
      status: 'FAILED',
      retryable: true,
    });
    ctx.sms.setAvailability(true);
    expect(await communication.send(request(randomUUID()))).toMatchObject({
      status: 'FAILED',
      retryable: false,
      reason: 'Aucun numéro',
    });
    expect((await communication.send(request(m.id, { channel: 'PUSH' }))).status).toBe('SENT');
  });

  it('deliver : adresse explicite (OTP, activation), sans limite anti-spam', async () => {
    const m = await ctx.createUser();
    for (let i = 0; i < 12; i++) {
      const res = await communication.deliver({
        channel: 'SMS',
        to: m.phone,
        subject: 'Code',
        body: `Code ${i}`,
        recipientId: m.id,
      });
      expect(res.status).toBe('SENT');
    }
    const email = await communication.deliver({
      channel: 'EMAIL',
      to: 'nouveau@example.test',
      subject: 'Activation',
      body: 'Lien : https://example.test/a',
    });
    expect(email.status).toBe('SENT');
  });

  it('console des messages simulés servie par communication (hors production)', async () => {
    const m = await ctx.createUser();
    await communication.send(request(m.id, { body: 'Message console' }));
    const res = await ctx.http.get(`/api/v1/dev/messages?to=${encodeURIComponent(m.phone)}`);
    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({ channel: 'SMS', body: 'Message console' });
  });
});
