import * as ToastPrimitive from '@radix-ui/react-toast';
import { type VariantProps, cva } from 'class-variance-authority';
import { X } from 'lucide-react';
import * as React from 'react';
import { cn } from '../lib/cn';

const toastVariants = cva(
  'pointer-events-auto relative flex w-full items-start justify-between gap-3 overflow-hidden rounded-lg border p-4 pr-8 shadow-lg data-[state=closed]:opacity-0 data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] transition-opacity',
  {
    variants: {
      variant: {
        default: 'bg-card text-card-foreground',
        success: 'border-success/50 bg-card text-card-foreground border-l-4 border-l-success',
        destructive:
          'border-destructive/50 bg-card text-card-foreground border-l-4 border-l-destructive',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export type ToastVariant = NonNullable<VariantProps<typeof toastVariants>['variant']>;

export interface ToastMessage {
  id: string;
  title: string;
  description?: string | undefined;
  variant?: ToastVariant;
  /** Durée d'affichage en ms (défaut 5 s, 8 s pour les erreurs). */
  duration?: number;
}

type Listener = (toasts: ToastMessage[]) => void;

let counter = 0;
let current: ToastMessage[] = [];
const listeners = new Set<Listener>();
const MAX_TOASTS = 4;

function emit(): void {
  for (const l of listeners) l(current);
}

/** Affiche une notification éphémère (toast). Utilisable hors composant React. */
export function toast(message: Omit<ToastMessage, 'id'>): string {
  counter += 1;
  const id = `toast-${counter}`;
  current = [...current, { ...message, id }].slice(-MAX_TOASTS);
  emit();
  return id;
}

toast.success = (title: string, description?: string) =>
  toast({ title, description, variant: 'success' });
toast.error = (title: string, description?: string) =>
  toast({ title, description, variant: 'destructive' });

export function dismissToast(id: string): void {
  current = current.filter((t) => t.id !== id);
  emit();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useToasts(): ToastMessage[] {
  return React.useSyncExternalStore(
    (cb) => subscribe(() => cb()),
    () => current,
    () => current,
  );
}

/** Zone d'affichage des toasts ; à monter une fois à la racine de l'application. */
export function Toaster() {
  const toasts = useToasts();
  return (
    <ToastPrimitive.Provider swipeDirection="right" label="Notification">
      {toasts.map((t) => (
        <ToastPrimitive.Root
          key={t.id}
          duration={t.duration ?? (t.variant === 'destructive' ? 8000 : 5000)}
          type={t.variant === 'destructive' ? 'foreground' : 'background'}
          className={toastVariants({ variant: t.variant })}
          onOpenChange={(open) => {
            if (!open) dismissToast(t.id);
          }}
        >
          <div className="grid gap-1">
            <ToastPrimitive.Title className="text-sm font-semibold">{t.title}</ToastPrimitive.Title>
            {t.description ? (
              <ToastPrimitive.Description className="text-sm text-muted-foreground">
                {t.description}
              </ToastPrimitive.Description>
            ) : null}
          </div>
          <ToastPrimitive.Close
            className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Fermer la notification"
          >
            <X className="size-4" aria-hidden="true" />
          </ToastPrimitive.Close>
        </ToastPrimitive.Root>
      ))}
      <ToastPrimitive.Viewport
        className={cn(
          'fixed bottom-0 right-0 z-[100] flex max-h-screen w-full flex-col gap-2 p-4 sm:max-w-sm',
        )}
      />
    </ToastPrimitive.Provider>
  );
}
