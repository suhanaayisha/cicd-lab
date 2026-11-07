'use client';

import { useEffect, useRef, useState } from 'react';

type Status = 'loading' | 'ready' | 'error';

/** Renders every page of the menu PDF onto canvases with PDF.js, so guests never need a PDF viewer. */
export function MenuViewer({ pdfUrl }: { pdfUrl: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [pageCount, setPageCount] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    let destroy: (() => Promise<void>) | undefined;

    (async () => {
      // Loaded in the browser only; PDF.js is too large to include in the initial page bundle.
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

      const task = pdfjs.getDocument({ url: pdfUrl });
      destroy = () => task.destroy();
      const pdf = await task.promise;
      if (cancelled) return;

      // Render at the displayed width times the screen's pixel density so text stays sharp.
      const cssWidth = Math.min(container.clientWidth || window.innerWidth, 1200);
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 3);

      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;
        const scale = (cssWidth / page.getViewport({ scale: 1 }).width) * pixelRatio;
        const viewport = page.getViewport({ scale });

        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', `Menu page ${pageNumber}`);
        container.append(canvas);

        await page.render({ canvas, viewport }).promise;
        setPageCount(pageNumber);
        // Show the first page as soon as it's ready instead of waiting for the whole menu.
        setStatus('ready');
      }
    })().catch((error) => {
      if (cancelled) return;
      console.error(error);
      setStatus('error');
    });

    return () => {
      cancelled = true;
      void destroy?.();
      container.replaceChildren();
    };
  }, [pdfUrl]);

  return (
    <>
      {status === 'loading' && <p className="loading">Loading menu…</p>}
      {status === 'error' && (
        <p className="error" role="alert">
          The menu could not be displayed. <a href={pdfUrl}>Open the PDF instead</a>
        </p>
      )}
      <div ref={containerRef} id="menu" data-status={status} data-pages={pageCount} />
    </>
  );
}
