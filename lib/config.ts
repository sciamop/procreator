import path from 'node:path';

export class ConfigurationError extends Error {}
export function configuredPath(name: string, fallback?: string) {
  const value = process.env[name]?.trim() || fallback;
  if (!value) throw new ConfigurationError(`Set ${name} in .env.local, then restart the gallery.`);
  return path.resolve(value);
}
export const dataDirectory = () => configuredPath('DATA_DIR', './data');
export const cacheDirectory = () => configuredPath('CACHE_DIR', './.cache');
export function catalogRefreshInterval() {
  const seconds = Number(process.env.CATALOG_REFRESH_SECONDS || '60');
  if (!Number.isFinite(seconds) || seconds < 1) throw new ConfigurationError('CATALOG_REFRESH_SECONDS must be at least 1.');
  return seconds * 1000;
}
export function taggingEngine(): 'none' | 'ram++' | 'custom' {
  const engine = process.env.TAGGING_ENGINE?.trim() || 'none';
  if (engine !== 'none' && engine !== 'ram++' && engine !== 'custom') throw new ConfigurationError('TAGGING_ENGINE must be none, ram++, or custom.');
  return engine;
}
export function cacheLimit() {
  const value = Number(process.env.TIMELAPSE_CACHE_GB || '2');
  if (!Number.isFinite(value) || value <= 0) throw new ConfigurationError('TIMELAPSE_CACHE_GB must be a positive number.');
  return value * 1024 ** 3;
}
