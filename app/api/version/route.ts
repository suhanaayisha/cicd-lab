import { getConfig } from '@/lib/config';

export function GET() {
  return Response.json({ version: getConfig().appVersion });
}

// Answer at request time, never from a build-time snapshot.
export const dynamic = 'force-dynamic';
