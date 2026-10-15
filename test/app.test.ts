import assert from 'node:assert/strict';
import type { Server } from 'http';
import { after, before, test } from 'node:test';
import app from '../src/app.js';

let server: Server;
let baseUrl: string;

before(async () => {
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, '127.0.0.1', (error?: Error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  const address = server.address();

  if (!address || typeof address === 'string') {
    throw new Error('Could not determine the test server port');
  }

  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(() => {
  server.close();
});

test('GET /api/health returns a healthy response', async () => {
  const response = await fetch(`${baseUrl}/api/health`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: 'ok',
  });
});

test('PUT /api/menu is disabled without ADMIN_TOKEN', async () => {
  delete process.env.ADMIN_TOKEN;
  const response = await fetch(`${baseUrl}/api/menu`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/pdf' },
    body: '%PDF-',
  });

  assert.equal(response.status, 503);
});

test('PUT /api/menu rejects a wrong admin token', async () => {
  process.env.ADMIN_TOKEN = 'secret';
  const response = await fetch(`${baseUrl}/api/menu`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/pdf', Authorization: 'Bearer wrong' },
    body: '%PDF-',
  });

  assert.equal(response.status, 401);
});

test('PUT /api/menu rejects a body that is not a PDF', async () => {
  process.env.ADMIN_TOKEN = 'secret';
  const response = await fetch(`${baseUrl}/api/menu`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/pdf', Authorization: 'Bearer secret' },
    body: 'not a pdf',
  });

  assert.equal(response.status, 400);
});

test('PUT /api/menu is disabled without S3_BUCKET', async () => {
  process.env.ADMIN_TOKEN = 'secret';
  delete process.env.S3_BUCKET;
  const response = await fetch(`${baseUrl}/api/menu`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/pdf', Authorization: 'Bearer secret' },
    body: '%PDF-1.4',
  });

  assert.equal(response.status, 503);
});

test('GET / shows the bundled menu when nothing has been uploaded', async () => {
  delete process.env.S3_BUCKET;
  const html = await (await fetch(`${baseUrl}/`)).text();

  assert.match(html, /src="\/menu\/page-1\.jpg"/);
});
