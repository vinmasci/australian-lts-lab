'use client';

import { useEffect, useState, type FormEvent } from 'react';
import {
  GoogleAuthProvider,
  OAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  type User,
} from 'firebase/auth';
import { Check, Loader2, Mail, PersonStanding, Signpost } from 'lucide-react';
import {
  DISMOUNT_OBSERVATION_LABELS,
  DISMOUNT_OBSERVATIONS,
  type DismountObservation,
  type DismountReportSegment,
  type DismountReportSummary,
} from '@/lib/dismount-reporting';
import { ausbugAuth } from '@/lib/firebase-review-client';
import { ltsAppPath } from '@/lib/client-path';

const EMPTY_SUMMARY: DismountReportSummary = {
  counts: { sign_present: 0, no_sign_visible: 0, unsure: 0 },
  total: 0,
  yourObservation: null,
  yourNote: '',
  yourUpdatedAt: null,
};

function authenticationMessage(error: unknown): string {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') return 'The email or password is incorrect.';
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return 'Sign-in was cancelled.';
  if (code === 'auth/too-many-requests') return 'Too many attempts. Please wait and try again.';
  return 'Sign-in could not be completed.';
}

export function DismountReport({ segment }: { segment: DismountReportSegment }) {
  const [summary, setSummary] = useState<DismountReportSummary>(EMPTY_SUMMARY);
  const [observation, setObservation] = useState<DismountObservation | null>(null);
  const [note, setNote] = useState('');
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [website, setWebsite] = useState('');

  useEffect(() => onAuthStateChanged(ausbugAuth, (currentUser) => {
    setUser(currentUser);
    setAuthReady(true);
  }), []);

  useEffect(() => {
    if (!authReady) return undefined;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ dataset: segment.dataset, segmentId: segment.segmentId });
        const token = user ? await user.getIdToken() : null;
        const response = await fetch(ltsAppPath(`/api/dismount-reports?${params}`), {
          cache: 'no-store',
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        const result = await response.json() as DismountReportSummary & { error?: string };
        if (!response.ok) throw new Error(result.error || 'Signage reports are unavailable.');
        if (!cancelled) {
          setSummary(result);
          setObservation(result.yourObservation);
          setNote(result.yourNote);
        }
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Signage reports are unavailable.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [authReady, segment, user]);

  const socialLogin = async (method: 'google' | 'apple') => {
    setAuthLoading(true);
    setError(null);
    try {
      const provider = method === 'google' ? new GoogleAuthProvider() : new OAuthProvider('apple.com');
      if (method === 'google') provider.setCustomParameters({ prompt: 'select_account' });
      if (method === 'apple') {
        provider.addScope('email');
        provider.addScope('name');
      }
      await signInWithPopup(ausbugAuth, provider);
    } catch (caught) {
      setError(authenticationMessage(caught));
    } finally {
      setAuthLoading(false);
    }
  };

  const emailLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthLoading(true);
    setError(null);
    try {
      await signInWithEmailAndPassword(ausbugAuth, email.trim(), password);
      setPassword('');
    } catch (caught) {
      setError(authenticationMessage(caught));
    } finally {
      setAuthLoading(false);
    }
  };

  const save = async () => {
    const currentUser = ausbugAuth.currentUser;
    if (!currentUser || observation === null) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const token = await currentUser.getIdToken();
      const response = await fetch(ltsAppPath('/api/dismount-reports'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ segment, observation, note, website }),
      });
      const result = await response.json() as DismountReportSummary & { error?: string };
      if (!response.ok) throw new Error(result.error || 'Report could not be saved.');
      setSummary(result);
      setObservation(result.yourObservation);
      setNote(result.yourNote);
      setMessage(observation === 'no_sign_visible'
        ? 'Saved for access verification. The OSM restriction stays in place until it is checked and corrected.'
        : 'Your signage observation has been saved.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Report could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mt-4 rounded-xl border border-slate-300/20 bg-slate-300/[0.07] p-3" aria-labelledby="dismount-report-title">
      <div className="flex items-start gap-2">
        <Signpost className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />
        <div>
          <h3 id="dismount-report-title" className="text-sm font-bold text-white">Check the dismount signage</h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-300">
            OSM currently says riders must dismount. Tell us what is physically signed here so the access tag can be verified.
          </p>
        </div>
      </div>

      <p className="mt-3 rounded-lg border border-amber-300/20 bg-amber-300/10 p-2.5 text-[11px] leading-relaxed text-amber-100">
        A report does not immediately remove the restriction or assign an LTS. Until it is verified, the map stays grey and routing treats this as a walk-bike link.
      </p>

      {!authReady || loading ? (
        <div className="mt-3 flex items-center gap-2 text-xs text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading signage reports…</div>
      ) : !user ? (
        <div className="mt-3 rounded-lg border border-white/10 bg-slate-950/45 p-3">
          <p className="text-xs font-bold text-white">Sign in to report what you saw</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => void socialLogin('apple')} disabled={authLoading} className="min-h-11 rounded-lg bg-white px-2 text-xs font-bold text-black disabled:opacity-50">Apple</button>
            <button type="button" onClick={() => void socialLogin('google')} disabled={authLoading} className="min-h-11 rounded-lg bg-white px-2 text-xs font-bold text-slate-800 disabled:opacity-50">Google</button>
          </div>
          <form onSubmit={(event) => void emailLogin(event)} className="mt-2 grid gap-2">
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" placeholder="Email" aria-label="Email" className="min-h-11 rounded-lg border border-white/10 bg-slate-950 px-3 text-xs text-white outline-none focus:border-slate-300/60" />
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="current-password" placeholder="Password" aria-label="Password" className="min-h-11 rounded-lg border border-white/10 bg-slate-950 px-3 text-xs text-white outline-none focus:border-slate-300/60" />
            <button type="submit" disabled={authLoading || !email.trim() || !password} className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-white/15 text-xs font-bold text-white disabled:opacity-50"><Mail className="h-4 w-4" /> Sign in with email</button>
          </form>
        </div>
      ) : (
        <>
          <div className="mt-3 grid gap-2" role="group" aria-label="Dismount signage observation">
            {DISMOUNT_OBSERVATIONS.map((value) => {
              const selected = observation === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setObservation(value)}
                  className={`flex min-h-11 items-center justify-between gap-3 rounded-lg border px-3 text-left text-xs font-bold transition ${selected ? 'border-white bg-white/15 ring-2 ring-white/25' : 'border-white/10 bg-slate-950/40 hover:bg-white/10'}`}
                  aria-pressed={selected}
                >
                  <span className="flex items-center gap-2"><PersonStanding className="h-4 w-4 text-slate-300" /> {DISMOUNT_OBSERVATION_LABELS[value]}</span>
                  <span className="flex items-center gap-1 text-[11px] text-slate-400">{summary.counts[value]}{summary.yourObservation === value && <Check className="h-3.5 w-3.5 text-white" />}</span>
                </button>
              );
            })}
          </div>
          <label className="mt-3 block text-[11px] font-semibold uppercase tracking-wide text-slate-400" htmlFor="dismount-note">What did you observe? <span className="normal-case tracking-normal text-slate-500">Optional</span></label>
          <textarea
            id="dismount-note"
            value={note}
            onChange={(event) => setNote(event.target.value.slice(0, 500))}
            rows={2}
            placeholder="For example: checked both approaches; no dismount sign visible. Don’t include personal information."
            className="mt-1 w-full resize-none rounded-lg border border-white/10 bg-slate-950/70 px-2.5 py-2 text-xs text-white outline-none placeholder:text-slate-600 focus:border-slate-300/60"
          />
          <input value={website} onChange={(event) => setWebsite(event.target.value)} className="hidden" tabIndex={-1} autoComplete="off" aria-hidden="true" />
          <button type="button" onClick={() => void save()} disabled={saving || observation === null} className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-slate-200 px-3 text-sm font-black text-slate-950 hover:bg-white disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Signpost className="h-4 w-4" />} Save signage report
          </button>
        </>
      )}
      {summary.total > 0 && <p className="mt-2 text-[11px] text-slate-400">{summary.total} rider{summary.total === 1 ? '' : 's'} reported this location.</p>}
      {message && <p className="mt-2 text-xs font-semibold text-emerald-300">{message}</p>}
      {error && <p className="mt-2 text-xs font-semibold text-rose-300">{error}</p>}
    </section>
  );
}
