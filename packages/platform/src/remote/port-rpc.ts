import {
  Controller,
  type DynamicModule,
  Global,
  HttpCode,
  Inject,
  Injectable,
  Logger,
  Module,
  Param,
  Post,
  type Provider,
  type RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ApiExcludeController } from '@nestjs/swagger';
import { signInternalRequest, verifyInternalRequest } from '@tontine/auth';
import { type AppConfig } from '@tontine/config';
import { type Request } from 'express';
import { ACCESS_TOKEN_VERIFIER, APP_CONFIG } from '../context/tokens';
import { Clock } from '../context/clock';
import { DomainError } from '../errors/domain-error';
import { Public } from '../http/decorators';
import {
  ACCOUNT_DIRECTORY,
  CONFIGURATION,
  MEMBER_QUERY,
  TONTINE_ACCESS,
  TRANSACTION_TOTALS,
  WALLET_QUERY,
} from '../ports';

/**
 * Ports exposés par appel interne (étape 7, A-55). Liste fermée : seules ces méthodes, en
 * lecture, sont appelables à distance ; tout le reste d'un port reste interne à son processus.
 */
export const REMOTE_PORTS = {
  'auth.tokens': { token: ACCESS_TOKEN_VERIFIER, methods: ['verify'] },
  'auth.accounts': { token: ACCOUNT_DIRECTORY, methods: ['account', 'statistics'] },
  'members.query': {
    token: MEMBER_QUERY,
    methods: [
      'snapshot',
      'snapshots',
      'findByIdentifier',
      'snapshotsByStatus',
      'countryChangesSince',
    ],
  },
  'tontines.access': {
    token: TONTINE_ACCESS,
    methods: [
      'describe',
      'adminIds',
      'participantIds',
      'isAdmin',
      'isParticipant',
      'tontineIdsOf',
      'shareTontine',
      'administrationAccess',
    ],
  },
  'administration.configuration': { token: CONFIGURATION, methods: ['get'] },
  'transactions.totals': { token: TRANSACTION_TOTALS, methods: ['initiatedTotal'] },
  'wallets.query': { token: WALLET_QUERY, methods: ['memberBalance'] },
} as const satisfies Record<string, { token: symbol; methods: readonly string[] }>;

export type RemotePortName = keyof typeof REMOTE_PORTS;

// ------------------------------------------------------------------ codec
/** Sérialisation fidèle des arguments et résultats : bigint et dates préservés (balises). */
function toWire(value: unknown): unknown {
  if (typeof value === 'bigint') return { $bigint: value.toString() };
  if (value instanceof Date) return { $date: value.toISOString() };
  if (Array.isArray(value)) return value.map(toWire);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toWire(v)]));
  return value;
}

export function encodeWire(value: unknown): string {
  return JSON.stringify({ v: toWire(value) });
}

export function decodeWire(raw: string): unknown {
  return (
    JSON.parse(raw, (_k, v: unknown) => {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const keys = Object.keys(v);
        if (keys.length === 1 && keys[0] === '$bigint')
          return BigInt((v as { $bigint: string }).$bigint);
        if (keys.length === 1 && keys[0] === '$date')
          return new Date((v as { $date: string }).$date);
      }
      return v;
    }) as { v: unknown }
  ).v;
}

interface WireResult {
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string; extra?: Record<string, unknown> };
}

// ------------------------------------------------------------------ serveur (propriétaire)
/**
 * Point d'entrée des appels de ports (propriétaire) : jamais exposé par l'API Gateway
 * (`/api/v1/internal/` bloqué), authentifié par HMAC du corps (appelant, horodatage borné).
 * Une erreur métier est renvoyée comme telle (code, message) pour être relevée à l'identique.
 */
