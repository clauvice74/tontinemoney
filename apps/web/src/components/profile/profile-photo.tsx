'use client';

import { ACCEPTED_IMAGE_MIME, PROFILE_PHOTO_MAX_BYTES } from '@tontine/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Label } from '@tontine/ui';
import { User } from 'lucide-react';
import Image from 'next/image';
import { useEffect, useId, useState } from 'react';
import { api } from '@/lib/api';
import { formatBytes } from '@/lib/format';
import { formatError } from '@/lib/forms';

/** Photo de profil (JPEG/PNG ≤ 5 Mo) — chargée avec le jeton puis affichée via une URL blob. */
export function ProfilePhoto({ hasPhoto }: { hasPhoto: boolean }) {
  const id = useId();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const photo = useQuery({
    queryKey: ['profile', 'photo'],
    queryFn: () => api.get<Blob>('/me/profile/photo', { responseType: 'blob' }),
    enabled: hasPhoto,
    staleTime: Infinity,
  });
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!photo.data) return;
    const u = URL.createObjectURL(photo.data);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [photo.data]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!(ACCEPTED_IMAGE_MIME as readonly string[]).includes(file.type)) {
      setError('Format non accepté : utilisez une image JPEG ou PNG.');
      return;
    }
    if (file.size > PROFILE_PHOTO_MAX_BYTES) {
      setError(`Fichier trop volumineux (${formatBytes(file.size)}) : 5 Mo maximum.`);
      return;
    }
    const data = new FormData();
    data.append('file', file);
    setUploading(true);
    try {
      await api.post('/me/profile/photo', data);
      await queryClient.invalidateQueries({ queryKey: ['profile'] });
    } catch (err) {
      setError(formatError(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
      <div className="grid size-24 place-items-center overflow-hidden rounded-full border bg-muted">
        {url ? (
          <Image
            src={url}
            alt="Votre photo de profil"
            width={96}
            height={96}
            unoptimized
            className="size-full object-cover"
          />
        ) : (
          <User className="size-10 text-muted-foreground" aria-hidden="true" />
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor={id}>Photo de profil</Label>
        <p className="text-xs text-muted-foreground">JPEG ou PNG, 5 Mo maximum.</p>
        <input
          id={id}
          type="file"
          accept="image/jpeg,image/png"
          onChange={(e) => void onFile(e)}
          className="sr-only"
        />
        <Button asChild variant="outline" size="sm" loading={uploading}>
          <label htmlFor={id} className="cursor-pointer">
            {hasPhoto ? 'Changer la photo' : 'Ajouter une photo'}
          </label>
        </Button>
        {error ? <Alert variant="destructive" title={error} /> : null}
      </div>
    </div>
  );
}
