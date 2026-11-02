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
