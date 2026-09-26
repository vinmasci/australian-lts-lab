'use client';
import { useCallback, useEffect, useState } from 'react';
import { ltsAppPath } from '@/lib/client-path';
import { PATH_TYPES, PATH_TYPE_LABELS, type PathType, type PathCorrection } from '@/lib/path-corrections';
type AuthorisedFetch = (input: string, init?: RequestInit) => Promise<Response>;
function CorrectionCard({ item, authorisedFetch, onReviewed }: { item: PathCorrection; authorisedFetch: AuthorisedFetch; onReviewed: () => void }) {
  const [pathType, setPathType] = useState<PathType>(item.pathType);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const decide = async (action: 'approve' | 'reject') => {
    setSaving(true); setError(null);
    try {
      const response = await authorisedFetch(ltsAppPath('/api/path-corrections/review'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: item.id, updatedAt: item.updatedAt, action, pathType, reviewNote: note }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Review failed.');
      onReviewed();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Review failed.'); }
    finally { setSaving(false); }
  };
  return <article className="rounded-xl border border-pink-300/20 bg-slate-900 p-4">
    <h3 className="font-bold">{item.segment.name} <span className="text-xs font-normal text-slate-400">· {item.segment.dataset}</span></h3>
    <p className="mt-2 text-sm text-pink-200">Proposed: {PATH_TYPE_LABELS[item.pathType]}</p>
    <p className="mt-2 text-sm text-slate-200">{item.note}</p>
    <p className="mt-1 text-xs text-slate-400">{item.contributorName} · {new Date(item.updatedAt).toLocaleString('en-AU')}</p>
    <a href={`https://www.openstreetmap.org/way/${item.segment.osmId?.slice(1)}`} target="_blank" rel="noreferrer" className="mt-2 inline-block min-h-11 py-3 text-sm font-semibold text-cyan-300">Check path in OpenStreetMap ↗</a>
    <fieldset disabled={saving}>
      <label className="block text-xs text-slate-300">Reviewed path type
        <select value={pathType} onChange={e => setPathType(e.target.value as PathType)} className="mt-1 min-h-11 w-full rounded-lg border border-white/10 bg-slate-950 px-3 text-white">{PATH_TYPES.map(type => <option key={type} value={type}>{PATH_TYPE_LABELS[type]}</option>)}</select>
      </label>
      <p className="mt-2 text-xs text-slate-400">Approving “Unsure” removes any previous path correction. Rejecting this report leaves the published classification unchanged. Check signage and trail suitability before approving.</p>
      <label className="mt-3 block text-xs text-slate-300">Evidence for your decision
        <textarea value={note} onChange={e => setNote(e.target.value)} maxLength={500} rows={2} className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 p-3 text-white" />
      </label>
      <div className="mt-3 flex gap-3">
        <button disabled={!note.trim()} onClick={() => void decide('approve')} className="min-h-11 rounded-lg bg-pink-200 px-4 text-sm font-bold text-slate-950 disabled:opacity-50">{saving ? 'Saving…' : 'Approve correction'}</button>
        <button disabled={!note.trim()} onClick={() => void decide('reject')} className="min-h-11 rounded-lg border border-white/20 px-4 text-sm font-bold disabled:opacity-50">Reject report</button>
      </div>
    </fieldset>
    {error && <p role="alert" className="mt-3 text-xs text-rose-300">{error}</p>}
  </article>;
}
export function PathCorrectionReview({ authorisedFetch, status, dataset }: { authorisedFetch: AuthorisedFetch; status: PathCorrection['status']; dataset: string }) {
  const [items, setItems] = useState<PathCorrection[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ status, dataset });
      const response = await authorisedFetch(ltsAppPath(`/api/path-corrections/review?${params}`), { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Path corrections could not be loaded.');
      setItems(data.items);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Path corrections could not be loaded.'); }
    finally { setLoading(false); }
  }, [authorisedFetch, dataset, status]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  return <section className="mt-6 space-y-3" aria-label="Path correction reviews">
    <div className="flex items-center justify-between"><h2 className="text-lg font-bold text-pink-200">Pink path corrections</h2><button onClick={() => void load()} disabled={loading} className="min-h-11 px-3 text-sm font-semibold text-slate-300">{loading ? 'Loading…' : 'Refresh paths'}</button></div>
    {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
    {!loading && !error && !items.length && <p className="text-sm text-slate-400">No {status} path corrections.</p>}
    {items.map(item => <CorrectionCard key={`${item.id}:${item.updatedAt}:${item.status}`} item={item} authorisedFetch={authorisedFetch} onReviewed={() => void load()} />)}
  </section>;
}
