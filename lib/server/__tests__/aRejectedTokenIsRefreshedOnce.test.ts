/**
 * The provider decides whether a token is good — not our `expires_at` column.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DAY THIS COST, MEASURED ON A LIVE ACCOUNT
 *
 * `getConnection` refreshes only when `expires_at` is within five minutes.
 * That treats our stored expiry as PROOF, and it is a hint. A token can die
 * before it expires — revoked, superseded, the grant changed — and the
 * provider then answers 401 while our column still reads valid.
 *
 * At 19:14 UTC the stored Gmail token said `expires_at 19:40`. Every call
 * returned
 *
 *   401 "Request had invalid authentication credentials"
 *
 * and Google's own `tokeninfo` called the stored token `invalid_token`. The
 * REFRESH token was healthy throughout — Google issued a new access token on
 * demand — but nothing asked it to, because the expiry had not arrived.
 *
 * So the connection was stranded for the half hour until the clock caught up,
 * and in that window:
 *
 *   · the mailbox channel and the reply-drafting agent both failed, telling
 *     their owner "Your Gmail connection has expired. Please reconnect in
 *     Settings" — about a connection one API call away from working;
 *   · the inbox-channel setup screen offered ZERO messages to pick from,
 *     because its sample scan hit the same dead token.
 *
 * One retry fixes all of it: the same scan returned 30 messages immediately
 * after.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY EXACTLY ONCE
 *
 * A second 401 after a freshly minted token means the GRANT is gone, not the
 * token — and that is the one case where the owner really must reconnect.
 * Looping would turn a genuine revocation into a retry storm against the
 * provider and still end with the same message.
 * ─────────────────────────────────────────────────────────────────────────────
 */

jest.mock('@/lib/logger', () => {
  const logger = {
    error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), child: () => logger,
  };
  return { createLogger: () => logger };
});

import { readFileSync } from 'fs';
import { join } from 'path';

const BASE = join(process.cwd(), 'lib/server/base-plugin-executor.ts');

