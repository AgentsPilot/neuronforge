/**
 * Who may reach the boost checkout (credits boost slice 3; SA F-14, C-1, C-6,
 * C-7, Q-6).
 *
 * Two server-only switches, read on every request:
 *   - `BUSINESS_OS_CREDITS_BOOST_ENABLED` (via `isBusinessOsCreditsBoostEnabled`):
 *     the feature's kill switch, default OFF. While it is off the route behaves
 *     as if it did not exist (404).
 *     ⚠️ SA C-1: it stays unset on Vercel (Preview and Production) until slice
 *     4a is merged and deployed. Before 4a, a paid boost reaches the
 *     agent-platform webhook handler, which no-ops and marks the event done.
 *   - `BUSINESS_OS_CREDITS_BOOST_TEST_ACCOUNTS`: an optional comma-separated
 *     list of account UUIDs. ONLY unset or blank means OPEN TO EVERY ACCOUNT
 *     while the flag is on: that is the launch switch (C-7). Set and non-blank,
 *     it ALWAYS restricts (SA CR-2): only the valid UUIDs in it pass. If it
 *     holds none (a typo, or emails instead of ids), the checkout is closed to
 *     everyone and an `error` is logged once — a mistyped list must never open
 *     the checkout to all. Blanks are ignored; an invalid entry is logged once
 *     at `warn`.
 *
 * `boostReturnUrl` builds the embedded checkout's `return_url` (SA C-6) from the
 * platform address resolver (`platformUrl` in `lib/utils/origins.ts`): an
 * address is never decided at a call site, and never from the request's Host
 * header. Outside development the resolved origin must be `https` and not a
 * loopback host, or it is `null` and the route refuses with
 * `payments_unavailable` before anything is reserved.
 *
 * @module lib/business-os/boost/boostCheckoutAccess
 */

import { isBusinessOsCreditsBoostEnabled } from '@/lib/utils/featureFlags';
import { platformOrigin, platformUrl } from '@/lib/utils/origins';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The landing slice 5 adds; `{CHECKOUT_SESSION_ID}` is filled in by Stripe. */
export const BOOST_RETURN_PATH = '/business-os?boost=return&session_id={CHECKOUT_SESSION_ID}';

let warnedRaw: string | null = null;

export interface BoostAccessLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

/**
 * The allow-list as valid lower-case UUIDs. `null` ONLY when unset or blank
 * (open to all). Set and non-blank, it always restricts: with no valid id it is
 * an EMPTY set (closed to all), never `null` (SA CR-2).
 */
export function parseBoostTestAccounts(raw: string | undefined, log?: BoostAccessLogger): ReadonlySet<string> | null {
  if (!raw || raw.trim() === '') return null;
  const entries = raw.split(',').map((entry) => entry.trim()).filter((entry) => entry !== '');
  const valid = entries.filter((entry) => UUID_PATTERN.test(entry)).map((entry) => entry.toLowerCase());
  const invalidCount = entries.length - valid.length;
  if (log && warnedRaw !== raw) {
    warnedRaw = raw;
    // The entries themselves are never logged: they are account ids (or emails).
    if (valid.length === 0) {
      log.error({ invalidCount }, 'BUSINESS_OS_CREDITS_BOOST_TEST_ACCOUNTS holds no valid account id; the boost checkout is closed to every account');
    } else if (invalidCount > 0) {
      log.warn({ invalidCount }, 'BUSINESS_OS_CREDITS_BOOST_TEST_ACCOUNTS holds invalid entries; they are ignored');
    }
  }
  return new Set(valid);
}

/** Is the checkout reachable for this account right now? */
export function isBoostCheckoutOpenFor(accountId: string, log?: BoostAccessLogger): boolean {
  if (!isBusinessOsCreditsBoostEnabled()) return false;
  const allowList = parseBoostTestAccounts(process.env.BUSINESS_OS_CREDITS_BOOST_TEST_ACCOUNTS, log);
  return allowList === null || allowList.has(accountId.toLowerCase());
}

const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/i;

/**
 * The embedded checkout's return URL (C-6), or `null` when the resolver's
 * origin is not one a paying customer's browser can come back to.
 *
 * Takes no request: the Host header can never shape it. `platformUrl` only
 * prefixes the origin, so Stripe's `{CHECKOUT_SESSION_ID}` placeholder stays
 * unencoded.
 */
export function boostReturnUrl(): string | null {
  let origin: URL;
  try {
    origin = new URL(platformOrigin());
  } catch {
    return null;
  }
  if (process.env.NODE_ENV !== 'development') {
    if (origin.protocol !== 'https:' || LOOPBACK_HOST.test(origin.hostname)) return null;
  }
  return platformUrl(BOOST_RETURN_PATH);
}
