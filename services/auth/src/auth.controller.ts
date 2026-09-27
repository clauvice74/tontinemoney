import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { type AppConfig } from '@tontine/config';
import {
  type ActivateAccountInput,
  type LoginInput,
  type LoginMfaInput,
  type RequestAccountInput,
  type ResetPasswordInput,
  activateAccountSchema,
  forgotPasswordSchema,
  loginMfaSchema,
  loginSchema,
  mfaDisableSchema,
  mfaEnableSchema,
  mfaVerifySchema,
  requestAccountSchema,
  resendOtpSchema,
  resetPasswordSchema,
} from '@tontine/contracts';
import {
  APP_CONFIG,
  type Actor,
  ApiZodBody,
  Clock,
  CurrentUser,
  DomainError,
  PrismaService,
  Public,
  ZodBody,
  ZodValidationPipe,
} from '@tontine/platform';
import { type Request, type Response } from 'express';
import { z } from 'zod';
import { LoginService } from './login.service';
import { MfaService } from './mfa.service';
import { RegistrationService } from './registration.service';
import { type IssuedTokens, TokenService } from './token.service';

export const REFRESH_COOKIE = 'tm_rt';
const COOKIE_PATH = '/api/v1/auth';
const optionalRefresh = z
  .object({ refreshToken: z.string().min(10).max(4096).optional() })
  .strict();
const codeSchema = z.object({ code: z.string().trim().min(6).max(12) });

