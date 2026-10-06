import { createRequire } from 'node:module';
const { loadEnvConfig } = createRequire(import.meta.url)('@next/env');

export function serverConfig(mode = 'start', directory = process.cwd()) {
  loadEnvConfig(directory, mode === 'dev');
  const port = Number(process.env.APP_PORT || '3042');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('APP_PORT must be an integer between 1 and 65535.');
  const host = process.env.APP_HOST?.trim() || '0.0.0.0';
  if (/[\s/]/.test(host)) throw new Error('APP_HOST must be a hostname or IP address, without a URL scheme.');
  return { port, host };
}
