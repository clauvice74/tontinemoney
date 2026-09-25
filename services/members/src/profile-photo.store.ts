import { Inject, Injectable } from '@nestjs/common';
import { type AppConfig } from '@tontine/config';
import { PROFILE_PHOTO_MAX_BYTES } from '@tontine/contracts';
import { APP_CONFIG, DomainError } from '@tontine/platform';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

/** Détection du type réel par signature binaire (ne pas faire confiance au Content-Type). */
export function detectImageType(buf: Buffer): 'image/jpeg' | 'image/png' | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  return null;
}

/** Stockage local des photos de profil, hors répertoire public (A-22 : pas de redimensionnement en V1). */
@Injectable()
export class ProfilePhotoStore {
  private readonly root: string;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.root = resolve(dirname(resolve(config.DOCUMENT_STORAGE_DIR)), 'profile');
  }

  validate(buf: Buffer): 'image/jpeg' | 'image/png' {
    if (buf.length > PROFILE_PHOTO_MAX_BYTES)
      throw new DomainError('FILE_TOO_LARGE', 'Fichier trop volumineux (5 Mo maximum)');
    const type = detectImageType(buf);
    if (!type) throw new DomainError('UNSUPPORTED_MEDIA_TYPE', 'Formats acceptés : JPEG ou PNG');
    return type;
  }

  async save(memberId: string, buf: Buffer): Promise<string> {
    const type = this.validate(buf);
    const ref = `${memberId}.${type === 'image/png' ? 'png' : 'jpg'}`;
    const path = join(this.root, ref);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, buf);
    return ref;
  }

  async read(ref: string): Promise<{ data: Buffer; type: string }> {
    if (!/^[0-9a-f-]{36}\.(png|jpg)$/.test(ref)) throw new DomainError('NOT_FOUND');
    const data = await readFile(join(this.root, ref));
    return { data, type: ref.endsWith('.png') ? 'image/png' : 'image/jpeg' };
  }
}
