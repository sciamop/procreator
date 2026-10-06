export type Artwork = {
  id: string;
  name: string;
  filename: string;
  folder: string;
  type: string;
  bytes: number;
  modified: number;
  date: number;
  dateSource: 'recording' | 'archive' | 'filesystem';
  version: string;
  width: number | null;
  height: number | null;
  previewWidth: number | null;
  previewHeight: number | null;
  segments: number;
  error: string | null;
  tags?: string[];
  tagStatus?: 'pending' | 'tagged' | 'error';
};
export type Catalog = { items: Artwork[]; root?: string; indexedAt?: number; refreshing?: boolean };

export type ArtworkLayer = {
  id: string;
  name: string;
  group: string[];
  kind: 'layer' | 'mask';
  hidden: boolean;
  opacity: number;
  blend: string;
  clipped: boolean;
  tiles: number;
};
export type LayerCatalog = { layers: ArtworkLayer[] };
export type TaggingStatus = {
  state: 'disabled' | 'idle' | 'loading' | 'running' | 'complete' | 'error';
  processed: number;
  total: number;
  failed: number;
  error?: string;
  device?: string;
};
