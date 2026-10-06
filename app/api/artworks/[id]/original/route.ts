import { getArtwork } from '@/lib/archive';
import { serveFile } from '@/lib/serve-file';
export const runtime = 'nodejs';
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { file, item } = await getArtwork((await params).id);
    return await serveFile(file, request, 'application/octet-stream', item.filename);
  } catch { return Response.json({ error: 'Artwork not found' }, { status: 404 }); }
}
