'use client';

import * as React from 'react';
import { cn } from '../lib/cn';

export interface OtpInputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'maxLength'
> {
  value: string;
  onValueChange: (value: string) => void;
  /** Nombre de chiffres (6 par défaut). */
  length?: number;
  /** Appelé quand tous les chiffres sont saisis (soumission automatique possible). */
  onComplete?: (value: string) => void;
}

/**
 * Saisie d'un code à usage unique : un SEUL champ réel (collage, remplissage automatique du
 * code SMS `one-time-code`, lecteurs d'écran, clavier numérique mobile) sous des cases
 * visuelles. Libellé, aide et erreur passent par `FormField` comme pour un champ ordinaire.
 */
export const OtpInput = React.forwardRef<HTMLInputElement, OtpInputProps>(
  (
    {
      value,
      onValueChange,
      onComplete,
      length = 6,
      className,
      disabled,
      onFocus,
      onBlur,
      ...props
    },
    ref,
  ) => {
    const [focused, setFocused] = React.useState(false);
    const invalid = props['aria-invalid'] === true || props['aria-invalid'] === 'true';
    return (
      <div className={cn('relative w-full max-w-xs', className)}>
        <div
          aria-hidden="true"
          className="grid gap-2"
          style={{ gridTemplateColumns: `repeat(${length}, minmax(0, 1fr))` }}
        >
          {Array.from({ length }, (_, i) => {
            const active = focused && i === Math.min(value.length, length - 1);
            return (
              <div
                key={i}
                className={cn(
                  'grid h-12 place-items-center rounded-md border bg-card text-h3 font-medium tabular-nums transition-colors',
                  invalid ? 'border-destructive' : 'border-input',
                  active && 'ring-2 ring-ring',
                  disabled && 'opacity-60',
                )}
              >
                {value[i] ?? ''}
              </div>
            );
          })}
        </div>
        <input
          ref={ref}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          value={value}
          disabled={disabled}
          onChange={(e) => {
            const next = e.target.value.replace(/\D/g, '').slice(0, length);
            onValueChange(next);
            if (next.length === length) onComplete?.(next);
          }}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          className="absolute inset-0 h-full w-full cursor-text rounded-md bg-transparent text-transparent caret-transparent outline-none selection:bg-transparent"
          {...props}
        />
      </div>
    );
  },
);
OtpInput.displayName = 'OtpInput';
