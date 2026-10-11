/**
 * Turns an admin route's `Response` into data or one admin-facing message, with
 * the §5.10 error-copy precedence built in (Admin Layout Standard C-4).
 *
 * It never calls `fetch` (Health pins exactly one fetch per read) and it reads
 * only `response.ok`, `response.status` and, through `readJsonBody`,
 * `response.json()` (RC-2): no headers, no `text()`, no `clone()`, no
 * `statusText`. A network failure cannot reach this helper (it receives a
 * `Response`), so the caller's `catch` around `fetch` shows
 * `ADMIN_NETWORK_ERROR`.
 *
 * The copy below is the only copy of these words in the admin folder, so later
 * pages cannot drift.
 */

import { readJsonBody } from './readJsonBody';

/** §5.10 rule 3: a network failure (the fetch itself rejected). */
export const ADMIN_NETWORK_ERROR = 'Could not reach the server. Check your connection and try again.';

/** §5.10 "Session ended": 401 or 403, for pages that opt in (RC-4). */
const ADMIN_SESSION_ENDED = 'Your admin session has ended. Sign in again.';

/** §5.10 rule 2: the page's fixed fallback when the body has no usable error. */
function adminReadFallback(what: string): string {
  return `Could not read ${what}. Try again in a moment.`;
}

export interface ReadAdminResponseOptions {
  /** Noun phrase for the fixed fallback: "Could not read {what}. Try again in a moment." */
  what: string;
  /** RC-4: 401 and 403 show "Your admin session has ended. Sign in again." Default false. */
  sessionEndedCopy?: boolean;
}

export type AdminReadResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; message: string };

export async function readAdminResponse<T>(
  response: Response,
  options: ReadAdminResponseOptions,
): Promise<AdminReadResult<T>> {
  const { status } = response;
  const body = await readJsonBody(response);

  // Status first: a 2xx counts only with a readable body that says success.
  if (response.ok && body && body.success === true) {
    // No runtime shape check: the same trust the pages placed in their own cast
    // of the route's body before this helper existed.
    return { ok: true, status, data: body.data as T };
  }

  if (options.sessionEndedCopy === true && (status === 401 || status === 403)) {
    return { ok: false, status, message: ADMIN_SESSION_ENDED };
  }

  // Rule 1: the route's own error string, verbatim. Rule 4: never a parser
  // message and never statusText, so anything else falls to the fixed copy.
  const routeError = body?.error;
  if (typeof routeError === 'string' && routeError.trim() !== '') {
    return { ok: false, status, message: routeError };
  }

  return { ok: false, status, message: adminReadFallback(options.what) };
}
