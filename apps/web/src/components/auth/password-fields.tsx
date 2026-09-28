'use client';

import { PASSWORD_MIN_LENGTH, checkPasswordPolicy, passwordSchema } from '@tontine/contracts';
import { FormField, PasswordInput } from '@tontine/ui';
import { Check, X } from 'lucide-react';
import type { UseFormRegisterReturn } from 'react-hook-form';
import { z } from 'zod';
import { type MessageKey, useI18n } from '@/lib/i18n';

/** Champs « nouveau mot de passe » + confirmation (politique de `@tontine/contracts`). */
export const newPasswordFields = { password: passwordSchema, confirm: z.string() };

/** Marqueur d'erreur traduit à l'affichage (les schémas restent indépendants de la langue). */
export const PASSWORD_MISMATCH = 'auth.password.mismatch';

export function refinePasswordConfirmation(
  v: { password: string; confirm: string },
  ctx: z.RefinementCtx,
): void {
  if (v.password !== v.confirm) {
    ctx.addIssue({ code: 'custom', path: ['confirm'], message: PASSWORD_MISMATCH });
  }
}

/** Critère de la politique (libellé d'échec de `checkPasswordPolicy`) → libellé affiché. */
const RULES: Array<{ failure: string; label: MessageKey }> = [
  { failure: `au moins ${PASSWORD_MIN_LENGTH} caractères`, label: 'auth.password.rules.length' },
  { failure: 'une minuscule', label: 'auth.password.rules.lower' },
  { failure: 'une majuscule', label: 'auth.password.rules.upper' },
  { failure: 'un chiffre', label: 'auth.password.rules.digit' },
  { failure: 'un caractère spécial', label: 'auth.password.rules.special' },
  { failure: 'ne pas être un mot de passe courant', label: 'auth.password.rules.common' },
];

export function PasswordFields({
  passwordProps,
  confirmProps,
  passwordError,
  confirmError,
  value,
  label,
}: {
  passwordProps: UseFormRegisterReturn;
  confirmProps: UseFormRegisterReturn;
  passwordError?: string | undefined;
  confirmError?: string | undefined;
  value: string;
  label?: string;
}) {
  const { t } = useI18n();
  const failures = new Set(checkPasswordPolicy(value).failures);
  const met = RULES.filter((r) => value.length > 0 && !failures.has(r.failure)).length;
  const toggle = { showLabel: t('auth.password.show'), hideLabel: t('auth.password.hide') };
  return (
    <div className="space-y-4">
      <FormField
        id="new-password"
        label={label ?? t('auth.password.label')}
        error={passwordError ? t('auth.password.notPolicy') : undefined}
        required
      >
        <PasswordInput {...passwordProps} {...toggle} autoComplete="new-password" />
      </FormField>
      <div className="space-y-2">
        <div aria-hidden="true" className="grid grid-cols-6 gap-1">
          {RULES.map((r, i) => (
            <span
              key={r.failure}
              className={i < met ? 'h-1 rounded-sm bg-progress' : 'h-1 rounded-sm bg-muted'}
            />
          ))}
        </div>
        <ul
          className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-2"
          aria-label={t('auth.password.rulesLabel')}
        >
          {RULES.map((r) => {
            const ok = value.length > 0 && !failures.has(r.failure);
            return (
              <li
                key={r.failure}
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
                  {t(r.label, { min: PASSWORD_MIN_LENGTH })}
                  <span className="sr-only">
                    {' : '}
                    {ok ? t('auth.password.met') : t('auth.password.unmet')}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>
      <FormField
        id="confirm-password"
        label={t('auth.password.confirm')}
        error={confirmError === PASSWORD_MISMATCH ? t('auth.password.mismatch') : confirmError}
        required
      >
        <PasswordInput {...confirmProps} {...toggle} autoComplete="new-password" />
      </FormField>
    </div>
  );
}
