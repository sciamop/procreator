import { getPreview } from '@/lib/archive';
export const runtime = 'nodejs';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { buffer, etag } = await getPreview((await params).id, new URL(request.url).searchParams.get('size') === 'thumb');
    const headers = { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=60', ETag: etag, 'X-Content-Type-Options': 'nosniff' };
    if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
    return new Response(new Uint8Array(buffer), { headers });
  } catch { return Response.json({ error: 'Preview unavailable' }, { status: 404 }); }
}
