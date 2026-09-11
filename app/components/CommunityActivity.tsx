'use client';

import { useEffect, useRef, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { ltsAppPath } from '@/lib/client-path';
import type { PublicLtsContribution } from '@/lib/lts-voting';

interface Activity {
  id: string;
  dataset: string;
  name: string;
  updatedAt: string;
  status: 'published' | 'pending';
  baseLts: number | null;
  lts: number | null;
  publishedAt: string | null;
  contributions: PublicLtsContribution[];
  center: [number, number] | null;
}

export function CommunityActivity({ onShowRoad }: { onShowRoad: (dataset: string, center: [number, number]) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef<AbortController | null>(null);
  const [items, setItems] = useState<Activity[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => () => request.current?.abort(), []);

  async function load(next?: string) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError('');
    try {
      const response = await fetch(ltsAppPath(`/api/lts-activity${next ? `?cursor=${encodeURIComponent(next)}` : ''}`), { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error('Community activity could not be loaded. Please try again.');
      const data = await response.json() as { activity: Activity[]; nextCursor: string | null };
      setItems(previous => next ? [...previous, ...data.activity.filter(item => !previous.some(old => old.id === item.id))] : data.activity);
      setCursor(data.nextCursor);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Activity unavailable.');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  return <>
    <button type="button" className="flex h-10 w-10 shrink-0 items-center justify-center border border-white/10" aria-label="Community activity" aria-haspopup="dialog" aria-expanded={open} onClick={() => { dialog.current?.showModal(); setOpen(true); void load(); }}><Bell className="h-5 w-5" /></button>
    <dialog ref={dialog} className="community-activity lts-surface" aria-labelledby="community-activity-title" onClose={() => { setOpen(false); request.current?.abort(); }} onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <div className="activity-inner">
        <header className="flex items-center justify-between gap-4 border-b p-5">
          <div><h2 id="community-activity-title" className="text-lg font-bold">Community activity</h2><p className="text-sm">Latest contributions across Australia</p></div>
          <button type="button" aria-label="Close community activity" className="p-2" onClick={() => dialog.current?.close()}><X className="h-5 w-5" /></button>
        </header>
        <div className="activity-body p-5">
          <p className="mb-4 text-sm">Recent activity grouped by road, newest contributions first. Each entry shows its current review status—not a complete edit history.</p>
          <button type="button" className="mb-4 border px-3 py-2 text-sm" disabled={loading} onClick={() => void load()}>Refresh activity</button>
          {error && <p role="alert" className="mb-4 text-red-700">{error}</p>}
          {!loading && !error && !items.length && <p>No public community activity yet.</p>}
          <ul className="space-y-4">
            {items.map(item => <li key={item.id} className="rounded-xl border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold">{item.name}</h3><span className="text-xs font-semibold">{item.status === 'published' ? 'Published score' : 'Awaiting review'}</span></div>
              <p className="mt-1 text-sm capitalize">{item.dataset.replaceAll('_', ' ')} · <time dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}</time></p>
              {item.status === 'published' ? <p className="mt-3 font-semibold">{item.baseLts === item.lts ? `LTS ${item.lts} retained` : `LTS ${item.baseLts} → LTS ${item.lts}`}</p> : <p className="mt-3 text-sm">A contribution is awaiting review. Its details are not public yet.</p>}
              {item.publishedAt && <p className="mt-1 text-sm">Published {new Date(item.publishedAt).toLocaleDateString('en-AU')}</p>}
              {item.status === 'published' && !item.contributions.length && <p className="mt-2 text-sm">Voter names are not available in this public record.</p>}
              {item.contributions.map((vote, index) => <div key={`${vote.updatedAt}-${index}`} className="mt-3 border-t pt-3 text-sm">
                <p className="font-semibold">{vote.contributorName}{vote.targetLts !== null ? ` · voted LTS ${vote.targetLts}` : ''}{vote.rideability !== null ? ` · rideability R${vote.rideability}` : ''}</p>
                {vote.ltsReason && <p className="mt-1 whitespace-pre-wrap">{vote.ltsReason}</p>}
                {vote.observation && vote.observation !== vote.ltsReason && <p className="mt-1 whitespace-pre-wrap">{vote.observation}</p>}
              </div>)}
              {item.center && <button type="button" className="mt-3 border px-3 py-2 text-sm font-semibold" onClick={() => { onShowRoad(item.dataset, item.center!); dialog.current?.close(); }}>Show on map</button>}
            </li>)}
          </ul>
          {loading && <p role="status" className="mt-4">Loading community activity…</p>}
          {cursor && <button type="button" className="mt-4 border px-4 py-2" disabled={loading} onClick={() => void load(cursor)}>Load older roads</button>}
        </div>
      </div>
    </dialog>
  </>;
}
