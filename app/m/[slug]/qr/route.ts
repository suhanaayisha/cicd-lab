import QRCode from 'qrcode';
import { getCollections } from '@/lib/db';
import { findMenuBySlug } from '@/lib/menus';
import { getStore } from '@/lib/storage';
import { publicBaseUrl } from '../../../_lib/url';

// The QR code links to the menu page, not the PDF, so it keeps working after the PDF is replaced.
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const menu = await findMenuBySlug({ collections: await getCollections(), store: getStore() }, (await params).slug);
  if (!menu) return new Response('Menu not found', { status: 404 });

  const svg = await QRCode.toString(`${publicBaseUrl(request.headers)}/m/${menu.slug}`, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 2,
  });

  const headers = new Headers({ 'Content-Type': 'image/svg+xml; charset=utf-8' });
  if (new URL(request.url).searchParams.has('download')) {
    headers.set('Content-Disposition', `attachment; filename="${menu.slug}-qr.svg"`);
  }
  return new Response(svg, { headers });
}
