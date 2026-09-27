import { type RouteDefinition } from './config';

export interface ResolvedRoute {
  upstream: string;
  /** Libellé borné pour les métriques et les journaux (jamais le chemin complet). */
  label: string;
}

/**
 * Table de routage : préfixes des services extraits (le plus long l'emporte), sinon le service
 * par défaut. Seuls `/api/v1/*` (et Swagger si autorisé) sont exposés.
 */
export class RouteTable {
  private readonly routes: Array<RouteDefinition & { pattern: RegExp }>;

  constructor(
    routes: RouteDefinition[],
    private readonly defaultUpstream: string,
    private readonly exposeDocs: boolean,
    private readonly blocked: readonly string[] = [],
  ) {
    this.routes = [...routes]
      .sort((a, b) => b.prefix.length - a.prefix.length)
      .map((r) => ({
        ...r,
        // `*` : exactement un segment non vide ; le reste du préfixe est littéral
        pattern: new RegExp(
          `^${r.prefix
            .split('*')
            .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('[^/]+')}`,
        ),
      }));
  }

  resolve(path: string): ResolvedRoute | null {
    if (this.exposeDocs && (path === '/api/docs' || path.startsWith('/api/docs')))
      return { upstream: this.defaultUpstream, label: 'docs' };
    if (!path.startsWith('/api/v1/')) return null;
    // Chemins normalisés uniquement : pas de traversée ni d'encodage de séparateur
    if (/(^|\/)\.\.?(\/|$)|%2e|%2f|%5c|\\/i.test(path)) return null;
    if (this.blocked.some((b) => path.startsWith(b))) return null;
    const hit = this.routes.find((r) => r.pattern.test(path));
    const segment = path.split('/')[3] ?? '';
    return {
      upstream: hit?.upstream ?? this.defaultUpstream,
      label: /^[a-z][a-z0-9-]{0,30}$/.test(segment) ? segment : 'other',
    };
  }

  upstreams(): string[] {
    return [...new Set([this.defaultUpstream, ...this.routes.map((r) => r.upstream)])];
  }
}

/**
 * Adresse du client : avec `hops` proxys de confiance devant le gateway, l'adresse retenue est
 * celle vue par le proxy le plus proche du client ; les entrées plus à gauche (fournies par le
 * client) sont ignorées. `hops = 0` : adresse de la socket uniquement.
 */
export function clientIp(
  socketAddress: string | undefined,
  forwardedFor: string | string[] | undefined,
  hops: number,
): string {
  const socket = (socketAddress ?? 'unknown').replace(/^::ffff:/, '');
  if (hops === 0 || !forwardedFor) return socket;
  const chain = (Array.isArray(forwardedFor) ? forwardedFor.join(',') : forwardedFor)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const candidate = chain[chain.length - hops];
  return candidate ? candidate.replace(/^::ffff:/, '') : socket;
}
