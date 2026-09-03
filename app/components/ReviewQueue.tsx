'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import {
  onAuthStateChanged,
  GoogleAuthProvider,
  OAuthProvider,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import { Bike, Check, ChevronLeft, ExternalLink, Loader2, LogIn, LogOut, Mail, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { reviewAuth } from '@/lib/firebase-review-client';
import { ltsAppPath } from '@/lib/client-path';
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

type AuthorisedFetch = (input: string, init?: RequestInit) => Promise<Response>;
type AuthMode = 'choice' | 'email' | 'reset';

function authMessage(error: unknown, fallback: string): string {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') return 'The email or password is incorrect.';
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return 'Sign-in was cancelled.';
  if (code === 'auth/too-many-requests') return 'Too many attempts. Please wait and try again.';
  if (code === 'auth/invalid-email') return 'Enter a valid email address.';
  return fallback;
}

function ReviewCard({ item, authorisedFetch, onReviewed }: { item: ReviewQueueItem; authorisedFetch: AuthorisedFetch; onReviewed: () => void }) {
  const [targetLts, setTargetLts] = useState<LtsVoteLevel>(item.approval?.targetLts || item.leadingTarget || Math.max(1, Math.min(4, item.segment.currentLts)) as LtsVoteLevel);
  const [rideability, setRideability] = useState<RideabilityLevel | null>(item.approval?.approvedRideability ?? item.communityRideability);
  const [reviewNote, setReviewNote] = useState('');
  const [saving, setSaving] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sourceUrl = osmUrl(item.segment.osmId);

  const decide = async (action: 'approve' | 'reject') => {
    setSaving(action);
    setError(null);
    try {
      const response = await authorisedFetch(ltsAppPath('/api/lts-review'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, dataset: item.dataset, segmentId: item.segmentId, targetLts, rideability, reviewNote }),
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
              {vote.contributorEmail && <span className="text-xs text-slate-500">{vote.contributorEmail}</span>}
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

      <div className="mt-4 border-t border-white/10 pt-4">
        {item.moderationStatus !== 'pending' && (
          <p className={`mb-3 rounded-lg p-2 text-xs font-semibold ${item.moderationStatus === 'approved' ? 'bg-emerald-300/10 text-emerald-200' : 'bg-slate-700/50 text-slate-300'}`}>
            {item.moderationStatus === 'approved' ? 'Currently published' : 'Currently removed'}{item.reviewNote ? ` · ${item.reviewNote}` : ''}
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-slate-300">Published LTS
              <select value={targetLts} onChange={(event) => setTargetLts(Number(event.target.value) as LtsVoteLevel)} className="mt-1 min-h-11 w-full rounded-lg border border-white/10 bg-slate-950 px-3 text-white">
                {LTS_VOTE_LEVELS.map((level) => <option key={level} value={level}>LTS {level}{item.counts[String(level)] ? ` · ${item.counts[String(level)]} votes` : ''}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-300">Published rideability
              <select value={rideability ?? ''} onChange={(event) => setRideability(event.target.value ? Number(event.target.value) as RideabilityLevel : null)} className="mt-1 min-h-11 w-full rounded-lg border border-white/10 bg-slate-950 px-3 text-white">
                <option value="">Not rated</option>
                {RIDEABILITY_LEVELS.map((level) => <option key={level} value={level}>R{level} · {RIDEABILITY_LABELS[level]}{item.rideabilityCounts[String(level)] ? ` · ${item.rideabilityCounts[String(level)]} votes` : ''}</option>)}
              </select>
            </label>
        </div>
        <p className="mt-2 rounded-lg bg-white/5 p-2 text-xs text-slate-300">Published result: <strong>LTS {targetLts >= 3 ? Math.min(4, Math.ceil((item.segment.currentLts + targetLts) / 2)) : targetLts}</strong>{rideability ? ` · R${rideability}` : ''}</p>
        <label className="mt-3 block text-xs font-semibold text-slate-300">Reviewer note <span className="font-normal text-slate-500">(recommended when removing)</span>
          <textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value.slice(0, 500))} rows={2} className="mt-1 w-full resize-none rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/60" placeholder="Evidence checked, reason for correction or removal, or follow-up needed…" />
        </label>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => void decide('reject')} disabled={Boolean(saving)} className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-rose-300/25 bg-rose-300/10 px-3 text-sm font-bold text-rose-200 hover:bg-rose-300/20 disabled:opacity-50">{saving === 'reject' ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />} {item.moderationStatus === 'approved' ? 'Remove' : item.moderationStatus === 'pending' ? 'Do not publish' : 'Keep removed'}</button>
          <button type="button" onClick={() => void decide('approve')} disabled={Boolean(saving)} className="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-emerald-400 px-3 text-sm font-bold text-slate-950 hover:bg-emerald-300 disabled:opacity-50">{saving === 'approve' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {item.moderationStatus === 'pending' ? 'Publish' : item.moderationStatus === 'approved' ? 'Update' : 'Republish'}</button>
        </div>
        {error && <p className="mt-2 text-xs font-semibold text-rose-300">{error}</p>}
      </div>
    </article>
  );
}

export function ReviewQueue() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [reviewer, setReviewer] = useState<{ uid: string; email: string; name: string } | null>(null);
  const [status, setStatus] = useState<ModerationStatus>('pending');
  const [dataset, setDataset] = useState('');
  const [items, setItems] = useState<ReviewQueueItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>('choice');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const authorisedFetch = useCallback<AuthorisedFetch>(async (input, init = {}) => {
    const currentUser = reviewAuth.currentUser;
    if (!currentUser) throw new Error('Sign in as an approved reviewer first.');
    const token = await currentUser.getIdToken();
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  }, []);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ status });
      if (dataset) params.set('dataset', dataset);
      const response = await authorisedFetch(ltsAppPath(`/api/lts-review?${params}`), { cache: 'no-store' });
      const result = await response.json() as { items?: ReviewQueueItem[]; error?: string };
      if (response.status === 401) {
        setAuthenticated(false);
        setReviewer(null);
        setError('This AusBUG account is signed in but is not an approved LTS reviewer.');
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
  }, [authorisedFetch, dataset, status]);

  useEffect(() => {
    return onAuthStateChanged(reviewAuth, (currentUser) => {
      setUser(currentUser);
      setReviewer(null);
      if (!currentUser) {
        setAuthenticated(false);
        setItems([]);
        return;
      }
      void currentUser.getIdToken()
        .then((token) => fetch(ltsAppPath('/api/lts-review/session'), {
          cache: 'no-store',
          headers: { Authorization: `Bearer ${token}` },
        }))
        .then(async (response) => {
          const result = await response.json() as {
            authenticated?: boolean;
            reviewer?: { uid: string; email: string; name: string };
            error?: string;
          };
          if (!response.ok || !result.authenticated || !result.reviewer) {
            throw new Error(result.error || 'This account is not an approved LTS reviewer.');
          }
          setReviewer(result.reviewer);
          setAuthenticated(true);
          setError(null);
        })
        .catch((caught) => {
          setAuthenticated(false);
          setError(caught instanceof Error ? caught.message : 'Reviewer access could not be verified.');
        });
    });
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    const timer = window.setTimeout(() => void loadQueue(), 0);
    return () => window.clearTimeout(timer);
  }, [authenticated, loadQueue]);

  const socialLogin = async (method: 'google' | 'apple') => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const provider = method === 'google' ? new GoogleAuthProvider() : new OAuthProvider('apple.com');
      if (method === 'google') provider.setCustomParameters({ prompt: 'select_account' });
      if (method === 'apple') {
        provider.addScope('email');
        provider.addScope('name');
      }
      await signInWithPopup(reviewAuth, provider);
    } catch (caught) {
      setError(authMessage(caught, `${method === 'google' ? 'Google' : 'Apple'} sign-in could not be completed.`));
    } finally {
      setLoading(false);
    }
  };

  const emailLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await signInWithEmailAndPassword(reviewAuth, email.trim(), password);
      setPassword('');
    } catch (caught) {
      setError(authMessage(caught, 'Email sign-in could not be completed.'));
    } finally {
      setLoading(false);
    }
  };

  const sendReset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await sendPasswordResetEmail(reviewAuth, email.trim());
      setSuccess('Password reset email sent. Check your inbox.');
    } catch (caught) {
      setError(authMessage(caught, 'The reset email could not be sent.'));
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    await signOut(reviewAuth);
    setAuthenticated(false);
    setReviewer(null);
    setItems([]);
    setAuthMode('choice');
    setPassword('');
  };

  if (authenticated === null) return <main className="flex min-h-dvh items-center justify-center bg-slate-950 text-slate-300"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Checking reviewer access…</main>;

  if (!authenticated) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-slate-950 p-4 text-white">
        <section className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-300/10 text-cyan-300"><LogIn className="h-6 w-6" /></div>
          <h1 className="mt-4 text-2xl font-black">AusBUG LTS review</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">Contributors sign in with AusBUG and publish immediately. Approved reviewers can audit, correct or remove those ratings here.</p>
          {user && <p className="mt-4 rounded-lg bg-amber-300/10 p-3 text-sm text-amber-100">Signed in as <strong>{user.email}</strong>, but this account does not have reviewer access.</p>}

          {authMode === 'choice' && (
            <div className="mt-5 space-y-2.5">
              <button type="button" onClick={() => void socialLogin('apple')} disabled={loading} className="flex min-h-12 w-full items-center justify-center gap-3 rounded-xl bg-white px-4 font-bold text-black hover:bg-slate-100 disabled:opacity-50">
                {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" /></svg>}
                Continue with Apple
              </button>
              <button type="button" onClick={() => void socialLogin('google')} disabled={loading} className="flex min-h-12 w-full items-center justify-center gap-3 rounded-xl border border-white/15 bg-white px-4 font-bold text-slate-800 hover:bg-slate-100 disabled:opacity-50">
                {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" /><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" /><path fill="#FBBC05" d="M5.84 14.09A6.6 6.6 0 0 1 5.49 12c0-.73.13-1.43.35-2.09V7.07H2.18A11 11 0 0 0 1 12c0 1.78.43 3.45 1.18 4.93l3.66-2.84z" /><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" /></svg>}
                Continue with Google
              </button>
              <div className="flex items-center gap-3 py-1 text-xs text-slate-500"><span className="h-px flex-1 bg-white/10" />or<span className="h-px flex-1 bg-white/10" /></div>
              <button type="button" onClick={() => { setAuthMode('email'); setError(null); setSuccess(null); }} disabled={loading} className="flex min-h-12 w-full items-center justify-center gap-3 rounded-xl border border-white/15 px-4 font-bold text-white hover:bg-white/10 disabled:opacity-50"><Mail className="h-5 w-5" /> Continue with email</button>
              <p className="pt-1 text-center text-xs leading-relaxed text-slate-500">Use an existing AusBUG account. Reviewer access is approved separately.</p>
            </div>
          )}

          {authMode === 'email' && (
            <form onSubmit={(event) => void emailLogin(event)} className="mt-5 space-y-3">
              <label className="block text-xs font-bold uppercase tracking-wide text-slate-400">Email
                <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" className="mt-1 min-h-11 w-full rounded-lg border border-white/10 bg-slate-950 px-3 text-sm text-white outline-none focus:border-cyan-300/60" />
              </label>
              <label className="block text-xs font-bold uppercase tracking-wide text-slate-400">Password
                <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="current-password" className="mt-1 min-h-11 w-full rounded-lg border border-white/10 bg-slate-950 px-3 text-sm text-white outline-none focus:border-cyan-300/60" />
              </label>
              <button type="submit" disabled={loading || !email.trim() || !password} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-cyan-400 font-bold text-slate-950 hover:bg-cyan-300 disabled:opacity-50">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />} Sign in</button>
              <div className="flex items-center justify-between gap-3 text-xs font-semibold">
                <button type="button" onClick={() => { setAuthMode('choice'); setError(null); }} className="flex items-center gap-1 text-slate-400 hover:text-white"><ChevronLeft className="h-3.5 w-3.5" /> All options</button>
                <button type="button" onClick={() => { setAuthMode('reset'); setError(null); setSuccess(null); }} className="text-cyan-300 hover:text-cyan-200">Forgot password?</button>
              </div>
            </form>
          )}

          {authMode === 'reset' && (
            <form onSubmit={(event) => void sendReset(event)} className="mt-5 space-y-3">
              <p className="text-sm text-slate-400">Enter the email used by your AusBUG account.</p>
              <label className="block text-xs font-bold uppercase tracking-wide text-slate-400">Email
                <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" className="mt-1 min-h-11 w-full rounded-lg border border-white/10 bg-slate-950 px-3 text-sm text-white outline-none focus:border-cyan-300/60" />
              </label>
              <button type="submit" disabled={loading || !email.trim()} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-cyan-400 font-bold text-slate-950 hover:bg-cyan-300 disabled:opacity-50">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />} Send reset link</button>
              <button type="button" onClick={() => { setAuthMode('email'); setError(null); setSuccess(null); }} className="flex items-center gap-1 text-xs font-semibold text-slate-400 hover:text-white"><ChevronLeft className="h-3.5 w-3.5" /> Back to email sign-in</button>
            </form>
          )}

          {user && <button type="button" onClick={() => void logout()} className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-white/10 text-sm font-semibold text-slate-300 hover:bg-white/10"><LogOut className="h-4 w-4" /> Sign out</button>}
          {error && <p className="mt-3 text-sm font-semibold text-rose-300">{error}</p>}
          {success && <p className="mt-3 text-sm font-semibold text-emerald-300">{success}</p>}
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
            <p className="mt-2 max-w-2xl text-sm text-slate-400">Signed-in contributions publish immediately. Contributor identity and reasoning remain private here so reviewers can audit, correct or remove a rating; OSM reconciliation problems still wait in Pending.</p>
            {reviewer && <p className="mt-1 text-xs text-slate-500">Signed in as {reviewer.name} · {reviewer.email}</p>}
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
            {items.map((item) => <ReviewCard key={`${item.dataset}-${item.segmentId}`} item={item} authorisedFetch={authorisedFetch} onReviewed={() => void loadQueue()} />)}
          </div>
        )}
      </div>
    </main>
  );
}
