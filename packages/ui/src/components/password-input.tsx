'use client';

import { Eye, EyeOff } from 'lucide-react';
import * as React from 'react';
import { cn } from '../lib/cn';
import { Input, type InputProps } from './input';

export interface PasswordInputProps extends Omit<InputProps, 'type'> {
  /** Libellés du bouton (traductions) ; français par défaut. */
  showLabel?: string;
  hideLabel?: string;
}

/** Champ mot de passe avec bouton « afficher / masquer » accessible. */
export const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  (
    {
      className,
      showLabel = 'Afficher le mot de passe',
      hideLabel = 'Masquer le mot de passe',
      ...props
    },
    ref,
  ) => {
    const [visible, setVisible] = React.useState(false);
    return (
      <div className="relative">
        <Input
          ref={ref}
          type={visible ? 'text' : 'password'}
          className={cn('pr-11', className)}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? hideLabel : showLabel}
          aria-pressed={visible}
          className="absolute inset-y-0 right-0 grid w-10 place-items-center rounded-r-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {visible ? (
            <EyeOff className="size-4" aria-hidden="true" />
          ) : (
            <Eye className="size-4" aria-hidden="true" />
          )}
        </button>
      </div>
    );
  },
);
PasswordInput.displayName = 'PasswordInput';
