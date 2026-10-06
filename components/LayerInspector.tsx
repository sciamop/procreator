'use client';

import { useEffect, useState } from 'react';
import type { Artwork, LayerCatalog } from '@/lib/types';

export function LayerInspector({ item }: { item: Artwork }) {
  const [catalog, setCatalog] = useState<LayerCatalog | null>(null);
  const [catalogError, setCatalogError] = useState('');
  const [selected, setSelected] = useState('');
  const [preview, setPreview] = useState('');
  const [previewError, setPreviewError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const layer = catalog?.layers.find(layer => layer.id === selected);

  useEffect(() => {
    const controller = new AbortController();
    setCatalogError('');
    async function load() {
      try {
        const response = await fetch(`/api/artworks/${item.id}/layers?v=${item.version}`, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Layers could not be loaded.');
        if (controller.signal.aborted) return;
        setCatalog(data); setSelected(data.layers[0]?.id || '');
      } catch (error) { if (!controller.signal.aborted) setCatalogError(error instanceof Error ? error.message : 'Layers could not be loaded.'); }
    }
    void load();
    return () => controller.abort();
  }, [item.id, item.version, attempt]);

  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    let url = '';
    setPreview(''); setPreviewError('');
    async function load() {
      try {
        const response = await fetch(`/api/artworks/${item.id}/layers/${selected}?v=${item.version}&format=png`, { signal: controller.signal });
        if (!response.ok) { const data = await response.json(); throw new Error(data.error || 'This layer could not be rendered.'); }
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob); setPreview(url);
      } catch (error) { if (!controller.signal.aborted) setPreviewError(error instanceof Error ? error.message : 'This layer could not be rendered.'); }
    }
    void load();
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [item.id, item.version, selected, attempt]);

  if (catalogError) return <div className="stage"><div className="state" role="alert"><p>{catalogError}</p><button onClick={() => setAttempt(value => value + 1)}>Try again ↗</button></div></div>;
  if (!catalog) return <div className="stage"><p className="quiet" role="status">Reading layers…</p></div>;
  if (!catalog.layers.length) return <div className="stage"><p className="quiet">No individual layers were found in this document.</p></div>;

  return <section className="layer-inspector" aria-label="Layer inspector">
    <div className="layer-preview">
      <div className={`stage layer-stage${preview && !previewError ? ' transparency' : ''}`}>
        {previewError ? <div className="state" role="alert"><p>{previewError}</p><button onClick={() => setAttempt(value => value + 1)}>Try again ↗</button></div> : preview ? <img src={preview} alt={`${layer?.name} — isolated layer`} onError={() => setPreviewError('This layer preview could not be displayed.')}/> : <p className="quiet" role="status">Rendering layer…</p>}
      </div>
      <div className="layer-caption" aria-live="polite">
        <strong>{layer?.name}</strong>
        <span className="quiet">{layer?.tiles === 0 ? 'Empty layer' : 'Isolated layer at full opacity'}</span>
      </div>
      <p className="layer-note quiet">Blend modes, clipping, and masks are shown in the complete artwork, not applied to this isolated preview.</p>
    </div>
    <aside className="layer-sidebar" aria-label="Saved layers">
      <div className="layer-heading"><strong>Layers</strong><span className="quiet">{catalog.layers.length}</span></div>
      <div className="layer-list">{catalog.layers.map((entry, index) => <button key={entry.id} className={`layer-pick${selected === entry.id ? ' on' : ''}`} aria-pressed={selected === entry.id} onClick={() => setSelected(entry.id)}>
        <span className="layer-name"><span className="quiet">{String(index + 1).padStart(2, '0')}</span><span>{entry.name}</span></span>
        {entry.group.length > 0 && <span className="layer-detail quiet">{entry.group.join(' / ')}</span>}
        <span className="layer-detail quiet">{entry.kind === 'mask' ? 'Mask' : entry.blend} · {Math.round(entry.opacity * 100)}%{entry.hidden ? ' · Hidden' : ''}{entry.clipped ? ' · Clipped' : ''}</span>
      </button>)}</div>
    </aside>
  </section>;
}
