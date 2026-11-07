import fs from 'node:fs/promises';
import path from 'node:path';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getConfig, type StorageConfig } from './config';

/** Where uploaded menu files live. Keys look like `menus/<menuId>/<random>.pdf`. */
export interface FileStore {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  /** Returns null when the file doesn't exist. */
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

/** Keeps files in process memory. Used by the tests. */
export class MemoryFileStore implements FileStore {
  readonly files = new Map<string, Buffer>();

  async put(key: string, data: Buffer): Promise<void> {
    this.files.set(key, data);
  }

  async get(key: string): Promise<Buffer | null> {
    return this.files.get(key) ?? null;
  }

  async delete(key: string): Promise<void> {
    this.files.delete(key);
  }
}

/** Keeps files in a folder on disk. Used for local development. */
export class LocalFileStore implements FileStore {
  constructor(private readonly dir: string) {}

  private resolve(key: string): string {
    const full = path.resolve(this.dir, key);
    if (!full.startsWith(path.resolve(this.dir) + path.sep)) {
      throw new Error(`Invalid storage key: ${key}`);
    }
    return full;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const file = this.resolve(key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, data);
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(this.resolve(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await fs.rm(this.resolve(key), { force: true });
  }
}

/** Keeps files in a Cloudflare R2 bucket (S3-compatible). Used in production. */
export class R2FileStore implements FileStore {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: Extract<StorageConfig, { driver: 'r2' }>) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentType: contentType }),
    );
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!result.Body) return null;
      return Buffer.from(await result.Body.transformToByteArray());
    } catch (error) {
      if (error instanceof NoSuchKey) return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

export function createFileStore(config: StorageConfig): FileStore {
  switch (config.driver) {
    case 'r2':
      return new R2FileStore(config);
    case 'local':
      return new LocalFileStore(config.dir);
    case 'memory':
      return new MemoryFileStore();
  }
}

const globalForStore = globalThis as typeof globalThis & { menuqrStore?: FileStore };

/** The app's file store, created once from the environment. */
export function getStore(): FileStore {
  globalForStore.menuqrStore ??= createFileStore(getConfig().storage);
  return globalForStore.menuqrStore;
}
