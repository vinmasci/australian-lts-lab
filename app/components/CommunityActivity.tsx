'use client';

import { useEffect, useRef, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { ltsAppPath } from '@/lib/client-path';
import { groupRoadActivity, type Activity } from '@/lib/lts-activity-groups';

const colours: Record<number, string> = { 1: '#16a34a', 1.5: '#06b6d4', 2: '#2563eb', 3: '#f59e0b', 4: '#dc2626' };

function Score({ value }: { value: number | null }) {
  return <span className="inline-flex items-center gap-1.5 text-xs font-bold"><span className="h-3 w-3 rounded-sm" style={{ backgroundColor: value === null ? '#94a3b8' : colours[value] }} />{value === null ? 'Unknown' : `LTS ${value}`}</span>;
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
          <p className="mb-3 text-xs">Nearby segments of the same road are grouped together. Expand a road for votes and locations. Scores show the current published result, not a complete edit history.</p>
          <button type="button" className="mb-4 border px-3 py-2 text-sm" disabled={loading} onClick={() => void load()}>Refresh activity</button>
          {error && <p role="alert" className="mb-4 text-red-700">{error}</p>}
          {!loading && !error && !items.length && <p>No public community activity yet.</p>}
          <ul className="space-y-2">
            {groupRoadActivity(items).map(group => {
              const first = group[0];
              const changes = new Map<string, { item: Activity; count: number }>();
              const votes = new Map<string, { vote: Activity['contributions'][number]; segments: Set<string> }>();
              for (const item of group) {
                const key = `${item.status}/${item.baseLts}/${item.lts}`;
                const change = changes.get(key);
                if (change) change.count++;
                else changes.set(key, { item, count: 1 });
                for (const vote of item.contributions) {
                  const key = JSON.stringify([vote.contributorName, vote.targetLts, vote.ltsReason, vote.observation]);
                  const existing = votes.get(key);
                  if (existing) existing.segments.add(item.id);
                  else votes.set(key, { vote, segments: new Set([item.id]) });
                }
              }
              return <li key={`${first.dataset}/${first.id}`}>
                <details className="rounded-xl border">
                  <summary className="cursor-pointer p-3">
                    <span className="font-bold">{first.name}</span><span className="ml-2 text-xs">{group.length} {group.length === 1 ? 'segment' : 'segments'}</span>
                    <span className="mt-1 block text-xs"><span className="capitalize">{first.dataset.replaceAll('_', ' ')}</span> · <time dateTime={first.updatedAt}>{new Date(first.updatedAt).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}</time></span>
                    <span className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                      {[...changes].map(([key, { item, count }]) => <span key={key} className="inline-flex items-center gap-1.5 text-xs">
                        {item.status === 'published' ? <><Score value={item.baseLts} />{item.baseLts === item.lts ? <span>retained</span> : <><span aria-label="changed to">→</span><Score value={item.lts} /></>}</> : <span>Awaiting review</span>}
                        {group.length > 1 && <span>({count})</span>}
                      </span>)}
                    </span>
                  </summary>
                  <div className="space-y-3 border-t p-3 text-sm">
                    {[...votes].map(([key, { vote, segments }]) => <div key={key}>
                      <p className="text-xs font-bold">{vote.contributorName}{vote.targetLts !== null ? ` · voted LTS ${vote.targetLts}` : ''}{segments.size > 1 ? ` · ${segments.size} segments` : ''}</p>
                      {vote.ltsReason && <p className="mt-1 whitespace-pre-wrap text-xs">{vote.ltsReason}</p>}
                      {vote.observation && vote.observation !== vote.ltsReason && <p className="mt-1 whitespace-pre-wrap text-xs">{vote.observation}</p>}
                    </div>)}
                    {!votes.size && <p className="text-xs">No public voter details available.</p>}
                    <details><summary className="cursor-pointer text-xs font-semibold">Show segments on map</summary>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {group.map((item, index) => item.center && <button key={item.id} type="button" className="rounded-lg border px-3 py-2 text-xs" onClick={() => { onShowRoad(item.dataset, item.center!); dialog.current?.close(); }}>{group.length === 1 ? 'Show on map' : `Show segment ${index + 1}`}</button>)}
                    </div></details>
                  </div>
                </details>
              </li>;
            })}
          </ul>
          {loading && <p role="status" className="mt-4">Loading community activity…</p>}
          {cursor && <button type="button" className="mt-4 border px-4 py-2" disabled={loading} onClick={() => void load(cursor)}>Load older roads</button>}
        </div>
      </div>
    </dialog>
  </>;
}
