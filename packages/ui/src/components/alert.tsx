import { type VariantProps, cva } from 'class-variance-authority';
import { AlertCircle, CheckCircle2, Info, TriangleAlert } from 'lucide-react';
import * as React from 'react';
import { cn } from '../lib/cn';

export const alertVariants = cva(
  'relative flex w-full gap-3 rounded-md border p-4 text-sm [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-card text-card-foreground',
        info: 'border-info/30 bg-info-soft text-foreground [&>svg]:text-info',
        success: 'border-success/30 bg-success-soft text-foreground [&>svg]:text-success',
        warning: 'border-warning/30 bg-warning-soft text-foreground [&>svg]:text-warning',
        destructive:
          'border-destructive/30 bg-destructive-soft text-foreground [&>svg]:text-destructive',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

const ICONS = {
  default: Info,
  info: Info,
  success: CheckCircle2,
  warning: TriangleAlert,
  destructive: AlertCircle,
} as const;

export interface AlertProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'>, VariantProps<typeof alertVariants> {
  title?: React.ReactNode;
  /** Masque l'icône par défaut. */
  hideIcon?: boolean;
}

/**
 * Message contextuel. Les variantes `destructive` et `warning` sont annoncées immédiatement
 * par les lecteurs d'écran (`role="alert"`), les autres poliment (`role="status"`).
 */
export const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant, title, hideIcon, children, role, ...props }, ref) => {
    const Icon = ICONS[variant ?? 'default'];
    const computedRole =
      role ?? (variant === 'destructive' || variant === 'warning' ? 'alert' : 'status');
    return (
      <div
        ref={ref}
        role={computedRole}
        className={cn(alertVariants({ variant }), className)}
        {...props}
      >
        {hideIcon ? null : <Icon aria-hidden="true" />}
        <div className="flex-1 space-y-1">
          {title ? <p className="font-medium leading-tight">{title}</p> : null}
          {children ? <div className="text-sm leading-relaxed">{children}</div> : null}
        </div>
      </div>
    );
  },
);
Alert.displayName = 'Alert';
