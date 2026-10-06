import { getTimelapseStatus } from '@/lib/timelapse';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const status = await getTimelapseStatus((await params).id, new URL(request.url).searchParams.get('retry') === '1');
    return Response.json(status, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return Response.json({ state: 'error', error: 'Artwork unavailable. Refresh the archive and try again.' }, { status: 404 }); }
}
