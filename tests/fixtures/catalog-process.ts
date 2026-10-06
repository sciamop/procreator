import { writeFile } from 'node:fs/promises';
import { getCatalog } from '../../lib/archive';

async function main() {
  const start = performance.now();
  const catalog = await getCatalog(process.argv.includes('--refresh'));
  await writeFile(process.argv[2], JSON.stringify({ catalog, elapsed: performance.now() - start }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
