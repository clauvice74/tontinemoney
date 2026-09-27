/** Types du script de rôles PostgreSQL par service (service-roles.mjs). */
export interface Ownership {
  schemas: string[];
  tables: Map<string, string>;
  models: Map<string, string>;
  allowlist: Array<{
    service: string;
    schema: string;
    object: string;
    access: 'read' | 'write' | 'sql';
    reason: string;
    removal: string;
  }>;
}
export function ownership(): Ownership;
export function roleOf(schemaName: string): string;
/** SQL idempotent de création des rôles `tm_<schéma>` et de leurs droits. */
export function serviceRolesSql(): string;
