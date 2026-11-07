import crypto from 'node:crypto';
import { promisify } from 'node:util';
import type { NextFunction, Request, Response } from 'express';
import type { Collections, User } from './db.js';

const scrypt = promisify(crypto.scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_LENGTH = 64;
export const SESSION_COOKIE = 'sid';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

declare module 'express-serve-static-core' {
  interface Request {
    user?: User;
  }
}

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

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of header?.split(';') ?? []) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    try {
      cookies[name] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      // Ignore malformed cookie values.
    }
  }
  return cookies;
}

export function createAuth(collections: Collections) {
  async function startSession(request: Request, response: Response, user: User) {
    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await collections.sessions.insertOne({ _id: hashToken(token), userId: user._id, expiresAt });
    response.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: request.secure,
      expires: expiresAt,
      path: '/',
    });
  }

  async function endSession(request: Request, response: Response) {
    const token = parseCookies(request.headers.cookie)[SESSION_COOKIE];
    if (token) {
      await collections.sessions.deleteOne({ _id: hashToken(token) });
    }
    response.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  /** Attaches `request.user` when the request carries a valid session cookie. */
  async function loadUser(request: Request, _response: Response, next: NextFunction) {
    const token = parseCookies(request.headers.cookie)[SESSION_COOKIE];
    if (token) {
      const session = await collections.sessions.findOne({
        _id: hashToken(token),
        expiresAt: { $gt: new Date() },
      });
      if (session) {
        request.user = (await collections.users.findOne({ _id: session.userId })) ?? undefined;
      }
    }
    next();
  }

  function requireUser(request: Request, response: Response, next: NextFunction) {
    if (!request.user) {
      response.redirect(303, '/login');
      return;
    }
    next();
  }

  return { startSession, endSession, loadUser, requireUser };
}

/**
 * Rejects form posts sent from other websites. Together with SameSite=Lax
 * session cookies this protects against cross-site request forgery.
 */
export function rejectCrossOriginPosts(request: Request, response: Response, next: NextFunction) {
  if (request.method === 'POST') {
    const origin = request.get('origin');
    if (origin && origin !== `${request.protocol}://${request.get('host')}`) {
      response.status(403).type('text').send('Cross-origin request blocked');
      return;
    }
  }
  next();
}
