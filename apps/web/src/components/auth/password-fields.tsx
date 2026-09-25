'use client';

import { PASSWORD_MIN_LENGTH, checkPasswordPolicy, passwordSchema } from '@tontine/contracts';
import { FormField, Input } from '@tontine/ui';
import { Check, X } from 'lucide-react';
import type { UseFormRegisterReturn } from 'react-hook-form';
import { z } from 'zod';

/** Champs « nouveau mot de passe » + confirmation (politique de `@tontine/contracts`). */
export const newPasswordFields = { password: passwordSchema, confirm: z.string() };

export function refinePasswordConfirmation(
  v: { password: string; confirm: string },
  ctx: z.RefinementCtx,
): void {
  if (v.password !== v.confirm) {
    ctx.addIssue({
      code: 'custom',
      path: ['confirm'],
      message: 'Les mots de passe ne correspondent pas',
    });
  }
}

const RULES = [
  {
    key: `au moins ${PASSWORD_MIN_LENGTH} caractères`,
    text: `${PASSWORD_MIN_LENGTH} caractères minimum`,
  },
  { key: 'une minuscule', text: 'Une minuscule' },
  { key: 'une majuscule', text: 'Une majuscule' },
  { key: 'un chiffre', text: 'Un chiffre' },
  { key: 'un caractère spécial', text: 'Un caractère spécial' },
  { key: 'ne pas être un mot de passe courant', text: 'Pas un mot de passe courant' },
];

export function PasswordFields({
  passwordProps,
  confirmProps,
  passwordError,
  confirmError,
  value,
  label = 'Nouveau mot de passe',
}: {
  passwordProps: UseFormRegisterReturn;
  confirmProps: UseFormRegisterReturn;
  passwordError?: string | undefined;
  confirmError?: string | undefined;
  value: string;
  label?: string;
}) {
  const failures = new Set(checkPasswordPolicy(value).failures);
  return (
    <div className="space-y-4">
      <FormField
        id="new-password"
        label={label}
        error={
          passwordError ? 'Le mot de passe ne respecte pas les critères ci-dessous' : undefined
        }
        required
      >
        <Input {...passwordProps} type="password" autoComplete="new-password" />
      </FormField>
      <ul
        className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-2"
        aria-label="Critères du mot de passe"
      >
        {RULES.map((r) => {
          const ok = value.length > 0 && !failures.has(r.key);
          return (
            <li
              key={r.key}
              className={
                ok
                  ? 'flex items-center gap-1 text-success'
                  : 'flex items-center gap-1 text-muted-foreground'
              }
            >
              {ok ? (
                <Check className="size-3.5" aria-hidden="true" />
              ) : (
                <X className="size-3.5" aria-hidden="true" />
              )}
              <span>
                {r.text}
                <span className="sr-only">{ok ? ' : respecté' : ' : non respecté'}</span>
              </span>
            </li>
          );
        })}
      </ul>
      <FormField
        id="confirm-password"
        label="Confirmer le mot de passe"
        error={confirmError}
        required
      >
        <Input {...confirmProps} type="password" autoComplete="new-password" />
      </FormField>
    </div>
  );
}
