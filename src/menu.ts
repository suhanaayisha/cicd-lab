import { createCanvas } from '@napi-rs/canvas';
import { createRequire } from 'node:module';
import path from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const TARGET_WIDTH = 1600;
const JPEG_QUALITY = 82;

// pdfjs needs its bundled fonts and maps for PDFs that don't embed them.
const pdfjsDir = path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
const assetDir = (name: string) => path.join(pdfjsDir, name) + path.sep;

// Renders every page of the PDF to a JPEG, in page order.
export async function renderMenu(pdf: Uint8Array): Promise<Buffer[]> {
  const loadingTask = getDocument({
    data: pdf,
    cMapUrl: assetDir('cmaps'),
    standardFontDataUrl: assetDir('standard_fonts'),
    wasmUrl: assetDir('wasm'),
    iccUrl: assetDir('iccs'),
  });
  const document = await loadingTask.promise;

  try {
    const pages: Buffer[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const unscaled = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: TARGET_WIDTH / unscaled.width });
      const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height));

      await page.render({
        canvas: canvas as unknown as HTMLCanvasElement,
        viewport,
        background: 'white',
      }).promise;

      pages.push(await canvas.encode('jpeg', JPEG_QUALITY));
      page.cleanup();
    }
    return pages;
  } finally {
    await loadingTask.destroy();
  }
}
