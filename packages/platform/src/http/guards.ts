import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type Permission, can } from '@tontine/auth';
import { type PlatformRole } from '@tontine/contracts';
import { type Request } from 'express';
import { type Actor, RequestContext } from '../context/request-context';
import { ACCESS_TOKEN_VERIFIER } from '../context/tokens';
import { DomainError } from '../errors/domain-error';
import { AccessDeniedMonitor } from './access-denied.monitor';
import { IS_PUBLIC, PERMISSION, ROLES } from './decorators';

/** Vérifie l'access token (implémenté par le domaine Auth). */
export interface AccessTokenVerifier {
  verify(token: string): Promise<Actor>;
}

/** Garde globale d'authentification : toute route est protégée sauf `@Public()`. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(ACCESS_TOKEN_VERIFIER) private readonly verifier: AccessTokenVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()]);
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.header('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : null;
    if (!token) {
      if (isPublic) return true;
      throw new DomainError('UNAUTHENTICATED');
    }
    try {
      const actor = await this.verifier.verify(token);
      RequestContext.setActor(actor);
      return true;
    } catch (e) {
      if (isPublic) return true;
      throw e;
    }
  }
}

/** Garde globale de rôle / permission, avec journalisation des refus. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly monitor: AccessDeniedMonitor,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    const roles = this.reflector.getAllAndOverride<PlatformRole[] | undefined>(ROLES, targets);
    const permission = this.reflector.getAllAndOverride<Permission | undefined>(PERMISSION, targets);
    if (!roles && !permission) return true;
    const actor = RequestContext.actor;
    if (!actor) throw new DomainError('UNAUTHENTICATED');
    const allowed = (!roles || roles.includes(actor.role)) && (!permission || can(actor.role, permission));
    if (!allowed) {
      const req = context.switchToHttp().getRequest<Request>();
      await this.monitor.record('route', `${req.method} ${req.route?.path ?? req.path}`, 'role');
      throw new DomainError('FORBIDDEN');
    }
    return true;
  }
}
