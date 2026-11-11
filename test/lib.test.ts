// Business rules in lib/, tested directly against a real MongoDB.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { ObjectId } from 'mongodb';
import { createSession, deleteSession, findUserBySession, logIn, signUp } from '../lib/auth';
import { loadConfig } from '../lib/config';
import type { Collections } from '../lib/db';
import {
  createMenu,
  deleteMenu,
  listMenus,
  MAX_PDF_BYTES,
  replaceMenuPdf,
  slugify,
  versionedPdfPath,
  type MenuDeps,
} from '../lib/menus';
import { MemoryFileStore } from '../lib/storage';
import { createTestDatabase, pdfBytes } from './helpers';

let db: Awaited<ReturnType<typeof createTestDatabase>>;
let collections: Collections;
let store: MemoryFileStore;
let deps: MenuDeps;

before(async () => {
  db = await createTestDatabase();
  collections = db.collections;
  store = new MemoryFileStore();
  deps = { collections, store };
});

after(async () => {
  await db?.drop();
});

let counter = 0;
const uniqueEmail = () => `user${++counter}@example.com`;
const uniqueUsername = () => `user${++counter}`;

describe('config', () => {
  test('requires all R2 settings when STORAGE_DRIVER=r2', () => {
    assert.throws(() => loadConfig({ STORAGE_DRIVER: 'r2' }), /R2_ACCOUNT_ID/);
  });

  test('rejects unknown storage drivers', () => {
    assert.throws(() => loadConfig({ STORAGE_DRIVER: 'ftp' }), /Unknown STORAGE_DRIVER/);
  });

  test('uses the Render commit as the version when APP_VERSION is unset', () => {
    assert.equal(loadConfig({ RENDER_GIT_COMMIT: 'abcdef1234567' }).appVersion, 'abcdef1');
  });
});

describe('accounts', () => {
  test('sign up stores a hashed password, never the plain text', async () => {
    const result = await signUp(collections, { email: uniqueEmail(), username: uniqueUsername(), password: 'correct horse battery', confirmPassword: 'correct horse battery' });
    assert.ok(result.ok);
    const user = await collections.users.findOne({ _id: result.user._id });
    assert.match(user!.passwordHash, /^scrypt\$/);
    assert.doesNotMatch(user!.passwordHash, /correct horse/);
  });

  test('rejects invalid emails, short passwords and duplicate accounts', async () => {
    assert.deepEqual(await signUp(collections, { email: 'not-an-email', username: uniqueUsername(), password: 'long enough', confirmPassword: 'long enough' }), {
      ok: false,
      error: 'Enter a valid email address.',
    });
    assert.equal((await signUp(collections, { email: uniqueEmail(), username: uniqueUsername(), password: 'short', confirmPassword: 'short' })).ok, false);

    const email = uniqueEmail();
    assert.ok((await signUp(collections, { email, username: uniqueUsername(), password: 'first password', confirmPassword: 'first password' })).ok);
    const duplicate = await signUp(collections, { email: email.toUpperCase(), username: uniqueUsername(), password: 'second password', confirmPassword: 'second password' });
    assert.equal(duplicate.ok, false);
  });

  test('rejects sign-up when the passwords do not match', async () => {
    const email = uniqueEmail();
    const result = await signUp(collections, { email, username: uniqueUsername(), password: 'correct horse battery', confirmPassword: 'correct horse batery' });
    assert.deepEqual(result, { ok: false, error: 'Passwords do not match.' });
    assert.equal(await collections.users.countDocuments({ email }), 0);
  });

  test('log in checks the password and ignores email case', async () => {
    const email = uniqueEmail();
    await signUp(collections, { email, username: uniqueUsername(), password: 'correct horse battery', confirmPassword: 'correct horse battery' });

    assert.equal((await logIn(collections, { login: email, password: 'wrong password' })).ok, false);
    assert.equal((await logIn(collections, { login: 'nobody@example.com', password: 'x' })).ok, false);
    assert.ok((await logIn(collections, { login: ` ${email.toUpperCase()} `, password: 'correct horse battery' })).ok);
  });

  test('log in also works with the username, ignoring case', async () => {
    const username = uniqueUsername();
    await signUp(collections, { email: uniqueEmail(), username, password: 'correct horse battery', confirmPassword: 'correct horse battery' });

    assert.ok((await logIn(collections, { login: ` ${username.toUpperCase()} `, password: 'correct horse battery' })).ok);
    assert.equal((await logIn(collections, { login: username, password: 'wrong password' })).ok, false);
    assert.equal((await logIn(collections, { login: 'nobody', password: 'x' })).ok, false);
    assert.equal((await logIn(collections, { login: '', password: 'x' })).ok, false);
  });

  test('usernames are stored in lowercase, validated and unique', async () => {
    const username = uniqueUsername();
    const result = await signUp(collections, { email: uniqueEmail(), username: username.toUpperCase(), password: 'long enough', confirmPassword: 'long enough' });
    assert.ok(result.ok);
    assert.equal(result.user.username, username);

    const duplicate = await signUp(collections, { email: uniqueEmail(), username, password: 'long enough', confirmPassword: 'long enough' });
    assert.deepEqual(duplicate, { ok: false, error: 'That username is taken. Please choose another.' });

    for (const bad of ['ab', 'has space', 'me@example.com', 'x'.repeat(31)]) {
      const invalid = await signUp(collections, { email: uniqueEmail(), username: bad, password: 'long enough', confirmPassword: 'long enough' });
      assert.equal(invalid.ok, false, `${bad} should be rejected`);
    }
  });

  test('accounts without a username can still sign up alongside others', async () => {
    // Older accounts have no username field; the unique index must ignore them.
    await collections.users.insertMany([
      { _id: new ObjectId(), email: uniqueEmail(), passwordHash: 'x', createdAt: new Date() },
      { _id: new ObjectId(), email: uniqueEmail(), passwordHash: 'x', createdAt: new Date() },
    ]);
  });

  test('sessions resolve to their user until deleted or expired', async () => {
    const result = await signUp(collections, { email: uniqueEmail(), username: uniqueUsername(), password: 'correct horse battery', confirmPassword: 'correct horse battery' });
    assert.ok(result.ok);
    const { token } = await createSession(collections, result.user._id);

    assert.equal((await findUserBySession(collections, token))?.email, result.user.email);
    assert.equal(await collections.sessions.countDocuments({ _id: token }), 0, 'raw token must not be stored');

    await deleteSession(collections, token);
    assert.equal(await findUserBySession(collections, token), null);

    const expired = await createSession(collections, result.user._id);
    await collections.sessions.updateMany({ userId: result.user._id }, { $set: { expiresAt: new Date(0) } });
    assert.equal(await findUserBySession(collections, expired.token), null);
  });
});

