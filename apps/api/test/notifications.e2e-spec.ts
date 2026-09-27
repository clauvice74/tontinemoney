import { NotificationService } from '@tontine/notifications';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TestContext, type TestUser, bearer, createTestContext } from './support/test-app';

let ctx: TestContext;
let notifications: NotificationService;

beforeAll(async () => {
  ctx = await createTestContext();
  notifications = ctx.app.get(NotificationService);
});
afterAll(async () => {
  await ctx.app.close();
});
beforeEach(async () => {
  await ctx.reset();
});

const paymentFailed = (user: TestUser, extra: Record<string, unknown> = {}) =>
  notifications.notify({
    recipientIds: [user.id],
    template: 'payment.failed',
    vars: { operation: 'dépôt', montant: '10 000 XAF', motif: 'refus opérateur' },
    channels: ['SMS'],
    ...extra,
  });

async function sms(user: TestUser) {
  return ctx.prisma.notification.findFirstOrThrow({
    where: { recipientId: user.id, channel: 'SMS' },
    orderBy: { createdAt: 'desc' },
  });
}

describe('US-8.1 / US-8.2 — génération et personnalisation', () => {
  it('modèle par langue (fr / en) avec variables, IN_APP toujours créé', async () => {
    const fr = await ctx.createUser();
    const en = await ctx.createUser({ country: 'NG' });
    await notifications.notify({
      recipientIds: [fr.id, en.id],
      template: 'wallet.debit_failed',
      vars: { montant: '10 000', tontine: 'Solidarité' },
    });
    const frRow = await ctx.prisma.notification.findFirstOrThrow({
      where: { recipientId: fr.id, channel: 'IN_APP' },
    });
    const enRow = await ctx.prisma.notification.findFirstOrThrow({
      where: { recipientId: en.id, channel: 'IN_APP' },
    });
    expect(frRow.title).not.toBe(enRow.title);
    expect(frRow.status).toBe('SENT');
    expect(
      await ctx.prisma.outboxEvent.count({ where: { eventType: 'notification.created' } }),
    ).toBeGreaterThanOrEqual(2);
  });

  it('boîte de réception : liste, non lus, lecture, isolation', async () => {
    const u = await ctx.createUser();
    const other = await ctx.createUser();
    await paymentFailed(u);
    const token = await ctx.token(u);
    const list = await ctx.http.get('/api/v1/me/notifications').set(bearer(token));
    expect(list.status).toBe(200);
    expect(list.body.meta.unread).toBeGreaterThanOrEqual(1);
    const id = list.body.data[0].id;
    expect(
      (
        await ctx.http
          .post(`/api/v1/me/notifications/${id}/read`)
          .set(bearer(await ctx.token(other)))
          .send()
      ).status,
    ).toBe(404);
    expect(
      (await ctx.http.post(`/api/v1/me/notifications/${id}/read`).set(bearer(token)).send()).status,
    ).toBe(204);
    const after = await ctx.http.get('/api/v1/me/notifications?unread=true').set(bearer(token));
    expect(after.body.data.find((n: { id: string }) => n.id === id)).toBeUndefined();
  });
});

