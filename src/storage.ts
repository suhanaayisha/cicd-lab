import {
  DeleteObjectCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

// Uploaded menus live in S3 as menu/<version>/page-N.jpg plus the source PDF.
// menu/current.json points at the live version, so a new menu only goes live
// once every page has been uploaded. Versioned keys never change, which lets
// browsers cache the images forever.
export interface Menu {
  version: string;
  pages: number;
}

const MANIFEST_KEY = 'menu/current.json';

let client: S3Client | undefined;
let cachedMenu: Menu | null | undefined;

function bucket(): string | undefined {
  return process.env.S3_BUCKET || undefined;
}

export function isStorageConfigured(): boolean {
  return bucket() !== undefined;
}

function s3(): S3Client {
  // Credentials and region come from the standard AWS_* environment variables.
  // S3_ENDPOINT allows S3-compatible services such as Cloudflare R2 or MinIO.
  client ??= new S3Client({
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: Boolean(process.env.S3_ENDPOINT),
    // Newer SDKs add checksum headers by default, which S3-compatible
    // services like R2 don't fully support.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  return client;
}

export function pageKey(version: string, pageNumber: number): string {
  return `menu/${version}/page-${pageNumber}.jpg`;
}

// The live uploaded menu, or null if nothing has been uploaded yet.
export async function currentMenu(): Promise<Menu | null> {
  if (!isStorageConfigured()) return null;
  if (cachedMenu !== undefined) return cachedMenu;

  try {
    const object = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: MANIFEST_KEY }));
    cachedMenu = JSON.parse(await object.Body!.transformToString()) as Menu;
  } catch (error) {
    if (!(error instanceof NoSuchKey)) throw error;
    cachedMenu = null;
  }
  return cachedMenu;
}

export async function publishMenu(pdf: Buffer, pages: Buffer[]): Promise<Menu> {
  const previous = await currentMenu();
  const menu: Menu = { version: Date.now().toString(), pages: pages.length };
  const put = (Key: string, Body: Buffer | string, ContentType: string) =>
    s3().send(new PutObjectCommand({ Bucket: bucket(), Key, Body, ContentType }));

  await Promise.all([
    put(`menu/${menu.version}/document.pdf`, pdf, 'application/pdf'),
    ...pages.map((page, index) => put(pageKey(menu.version, index + 1), page, 'image/jpeg')),
  ]);
  await put(MANIFEST_KEY, JSON.stringify(menu), 'application/json');
  cachedMenu = menu;

  if (previous) {
    const keys = [`menu/${previous.version}/document.pdf`];
    for (let pageNumber = 1; pageNumber <= previous.pages; pageNumber++) {
      keys.push(pageKey(previous.version, pageNumber));
    }
    await Promise.all(
      keys.map((Key) => s3().send(new DeleteObjectCommand({ Bucket: bucket(), Key }))),
    ).catch((error) => console.error('Could not delete old menu files:', error));
  }

  return menu;
}

export async function getPage(version: string, pageNumber: number) {
  try {
    const object = await s3().send(
      new GetObjectCommand({ Bucket: bucket(), Key: pageKey(version, pageNumber) }),
    );
    return object.Body!;
  } catch (error) {
    if (error instanceof NoSuchKey) return null;
    throw error;
  }
}
