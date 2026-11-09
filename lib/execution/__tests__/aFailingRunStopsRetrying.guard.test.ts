/**
 * A failing run stops retrying.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE LOOP THAT COULD NOT TERMINATE
 *
 * `פניות מהאתר דרך Gmail` failed every run from 30 October to 9 November —
 * around fifty a day, `last_run` frozen on the day it broke. Three lines of
 * otherwise reasonable code made it unstoppable:
 *
 *     scheduledAgentRunner.ts   MAX_ATTEMPTS = 5
 *       "Attempts before a run is dead-lettered and stops being retried."
 *     scheduledAgentRunner.ts   retry = (run.retry_count ?? 0) < MAX_ATTEMPTS
 *     ScheduledExecutionRepository   retry_count is READ, and never written
 *
 * `retry_count` was set to 0 at creation and incremented nowhere in the
 * codebase, so the guard was permanently `0 < 5`. The dead-letter cap could
 * never fire, and the backoff — `60 * 2 ** attempts`, with `attempts` stuck at
 * 1 — was pinned at 120 seconds instead of doubling.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT COST, AND WHY IT LOOKED LIKE SOMEBODY ELSE'S BUG
 *
 * Each retry refreshed the same Google grant twice: once in the pre-flight
 * (`connectionsReady`) and again in the executor on the 401. Fifty runs a day
 * is 100+ refreshes of ONE refresh token, every day, for ten days.
 *
 * The grant was healthy the whole time. Asked once from outside the system it
 * returned a token `tokeninfo` called valid and Gmail answered 200 for — five
 * times over. Under the load it kept handing back the token the API had just
 * refused. Two fixes shipped against Google before the loop was found: one
 * declared the healthy grant dead, the other retried the refresh three times
 * and tripled the load.
 *
 * The control that should have been read first: `draft_client_replies` uses
 * the SAME plugin on the SAME account, is scheduled once a day, and completed
 * normally throughout.
 *
 * Source-level, because what went wrong was a missing write and a condition
 * that ignored its cause — both things a reader can check, and neither
 * reachable by a unit test without standing up a scheduler, a pilot, a plugin
 * and a provider.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const RUNNER = code(read('lib/execution/scheduledAgentRunner.ts'));
const LEDGER = code(read('lib/repositories/ScheduledExecutionRepository.ts'));
const CONNECTIONS = code(read('lib/server/user-plugin-connections.ts'));

describe('the counter the cap depends on is written', () => {
  it('a retried run increments retry_count', () => {
    /* The whole fault in one assertion. Without this write the cap below is
       `0 < 5` for ever and the backoff never doubles. */
    expect(LEDGER).toMatch(/status: 'pending'[\s\S]{0,300}retry_count: attempts \+ 1/);
  });

  it('and the value written is the one the backoff was computed from', () => {
    /* Reading `retry_count` and then writing an unrelated number would make
       the delay and the attempt count disagree, which is how a cap drifts. */
    expect(LEDGER).toMatch(/const attempts = [\s\S]{0,120}retry_count \?\? 1/);
    expect(LEDGER).toMatch(/60 \* 2 \*\* attempts/);
  });

  it('the cap still reads that column, so the two stay connected', () => {
    expect(RUNNER).toMatch(/\(run\.retry_count \?\? 0\) < MAX_ATTEMPTS/);
  });
});

describe('an authentication failure is terminal on the first attempt', () => {
  it('both retry decisions consult the CAUSE, not only the count', () => {
    /*
     * A 401 does not become a 200 by being asked again five minutes later.
     * What it does instead is cost another token refresh, which is what kept
     * the grant broken.
     */
    const decisions = RUNNER.match(/const retry = [^;]+;/g) ?? [];
    expect(decisions.length).toBeGreaterThanOrEqual(2);
    for (const d of decisions) expect(d).toMatch(/isAuthFailure\(/);
  });

  it('through the SAME predicate the owner-facing sentence uses', () => {
    /*
     * These were two independent judgements about one question: whether this
     * failure means a connection needs re-authorising. Sharing the predicate
     * is what stops them drifting apart.
     */
    expect(code(read('lib/pilot/shadow/userFacing.ts'))).toMatch(/export function isAuthFailure\(/);
    expect(LEDGER).toMatch(/const looksLikeAuth = isAuthFailure\(message, code\)/);
    expect(RUNNER).toMatch(/import \{ isAuthFailure \} from '@\/lib\/pilot\/shadow\/userFacing'/);
    /* Beside `toUserFacing`, and NOT in the ledger: a test that mocks the
       repository module would otherwise mock the predicate away and the retry
       decision would throw at runtime. That happened. */
    expect(LEDGER).not.toMatch(/export function isAuthFailure/);
  });

  it('and retries still exist for failures that genuinely pass', () => {
    /* A timeout, a 500, a rate limit. Making everything terminal would trade
       one bug for another. */
    expect(RUNNER).toMatch(/isAuthFailure\([^)]*\) && \(run\.retry_count \?\? 0\) < MAX_ATTEMPTS/);
  });
});

describe('one refresh per grant per minute, whoever asks', () => {
  it('the pre-flight and the executor can no longer both hit the provider', () => {
    /* Two layers of one logical attempt, neither able to see the other. The
       backstop sits on the singleton so it holds for every caller. */
    expect(CONNECTIONS).toMatch(/REFRESH_COALESCE_MS/);
    expect(CONNECTIONS).toMatch(/Date\.now\(\) - recent\.at < this\.REFRESH_COALESCE_MS/);
  });

  it('keyed per user AND per plugin, so one grant cannot shadow another', () => {
    expect(CONNECTIONS).toMatch(/\$\{connection\.user_id\}:\$\{connection\.plugin_key\}/);
  });

  it('and both callers still exist — this throttles, it does not remove them', () => {
    /*
     * The pre-flight verify is worth keeping: it refreshes while there is
     * still a run to save, rather than one second after it was written off.
     */
    expect(code(read('lib/execution/connectionsReady.ts'))).toMatch(/refreshToken\(/);
    expect(RUNNER).toMatch(/connectionsReady\(/);
  });
});