describe('US-8.3 — envoi avec résilience', () => {
  it('nominal : SMS envoyé, rapport de livraison, événement notification.sent', async () => {
    const u = await ctx.createUser();
    await paymentFailed(u);
    const run = await ctx.jobs.run('notifications.deliver', 'test');
    expect(run.summary['sent']).toBe(1);
    const n = await sms(u);
    expect(n).toMatchObject({ status: 'SENT', attempts: 1 });
    expect(n.sentAt).not.toBeNull();
    expect(
      await ctx.prisma.outboundMessage.count({
        where: { notificationId: n.id, status: 'DELIVERED' },
      }),
    ).toBe(1);
    expect(await ctx.prisma.outboxEvent.count({ where: { eventType: 'notification.sent' } })).toBe(
      1,
    );
  });

  it('panne SMS : 3 tentatives avec backoff, DLQ puis repli sur l’email', async () => {
    const u = await ctx.createUser();
    await paymentFailed(u);
    ctx.sms.setAvailability(false);
    await ctx.jobs.run('notifications.deliver', 'test');
    let n = await sms(u);
    expect(n).toMatchObject({ status: 'PENDING', attempts: 1 });
    expect(n.scheduledFor.getTime() - ctx.clock.now().getTime()).toBe(30_000);
    // pas de nouvel essai avant l'échéance du backoff
    await ctx.jobs.run('notifications.deliver', 'test');
    expect((await sms(u)).attempts).toBe(1);
    ctx.clock.advance(31_000);
    await ctx.jobs.run('notifications.deliver', 'test');
    ctx.clock.advance(121_000);
    await ctx.jobs.run('notifications.deliver', 'test');
    n = await sms(u);
    expect(n).toMatchObject({ status: 'DEAD', attempts: 3 });
    const email = await ctx.prisma.notification.findFirstOrThrow({
      where: { recipientId: u.id, channel: 'EMAIL', dedupeKey: `fallback:${n.id}` },
    });
    await ctx.jobs.run('notifications.deliver', 'test');
    expect(
      (await ctx.prisma.notification.findUniqueOrThrow({ where: { id: email.id } })).status,
    ).toBe('SENT');
  });

  it('anti-spam : 10 SMS / jour maximum hors urgences (R-COM-03)', async () => {
    const u = await ctx.createUser();
    for (let i = 0; i < 11; i++) await paymentFailed(u, { dedupeKey: `spam-${i}` });
    await ctx.jobs.run('notifications.deliver', 'test');
    const rows = await ctx.prisma.notification.findMany({
      where: { recipientId: u.id, channel: 'SMS' },
    });
    expect(rows.filter((r) => r.status === 'SENT')).toHaveLength(10);
    expect(rows.filter((r) => r.status === 'SKIPPED')).toHaveLength(1);
    await paymentFailed(u, { priority: 'URGENT', dedupeKey: 'urgent' });
    await ctx.jobs.run('notifications.deliver', 'test');
    expect(
      (
        await ctx.prisma.notification.findFirstOrThrow({
          where: { recipientId: u.id, channel: 'SMS', priority: 'URGENT' },
        })
      ).status,
    ).toBe('SENT');
  });
});

describe('US-8.5 — préférences de notification', () => {
  async function prefs(u: TestUser, body: Record<string, unknown>) {
    const res = await ctx.http
      .put('/api/v1/me/notification-preferences')
      .set(bearer(await ctx.token(u)))
      .send(body);
    expect(res.status).toBe(200);
  }

  it('heures calmes : report au matin (fuseau du membre), sauf urgence', async () => {
    const u = await ctx.createUser();
    await prefs(u, {
      preferredChannel: 'SMS',
      frequency: 'IMMEDIATE',
      enabledTypes: ['PAYMENT', 'SECURITY'],
      quietHours: { start: '21:00', end: '06:30' },
    });
    ctx.clock.set('2026-09-24T21:00:00.000Z'); // 22:00 à Douala (UTC+1)
    await paymentFailed(u);
    const n = await sms(u);
    expect(n.status).toBe('SCHEDULED');
    expect(n.scheduledFor.toISOString()).toBe('2026-09-25T05:30:00.000Z');
    await paymentFailed(u, { priority: 'URGENT', dedupeKey: 'urgent' });
    expect(
      (
        await ctx.prisma.notification.findFirstOrThrow({
          where: { recipientId: u.id, channel: 'SMS', priority: 'URGENT' },
        })
      ).status,
    ).toBe('PENDING');
  });

  it('type désactivé : SMS non envoyé (SKIPPED) ; la sécurité n’est jamais désactivable', async () => {
    const u = await ctx.createUser();
    await prefs(u, {
      preferredChannel: 'SMS',
      frequency: 'IMMEDIATE',
      enabledTypes: ['TONTINE'],
      quietHours: null,
    });
    await paymentFailed(u);
    expect((await sms(u)).status).toBe('SKIPPED');
    await notifications.notify({
      recipientIds: [u.id],
      template: 'auth.new_device',
      vars: { appareil: 'Chrome', lieu: 'Douala', date: '24/09' },
      channels: ['SMS'],
    });
    const sec = await ctx.prisma.notification.findFirstOrThrow({
      where: { recipientId: u.id, channel: 'SMS', templateKey: 'auth.new_device' },
    });
    expect(sec.status).toBe('PENDING');
  });

  it('canal préféré email : le SMS du modèle est remplacé par un email', async () => {
    const u = await ctx.createUser();
    await prefs(u, {
      preferredChannel: 'EMAIL',
      frequency: 'IMMEDIATE',
      enabledTypes: ['PAYMENT'],
      quietHours: null,
    });
    await paymentFailed(u);
    const channels = (await ctx.prisma.notification.findMany({ where: { recipientId: u.id } }))
      .map((n) => n.channel)
      .sort();
    expect(channels).toEqual(['EMAIL', 'IN_APP']);
  });
});
