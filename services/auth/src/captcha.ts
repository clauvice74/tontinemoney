import { Injectable } from '@nestjs/common';

/** Vérification anti-bot (A-19). Adaptateur simulé : tout jeton est accepté sauf « fail ». */
export abstract class CaptchaVerifier {
  abstract verify(token: string, ip: string | null): Promise<boolean>;
}

@Injectable()
export class SimulatedCaptchaVerifier extends CaptchaVerifier {
  async verify(token: string): Promise<boolean> {
    return token.trim().length > 0 && token !== 'fail';
  }
}
