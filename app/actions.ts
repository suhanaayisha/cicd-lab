'use server';

// Server Actions: the forms post here. Next.js rejects calls from other websites (CSRF protection),
// and all the business rules live in lib/, which the tests exercise directly.

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { logIn, signUp } from '@/lib/auth';
import { getCollections } from '@/lib/db';
import { createMenu, deleteMenu, replaceMenuPdf } from '@/lib/menus';
import { getStore } from '@/lib/storage';
import { endSession, requireUser, startSession } from './_lib/session';

/** `values` refills the text fields after an error, so people don't retype them. Never includes passwords. */
export type FormState = { error?: string; values?: Record<string, string> } | undefined;

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

async function pdfFrom(formData: FormData): Promise<Buffer | null> {
  const file = formData.get('pdf');
  if (!(file instanceof File) || file.size === 0) return null;
  return Buffer.from(await file.arrayBuffer());
}

async function deps() {
  return { collections: await getCollections(), store: getStore() };
}

export async function signUpAction(_state: FormState, formData: FormData): Promise<FormState> {
  const values = { email: text(formData, 'email'), username: text(formData, 'username') };
  const result = await signUp(await getCollections(), {
    ...values,
    password: text(formData, 'password'),
    confirmPassword: text(formData, 'confirmPassword'),
  });
  if (!result.ok) return { error: result.error, values };
  await startSession(result.user);
  redirect('/dashboard');
}

export async function logInAction(_state: FormState, formData: FormData): Promise<FormState> {
  const login = text(formData, 'login');
  const result = await logIn(await getCollections(), { login, password: text(formData, 'password') });
  if (!result.ok) return { error: result.error, values: { login } };
  await startSession(result.user);
  redirect('/dashboard');
}

export async function logOutAction(): Promise<void> {
  await endSession();
  redirect('/');
}

export async function createMenuAction(_state: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const result = await createMenu(await deps(), {
    ownerId: user._id,
    name: text(formData, 'name'),
    pdf: await pdfFrom(formData),
  });
  if (!result.ok) return { error: result.error };
  revalidatePath('/dashboard');
  return {};
}

// The menu ID arrives as a hidden form field. That's safe: lib/menus only touches menus owned by the signed-in user.
export async function replaceMenuPdfAction(_state: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const result = await replaceMenuPdf(await deps(), {
    ownerId: user._id,
    menuId: text(formData, 'menuId'),
    pdf: await pdfFrom(formData),
  });
  if (!result.ok) return { error: result.error };
  revalidatePath('/dashboard');
  return {};
}

export async function deleteMenuAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  await deleteMenu(await deps(), { ownerId: user._id, menuId: text(formData, 'menuId') });
  revalidatePath('/dashboard');
}
