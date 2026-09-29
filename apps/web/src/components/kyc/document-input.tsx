'use client';

import { ACCEPTED_IMAGE_MIME } from '@tontine/contracts';
import { Button, FieldError, cn } from '@tontine/ui';
import { Camera, ImageUp, Trash2 } from 'lucide-react';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { formatBytes } from '@/lib/format';
import { type MessageKey, useI18n } from '@/lib/i18n';

export interface ImageConstraints {
  maxFileBytes: number;
  minWidth: number;
  minHeight: number;
}

/** Dimensions d'une image locale (sans l'envoyer). */
export function readImageSize(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('unreadable'));
    };
    img.src = url;
  });
}

export type ImageIssue =
  | { key: 'kyc.errors.format' }
  | { key: 'kyc.errors.size'; vars: { size: string; max: string } }
  | {
      key: 'kyc.errors.resolution';
      vars: { width: number; height: number; minWidth: number; minHeight: number };
    }
  | { key: 'kyc.errors.unreadable' };

/** Contrôles côté client (JPEG/PNG, taille, résolution minimale) — revérifiés par l'API. */
export async function validateDocumentImage(
  file: File,
  c: ImageConstraints,
): Promise<ImageIssue | null> {
  if (!(ACCEPTED_IMAGE_MIME as readonly string[]).includes(file.type)) {
    return { key: 'kyc.errors.format' };
  }
  if (file.size > c.maxFileBytes) {
    return {
      key: 'kyc.errors.size',
      vars: { size: formatBytes(file.size), max: formatBytes(c.maxFileBytes) },
    };
  }
  try {
    const { width, height } = await readImageSize(file);
    const ok =
      (width >= c.minWidth && height >= c.minHeight) ||
      (height >= c.minWidth && width >= c.minHeight);
    if (!ok) {
      return {
        key: 'kyc.errors.resolution',
        vars: { width, height, minWidth: c.minWidth, minHeight: c.minHeight },
      };
    }
  } catch {
    return { key: 'kyc.errors.unreadable' };
  }
  return null;
}

/**
 * Photo d'une pièce (recto, verso, justificatif) : prise avec l'appareil photo arrière ou choisie
 * dans la galerie, contrôlée localement puis prévisualisée. Deux champs fichiers masqués, pilotés
 * par des boutons explicites (le groupe porte le libellé).
 */
export function DocumentInput({
  id,
  label,
  constraints,
  required,
  onChange,
  error: externalError,
}: {
  id: string;
  label: string;
  constraints: ImageConstraints;
  required?: boolean;
  onChange: (file: File | null) => void;
  error?: string | undefined;
}) {
  const { t } = useI18n();
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [issue, setIssue] = useState<ImageIssue | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function handle(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0] ?? null;
    e.target.value = '';
    if (!picked) return;
    const found = await validateDocumentImage(picked, constraints);
    setIssue(found);
    if (found) return;
    setFile(picked);
    onChange(picked);
  }

  function clear() {
    setFile(null);
    setIssue(null);
    onChange(null);
  }

  const errorText = issue
    ? t(issue.key as MessageKey, 'vars' in issue ? issue.vars : undefined)
    : externalError;
  const errorId = errorText ? `${id}-error` : undefined;
  const helpId = `${id}-help`;

  return (
    <fieldset className="space-y-2" aria-describedby={cn(helpId, errorId)}>
      <legend className="text-sm font-medium">
        {label}
        {required ? (
          <span className="ml-0.5 text-destructive" aria-hidden="true">
            *
          </span>
        ) : null}
      </legend>
      <div
        className={cn(
          'relative grid aspect-[16/10] place-items-center overflow-hidden rounded-md border border-dashed bg-muted',
          errorText && 'border-destructive',
        )}
      >
        {preview ? (
          <Image
            src={preview}
            alt={t('kyc.selected', { name: file?.name ?? '' })}
            fill
            unoptimized
            className="object-contain"
          />
        ) : (
          <ImageUp className="size-8 text-muted-foreground" aria-hidden="true" />
        )}
      </div>
      <p id={helpId} className="text-xs text-muted-foreground">
        {file
          ? t('kyc.selected', { name: file.name })
          : t('kyc.constraints', {
              width: constraints.minWidth,
              height: constraints.minHeight,
              size: formatBytes(constraints.maxFileBytes),
            })}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => cameraRef.current?.click()}
        >
          <Camera aria-hidden="true" /> {file ? t('kyc.replace') : t('kyc.takePhoto')}
          <span className="sr-only"> — {label}</span>
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => galleryRef.current?.click()}
        >
          <ImageUp aria-hidden="true" /> {t('kyc.gallery')}
          <span className="sr-only"> — {label}</span>
        </Button>
        {file ? (
          <Button type="button" size="sm" variant="ghost" onClick={clear}>
            <Trash2 aria-hidden="true" /> {t('kyc.remove')}
            <span className="sr-only"> — {label}</span>
          </Button>
        ) : null}
      </div>
      <input
        ref={cameraRef}
        id={`${id}-camera`}
        type="file"
        accept="image/jpeg,image/png"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => void handle(e)}
      />
      <input
        ref={galleryRef}
        id={id}
        type="file"
        accept="image/jpeg,image/png"
        className="sr-only"
        tabIndex={-1}
        aria-label={`${label} — ${t('kyc.gallery')}`}
        onChange={(e) => void handle(e)}
      />
      {errorText ? <FieldError id={errorId}>{errorText}</FieldError> : null}
    </fieldset>
  );
}
