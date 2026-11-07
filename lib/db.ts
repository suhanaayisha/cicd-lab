import { MongoClient, MongoServerError, type Collection, type Db, type ObjectId } from 'mongodb';

export interface User {
  _id: ObjectId;
  email: string;
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

export function getCollections(db: Db): Collections {
  return {
    users: db.collection<User>('users'),
    sessions: db.collection<Session>('sessions'),
    menus: db.collection<Menu>('menus'),
  };
}

export async function ensureIndexes(collections: Collections): Promise<void> {
  await Promise.all([
    collections.users.createIndex({ email: 1 }, { unique: true }),
    // MongoDB deletes sessions automatically once expiresAt passes.
    collections.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    collections.menus.createIndex({ slug: 1 }, { unique: true }),
    collections.menus.createIndex({ ownerId: 1, createdAt: -1 }),
  ]);
}

export async function connect(uri: string, dbName: string) {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  const collections = getCollections(db);
  await ensureIndexes(collections);
  return { client, db, collections };
}

export function isDuplicateKeyError(error: unknown): boolean {
  return error instanceof MongoServerError && error.code === 11000;
}
