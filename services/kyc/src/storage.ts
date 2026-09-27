import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { DataCipher } from '@tontine/auth';
import { type AppConfig } from '@tontine/config';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

/**
 * Stockage des documents KYC (R-KYC-05, A-17) : chiffrement applicatif AES-256-GCM avant écriture,
 * clés opaques, hors de tout répertoire public. Implémentations : disque local, S3 (MinIO en local).
 */
export abstract class DocumentStorage {
  abstract readonly driver: string;
  protected abstract putRaw(key: string, data: Buffer): Promise<void>;
  protected abstract getRaw(key: string): Promise<Buffer>;
  protected abstract deleteRaw(key: string): Promise<void>;

  constructor(protected readonly cipher: DataCipher) {}

  async put(key: string, plain: Buffer): Promise<void> {
    await this.putRaw(key, this.cipher.encrypt(plain, key));
  }

  async get(key: string): Promise<Buffer> {
    return this.cipher.decrypt(await this.getRaw(key), key);
  }

  /** Lecture brute (chiffrée) — utilisée par les tests pour vérifier le chiffrement au repos. */
  async getEncrypted(key: string): Promise<Buffer> {
    return this.getRaw(key);
  }

  async delete(key: string): Promise<void> {
    await this.deleteRaw(key);
  }
}

export class LocalDocumentStorage extends DocumentStorage {
  readonly driver = 'local';
  private readonly root: string;

  constructor(cipher: DataCipher, dir: string) {
    super(cipher);
    this.root = resolve(dir);
  }

  private path(key: string): string {
    const p = resolve(join(this.root, key));
    if (!p.startsWith(this.root + sep)) throw new Error('Clé de stockage invalide');
    return p;
  }

  protected async putRaw(key: string, data: Buffer): Promise<void> {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true, mode: 0o700 });
    await writeFile(p, data, { mode: 0o600 });
  }

  protected async getRaw(key: string): Promise<Buffer> {
    return readFile(this.path(key));
  }

  protected async deleteRaw(key: string): Promise<void> {
    await unlink(this.path(key)).catch(() => undefined);
  }
}

export class S3DocumentStorage extends DocumentStorage {
  readonly driver = 's3';
  private readonly s3: S3Client;

  constructor(
    cipher: DataCipher,
    private readonly config: AppConfig,
  ) {
    super(cipher);
    this.s3 = new S3Client({
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      forcePathStyle: true,
      credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY },
    });
  }

  protected async putRaw(key: string, data: Buffer): Promise<void> {
    // Chiffrement applicatif + chiffrement côté serveur (SSE-S3)
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.config.S3_BUCKET_KYC,
        Key: key,
        Body: data,
        ServerSideEncryption: 'AES256',
      }),
    );
  }

  protected async getRaw(key: string): Promise<Buffer> {
    const res = await this.s3.send(
      new GetObjectCommand({ Bucket: this.config.S3_BUCKET_KYC, Key: key }),
    );
    return Buffer.from(await res.Body!.transformToByteArray());
  }

  protected async deleteRaw(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.config.S3_BUCKET_KYC, Key: key }));
  }
}
