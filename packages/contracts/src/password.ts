import { z } from 'zod';

/** Liste minimale de mots de passe courants refusés (complétée par les règles de complexité). */
const COMMON_PASSWORDS = new Set([
  '123456',
  '12345678',
  '123456789',
  'password',
  'password1',
  'motdepasse',
  'azerty',
  'azertyuiop',
  'qwerty',
  'qwertyuiop',
  'tontine',
  'tontinemoney',
  'admin123',
  'welcome1',
  'bienvenue',
  'iloveyou',
  'letmein',
]);

export const PASSWORD_MIN_LENGTH = 12;

export interface PasswordCheck {
  ok: boolean;
  failures: string[];
}

/** Politique : ≥ 12 caractères, minuscule, majuscule, chiffre, symbole, pas un mot de passe courant. */
export function checkPasswordPolicy(password: string): PasswordCheck {
  const failures: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) failures.push(`au moins ${PASSWORD_MIN_LENGTH} caractères`);
  if (password.length > 128) failures.push('au plus 128 caractères');
  if (!/[a-z]/.test(password)) failures.push('une minuscule');
  if (!/[A-Z]/.test(password)) failures.push('une majuscule');
  if (!/\d/.test(password)) failures.push('un chiffre');
  if (!/[^A-Za-z0-9]/.test(password)) failures.push('un caractère spécial');
  const lowered = password.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (COMMON_PASSWORDS.has(password.toLowerCase()) || COMMON_PASSWORDS.has(lowered)) {
    failures.push('ne pas être un mot de passe courant');
  }
  return { ok: failures.length === 0, failures };
}

export const passwordSchema = z.string().superRefine((value, ctx) => {
  const res = checkPasswordPolicy(value);
  if (!res.ok) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Le mot de passe ne respecte pas les critères : ${res.failures.join(', ')}`,
    });
  }
});
