// End-to-end tests: run the production build (`next start`) and use it over HTTP like a browser
// without JavaScript. Next.js forms work without JavaScript, so the real Server Actions run here.
// Requires `npm run build` first (npm run verify does this).
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import QRCode from 'qrcode';
import { createTestDatabase, pdfBytes, TEST_MONGODB_URI } from './helpers';

const PUBLIC_URL = 'https://menus.example.com';

let db: Awaited<ReturnType<typeof createTestDatabase>>;
let server: ChildProcess;
let serverLog = '';
let baseUrl: string;
let uploadsDir: string;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
    probe.on('error', reject);
  });
}

before(async () => {
  assert.ok(fs.existsSync('.next/BUILD_ID'), 'Run `npm run build` before the end-to-end tests');
  db = await createTestDatabase();
  uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'menuqr-e2e-'));
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;

  // Real environment variables override .env, so the server only ever sees the test database and a temp folder.
  server = spawn(path.join('node_modules', '.bin', 'next'), ['start', '-p', String(port), '-H', '127.0.0.1'], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      MONGODB_URI: TEST_MONGODB_URI,
      MONGODB_DB: db.name,
      STORAGE_DRIVER: 'local',
      LOCAL_STORAGE_DIR: uploadsDir,
      PUBLIC_URL,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout?.on('data', (chunk) => (serverLog += chunk));
  server.stderr?.on('data', (chunk) => (serverLog += chunk));

  for (let attempt = 0; ; attempt++) {
    try {
      if ((await fetch(`${baseUrl}/api/health`)).ok) break;
    } catch {
      // Not listening yet.
    }
    if (attempt > 100) throw new Error(`next start did not become ready:\n${serverLog}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
});

after(async () => {
  server?.kill();
  await db?.drop();
  if (uploadsDir) fs.rmSync(uploadsDir, { recursive: true, force: true });
});

// ---------- A tiny browser ----------

function decodeHtml(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&#x27;', "'")
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

/** Hidden inputs of every <form> on the page: these identify the Server Action to run. */
function hiddenFields(html: string): Array<Array<[string, string]>> {
  return [...html.matchAll(/<form[^>]*>([\s\S]*?)<\/form>/g)].map(([, body]) =>
    [...body.matchAll(/<input type="hidden"([^>]*)\/?>/g)].map(([, attrs]) => {
      const name = /name="([^"]*)"/.exec(attrs)?.[1] ?? '';
      const value = /value="([^"]*)"/.exec(attrs)?.[1] ?? '';
      return [decodeHtml(name), decodeHtml(value)] as [string, string];
    }),
  );
}

class Browser {
  cookies = new Map<string, string>();

  async get(pathname: string) {
    return this.request(pathname);
  }

  async request(pathname: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    if (this.cookies.size) {
      headers.set('cookie', [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; '));
    }
    const response = await fetch(`${baseUrl}${pathname}`, {
      ...init,
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000), // Fail fast instead of hanging CI.
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const index = pair.indexOf('=');
      const name = pair.slice(0, index);
      const value = pair.slice(index + 1);
      if (!value || /expires=Thu, 01 Jan 1970/i.test(cookie)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return response;
  }

  /** Loads a page, fills in form number `formIndex` and submits it, like a browser with JavaScript off. */
  async submit(
    pathname: string,
    formIndex: number,
    fields: Record<string, string | { data: Buffer; name: string }>,
    options: { origin?: string } = {},
  ) {
    const html = await (await this.get(pathname)).text();
    const forms = hiddenFields(html);
    assert.ok(forms[formIndex], `form #${formIndex} not found on ${pathname}`);

    const body = new FormData();
    for (const [name, value] of forms[formIndex]) body.append(name, value);
    for (const [name, value] of Object.entries(fields)) {
      if (typeof value === 'string') body.append(name, value);
      else body.append(name, new Blob([new Uint8Array(value.data)], { type: 'application/pdf' }), value.name);
    }
    return this.request(pathname, {
      method: 'POST',
      body,
      headers: { origin: options.origin ?? baseUrl },
    });
  }
}

// Forms on each page, in order: the site header's "Log out" form comes first when signed in.
const FORM = { signup: 0, login: 0, logout: 0, upload: 1 } as const;

let userCounter = 0;
async function signedInBrowser() {
  const browser = new Browser();
  const email = `owner${++userCounter}@example.com`;
  const response = await browser.submit('/signup', FORM.signup, {
    email,
    password: 'correct horse battery',
    confirmPassword: 'correct horse battery',
  });
  assert.equal(response.status, 303, `sign up should redirect\n${serverLog}`);
  assert.equal(response.headers.get('location'), '/dashboard');
  return { browser, email };
}

async function uploadMenu(browser: Browser, name: string, data = pdfBytes(name)) {
  const response = await browser.submit('/dashboard', FORM.upload, { name, pdf: { data, name: 'menu.pdf' } });
  assert.equal(response.status, 200, `upload should succeed\n${serverLog}`);
  const menu = await db.collections.menus.findOne({ name });
  assert.ok(menu, 'menu should be saved');
  return menu;
}

// ---------- Tests ----------

test('GET /api/health returns a healthy response', async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
});

