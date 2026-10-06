import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { serverConfig } from './server-config.mjs';

const mode = process.argv[2];
if (!['dev', 'start'].includes(mode)) throw new Error('Usage: node scripts/server.mjs dev|start');
const { host, port } = serverConfig(mode);
const require = createRequire(import.meta.url);
const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), mode, '--hostname', host, '--port', String(port), ...process.argv.slice(3)], { stdio: 'inherit', env: process.env });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 143); });
