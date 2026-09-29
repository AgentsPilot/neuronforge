'use client';

/**
 * The champion signup form (invite-only signup, Slice 1b; FR-11, FR-13, T-5,
 * F-2, F-6, R-6, R-13).
 *
 * Two steps:
 *   1. "Send me a code" → the server emails a 6-digit code to the INVITED
 *      address. The page only ever shows it masked (`d•••@example.com`); the
 *      email is locked (BQ-2) and there is no email field at all.
 *   2. The code, a password and its confirmation → the server claims the
 *      invite, creates the account and finalises it. On success it returns the
 *      full email (only now, after mailbox proof), and the browser signs in
 *      with the password it just set, through the audited `signInWithPassword`
 *      (F-2: the server mints no session). Then onboarding.
 *
 * If that sign-in fails, the account still exists and is complete: the page
 * says so and links to the normal sign-in page.
 *
 * The token is held by the parent page in memory and passed in; the password
 * lives in component state only, is sent once in a POST body, and is never put
 * in a URL, storage or a log. Every error message is keyed by the server's
 * machine-readable code, in the invite's language, in a live region.
 */

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

import { signInWithPassword } from '@/lib/client/auth-actions';
import { marketingUrl } from '@/lib/utils/origins';

import type { SignupCopy } from './invitePageCopy';

/** bcrypt reads at most 72 bytes (R-13). The server checks the same. */
const PASSWORD_MAX_BYTES = 72;
const PASSWORD_MIN_CHARACTERS = 8;

type Step = 'start' | 'code' | 'ready';

interface ApiBody {
  success?: boolean;
  error?: string;
  attemptsRemaining?: number;
  retryAfterSeconds?: number;
  data?: { email?: string; redirectTo?: string; state?: string };
}

export interface SignupFormProps {
  token: string;
  maskedEmail: string;
  copy: SignupCopy;
  /** The page's own "Sign in" label, for the fallback link. */
  signInLabel: string;
}

function characters(value: string): number {
  return Array.from(value).length;
}

/**
 * UTF-8 length, counted per code point (the same number `TextEncoder` gives,
 * without depending on it being present).
 */
function utf8Bytes(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const point = character.codePointAt(0) ?? 0;
    bytes += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
  }
  return bytes;
}

async function post(url: string, body: Record<string, string>): Promise<{ status: number; body: ApiBody | null }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
  });
  return { status: response.status, body: (await response.json().catch(() => null)) as ApiBody | null };
}

/** The message for a server answer, in the invite's language. */
function messageFor(body: ApiBody | null, copy: SignupCopy): string {
  const errors = copy.errors;
  if (body?.data?.state === 'not_recognised') return errors.no_longer_available;
  switch (body?.error) {
    case 'code_invalid':
      return errors.code_invalid(body.attemptsRemaining ?? 0);
    case 'code_recently_sent':
      return errors.code_recently_sent(body.retryAfterSeconds ?? 60);
    case 'code_expired':
    case 'code_locked':
    case 'code_limit_reached':
    case 'code_not_sent':
    case 'existing_account':
    case 'signup_in_progress':
    case 'signed_in':
    case 'weak_password':
      return errors[body.error];
    case 'used':
    case 'revoked':
    case 'expired':
    case 'unavailable':
    case 'paid_invites_not_available':
      return errors.no_longer_available;
    default:
      return errors.generic;
  }
}

export function SignupForm({ token, maskedEmail, copy, signInLabel }: SignupFormProps) {
  const router = useRouter();
  const [step, setStep] = useState<Step>('start');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  const requestCode = async () => {
    setBusy(true);
    setError(null);
    try {
      const answer = await post('/api/public/invites/signup/code', { token });
      if (answer.status === 200 && answer.body?.success) {
        setStep('code');
        setCode('');
      } else {
        setError(messageFor(answer.body, copy));
      }
    } catch {
      setError(copy.errors.generic);
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!/^[0-9]{6}$/.test(code)) return setError(copy.errors.code_format);
    if (characters(password) < PASSWORD_MIN_CHARACTERS) return setError(copy.errors.password_short);
    if (utf8Bytes(password) > PASSWORD_MAX_BYTES) return setError(copy.errors.password_long);
    if (password !== confirm) return setError(copy.errors.password_mismatch);

    setBusy(true);
    try {
      const answer = await post('/api/public/invites/signup/complete', { token, signupCode: code, password });
      const email = answer.body?.data?.email;
      if (answer.status !== 200 || !answer.body?.success || !email) {
        setError(messageFor(answer.body, copy));
        return;
      }

      // F-2: sign in with the password just set. The server minted no session.
      const signedIn = await signInWithPassword(email, password);
      if (signedIn.ok) {
        router.replace(answer.body.data?.redirectTo ?? '/onboarding-chat');
        return;
      }
      setStep('ready');
    } catch {
      setError(copy.errors.generic);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section data-testid="invite-signup" className="space-y-4 border-t border-slate-200 pt-5">
      <h2 className="text-lg font-semibold">{step === 'ready' ? copy.readyHeading : copy.heading}</h2>

      <p data-testid="invite-signup-error" role="alert" aria-live="polite" className="min-h-[1.25rem] text-sm text-rose-700">
        {error}
      </p>

      {step === 'start' && (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">{copy.codeWillGoTo(maskedEmail)}</p>
          <button
            type="button"
            onClick={() => void requestCode()}
            disabled={busy}
            className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60"
          >
            {busy ? copy.sending : copy.sendCode}
          </button>
        </div>
      )}

      {step === 'code' && (
        <form data-testid="invite-signup-form" onSubmit={(event) => void submit(event)} className="space-y-3" noValidate>
          <p className="text-sm text-slate-600">{copy.codeSentTo(maskedEmail)}</p>

          <label className="block text-sm font-medium">
            {copy.codeLabel}
            <input
              name="signupCode"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              dir="ltr"
              className="mt-1 block w-full rounded border border-slate-300 px-3 py-2 font-mono tracking-widest"
            />
          </label>

          <div>
            <label className="block text-sm font-medium">
              {copy.passwordLabel}
              <input
                type="password"
                name="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                aria-describedby="invite-signup-password-hint"
                className="mt-1 block w-full rounded border border-slate-300 px-3 py-2"
              />
            </label>
            <p id="invite-signup-password-hint" className="mt-1 text-xs text-slate-500">
              {copy.passwordHint}
            </p>
          </div>

          <label className="block text-sm font-medium">
            {copy.confirmLabel}
            <input
              type="password"
              name="confirmPassword"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              autoComplete="new-password"
              className="mt-1 block w-full rounded border border-slate-300 px-3 py-2"
            />
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={busy}
              className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60"
            >
              {busy ? copy.creating : copy.create}
            </button>
            <button
              type="button"
              onClick={() => void requestCode()}
              disabled={busy}
              className="text-sm text-slate-600 underline disabled:opacity-60"
            >
              {copy.resend}
            </button>
          </div>
        </form>
      )}

      {step === 'ready' && (
        <div data-testid="invite-signup-ready" className="space-y-3">
          <p className="text-sm text-slate-600">{copy.readyBody}</p>
          <a
            href={marketingUrl('/login')}
            rel="noreferrer"
            className="inline-block rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            {signInLabel}
          </a>
        </div>
      )}
    </section>
  );
}
