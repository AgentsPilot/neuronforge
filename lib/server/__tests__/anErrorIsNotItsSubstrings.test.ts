/**
 * A plugin error is classified by its STATUS, never by what its text contains.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DAY THIS COST
 *
 * `mapErrorToMessage` decided what to tell an owner with substring tests:
 *
 *     if (error.message?.includes('401') || error.message?.includes('unauthorized'))
 *       return commonErrors.auth_failed;
 *
 * Executors build their errors as `Gmail API error: ${status} - ${body}`, so
 * the response body travels inside the message. Any body mentioning 401 —
 * a message id, a byte count, a quoted subject, a timestamp — turned an
 * unrelated failure into "Your Gmail connection has expired. Please reconnect
 * in Settings → Connected Apps."
 *
 * On a live account that message appeared under an agent whose Gmail
 * connection was healthy: the refresh token was accepted by Google on demand,
 * and a SECOND agent was reading the same mailbox successfully at the same
 * time. A wrong cause is worse than no cause — it gets acted on, and the owner
 * is told to reconnect something that works.
 *
 * `400` was the worst: it also matched `includes('invalid')`, so "invalid
 * date" or "invalid spreadsheet range" became "Invalid request parameters."
 * ─────────────────────────────────────────────────────────────────────────────
 */

jest.mock('@/lib/logger', () => {
  const logger = {
    error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), child: () => logger,
  };
  return { createLogger: () => logger };
});

import { BasePluginExecutor } from '../base-plugin-executor';

const COMMON = {
  auth_failed: 'Your Gmail connection has expired. Please reconnect in Settings → Connected Apps.',
  quota_exceeded: 'Rate limit exceeded. Please try again later.',
  invalid_request: 'Invalid request parameters.',
  api_rate_limit: 'Too many requests. Please wait a moment and try again.',
  not_found: 'Resource not found.',
};

/** The smallest executor that can answer `mapErrorToMessage`. */
class Probe extends BasePluginExecutor {
  constructor() {
    super(
      'google-mail',
      {} as never,
      { getOutputGuidance: () => ({ common_errors: COMMON }) } as never
    );
  }
  protected async executeSpecificAction(): Promise<unknown> {
    throw new Error('not used');
  }
  /** `mapErrorToMessage` is protected; this is the seam under test. */
  public classify(error: unknown): string {
    return (this as unknown as {
      mapErrorToMessage: (a: string, e: unknown) => string;
    }).mapErrorToMessage('search_emails', error);
  }
}

const probe = new Probe();

describe('a number inside the prose is not a status', () => {
  it('does not call a message mentioning 401 an expired connection', () => {
    /* THE EXACT SHAPE THAT MISLED US: a 500 whose body happens to carry 401. */
    const error = new Error(
      'Gmail API error: 500 - {"error":{"message":"backend error on thread 1401223"}}'
    );

    expect(probe.classify(error)).not.toBe(COMMON.auth_failed);
  });

  it('does not call a message containing the word invalid a parameter error', () => {
    const error = new Error('Gmail API error: 503 - the invalid cache entry was rebuilt');

    expect(probe.classify(error)).not.toBe(COMMON.invalid_request);
  });

  it('falls through to the real text when it cannot tell', () => {
    /*
     * The default already named the plugin, the action and the message. That is
     * the right answer for an unclassifiable error — and infinitely better than
     * confidently wrong advice about reconnecting.
     */
    const error = new Error('Gmail API error: 500 - backend error on thread 1401223');

    expect(probe.classify(error)).toContain('backend error on thread 1401223');
  });
});

describe('a real status still classifies', () => {
  it('reads the framed status this codebase writes', () => {
    expect(probe.classify(new Error('Gmail API error: 401 - invalid credentials')))
      .toBe(COMMON.auth_failed);
    expect(probe.classify(new Error('Gmail API error: 403 - quota')))
      .toBe(COMMON.quota_exceeded);
    expect(probe.classify(new Error('Gmail API error: 429 - slow down')))
      .toBe(COMMON.api_rate_limit);
    expect(probe.classify(new Error('Gmail API error: 404 - no such message')))
      .toBe(COMMON.not_found);
    expect(probe.classify(new Error('Gmail API error: 400 - bad range')))
      .toBe(COMMON.invalid_request);
  });

  it('reads an explicit status field when the thrower set one', () => {
    /* Preferred over the text: whoever threw it knew. */
    const error = Object.assign(new Error('something went wrong'), { status: 401 });

    expect(probe.classify(error)).toBe(COMMON.auth_failed);
  });

  it('still trusts the word unauthorized on its own', () => {
    /*
     * Kept deliberately. A provider that says "unauthorized" in words and sets
     * no status is telling us plainly, and that is a sentence rather than a
     * digit that could belong to anything.
     */
    expect(probe.classify(new Error('Request was unauthorized'))).toBe(COMMON.auth_failed);
  });

  it('ignores a three-digit number that is not framed as a status', () => {
    const error = new Error('Could not read 401 rows from the mailbox');

    expect(probe.classify(error)).not.toBe(COMMON.auth_failed);
  });
});
