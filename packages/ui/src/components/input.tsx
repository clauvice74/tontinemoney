import * as React from 'react';
import { cn } from '../lib/cn';

const fieldBase =
  'flex w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:ring-destructive';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', ...props }, ref) => (
    <input
      type={type}
      className={cn(
        fieldBase,
        'h-10 file:border-0 file:bg-transparent file:text-sm file:font-medium',
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, rows = 3, ...props }, ref) => (
    <textarea rows={rows} className={cn(fieldBase, 'min-h-20', className)} ref={ref} {...props} />
  ),
);
Textarea.displayName = 'Textarea';

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

/**
 * Liste déroulante native stylée : accessibilité clavier/lecteur d'écran et saisie mobile
 * natives, compatible directement avec `register()` de React Hook Form.
 */
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, ...props }, ref) => (
    <select className={cn(fieldBase, 'h-10 pr-8', className)} ref={ref} {...props}>
      {children}
    </select>
  ),
);
Select.displayName = 'Select';

export type CheckboxProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>;

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, ...props }, ref) => (
    <input
      type="checkbox"
      className={cn(
        'size-4 shrink-0 rounded border border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60',
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
Checkbox.displayName = 'Checkbox';
