/**
 * "Run it now" runs the REAL thing, not a convenient imitation of it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT EXISTS
 *
 * There was no way to make an agent run. A daily agent that fails can only be
 * diagnosed once a day, and by the time anyone reads a log the moment is gone.
 * One live mailbox channel took TEN DAYS to pin down for exactly that reason:
 * six failures a day, and a single chance each evening to be watching.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND WHY IT MOVES THE CLOCK INSTEAD OF EXECUTING
 *
 * The obvious implementation — call the runner inside the request — creates a
 * SECOND execution path. A second path is precisely what hid that ten-day bug:
 * the channel agent succeeded 291 times under its old cron and has never
 * succeeded under the scheduler, because the two did not do the same thing.
 *
 * A "run now" that behaves differently from a scheduled run cannot reproduce a
 * scheduled run's failure, which is the only reason anybody presses it. So this
 * sets `next_run` and lets the scheduler claim it: same lease, same connection
 * pre-flight, same retries, same recording.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const INSTALL = code(read('lib/business-os/automations/install.ts'));
const ROUTE = code(read('app/api/business-os/automation-agents/route.ts'));
const CARD = code(read('components/business-os/insight/RunningAgentsCard.tsx'));

const runNow = INSTALL.slice(
  INSTALL.indexOf('export async function runAutomationNow'),
  INSTALL.indexOf('export async function resumeAutomation')
);

describe('it brings the clock forward', () => {
  it('and sets next_run to now', () => {
    expect(runNow).toMatch(/next_run: new Date\(\)\.toISOString\(\)/);
  });

  it('without executing anything itself', () => {
    /*
     * The whole design. If this ever calls the runner, a pressed button stops
     * reproducing a scheduled run and the control becomes useless for the one
     * job it was built for.
     */
    expect(runNow).not.toMatch(/runScheduledAgents|WorkflowPilot|executeAgent|runAgent/);
  });

  it('and changes nothing else about the schedule', () => {
    /* Not the status, not the cron, not the cadence: the run after this one
       must land where the schedule always said it would. */
    expect(runNow).not.toMatch(/schedule_cron:|cadence:|status: '/);
  });
});

describe('it refuses what it cannot deliver', () => {
  it('a paused agent, rather than promising a run that cannot happen', () => {
    /* The scheduler selects on `status = 'active'`, so moving a paused agent's
       clock would do nothing at all and report success. */
    expect(runNow).toMatch(/status !== 'active'/);
  });

  it('and an agent that is not this owner\'s', () => {
    expect(runNow).toContain('isControllableAgent(userId, agentId)');
  });
});

describe('the route', () => {
  it('accepts the action', () => {
    expect(ROUTE).toContain("'run'");
    expect(ROUTE).toContain('runAutomationNow(user.id, validated.agentId)');
  });

  it('answers 400 rather than 500 when it refuses', () => {
    /* A paused agent and a foreign id are both the caller's request being
       wrong, not the server breaking. */
    expect(ROUTE).toMatch(/Could not bring this run forward[\s\S]{0,120}status: 400/);
  });

  it('and records that a person asked for it', () => {
    expect(ROUTE).toContain('AUTOMATION_AGENT_RUN_REQUESTED');
  });
});

describe('the row', () => {
  it('offers it only while the agent is active', () => {
    expect(CARD).toMatch(/agent\.status === 'active' &&[\s\S]{0,400}'run'/);
  });

  it('and says a run is coming, rather than reporting success silently', () => {
    /* The scheduler claims it within five minutes. A button that reports
       success while the row still shows yesterday reads as broken. */
    expect(CARD).toContain('automation.run_queued');
    expect(CARD).toContain('setRanAt');
  });

  it('in every language', () => {
    for (const lang of ['en', 'he', 'es']) {
      const dict = read(`lib/business-os/translations/${lang}.ts`);
      expect(dict).toContain("'automation.run_now':");
      expect(dict).toContain("'automation.run_queued':");
    }
  });
});

describe('a failure is read in the owner\'s own language', () => {
  const install = code(read('lib/business-os/automations/install.ts'));

  it('the category is worked out, because nothing ever wrote it', () => {
    /*
     * `failureCategoryOf` was written for this, exported, and never called —
     * so `stopped.category` was always undefined, the lookup key was always
     * `automation.failure.undefined`, and the owner always got the raw English
     * from a plugin definition. Three languages of correct copy sat unused.
     */
    expect(install).toMatch(
      /const category = stopped\.category \?\? failureCategoryOf\(stopped\.code, stopped\.message\)/
    );
  });

  it('derived on READ, so failures already recorded are translated too', () => {
    /* Stamping it on write would fix only what fails from tomorrow. The account
       that found this had ten days of failures already stored. */
    const fn = install.slice(install.indexOf('function ownerFacingFailure'));
    expect(fn.slice(0, fn.indexOf('\n}'))).toContain('failureCategoryOf(');
  });

  it('and the English tail is dropped once the sentence is translated', () => {
    /*
     * `what_to_do` comes from `toUserFacing`, which writes English only.
     * Appending it to a Hebrew sentence produced a two-language paragraph — the
     * exact fault this path exists to prevent — and it is redundant, since
     * every category sentence already says what to do.
     */
    expect(install).toMatch(/whatToDo: localised \? undefined : stopped\.whatToDo/);
  });

  it('every category has copy in all three languages', () => {
    for (const lang of ['en', 'he', 'es']) {
      const dict = read(`lib/business-os/translations/${lang}.ts`);
      for (const category of ['reconnect', 'busy', 'data', 'unknown']) {
        expect(dict).toContain(`'automation.failure.${category}':`);
      }
    }
  });
});

describe('a retry in flight does not pass for health', () => {
  const install = code(read('lib/business-os/automations/install.ts'));

  it('only a SETTLED run decides what the row says', () => {
    /*
     * This took the newest row of any kind. A run in flight is `pending` or
     * `processing`, and `markFailed(retry)` puts a row back to `pending` for
     * its backoff — so throughout every retry window the newest row was not a
     * failure and the card went clean.
     *
     * An owner watched an agent that had failed every run for ten days go
     * quiet the moment a retry started and read it as fixed. The failure had
     * not gone; the row in front of it had.
     */
    const fn = install.slice(install.indexOf('export async function deadLetteredRuns'));
    /* `lastIndexOf`: the function returns early for an empty id list, so the
       first `return out;` is three lines in and slices the body away. */
    const body = fn.slice(0, fn.lastIndexOf('return out;'));

    expect(body).toMatch(/run\.status !== 'failed' && run\.status !== 'completed'\) continue/);
  });

  it('and the skip happens BEFORE the agent is marked seen', () => {
    /* Otherwise the in-flight row claims the slot and the settled one behind
       it is never read — the same blindness with extra steps. */
    const fn = install.slice(install.indexOf('export async function deadLetteredRuns'));
    /* `lastIndexOf`: the function returns early for an empty id list, so the
       first `return out;` is three lines in and slices the body away. */
    const body = fn.slice(0, fn.lastIndexOf('return out;'));

    const skip = body.indexOf("run.status !== 'failed' && run.status !== 'completed'");
    const seen = body.indexOf('seen.add(id)');

    expect(skip).toBeGreaterThan(-1);
    expect(seen).toBeGreaterThan(-1);
    expect(skip).toBeLessThan(seen);
  });
});
