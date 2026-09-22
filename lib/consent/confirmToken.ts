/**
 * The link in a "confirm your subscription" email.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS TOKEN IS STRICTER THAN THE UNSUBSCRIBE ONE
 *
 * An unsubscribe token only ever REMOVES permission, so the worst a leaked one
 * achieves is an unsubscribe the person can undo. This one CREATES permission.
 * A forgeable or guessable token here manufactures consent that never happened,
 * which is the exact thing double opt-in exists to make impossible.
 *
 * So, two differences:
 *
 *   IT EXPIRES. A confirmation link is a request that was made at a moment, not
 *   a standing permission. Seven days: long enough for somebody who reads their
 *   email weekly, short enough that a link sitting in an archived mailbox
 *   cannot be clicked into a subscription two years later. An expired link is
 *   not a dead end — the page it lands on offers to send a fresh one.
 *
 *   IT REFUSES TO SIGN WITHOUT A CONFIGURED SECRET. `BookingEmailService` falls
 *   back to the literal string 'fallback-secret-change-in-prod', which for this
 *   token would mean anyone who has read this open-source-shaped codebase can
 *   mint consent for any address at any business. It throws instead.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/consent/confirmToken
 */

import jwt from 'jsonwebtoken';

/** Kept short: it travels inside a URL, in an email, through link rewriters. */
export interface ConsentConfirmPayload {
  /** The business whose list this is. */
  u: string;
  /** The address being confirmed. */
  e: string;
  /** The CRM contact, where one was created at signup. */
  c?: string | null;
  /** Which form they used, for the audit line. */
  s: string;
  /** The language they read the statement in. */
  l: string;
  /** Version claim, so every outstanding token can be invalidated at once. */
  v: 1;
}

const TTL = '7d';

function secret(): string {
  const configured = process.env.CONSENT_TOKEN_SECRET || process.env.NEXTAUTH_SECRET;

  if (!configured) {
    // Deliberately fatal. A confirmation link signed with a known string is a
    // consent generator, and failing to send the email is strictly better than
    // sending one that anybody can forge.
    throw new Error(
      'CONSENT_TOKEN_SECRET (or NEXTAUTH_SECRET) must be set to send consent confirmations'
    );
  }

  return configured;
}

export function signConsentConfirmToken(payload: Omit<ConsentConfirmPayload, 'v'>): string {
  return jwt.sign({ ...payload, v: 1 }, secret(), { expiresIn: TTL });
}

export type ConfirmTokenResult =
  | { ok: true; payload: ConsentConfirmPayload }
  /** Distinguished from invalid, because the page can offer a fresh link. */
  | { ok: false; reason: 'expired' }
  | { ok: false; reason: 'invalid' };

export function verifyConsentConfirmToken(token: string): ConfirmTokenResult {
  try {
    const payload = jwt.verify(token, secret()) as ConsentConfirmPayload;

    // A token minted before a version bump is refused rather than honoured.
    if (payload.v !== 1 || !payload.u || !payload.e) {
      return { ok: false, reason: 'invalid' };
    }

    return { ok: true, payload };
  } catch (error) {
    if (error instanceof Error && error.name === 'TokenExpiredError') {
      return { ok: false, reason: 'expired' };
    }
    return { ok: false, reason: 'invalid' };
  }
}
