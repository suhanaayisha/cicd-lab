import { getConfig } from '@/lib/config';

/**
 * The public base URL used in QR codes and links, e.g. https://menuqr.onrender.com.
 * PUBLIC_URL wins; otherwise it comes from the proxy headers Render (or any host) sends.
 */
export function publicBaseUrl(headers: Headers): string {
  const configured = getConfig().publicUrl;
  if (configured) return configured;
  const proto = headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'http';
  const host = headers.get('x-forwarded-host')?.split(',')[0]?.trim() || headers.get('host') || 'localhost:3000';
  return `${proto}://${host}`;
}
