/**
 * The link that gets somebody off a marketing list.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT CARRIES, AND WHY EACH PIECE
 *
 * A recipient clicking unsubscribe is not signed in and never will be, so the
 * link itself has to say who they are and whose list they are leaving. Signed,
 * because the alternative is a URL anybody can edit to unsubscribe anybody:
 * `?user=...&email=...` would let one competitor quietly empty another's list.
 *
 *   userId    whose list. Consent is held per business, so leaving one has no
 *             effect on another — the same person can be a client of two.
 *   email     the address that stops being written to. The consent state table
 *             is keyed on it, not on a contact row, because a person may exist
 *             on several contacts and may exist on none.
 *   contactId recorded with the decision where we have one, so the owner can
 *             see it on the client's timeline. NOT what identifies them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NO EXPIRY, DELIBERATELY.
 *
 * Every other token in this product expires, and this one must not. A marketing
 * email can sit in an inbox for a year before somebody finally gets annoyed
 * enough to click, and an expired unsubscribe link is a sender who made it hard
 * to leave. The law does not care when the email was sent.
 *
 * It is also not a credential: the worst thing a leaked one does is stop an
 * email the holder could have stopped by asking.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as jwt from 'jsonwebtoken';

import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'Consent', service: 'UnsubscribeToken' });

export interface UnsubscribePayload {
  userId: string;
  email: string;
  contactId?: string | null;
}

/**
 * The same secret the other public links are signed with.
 *
 * Throws rather than falling back to a constant: an unsigned unsubscribe link
 * is a list anybody can edit, and a misconfiguration must stop a send rather
 * than quietly produce one.
 */
function secret(): string {
  const configured = process.env.BOOKING_TOKEN_SECRET || process.env.NEXTAUTH_SECRET;

  if (!configured) {
    throw new Error(
      'BOOKING_TOKEN_SECRET (or NEXTAUTH_SECRET) must be set to sign unsubscribe links'
    );
  }

  return configured;
}

export function generateUnsubscribeToken(payload: UnsubscribePayload): string {
  return jwt.sign(
    {
      /* Short keys: this ends up in a URL that has to survive being wrapped by
         every mail client between here and the reader. */
      u: payload.userId,
      e: payload.email,
      ...(payload.contactId ? { c: payload.contactId } : {}),
    },
    secret()
  );
}

export function verifyUnsubscribeToken(token: string): UnsubscribePayload | null {
  /* Outside the try: a missing secret is a misconfiguration, not a bad token,
     and must not be swallowed as "this link is invalid". */
  const key = secret();

  try {
    const decoded = jwt.verify(token, key) as { u?: string; e?: string; c?: string };

    if (!decoded?.u || !decoded?.e) return null;

    return { userId: decoded.u, email: decoded.e, contactId: decoded.c ?? null };
  } catch (err) {
    /* The token itself is never logged: it names a real person's address. */
    logger.warn({ err }, 'Rejected an unsubscribe token');
    return null;
  }
}
