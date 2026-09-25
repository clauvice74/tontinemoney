import * as React from 'react';
import { cn } from '../lib/cn';
import { Label } from './label';

export interface FormFieldProps {
  /** Identifiant du contrôle ; sert à relier libellé, aide et message d'erreur. */
  id: string;
  label: React.ReactNode;
  /** Texte d'aide affiché sous le champ. */
  description?: React.ReactNode;
  /** Message d'erreur (validation client ou Problem Details). */
  error?: string | undefined;
  required?: boolean;
  className?: string;
  /**
   * Le contrôle. Il reçoit automatiquement `id`, `aria-invalid`, `aria-describedby`
   * et `aria-required` s'il s'agit d'un unique élément React.
   */
  children: React.ReactElement<Record<string, unknown>>;
}

/** Aide de formulaire : libellé + contrôle + aide + erreur, reliés pour l'accessibilité. */
export function FormField({
  id,
  label,
  description,
  error,
  required,
  className,
  children,
}: FormFieldProps) {
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined;
  const control = React.cloneElement(children, {
    id,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy,
    'aria-required': required || undefined,
  });
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={id}>
        {label}
        {required ? (
          <span className="ml-0.5 text-destructive" aria-hidden="true">
            *
          </span>
        ) : null}
      </Label>
      {control}
      {description ? (
        <p id={descriptionId} className="text-xs text-muted-foreground">
          {description}
        </p>
      ) : null}
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </div>
  );
}

export function FieldError({
  id,
  children,
  className,
}: {
  id?: string | undefined;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p id={id} role="alert" className={cn('text-xs font-medium text-destructive', className)}>
      {children}
    </p>
  );
}

/** Groupe de champs (cases à cocher, boutons radio) avec légende accessible. */
export function Fieldset({
  legend,
  description,
  error,
  className,
  children,
}: {
  legend: React.ReactNode;
  description?: React.ReactNode;
  error?: string | undefined;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className={cn('space-y-2', className)}>
      <legend className="text-sm font-medium">{legend}</legend>
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      {children}
      {error ? <FieldError>{error}</FieldError> : null}
    </fieldset>
  );
}