describe('menus', () => {
  const owner = new ObjectId();

  test('slugify makes URL-safe names', () => {
    assert.equal(slugify("Café L'Étoile — Dinner Menu"), 'cafe-l-etoile-dinner-menu');
    assert.equal(slugify('!!!'), 'menu');
  });

  test('creating a menu stores the PDF and gives it a link', async () => {
    const pdf = pdfBytes('river');
    const result = await createMenu(deps, { ownerId: owner, name: '  River Café ', pdf });
    assert.ok(result.ok);
    assert.equal(result.menu.name, 'River Café');
    assert.equal(result.menu.slug, 'river-cafe');
    assert.deepEqual(await store.get(result.menu.fileKey), pdf);
    assert.match(versionedPdfPath(result.menu), /^\/m\/river-cafe\/menu\.pdf\?v=\d+$/);
  });

  test('menus with the same name get different links', async () => {
    const first = await createMenu(deps, { ownerId: owner, name: 'Same Name', pdf: pdfBytes() });
    const second = await createMenu(deps, { ownerId: new ObjectId(), name: 'Same Name', pdf: pdfBytes() });
    assert.ok(first.ok && second.ok);
    assert.deepEqual([first.menu.slug, second.menu.slug], ['same-name', 'same-name-2']);
  });

  test('rejects missing names, non-PDF files and files over the limit', async () => {
    const before = store.files.size;
    assert.equal((await createMenu(deps, { ownerId: owner, name: ' ', pdf: pdfBytes() })).ok, false);
    assert.deepEqual(await createMenu(deps, { ownerId: owner, name: 'Fake', pdf: Buffer.from('<html>') }), {
      ok: false,
      error: 'Please choose a PDF file.',
    });
    assert.equal((await createMenu(deps, { ownerId: owner, name: 'Empty', pdf: null })).ok, false);
    const big = Buffer.concat([pdfBytes(), Buffer.alloc(MAX_PDF_BYTES)]);
    assert.deepEqual(await createMenu(deps, { ownerId: owner, name: 'Huge', pdf: big }), {
      ok: false,
      error: 'That PDF is larger than 25 MB.',
    });
    assert.equal(store.files.size, before, 'rejected uploads must not leave files behind');
  });

  test('replacing the PDF keeps the link and deletes the old file', async () => {
    const created = await createMenu(deps, { ownerId: owner, name: 'Replace Me', pdf: pdfBytes('old') });
    assert.ok(created.ok);
    const newPdf = pdfBytes('new');

    const replaced = await replaceMenuPdf(deps, { ownerId: owner, menuId: created.menu._id.toString(), pdf: newPdf });
    assert.ok(replaced.ok);
    assert.equal(replaced.menu.slug, created.menu.slug);
    assert.notEqual(versionedPdfPath(replaced.menu), versionedPdfPath(created.menu), 'cache-busting URL must change');
    assert.equal(store.files.has(created.menu.fileKey), false);
    assert.deepEqual(await store.get(replaced.menu.fileKey), newPdf);
  });

  test('deleting a menu removes it and its file', async () => {
    const created = await createMenu(deps, { ownerId: owner, name: 'Delete Me', pdf: pdfBytes() });
    assert.ok(created.ok);
    assert.equal(await deleteMenu(deps, { ownerId: owner, menuId: created.menu._id.toString() }), true);
    assert.equal(await collections.menus.countDocuments({ _id: created.menu._id }), 0);
    assert.equal(store.files.has(created.menu.fileKey), false);
  });

  test("users cannot change or delete someone else's menu", async () => {
    const created = await createMenu(deps, { ownerId: owner, name: 'Not Yours', pdf: pdfBytes() });
    assert.ok(created.ok);
    const intruder = new ObjectId();
    const menuId = created.menu._id.toString();

    assert.equal((await replaceMenuPdf(deps, { ownerId: intruder, menuId, pdf: pdfBytes('evil') })).ok, false);
    assert.equal(await deleteMenu(deps, { ownerId: intruder, menuId }), false);
    assert.equal(await deleteMenu(deps, { ownerId: owner, menuId: 'not-an-id' }), false);
    assert.equal(store.files.has(created.menu.fileKey), true);
  });

  test("listing returns only the owner's menus, newest first", async () => {
    const listOwner = new ObjectId();
    await createMenu(deps, { ownerId: listOwner, name: 'Lunch', pdf: pdfBytes() });
    await createMenu(deps, { ownerId: listOwner, name: 'Dinner', pdf: pdfBytes() });
    const names = (await listMenus(deps, listOwner)).map((menu) => menu.name);
    assert.deepEqual(names, ['Dinner', 'Lunch']);
  });
});