@ApiExcludeController()
@Controller({ version: '1', path: 'internal/ports' })
export class PortRpcController {
  private readonly logger = new Logger(PortRpcController.name);

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post(':port/:method')
  @Public()
  @HttpCode(200)
  async call(
    @Param('port') port: string,
    @Param('method') method: string,
    @Req() req: RawBodyRequest<Request>,
  ): Promise<string> {
    const raw = req.rawBody?.toString('utf8') ?? '';
    const check = verifyInternalRequest(this.config.INTERNAL_SERVICE_SECRET, req.headers, raw, {
      allowedCallers: this.config.INTERNAL_PORT_CALLERS,
      toleranceSeconds: 60,
      now: this.clock.now(),
    });
    if (!check.ok) throw new DomainError('INVALID_SIGNATURE', 'Appel interne non authentifié');
    const def = (REMOTE_PORTS as Record<string, { token: symbol; methods: readonly string[] }>)[
      port
    ];
    if (!def || !def.methods.includes(method))
      throw new DomainError('NOT_FOUND', 'Port ou méthode non exposé');
    const impl = this.moduleRef.get<Record<string, (...a: unknown[]) => Promise<unknown>>>(
      def.token,
      { strict: false },
    );
    const args = decodeWire(raw);
    if (!Array.isArray(args)) throw new DomainError('VALIDATION_FAILED', 'Arguments attendus');
    try {
      const fn = impl[method];
      if (typeof fn !== 'function') throw new DomainError('NOT_FOUND', 'Méthode absente');
      return encodeWire({ ok: true, result: await fn.apply(impl, args) });
    } catch (e) {
      if (e instanceof DomainError)
        return encodeWire({
          ok: false,
          error: { code: e.code, message: e.message, extra: e.extra },
        });
      this.logger.error(`Port ${port}.${method} (${check.caller}) : ${(e as Error).message}`);
      throw e;
    }
  }
}

/** Module du propriétaire : expose les ports du processus aux services extraits. */
@Module({ controllers: [PortRpcController] })
export class PortRpcServerModule {}

// ------------------------------------------------------------------ client (service extrait)
export interface RemotePortsOptions {
  /** Adresse du processus propriétaire (monolithe tant que le domaine n'est pas extrait). */
  baseUrl: string;
  /** Nom de l'appelant, signé (doit figurer dans INTERNAL_PORT_CALLERS du propriétaire). */
  caller: string;
  ports: RemotePortName[];
  timeoutMs?: number;
}

@Injectable()
export class RemotePortClient {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly clock: Clock,
  ) {}

  async call(
    options: RemotePortsOptions,
    port: RemotePortName,
    method: string,
    args: unknown[],
  ): Promise<unknown> {
    const body = encodeWire(args);
    const res = await fetch(`${options.baseUrl}/api/v1/internal/ports/${port}/${method}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...signInternalRequest(
          this.config.INTERNAL_SERVICE_SECRET,
          options.caller,
          body,
          this.clock.now(),
        ),
      },
      body,
      signal: AbortSignal.timeout(options.timeoutMs ?? 5000),
    });
    const text = await res.text();
    if (!res.ok)
      throw new DomainError('PROVIDER_UNAVAILABLE', `Port ${port}.${method} : HTTP ${res.status}`);
    const out = decodeWire(text) as WireResult;
    if (!out.ok && out.error)
      throw new DomainError(out.error.code as never, out.error.message, out.error.extra ?? {});
    return out.result;
  }
}

/** Implémentation d'un port par appels internes : chaque méthode exposée devient un appel. */
function remoteProxy(
  client: RemotePortClient,
  options: RemotePortsOptions,
  port: RemotePortName,
): Record<string, (...args: unknown[]) => Promise<unknown>> {
  const out: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  for (const m of REMOTE_PORTS[port].methods)
    out[m] = (...args: unknown[]) => client.call(options, port, m, args);
  return out;
}

/**
 * Module d'un service extrait : fournit les ports demandés par appels internes signés vers
 * leur propriétaire (même interface qu'en processus unique).
 */
@Global()
@Module({})
export class RemotePortsModule {
  static forRoot(options: RemotePortsOptions): DynamicModule {
    const providers: Provider[] = [
      RemotePortClient,
      ...options.ports.map((p) => ({
        provide: REMOTE_PORTS[p].token,
        useFactory: (client: RemotePortClient) => remoteProxy(client, options, p),
        inject: [RemotePortClient],
      })),
    ];
    return {
      module: RemotePortsModule,
      providers,
      exports: options.ports.map((p) => REMOTE_PORTS[p].token),
    };
  }
}