test('home page renders with the sign-up call to action', async () => {
  const response = await fetch(baseUrl);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Turn your PDF menu into a QR code/);
});

describe('accounts', () => {
  test('signing up logs you in and opens the dashboard', async () => {
    const { browser } = await signedInBrowser();
    assert.ok(browser.cookies.has('sid'));
    const dashboard = await browser.get('/dashboard');
    assert.equal(dashboard.status, 200);
    assert.match(await dashboard.text(), /My menus/);
  });

  test('shows a validation error for short passwords', async () => {
    const response = await new Browser().submit('/signup', FORM.signup, { email: 'short@example.com', password: 'abc', confirmPassword: 'abc' });
    assert.match(await response.text(), /Password must be 8–200 characters/);
  });

  test('shows an error when the passwords do not match', async () => {
    const browser = new Browser();
    const response = await browser.submit('/signup', FORM.signup, {
      email: 'mismatch@example.com',
      password: 'correct horse battery',
      confirmPassword: 'something else',
    });
    assert.match(await response.text(), /Passwords do not match/);
    assert.equal(browser.cookies.has('sid'), false);
    assert.equal(await db.collections.users.countDocuments({ email: 'mismatch@example.com' }), 0);
  });

  test('wrong password is rejected; logging out ends the session on the server', async () => {
    const { browser: first, email } = await signedInBrowser();
    await first.submit('/dashboard', FORM.logout, {});

    const browser = new Browser();
    const wrong = await browser.submit('/login', FORM.login, { email, password: 'wrong password' });
    assert.match(await wrong.text(), /Incorrect email or password/);
    assert.equal(browser.cookies.has('sid'), false);

    const right = await browser.submit('/login', FORM.login, { email, password: 'correct horse battery' });
    assert.equal(right.status, 303);
    const copiedCookie = browser.cookies.get('sid')!;

    const logout = await browser.submit('/dashboard', FORM.logout, {});
    assert.equal(logout.status, 303);
    assert.equal(browser.cookies.has('sid'), false);

    // The old cookie no longer works, because the session was deleted server-side.
    const replay = new Browser();
    replay.cookies.set('sid', copiedCookie);
    const response = await replay.get('/dashboard');
    assert.equal(response.status, 307);
    assert.equal(response.headers.get('location'), '/login');
  });

  test('the dashboard requires login', async () => {
    const response = await new Browser().get('/dashboard');
    assert.equal(response.status, 307);
    assert.equal(response.headers.get('location'), '/login');
  });

  test('blocks form submissions from other websites', async () => {
    const response = await new Browser().submit(
      '/login',
      FORM.login,
      { email: 'a@example.com', password: 'whatever' },
      { origin: 'https://evil.example' },
    );
    assert.ok(response.status >= 400, `expected a rejection, got ${response.status}`);
  });
});

