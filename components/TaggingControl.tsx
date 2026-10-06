'use client';

import { useEffect, useRef, useState } from 'react';
import type { TaggingStatus } from '@/lib/types';

export function TaggingControl({ onProgress }: { onProgress: () => void }) {
  const [status, setStatus] = useState<TaggingStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const last = useRef('');
  const callback = useRef(onProgress);
  callback.current = onProgress;
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch('/api/tags', { signal: controller.signal });
        if (!response.ok) throw new Error('Could not read tagging progress.');
        const next: TaggingStatus = await response.json();
        if (controller.signal.aborted) return;
        setStatus(next);
        if (next.state === 'disabled') return;
        const key = `${next.state}:${next.processed}:${next.total}`;
        if (last.current && key !== last.current) callback.current();
        last.current = key;
      } catch { /* A temporary status failure should not interrupt browsing. */ }
      if (!controller.signal.aborted) timer = setTimeout(poll, 4000);
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, []);
  async function start() {
    setStarting(true); setError('');
    try {
      const response = await fetch('/api/tags', { method: 'POST' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setStatus(result); onProgress();
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not start tagging.'); }
    finally { setStarting(false); }
  }
  const active = starting || status?.state === 'loading' || status?.state === 'running';
  if (!status || status.state === 'disabled') return null;
  return <div className="tagging-control">
    <button disabled={active} onClick={start}>{starting || status?.state === 'loading' ? 'Loading tagger…' : status?.state === 'running' ? `Tagging ${status.processed} / ${status.total}` : 'Tag untagged ↗'}</button>
    {(error || status?.state === 'error') && <span className="tagging-message" role="alert">{error || status?.error}</span>}
    {status?.state === 'complete' && status.failed > 0 && <span className="tagging-message quiet">{status.failed} previews could not be tagged. Select Tag untagged to retry.</span>}
  </div>;
}
