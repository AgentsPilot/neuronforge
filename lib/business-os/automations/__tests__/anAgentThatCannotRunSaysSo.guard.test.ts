/**
 * An agent the scheduler will never claim must not look healthy.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE CLAIM QUERY WANTS THREE THINGS
 *
 *     mode = 'scheduled'  AND  schedule_enabled = true  AND  status = 'active'
 *
 * and three separate places each knew about ONE of them. A spreadsheet agent
 * on a live account sat with `schedule_enabled: false` and `status: 'active'`
 * from 5 to 10 November:
 *
 *   · the LIST was handed `status` alone, so the row looked perfectly healthy
 *     — no badge, no warning, and a next run it would never take;
 *   · RESUME set `status` and the clock but never the schedule flag, so the
 *     control reported success and changed nothing that mattered;
 *   · RUN NOW checked `status` only, so each press moved `next_run`, returned
 *     success, and queued nothing.
 *
 * Its owner pressed both buttons, was told yes twice, and watched for a run
 * that could never be claimed. Nothing anywhere said why.
 *
 * The three are guarded together because they are one fault: every surface
 * that can start, report on, or refuse an agent has to agree with the query
 * that actually claims it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const INSTALL = strip(read('lib/business-os/automations/install.ts'));
const RUNNER = strip(read('lib/execution/scheduledAgentRunner.ts'));

/** The function body, bounded by the next top-level declaration. */
function body(src: string, signature: string): string {
  const from = src.indexOf(signature);
  expect(from).toBeGreaterThan(-1);
  const rest = src.slice(from + 1);
  const next = rest.search(/\nexport (?:async )?function |\nfunction /);
  return rest.slice(0, next === -1 ? undefined : next);
}

describe('the scheduler still claims on all three', () => {
  it('so the rest of this file is guarding the right conditions', () => {
    /* If the claim query changes, these guards are measuring the wrong thing
       and should fail loudly rather than quietly passing. */
    expect(RUNNER).toMatch(/\.eq\('mode', 'scheduled'\)/);
    expect(RUNNER).toMatch(/\.eq\('schedule_enabled', true\)/);
    expect(RUNNER).toMatch(/\.eq\('status', 'active'\)/);
  });
});

describe('resume actually resumes', () => {
  const fn = body(INSTALL, 'export async function resumeAutomation(');

  it('sets the schedule flag, not only the status', () => {
    expect(fn).toMatch(/schedule_enabled: true/);
  });

  it('and fails the resume if that write fails', () => {
    /* Reporting success while the agent stays unclaimable is the original
       bug, not a lesser version of it. */
    expect(fn).toMatch(/enableError[\s\S]{0,200}return false/);
  });
});

describe('run now refuses what cannot be claimed', () => {
  const fn = body(INSTALL, 'export async function runAutomationNow(');

  it('checks the status', () => {
    expect(fn).toMatch(/status !== 'active'[\s\S]{0,160}return false/);
  });

  it('checks the schedule flag', () => {
    expect(fn).toMatch(/schedule_enabled === false[\s\S]{0,160}return false/);
  });

  it('checks the mode', () => {
    expect(fn).toMatch(/mode !== 'scheduled'[\s\S]{0,200}return false/);
  });
});

describe('the list shows an agent that cannot run', () => {
  it('a switched-off schedule is reported as inactive', () => {
    /*
     * Not a new state for an owner to learn: off is off, and the control that
     * says resume is the one that fixes it. Splitting `status` from
     * `schedule_enabled` on the row would ask them to learn our column names.
     */
    expect(INSTALL).toMatch(/schedule_enabled === false\s*\?\s*'inactive'/);
  });
});
