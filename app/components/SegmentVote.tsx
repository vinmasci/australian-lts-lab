'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  GoogleAuthProvider,
  OAuthProvider,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import { Bike, Check, ChevronLeft, CircleHelp, Loader2, LogIn, LogOut, Mail, UserRound, Vote, X } from 'lucide-react';
import { ausbugAuth } from '@/lib/firebase-review-client';
import { ltsAppPath } from '@/lib/client-path';
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

type AuthMode = 'choice' | 'email' | 'reset';

function authMessage(error: unknown, fallback: string): string {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') return 'The email or password is incorrect.';
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return 'Sign-in was cancelled.';
  if (code === 'auth/too-many-requests') return 'Too many attempts. Please wait and try again.';
  if (code === 'auth/invalid-email') return 'Enter a valid email address.';
  return fallback;
}

function blankSummary(): SegmentVoteSummary {
  return {
    counts: Object.fromEntries(LTS_VOTE_LEVELS.map((level) => [String(level), 0])),
    total: 0,
    leadingTarget: null,
    projectedLts: null,
    yourVote: null,
    yourContributorName: '',
    yourLtsReason: '',
    rideabilityCounts: Object.fromEntries(RIDEABILITY_LEVELS.map((level) => [String(level), 0])),
    rideabilityTotal: 0,
    communityRideability: null,
    yourRideability: null,
    yourRideabilityIssues: [],
    yourObservation: '',
    publicContributions: [],
    moderationStatus: null,
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

export function SegmentVote({ segment, onPublished }: { segment: VoteSegment; onPublished?: () => void | Promise<void> }) {
  const [summary, setSummary] = useState<SegmentVoteSummary>(blankSummary);
  const [choice, setChoice] = useState<LtsVoteLevel | null>(null);
  const [ltsReason, setLtsReason] = useState('');
  const [rideability, setRideability] = useState<RideabilityLevel | null>(null);
  const [rideabilityIssues, setRideabilityIssues] = useState<RideabilityIssue[]>([]);
  const [note, setNote] = useState('');
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>('choice');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSuccess, setAuthSuccess] = useState<string | null>(null);
  const [website, setWebsite] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [help, setHelp] = useState<'lts' | 'rideability' | null>(null);

  const choiceResult = useMemo(
    () => choice === null ? null : projectApprovedLts(segment.currentLts, choice, segment.maxspeed),
    [choice, segment.currentLts, segment.maxspeed],
  );

  useEffect(() => onAuthStateChanged(ausbugAuth, (currentUser) => {
    setUser(currentUser);
    setAuthReady(true);
  }), []);

  useEffect(() => {
    if (!authReady) return undefined;
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
        const observation = await fetch(ltsAppPath('/api/lts-votes'), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ segment }),
        });
        if (!observation.ok) {
          const result = await observation.json() as { error?: string };
          throw new Error(result.error || 'This segment could not be checked against the current map.');
        }
        const params = new URLSearchParams({ dataset: segment.dataset, segmentId: segment.segmentId });
        const token = user ? await user.getIdToken() : null;
        const response = await fetch(ltsAppPath(`/api/lts-votes?${params}`), {
          cache: 'no-store',
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
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
  }, [authReady, segment, user]);

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
    if (choice !== null && !ltsReason.trim()) {
      setError('Please explain why you chose this LTS rating.');
      return;
    }
    if (rideability !== null && !note.trim()) {
      setError('Please describe what you observed to support your rideability rating.');
      return;
    }
    const currentUser = ausbugAuth.currentUser;
    if (!currentUser) {
      setError('Sign in with an AusBUG account to contribute.');
      return;
    }
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const token = await currentUser.getIdToken();
      const response = await fetch(ltsAppPath('/api/lts-votes'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ segment, targetLts: choice, ltsReason, rideability, rideabilityIssues, note, website }),
      });
      const result = await response.json() as SegmentVoteSummary & { error?: string };
      if (!response.ok) throw new Error(result.error || 'Vote could not be saved.');
      setSummary(result);
      setChoice(result.yourVote);
      setLtsReason(result.yourLtsReason);
      setRideability(result.yourRideability);
      setRideabilityIssues(result.yourRideabilityIssues);
      setNote(result.yourObservation);
      setMessage('Your contribution is published on the map. You can change it at any time.');
      try {
        await onPublished?.();
      } catch {
        setError('Your contribution was published, but the map overlay could not refresh. Reload the map to see it.');
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Vote could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const socialLogin = async (method: 'google' | 'apple') => {
    setAuthLoading(true);
    setAuthError(null);
    setAuthSuccess(null);
    try {
      const provider = method === 'google' ? new GoogleAuthProvider() : new OAuthProvider('apple.com');
      if (method === 'google') provider.setCustomParameters({ prompt: 'select_account' });
      if (method === 'apple') {
        provider.addScope('email');
        provider.addScope('name');
      }
      await signInWithPopup(ausbugAuth, provider);
    } catch (caught) {
      setAuthError(authMessage(caught, `${method === 'google' ? 'Google' : 'Apple'} sign-in could not be completed.`));
    } finally {
      setAuthLoading(false);
    }
  };

  const emailLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthLoading(true);
    setAuthError(null);
    setAuthSuccess(null);
    try {
      await signInWithEmailAndPassword(ausbugAuth, email.trim(), password);
      setPassword('');
    } catch (caught) {
      setAuthError(authMessage(caught, 'Email sign-in could not be completed.'));
    } finally {
      setAuthLoading(false);
    }
  };

  const sendReset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthLoading(true);
    setAuthError(null);
    setAuthSuccess(null);
    try {
      await sendPasswordResetEmail(ausbugAuth, email.trim());
      setAuthSuccess('Password reset email sent. Check your inbox.');
    } catch (caught) {
      setAuthError(authMessage(caught, 'The reset email could not be sent.'));
    } finally {
      setAuthLoading(false);
    }
  };

  const logout = async () => {
    await signOut(ausbugAuth);
    setAuthMode('choice');
    setPassword('');
    setAuthError(null);
    setAuthSuccess(null);
    setMessage(null);
  };

  return (
    <section className="mt-4 rounded-xl border border-cyan-300/25 bg-cyan-300/[0.07] p-3" aria-labelledby="segment-vote-title">
      <div className="flex items-start gap-2">
        <Vote className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />
        <div>
          <h3 id="segment-vote-title" className="text-sm font-bold text-white">Vote on this segment</h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-300">Sign in with an existing AusBUG account. Your display name, reasoning and observation publish immediately; your email stays private.</p>
        </div>
      </div>

      {!authReady ? (
        <div className="mt-3 flex items-center gap-2 text-xs text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Checking your AusBUG account…</div>
      ) : !user ? (
        <div className="mt-4 rounded-xl border border-white/10 bg-slate-950/45 p-3">
          <p className="text-xs font-bold text-white">Sign in to contribute</p>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-400">Use the same Apple, Google or email account you use with AusBUG.</p>
          {authMode === 'choice' ? (
            <div className="mt-3 space-y-2">
              <button type="button" onClick={() => void socialLogin('apple')} disabled={authLoading} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-white px-3 text-sm font-bold text-black hover:bg-slate-100 disabled:opacity-50">
                {authLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" /></svg>}
                Continue with Apple
              </button>
              <button type="button" onClick={() => void socialLogin('google')} disabled={authLoading} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-white px-3 text-sm font-bold text-slate-800 hover:bg-slate-100 disabled:opacity-50">
                {authLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" /><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" /><path fill="#FBBC05" d="M5.84 14.09A6.6 6.6 0 0 1 5.49 12c0-.73.13-1.43.35-2.09V7.07H2.18A11 11 0 0 0 1 12c0 1.78.43 3.45 1.18 4.93l3.66-2.84z" /><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" /></svg>}
                Continue with Google
              </button>
              <button type="button" onClick={() => { setAuthMode('email'); setAuthError(null); setAuthSuccess(null); }} disabled={authLoading} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-white/15 px-3 text-sm font-bold text-white hover:bg-white/10 disabled:opacity-50"><Mail className="h-4 w-4" /> Continue with email</button>
            </div>
          ) : authMode === 'email' ? (
            <form onSubmit={(event) => void emailLogin(event)} className="mt-3 space-y-2.5">
              <label className="block text-[11px] font-bold uppercase tracking-wide text-slate-400">Email
                <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" className="mt-1 min-h-11 w-full rounded-lg border border-white/10 bg-slate-950 px-3 text-sm text-white outline-none focus:border-cyan-300/60" />
              </label>
              <label className="block text-[11px] font-bold uppercase tracking-wide text-slate-400">Password
                <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="current-password" className="mt-1 min-h-11 w-full rounded-lg border border-white/10 bg-slate-950 px-3 text-sm text-white outline-none focus:border-cyan-300/60" />
              </label>
              <button type="submit" disabled={authLoading || !email.trim() || !password} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-cyan-400 text-sm font-bold text-slate-950 hover:bg-cyan-300 disabled:opacity-50">{authLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />} Sign in</button>
              <div className="flex items-center justify-between gap-3">
                <button type="button" onClick={() => { setAuthMode('choice'); setAuthError(null); setAuthSuccess(null); }} className="flex items-center gap-1 text-xs font-semibold text-slate-400 hover:text-white"><ChevronLeft className="h-3.5 w-3.5" /> All sign-in options</button>
                <button type="button" onClick={() => { setAuthMode('reset'); setAuthError(null); setAuthSuccess(null); }} className="text-xs font-semibold text-cyan-300 hover:text-cyan-200">Forgot password?</button>
              </div>
            </form>
          ) : (
            <form onSubmit={(event) => void sendReset(event)} className="mt-3 space-y-2.5">
              <p className="text-xs leading-relaxed text-slate-400">Enter the email used by your AusBUG account.</p>
              <label className="block text-[11px] font-bold uppercase tracking-wide text-slate-400">Email
                <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" className="mt-1 min-h-11 w-full rounded-lg border border-white/10 bg-slate-950 px-3 text-sm text-white outline-none focus:border-cyan-300/60" />
              </label>
              <button type="submit" disabled={authLoading || !email.trim()} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-cyan-400 text-sm font-bold text-slate-950 hover:bg-cyan-300 disabled:opacity-50">{authLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />} Send reset link</button>
              <button type="button" onClick={() => { setAuthMode('email'); setAuthError(null); setAuthSuccess(null); }} className="flex items-center gap-1 text-xs font-semibold text-slate-400 hover:text-white"><ChevronLeft className="h-3.5 w-3.5" /> Back to email sign-in</button>
            </form>
          )}
          {authError && <p className="mt-2 text-xs font-semibold text-rose-300">{authError}</p>}
          {authSuccess && <p className="mt-2 text-xs font-semibold text-emerald-300">{authSuccess}</p>}
        </div>
      ) : loading ? (
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
                  ? <span>Published result: ceil(({segment.currentLts} + {choice}) ÷ 2) = <strong>LTS {choiceResult}</strong></span>
                  : <span>Published result: this segment becomes <strong>LTS {choiceResult}</strong></span>}
              </div>
              <label className="mt-3 block text-[11px] font-semibold uppercase tracking-wide text-slate-400" htmlFor="vote-lts-reason">Why did you choose this LTS? <span className="normal-case tracking-normal text-cyan-300">Required · public</span></label>
              <textarea
                id="vote-lts-reason"
                required
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

          <label className="mt-3 block text-[11px] font-semibold uppercase tracking-wide text-slate-400" htmlFor="vote-observation">{rideability !== null ? 'Why did you choose this rideability rating?' : 'Additional observations'} <span className="normal-case tracking-normal text-cyan-300">{rideability !== null ? 'Required · public' : 'Public'}</span></label>
          <textarea
            id="vote-observation"
            required={rideability !== null}
            value={note}
            onChange={(event) => setNote(event.target.value.slice(0, 500))}
            rows={2}
            placeholder="For example: very little traffic; bluestone is rough and slippery when wet. Don’t include personal information."
            className="mt-1 w-full resize-none rounded-lg border border-white/10 bg-slate-950/70 px-2.5 py-2 text-xs text-white outline-none placeholder:text-slate-600 focus:border-cyan-300/60"
          />

          <div className="mt-3 flex items-center gap-2 rounded-lg border border-white/10 bg-slate-950/45 p-2.5">
            <UserRound className="h-4 w-4 shrink-0 text-cyan-300" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-slate-200">Signed in as {user.displayName || user.email}</p>
              {user.displayName && user.email && <p className="truncate text-[10px] text-slate-500">{user.email}</p>}
              <p className="mt-0.5 text-[10px] text-slate-500">Shown publicly as {user.displayName || 'AusBUG rider'}; your email is never shown.</p>
            </div>
            <button type="button" onClick={() => void logout()} className="flex min-h-9 items-center gap-1 rounded-md border border-white/10 px-2 text-[11px] font-semibold text-slate-300 hover:bg-white/10"><LogOut className="h-3.5 w-3.5" /> Sign out</button>
          </div>
          <div className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
            <label htmlFor="vote-website">Website</label>
            <input id="vote-website" value={website} onChange={(event) => setWebsite(event.target.value)} tabIndex={-1} autoComplete="off" />
          </div>
          <button
            type="button"
            onClick={saveVote}
            disabled={(choice === null && rideability === null) || (choice !== null && !ltsReason.trim()) || (rideability !== null && !note.trim()) || saving}
            className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-cyan-500 px-3 py-2 text-sm font-bold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Vote className="h-4 w-4" />}
            {summary.yourVote || summary.yourRideability ? 'Update my contribution' : 'Save my contribution'}
          </button>

          {summary.total > 0 && summary.leadingTarget !== null && (
            <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
              {summary.total} {summary.total === 1 ? 'vote' : 'votes'} · the published community result is LTS {summary.projectedLts}.
            </p>
          )}
          {summary.rideabilityTotal > 0 && summary.communityRideability !== null && (
            <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
              {summary.rideabilityTotal} rideability {summary.rideabilityTotal === 1 ? 'rating' : 'ratings'} · community median <strong className="text-violet-200">R{summary.communityRideability} {RIDEABILITY_LABELS[summary.communityRideability]}</strong>.
            </p>
          )}
          {summary.moderationStatus === 'pending' && (
            <p className="mt-2 rounded-lg border border-amber-300/25 bg-amber-300/10 p-2 text-xs font-semibold text-amber-200">This older or reconciled contribution is waiting for reviewer attention.</p>
          )}
          {summary.moderationStatus === 'rejected' && (
            <p className="mt-2 rounded-lg border border-slate-300/20 bg-slate-300/10 p-2 text-xs font-semibold text-slate-300">The latest proposal was reviewed but not published. You can update it with better local evidence.</p>
          )}
          {summary.approval && (
            <p className={`mt-2 rounded-lg border p-2 text-xs font-semibold ${summary.approval.status === 'needs_review' || summary.approval.status === 'orphaned' ? 'border-amber-300/25 bg-amber-300/10 text-amber-200' : 'border-emerald-300/25 bg-emerald-300/10 text-emerald-200'}`}>
              Published as LTS {summary.approval.approvedLts}{summary.approval.approvedRideability ? ` · R${summary.approval.approvedRideability}` : ''} on {new Date(summary.approval.approvedAt).toLocaleDateString('en-AU')}.
              {summary.approval.status === 'carried_forward' && ' Carried forward to the current map geometry.'}
              {(summary.approval.status === 'needs_review' || summary.approval.status === 'orphaned') && ` Hidden from the published layer pending review. ${summary.approval.statusReason || ''}`}
            </p>
          )}
          {message && <p className="mt-2 text-xs font-semibold text-emerald-300">{message}</p>}
          {error && <p className="mt-2 text-xs font-semibold text-rose-300">{error}</p>}
        </>
      )}

      {!loading && summary.publicContributions.length > 0 && (
        <section className="mt-4 border-t border-white/10 pt-4" aria-labelledby="community-comments-title">
          <div className="flex items-center gap-2">
            <UserRound className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            <h4 id="community-comments-title" className="text-xs font-bold text-white">Community comments</h4>
          </div>
          <div className="mt-2 space-y-2">
            {summary.publicContributions.map((contribution, index) => (
              <article key={`${contribution.updatedAt}-${index}`} className="rounded-lg border border-white/10 bg-slate-950/45 p-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-bold text-white">{contribution.contributorName}</span>
                  {contribution.targetLts !== null && <span className="rounded-full px-1.5 py-0.5 text-[10px] font-black text-white" style={{ background: LTS_VOTE_COLOURS[contribution.targetLts] }}>LTS {contribution.targetLts}</span>}
                  {contribution.rideability !== null && <span className="rounded-full bg-violet-500/20 px-1.5 py-0.5 text-[10px] font-bold text-violet-200">R{contribution.rideability}</span>}
                  <time className="ml-auto text-[10px] text-slate-600">{new Date(contribution.updatedAt).toLocaleDateString('en-AU')}</time>
                </div>
                {contribution.ltsReason && <p className="mt-1.5 text-xs leading-relaxed text-slate-200">{contribution.ltsReason}</p>}
                {contribution.observation && <p className="mt-1.5 text-xs leading-relaxed text-slate-300">{contribution.observation}</p>}
                {contribution.rideabilityIssues.length > 0 && <p className="mt-1.5 text-[10px] text-violet-200">Surface: {contribution.rideabilityIssues.map((issue) => RIDEABILITY_ISSUE_LABELS[issue]).join(', ')}</p>}
              </article>
            ))}
          </div>
        </section>
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