describe('a 401 is answered with a refresh, not a shrug', () => {
  const src = readFileSync(BASE, 'utf-8');

  it('retries the action after refreshing', () => {
    /* The call is wrapped, and the retry runs the SAME action with the new
       connection rather than returning the refreshed token to nobody. */
    expect(src).toMatch(/catch \(firstError[\s\S]{0,400}refreshAfterRejection/);
    expect(src).toContain('executeSpecificAction(refreshed, actionName, parameters)');
  });

  it('and watches that retry, because a second 401 means the grant is gone', () => {
    /*
     * The window this assertion used to measure (`refreshed` within 200
     * characters of the retry) is gone, and so is the reason it was close: the
     * retry is now wrapped in its own try/catch.
     *
     * That wrapping is the point. A token issued seconds earlier being refused
     * is the only reliable evidence that the GRANT is dead rather than the
     * token — the comment beside it has always said so — and until it was
     * caught, the knowledge died with the thrown error. A live mailbox channel
     * failed six runs a day for ten days while its connection read
     * `refresh_failed_at: none` and every surface showed it healthy.
     */
    expect(src).toMatch(/catch \(secondError: any\)/);
    expect(src).toMatch(/httpStatusOf\(secondError\) === 401[\s\S]{0,600}recordDeadGrant/);
    /* And the caller still gets the real failure. */
    expect(src).toMatch(/throw secondError/);
  });

  it('only on a 401, so other failures are untouched', () => {
    /*
     * A 500, a timeout or a bad parameter must not trigger a token refresh —
     * that would hide real faults behind credential churn.
     */
    expect(src).toMatch(/httpStatusOf\(firstError\) === 401/);
    /* Anything else rethrows the original, which carries the provider's own
       words. */
    expect(src).toMatch(/if \(!refreshed\) throw firstError/);
  });

  it('does not loop: there is exactly one retry path', () => {
    const retries = src.split('executeSpecificAction(refreshed').length - 1;

    expect(`retry paths: ${retries}`).toBe('retry paths: 1');
  });

  it('never lets the refresh itself break the call', () => {
    /*
     * A failed refresh must surface the ORIGINAL provider error, which is the
     * honest one — not a secondary failure from our recovery attempt.
     */
    const helper = src.slice(src.indexOf('private async refreshAfterRejection'));

    expect(helper).toMatch(/try \{[\s\S]{0,400}catch/);
    expect(helper).toMatch(/return null/);
  });

  it('skips connections that cannot be refreshed at all', () => {
    /* A platform-key or system connection has no refresh token; asking for one
       would throw inside the recovery path for no reason. */
    const helper = src.slice(src.indexOf('private async refreshAfterRejection'));

    expect(helper).toMatch(/connection\?\.refresh_token/);
    expect(helper).toMatch(/authConfig/);
  });
});

describe('the expiry column is no longer treated as proof', () => {
  it('the smart refresh still runs, as the cheap path', () => {
    /*
     * This fix ADDS a safety net; it does not replace the proactive refresh.
     * Refreshing before a call we know will fail is still better than failing
     * it first, so `shouldRefreshToken` stays exactly as it was.
     */
    const conn = readFileSync(
      join(process.cwd(), 'lib/server/user-plugin-connections.ts'),
      'utf-8'
    );

    expect(conn).toMatch(/shouldRefreshToken\(connection\.expires_at, 5\)/);
  });
});

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * AND WHEN THE REFRESH ITSELF FAILS, THE OWNER IS TOLD.
 *
 * The retry above recovers a token the provider rejected. It cannot recover a
 * GRANT the owner revoked — and that was the silent case: `can_refresh` was
 * computed from a refresh token merely EXISTING, which is true of a revoked
 * grant too. So readiness stayed quiet, the agents failed, and nothing on any
 * screen connected the two.
 *
 * Presence is not proof. The provider refusing the grant is proof, and it is
 * the only evidence that exists — so it is written down and read back.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('a grant the provider refused reaches the owner', () => {
  const oauth = readFileSync(join(process.cwd(), 'lib/services/OAuthTokenService.ts'), 'utf-8');
  const conns = readFileSync(join(process.cwd(), 'lib/server/user-plugin-connections.ts'), 'utf-8');
  const manager = readFileSync(join(process.cwd(), 'lib/server/plugin-manager-v2.ts'), 'utf-8');

  it('separates a revoked grant from a provider having a bad minute', () => {
    /*
     * RFC 6749 §5.2: `invalid_grant` means the refresh token is invalid,
     * expired or revoked. Everything else — a 5xx, a timeout, an unreadable
     * body — is transient, because the cost of guessing wrong there is one
     * retry, and guessing wrong the other way makes an owner re-authorise a
     * connection that was never broken.
     */
    expect(oauth).toMatch(/invalid_grant/i);
    expect(oauth).toMatch(/grant_revoked/);
    expect(oauth).toMatch(/transient/);
  });

  it('treats a network failure as transient, never as a dead grant', () => {
    /* The request never reached the provider, so nothing is known about the
       grant and nothing may be claimed about it. */
    const fn = oauth.slice(oauth.indexOf('export async function refreshAccessTokenDetailed'));
    expect(fn).toMatch(/catch[\s\S]{0,200}reason: 'transient'/);
  });

  it('records the refusal, and only for a revoked grant', () => {
    expect(conns).toMatch(/outcome\.reason === 'grant_revoked'[\s\S]{0,120}recordRefreshFailure/);
    expect(conns).toMatch(/refresh_failed_at/);
  });

  it('clears the mark when a later refresh succeeds', () => {
    /*
     * Whatever the owner did to fix it worked; the warning has to stop.
     *
     * Cleared from the ROW's own settings now, not from `connection.settings`.
     * A caller's copy can be stale, and on 2026-11-09 a stale one written back
     * over a freshly created grant destroyed it — so the refresh no longer
     * writes anything derived from the object it was handed.
     */
    expect(conns).toMatch(/withoutRefreshFailure\(liveSettings\)/);
    expect(conns).toMatch(/liveSettings\.refresh_failed_at \|\| liveSettings\.refresh_failed_detail/);
  });

  it('makes a refused grant read as expired, whatever the clock says', () => {
    /*
     * The gap that hid it: `expires_at` can sit in the future while the grant
     * is gone, so the connection passed `isTokenValid` and never reached the
     * list readiness reads.
     */
    expect(manager).toMatch(/refusedGrant/);
    expect(manager).toMatch(/!validKeys\.has\(conn\.plugin_key\) \|\| refusedGrant\(conn\)/);
  });

  it('reports it as NOT refreshable, which is what makes readiness speak', () => {
    expect(manager).toMatch(/canRefresh:[\s\S]{0,120}!refusedGrant\(conn\)/);
  });
});
