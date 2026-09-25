'use client';

import { ACCEPTED_IMAGE_MIME } from '@tontine/contracts';
import { FormField, Input } from '@tontine/ui';
import { useState } from 'react';
import { formatBytes } from '@/lib/format';

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
      reject(new Error('Image illisible'));
    };
    img.src = url;
  });
}

/** Contrôles côté client (JPEG/PNG, taille, résolution minimale) — revérifiés par l'API. */
export async function validateDocumentImage(
  file: File,
  c: ImageConstraints,
): Promise<string | null> {
  if (!(ACCEPTED_IMAGE_MIME as readonly string[]).includes(file.type)) {
    return 'Format non accepté : JPEG ou PNG uniquement.';
  }
  if (file.size > c.maxFileBytes) {
    return `Fichier trop volumineux (${formatBytes(file.size)}) : ${formatBytes(c.maxFileBytes)} maximum.`;
  }
  try {
    const { width, height } = await readImageSize(file);
    const ok =
      (width >= c.minWidth && height >= c.minHeight) ||
      (height >= c.minWidth && width >= c.minHeight);
    if (!ok) {
      return `Résolution insuffisante (${width}×${height}) : ${c.minWidth}×${c.minHeight} minimum.`;
    }
  } catch {
    return 'Image illisible.';
  }
  return null;
}

/** Sélection d'une photo de pièce d'identité (recto / verso / justificatif). */
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
  const [error, setError] = useState<string | undefined>();
  const [name, setName] = useState<string | null>(null);

  async function handle(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setError(undefined);
    if (!file) {
      setName(null);
      onChange(null);
      return;
    }
    const msg = await validateDocumentImage(file, constraints);
    if (msg) {
      setError(msg);
      setName(null);
      onChange(null);
      e.target.value = '';
      return;
    }
    setName(file.name);
    onChange(file);
  }

  return (
    <FormField
      id={id}
      label={label}
      required={required}
      error={error ?? externalError}
      description={
        name
          ? `Sélectionné : ${name}`
          : `JPEG ou PNG, ${constraints.minWidth}×${constraints.minHeight} px minimum, ${formatBytes(constraints.maxFileBytes)} maximum.`
      }
    >
      <Input type="file" accept="image/jpeg,image/png" onChange={(e) => void handle(e)} />
    </FormField>
  );
}
