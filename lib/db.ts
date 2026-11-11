import { MongoClient, MongoServerError, type Collection, type Db, type ObjectId } from 'mongodb';
import { getConfig } from './config';

export interface User {
  _id: ObjectId;
  email: string;
  /** Lowercase; see USERNAME_PATTERN in lib/auth.ts. Optional because older accounts may not have one. */
  username?: string;
  passwordHash: string;
  createdAt: Date;
}

export interface Session {
  /** SHA-256 of the session token, so a database leak doesn't expose live sessions. */
  _id: string;
  userId: ObjectId;
  expiresAt: Date;
}

export interface Menu {
  _id: ObjectId;
  ownerId: ObjectId;
  name: string;
  slug: string;
  fileKey: string;
  fileSize: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Collections {
  users: Collection<User>;
  sessions: Collection<Session>;
  menus: Collection<Menu>;
}

export function collectionsFor(db: Db): Collections {
  return {
    users: db.collection<User>('users'),
    sessions: db.collection<Session>('sessions'),
    menus: db.collection<Menu>('menus'),
  };
}

export async function ensureIndexes(collections: Collections): Promise<void> {
  await Promise.all([
    collections.users.createIndex({ email: 1 }, { unique: true }),
    // Unique among accounts that have a username; older accounts without one are skipped.
    collections.users.createIndex(
      { username: 1 },
      { unique: true, partialFilterExpression: { username: { $type: 'string' } } },
    ),
    // MongoDB deletes sessions automatically once expiresAt passes.
    collections.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    collections.menus.createIndex({ slug: 1 }, { unique: true }),
    collections.menus.createIndex({ ownerId: 1, createdAt: -1 }),
  ]);
}

// Kept on globalThis so Next.js hot reloads in development reuse one connection pool.
const globalForDb = globalThis as typeof globalThis & {
  menuqrCollections?: Promise<Collections>;
};

/** Connects on first use and returns the app's collections. */
export function getCollections(): Promise<Collections> {
  globalForDb.menuqrCollections ??= (async () => {
    const config = getConfig();
    const client = new MongoClient(config.mongodbUri);
    await client.connect();
    const collections = collectionsFor(client.db(config.mongodbDb));
    await ensureIndexes(collections);
    return collections;
  })().catch((error) => {
    // Let the next request retry instead of caching the failure forever.
    globalForDb.menuqrCollections = undefined;
    throw error;
  });
  return globalForDb.menuqrCollections;
}

export function isDuplicateKeyError(error: unknown): boolean {
  return error instanceof MongoServerError && error.code === 11000;
}

/** Which unique field a duplicate key error was about, e.g. 'email' or 'username'. */
export function duplicateKeyField(error: unknown): string | undefined {
  if (!isDuplicateKeyError(error)) return undefined;
  return Object.keys((error as MongoServerError).keyPattern ?? {})[0];
}
