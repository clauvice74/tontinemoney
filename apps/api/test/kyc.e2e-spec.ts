import { DocumentStorage, SimulatedAmlProvider } from '@tontine/kyc';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  type TestContext,
  type TestUser,
  bearer,
  createTestContext,
  kycImage,
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

async function applicant(opts: { firstName?: string; lastName?: string; country?: string } = {}) {
  const u = await ctx.createUser({ memberStatus: 'KYC_REQUIRED', kycLevel: 'TIER_1', ...opts });
  return { user: u, token: await ctx.token(u) };
}

async function submit(
  token: string,
  opts: {
    documentType?: string;
    front?: Buffer;
    back?: Buffer | null;
    selfie?: Buffer;
    liveness?: string | null;
  } = {},
) {
  const liveness =
    opts.liveness === undefined
      ? (await ctx.http.post('/api/v1/kyc/liveness').set(bearer(token))).body.livenessToken
      : opts.liveness;
  let req = ctx.http
    .post('/api/v1/kyc/submit')
    .set(bearer(token))
    .field('documentType', opts.documentType ?? 'CNI')
    .field('captureSource', 'CAMERA');
  if (liveness) req = req.field('livenessToken', liveness);
  req = req.attach('front', opts.front ?? kycImage(), 'front.png');
  if (opts.back !== null) req = req.attach('back', opts.back ?? kycImage(), 'back.png');
  return req.attach('selfie', opts.selfie ?? kycImage(), 'selfie.png');
}

function created(res: { status: number; body: unknown }) {
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res;
}

async function statusOf(user: TestUser) {
  const r = await ctx.prisma.kycRequest.findFirstOrThrow({
    where: { memberId: user.id },
    orderBy: { submittedAt: 'desc' },
  });
  const m = await ctx.prisma.member.findUniqueOrThrow({ where: { id: user.id } });
  return { request: r, member: m };
}

describe('US-3.1 — soumission de la pièce et du selfie', () => {
  it('nominal : SUBMITTED, documents chiffrés au repos sous clé opaque, kyc.submitted, message au membre', async () => {
    const { user, token } = await applicant();
    const front = kycImage();
    const res = await submit(token, { front });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'SUBMITTED' });
    const docs = await ctx.prisma.kycDocument.findMany({
      where: { requestId: res.body.kycRequestId },
    });
    expect(docs.map((d) => d.kind).sort()).toEqual(['ID_BACK', 'ID_FRONT', 'SELFIE']);
    const frontDoc = docs.find((d) => d.kind === 'ID_FRONT')!;
    expect(frontDoc.storageKey).not.toContain(user.id);
    const storage = ctx.app.get(DocumentStorage);
    const raw = await storage.getEncrypted(frontDoc.storageKey);
    expect(raw.equals(front)).toBe(false);
    expect(raw.includes(Buffer.from('IHDR'))).toBe(false);
    expect((await storage.get(frontDoc.storageKey)).equals(front)).toBe(true);
    const r = await ctx.prisma.kycRequest.findUniqueOrThrow({
      where: { id: res.body.kycRequestId },
    });
    expect(r.retentionUntil.getTime() - r.submittedAt.getTime()).toBe(7 * 365 * 86_400_000);
    expect(await ctx.prisma.outboxEvent.count({ where: { eventType: 'kyc.submitted' } })).toBe(1);
    const me = await ctx.http.get('/api/v1/kyc/me').set(bearer(token));
    expect(me.body.message).toBe('Vos documents sont en cours de vérification');
  });

  it('type de pièce selon le pays (CM : CNI, passeport, permis ; NG : NIN)', async () => {
    const { token } = await applicant();
    const reqs = await ctx.http.get('/api/v1/kyc/requirements').set(bearer(token));
    expect(reqs.body.documentTypes).toEqual(['CNI', 'PASSPORT', 'DRIVING_LICENSE']);
    const res = await submit(token, { documentType: 'NIN_SLIP' });
    expect(res.status).toBe(400);
  });

  it('passeport : recto seul accepté ; CNI sans verso refusée', async () => {
    const { token } = await applicant();
    expect((await submit(token, { documentType: 'CNI', back: null })).status).toBe(400);
    expect((await submit(token, { documentType: 'PASSPORT', back: null })).status).toBe(201);
  });

  it('contraintes fichier : résolution ≥ 1000×600, JPEG/PNG, 10 Mo max', async () => {
    const { token } = await applicant();
    const small = await submit(token, { front: kycImage('', 800, 500) });
    expect(small.status).toBe(400);
    expect(small.body.detail).toContain('1000×600');
    const pdf = await submit(token, { front: Buffer.from('%PDF-1.7 fake') });
    expect(pdf.status).toBe(415);
    const big = Buffer.concat([kycImage(), Buffer.alloc(11 * 1024 * 1024)]);
    expect((await submit(token, { front: big })).status).toBe(413);
  });

  it('selfie en direct uniquement : session caméra (liveness) obligatoire et à usage unique', async () => {
    const { token } = await applicant();
    expect((await submit(token, { liveness: null })).status).toBe(400);
    expect((await submit(token, { liveness: 'inventé-123456' })).status).toBe(400);
    const live = (await ctx.http.post('/api/v1/kyc/liveness').set(bearer(token))).body
      .livenessToken;
    expect((await submit(token, { liveness: live })).status).toBe(201);
  });

  it('un seul dossier à la fois (pas de soumissions parallèles)', async () => {
    const { token } = await applicant();
    created(await submit(token));
    const second = await submit(token);
    expect(second.status).toBe(422);
    expect(second.body.code).toBe('KYC_REQUEST_IN_PROGRESS');
  });
});

