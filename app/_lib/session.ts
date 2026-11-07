import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { createSession, deleteSession, findUserBySession, SESSION_COOKIE } from '@/lib/auth';
import { getCollections, type User } from '@/lib/db';

/** The signed-in user, or null. Cached so a page and its layout share one lookup per request. */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return findUserBySession(await getCollections(), token);
});

export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}

export async function startSession(user: User): Promise<void> {
  const { token, expiresAt } = await createSession(await getCollections(), user._id);
  const isHttps = (await headers()).get('x-forwarded-proto')?.split(',')[0] === 'https';
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttps,
    expires: expiresAt,
    path: '/',
  });
}

export async function endSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) await deleteSession(await getCollections(), token);
  cookieStore.delete(SESSION_COOKIE);
}
