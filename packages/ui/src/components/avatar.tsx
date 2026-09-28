import * as React from 'react';
import { cn } from '../lib/cn';

/** Fonds de la palette fonctionnelle, texte foncé associé (≥ 4,5:1). */
const TONES = [
  'bg-info-soft text-info',
  'bg-success-soft text-success',
  'bg-warning-soft text-warning',
  'bg-destructive-soft text-destructive',
  'bg-secondary text-secondary-foreground',
  'bg-muted text-muted-foreground',
] as const;

const SIZES = { lg: 'size-11 text-sm', md: 'size-9 text-xs', sm: 'size-7 text-[11px]' } as const;

/** Deux initiales (prénom + nom), sans majuscules forcées au-delà des initiales. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '?';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : (parts[0]?.[1] ?? '');
  return `${first}${last}`.toLocaleUpperCase('fr');
}

/** Couleur stable dérivée de l'identifiant : un membre garde toujours la même teinte. */
export function avatarTone(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return TONES[h % TONES.length]!;
}

export interface AvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  name: string;
  /** Identifiant stable (id du membre) ; le nom sinon. */
  seed?: string;
  /** Tailles de la charte §08 : 44 px (détail), 36 px (liste), 28 px (puce). */
  size?: keyof typeof SIZES;
  src?: string | null;
}

/** Avatar membre (charte §08) : initiales sur fond coloré, ou photo. */
export function Avatar({ name, seed, size = 'md', src, className, ...props }: AvatarProps) {
  return (
    <span
      className={cn(
        'inline-grid shrink-0 place-items-center overflow-hidden rounded-full font-medium',
        SIZES[size],
        src ? 'bg-muted' : avatarTone(seed ?? name),
        className,
      )}
      {...props}
    >
      {src ? (
        <img src={src} alt={name} className="size-full object-cover" />
      ) : (
        <>
          <span aria-hidden="true">{initialsOf(name)}</span>
          <span className="sr-only">{name}</span>
        </>
      )}
    </span>
  );
}
