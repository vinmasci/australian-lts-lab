'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Bike, Check, ExternalLink, KeyRound, Loader2, LogOut, RefreshCw, ShieldCheck, X } from 'lucide-react';
import {
  LTS_VOTE_COLOURS,
  LTS_VOTE_LEVELS,
  RIDEABILITY_LABELS,
  RIDEABILITY_LEVELS,
  type LtsVoteLevel,
  type ModerationStatus,
  type ReviewQueueItem,
  type RideabilityLevel,
} from '@/lib/lts-voting';

const REVIEWER_NAME_KEY = 'ausbug-lts-reviewer-name-v1';
const DATASETS: Record<string, string> = {
  victoria: 'Victoria',
  nsw: 'New South Wales',
  queensland: 'Queensland',
  western_australia: 'Western Australia',
  south_australia: 'South Australia',
  act: 'ACT',
  tasmania: 'Tasmania',
  northern_territory: 'Northern Territory',
};

function osmUrl(osmId?: string): string | null {
  const match = osmId?.match(/^([wnr])(\d+)$/);
  if (!match) return null;
  const type = match[1] === 'w' ? 'way' : match[1] === 'n' ? 'node' : 'relation';
  return `https://www.openstreetmap.org/${type}/${match[2]}`;
}

function ReviewCard({ item, reviewerName, onReviewed }: { item: ReviewQueueItem; reviewerName: string; onReviewed: () => void }) {
  const [targetLts, setTargetLts] = useState<LtsVoteLevel>(item.leadingTarget || Math.max(1, Math.min(4, item.segment.currentLts)) as LtsVoteLevel);
  const [rideability, setRideability] = useState<RideabilityLevel | null>(item.communityRideability);
  const [reviewNote, setReviewNote] = useState('');
  const [saving, setSaving] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sourceUrl = osmUrl(item.segment.osmId);

  const decide = async (action: 'approve' | 'reject') => {
    setSaving(action);
    setError(null);
    try {
      const response = await fetch('/api/lts-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, dataset: item.dataset, segmentId: item.segmentId, targetLts, rideability, reviewerName, reviewNote }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || 'The review could not be saved.');
      onReviewed();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The review could not be saved.');
    } finally {
      setSaving(null);
    }
  };

  return (
    <article className="rounded-2xl border border-white/10 bg-slate-900 p-4 shadow-xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-cyan-300">{DATASETS[item.dataset] || item.dataset}</p>
          <h2 className="mt-1 text-lg font-bold text-white">{item.segment.name}</h2>
          <p className="mt-1 text-xs text-slate-400">Current source rating: LTS {item.segment.currentLts} · {item.votes.length} {item.votes.length === 1 ? 'contributor' : 'contributors'}</p>
        </div>
        {sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer" className="flex min-h-10 items-center gap-1 rounded-lg border border-white/10 px-3 text-xs font-semibold text-slate-300 hover:bg-white/10"><ExternalLink className="h-3.5 w-3.5" /> OSM</a>}
      </div>

      <div className="mt-4 space-y-2">
        {item.votes.map((vote, index) => (
          <section key={`${vote.updatedAt}-${index}`} className="rounded-xl border border-white/10 bg-slate-950/65 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-bold text-white">{vote.contributorName}</span>
              {vote.targetLts !== null && <span className="rounded-full px-2 py-1 text-[11px] font-black text-white" style={{ background: LTS_VOTE_COLOURS[vote.targetLts] }}>LTS {vote.targetLts}</span>}
              {vote.rideability !== null && <span className="rounded-full bg-violet-500/20 px-2 py-1 text-[11px] font-bold text-violet-200">R{vote.rideability} · {RIDEABILITY_LABELS[vote.rideability]}</span>}
              <time className="ml-auto text-[10px] text-slate-500">{new Date(vote.updatedAt).toLocaleString('en-AU')}</time>
            </div>
            {vote.ltsReason && <p className="mt-2 text-sm leading-relaxed text-slate-200"><span className="font-semibold text-slate-400">LTS reasoning:</span> {vote.ltsReason}</p>}
            {vote.note && <p className="mt-1 text-sm leading-relaxed text-slate-300"><span className="font-semibold text-slate-400">Observation:</span> {vote.note}</p>}
            {vote.rideabilityIssues.length > 0 && <p className="mt-2 text-xs text-violet-200">Surface flags: {vote.rideabilityIssues.join(', ').replaceAll('_', ' ')}</p>}
          </section>
        ))}
      </div>

      {item.moderationStatus === 'pending' ? (
        <div className="mt-4 border-t border-white/10 pt-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-slate-300">Approved LTS proposal
              <select value={targetLts} onChange={(event) => setTargetLts(Number(event.target.value) as LtsVoteLevel)} className="mt-1 min-h-11 w-full rounded-lg border border-white/10 bg-slate-950 px-3 text-white">
                {LTS_VOTE_LEVELS.map((level) => <option key={level} value={level}>LTS {level}{item.counts[String(level)] ? ` · ${item.counts[String(level)]} votes` : ''}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-300">Approved rideability
              <select value={rideability ?? ''} onChange={(event) => setRideability(event.target.value ? Number(event.target.value) as RideabilityLevel : null)} className="mt-1 min-h-11 w-full rounded-lg border border-white/10 bg-slate-950 px-3 text-white">
                <option value="">Not rated</option>
                {RIDEABILITY_LEVELS.map((level) => <option key={level} value={level}>R{level} · {RIDEABILITY_LABELS[level]}{item.rideabilityCounts[String(level)] ? ` · ${item.rideabilityCounts[String(level)]} votes` : ''}</option>)}
              </select>
            </label>
          </div>
          <p className="mt-2 rounded-lg bg-white/5 p-2 text-xs text-slate-300">Published result: <strong>LTS {targetLts >= 3 ? Math.min(4, Math.ceil((item.segment.currentLts + targetLts) / 2)) : targetLts}</strong>{rideability ? ` · R${rideability}` : ''}</p>
          <label className="mt-3 block text-xs font-semibold text-slate-300">Reviewer note <span className="font-normal text-slate-500">(recommended when rejecting)</span>
            <textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value.slice(0, 500))} rows={2} className="mt-1 w-full resize-none rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/60" placeholder="Evidence checked, reason for rejection, or follow-up needed…" />
          </label>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => void decide('reject')} disabled={Boolean(saving)} className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-rose-300/25 bg-rose-300/10 px-3 text-sm font-bold text-rose-200 hover:bg-rose-300/20 disabled:opacity-50">{saving === 'reject' ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />} Reject</button>
            <button type="button" onClick={() => void decide('approve')} disabled={Boolean(saving)} className="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-emerald-400 px-3 text-sm font-bold text-slate-950 hover:bg-emerald-300 disabled:opacity-50">{saving === 'approve' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Approve</button>
          </div>
          {error && <p className="mt-2 text-xs font-semibold text-rose-300">{error}</p>}
        </div>
      ) : (
        <p className={`mt-4 rounded-lg p-3 text-sm font-semibold ${item.moderationStatus === 'approved' ? 'bg-emerald-300/10 text-emerald-200' : 'bg-slate-700/50 text-slate-300'}`}>
          {item.moderationStatus === 'approved' ? 'Approved' : 'Rejected'}{item.reviewNote ? ` · ${item.reviewNote}` : ''}
        </p>
      )}
    </article>
  );
}

export function ReviewQueue() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [accessKey, setAccessKey] = useState('');
  const [reviewerName, setReviewerName] = useState(() =>
    typeof window === 'undefined' ? '' : window.localStorage.getItem(REVIEWER_NAME_KEY) || '',
  );
  const [status, setStatus] = useState<ModerationStatus>('pending');
  const [dataset, setDataset] = useState('');
  const [items, setItems] = useState<ReviewQueueItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ status });
      if (dataset) params.set('dataset', dataset);
      const response = await fetch(`/api/lts-review?${params}`, { cache: 'no-store' });
      const result = await response.json() as { items?: ReviewQueueItem[]; error?: string };
      if (response.status === 401) {
        setAuthenticated(false);
        return;
      }
      if (!response.ok) throw new Error(result.error || 'Review queue is unavailable.');
      setItems(result.items || []);
      setAuthenticated(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Review queue is unavailable.');
    } finally {
      setLoading(false);
    }
  }, [dataset, status]);

  useEffect(() => {
    void fetch('/api/lts-review/session', { cache: 'no-store' })
      .then((response) => response.json())
      .then((result: { authenticated?: boolean }) => setAuthenticated(Boolean(result.authenticated)))
      .catch(() => setAuthenticated(false));
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    const timer = window.setTimeout(() => void loadQueue(), 0);
    return () => window.clearTimeout(timer);
  }, [authenticated, loadQueue]);

  const login = async () => {
    setLoading(true);
    setError(null);
    try {
      if (reviewerName.trim().length < 2) throw new Error('Enter your reviewer name.');
      const response = await fetch('/api/lts-review/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accessKey }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || 'Reviewer access failed.');
      window.localStorage.setItem(REVIEWER_NAME_KEY, reviewerName.trim());
      setAccessKey('');
      setAuthenticated(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Reviewer access failed.');
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    await fetch('/api/lts-review/session', { method: 'DELETE' });
    setAuthenticated(false);
    setItems([]);
  };

  if (authenticated === null) return <main className="flex min-h-dvh items-center justify-center bg-slate-950 text-slate-300"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Checking reviewer access…</main>;

  if (!authenticated) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-slate-950 p-4 text-white">
        <section className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-300/10 text-cyan-300"><KeyRound className="h-6 w-6" /></div>
          <h1 className="mt-4 text-2xl font-black">AusBUG LTS review</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">Voters do not need accounts. Publishing decisions remain protected for AusBUG reviewers.</p>
          <label className="mt-5 block text-xs font-bold uppercase tracking-wide text-slate-400">Your reviewer name
            <input value={reviewerName} onChange={(event) => setReviewerName(event.target.value.slice(0, 60))} autoComplete="name" className="mt-1 min-h-11 w-full rounded-lg border border-white/10 bg-slate-950 px-3 text-sm text-white outline-none focus:border-cyan-300/60" />
          </label>
          <label className="mt-3 block text-xs font-bold uppercase tracking-wide text-slate-400">Reviewer access key
            <input type="password" value={accessKey} onChange={(event) => setAccessKey(event.target.value)} autoComplete="current-password" className="mt-1 min-h-11 w-full rounded-lg border border-white/10 bg-slate-950 px-3 text-sm text-white outline-none focus:border-cyan-300/60" />
          </label>
          <button type="button" onClick={() => void login()} disabled={loading || reviewerName.trim().length < 2 || !accessKey} className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-cyan-400 font-bold text-slate-950 hover:bg-cyan-300 disabled:opacity-50">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Open review queue</button>
          {error && <p className="mt-3 text-sm font-semibold text-rose-300">{error}</p>}
          <Link href="/ltsmap" className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-cyan-300 hover:text-cyan-200"><Bike className="h-4 w-4" /> Back to the LTS map</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-slate-950 px-4 py-6 text-white sm:px-6">
      <div className="mx-auto max-w-5xl">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-cyan-300">Protected reviewer workspace</p>
            <h1 className="mt-1 text-3xl font-black">AusBUG LTS review</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-400">Contributor names and reasoning remain private here. Only approved ratings enter the public map layer.</p>
          </div>
          <div className="flex gap-2">
            <Link href="/ltsmap" className="flex min-h-10 items-center gap-2 rounded-lg border border-white/10 px-3 text-sm font-semibold text-slate-300 hover:bg-white/10"><Bike className="h-4 w-4" /> Map</Link>
            <button type="button" onClick={() => void logout()} className="flex min-h-10 items-center gap-2 rounded-lg border border-white/10 px-3 text-sm font-semibold text-slate-300 hover:bg-white/10"><LogOut className="h-4 w-4" /> Sign out</button>
          </div>
        </header>

        <section className="mt-6 grid gap-3 rounded-xl border border-white/10 bg-slate-900 p-3 sm:grid-cols-[1fr_1fr_auto]">
          <label className="text-xs font-semibold text-slate-400">Status
            <select value={status} onChange={(event) => setStatus(event.target.value as ModerationStatus)} className="mt-1 min-h-11 w-full rounded-lg border border-white/10 bg-slate-950 px-3 text-white"><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select>
          </label>
          <label className="text-xs font-semibold text-slate-400">State or territory
            <select value={dataset} onChange={(event) => setDataset(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-white/10 bg-slate-950 px-3 text-white"><option value="">All</option>{Object.entries(DATASETS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          </label>
          <button type="button" onClick={() => void loadQueue()} disabled={loading} className="mt-auto flex min-h-11 items-center justify-center gap-2 rounded-lg border border-white/10 px-4 text-sm font-bold text-slate-200 hover:bg-white/10 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh</button>
        </section>

        {error && <p className="mt-4 rounded-lg bg-rose-300/10 p-3 text-sm font-semibold text-rose-200">{error}</p>}
        {loading && !items.length ? <div className="mt-10 flex items-center justify-center text-slate-400"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading contributions…</div> : (
          <div className="mt-5 space-y-4">
            {!items.length && <div className="rounded-2xl border border-dashed border-white/15 p-10 text-center text-slate-400"><ShieldCheck className="mx-auto mb-3 h-8 w-8 text-emerald-300" />No {status} contributions.</div>}
            {items.map((item) => <ReviewCard key={`${item.dataset}-${item.segmentId}`} item={item} reviewerName={reviewerName} onReviewed={() => void loadQueue()} />)}
          </div>
        )}
      </div>
    </main>
  );
}
