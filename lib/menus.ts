import crypto from 'node:crypto';
import { ObjectId } from 'mongodb';
import { isDuplicateKeyError, type Collections, type Menu } from './db';
import type { FileStore } from './storage';

export const MAX_PDF_BYTES = 25 * 1024 * 1024;
export const MAX_PDF_MB = MAX_PDF_BYTES / 1024 / 1024;

export interface MenuDeps {
  collections: Collections;
  store: FileStore;
}

export type MenuResult = { ok: true; menu: Menu } | { ok: false; error: string };

export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/, '');
  return slug || 'menu';
}

/** Checks the file's contents, not its name: every PDF starts with `%PDF-`. */
export function isPdf(data: Buffer): boolean {
  return data.subarray(0, 5).toString('latin1') === '%PDF-';
}

function validatePdf(pdf: Buffer | null): string | null {
  if (!pdf || pdf.length === 0 || !isPdf(pdf)) return 'Please choose a PDF file.';
  if (pdf.length > MAX_PDF_BYTES) return `That PDF is larger than ${MAX_PDF_MB} MB.`;
  return null;
}

function newFileKey(menuId: ObjectId): string {
  return `menus/${menuId.toString()}/${crypto.randomBytes(8).toString('hex')}.pdf`;
}

/** The PDF URL the menu page uses. It changes whenever the PDF is replaced, so it can be cached forever. */
export function versionedPdfPath(menu: Pick<Menu, 'slug' | 'updatedAt'>): string {
  return `/m/${menu.slug}/menu.pdf?v=${menu.updatedAt.getTime()}`;
}

export function listMenus({ collections }: MenuDeps, ownerId: ObjectId): Promise<Menu[]> {
  return collections.menus.find({ ownerId }).sort({ createdAt: -1 }).toArray();
}

export function findMenuBySlug({ collections }: MenuDeps, slug: string): Promise<Menu | null> {
  return collections.menus.findOne({ slug });
}

/** Finds a menu only if it belongs to the given user, so nobody can change someone else's menu. */
async function findOwnMenu({ collections }: MenuDeps, ownerId: ObjectId, menuId: string) {
  if (!ObjectId.isValid(menuId)) return null;
  return collections.menus.findOne({ _id: new ObjectId(menuId), ownerId });
}

export async function createMenu(
  deps: MenuDeps,
  input: { ownerId: ObjectId; name: string; pdf: Buffer | null },
): Promise<MenuResult> {
  const name = input.name.trim();
  if (!name || name.length > 80) return { ok: false, error: 'Menu name must be 1–80 characters.' };
  const pdfError = validatePdf(input.pdf);
  if (pdfError) return { ok: false, error: pdfError };
  const pdf = input.pdf!;

  const menuId = new ObjectId();
  const fileKey = newFileKey(menuId);
  await deps.store.put(fileKey, pdf, 'application/pdf');

  // Try the plain slug first, then add a number until one is free.
  const baseSlug = slugify(name);
  for (let attempt = 1; attempt <= 50; attempt++) {
    const now = new Date();
    const menu: Menu = {
      _id: menuId,
      ownerId: input.ownerId,
      name,
      slug: attempt === 1 ? baseSlug : `${baseSlug}-${attempt}`,
      fileKey,
      fileSize: pdf.length,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await deps.collections.menus.insertOne(menu);
      return { ok: true, menu };
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        await deps.store.delete(fileKey);
        throw error;
      }
    }
  }

  await deps.store.delete(fileKey);
  return { ok: false, error: 'Could not create a unique link for this name. Try a different name.' };
}

export async function replaceMenuPdf(
  deps: MenuDeps,
  input: { ownerId: ObjectId; menuId: string; pdf: Buffer | null },
): Promise<MenuResult> {
  const menu = await findOwnMenu(deps, input.ownerId, input.menuId);
  if (!menu) return { ok: false, error: 'Menu not found.' };
  const pdfError = validatePdf(input.pdf);
  if (pdfError) return { ok: false, error: pdfError };
  const pdf = input.pdf!;

  // Upload the new file before switching to it, so the menu is never left without a PDF.
  const fileKey = newFileKey(menu._id);
  await deps.store.put(fileKey, pdf, 'application/pdf');
  const updated = { ...menu, fileKey, fileSize: pdf.length, updatedAt: new Date() };
  await deps.collections.menus.updateOne(
    { _id: menu._id },
    { $set: { fileKey, fileSize: updated.fileSize, updatedAt: updated.updatedAt } },
  );
  await deps.store.delete(menu.fileKey);
  return { ok: true, menu: updated };
}

export async function deleteMenu(
  deps: MenuDeps,
  input: { ownerId: ObjectId; menuId: string },
): Promise<boolean> {
  const menu = await findOwnMenu(deps, input.ownerId, input.menuId);
  if (!menu) return false;
  await deps.collections.menus.deleteOne({ _id: menu._id });
  await deps.store.delete(menu.fileKey);
  return true;
}
