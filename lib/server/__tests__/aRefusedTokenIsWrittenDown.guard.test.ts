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