describe('US-3.2 — vérification automatique', () => {
  it('toutes les étapes passent → VERIFIED, TIER_2, membre ACTIVE, 6 contrôles tracés', async () => {
    const { user, token } = await applicant();
    created(await submit(token));
    await ctx.drain();
    const { request, member } = await statusOf(user);
    expect(request.status).toBe('VERIFIED');
    expect(member).toMatchObject({ status: 'ACTIVE', kycLevel: 'TIER_2', countrySource: 'KYC' });
    const checks = await ctx.prisma.kycCheck.findMany({ where: { requestId: request.id } });
    expect(checks.map((c) => c.step).sort()).toEqual([
      'AML',
      'DOCUMENT_VALIDATION',
      'DUPLICATE',
      'FACE_MATCH',
      'OCR',
      'QUALITY',
    ]);
    expect(checks.every((c) => c.outcome === 'PASS')).toBe(true);
    expect(request.documentNumberHash).toHaveLength(64);
    const total = checks.reduce((s, c) => s + (c.durationMs ?? 0), 0);
    expect(total).toBeLessThan(10_000);
    expect(
      await ctx.prisma.notification.count({
        where: { recipientId: user.id, templateKey: 'kyc.verified' },
      }),
    ).toBeGreaterThan(0);
  });

  it('face match 72 % → REVIEW_REQUIRED (SLA 24 h ouvrées), membre KYC_IN_REVIEW', async () => {
    const { user, token } = await applicant();
    created(await submit(token, { selfie: kycImage('facematch=72') }));
    await ctx.drain();
    const { request, member } = await statusOf(user);
    expect(request.status).toBe('REVIEW_REQUIRED');
    expect(request.slaDueAt).not.toBeNull();
    expect(member.status).toBe('KYC_IN_REVIEW');
  });

  it('face match 60 % → REJECTED (FACE_MATCH_ECHOUE), resoumission possible, historique conservé', async () => {
    const { user, token } = await applicant();
    created(await submit(token, { selfie: kycImage('facematch=60') }));
    await ctx.drain();
    const { request, member } = await statusOf(user);
    expect(request).toMatchObject({ status: 'REJECTED', rejectCategory: 'FACE_MATCH_ECHOUE' });
    expect(member.status).toBe('KYC_REJECTED');
    created(await submit(token));
    await ctx.drain();
    expect((await statusOf(user)).member.status).toBe('ACTIVE');
    expect(await ctx.prisma.kycRequest.count({ where: { memberId: user.id } })).toBe(2);
  });

  it('document expiré → rejet automatique (R-KYC-03)', async () => {
    const { user, token } = await applicant();
    created(await submit(token, { front: kycImage('expired') }));
    await ctx.drain();
    expect((await statusOf(user)).request).toMatchObject({
      status: 'REJECTED',
      rejectCategory: 'DOCUMENT_EXPIRE',
    });
  });

  it('image floue → échec qualité avec recommandation de resoumettre', async () => {
    const { user, token } = await applicant();
    created(await submit(token, { front: kycImage('blur') }));
    await ctx.drain();
    const { request } = await statusOf(user);
    expect(request).toMatchObject({ status: 'REJECTED', rejectCategory: 'DOCUMENT_ILLISIBLE' });
    const q = await ctx.prisma.kycCheck.findFirstOrThrow({
      where: { requestId: request.id, step: 'QUALITY' },
    });
    expect((q.details as { recommendation: string }).recommendation).toMatch(/nouvelle photo/);
  });

  it('nom incohérent (Levenshtein > 2) → revue manuelle', async () => {
    const { user, token } = await applicant({ firstName: 'Awa', lastName: 'Mbarga' });
    created(await submit(token, { front: kycImage('ocrlast=Tchoumba') }));
    await ctx.drain();
    expect((await statusOf(user)).request.status).toBe('REVIEW_REQUIRED');
  });

  it('fournisseur indisponible → 3 tentatives puis escalade manuelle', async () => {
    const { user, token } = await applicant();
    created(await submit(token, { selfie: kycImage('face-down') }));
    await ctx.drain();
    const { request } = await statusOf(user);
    expect(request.status).toBe('REVIEW_REQUIRED');
    const face = await ctx.prisma.kycCheck.findFirstOrThrow({
      where: { requestId: request.id, step: 'FACE_MATCH' },
    });
    expect(face.attempts).toBe(3);
    expect((face.details as { escalated: boolean }).escalated).toBe(true);
  });
});

