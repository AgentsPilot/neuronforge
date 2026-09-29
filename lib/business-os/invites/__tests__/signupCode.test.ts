/**
 * The sign-up code and its pure decisions (Slice 1b; T-5, R-6, F-11, SA D-2,
 * D-4): generation, the per-invite hash, the constant-time comparison, the
 * mask, the send limit (60 s, 5 per 24 h), the attempt limit (5 per code), the
 * lease, and the failure-message scrub.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import {
  FAILURE_MESSAGE_MAX,
  SIGNUP_CODE_PATTERN,
  decideCodeAttempt,
  decideCodeIssue,
  generateSignupCode,
  hashSignupCode,
  maskEmail,
  scrubFailureMessage,
  signupCodeMatches,
} from '../signupCode';
import {
  COMPLETE_ROUTE_MAX_DURATION_SECONDS,
  INVITE_CLAIM_LEASE_SECONDS,
  INVITE_SIGNUP_CODE_POLICY,
  claimLeaseCutoff,
  isClaimLive,
} from '../signupCodePolicy';

const INVITE = '11111111-1111-4111-8111-111111111111';
const OTHER_INVITE = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-10-01T12:00:00.000Z');
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString();

describe('the policy (T-5, SA D-4)', () => {
  it('is 6 digits, 10 minutes, 5 attempts, 1 per 60 s, 5 per 24 h', () => {
    expect(INVITE_SIGNUP_CODE_POLICY).toEqual({
      digits: 6,
      ttlMinutes: 10,
      maxAttempts: 5,
      minResendSeconds: 60,
      maxSendsPerWindow: 5,
      windowHours: 24,
    });
  });

  it('the claim lease exceeds the complete route maxDuration, and the route declares the same number', () => {
    expect(INVITE_CLAIM_LEASE_SECONDS).toBeGreaterThan(COMPLETE_ROUTE_MAX_DURATION_SECONDS);
    const route = readFileSync(join(process.cwd(), 'app', 'api', 'public', 'invites', 'signup', 'complete', 'route.ts'), 'utf8');
    expect(route).toContain(`export const maxDuration = ${COMPLETE_ROUTE_MAX_DURATION_SECONDS};`);
  });

  it('a claim is live strictly within the lease, and an unreadable time is not live', () => {
    expect(claimLeaseCutoff(NOW).toISOString()).toBe(at(-INVITE_CLAIM_LEASE_SECONDS * 1000));
    expect(isClaimLive(at(-1000), NOW)).toBe(true);
    expect(isClaimLive(at(-INVITE_CLAIM_LEASE_SECONDS * 1000), NOW)).toBe(false);
    expect(isClaimLive(null, NOW)).toBe(false);
    expect(isClaimLive('not a date', NOW)).toBe(false);
  });
});

describe('the code', () => {
  it('is six zero-padded digits, drawn across the whole range', () => {
    const draws = Array.from({ length: 5000 }, generateSignupCode);
    for (const code of draws) expect(code).toMatch(SIGNUP_CODE_PATTERN);
    expect(new Set(draws).size).toBeGreaterThan(4900);
  });

  it('F-11: the hash is sha256 hex over "<invite id>:<code>", so one code hashes differently per invite', () => {
    expect(hashSignupCode(INVITE, '012345')).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSignupCode(INVITE, '012345')).toBe(hashSignupCode(INVITE, '012345'));
    expect(hashSignupCode(INVITE, '012345')).not.toBe(hashSignupCode(OTHER_INVITE, '012345'));
  });

  it('matches only the right code for the right invite, and never a malformed one', () => {
    const stored = hashSignupCode(INVITE, '012345');
    expect(signupCodeMatches(stored, INVITE, '012345')).toBe(true);
    expect(signupCodeMatches(stored, INVITE, '012346')).toBe(false);
    expect(signupCodeMatches(stored, OTHER_INVITE, '012345')).toBe(false);
    expect(signupCodeMatches(stored, INVITE, '12345')).toBe(false);
    expect(signupCodeMatches(null, INVITE, '012345')).toBe(false);
    expect(signupCodeMatches('not-hex', INVITE, '012345')).toBe(false);
  });

  it('compares in constant time', () => {
    const source = readFileSync(join(process.cwd(), 'lib', 'business-os', 'invites', 'signupCode.ts'), 'utf8');
    expect(source).toContain('timingSafeEqual(expected, actual)');
  });
});

describe('R-6: the mask', () => {
  it.each([
    ['dana@example.com', 'd•••@example.com'],
    ['d@example.com', 'd•••@example.com'],
    ['da@example.com', 'd•••@example.com'],
    ['a.very.long.local.part+tag@sub.example.co.uk', 'a•••@sub.example.co.uk'],
    ['לא@example.com', 'ל•••@example.com'],
  ])('%s → %s', (email, masked) => {
    expect(maskEmail(email)).toBe(masked);
  });

  it('never reveals more than the first character of the local part', () => {
    expect(maskEmail('secret@example.com')).not.toContain('ecret');
    expect(maskEmail('no-at-sign')).toBe('•••');
  });
});

describe('the send limit (option A)', () => {
  const fresh = { signup_code_sent_count: 0, signup_code_window_started_at: null, signup_code_last_sent_at: null };

  it('the first code opens a 24 h window, expires in 10 minutes, and allows a resend after 60 s', () => {
    const decision = decideCodeIssue(fresh, NOW);
    expect(decision).toEqual({
      ok: true,
      sentCount: 1,
      windowStartedAt: NOW,
      expiresAt: new Date(at(10 * 60_000)),
      resendAvailableAt: new Date(at(60_000)),
    });
  });

  it('a second code within 60 s is refused with the seconds to wait; at 60 s it is allowed', () => {
    const recent = { signup_code_sent_count: 1, signup_code_window_started_at: at(-59_000), signup_code_last_sent_at: at(-59_000) };
    expect(decideCodeIssue(recent, NOW)).toEqual({ ok: false, reason: 'code_recently_sent', retryAfterSeconds: 1 });
    const due = { ...recent, signup_code_last_sent_at: at(-60_000) };
    expect(decideCodeIssue(due, NOW)).toMatchObject({ ok: true, sentCount: 2 });
  });

  it('the sixth code in 24 h is refused until the window ends; after it, the count restarts', () => {
    const full = { signup_code_sent_count: 5, signup_code_window_started_at: at(-3600_000), signup_code_last_sent_at: at(-120_000) };
    expect(decideCodeIssue(full, NOW)).toEqual({ ok: false, reason: 'code_limit_reached', retryAfterSeconds: 23 * 3600 });
    const lapsed = { ...full, signup_code_window_started_at: at(-24 * 3600_000) };
    expect(decideCodeIssue(lapsed, NOW)).toMatchObject({ ok: true, sentCount: 1, windowStartedAt: NOW });
  });
});

describe('the attempt limit (T-5, D-5)', () => {
  const live = { signup_code_hash: 'a'.repeat(64), signup_code_expires_at: at(60_000), signup_code_attempts: 0 };

  it('counts an attempt on a live code and says how many remain after it', () => {
    expect(decideCodeAttempt(live, NOW)).toEqual({ ok: true, observedAttempts: 0, attemptsRemainingAfter: 4 });
    expect(decideCodeAttempt({ ...live, signup_code_attempts: 4 }, NOW)).toEqual({
      ok: true,
      observedAttempts: 4,
      attemptsRemainingAfter: 0,
    });
  });

  it('five used attempts lock the code', () => {
    expect(decideCodeAttempt({ ...live, signup_code_attempts: 5 }, NOW)).toEqual({ ok: false, reason: 'code_locked' });
  });

  it('no code, or a code at or past its expiry, is expired', () => {
    expect(decideCodeAttempt({ ...live, signup_code_hash: null }, NOW)).toEqual({ ok: false, reason: 'code_expired' });
    expect(decideCodeAttempt({ ...live, signup_code_expires_at: NOW.toISOString() }, NOW)).toEqual({ ok: false, reason: 'code_expired' });
    expect(decideCodeAttempt({ ...live, signup_code_expires_at: null }, NOW)).toEqual({ ok: false, reason: 'code_expired' });
  });
});

describe('SA D-2: the failure message is scrubbed', () => {
  it('replaces every email-shaped substring, and keeps the rest', () => {
    expect(scrubFailureMessage('A user with this email address (dana@example.com) has already been registered')).toBe(
      'A user with this email address ([email]) has already been registered'
    );
    expect(scrubFailureMessage('two: a@b.co and "c.d+e@f.example.org"')).toBe('two: [email] and "[email]"');
  });

  it('cuts to 300 characters, counted as SQL counts them, and maps empty to null', () => {
    expect(Array.from(scrubFailureMessage('x'.repeat(500)) ?? '')).toHaveLength(FAILURE_MESSAGE_MAX);
    expect(Array.from(scrubFailureMessage('😀'.repeat(400)) ?? '')).toHaveLength(FAILURE_MESSAGE_MAX);
    expect(scrubFailureMessage('')).toBeNull();
    expect(scrubFailureMessage(null)).toBeNull();
  });
});
