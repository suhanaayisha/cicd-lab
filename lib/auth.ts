import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { ObjectId } from 'mongodb';
import { isDuplicateKeyError, type Collections, type User } from './db';

const scrypt = promisify(crypto.scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_LENGTH = 64;
export const SESSION_COOKIE = 'sid';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type AuthResult = { ok: true; user: User } | { ok: false; error: string };

// ---------- Passwords ----------

// Passwords are stored as `scrypt$<salt>$<hash>` (base64), never in plain text.
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

// ---------- Accounts ----------

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function signUp(
  collections: Collections,
  input: { email: string; password: string; confirmPassword: string },
): Promise<AuthResult> {
  const email = normalizeEmail(input.email);
  if (!EMAIL_PATTERN.test(email) || email.length > 254) {
    return { ok: false, error: 'Enter a valid email address.' };
  }
  if (input.password.length < 8 || input.password.length > 200) {
    return { ok: false, error: 'Password must be 8–200 characters.' };
  }
  if (input.password !== input.confirmPassword) {
    return { ok: false, error: 'Passwords do not match.' };
  }

  const user: User = {
    _id: new ObjectId(),
    email,
    passwordHash: await hashPassword(input.password),
    createdAt: new Date(),
  };
  try {
    await collections.users.insertOne(user);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return { ok: false, error: 'An account with this email already exists. Try logging in.' };
    }
    throw error;
  }
  return { ok: true, user };
}

export async function logIn(
  collections: Collections,
  input: { email: string; password: string },
): Promise<AuthResult> {
  const user = await collections.users.findOne({ email: normalizeEmail(input.email) });
  if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
    return { ok: false, error: 'Incorrect email or password.' };
  }
  return { ok: true, user };
}

// ---------- Sessions ----------

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Creates a session and returns the token to put in the cookie. Only its hash is stored. */
export async function createSession(collections: Collections, userId: ObjectId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await collections.sessions.insertOne({ _id: hashToken(token), userId, expiresAt });
  return { token, expiresAt };
}

export async function findUserBySession(collections: Collections, token: string): Promise<User | null> {
  const session = await collections.sessions.findOne({
    _id: hashToken(token),
    expiresAt: { $gt: new Date() },
  });
  if (!session) return null;
  return collections.users.findOne({ _id: session.userId });
}

export async function deleteSession(collections: Collections, token: string): Promise<void> {
  await collections.sessions.deleteOne({ _id: hashToken(token) });
}