describe('US-3.3 — revue manuelle par un agent KYC', () => {
  async function reviewCase(selfie = 'facematch=78') {
    const a = await applicant();
    created(await submit(a.token, { selfie: kycImage(selfie) }));
    await ctx.drain();
    const agent = await ctx.createUser({ role: 'KYC_AGENT' });
    return {
      ...a,
      agentToken: await ctx.token(agent),
      requestId: (await statusOf(a.user)).request.id,
    };
  }

  it('file triée par ancienneté, détail complet ; interdite aux membres', async () => {
    const { requestId, agentToken, token } = await reviewCase();
    const queue = await ctx.http.get('/api/v1/kyc/reviews').set(bearer(agentToken));
    expect(queue.status).toBe(200);
    expect(queue.body.data[0]).toMatchObject({ id: requestId, slaBreached: false });
    const detail = await ctx.http.get(`/api/v1/kyc/requests/${requestId}`).set(bearer(agentToken));
    expect(detail.body.checks.find((c: { step: string }) => c.step === 'FACE_MATCH').score).toBe(
      78,
    );
    expect(detail.body.documents).toHaveLength(3);
    expect((await ctx.http.get('/api/v1/kyc/reviews').set(bearer(token))).status).toBe(403);
  });

  it('lecture d’un document : réservée aux agents et journalisée', async () => {
    const { requestId, agentToken, token } = await reviewCase();
    const detail = await ctx.http.get(`/api/v1/kyc/requests/${requestId}`).set(bearer(agentToken));
    const docId = detail.body.documents[0].id;
    const img = await ctx.http.get(`/api/v1/kyc/documents/${docId}`).set(bearer(agentToken));
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toContain('image/png');
    expect(
      await ctx.prisma.auditLog.count({
        where: { action: 'kyc.document.read', resourceId: docId },
      }),
    ).toBe(1);
    expect((await ctx.http.get(`/api/v1/kyc/documents/${docId}`).set(bearer(token))).status).toBe(
      403,
    );
  });

  it('acceptation avec annotation (≥ 10 caractères) → VERIFIED, membre ACTIVE, action journalisée', async () => {
    const { user, requestId, agentToken } = await reviewCase();
    const short = await ctx.http
      .post(`/api/v1/kyc/requests/${requestId}/decision`)
      .set(bearer(agentToken))
      .send({ action: 'APPROVE', annotation: 'ok' });
    expect(short.status).toBe(400);
    await ctx.http
      .post(`/api/v1/kyc/requests/${requestId}/decision`)
      .set(bearer(agentToken))
      .send({ action: 'APPROVE', annotation: 'Visage conforme après zoom' })
      .expect(200);
    await ctx.drain();
    expect((await statusOf(user)).member).toMatchObject({ status: 'ACTIVE', kycLevel: 'TIER_2' });
    expect(await ctx.prisma.kycAgentAction.count({ where: { requestId } })).toBe(1);
  });

  it('rejet avec catégorie + commentaire obligatoire ; demande de compléments', async () => {
    const { user, requestId, agentToken } = await reviewCase();
    const noComment = await ctx.http
      .post(`/api/v1/kyc/requests/${requestId}/decision`)
      .set(bearer(agentToken))
      .send({ action: 'REJECT', category: 'DOCUMENT_FALSIFIE', comment: '' });
    expect(noComment.status).toBe(400);
    await ctx.http
      .post(`/api/v1/kyc/requests/${requestId}/decision`)
      .set(bearer(agentToken))
      .send({ action: 'REQUEST_SUPPLEMENT', comment: 'Merci de fournir un verso lisible' })
      .expect(200);
    await ctx.drain();
    expect((await statusOf(user)).request.status).toBe('SUPPLEMENT_REQUESTED');
    expect(
      await ctx.prisma.notification.count({
        where: { recipientId: user.id, templateKey: 'kyc.supplement_requested' },
      }),
    ).toBeGreaterThan(0);
  });
});

