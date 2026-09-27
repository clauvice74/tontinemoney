import {
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  type RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import { type AppConfig } from '@tontine/config';
import {
  type DepositInput,
  PAYMENT_STATUSES,
  type WithdrawalInput,
  depositSchema,
  refundSchema,
  withdrawalSchema,
} from '@tontine/contracts';
import {
  APP_CONFIG,
  type Actor,
  ApiZodBody,
  ApiZodQuery,
  CurrentUser,
  DomainError,
  Idempotent,
  PrismaService,
  Public,
  Roles,
  ZodBody,
  ZodQuery,
} from '@tontine/platform';
import { type Request } from 'express';
import { z } from 'zod';
import { PaymentsService } from './payments.service';
import { ProviderRegistry } from './provider-registry';

const adminQuery = z.object({
  status: z.enum(PAYMENT_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
const outcomeSchema = z.object({
  outcome: z.enum(['SUCCESS', 'FAILURE']),
  deliverWebhook: z.boolean().default(true),
});

function headersOf(req: Request): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.headers))
    out[k.toLowerCase()] = Array.isArray(v) ? v[0] : v;
  return out;
}

@ApiTags('Paiements')
@ApiBearerAuth()
@Controller({ version: '1' })
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('me/wallet/deposits')
  @Idempotent('wallet.deposit')
  @ApiOperation({
    summary: 'Dépôt Mobile Money (USSD simulé) ou carte (3-D Secure simulé) — US-7.1 / US-7.2',
  })
  @ApiZodBody(depositSchema)
  async deposit(
    @CurrentUser() actor: Actor,
    @ZodBody(depositSchema) body: DepositInput,
    @Req() req: Request,
  ) {
    return this.payments.deposit(actor, body, req.header('idempotency-key') ?? '');
  }

  @Post('me/wallet/withdrawals')
  @Idempotent('wallet.withdrawal')
  @ApiOperation({ summary: 'Retrait Mobile Money : blocage des fonds puis versement PSP (US-7.3)' })
  @ApiZodBody(withdrawalSchema)
  async withdraw(
    @CurrentUser() actor: Actor,
    @ZodBody(withdrawalSchema) body: WithdrawalInput,
    @Req() req: Request,
  ) {
    return this.payments.withdraw(actor, body, req.header('idempotency-key') ?? '');
  }

  @Get('me/payments')
  @ApiOperation({ summary: 'Mes paiements' })
  async mine(@CurrentUser() actor: Actor) {
    return { data: await this.payments.listMine(actor) };
  }

  @Get('me/payments/:id')
  @ApiOperation({ summary: 'Détail d’un paiement (historique des statuts)' })
  async one(@CurrentUser() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.getMine(actor, id);
  }

  @Get('admin/payments')
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Tous les paiements (super-admin)' })
  @ApiZodQuery(adminQuery)
  async all(@ZodQuery(adminQuery) q: z.infer<typeof adminQuery>) {
    return { data: await this.payments.listAll(q) };
  }

  @Post('admin/payments/:id/refund')
  @Roles('SUPER_ADMIN')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Rembourser un dépôt (API refund du PSP + reversement interne) — US-7.5',
  })
  @ApiZodBody(refundSchema)
  async refund(
    @CurrentUser() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(refundSchema) body: { reason: string },
  ) {
    return this.payments.refund(actor, id, body.reason);
  }
}

@ApiTags('Paiements')
@Controller({ version: '1' })
export class WebhooksController {
  constructor(private readonly payments: PaymentsService) {}

  /** Webhook PSP : signature HMAC, horodatage (anti-rejeu), identifiant unique, montant + devise. */
  @Post('payments/webhooks/:provider')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Webhook PSP signé (x-psp-signature, x-psp-timestamp)' })
  async webhook(@Param('provider') provider: string, @Req() req: RawBodyRequest<Request>) {
    return this.payments.receiveWebhook(provider, headersOf(req), req.rawBody);
  }
}

/**
 * Simulateur de PSP (hors production uniquement) : page 3-D Secure fictive et confirmation USSD.
 * Aucune donnée de carte n'est demandée ni stockée.
 */
@ApiTags('Simulateur PSP (dev)')
@Controller({ version: '1', path: 'psp-sim' })
export class PspSimulatorController {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private guard(): void {
    if (this.config.NODE_ENV === 'production')
      throw new DomainError('NOT_FOUND', 'Ressource introuvable');
  }

