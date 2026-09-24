/**
 * Which timezone a new business gets, and whether anybody actually said so.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A FUNCTION RATHER THAN A FEW LINES IN THE ROUTE
 *
 * Two columns answer two different questions — `user_preferences.timezone` is
 * the best value available, `timezone_confirmed_at` is whether a human has
 * answered — and the rule that keeps them honest is easy to get subtly wrong at
 * a call site. `20261007_timezone_confirmed.sql` exists because they were
 * conflated once already: a stored 'UTC' could not be told from the column
 * default, so the readiness gate protected nobody.
 *
 * Two places now write this on a new account (the build route and the
 * onboarding hook), so the rule lives in one place they can share rather than
 * being re-derived in each.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Where a candidate zone came from, weakest last. */
export type TimezoneSource = 'browser' | 'edge';

export interface ResolvedTimezone {
  /** A zone `Intl` accepts, or null when nothing offered a usable one. */
  zone: string | null;
  source: TimezoneSource | null;
  /**
   * Whether this counts as ANSWERED, for `timezone_confirmed_at`.
   *
   * True only for the browser's zone, which the onboarding flow shows and the
   * owner accepts by finishing. An IP-derived guess was never on screen, so
   * recording it as confirmed would answer the question on behalf of somebody
   * who was never asked — and the readiness card would never ask again.
   */
  confirmed: boolean;
  /** Candidates rejected because `Intl` does not recognise them. */
  rejected: Array<{ value: string; source: TimezoneSource }>;
}

/**
 * `Intl` is the arbiter of a valid zone, not a list we maintain.
 *
 * An unrecognised string throws rather than returning false, and a bad guess
 * must not cost the account its timezone — so it is dropped and the next
 * candidate tried.
 */
function isRealZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the zone from the sources a request can offer, best first.
 *
 * The BROWSER knows the machine's own setting and is shown to the owner. The
 * EDGE resolved the caller's IP before the request arrived and costs nothing to
 * read, but it is a guess: a VPN or a trip abroad gets it wrong.
 *
 * The edge exists here because the browser value depended on each caller
 * remembering to send it, and only one page did. A route that needs a fact
 * should not rely on callers to volunteer it — anything else reaching it built
 * an account with no zone at all, while the request had been carrying one.
 */
export function resolveOnboardingTimezone(
  browser: string | null | undefined,
  edge: string | null | undefined
): ResolvedTimezone {
  const candidates: Array<{ value: string; source: TimezoneSource }> = [];
  if (browser?.trim()) candidates.push({ value: browser.trim(), source: 'browser' });
  if (edge?.trim()) candidates.push({ value: edge.trim(), source: 'edge' });

  const rejected: Array<{ value: string; source: TimezoneSource }> = [];

  for (const candidate of candidates) {
    if (isRealZone(candidate.value)) {
      return {
        zone: candidate.value,
        source: candidate.source,
        confirmed: candidate.source === 'browser',
        rejected,
      };
    }
    rejected.push(candidate);
  }

  return { zone: null, source: null, confirmed: false, rejected };
}
