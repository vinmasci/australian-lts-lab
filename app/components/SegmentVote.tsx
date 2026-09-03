'use client';

import { useEffect, useMemo, useState } from 'react';
import { Bike, Check, CircleHelp, Loader2, Vote, X } from 'lucide-react';
import {
  LTS_VOTE_COLOURS,
  LTS_VOTE_DESCRIPTIONS,
  LTS_VOTE_LABELS,
  LTS_VOTE_LEVELS,
  RIDEABILITY_DESCRIPTIONS,
  RIDEABILITY_ISSUE_LABELS,
  RIDEABILITY_ISSUES,
  RIDEABILITY_LABELS,
  RIDEABILITY_LEVELS,
  projectApprovedLts,
  type LtsVoteLevel,
  type RideabilityIssue,
  type RideabilityLevel,
  type SegmentVoteSummary,
  type VoteSegment,
} from '@/lib/lts-voting';

const VOTER_STORAGE_KEY = 'ausbug-lts-voter-v1';

function voterId(): string {
  const existing = window.localStorage.getItem(VOTER_STORAGE_KEY);
  if (existing) return existing;
  const created = window.crypto.randomUUID();
  window.localStorage.setItem(VOTER_STORAGE_KEY, created);
  return created;
}

function blankSummary(): SegmentVoteSummary {
  return {
    counts: Object.fromEntries(LTS_VOTE_LEVELS.map((level) => [String(level), 0])),
    total: 0,
    leadingTarget: null,
    projectedLts: null,
    yourVote: null,
    yourLtsReason: '',
    rideabilityCounts: Object.fromEntries(RIDEABILITY_LEVELS.map((level) => [String(level), 0])),
    rideabilityTotal: 0,
    communityRideability: null,
    yourRideability: null,
    yourRideabilityIssues: [],
    yourObservation: '',
    approval: null,
  };
}

function RideabilitySymbol({ level, className = 'h-9 w-12' }: { level: RideabilityLevel; className?: string }) {
  return (
    <span className={`flex shrink-0 items-center justify-center ${className}`} aria-hidden="true">
      <svg viewBox="0 0 52 40" className="h-full w-full overflow-visible" focusable="false">
        {level === 1 && <circle cx="26" cy="20" r="14" fill="#22c55e" stroke="#dcfce7" strokeWidth="2" />}
        {level === 2 && <rect x="12" y="6" width="28" height="28" rx="2" fill="#3b82f6" stroke="#dbeafe" strokeWidth="2" />}
        {level === 3 && <rect x="15" y="9" width="22" height="22" rx="1" fill="#020617" stroke="#e2e8f0" strokeWidth="2" transform="rotate(45 26 20)" />}
        {level === 4 && (
          <>
            <rect x="7" y="11" width="18" height="18" rx="1" fill="#020617" stroke="#e2e8f0" strokeWidth="2" transform="rotate(45 16 20)" />
            <rect x="27" y="11" width="18" height="18" rx="1" fill="#020617" stroke="#e2e8f0" strokeWidth="2" transform="rotate(45 36 20)" />
          </>
        )}
      </svg>
    </span>
  );
}

