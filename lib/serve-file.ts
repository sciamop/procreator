import { open, stat } from 'node:fs/promises';

/** Native video seeking uses byte ranges; stream the file instead of buffering it. */
export async function serveFile(file: string, request: Request, contentType: string, filename?: string) {
  const { size } = await stat(file);
  const headers: Record<string, string> = { 'Content-Type': contentType, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=0', 'X-Content-Type-Options': 'nosniff' };
  if (filename) headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(filename).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16)}`)}`;
  let start = 0, end = size - 1;
  const range = request.headers.get('range');
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
    if (!match[1]) start = Math.max(0, size - Number(match[2]));
    else { start = Number(match[1]); if (match[2]) end = Math.min(Number(match[2]), size - 1); }
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  }
  headers['Content-Length'] = String(Math.max(0, end - start + 1));
  if (!size) return new Response(null, { headers });
  const handle = await open(file, 'r');
  let position = start;
  let closed = false;
  async function close() { if (!closed) { closed = true; await handle.close(); } }
  // A browser cancels an in-flight range when seeking. Guard the completion of
  // each read so it never enqueues into an already-cancelled Web stream.
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (closed) return;
      try {
        const chunk = Buffer.alloc(Math.min(64 * 1024, end - position + 1));
        const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
        if (closed) return;
        if (!bytesRead) { controller.close(); await close(); return; }
        position += bytesRead;
        controller.enqueue(new Uint8Array(chunk.buffer, chunk.byteOffset, bytesRead));
        if (position > end) { controller.close(); await close(); }
      } catch (error) { if (!closed) controller.error(error); await close(); }
    },
    cancel: close,
  });
  return new Response(stream, { status: range ? 206 : 200, headers });
}
