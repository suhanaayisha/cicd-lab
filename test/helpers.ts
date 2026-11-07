import crypto from 'node:crypto';
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { collectionsFor, ensureIndexes, type Collections } from '../lib/db';

if (fs.existsSync('.env')) {
  process.loadEnvFile('.env');
}

// Deliberately not MONGODB_URI, so tests can never touch the real database.
export const TEST_MONGODB_URI = process.env.TEST_MONGODB_URI ?? 'mongodb://127.0.0.1:27017';

/** A throwaway database for one test file. Call drop() when done. */
export async function createTestDatabase() {
  const name = `menus_test_${crypto.randomBytes(4).toString('hex')}`;
  const client = new MongoClient(TEST_MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  const collections: Collections = collectionsFor(client.db(name));
  await ensureIndexes(collections);

  return {
    name,
    collections,
    async drop() {
      await client.db(name).dropDatabase();
      await client.close();
    },
  };
}

export function pdfBytes(label = 'menu'): Buffer {
  return Buffer.from(`%PDF-1.4\n% ${label}\n%%EOF\n`);
}
