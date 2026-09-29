import { Global, Module } from '@nestjs/common';
import { NotificationsModule, ROLE_DIRECTORY } from '@tontine/notifications';
import {
  ACCESS_TOKEN_VERIFIER,
  ACCOUNT_DIRECTORY,
  ADMIN_DELEGATION,
  STEP_UP,
} from '@tontine/platform';
import { AdminUsersController, JwksController } from './admin.controller';
import { AuthConsumers } from './auth.consumers';
import { AuthController } from './auth.controller';
import { AdminDelegationService } from './delegation';
import { CaptchaVerifier, SimulatedCaptchaVerifier } from './captcha';
import { jwtKeyStoreProvider } from './keys.provider';
import { LoginService } from './login.service';
import { MfaService } from './mfa.service';
import { RegistrationService } from './registration.service';
import { UserRoleDirectory } from './role-directory';
import { StepUpService } from './step-up.service';
import { TokenService } from './token.service';

/** Domaine Authentification & accès (épique 1). Fournit globalement le vérificateur de jetons. */
@Global()
@Module({
  imports: [NotificationsModule],
  controllers: [AuthController, AdminUsersController, JwksController],
  providers: [
    jwtKeyStoreProvider,
    TokenService,
    RegistrationService,
    LoginService,
    MfaService,
    AuthConsumers,
    UserRoleDirectory,
    AdminDelegationService,
    StepUpService,
    { provide: STEP_UP, useExisting: StepUpService },
    { provide: ADMIN_DELEGATION, useExisting: AdminDelegationService },
    { provide: CaptchaVerifier, useClass: SimulatedCaptchaVerifier },
    { provide: ACCESS_TOKEN_VERIFIER, useExisting: TokenService },
    { provide: ROLE_DIRECTORY, useExisting: UserRoleDirectory },
    { provide: ACCOUNT_DIRECTORY, useExisting: UserRoleDirectory },
  ],
  exports: [
    ACCESS_TOKEN_VERIFIER,
    ADMIN_DELEGATION,
    ACCOUNT_DIRECTORY,
    ROLE_DIRECTORY,
    STEP_UP,
    TokenService,
    RegistrationService,
    LoginService,
  ],
})
export class AuthModule {}
