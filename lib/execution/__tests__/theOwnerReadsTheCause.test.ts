/**
 * What a business owner is told when an agent stops.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE USEFUL SENTENCE IS ONE LAYER IN
 *
 * A failed plan reports itself at the top as, verbatim from a live run on
 * 2026-10-31:
 *
 *   Calibration stop: Non-retryable execution error at step "Search mailbox
 *   for unread website enquiry emails using the configured mail_query." (unknown)
 *
 * while the step that failed recorded:
 *
 *   Your Gmail connection has expired. Please reconnect in Settings →
 *   Connected Apps.
 *
 * The plugin author already wrote the sentence an owner can act on. The runner
 * took the wrapper, which threw it away and handed `toUserFacing` a string it
 * does not recognise — and an unrecognised string passes through unchanged. So
 * the agents list would have shown a business owner the word "Calibration"
 * about their mailbox.
 *
 * Caught by running the translator on both strings rather than assuming it
 * would cope. This suite is that check, kept.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { causeOfFailure } from '../scheduledAgentRunner';
import { toUserFacing } from '@/lib/pilot/shadow/userFacing';

/** The shape the pilot resolves with when a step fails. */
function failedRun(stepError: string | undefined, wrapper = WRAPPER) {
  return {
    error_message: wrapper,
    execution_trace: {
      failedSteps: ['step1'],
      stepExecutions: [
        { stepId: 'step1', plugin: 'google-mail', action: 'search_emails',
          metadata: { success: false, ...(stepError ? { error: stepError } : {}) } },
      ],
    },
  };
}

const WRAPPER =
  'Calibration stop: Non-retryable execution error at step "Search mailbox for ' +
  'unread website enquiry emails using the configured mail_query." (unknown)';

const REAL = 'Your Gmail connection has expired. Please reconnect in Settings → Connected Apps.';

describe('it reports the cause, not the wrapper', () => {
  it('takes the failed step own message', () => {
    expect(causeOfFailure(failedRun(REAL))).toBe(REAL);
  });

  it('does not take the wrapper when a step said something', () => {
    /* The assertion that matters: the wrapper is always present and is always
       the least useful thing available. */
    expect(causeOfFailure(failedRun(REAL))).not.toContain('Calibration stop');
  });

  it('reaches a step that failed without being named in failedSteps', () => {
    /* A scatter item's failure is real even when the parent step is what the
       plan listed. */
    const run = {
      error_message: WRAPPER,
      execution_trace: {
        failedSteps: [],
        stepExecutions: [{ stepId: 'step3', metadata: { success: false, error: REAL } }],
      },
    };

    expect(causeOfFailure(run)).toBe(REAL);
  });
});

describe('what it falls back to, outward', () => {
  it('uses the wrapper when no step recorded a reason', () => {
    expect(causeOfFailure(failedRun(undefined))).toBe(WRAPPER);
  });

  it('says something rather than nothing when there is no trace at all', () => {
    expect(causeOfFailure({})).toBe('the plan reported failure');
    expect(causeOfFailure(null)).toBe('the plan reported failure');
  });
});

describe('and the owner can act on what reaches them', () => {
  it('survives the translator as the plugin wrote it', () => {
    /*
     * `toUserFacing` rewrites the formats it recognises and passes anything
     * else through. The plugin's sentence is already owner-ready, so passing
     * through is the correct outcome — what must NOT survive is the wrapper.
     */
    const shown = toUserFacing(causeOfFailure(failedRun(REAL)));

    expect(shown.message).toBe(REAL);
    expect(shown.message).toMatch(/reconnect/i);
    expect(shown.message).not.toMatch(/calibration|non-retryable|step "/i);
  });

  it('would have shown jargon before the fix', () => {
    /*
     * The negative control, as a permanent record of why this exists: feed the
     * translator the wrapper and it returns the wrapper.
     */
    expect(toUserFacing(WRAPPER).message).toContain('Calibration stop');
  });
});

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * AND IT IS ACTUALLY CALLED.
 *
 * Everything above passed for as long as this file has existed, while
 * `causeOfFailure` had NO CALLER anywhere in the tree. The runner took
 * `execution.error` — the wrapper — and handed that to `markFailed`, which
 * translates the terminal message for the owner through `toUserFacing`; an
 * unrecognised string is passed through unchanged, so the wrapper is precisely
 * what reached the dashboard. A live account showed its owner, in English, in
 * the middle of a Hebrew table:
 *
 *     Non-retryable execution error at step "Scan the mailbox for new replies,
 *     headers only" (unknown)
 *
 * A green unit test for a function nobody invokes is the worst kind of
 * reassurance, so the wiring is asserted as well as the logic.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('the runner actually uses it', () => {
  const { readFileSync } = require('fs') as typeof import('fs');
  const { join } = require('path') as typeof import('path');

  const RUNNER = join(process.cwd(), 'lib/execution/scheduledAgentRunner.ts');
  const PILOT = join(process.cwd(), 'lib/pilot/WorkflowPilot.ts');

  it('passes the cause to markFailed, not the raw error', () => {
    const src = readFileSync(RUNNER, 'utf-8');

    /* The call exists… */
    expect(src).toContain('const why = causeOfFailure(execution)');
    /* …and the old wrapper-grab is gone. */
    expect(src).not.toMatch(/const why = \(execution as \{ error\?: string/);
  });

  it('is reached from the failure branch that reports the run', () => {
    const src = readFileSync(RUNNER, 'utf-8');
    const call = src.indexOf('causeOfFailure(execution)');
    /* The call is multi-line now that the error code travels with it. */
    const report = src.indexOf('markFailed(', call);

    expect(call).toBeGreaterThan(-1);
    /* The value is computed before it is reported, in the same branch. */
    expect(report).toBeGreaterThan(call);
  });

  it('gets something to work with: the pilot carries the step cause out', () => {
    /*
     * The other half of the same bug. `causeOfFailure` reads the failing
     * step's own message, and the pilot's failure return carried no step
     * detail at all — so even once called it could only fall back outward to
     * the wrapper it exists to avoid.
     */
    const src = readFileSync(PILOT, 'utf-8');

    expect(src).toContain('failedStepError');
    /* From metadata, which is the persisted half — never the response body. */
    expect(src).toMatch(/failedStepError[\s\S]{0,400}metadata\?\.error/);
  });

  it('prefers that over every outward fallback', () => {
    /* A run carrying both must report the step's sentence. */
    const run = {
      error: WRAPPER,
      error_message: WRAPPER,
      failedStepError: REAL,
      execution_trace: { failedSteps: [], stepExecutions: [] },
    };

    expect(causeOfFailure(run)).toBe(REAL);
  });

  it('still falls back outward when the pilot carried nothing', () => {
    expect(causeOfFailure({ error: WRAPPER })).toBe(WRAPPER);
  });
});
