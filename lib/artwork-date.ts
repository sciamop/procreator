import yauzl, { type Entry } from 'yauzl';

const QUICKTIME_EPOCH = 2_082_844_800;
export function validArtworkDate(value: number) {
  return Number.isFinite(value) && value >= Date.UTC(2000, 0, 1) && value <= Date.now() + 86400_000;
}

/** Read the movie header's creation time (seconds since 1904), not export time. */
export function movieCreationDate(data: Buffer): number | null {
  function boxes(start: number, end: number): number | null {
    for (let offset = start; offset + 8 <= end;) {
      let size = data.readUInt32BE(offset);
      const type = data.toString('ascii', offset + 4, offset + 8);
      let header = 8;
      if (size === 1) {
        if (offset + 16 > end) return null;
        size = Number(data.readBigUInt64BE(offset + 8)); header = 16;
      } else if (size === 0) size = end - offset;
      if (!Number.isSafeInteger(size) || size < header) return null;
      const body = offset + header, stop = Math.min(offset + size, end);
      if (type === 'moov') {
        const date = boxes(body, stop);
        if (date !== null) return date;
      } else if (type === 'mvhd' && body + 8 <= stop) {
        const version = data[body];
        const seconds = version === 0 ? data.readUInt32BE(body + 4) : version === 1 && body + 12 <= stop ? Number(data.readBigUInt64BE(body + 4)) : NaN;
        const date = (seconds - QUICKTIME_EPOCH) * 1000;
        if (validArtworkDate(date)) return date;
      }
      offset += size;
    }
    return null;
  }
  return boxes(0, data.length);
}

// Procreate recordings have a fast-start movie header. Read at most 256 KiB,
// leaving video payloads compressed and avoiding full video extraction to sort.
function recordingPrefix(file: string, member: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(error || new Error('Unreadable archive'));
      let settled = false;
      const finish = (data?: Buffer, error?: Error) => {
        if (settled) return;
        settled = true; zip.close();
        if (error) reject(error); else resolve(data || Buffer.alloc(0));
      };
      zip.on('error', error => finish(undefined, error));
      zip.on('end', () => finish());
      zip.on('entry', (entry: Entry) => {
        if (entry.fileName !== member) return zip.readEntry();
        zip.openReadStream(entry, (error, stream) => {
          if (error || !stream) return finish(undefined, error || new Error('Unreadable recording'));
          const chunks: Buffer[] = [];
          let bytes = 0;
          const limit = 256 * 1024;
          stream.on('error', error => finish(undefined, error));
          stream.on('data', (chunk: Buffer) => {
            const part = chunk.subarray(0, limit - bytes);
            chunks.push(part); bytes += part.length;
            if (bytes >= limit) { stream.destroy(); finish(Buffer.concat(chunks)); }
          });
          stream.on('end', () => finish(Buffer.concat(chunks)));
        });
      });
      zip.readEntry();
    });
  });
}

export type ArtworkDate = { date: number; dateSource: 'recording' | 'archive' | 'filesystem' };
const cache = new Map<string, ArtworkDate>();
export async function embeddedArtworkDate(file: string, version: string, entries: Entry[], modified: number): Promise<ArtworkDate> {
  const key = `${file}:${version}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const recordings = entries.filter(entry => /^video\/.*\.(mp4|mov|m4v)$/i.test(entry.fileName)).sort((a, b) => a.fileName.localeCompare(b.fileName, 'en', { numeric: true }));
  let result: ArtworkDate = { date: modified, dateSource: 'filesystem' };
  const saved = entries.find(entry => entry.fileName === 'Document.archive')?.getLastModDate().getTime();
  if (saved && validArtworkDate(saved)) result = { date: saved, dateSource: 'archive' };
  const recordingDates = recordings.map(entry => entry.getLastModDate().getTime()).filter(validArtworkDate);
  if (recordingDates.length) result = { date: Math.min(...recordingDates), dateSource: 'recording' };
  if (recordings.length) {
    try {
      const date = movieCreationDate(await recordingPrefix(file, recordings[0].fileName));
      if (date !== null) result = { date, dateSource: 'recording' };
    } catch { /* Keep the embedded ZIP date when the movie header is unavailable. */ }
  }
  if (cache.size >= 2000) cache.delete(cache.keys().next().value!);
  cache.set(key, result);
  return result;
}