  private async operation(reference: string) {
    this.guard();
    const op = await this.prisma.pspSimOperation.findUnique({ where: { reference } });
    if (!op) throw new DomainError('NOT_FOUND', 'Référence inconnue');
    return op;
  }

  @Get('checkout/:reference')
  @Public()
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @ApiExcludeEndpoint()
  async checkout(@Param('reference') reference: string): Promise<string> {
    const op = await this.operation(reference);
    const amount = `${op.amountMinor.toString()} ${op.currency} (unités mineures)`;
    const back = `${this.config.APP_PUBLIC_URL.replace(/\/$/, '')}/wallet?payment=${encodeURIComponent(op.merchantReference)}`;
    return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>3-D Secure (simulation)</title>
<style>body{font-family:system-ui,sans-serif;background:#f4f6f8;margin:0;padding:24px}main{max-width:420px;margin:auto;background:#fff;border-radius:12px;padding:24px;box-shadow:0 2px 12px #0001}
.warn{background:#fff4e5;border:1px solid #f0b35b;padding:8px 12px;border-radius:8px;font-size:14px}button{width:100%;padding:12px;margin-top:12px;border-radius:8px;border:0;font-size:16px;cursor:pointer}
.ok{background:#0f766e;color:#fff}.ko{background:#e5e7eb}</style></head><body><main>
<h1>Authentification 3-D Secure</h1><p class="warn">Page de <strong>simulation</strong> : aucune carte réelle, aucune donnée bancaire saisie.</p>
<p>Montant : <strong>${amount}</strong><br>Statut : <strong id="st">${op.status}</strong></p>
<button class="ok" onclick="send('SUCCESS')">Valider le paiement (simulation)</button>
<button class="ko" onclick="send('FAILURE')">Refuser le paiement (simulation)</button>
<script>async function send(o){const r=await fetch(location.pathname,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({outcome:o})});
document.getElementById('st').textContent=r.ok?(o==='SUCCESS'?'Validé':'Refusé'):'Erreur';setTimeout(()=>{location.href=${JSON.stringify(back)}},800)}</script>
</main></body></html>`;
  }

  @Post('checkout/:reference')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Simulateur : issue de la page 3-D Secure' })
  async checkoutOutcome(
    @Param('reference') reference: string,
    @ZodBody(outcomeSchema) body: z.infer<typeof outcomeSchema>,
  ) {
    const op = await this.operation(reference);
    if (op.kind !== 'COLLECT_CARD') throw new DomainError('NOT_FOUND', 'Référence inconnue');
    return this.registry
      .simulated(op.provider)
      .settle(op.reference, body.outcome, body.deliverWebhook);
  }

  /** Confirmation USSD : réservée au membre concerné (ou super-admin). */
  @Post('mobile-money/:reference/confirm')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Simulateur : validation / refus de la demande USSD sur le téléphone' })
  async confirm(
    @CurrentUser() actor: Actor,
    @Param('reference') reference: string,
    @ZodBody(outcomeSchema) body: z.infer<typeof outcomeSchema>,
  ) {
    const op = await this.operation(reference);
    const payment = await this.prisma.payment.findUnique({
      where: { id: op.merchantReference },
      select: { memberId: true },
    });
    if (
      op.kind !== 'COLLECT_MOBILE_MONEY' ||
      !payment ||
      (payment.memberId !== actor.userId && actor.role !== 'SUPER_ADMIN')
    ) {
      throw new DomainError('NOT_FOUND', 'Référence inconnue');
    }
    return this.registry
      .simulated(op.provider)
      .settle(op.reference, body.outcome, body.deliverWebhook);
  }

  @Post('payouts/:reference/settle')
  @Roles('SUPER_ADMIN')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Simulateur : règlement d’un versement (retrait)' })
  async settlePayout(
    @Param('reference') reference: string,
    @ZodBody(outcomeSchema) body: z.infer<typeof outcomeSchema>,
  ) {
    const op = await this.operation(reference);
    if (op.kind !== 'PAYOUT') throw new DomainError('NOT_FOUND', 'Référence inconnue');
    return this.registry
      .simulated(op.provider)
      .settle(op.reference, body.outcome, body.deliverWebhook);
  }
}
