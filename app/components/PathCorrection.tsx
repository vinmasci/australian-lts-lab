'use client';
import { useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { ausbugAuth } from '@/lib/firebase-review-client';
import { ltsAppPath } from '@/lib/client-path';
import { PATH_TYPES, PATH_TYPE_LABELS, type PathType } from '@/lib/path-corrections';
import type { VoteSegment } from '@/lib/lts-voting';

export function PathCorrection({ segment, onSavingChange, onPublished }: { segment: VoteSegment; onSavingChange: (saving: boolean) => void; onPublished: () => Promise<void> }) {
  const [user, setUser] = useState<User | null>(null);
  const [pathType, setPathType] = useState<PathType | ''>('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => onAuthStateChanged(ausbugAuth, setUser), []);
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setLoading(true);
      try {
        const token = await user.getIdToken();
        const params = new URLSearchParams({ dataset: segment.dataset, segmentId: segment.segmentId });
        const response = await fetch(ltsAppPath(`/api/path-corrections?${params}`), { cache: 'no-store', headers: { Authorization: `Bearer ${token}` } });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Your correction could not be loaded.');
        if (!cancelled && data.report) { setPathType(data.report.pathType); setNote(data.report.note); setStatus(data.report.status); }
      } catch (caught) { if (!cancelled) setError(caught instanceof Error ? caught.message : 'Your correction could not be loaded.'); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [segment.dataset, segment.segmentId, user]);
  const submit = async () => {
    if (!user || !pathType) return;
    setSaving(true); onSavingChange(true); setError(null);
    try {
      const token = await user.getIdToken();
      const response = await fetch(ltsAppPath('/api/path-corrections'), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ segment, pathType, note }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Your correction could not be saved.');
      setStatus(data.report.status);
      try {
        await onPublished();
        setMessage('Saved — the map is updated. Routing updates with the next data refresh.');
      } catch { setMessage('Saved. Reload the map to see the change.'); }
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Your correction could not be saved.'); }
    finally { setSaving(false); onSavingChange(false); }
  };
  return <details className="mt-4 rounded-xl border border-pink-300/25 bg-pink-300/5 p-3">
    <summary className="min-h-11 cursor-pointer py-3 text-sm font-bold text-pink-200">Correct path type</summary>
    <p className="text-xs leading-relaxed text-slate-300">This pink path hasn’t been verified for cycling. Tell us what you found on the ground. Your saved correction updates the map. Routing updates with the next data refresh.</p>
    {!user && <p className="mt-3 text-xs text-slate-300">Sign in using the options above to submit a correction.</p>}
    <fieldset disabled={saving || loading} className="mt-3 space-y-2">
      <legend className="sr-only">Observed path type</legend>
      {PATH_TYPES.map(type => <label key={type} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-white/10 px-3 text-xs text-white">
        <input type="radio" name="path-correction-type" value={type} checked={pathType === type} onChange={() => setPathType(type)} /> {PATH_TYPE_LABELS[type]}
      </label>)}
      <label className="block pt-2 text-xs font-semibold text-slate-300">What did you observe?
        <textarea rows={3} maxLength={500} value={note} onChange={e => setNote(e.target.value)} placeholder="For example: shared-path signs at both ends; firm surface and no steps." className="mt-2 w-full rounded-lg border border-white/10 bg-slate-950 p-3 text-xs text-white" />
      </label>
      <button type="button" onClick={() => void submit()} disabled={!user || !pathType || !note.trim()} className="min-h-11 w-full rounded-lg bg-pink-200 px-3 text-sm font-bold text-slate-950 disabled:opacity-50">{saving ? 'Submitting…' : loading ? 'Loading…' : 'Save path type'}</button>
    </fieldset>
    {(message || status) && <p role="status" className="mt-3 text-xs text-emerald-200">{message || 'Your previous correction is saved. You can update it here.'}</p>}
    {error && <p role="alert" className="mt-3 text-xs text-rose-300">{error}</p>}
  </details>;
}