@ApiTags('Authentification')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly registration: RegistrationService,
    private readonly login: LoginService,
    private readonly tokens: TokenService,
    private readonly mfa: MfaService,
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Refresh token uniquement en cookie HttpOnly Secure SameSite=Strict (US-1.4, A-24). */
  private setRefreshCookie(res: Response, t: IssuedTokens): void {
    res.cookie(REFRESH_COOKIE, t.refreshToken, {
      httpOnly: true,
      secure: this.config.COOKIE_SECURE,
      sameSite: 'strict',
      path: COOKIE_PATH,
      expires: t.refreshExpiresAt,
    });
  }

  private tokenBody(t: IssuedTokens, extra: Record<string, unknown> = {}) {
    return {
      accessToken: t.accessToken,
      expiresIn: t.expiresIn,
      tokenType: 'Bearer' as const,
      ...extra,
    };
  }

  @Post('login')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Connexion (US-1.4) — renvoie les jetons ou un défi MFA' })
  @ApiZodBody(loginSchema)
  async doLogin(@ZodBody(loginSchema) body: LoginInput, @Res({ passthrough: true }) res: Response) {
    const result = await this.login.login(body);
    if (result.kind === 'mfa') {
      return {
        mfaRequired: true,
        challengeToken: result.challengeToken,
        mfaType: result.mfaType,
        expiresIn: result.expiresIn,
      };
    }
    this.setRefreshCookie(res, result.tokens);
    return this.tokenBody(result.tokens, {
      user: {
        id: result.user.id,
        role: result.user.role,
        mfaSetupRequired: result.user.role === 'SUPER_ADMIN' && !result.user.mfaEnabled,
      },
    });
  }

  @Post(['login/mfa', 'verify-otp'])
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Second facteur (TOTP, SMS ou code de récupération)' })
  @ApiZodBody(loginMfaSchema)
  async loginMfa(
    @ZodBody(loginMfaSchema) body: LoginMfaInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.login.loginMfa(body);
    this.setRefreshCookie(res, r.tokens);
    return this.tokenBody(r.tokens, {
      user: { id: r.user.id, role: r.user.role },
      recoveryCodesExhausted: r.recoveryCodesExhausted,
    });
  }

  @Post('refresh')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Rotation du refresh token (cookie tm_rt) et nouvel access token' })
  async refresh(
    @Req() req: Request,
    @Body(new ZodValidationPipe(optionalRefresh)) body: z.infer<typeof optionalRefresh>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cookieToken = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    const token = cookieToken ?? body.refreshToken;
    if (!token) throw new DomainError('UNAUTHENTICATED', 'Refresh token manquant');
    const t = await this.tokens.refresh(token);
    this.setRefreshCookie(res, t);
    return this.tokenBody(t);
  }

  @Post('logout')
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Déconnexion : révocation du refresh token et blacklist de l’access token',
  })
  async logout(
    @CurrentUser() actor: Actor,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.tokens.logout(actor);
    res.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH });
  }

  @Get(['me', 'profile'])
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mon compte : rôle, statut, état d’accès, MFA' })
  async me(@CurrentUser() actor: Actor) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
    const member = await this.prisma.member.findUnique({
      where: { id: actor.userId },
      select: { status: true, kycLevel: true },
    });
    return {
      id: user.id,
      role: user.role,
      status: user.status,
      // A-01 : ACTIVE_PENDING_KYC est un état dérivé
      accessState:
        user.status === 'ACTIVE' && member?.status !== 'ACTIVE'
          ? 'ACTIVE_PENDING_KYC'
          : user.status,
      memberStatus: member?.status ?? null,
      kycLevel: member?.kycLevel ?? 'NONE',
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone,
      language: user.language,
      mfa: {
        enabled: user.mfaEnabled,
        type: user.mfaType,
        required: user.role === 'SUPER_ADMIN',
        usedThisSession: actor.mfa,
      },
      tontineIds: actor.tontineIds,
      delegatedTontine:
        user.delegatedTontineName && !user.delegatedTontineUsed ? user.delegatedTontineName : null,
    };
  }

  @Get('sessions')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mes sessions actives (5 maximum)' })
  async sessions(@CurrentUser() actor: Actor) {
    const rows = await this.prisma.refreshSession.findMany({
      where: {
        userId: actor.userId,
        revokedAt: null,
        rotatedAt: null,
        expiresAt: { gt: this.clock.now() },
      },
      orderBy: { createdAt: 'desc' },
    });
    return {
      data: rows.map((s) => ({
        id: s.id,
        userAgent: s.userAgent,
        createdAt: s.createdAt.toISOString(),
        lastUsedAt: s.lastUsedAt.toISOString(),
        current: s.familyId === rows.find((r) => r.id === actor.sessionId)?.familyId,
      })),
    };
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Révoquer une de mes sessions' })
  async revokeSession(
    @CurrentUser() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    const s = await this.prisma.refreshSession.findFirst({ where: { id, userId: actor.userId } });
    if (!s) throw new DomainError('NOT_FOUND');
    await this.prisma.refreshSession.updateMany({
      where: { familyId: s.familyId, revokedAt: null },
      data: { revokedAt: this.clock.now(), revokedReason: 'USER_REVOKED' },
    });
  }

  @Post(['request-account', 'register'])
  @Public()
  @HttpCode(202)
  @ApiOperation({
    summary: 'Demande de compte (US-1.3) — réponse générique, captcha, 5 / heure / IP',
  })
  @ApiZodBody(requestAccountSchema)
  async requestAccount(@ZodBody(requestAccountSchema) body: RequestAccountInput) {
    return this.registration.requestAccount(body);
  }

  @Post(['activate', 'verify-email'])
  @Public()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Activation du compte par lien (48 h) ou OTP (15 min) et choix du mot de passe',
  })
  @ApiZodBody(activateAccountSchema)
  async activate(@ZodBody(activateAccountSchema) body: ActivateAccountInput) {
    return this.registration.activate(body);
  }

  @Post('activation/resend')
  @Public()
  @HttpCode(202)
  @ApiOperation({ summary: 'Renvoi du code d’activation (3 / heure)' })
  @ApiZodBody(resendOtpSchema)
  async resend(@ZodBody(resendOtpSchema) body: { identifier: string }) {
    await this.registration.resendActivation(body.identifier);
    return { message: 'Si un compte en attente d’activation existe, un nouveau code a été envoyé' };
  }

  @Post('forgot-password')
  @Public()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Mot de passe oublié (US-1.5) — toujours 200, sans fuite d’information',
  })
  @ApiZodBody(forgotPasswordSchema)
  async forgot(@ZodBody(forgotPasswordSchema) body: { identifier: string }) {
    await this.login.forgotPassword(body.identifier);
    return { message: 'Si un compte existe, un lien vous a été envoyé' };
  }

  @Post('reset-password')
  @Public()
  @HttpCode(204)
  @ApiOperation({
    summary: 'Nouveau mot de passe (jeton 1 h, usage unique, différent des 5 derniers)',
  })
  @ApiZodBody(resetPasswordSchema)
  async reset(@ZodBody(resetPasswordSchema) body: ResetPasswordInput): Promise<void> {
    await this.login.resetPassword(body);
  }

  @Get('mfa')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'État de la double authentification' })
  async mfaStatus(@CurrentUser() actor: Actor) {
    return this.mfa.status(actor);
  }

  @Post(['mfa/enable', 'enable-mfa'])
  @ApiBearerAuth()
  @HttpCode(200)
  @ApiOperation({ summary: 'Activer le MFA (US-1.6) : TOTP → QR code ; SMS → code envoyé' })
  @ApiZodBody(mfaEnableSchema)
  async mfaEnable(
    @CurrentUser() actor: Actor,
    @ZodBody(mfaEnableSchema) body: { type: 'TOTP' | 'SMS' },
  ) {
    return this.mfa.enable(actor, body.type);
  }

  @Post('mfa/verify')
  @ApiBearerAuth()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Confirmer le MFA ; renvoie 10 codes de récupération (affichés une seule fois)',
  })
  @ApiZodBody(mfaVerifySchema)
  async mfaVerify(@CurrentUser() actor: Actor, @ZodBody(mfaVerifySchema) body: { code: string }) {
    return this.mfa.verify(actor, body.code);
  }

  @Post(['mfa/sms-code', 'send-otp'])
  @ApiBearerAuth()
  @HttpCode(202)
  @ApiOperation({ summary: 'Recevoir un code SMS (MFA SMS actif)' })
  async mfaSmsCode(@CurrentUser() actor: Actor) {
    await this.mfa.sendSmsCode(actor);
    return { sent: true };
  }

  @Post(['mfa/disable', 'disable-mfa'])
  @ApiBearerAuth()
  @HttpCode(204)
  @ApiOperation({ summary: 'Désactiver le MFA : mot de passe + code valide (alerte envoyée)' })
  @ApiZodBody(mfaDisableSchema)
  async mfaDisable(
    @CurrentUser() actor: Actor,
    @ZodBody(mfaDisableSchema) body: { password: string; code: string },
  ): Promise<void> {
    await this.mfa.disable(actor, body.password, body.code);
  }

  @Post('mfa/recovery-codes')
  @ApiBearerAuth()
  @HttpCode(200)
  @ApiOperation({ summary: 'Régénérer les codes de récupération' })
  @ApiZodBody(codeSchema)
  async regenerate(@CurrentUser() actor: Actor, @ZodBody(codeSchema) body: { code: string }) {
    return this.mfa.regenerateRecoveryCodes(actor, body.code);
  }
}
