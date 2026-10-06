import { getLayerPreview, LayerError } from '@/lib/layers';
export const runtime = 'nodejs';
export async function GET(request: Request, { params }: { params: Promise<{ id: string; layerId: string }> }) {
  try {
    const { id, layerId } = await params;
    const { buffer, etag } = await getLayerPreview(id, layerId);
    const headers = { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=60', ETag: etag, 'X-Content-Type-Options': 'nosniff' };
    if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
    return new Response(new Uint8Array(buffer), { headers });
  } catch (error) { return Response.json({ error: error instanceof LayerError ? error.message : 'This layer could not be decoded.' }, { status: 422 }); }
}
