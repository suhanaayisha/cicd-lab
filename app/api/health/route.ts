export function GET() {
  return Response.json({ status: 'ok' });
}

// Answer at request time, never from a build-time snapshot.
export const dynamic = 'force-dynamic';
