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
 * A REFRESH THAT RETURNS THE REFUSED TOKEN — corrected TWICE on 2026-11-09,
 * which is why the history is kept here rather than tidied away.
 *
 * Reading 1: "the grant is dead" → wrote the reconnect marker. Wrong. The
 * grant was healthy: the same refresh token, asked once from outside the
 * system, returned a token `tokeninfo` called valid and Gmail answered 200
 * for, five times over.
 *
 * Reading 2: "ask again" → retried the refresh three times. Wrong, and worse:
 * the provider returned the refused token every time, and the change tripled
 * the load that turned out to be the actual cause.
 *
 * The cause was OURS, and it was not in this file. A failing run was retried
 * every five minutes for ten days because `retry_count` was never incremented,
 * so the dead-letter cap `(retry_count ?? 0) < MAX_ATTEMPTS` sat at `0 < 5`
 * for ever. Each retry refreshed one grant twice: 100+ refreshes a day of a
 * single refresh token. The control that proves it — another agent on the same
 * account and the same plugin, scheduled once a day, completed throughout.
 *
 * Guarded in `lib/execution/__tests__/aFailingRunStopsRetrying.guard.test.ts`.
 * What this file now guards is that this path adds no load and accuses nobody.
 * ─────────────────────────────────────────────────────────────────────────── */

describe('a refresh that returns the refused token is reported, not retried', () => {
  it('reports the original failure and asks nothing more', () => {
    expect(EXECUTOR).toMatch(/returned the token the provider refuses[\s\S]{0,400}throw firstError/);
  });

  it('does not loop: the refresh is asked for exactly once', () => {
    /* Reading 2 lived here. A loop in this file is load against the provider
       in return for nothing, which is the opposite of the fix. */
    const block = EXECUTOR.slice(EXECUTOR.indexOf('const refusedToken ='));
    const upToRetry = block.slice(0, block.indexOf('catch (secondError'));
    expect(upToRetry).not.toMatch(/\bfor\s*\(/);
    expect(upToRetry).not.toMatch(/\bwhile\s*\(/);
    expect(EXECUTOR).not.toMatch(/SAME_TOKEN_REFRESH_ATTEMPTS/);
  });

  it('and never marks the grant on the strength of an unchanged token', () => {
    /* Reading 1 lived here. A repeated token is evidence about the TOKEN. */
    const block = EXECUTOR.slice(EXECUTOR.indexOf('const refusedToken ='));
    expect(block.slice(0, block.indexOf('catch (secondError'))).not.toMatch(/recordDeadGrant/);
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
     * response regardless, so the row claimed a fresh hour for a dead token.
     * Skipping the write lets the expiry lapse honestly.
     */
    const branch = CONNECTIONS.slice(
      CONNECTIONS.indexOf('if (options?.refusedToken && incoming === options.refusedToken)')
    );
    const body = branch.slice(0, branch.indexOf('const updatedConnectionData'));
    expect(body).toMatch(/return unchanged/);
    expect(body).not.toMatch(/upsert\(/);
    expect(body).not.toMatch(/last_refreshed_at/);
  });

  it('only when the caller knows a token was refused', () => {
    /* A refresh returning the same token is NORMAL and fine when that token
       still works — the same account's Calendar token came back with 3396 of
       its 3599 seconds remaining. Narrow on purpose. */
    expect(CONNECTIONS).toMatch(/options\?\.refusedToken && incoming === options\.refusedToken/);
  });
});

describe('one refresh per grant per minute, whoever asks', () => {
  it('a grant refreshed moments ago is not refreshed again', () => {
    /* The pre-flight and the executor each refresh inside one run and cannot
       see each other, so one logical attempt cost two hits on the provider. */
    expect(CONNECTIONS).toMatch(/REFRESH_COALESCE_MS/);
    expect(CONNECTIONS).toMatch(/Date\.now\(\) - recent\.at < this\.REFRESH_COALESCE_MS/);
  });

  it('and a REFUSAL counts, not only a success', () => {
    /* Otherwise a dead grant is asked twice per run for the same answer. */
    expect(CONNECTIONS).toMatch(/recentRefreshes\.set\([\s\S]{0,120}connection: null/);
  });

  it('bounded, so a long-lived instance does not accumulate', () => {
    expect(CONNECTIONS).toMatch(/recentRefreshes\.size > this\.TOKEN_CACHE_MAX_SIZE/);
  });
});

describe('the temporary diagnostic is gone', () => {
  it('no token shapes are written to the connection row', () => {
    /*
     * `last_refresh_debug` recorded a FOUR character prefix, so `ya29` always
     * matched `ya29`. That blind spot is why two wrong causes survived a day
     * of measurement. Removed now the cause is known; if this question ever
     * needs asking again, record enough of the value to answer it.
     */
    expect(CONNECTIONS).not.toMatch(/last_refresh_debug/);
    expect(code(read('lib/server/gmail-plugin-executor.ts'))).not.toMatch(/sentTokenPrefix/);
  });
});

describe('a flag-setter may not write a credential', () => {
  const REPO = code(read('lib/repositories/PluginConnectionRepository.ts'));

  it('recordRefreshFailure writes settings and nothing else', () => {
    /*
     * It used to `upsert` the WHOLE connection object it was handed, token
     * columns included. A function whose only job is to set
     * `settings.refresh_failed_at` was therefore a credential writer, and
     * because the object came from a caller that had read it earlier, it could
     * write an OLD token and an OLD expiry back over a newer one.
     *
     * Measured on a live account on 2026-11-09: the row held a verified
     * working token at 22:00:40, and at 22:05:22 the refresh path read a token
     * written at 21:28 — two generations old. The agent was failing on a
     * credential that kept being restored underneath it.
     */
    const body = CONNECTIONS.slice(CONNECTIONS.indexOf('private async recordRefreshFailure('));
    const fn = body.slice(0, body.indexOf('\n  }'));

    expect(fn).toMatch(/updateSettings\(/);
    expect(fn).not.toMatch(/access_token/);
    expect(fn).not.toMatch(/refresh_token/);
    expect(fn).not.toMatch(/expires_at/);
    expect(fn).not.toMatch(/upsert\(/);
  });

  it('and the write it uses cannot reach a credential column', () => {
    /* Narrow by construction, like `updateProfileData` and `updateStatus`
       beside it, rather than narrow by the caller remembering. */
    const body = REPO.slice(REPO.indexOf('async updateSettings('));
    const fn = body.slice(0, body.indexOf('\n  }'));

    expect(fn).toMatch(/\.update\(\{/);
    expect(fn).toMatch(/settings,/);
    expect(fn).not.toMatch(/access_token/);
    expect(fn).not.toMatch(/refresh_token/);
    expect(fn).not.toMatch(/expires_at/);
  });

  it('scoped to one user and one plugin, so it cannot move the row', () => {
    const body = REPO.slice(REPO.indexOf('async updateSettings('));
    const fn = body.slice(0, body.indexOf('\n  }'));

    expect(fn).toMatch(/\.eq\('user_id', userId\)/);
    expect(fn).toMatch(/\.eq\('plugin_key', pluginKey\)/);
  });
});
