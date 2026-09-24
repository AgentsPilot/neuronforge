/**
 * A new business's timezone, and whether anyone actually answered.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The timezone used to depend on the CALLER remembering to send it, and exactly
 * one page did. Anything else reaching the build route — the test harness, a
 * retry, any surface added later — created an account with no zone at all,
 * while the request itself had been carrying one at the edge the whole time.
 *
 * The second half matters as much as the first: an IP-derived zone is a guess
 * nobody was shown, so storing it must NOT mark the question answered. That is
 * the distinction `20261007_timezone_confirmed.sql` was written to protect, and
 * this is where it would be lost again.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { resolveOnboardingTimezone } from '../onboardingTimezone';

describe('resolving a new business timezone', () => {
  it('prefers the browser, which knows the machine’s own setting', () => {
    const result = resolveOnboardingTimezone('Asia/Jerusalem', 'America/New_York');

    expect(result.zone).toBe('Asia/Jerusalem');
    expect(result.source).toBe('browser');
  });

  it('falls back to the edge when the caller sent nothing', () => {
    // The whole point: a caller that forgets no longer costs the account its
    // timezone, because the request was carrying one all along.
    const result = resolveOnboardingTimezone(undefined, 'America/New_York');

    expect(result.zone).toBe('America/New_York');
    expect(result.source).toBe('edge');
  });

  it('treats the browser’s zone as ANSWERED', () => {
    // It is shown in the flow and accepted by finishing the build, so the
    // readiness card should not ask again.
    expect(resolveOnboardingTimezone('Asia/Jerusalem', null).confirmed).toBe(true);
  });

  it('never treats the edge’s guess as answered', () => {
    /*
     * This is the assertion that matters most. An IP-derived zone was never on
     * screen; recording it as confirmed would answer on behalf of someone who
     * was never asked, and the readiness card would go quiet for a value they
     * have not seen. Store it — it beats no zone for every hour the platform
     * renders meanwhile — but keep asking.
     */
    const result = resolveOnboardingTimezone(null, 'America/New_York');

    expect(result.zone).toBe('America/New_York');
    expect(result.confirmed).toBe(false);
  });

  it('skips a zone Intl does not recognise and tries the next', () => {
    const result = resolveOnboardingTimezone('Mars/Olympus_Mons', 'Europe/Madrid');

    expect(result.zone).toBe('Europe/Madrid');
    expect(result.source).toBe('edge');
    expect(result.rejected).toEqual([{ value: 'Mars/Olympus_Mons', source: 'browser' }]);
  });

  it('returns nothing rather than a bad guess when both are unusable', () => {
    // A wrong zone is worse than none: it silently shifts every hour shown to a
    // client. The card asks instead.
    const result = resolveOnboardingTimezone('Mars/Olympus_Mons', 'not a zone');

    expect(result.zone).toBeNull();
    expect(result.confirmed).toBe(false);
    expect(result.rejected).toHaveLength(2);
  });

  it('ignores empty and whitespace-only values', () => {
    // `''` and `'   '` are "nothing was sent", not answers.
    expect(resolveOnboardingTimezone('', '   ').zone).toBeNull();
    expect(resolveOnboardingTimezone('  ', 'Europe/Madrid').zone).toBe('Europe/Madrid');
  });

  it('trims a value rather than rejecting it for whitespace', () => {
    expect(resolveOnboardingTimezone(' Asia/Jerusalem ', null).zone).toBe('Asia/Jerusalem');
  });

  it('accepts UTC as a genuine choice from the browser', () => {
    /*
     * 'UTC' is only ambiguous where it may have come from a column DEFAULT.
     * Arriving from a browser it is what the machine is actually set to, and
     * refusing it here would reintroduce the guessing this design removed.
     */
    const result = resolveOnboardingTimezone('UTC', null);

    expect(result.zone).toBe('UTC');
    expect(result.confirmed).toBe(true);
  });
});