export function SegmentVote({ segment }: { segment: VoteSegment }) {
  const [summary, setSummary] = useState<SegmentVoteSummary>(blankSummary);
  const [choice, setChoice] = useState<LtsVoteLevel | null>(null);
  const [ltsReason, setLtsReason] = useState('');
  const [rideability, setRideability] = useState<RideabilityLevel | null>(null);
  const [rideabilityIssues, setRideabilityIssues] = useState<RideabilityIssue[]>([]);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [help, setHelp] = useState<'lts' | 'rideability' | null>(null);

  const choiceResult = useMemo(
    () => choice === null ? null : projectApprovedLts(segment.currentLts, choice),
    [choice, segment.currentLts],
  );

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setMessage(null);
      setError(null);
      setChoice(null);
      setLtsReason('');
      setRideability(null);
      setRideabilityIssues([]);
      setNote('');
      try {
        const identity = voterId();
        const params = new URLSearchParams({
          dataset: segment.dataset,
          segmentId: segment.segmentId,
          voterId: identity,
        });
        const response = await fetch(`/api/lts-votes?${params}`, { cache: 'no-store' });
        const result = await response.json() as SegmentVoteSummary & { error?: string };
        if (!response.ok) throw new Error(result.error || 'Votes are unavailable.');
        if (!cancelled) {
          setSummary(result);
          setChoice(result.yourVote);
          setLtsReason(result.yourLtsReason);
          setRideability(result.yourRideability);
          setRideabilityIssues(result.yourRideabilityIssues);
          setNote(result.yourObservation);
        }
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Votes are unavailable.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [segment]);

  useEffect(() => {
    if (!help) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setHelp(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [help]);

  const saveVote = async () => {
    if (choice === null && rideability === null) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch('/api/lts-votes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ segment, voterId: voterId(), targetLts: choice, ltsReason, rideability, rideabilityIssues, note }),
      });
      const result = await response.json() as SegmentVoteSummary & { error?: string };
      if (!response.ok) throw new Error(result.error || 'Vote could not be saved.');
      setSummary(result);
      setChoice(result.yourVote);
      setLtsReason(result.yourLtsReason);
      setRideability(result.yourRideability);
      setRideabilityIssues(result.yourRideabilityIssues);
      setNote(result.yourObservation);
      setMessage('Your contribution is saved. You can change it at any time.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Vote could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mt-4 rounded-xl border border-cyan-300/25 bg-cyan-300/[0.07] p-3" aria-labelledby="segment-vote-title">
      <div className="flex items-start gap-2">
        <Vote className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />
        <div>
          <h3 id="segment-vote-title" className="text-sm font-bold text-white">Vote on this segment</h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-300">LTS and rideability are both optional—choose either one or both. Votes remain proposals until reviewed.</p>
        </div>
      </div>

      {loading ? (
        <div className="mt-3 flex items-center gap-2 text-xs text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading votes…</div>
      ) : (
        <>
          <div className="mt-3 flex items-center justify-between gap-3">
            <div>
              <h4 className="text-xs font-bold text-white">Optional traffic stress</h4>
              <p className="mt-0.5 text-[11px] text-slate-400">LTS means Level of Traffic Stress.</p>
            </div>
            <button
              type="button"
              onClick={() => setHelp('lts')}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/15 text-slate-300 transition hover:bg-white/10 hover:text-white"
              aria-label="Explain the LTS ratings"
              title="Explain the LTS ratings"
            >
              <CircleHelp className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-3 grid grid-cols-5 gap-1.5" role="group" aria-label="Choose a proposed LTS">
            {LTS_VOTE_LEVELS.map((level) => {
              const selected = choice === level;
              return (
                <button
                  key={level}
                  type="button"
                  onClick={() => setChoice(selected ? null : level)}
                  className={`relative rounded-lg border px-1 py-2 text-center transition ${selected ? 'border-white bg-white/15 ring-2 ring-white/40' : 'border-white/10 bg-slate-950/40 hover:bg-white/10'}`}
                  aria-pressed={selected}
                  title={`LTS ${level}: ${LTS_VOTE_LABELS[level]}`}
                >
                  <span className="mx-auto flex h-8 w-8 items-center justify-center rounded-full text-xs font-black text-white" style={{ background: LTS_VOTE_COLOURS[level] }}>L{level}</span>
                  <span className="mt-1 block text-[10px] font-semibold text-slate-300">{summary.counts[String(level)] || 0}</span>
                  {summary.yourVote === level && <Check className="absolute right-1 top-1 h-3 w-3 text-white" aria-label="Your saved vote" />}
                </button>
              );
            })}
          </div>

          {choice !== null && choiceResult !== null && (
            <>
              <div className="mt-2 flex items-center gap-2 rounded-lg bg-slate-950/45 p-2 text-xs text-slate-200">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: LTS_VOTE_COLOURS[choiceResult] }} />
                {choice >= 3
                  ? <span>Approval preview: ceil(({segment.currentLts} + {choice}) ÷ 2) = <strong>LTS {choiceResult}</strong></span>
                  : <span>Approval preview: this segment becomes <strong>LTS {choiceResult}</strong></span>}
              </div>
              <label className="mt-3 block text-[11px] font-semibold uppercase tracking-wide text-slate-400" htmlFor="vote-lts-reason">Why did you choose this LTS? <span className="normal-case tracking-normal text-slate-600">Optional</span></label>
              <textarea
                id="vote-lts-reason"
                value={ltsReason}
                onChange={(event) => setLtsReason(event.target.value.slice(0, 500))}
                rows={2}
                placeholder="For example: traffic is fast and heavy, the bike lane disappears, or the crossing feels calm. Don’t include personal information."
                className="mt-1 w-full resize-none rounded-lg border border-white/10 bg-slate-950/70 px-2.5 py-2 text-xs text-white outline-none placeholder:text-slate-600 focus:border-cyan-300/60"
              />
            </>
          )}

          <div className="my-4 h-px bg-white/10" />
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2">
              <Bike className="mt-0.5 h-4 w-4 shrink-0 text-violet-300" />
              <div>
                <h4 className="text-xs font-bold text-white">Optional rideability</h4>
                <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400">R means Rideability. This describes the surface, not traffic.</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setHelp('rideability')}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-violet-300/25 text-violet-200 transition hover:bg-violet-300/10 hover:text-white"
              aria-label="Explain the rideability ratings"
              title="Explain the rideability ratings"
            >
              <CircleHelp className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-1.5" role="group" aria-label="Choose an optional rideability rating">
            {RIDEABILITY_LEVELS.map((level) => {
              const selected = rideability === level;
              return (
                <button
                  key={level}
                  type="button"
                  onClick={() => {
                    setRideability(selected ? null : level);
                    if (selected) setRideabilityIssues([]);
                  }}
                  className={`relative flex min-h-16 items-center gap-2 rounded-lg border px-2 py-2 text-left transition ${selected ? 'border-violet-300 bg-violet-300/15 ring-2 ring-violet-300/25' : 'border-white/10 bg-slate-950/40 hover:bg-white/10'}`}
                  aria-pressed={selected}
                  title={`R${level}: ${RIDEABILITY_DESCRIPTIONS[level]}`}
                >
                  <RideabilitySymbol level={level} className="h-8 w-10" />
                  <span>
                    <span className="block text-[11px] font-bold text-slate-200">R{level} · {RIDEABILITY_LABELS[level]}</span>
                    <span className="block text-[10px] text-slate-500">{summary.rideabilityCounts[String(level)] || 0} votes</span>
                  </span>
                  {summary.yourRideability === level && <Check className="absolute right-1.5 top-1.5 h-3 w-3 text-violet-200" aria-label="Your saved rideability rating" />}
                </button>
              );
            })}
          </div>

          {rideability !== null && (
            <div className="mt-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">What affects the ride? <span className="normal-case tracking-normal text-slate-600">Optional</span></p>
              <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label="Surface conditions">
                {RIDEABILITY_ISSUES.map((issue) => {
                  const selected = rideabilityIssues.includes(issue);
                  return (
                    <button
                      key={issue}
                      type="button"
                      onClick={() => setRideabilityIssues((current) => selected ? current.filter((item) => item !== issue) : [...current, issue])}
                      className={`rounded-full border px-2.5 py-1.5 text-[10px] font-semibold transition ${selected ? 'border-violet-300/70 bg-violet-300/20 text-violet-100' : 'border-white/10 bg-slate-950/40 text-slate-400 hover:bg-white/10'}`}
                      aria-pressed={selected}
                    >
                      {RIDEABILITY_ISSUE_LABELS[issue]}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <label className="mt-3 block text-[11px] font-semibold uppercase tracking-wide text-slate-400" htmlFor="vote-observation">What did you observe? <span className="normal-case tracking-normal text-slate-600">Optional</span></label>
          <textarea
            id="vote-observation"
            value={note}
            onChange={(event) => setNote(event.target.value.slice(0, 500))}
            rows={2}
            placeholder="For example: very little traffic; bluestone is rough and slippery when wet. Don’t include personal information."
            className="mt-1 w-full resize-none rounded-lg border border-white/10 bg-slate-950/70 px-2.5 py-2 text-xs text-white outline-none placeholder:text-slate-600 focus:border-cyan-300/60"
          />
          <button
            type="button"
            onClick={saveVote}
            disabled={(choice === null && rideability === null) || saving}
            className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-cyan-500 px-3 py-2 text-sm font-bold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Vote className="h-4 w-4" />}
            {summary.yourVote || summary.yourRideability ? 'Update my contribution' : 'Save my contribution'}
          </button>

          {summary.total > 0 && summary.leadingTarget !== null && (
            <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
              {summary.total} {summary.total === 1 ? 'vote' : 'votes'} · community currently leans LTS {summary.leadingTarget}, which would display as LTS {summary.projectedLts} after approval.
            </p>
          )}
          {summary.rideabilityTotal > 0 && summary.communityRideability !== null && (
            <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
              {summary.rideabilityTotal} rideability {summary.rideabilityTotal === 1 ? 'rating' : 'ratings'} · community median <strong className="text-violet-200">R{summary.communityRideability} {RIDEABILITY_LABELS[summary.communityRideability]}</strong>.
            </p>
          )}
          {summary.approval && (
            <p className="mt-2 rounded-lg border border-emerald-300/25 bg-emerald-300/10 p-2 text-xs font-semibold text-emerald-200">
              Approved as LTS {summary.approval.approvedLts}{summary.approval.approvedRideability ? ` · R${summary.approval.approvedRideability}` : ''} on {new Date(summary.approval.approvedAt).toLocaleDateString('en-AU')}.
            </p>
          )}
          {message && <p className="mt-2 text-xs font-semibold text-emerald-300">{message}</p>}
          {error && <p className="mt-2 text-xs font-semibold text-rose-300">{error}</p>}
        </>
      )}

      {help && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
          <button type="button" className="absolute inset-0 bg-slate-950/75 backdrop-blur-sm" onClick={() => setHelp(null)} aria-label="Close rating guide" />
          <section
            className="relative z-10 max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-2xl border border-white/15 bg-slate-900 p-4 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rating-guide-title"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 id="rating-guide-title" className="text-base font-bold text-white">{help === 'lts' ? 'LTS rating guide' : 'Rideability rating guide'}</h3>
                <p className="mt-1 text-xs leading-relaxed text-slate-400">
                  {help === 'lts'
                    ? 'LTS describes stress from motor traffic and crossings. It does not describe how smooth the surface is.'
                    : 'Rideability describes the surface and the kind of bicycle likely to handle it comfortably. It does not change the LTS.'}
                </p>
              </div>
              <button type="button" onClick={() => setHelp(null)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 text-slate-300 hover:bg-white/10 hover:text-white" aria-label="Close rating guide">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-2">
              {help === 'lts' ? LTS_VOTE_LEVELS.map((level) => (
                <div key={level} className="flex items-start gap-3 rounded-xl border border-white/10 bg-slate-950/45 p-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-black text-white" style={{ background: LTS_VOTE_COLOURS[level] }}>L{level}</span>
                  <div>
                    <p className="text-sm font-bold text-white">LTS {level} · {LTS_VOTE_LABELS[level]}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-slate-300">{LTS_VOTE_DESCRIPTIONS[level]}</p>
                  </div>
                </div>
              )) : RIDEABILITY_LEVELS.map((level) => (
                <div key={level} className="flex items-start gap-3 rounded-xl border border-white/10 bg-slate-950/45 p-3">
                  <RideabilitySymbol level={level} className="h-10 w-12" />
                  <div>
                    <p className="text-sm font-bold text-white">R{level} · {RIDEABILITY_LABELS[level]}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-slate-300">{RIDEABILITY_DESCRIPTIONS[level]}</p>
                  </div>
                </div>
              ))}
            </div>

            <p className="mt-4 rounded-lg border border-white/10 bg-white/5 p-3 text-[11px] leading-relaxed text-slate-400">
              You can close this guide and submit only the rating you know. The other scale can be left blank.
            </p>
          </section>
        </div>
      )}
    </section>
  );
}
