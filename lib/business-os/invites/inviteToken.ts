import 'server-only';

/**
 * The invite link's secret (requirement §8.1, C-3, T-7).
 *
 * - 32 random bytes, base64url: 256 bits, 43 characters, URL-safe with no
 *   padding. Not a sequential id and not a UUID, so it cannot be guessed.
 * - Stored ONLY as its SHA-256 digest. A database read, including one made with
 *   the leaked service-role key, never yields a usable link. No slow hash and no
 *   pepper: 256 bits of entropy makes both unnecessary, and a slow hash would
 *   defeat the indexed lookup the public route depends on.
 * - Carried in the URL FRAGMENT (`/invite#t=…`). Fragments never reach a server
 *   or an access log; the page reads it, strips it, and POSTs it.
 *
 * Nothing here logs. The raw token must never be passed to a logger, an audit
 * entry, an error message or a column; the Pino `token` redaction is a backstop,
 * not the control.
 *
 * Server-only because of `node:crypto`, and because a client that could mint or
 * hash tokens would be a second place the rule lives.
 */

import { createHash, randomBytes } from 'node:crypto';
import { platformUrl } from '@/lib/utils/origins';

/** Bytes of randomness in one token. */
export const INVITE_TOKEN_BYTES = 32;

/** Exactly what `generateInviteToken` produces: 43 base64url characters. */
export const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** A new raw token. Shown once, in the create response, and never stored. */
export function generateInviteToken(): string {
  return randomBytes(INVITE_TOKEN_BYTES).toString('base64url');
}

/** Is this string shaped like a token? Checked BEFORE hashing (C-3). */
export function isWellFormedInviteToken(candidate: string): boolean {
  return INVITE_TOKEN_PATTERN.test(candidate);
}

/** The stored form: SHA-256, lowercase hex, 64 characters. */
export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** The link an admin copies: the platform origin, `/invite`, the token in the fragment. */
export function buildInviteLink(token: string): string {
  return `${platformUrl('/invite')}#t=${token}`;
}
