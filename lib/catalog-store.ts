import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Artwork } from './types';

// Increment when saved metadata needs to be re-extracted after parser changes.
const FORMAT_VERSION = 1;
export type CatalogRecord = { relative: string; fingerprint: string; item: Artwork };
export type SavedCatalog = { records: CatalogRecord[]; scannedAt: number };

function open(file: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  try {
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS catalog_roots (
        root TEXT PRIMARY KEY, format_version INTEGER NOT NULL, scanned_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS catalog_entries (
        root TEXT NOT NULL, relative_path TEXT NOT NULL, fingerprint TEXT NOT NULL, artwork TEXT NOT NULL,
        PRIMARY KEY (root, relative_path)
      );
    `);
    return db;
  } catch (error) { db.close(); throw error; }
}

export function readCatalog(file: string, root: string): SavedCatalog | undefined {
  const db = open(file);
  try {
    return db.transaction(() => {
      const metadata = db.prepare('SELECT format_version, scanned_at FROM catalog_roots WHERE root = ?').get(root) as { format_version: number; scanned_at: number } | undefined;
      if (metadata?.format_version !== FORMAT_VERSION) return undefined;
      const rows = db.prepare('SELECT relative_path, fingerprint, artwork FROM catalog_entries WHERE root = ?').all(root) as { relative_path: string; fingerprint: string; artwork: string }[];
      const records = rows.map(row => {
        if (path.isAbsolute(row.relative_path) || row.relative_path.split(path.sep).includes('..')) throw new Error('Invalid saved artwork path');
        return { relative: row.relative_path, fingerprint: row.fingerprint, item: JSON.parse(row.artwork) as Artwork };
      });
      return { records, scannedAt: metadata.scanned_at };
    })();
  } finally { db.close(); }
}

/** Replace a root's snapshot atomically only after its entire scan succeeds. */
export function writeCatalog(file: string, root: string, catalog: SavedCatalog) {
  const db = open(file);
  try {
    db.transaction(() => {
      db.prepare('DELETE FROM catalog_entries WHERE root = ?').run(root);
      const insert = db.prepare('INSERT INTO catalog_entries (root, relative_path, fingerprint, artwork) VALUES (?, ?, ?, ?)');
      for (const record of catalog.records) insert.run(root, record.relative, record.fingerprint, JSON.stringify(record.item));
      db.prepare('INSERT OR REPLACE INTO catalog_roots (root, format_version, scanned_at) VALUES (?, ?, ?)').run(root, FORMAT_VERSION, catalog.scannedAt);
    })();
  } finally { db.close(); }
}