describe('menus', () => {
  test('uploading a PDF creates a public menu page, PDF and QR code', async () => {
    const { browser } = await signedInBrowser();
    const pdf = pdfBytes('river cafe');
    const menu = await uploadMenu(browser, 'River Café', pdf);

    const dashboard = await (await browser.get('/dashboard')).text();
    assert.match(dashboard, new RegExp(`${PUBLIC_URL}/m/${menu.slug}`));

    // Guests (not signed in) can open everything.
    const guest = new Browser();
    const page = await guest.get(`/m/${menu.slug}`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /River Café/);
    assert.match(html, new RegExp(`/m/${menu.slug}/menu.pdf\\?v=${menu.updatedAt.getTime()}`));

    const versioned = await guest.get(`/m/${menu.slug}/menu.pdf?v=${menu.updatedAt.getTime()}`);
    assert.equal(versioned.headers.get('content-type'), 'application/pdf');
    assert.match(versioned.headers.get('cache-control') ?? '', /immutable/);
    assert.deepEqual(Buffer.from(await versioned.arrayBuffer()), pdf);

    const unversioned = await guest.get(`/m/${menu.slug}/menu.pdf`);
    assert.equal(unversioned.headers.get('cache-control'), 'no-cache');
    await unversioned.body?.cancel();

    const qr = await guest.get(`/m/${menu.slug}/qr`);
    assert.match(qr.headers.get('content-type') ?? '', /^image\/svg\+xml/);
    const expected = await QRCode.toString(`${PUBLIC_URL}/m/${menu.slug}`, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 2,
    });
    assert.equal(await qr.text(), expected, 'QR code should encode the public menu URL');

    const download = await guest.get(`/m/${menu.slug}/qr?download=1`);
    assert.match(download.headers.get('content-disposition') ?? '', /attachment/);
    await download.body?.cancel();
  });

  test('shows an error for files that are not PDFs', async () => {
    const { browser } = await signedInBrowser();
    const response = await browser.submit('/dashboard', FORM.upload, {
      name: 'Not a PDF',
      pdf: { data: Buffer.from('<html>hi</html>'), name: 'menu.pdf' },
    });
    assert.match(await response.text(), /Please choose a PDF file/);
    assert.equal(await db.collections.menus.countDocuments({ name: 'Not a PDF' }), 0);
  });

  test('React escapes menu names', async () => {
    const { browser } = await signedInBrowser();
    const menu = await uploadMenu(browser, '<script>alert(1)</script>');
    const html = await (await new Browser().get(`/m/${menu.slug}`)).text();
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  });

  test('replace and delete work through the dashboard forms', async () => {
    const { browser } = await signedInBrowser();
    const menu = await uploadMenu(browser, 'Lunch Specials');
    // Dashboard forms: 0 logout, 1 upload, then per menu: replace, delete.
    const newPdf = pdfBytes('new version');

    const replaced = await browser.submit('/dashboard', 2, { pdf: { data: newPdf, name: 'new.pdf' } });
    assert.equal(replaced.status, 200);
    const updated = await db.collections.menus.findOne({ _id: menu._id });
    assert.equal(updated?.slug, menu.slug);
    const file = await new Browser().get(`/m/${menu.slug}/menu.pdf`);
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), newPdf);

    await browser.submit('/dashboard', 3, {});
    assert.equal(await db.collections.menus.countDocuments({ _id: menu._id }), 0);
    assert.equal((await new Browser().get(`/m/${menu.slug}`)).status, 404);
  });

  test('unknown menus return 404', async () => {
    const page = await new Browser().get('/m/does-not-exist');
    assert.equal(page.status, 404);
    await page.body?.cancel();
    const qr = await new Browser().get('/m/does-not-exist/qr');
    assert.equal(qr.status, 404);
  });
});
