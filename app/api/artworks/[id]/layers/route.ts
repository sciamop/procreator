import { getLayers, LayerError } from '@/lib/layers';
export const runtime = 'nodejs';
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { return Response.json(await getLayers((await params).id), { headers: { 'Cache-Control': 'private, max-age=60' } }); }
  catch (error) { return Response.json({ error: error instanceof LayerError ? error.message : 'Layer metadata could not be read.' }, { status: 422 }); }
}
