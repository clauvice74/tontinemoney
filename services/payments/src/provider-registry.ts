import { Inject, Injectable, Logger } from '@nestjs/common';
import { type AppConfig } from '@tontine/config';
import {
  APP_CONFIG,
  CircuitBreaker,
  CircuitOpenError,
  Clock,
  MetricsService,
  PrismaService,
  withRetry,
} from '@tontine/platform';
import {
  type CollectResult,
  PaymentProvider,
  ProviderDisabledError,
  ProviderUnavailableError,
} from './providers/payment-provider';
import { FlutterwaveProvider, PaystackProvider } from './providers/real-providers';
import { SimulatedPspProvider } from './providers/simulated.provider';

export const PRIMARY_PROVIDER = 'simulated';
export const BACKUP_PROVIDER = 'simulated-backup';

export interface ProviderCallResult<T> {
  provider: PaymentProvider;
  result: T;
  attempts: number;
  fallbackUsed: boolean;
}

/**
 * Registre des PSP : disjoncteur par prestataire (US-7.4), rejeu 3× avec backoff exponentiel
 * (R-PAY-03 : 1 s, 4 s, 16 s) et repli vers le PSP alternatif (US-7.1).
 */
@Injectable()
export class ProviderRegistry {
  private readonly logger = new Logger(ProviderRegistry.name);
  private readonly providers = new Map<string, PaymentProvider>();
  private readonly breakers = new Map<string, CircuitBreaker>();
  private readonly retryDelays: number[];

  constructor(
    prisma: PrismaService,
    private readonly clock: Clock,
    private readonly metrics: MetricsService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    const common = {
      secret: config.PSP_WEBHOOK_SECRET,
      toleranceSeconds: config.PSP_WEBHOOK_TOLERANCE_SECONDS,
      checkoutBaseUrl: config.API_PUBLIC_URL,
      now: () => clock.now(),
    };
    this.register(new SimulatedPspProvider(prisma, { ...common, name: PRIMARY_PROVIDER }));
    this.register(new SimulatedPspProvider(prisma, { ...common, name: BACKUP_PROVIDER }));
    // Squelettes désactivés : présents pour l'interface et la vérification des webhooks uniquement
    this.register(new FlutterwaveProvider(config.FLUTTERWAVE_WEBHOOK_HASH || null));
    this.register(new PaystackProvider(config.PAYSTACK_SECRET_KEY || null));
    this.retryDelays = config.NODE_ENV === 'test' ? [5, 10, 20] : [1000, 4000, 16000];
  }

  private register(p: PaymentProvider): void {
    this.providers.set(p.name, p);
    this.breakers.set(
      p.name,
      new CircuitBreaker(`psp:${p.name}`, {
        failureThreshold: 5,
        cooldownMs: 60_000,
        now: () => this.clock.now().getTime(),
      }),
    );
  }

  get(name: string): PaymentProvider | undefined {
    return this.providers.get(name);
  }

  simulated(name: string = PRIMARY_PROVIDER): SimulatedPspProvider {
    const p = this.providers.get(name);
    if (!(p instanceof SimulatedPspProvider)) throw new Error(`${name} n’est pas un PSP simulé`);
    return p;
  }

  allSimulated(): SimulatedPspProvider[] {
    return [...this.providers.values()].filter(
      (p): p is SimulatedPspProvider => p instanceof SimulatedPspProvider,
    );
  }

  breaker(name: string): CircuitBreaker {
    return this.breakers.get(name)!;
  }

  /** Appel protégé (disjoncteur + rejeu) sur un prestataire donné. */
  async call<T>(
    provider: PaymentProvider,
    fn: (p: PaymentProvider) => Promise<T>,
  ): Promise<{ result: T; attempts: number }> {
    if (!provider.enabled) throw new ProviderDisabledError(provider.name);
    const breaker = this.breaker(provider.name);
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts++;
        return breaker.exec(() => fn(provider));
      },
      {
        attempts: 3,
        delaysMs: this.retryDelays,
        retryable: (e) => e instanceof ProviderUnavailableError,
      },
    );
    return { result, attempts };
  }

  /** Initiation avec repli : prestataire principal, puis secours si indisponible. */
  async initiate(
    fn: (p: PaymentProvider) => Promise<CollectResult>,
  ): Promise<ProviderCallResult<CollectResult>> {
    const chain = [PRIMARY_PROVIDER, BACKUP_PROVIDER].map((n) => this.providers.get(n)!);
    let attempts = 0;
    let last: unknown;
    for (const [i, provider] of chain.entries()) {
      try {
        const r = await this.call(provider, fn);
        attempts += r.attempts;
        if (i > 0) this.metrics.businessEvents.inc({ type: `psp.fallback.${provider.name}` });
        return { provider, result: r.result, attempts, fallbackUsed: i > 0 };
      } catch (e) {
        last = e;
        attempts += 3;
        if (!(e instanceof ProviderUnavailableError || e instanceof CircuitOpenError)) throw e;
        this.logger.warn(`PSP ${provider.name} indisponible (${(e as Error).message}) : repli`);
      }
    }
    throw last instanceof Error ? last : new ProviderUnavailableError('all');
  }
}
