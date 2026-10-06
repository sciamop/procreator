import { getTimelapseFile } from '@/lib/timelapse';
import { serveFile } from '@/lib/serve-file';
export const runtime = 'nodejs';
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { output, item } = await getTimelapseFile((await params).id);
    return await serveFile(output, request, 'video/mp4', new URL(request.url).searchParams.has('download') ? `${item.name}-timelapse.mp4` : undefined);
  } catch { return Response.json({ error: 'Time-lapse is not ready yet.' }, { status: 404 }); }
}
