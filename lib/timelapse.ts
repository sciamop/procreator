import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, stat, writeFile, rm, rename, readdir } from 'node:fs/promises';
import path from 'node:path';
import ffmpeg from 'ffmpeg-static';
import { getArtwork, isVideo, natural, readArchive } from './archive';
import { cacheDirectory, cacheLimit } from './config';

const cacheRoot = path.join(cacheDirectory(), 'timelapses');
type Job = { state: 'preparing' | 'ready' | 'error'; error?: string };
const jobs = new Map<string, Job>();
// Keep large archives from exhausting memory or monopolizing the machine.
let queue: Promise<void> = Promise.resolve();

async function destination(id: string) {
  const { file, item } = await getArtwork(id);
  const info = await stat(file);
  const key = createHash('sha256').update(`${file}:${info.size}:${info.mtimeMs}:v1`).digest('hex');
  return { file, item, key, output: path.join(cacheRoot, `${key}.mp4`) };
}

function runFFmpeg(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    if (!ffmpeg) return reject(new Error('Video processor is unavailable'));
    const child = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], { timeout: 15 * 60_000 });
    let error = '';
    child.stderr.on('data', chunk => { error = (error + String(chunk)).slice(-2000); });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(error || 'Video preparation failed')));
  });
}

async function trimCache(keep: string) {
  const files = await readdir(cacheRoot);
  const cached = await Promise.all(files.filter(name => name.endsWith('.mp4')).map(async name => {
    const file = path.join(cacheRoot, name); const info = await stat(file);
    return { file, size: info.size, time: info.mtimeMs };
  }));
  let total = cached.reduce((n, file) => n + file.size, 0);
  for (const file of cached.sort((a, b) => a.time - b.time)) {
    if (total <= cacheLimit()) break;
    if (file.file === keep) continue;
    await rm(file.file, { force: true }); total -= file.size;
  }
}

async function prepare(file: string, key: string, output: string) {
  const work = path.join(cacheRoot, key);
  await mkdir(work, { recursive: true });
  try {
    const { entries } = await readArchive(file, () => false);
    const segments = entries.filter(entry => isVideo(entry.fileName)).sort((a, b) => natural.compare(a.fileName, b.fileName));
    if (!segments.length) throw new Error('No time-lapse recording');
    const playlist: string[] = [];
    let h264 = true;
    for (let i = 0; i < segments.length; i++) {
      const { data } = await readArchive(file, name => name === segments[i].fileName, 256 * 1024 * 1024);
      const bytes = data.get(segments[i].fileName)!;
      const name = `${i}.mp4`;
      await writeFile(path.join(work, name), bytes);
      h264 &&= bytes.includes(Buffer.from('avc1'));
      playlist.push(`file '${name}'`);
    }
    await writeFile(path.join(work, 'segments.txt'), playlist.join('\n'));
    const input = ['-f', 'concat', '-safe', '1', '-i', path.join(work, 'segments.txt'), '-map', '0:v:0', '-an'];
    const temporary = path.join(work, 'joined.mp4');
    const transcode = () => runFFmpeg([...input, '-vf', 'scale=1920:1920:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-threads', '2', '-movflags', '+faststart', temporary]);
    if (h264) {
      try { await runFFmpeg([...input, '-c:v', 'copy', '-movflags', '+faststart', temporary]); }
      catch { await transcode(); }
    } else await transcode();
    await rename(temporary, output);
    await trimCache(output).catch(() => {});
  } finally { await rm(work, { recursive: true, force: true }); }
}

export async function getTimelapseStatus(id: string, retry = false): Promise<Job> {
  const { file, item, key, output } = await destination(id);
  if (!item.segments) return { state: 'error', error: 'This artwork has no time-lapse recording.' };
  if (await stat(output).then(s => s.size > 0).catch(() => false)) return { state: 'ready' };
  const existing = jobs.get(key);
  if (existing && (existing.state === 'preparing' || (existing.state === 'error' && !retry))) return existing;
  const job: Job = { state: 'preparing' };
  jobs.set(key, job);
  queue = queue.catch(() => {}).then(async () => {
    try { await prepare(file, key, output); job.state = 'ready'; }
    catch (error) {
      console.error('Time-lapse preparation failed:', item.filename, error);
      job.state = 'error'; job.error = 'This recording could not be prepared. Try again or download the original.';
    }
  });
  return job;
}

export async function getTimelapseFile(id: string) {
  const result = await destination(id);
  await stat(result.output);
  return result;
}
