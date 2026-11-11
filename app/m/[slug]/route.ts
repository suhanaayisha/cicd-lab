import { getCollections } from '@/lib/db';
import { findMenuBySlug, versionedPdfPath } from '@/lib/menus';
import { getStore } from '@/lib/storage';

// The QR code points here. Guests are sent straight to the PDF, so their phone opens it in its
// own viewer. The redirect target includes ?v=<last update>, so a replaced PDF shows up at once.
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const menu = await findMenuBySlug({ collections: await getCollections(), store: getStore() }, (await params).slug);
  if (!menu) return new Response('Menu not found', { status: 404 });

  return new Response(null, {
    status: 302,
    headers: { Location: versionedPdfPath(menu), 'Cache-Control': 'no-store' },
  });
}
