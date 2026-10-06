import type { NextConfig } from 'next';
import { networkInterfaces } from 'node:os';

function localAddresses(): string[] {
  try {
    return Object.values(networkInterfaces()).flatMap(interfaces =>
      (interfaces || []).filter(address => address.family === 'IPv4').map(address => address.address),
    );
  } catch { return []; }
}

const addresses = localAddresses();

const config: NextConfig = {
  agentRules: false,
  // Use the TypeScript 5 compiler API, including Next's custom type checks.
  experimental: { useTypeScriptCli: false },
  devIndicators: false,
  allowedDevOrigins: ['localhost', ...addresses, ...(process.env.DEV_ALLOWED_HOSTS || '').split(',').map(host => host.trim()).filter(Boolean)],
  serverExternalPackages: ['yauzl', 'bplist-parser', 'sharp', 'ffmpeg-static', 'better-sqlite3'],
};
export default config;
