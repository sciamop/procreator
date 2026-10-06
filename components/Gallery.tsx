'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Artwork, Catalog } from '@/lib/types';
import { LayerInspector } from './LayerInspector';
import { TaggingControl } from './TaggingControl';

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
const PAGE_SIZE = 100;
const imageUrl = (item: Artwork, thumb = false) => `/api/artworks/${item.id}/preview?v=${item.version}&format=png${thumb ? '&size=thumb' : ''}`;
const dateLabel = (item: Artwork) => item.dateSource === 'recording' ? 'Earliest recording (estimated creation)' : item.dateSource === 'archive' ? 'Saved inside Procreate archive' : 'File modified (no embedded date)';
const folderName = (folder: string) => folder === '.' ? 'Root folder' : folder.split('/').at(-1)!;
const bytes = (value: number) => value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(1)} GB` : `${(value / 1024 ** 2).toFixed(1)} MB`;

function ArtworkImage({ item }: { item: Artwork }) {
  const [failed, setFailed] = useState(false);
  if (item.error || failed) return <span className="poster poster-fallback">Preview unavailable</span>;
  return <span className="poster"><img src={imageUrl(item, true)} alt={item.name} loading="lazy" decoding="async" onError={() => setFailed(true)}/></span>;
}

function TimeLapse({ item }: { item: Artwork }) {
  const [state, setState] = useState<'preparing' | 'ready' | 'error'>('preparing');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [prepared, setPrepared] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    setState('preparing');
    async function check(first: boolean) {
      try {
        const response = await fetch(`/api/artworks/${item.id}/timelapse${first && attempt ? '?retry=1' : ''}`, { signal: controller.signal });
        const result = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok || result.state === 'error') { setError(result.error || 'The recording is unavailable.'); setState('error'); }
        else if (result.state === 'ready') { setPrepared(true); setState('ready'); }
        else timer = setTimeout(() => check(false), 1500);
      } catch {
        if (!controller.signal.aborted) { setError('Could not load the recording. Check the connection and try again.'); setState('error'); }
      }
    }
    void check(true);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [item.id, attempt]);

  return <>
    <div className="stage">
      {state === 'preparing' && <div className="state" role="status"><p>Preparing the time-lapse…</p><p>{item.segments} recorded {item.segments === 1 ? 'segment' : 'segments'}. The first play may take a moment.</p></div>}
      {state === 'error' && <div className="state" role="alert"><p>{error}</p><button onClick={() => setAttempt(n => n + 1)}>Try again ↗</button></div>}
      {state === 'ready' && <video ref={video} src={`/api/artworks/${item.id}/video?v=${item.version}`} controls autoPlay playsInline preload="auto" aria-label={`Time-lapse of ${item.name}`} onLoadedMetadata={() => { if (video.current) video.current.playbackRate = speed; }} onError={() => { setError('Your browser could not play this recording. Download the time-lapse to view it in a video player.'); setState('error'); }}/ >}
    </div>
    {state === 'ready' && <div className="video-controls"><span className="quiet">Playback speed</span>{[0.5, 1, 2, 4].map(rate => <button key={rate} className={`pick${speed === rate ? ' on' : ''}`} aria-pressed={speed === rate} onClick={() => { setSpeed(rate); if (video.current) video.current.playbackRate = rate; }}>{rate}×</button>)}<a href={`/api/artworks/${item.id}/video?download=1`}>Download time-lapse ↗</a></div>}
    {state === 'error' && prepared && <div className="acts"><a href={`/api/artworks/${item.id}/video?download=1`}>Download prepared time-lapse ↗</a></div>}
  </>;
}

function Viewer({ item, position, total, initialMode, onClose, onMove, onTag }: { item: Artwork; position: number; total: number; initialMode: 'artwork' | 'timelapse'; onClose: () => void; onMove: (offset: number) => void; onTag: (tag: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const fullscreenTarget = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [mode, setMode] = useState<'artwork' | 'timelapse' | 'layers'>(initialMode);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const element = dialog.current!;
    const previousOverflow = document.body.style.overflow;
    const trigger = document.activeElement as HTMLElement | null;
    element.showModal(); document.body.style.overflow = 'hidden';
    return () => { element.close(); document.body.style.overflow = previousOverflow; trigger?.focus(); };
  }, []);
  useEffect(() => {
    setFailed(false);
    if ((mode === 'timelapse' && !item.segments) || (mode === 'layers' && item.type !== 'procreate')) setMode('artwork');
  }, [item.id, item.segments, item.type, mode]);
  useEffect(() => {
    const element = fullscreenTarget.current;
    const changed = () => setFullscreen(document.fullscreenElement === element);
    document.addEventListener('fullscreenchange', changed);
    return () => {
      document.removeEventListener('fullscreenchange', changed);
      if (document.fullscreenElement === element) void document.exitFullscreen().catch(() => {});
    };
  }, []);
  async function exitFullscreen() {
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    setFullscreen(false);
  }
  async function toggleFullscreen() {
    if (fullscreen) return exitFullscreen();
    const element = fullscreenTarget.current;
    if (!element) return;
    if (document.fullscreenEnabled && element.requestFullscreen) {
      try { await element.requestFullscreen(); } catch { /* Expand within the browser if native fullscreen is unavailable. */ }
    }
    setFullscreen(true);
  }
  return <dialog ref={dialog} aria-labelledby="viewer-title" onCancel={e => { e.preventDefault(); if (fullscreen) void exitFullscreen(); else onClose(); }} onKeyDown={e => {
    if (e.key === 'Escape' && fullscreen) { e.preventDefault(); e.stopPropagation(); void exitFullscreen(); return; }
    if ((e.target as HTMLElement).tagName === 'VIDEO' || (e.target as HTMLElement).closest('.layer-inspector')) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); onMove(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); onMove(1); }
  }}><div ref={fullscreenTarget} className={`wrap viewer-wrap${fullscreen ? ' is-fullscreen' : ''}`}>
    <nav className="nav viewer-nav" aria-label="Artwork viewer"><span className="quiet" aria-live="polite">{position + 1} / {total}</span><div className="nav-links"><button onClick={() => onMove(-1)} disabled={total < 2} aria-label="Previous artwork">← Previous</button><button onClick={() => onMove(1)} disabled={total < 2} aria-label="Next artwork">Next →</button><button onClick={onClose}>Close ×</button></div></nav>
    <div className="picks viewer-tabs" aria-label="Media type"><button className={`pick${mode === 'artwork' ? ' on' : ''}`} aria-pressed={mode === 'artwork'} onClick={() => setMode('artwork')}>Artwork</button>{item.segments > 0 && <button className={`pick${mode === 'timelapse' ? ' on' : ''}`} aria-pressed={mode === 'timelapse'} onClick={() => setMode('timelapse')}>Time-lapse ▷</button>}{item.type === 'procreate' && <button className={`pick${mode === 'layers' ? ' on' : ''}`} aria-pressed={mode === 'layers'} onClick={() => setMode('layers')}>Layers</button>}<button className="pick viewer-fullscreen" aria-pressed={fullscreen} onClick={() => void toggleFullscreen()}>{fullscreen ? 'Exit fullscreen ↙' : 'Fullscreen ↗'}</button></div>
    {mode === 'layers' ? <LayerInspector key={item.id} item={item}/> : mode === 'timelapse' && item.segments > 0 ? <TimeLapse key={item.id} item={item}/> : <div className="stage">{item.error || failed ? <p className="quiet">Preview unavailable. You can still download the original.</p> : <img key={item.id} src={imageUrl(item)} alt={item.name} onError={() => setFailed(true)}/>}</div>}
    <div className="viewer-meta"><div><h2 id="viewer-title">{item.name}</h2><p className="quiet">{item.folder} / {item.filename}</p></div><div><p>{item.width && item.height ? `${item.width.toLocaleString()} × ${item.height.toLocaleString()} px` : 'Canvas size unavailable'}</p><p className="quiet">{item.type === 'procreate' ? `Embedded preview${item.previewWidth ? ` · ${item.previewWidth} × ${item.previewHeight} px` : ''}` : 'Image preview'}</p><p className="quiet">{item.type.toUpperCase()} · {bytes(item.bytes)}</p><p className="quiet" title={dateLabel(item)}>{dateLabel(item)} · {new Date(item.date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</p></div><div className="acts"><a href={`/api/artworks/${item.id}/original`}>Download original ↗</a>{!item.error && <a href={imageUrl(item)} target="_blank" rel="noopener noreferrer">Open preview ↗</a>}{!item.segments && <span className="quiet">No time-lapse recorded</span>}</div></div>
    {!!item.tags?.length && <div className="detail-tags"><span className="quiet">Auto tags</span><div className="words">{item.tags.map(tag => <button className="word" key={tag} onClick={() => onTag(tag)}>{tag}</button>)}</div></div>}
  </div></dialog>;
}

export function Gallery() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [folder, setFolder] = useState('all');
  const [media, setMedia] = useState('all');
  const [sort, setSort] = useState('newest');
  const [tag, setTag] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [selection, setSelection] = useState<{ id: string; mode: 'artwork' | 'timelapse' } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const loadTrigger = useRef<HTMLDivElement | null>(null);
  const load = useCallback(async (refresh = false, silent = false) => {
    controller.current?.abort(); const current = new AbortController(); controller.current = current;
    if (!silent) { setLoading(true); setError(''); }
    try {
      const response = await fetch(`/api/artworks${refresh ? '?refresh=1' : ''}`, { signal: current.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not read the archive.');
      setCatalog(result);
    } catch (err) { if (!current.signal.aborted) setError(err instanceof Error ? err.message : 'Could not read the archive.'); }
    finally { if (!current.signal.aborted) setLoading(false); }
  }, []);
  useEffect(() => { void load(); return () => controller.current?.abort(); }, [load]);
  useEffect(() => {
    if (!catalog?.refreshing) return;
    const timer = setTimeout(() => { void load(false, true); }, 1500);
    return () => clearTimeout(timer);
  }, [catalog, load]);
  const items = catalog?.items;
  const refreshTags = useCallback(() => { void load(false, true); }, [load]);
  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items || []) for (const value of item.tags || []) counts.set(value, (counts.get(value) || 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || collator.compare(a[0], b[0]));
  }, [items]);
  const folders = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items || []) counts.set(item.folder, (counts.get(item.folder) || 0) + 1);
    return [...counts].sort(([a], [b]) => collator.compare(a, b));
  }, [items]);
  const filtered = useMemo(() => {
    const term = query.toLocaleLowerCase().trim();
    return (items || []).filter(item => (!tag || item.tags?.includes(tag)) && (folder === 'all' || item.folder === folder) && (media !== 'timelapse' || item.segments > 0) && (!term || `${item.name} ${item.filename} ${item.folder} ${(item.tags || []).join(' ')}`.toLocaleLowerCase().includes(term))).sort((a, b) => sort === 'newest' ? b.date - a.date : sort === 'oldest' ? a.date - b.date : collator.compare(a.name, b.name) || collator.compare(a.folder, b.folder));
  }, [items, query, folder, media, sort, tag]);
  const videos = (items || []).filter(item => item.segments > 0).length;
  const position = selection ? filtered.findIndex(item => item.id === selection.id) : -1;
  useEffect(() => {
    const target = loadTrigger.current;
    if (!target || loading || selection || limit >= filtered.length) return;
    let active = true;
    const observer = new IntersectionObserver(entries => {
      if (!active || !entries.some(entry => entry.isIntersecting)) return;
      active = false;
      observer.disconnect();
      setLimit(current => Math.min(current + PAGE_SIZE, filtered.length));
    }, { rootMargin: '600px 0px' });
    observer.observe(target);
    return () => { active = false; observer.disconnect(); };
  }, [filtered, limit, loading, selection]);
  function changeFilter(update: () => void) { update(); setLimit(PAGE_SIZE); }
  function reset() { setQuery(''); setFolder('all'); setMedia('all'); setTag(''); setLimit(PAGE_SIZE); }

  return <>
    <a className="skip" href="#gallery">Skip to artworks</a>
    <header className="wrap"><nav className="nav" aria-label="Main"><a className="wordmark" href="/">Procreator</a><div className="nav-links"><TaggingControl onProgress={refreshTags}/><button onClick={() => load(true)} disabled={loading}>{loading ? 'Reading archive…' : catalog?.refreshing ? 'Checking for changes…' : 'Refresh archive ↗'}</button></div></nav></header>
    <main className="wrap">
      <section className="cover" aria-labelledby="title"><h1 id="title">Collected<br/>works.</h1><div className="cover-meta"><div className="count">{catalog ? catalog.items.length.toLocaleString() : '—'}</div><p>Artworks from Procreate.<br/><span className="quiet">{catalog ? `${videos.toLocaleString()} time-lapses · ${folders.length} folders` : 'Reading your collection.'}</span></p></div></section>
      <section aria-label="Browse artworks">
        <div className="toolbar"><div className="picks" aria-label="Media filter">{[['all', 'All works'], ['timelapse', 'Time-lapses']].map(([value, label]) => <button key={value} className={`pick${media === value ? ' on' : ''}`} aria-pressed={media === value} onClick={() => changeFilter(() => setMedia(value))}>{label}</button>)}</div><div className="search"><label htmlFor="search">Search</label><input id="search" type="search" value={query} onChange={event => changeFilter(() => setQuery(event.target.value))} placeholder="Artwork, filename, or tag" autoComplete="off"/>{query && <button onClick={() => changeFilter(() => setQuery(''))}>Clear</button>}</div></div>
        {catalog && <div className="words" aria-label="Folder filter"><button className={`word${folder === 'all' ? ' on' : ''}`} aria-pressed={folder === 'all'} onClick={() => changeFilter(() => setFolder('all'))}>All folders <i>{catalog.items.length}</i></button>{folders.map(([name, count]) => <button key={name} title={name} className={`word${folder === name ? ' on' : ''}`} aria-pressed={folder === name} onClick={() => changeFilter(() => setFolder(name))}>{folderName(name)} <i>{count}</i></button>)}</div>}
        {!!tags.length && <details className="tag-browser"><summary>Tags <span className="quiet">{tag || `${tags.length} subjects`}</span></summary><div className="words tag-words" aria-label="Tag filter"><button className={`word${!tag ? ' on' : ''}`} aria-pressed={!tag} onClick={() => changeFilter(() => setTag(''))}>All tags</button>{tags.map(([value, count]) => <button key={value} className={`word${tag === value ? ' on' : ''}`} aria-pressed={tag === value} onClick={() => changeFilter(() => setTag(value))}>{value} <i>{count}</i></button>)}</div></details>}
        <div className="band-head"><h2 aria-live="polite">{catalog ? `${filtered.length.toLocaleString()} ${media === 'timelapse' ? 'time-lapses' : 'works'}${folder !== 'all' ? ` / ${folderName(folder)}` : ''}${tag ? ` / ${tag}` : ''}` : 'The archive'}{tag && <> <button className="quiet" aria-label="Clear tag filter" onClick={() => changeFilter(() => setTag(''))}>×</button></>}</h2><div className="picks" aria-label="Sort artworks">{[['name', 'Name'], ['newest', 'Newest'], ['oldest', 'Oldest']].map(([value, label]) => <button className={`pick${sort === value ? ' on' : ''}`} key={value} aria-pressed={sort === value} onClick={() => changeFilter(() => setSort(value))}>{label}</button>)}</div></div>
        {error && <div className="state" role="alert"><p>{error}</p><button onClick={() => load(true)}>Try again ↗</button></div>}
        {loading && !catalog && <p className="state" role="status">Reading artwork previews and time-lapse recordings…</p>}
        {!loading && catalog && !filtered.length && <div className="state"><p>{!catalog.items.length ? 'No artworks found in this folder.' : 'No works match this selection.'}</p>{catalog.items.length > 0 && <button onClick={reset}>Show all works ↗</button>}</div>}
        <div className="plot" id="gallery" tabIndex={-1}>{filtered.slice(0, limit).map((item, index) => <article className="artwork" key={`${item.id}:${item.version}`}>
          <button className="artwork-open" onClick={() => setSelection({ id: item.id, mode: 'artwork' })} aria-label={`View ${item.name}`}>
            <ArtworkImage item={item}/>
            <span className="item-line">
              <span className="number quiet">{String(index + 1).padStart(3, '0')}</span>
              <b title={item.name}>{item.name}</b>
              <time className="quiet" dateTime={new Date(item.date).toISOString()} title={dateLabel(item)}>{new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</time>
            </span>
          </button>
        </article>)}</div>
        {filtered.length > 0 && <div className="gallery-progress" ref={loadTrigger}><span className="quiet">{limit < filtered.length ? 'Scroll for more' : 'End of collection'}</span><span className="quiet" role="status">{Math.min(limit, filtered.length)} / {filtered.length}</span></div>}
      </section>
    </main>
    <footer className="wrap"><div className="foot"><span>Procreator</span><span>Local artwork collection</span></div></footer>
    {selection && position >= 0 && <Viewer item={filtered[position]} position={position} total={filtered.length} initialMode={selection.mode} onClose={() => setSelection(null)} onTag={value => { setSelection(null); reset(); setTag(value); window.scrollTo(0, 0); }} onMove={offset => { const next = (position + offset + filtered.length) % filtered.length; setSelection({ ...selection, id: filtered[next].id }); }}/ >}
  </>;
}
