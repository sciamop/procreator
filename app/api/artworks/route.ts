import { getCatalog } from '@/lib/archive';
import { withTags } from '@/lib/tags';
import { ConfigurationError } from '@/lib/config';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const catalog = await withTags(await getCatalog(new URL(request.url).searchParams.get('refresh') === '1'));
    return Response.json({ items: catalog.items, indexedAt: catalog.indexedAt, refreshing: catalog.refreshing }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof ConfigurationError ? error.message : 'The archive could not be read. Check MEDIA_ROOT, DATA_DIR, and drive permissions, then refresh.' }, { status: 503 });
  }
}
