import { getCollections } from '@/lib/db';
import { findMenuBySlug } from '@/lib/menus';
import { getStore } from '@/lib/storage';

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const store = getStore();
  const menu = await findMenuBySlug({ collections: await getCollections(), store }, (await params).slug);
  const pdf = menu && (await store.get(menu.fileKey));
  if (!menu || !pdf) return new Response('Menu not found', { status: 404 });

  // The menu page links to ?v=<last update>, which changes whenever the PDF is replaced,
  // so that URL can be cached for a long time. Other URLs are revalidated every time.
  const isVersioned = new URL(request.url).searchParams.get('v') === String(menu.updatedAt.getTime());
  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="menu.pdf"',
      'Cache-Control': isVersioned ? 'public, max-age=31536000, immutable' : 'no-cache',
    },
  });
}
