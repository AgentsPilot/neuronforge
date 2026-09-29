import 'server-only';

/**
 * The signup code, and the pure decisions around it (invite-only signup,
 * Slice 1b; T-5, R-6, F-11, SA D-2, D-dev-2).
 *
 * ── The hash (F-11, approved) ───────────────────────────────────────────────
 * SHA-256 over `<invite id>:<code>`, unkeyed. A 6-digit code has 10^6 values,
 * so ANY stored form can be reversed offline, keyed or not; what makes that
 * worthless is that completing a signup also needs the raw invite token, which
 * is never stored. The invite id is in the input so the same code on two
 * invites hashes differently. A keyed HMAC would need a new Vercel secret for
 * no real gain.
 *
 * ── The comparison ──────────────────────────────────────────────────────────
 * `timingSafeEqual` over the two digests, so a guess learns nothing from time.
 *
 * ── The decisions are pure ──────────────────────────────────────────────────
 * `decideCodeIssue` and `decideCodeAttempt` read the row's counters and a clock
 * and say what the repository's compare-and-swap should write. The CAS is what
 * makes it safe under concurrency; these only decide.
 */

import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

import { INVITE_SIGNUP_CODE_POLICY } from './signupCodePolicy';

export const SIGNUP_CODE_PATTERN = /^[0-9]{6}$/;

/** A fresh 6-digit code, uniformly drawn, zero-padded. */
export function generateSignupCode(): string {
  const space = 10 ** INVITE_SIGNUP_CODE_POLICY.digits;
  return String(randomInt(0, space)).padStart(INVITE_SIGNUP_CODE_POLICY.digits, '0');
}

/** SHA-256 hex over `<inviteId>:<code>` (F-11). */
export function hashSignupCode(inviteId: string, code: string): string {
  return createHash('sha256').update(`${inviteId}:${code}`, 'utf8').digest('hex');
}

/** Does `code` match the stored hash for this invite? Constant-time over the digests. */
export function signupCodeMatches(storedHash: string | null, inviteId: string, code: string): boolean {
  if (!storedHash || !/^[0-9a-f]{64}$/.test(storedHash) || !SIGNUP_CODE_PATTERN.test(code)) return false;
  const expected = Buffer.from(storedHash, 'hex');
  const actual = Buffer.from(hashSignupCode(inviteId, code), 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * The invited address as the page may show it before mailbox proof (R-6, F-6):
 * at most the first character of the local part, then the domain.
 * `dana@example.com` → `d•••@example.com`.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '•••';
  const first = Array.from(email.slice(0, at))[0];
  return `${first}•••@${email.slice(at + 1)}`;
}

// ── Issuing a code (the per-invite rate limit) ──────────────────────────────

export interface CodeIssueFacts {
  signup_code_sent_count: number;
  signup_code_window_started_at: string | null;
  signup_code_last_sent_at: string | null;
}

export type CodeIssueDecision =
  | { ok: true; sentCount: number; windowStartedAt: Date; expiresAt: Date; resendAvailableAt: Date }
  | { ok: false; reason: 'code_recently_sent' | 'code_limit_reached'; retryAfterSeconds: number };

const SECOND = 1000;

/** May a new code be sent now, and what do the counters become if so? */
export function decideCodeIssue(row: CodeIssueFacts, now: Date): CodeIssueDecision {
  const policy = INVITE_SIGNUP_CODE_POLICY;
  const nowMs = now.getTime();

  const lastSent = row.signup_code_last_sent_at ? Date.parse(row.signup_code_last_sent_at) : NaN;
  if (Number.isFinite(lastSent)) {
    const readyAt = lastSent + policy.minResendSeconds * SECOND;
    if (nowMs < readyAt) {
      return { ok: false, reason: 'code_recently_sent', retryAfterSeconds: Math.ceil((readyAt - nowMs) / SECOND) };
    }
  }

  const windowMs = policy.windowHours * 3600 * SECOND;
  const windowStart = row.signup_code_window_started_at ? Date.parse(row.signup_code_window_started_at) : NaN;
  const windowActive = Number.isFinite(windowStart) && nowMs < windowStart + windowMs;
  const sentInWindow = windowActive ? row.signup_code_sent_count : 0;

  if (sentInWindow >= policy.maxSendsPerWindow) {
    return {
      ok: false,
      reason: 'code_limit_reached',
      retryAfterSeconds: Math.max(1, Math.ceil((windowStart + windowMs - nowMs) / SECOND)),
    };
  }

  return {
    ok: true,
    sentCount: sentInWindow + 1,
    windowStartedAt: windowActive ? new Date(windowStart) : now,
    expiresAt: new Date(nowMs + policy.ttlMinutes * 60 * SECOND),
    resendAvailableAt: new Date(nowMs + policy.minResendSeconds * SECOND),
  };
}

// ── Checking a code attempt ─────────────────────────────────────────────────

export interface CodeAttemptFacts {
  signup_code_hash: string | null;
  signup_code_expires_at: string | null;
  signup_code_attempts: number;
}

export type CodeAttemptDecision =
  | { ok: true; observedAttempts: number; attemptsRemainingAfter: number }
  | { ok: false; reason: 'code_expired' | 'code_locked' };

/** May one more attempt be counted against the live code? (D-5: counted BEFORE comparing.) */
export function decideCodeAttempt(row: CodeAttemptFacts, now: Date): CodeAttemptDecision {
  const expiresAt = row.signup_code_expires_at ? Date.parse(row.signup_code_expires_at) : NaN;
  if (!row.signup_code_hash || !Number.isFinite(expiresAt) || now.getTime() >= expiresAt) {
    return { ok: false, reason: 'code_expired' };
  }
  if (row.signup_code_attempts >= INVITE_SIGNUP_CODE_POLICY.maxAttempts) {
    return { ok: false, reason: 'code_locked' };
  }
  return {
    ok: true,
    observedAttempts: row.signup_code_attempts,
    attemptsRemainingAfter: INVITE_SIGNUP_CODE_POLICY.maxAttempts - (row.signup_code_attempts + 1),
  };
}

// ── The FR-12a failure message (SA D-2) ─────────────────────────────────────

/** The longest message the failure record may hold (the SQL CHECK says the same). */
export const FAILURE_MESSAGE_MAX = 300;

const EMAIL_SHAPED = /[^\s@<>()"',;:]+@[^\s@<>()"',;:]+/g;

/**
 * A failure message safe to store and show: every email-shaped substring
 * replaced, then cut to 300 characters (counted as SQL counts them).
 */
export function scrubFailureMessage(message: string | null | undefined): string | null {
  if (!message) return null;
  const scrubbed = message.replace(EMAIL_SHAPED, '[email]').replace(/\s+/g, ' ').trim();
  if (!scrubbed) return null;
  return Array.from(scrubbed).slice(0, FAILURE_MESSAGE_MAX).join('');
}