describe('US-3.4 — doublons biométriques', () => {
  it('même visage (> 90 %) : alerte, nouveau compte bloqué PENDING_REVIEW, kyc.duplicate.detected ; résolution par un agent', async () => {
    const first = await applicant();
    created(await submit(first.token, { selfie: kycImage('face=jumeau') }));
    await ctx.drain();
    const second = await applicant();
    created(await submit(second.token, { selfie: kycImage('face=jumeau') }));
    await ctx.drain();
    const alert = await ctx.prisma.kycDuplicateAlert.findFirstOrThrow({
      where: { memberId: second.user.id },
    });
    expect(alert).toMatchObject({ duplicateOfMemberId: first.user.id, status: 'OPEN' });
    expect(alert.similarityScore).toBeGreaterThan(90);
    expect((await statusOf(second.user)).member.status).toBe('PENDING_REVIEW');
    expect(
      await ctx.prisma.outboxEvent.count({ where: { eventType: 'kyc.duplicate.detected' } }),
    ).toBe(1);
    const agent = await ctx.createUser({ role: 'KYC_AGENT' });
    const agentToken = await ctx.token(agent);
    const list = await ctx.http.get('/api/v1/kyc/duplicates').set(bearer(agentToken));
    expect(list.body.data[0].links.newFile).toContain(alert.requestId);
    await ctx.http
      .post(`/api/v1/kyc/duplicates/${alert.id}/resolve`)
      .set(bearer(agentToken))
      .send({ resolution: 'DISMISSED', comment: 'Jumeaux, pièces différentes' })
      .expect(204);
    await ctx.drain();
    expect((await statusOf(second.user)).member.status).toBe('KYC_IN_REVIEW');
  });
});

describe('US-3.5 — screening AML / sanctions', () => {
  it('correspondance → REVIEW_REQUIRED (jamais de rejet automatique) ; faux positif → liste blanche', async () => {
    const agent = await ctx.createUser({ role: 'KYC_AGENT' });
    const { user } = await applicant({ firstName: 'Viktor', lastName: 'Contrebandier' });
    const token = await ctx.token(user);
    created(await submit(token));
    await ctx.drain();
    await ctx.drain();
    const { request } = await statusOf(user);
    expect(request.status).toBe('REVIEW_REQUIRED');
    const match = await ctx.prisma.kycAmlMatch.findFirstOrThrow({ where: { memberId: user.id } });
    expect(match).toMatchObject({ listName: 'OFAC', status: 'OPEN', source: 'SUBMISSION' });
    // alerte à l'équipe conformité, sans nom ni pièce d'identité
    const alert = await ctx.prisma.notification.findFirstOrThrow({
      where: { recipientId: agent.id, templateKey: 'kyc.aml_alert' },
    });
    expect(alert.body).toContain('OFAC');
    expect(alert.body).not.toContain('Contrebandier');
    await ctx.http
      .post(`/api/v1/kyc/aml-matches/${match.id}/resolve`)
      .set(bearer(await ctx.token(agent)))
      .send({ resolution: 'FALSE_POSITIVE', comment: 'Homonyme, date de naissance différente' })
      .expect(204);
    expect(
      await ctx.prisma.kycAmlWhitelist.count({
        where: { memberId: user.id, entryId: match.entryId },
      }),
    ).toBe(1);
  });

  it('batch quotidien : une nouvelle entrée de liste visant un membre actif crée une alerte', async () => {
    const m = await ctx.createUser({ firstName: 'Jules', lastName: 'Nouvelentree' });
    ctx.app.get(SimulatedAmlProvider).addEntry({
      listName: 'UE',
      entryId: 'EU-TEST-NEW',
      entryName: 'Jules Nouvelentree',
      entryCountry: 'XX',
      entryReason: 'Ajout récent (fictif)',
      entryAddedAt: '2026-09-01',
    });
    const run = await ctx.jobs.run('kyc.aml-batch', 'test');
    expect(run.summary).toMatchObject({ newMatches: 1 });
    expect(await ctx.prisma.kycAmlMatch.count({ where: { memberId: m.id, source: 'BATCH' } })).toBe(
      1,
    );
    // Rejouer le batch ne duplique pas l'alerte
    await ctx.jobs.run('kyc.aml-batch', 'test');
    expect(await ctx.prisma.kycAmlMatch.count({ where: { memberId: m.id } })).toBe(1);
  });
});

