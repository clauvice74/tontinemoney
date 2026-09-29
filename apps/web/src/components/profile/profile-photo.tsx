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
import { useI18n } from '@/lib/i18n';

/** Photo de profil (JPEG/PNG ≤ 5 Mo) — chargée avec le jeton puis affichée via une URL blob. */
export function ProfilePhoto({ hasPhoto }: { hasPhoto: boolean }) {
  const { t } = useI18n();
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
      setError(t('profile.photoFormat'));
      return;
    }
    if (file.size > PROFILE_PHOTO_MAX_BYTES) {
      setError(t('profile.photoSize', { size: formatBytes(file.size) }));
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
            alt={t('profile.photoAlt')}
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
        <Label htmlFor={id}>{t('profile.photo')}</Label>
        <p className="text-xs text-muted-foreground">{t('profile.photoHint')}</p>
        <input
          id={id}
          type="file"
          accept="image/jpeg,image/png"
          onChange={(e) => void onFile(e)}
          className="sr-only"
        />
        <Button asChild variant="outline" size="sm" loading={uploading}>
          <label htmlFor={id} className="cursor-pointer">
            {hasPhoto ? t('profile.photoChange') : t('profile.photoAdd')}
          </label>
        </Button>
        {error ? <Alert variant="destructive" title={error} /> : null}
      </div>
    </div>
  );
}
