import { startTagging, taggingStatus } from '@/lib/tags';
import { ConfigurationError } from '@/lib/config';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try { return Response.json(await taggingStatus(), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return Response.json({ error: error instanceof ConfigurationError ? error.message : 'Tagging status could not be read.' }, { status: 500 }); }
}

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (origin) {
    try {
      if (new URL(origin).host !== request.headers.get('host') && new URL(origin).host !== new URL(request.url).host) throw new Error('Origin mismatch');
    } catch { return Response.json({ error: 'Use the gallery to start tagging.' }, { status: 403 }); }
  }
  try { return Response.json(await startTagging(), { status: 202 }); }
  catch (error) {
    console.error('Could not start tagger:', error);
    return Response.json({ error: error instanceof ConfigurationError ? error.message : 'The tagger could not start. Check tagging configuration and the server log.' }, { status: error instanceof ConfigurationError ? 400 : 503 });
  }
}