describe('US-3.6 — expiration et renouvellement', () => {
  it('J-30, J-7, J-0 (EXPIRED, TIER_2 conservé pendant la grâce), J+30 (opérations suspendues : TIER_1)', async () => {
    const { user, token } = await applicant();
    created(await submit(token, { front: kycImage('expiring=40') }));
    await ctx.drain();
    expect((await statusOf(user)).request.status).toBe('VERIFIED');
    ctx.clock.advanceDays(12); // J-28
    expect((await ctx.jobs.run('kyc.expiry', 'test')).summary).toMatchObject({ warned: 1 });
    await ctx.drain();
    expect(
      await ctx.prisma.notification.count({
        where: { recipientId: user.id, templateKey: 'kyc.expiring_30' },
      }),
    ).toBeGreaterThan(0);
    ctx.clock.advanceDays(22); // J-6
    await ctx.jobs.run('kyc.expiry', 'test');
    await ctx.drain();
    expect(
      await ctx.prisma.notification.count({
        where: { recipientId: user.id, templateKey: 'kyc.expiring_7', channel: 'SMS' },
      }),
    ).toBe(1);
    ctx.clock.advanceDays(6); // J-0
    expect((await ctx.jobs.run('kyc.expiry', 'test')).summary).toMatchObject({ expired: 1 });
    await ctx.drain();
    expect((await statusOf(user)).request.status).toBe('EXPIRED');
    expect((await statusOf(user)).member.kycLevel).toBe('TIER_2');
    ctx.clock.advanceDays(30); // J+30
    expect((await ctx.jobs.run('kyc.expiry', 'test')).summary).toMatchObject({ suspended: 1 });
    await ctx.drain();
    expect((await statusOf(user)).member.kycLevel).toBe('TIER_1');
    // Renouvellement : retour au flux US-3.1
    await ctx.prisma.member.update({ where: { id: user.id }, data: { status: 'KYC_REQUIRED' } });
    created(await submit(await ctx.token(user)));
    await ctx.drain();
    expect((await statusOf(user)).member).toMatchObject({ kycLevel: 'TIER_2', status: 'ACTIVE' });
  });
});

describe('A-03 — niveau 3', () => {
  it('demande de niveau 3 → revue manuelle → TIER_3', async () => {
    const { user, token } = await applicant();
    created(await submit(token));
    await ctx.drain();
    const live = (await ctx.http.post('/api/v1/kyc/liveness').set(bearer(token))).body
      .livenessToken;
    const res = await ctx.http
      .post('/api/v1/kyc/tier3')
      .set(bearer(token))
      .field('incomeSource', 'Commerce de détail')
      .field('captureSource', 'CAMERA')
      .field('livenessToken', live)
      .attach('proofOfAddress', kycImage(), 'facture.png')
      .attach('selfie', kycImage(), 'selfie.png');
    expect(res.status).toBe(201);
    await ctx.drain();
    const r = await ctx.prisma.kycRequest.findUniqueOrThrow({
      where: { id: res.body.kycRequestId },
    });
    expect(r.status).toBe('REVIEW_REQUIRED');
    const agent = await ctx.createUser({ role: 'KYC_AGENT' });
    await ctx.http
      .post(`/api/v1/kyc/requests/${r.id}/decision`)
      .set(bearer(await ctx.token(agent)))
      .send({ action: 'APPROVE', annotation: 'Justificatif de domicile conforme' })
      .expect(200);
    await ctx.drain();
    expect((await ctx.prisma.member.findUniqueOrThrow({ where: { id: user.id } })).kycLevel).toBe(
      'TIER_3',
    );
  });
});
