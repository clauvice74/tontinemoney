import { Injectable, Logger } from '@nestjs/common';
import {
  CONFIGURATION_DEFINITIONS,
  CONFIGURATION_KEYS,
  type ConfigurationKey,
  type ConfigurationValues,
  type UpdateConfigurationInput,
  isConfigurationKey,
} from '@tontine/contracts';
import { isUniqueViolation } from '@tontine/database';
import {
  type Actor,
  AuditService,
  Clock,
  type ConfigurationPort,
  DomainError,
  OutboxService,
  PrismaService,
  UnitOfWork,
} from '@tontine/platform';

/** Durée du cache local ; l'événement `admin.configuration.updated` l'invalide aussitôt. */
const CACHE_TTL_MS = 30_000;

/**
 * Paramètres modifiables à chaud (A-50), propriété d'admin-service. Les autres services lisent
 * par le port CONFIGURATION : valeur validée par sa définition, défaut sinon (jamais d'échec
 * d'un traitement métier à cause d'un paramètre).
 */
@Injectable()
export class ConfigurationService implements ConfigurationPort {
  private readonly logger = new Logger(ConfigurationService.name);
  private readonly cache = new Map<string, { value: unknown; expiresAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  async get<K extends ConfigurationKey>(key: K): Promise<ConfigurationValues[K]> {
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value as ConfigurationValues[K];
    const def = CONFIGURATION_DEFINITIONS[key];
    let value: unknown = def.default;
    try {
      const row = await this.prisma.configuration.findUnique({ where: { key } });
      if (row) {
        const parsed = def.schema.safeParse(row.value);
        if (parsed.success) value = parsed.data;
        else this.logger.error(`Paramètre ${key} invalide en base : valeur par défaut utilisée`);
      }
    } catch (e) {
      this.logger.error(
        `Lecture du paramètre ${key} impossible : ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    this.cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value as ConfigurationValues[K];
  }

  invalidate(key?: string): void {
    if (key) this.cache.delete(key);
    else this.cache.clear();
  }

  async list() {
    const rows = await this.prisma.configuration.findMany();
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return CONFIGURATION_KEYS.map((key) => {
      const def = CONFIGURATION_DEFINITIONS[key];
      const row = byKey.get(key);
      return {
        key,
        description: def.description,
        owner: def.owner,
        default: def.default,
        value: row?.value ?? def.default,
        overridden: !!row,
        version: row?.version ?? 0,
        updatedBy: row?.updatedBy ?? null,
        updatedAt: row?.updatedAt.toISOString() ?? null,
      };
    });
  }

  async update(actor: Actor, key: string, input: UpdateConfigurationInput) {
    if (!isConfigurationKey(key)) throw new DomainError('NOT_FOUND', 'Paramètre inconnu');
    const parsed = CONFIGURATION_DEFINITIONS[key].schema.safeParse(input.value);
    if (!parsed.success)
      throw new DomainError(
        'VALIDATION_FAILED',
        'Valeur hors des bornes autorisées',
        {},
        parsed.error.issues.map((i) => ({ path: 'value', message: i.message })),
      );
    const now = this.clock.now();
    try {
      await this.uow.run(async (tx) => {
        const row = await tx.configuration.findUnique({ where: { key } });
        if ((row?.version ?? 0) !== input.version)
          throw new DomainError('VERSION_CONFLICT', 'Paramètre modifié entre-temps');
        const oldValue = row?.value ?? CONFIGURATION_DEFINITIONS[key].default;
        if (row) {
          const res = await tx.configuration.updateMany({
            where: { key, version: row.version },
            data: {
              value: parsed.data,
              version: { increment: 1 },
              updatedBy: actor.userId,
              updatedAt: now,
            },
          });
          if (res.count !== 1)
            throw new DomainError('VERSION_CONFLICT', 'Paramètre modifié entre-temps');
        } else {
          await tx.configuration.create({
            data: { key, value: parsed.data, version: 1, updatedBy: actor.userId, updatedAt: now },
          });
        }
        await tx.configurationHistory.create({
          data: {
            key,
            version: input.version + 1,
            oldValue: oldValue as object,
            newValue: parsed.data,
            reason: input.reason,
            changedBy: actor.userId,
            createdAt: now,
          },
        });
        await this.outbox.add(tx, {
          type: 'admin.configuration.updated',
          aggregateType: 'configuration',
          aggregateId: key,
          payload: {
            key,
            oldValue,
            newValue: parsed.data,
            version: input.version + 1,
            changedBy: actor.userId,
          },
        });
        await this.audit.record(
          {
            action: 'admin.configuration.updated',
            resourceType: 'configuration',
            resourceId: null,
            result: 'SUCCESS',
            metadata: { key, oldValue, newValue: parsed.data, reason: input.reason },
          },
          tx,
        );
      });
    } catch (e) {
      // Deux premières modifications simultanées d'une même clé
      if (isUniqueViolation(e))
        throw new DomainError('VERSION_CONFLICT', 'Paramètre modifié entre-temps');
      throw e;
    }
    this.invalidate(key);
    return (await this.list()).find((c) => c.key === key);
  }

  async history(key: string) {
    if (!isConfigurationKey(key)) throw new DomainError('NOT_FOUND', 'Paramètre inconnu');
    const rows = await this.prisma.configurationHistory.findMany({
      where: { key },
      orderBy: { version: 'desc' },
      take: 100,
    });
    return rows.map((r) => ({
      id: r.id,
      version: r.version,
      oldValue: r.oldValue,
      newValue: r.newValue,
      reason: r.reason,
      changedBy: r.changedBy,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
