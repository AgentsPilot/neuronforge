/**
 * A grant the provider keeps refusing is recorded, not just reported.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TEN-DAY SILENCE
 *
 * A mailbox channel agent failed six runs a day from 30 October to 9 November
 * with "Your Gmail connection has expired". Throughout, its connection read:
 *
 *     status             active
 *     refresh_token      present
 *     refresh_failed_at  none
 *
 * so the channels card drew a green dot and the setup wizard said "set up". The
 * only visible sign was an agent quietly filing nothing.
 *
 * Every automatic remedy had already run. `connectionsReady` verified the token
 * before the run and refreshed it; the executor refreshed again on the 401 and
 * retried. The connection's `updated_at` proves a refresh landed seconds before
 * the final failure. Google was still ISSUING tokens from the refresh token —
 * and Gmail was refusing every one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY NOTHING COULD SAY SO
 *
 * `recordRefreshFailure` fires when a REFRESH is refused. Here no refresh was
 * ever refused, so the marker every surface reads was never written — including
 * by the channel-health work, which is built on that same field.
 *
 * The executor's retry is the only place that can tell. Its own comment reaches
 * the conclusion — "a second 401 after a fresh token means the GRANT is gone,
 * not the token" — and it had no way to write it down. Now it does, and the
 * surfaces that already read `refresh_failed_at` light up for free.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const EXECUTOR = code(read('lib/server/base-plugin-executor.ts'));
const CONNECTIONS = code(read('lib/server/user-plugin-connections.ts'));

describe('the second 401 is the signal', () => {
  it('the retry is watched, not fired and forgotten', () => {
    /* It used to be the last statement in the catch: if it threw, the error
       propagated and the knowledge went with it. */
    expect(EXECUTOR).toMatch(/catch \(secondError: any\)/);
    expect(EXECUTOR).toMatch(/this\.httpStatusOf\(secondError\) === 401/);
  });

  it('and a refused fresh token marks the grant dead', () => {
    expect(EXECUTOR).toMatch(/recordDeadGrant\(/);
  });

  it('the original failure still reaches the caller', () => {
    /* Recording is a courtesy. Swallowing the error to do it would turn a
       reportable problem into an invisible one — the very fault this fixes. */
    expect(EXECUTOR).toMatch(/throw secondError/);
  });

  it('and a failure to record never fails the action', () => {
    expect(EXECUTOR).toMatch(/recordDeadGrant\([\s\S]{0,200}\.catch\(/);
  });

  it('only on a 401, never on any other error', () => {
    /* A 500 from Gmail, a timeout, a quota refusal: none of them says the
       grant is gone, and marking a healthy connection dead would send an
       owner to re-authorise for nothing. */
    const retry = EXECUTOR.slice(EXECUTOR.indexOf('catch (secondError: any)'));
    expect(retry.slice(0, retry.indexOf('throw secondError'))).toMatch(
      /=== 401[\s\S]{0,400}recordDeadGrant/
    );
  });
});

describe('it writes the field every surface already reads', () => {
  it('the same marker a refused refresh writes', () => {
    /*
     * Deliberately not a second field. The owner's remedy is identical —
     * re-authorise — and the channel surfaces, the setup wizard and the
     * readiness line all key off this one already.
     */
    expect(CONNECTIONS).toMatch(/async recordDeadGrant\([\s\S]{0,200}recordRefreshFailure\(/);
    expect(CONNECTIONS).toContain('refresh_failed_at');
  });

  it('and the channel view keys off it', () => {
    /* The link that makes this visible rather than merely recorded. */
    expect(code(read('lib/business-os/leads/inboxChannel.ts'))).toContain('refresh_failed_at');
  });
});

/* ───────────────────────────────────────────────────────────────────────────
 * A REFRESH THAT RETURNS THE REFUSED TOKEN MEANS ASK AGAIN — corrected
 * 2026-11-09, the same day the first version of this block shipped.
 *
 * That version asserted the opposite: an unchanged token marked the grant
 * dead. It was measured, it was wrong, and measuring it further is what
 * showed why. On the live account, minutes after production had been handed
 * the refused value, the SAME refresh token with the SAME OAuth client
 * returned a new access token three times in a row — `tokeninfo` called each
 * one valid and Gmail answered 200 to each. The grant was healthy the whole
 * time.
 *
 * The control that settles it: the account's Calendar connection refreshed 13
 * seconds earlier in the same cron pass and stored a token that worked. Same
 * column, same write path, same credentials. So nothing about storage was
 * broken, and "dead grant" was never a reading the evidence supported.
 *
 * Marking it would have sent the owner to re-authorise a working connection —
 * the fault `httpStatusOf`'s comment in the executor was written about, where
 * an owner spent a day being told to reconnect something healthy. These tests
 * exist so that conclusion does not come back.
 * ─────────────────────────────────────────────────────────────────────────── */

describe('a refresh that returns the refused token means ask again', () => {
  it('asks the provider again rather than calling the grant dead', () => {
    expect(EXECUTOR).toMatch(/SAME_TOKEN_REFRESH_ATTEMPTS/);
    expect(EXECUTOR).toMatch(/asking the provider again/);
  });

  it('and never marks the grant on the strength of an unchanged token', () => {
    /* The regression this file was rewritten to prevent. A repeated token is
       evidence about the TOKEN; the grant is proven dead only by a refusal or
       by a freshly issued token being itself rejected. */
    const block = EXECUTOR.slice(EXECUTOR.indexOf('const refusedToken ='));
    expect(block.slice(0, block.indexOf('catch (secondError'))).not.toMatch(/recordDeadGrant/);
  });

  it('is bounded, so a stuck provider is not polled', () => {
    expect(EXECUTOR).toMatch(/attempt <= SAME_TOKEN_REFRESH_ATTEMPTS/);
  });

  it('reports the ORIGINAL failure when the attempts are spent', () => {
    expect(EXECUTOR).toMatch(/kept returning the token it refuses[\s\S]{0,400}throw firstError/);
  });

  it('compared by VALUE, because the clock cannot tell the difference', () => {
    /* `expires_at` is recomputed from the response whether or not a new token
       arrived — which is exactly how this hid for ten days. */
    const block = EXECUTOR.slice(EXECUTOR.indexOf('const refusedToken ='));
    expect(block.slice(0, 2500)).not.toMatch(/expires_at.*===/);
  });
});

describe('a refused token does not get a fresh hour', () => {
  it('the refresh is told which token was refused', () => {
    expect(EXECUTOR).toMatch(/refreshToken\(connection, authConfig, \{ refusedToken \}\)/);
    expect(CONNECTIONS).toMatch(/options\?: \{ refusedToken\?: string \}/);
  });

  it('and writes nothing when the provider returns exactly that', () => {
    /*
     * The heart of the ten-day silence: `access_token` kept its old value
     * while `expires_at` and `last_refreshed_at` were recomputed from the
     * response regardless, so the row claimed a fresh hour for a dead token
     * every five minutes. Skipping the write lets the expiry lapse honestly
     * and lets the next run try again.
     */
    const branch = CONNECTIONS.slice(
      CONNECTIONS.indexOf('if (options?.refusedToken && incoming === options.refusedToken)')
    );
    const body = branch.slice(0, branch.indexOf('const updatedConnectionData'));
    expect(body).toMatch(/return \{ \.\.\.connection, access_token: incoming \}/);
    expect(body).not.toMatch(/upsert\(/);
    expect(body).not.toMatch(/last_refreshed_at/);
  });

  it('only when the caller knows a token was refused', () => {
    /* A refresh returning the same token is NORMAL and fine when that token
       still works — Google does it whenever the current one has life left, and
       the same account's Calendar token came back with 3396 of its 3599
       seconds remaining. Narrow on purpose. */
    expect(CONNECTIONS).toMatch(/options\?\.refusedToken && incoming === options\.refusedToken/);
  });
});
