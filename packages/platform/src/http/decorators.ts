import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { type Permission } from '@tontine/auth';
import { type PlatformRole } from '@tontine/contracts';
import { type Actor, RequestContext } from '../context/request-context';
import { DomainError } from '../errors/domain-error';

export const IS_PUBLIC = 'tontine:is-public';
export const ROLES = 'tontine:roles';
export const PERMISSION = 'tontine:permission';

/** Route accessible sans authentification. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);

/** Restreint la route à certains rôles plateforme. */
export const Roles = (...roles: PlatformRole[]): MethodDecorator & ClassDecorator => SetMetadata(ROLES, roles);

/** Restreint la route à une permission RBAC (packages/auth/src/rbac.ts). */
export const RequirePermission = (permission: Permission): MethodDecorator & ClassDecorator =>
  SetMetadata(PERMISSION, permission);

/** Injecte l'acteur authentifié. */
export const CurrentUser = createParamDecorator((_data: unknown, _ctx: ExecutionContext): Actor => {
  const actor = RequestContext.actor;
  if (!actor) throw new DomainError('UNAUTHENTICATED');
  return actor;
});
