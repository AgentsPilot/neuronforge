/**
 * Effort Estimator — dispatcher tests.
 *
 * The dispatcher always fires (subject to its outer .catch). Failure of the
 * inner estimator must NEVER throw out of the helper — the caller should
 * proceed without disruption and the error should be logged.
 */

const estimateEffort = jest.fn().mockResolvedValue({
  success: true,
  estimate: undefined,
  previousEstimate: null,
  attempts: 1,
  totalDurationMs: 100,
});

jest.mock('../EffortEstimator', () => ({
  estimateEffort: (input: unknown) => estimateEffort(input),
}));

import { dispatchEffortEstimate } from '../dispatch';

function makeLogger() {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    fatal: jest.fn(),
    trace: jest.fn(),
    child: jest.fn(),
  } as any;
}

const baseInput = {
  agentId: 'a1',
  userId: 'u1',
  userContext: {},
  correlationId: 'c1',
  reason: 'agent_created' as const,
};

describe('dispatchEffortEstimate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('invokes the estimator exactly once with the passed input', async () => {
    const logger = makeLogger();

    dispatchEffortEstimate(baseInput, logger);

    // Allow the async IIFE + dynamic import to settle.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(estimateEffort).toHaveBeenCalledTimes(1);
    expect(estimateEffort).toHaveBeenCalledWith(baseInput);
  });

  it('logs an error (non-blocking) when the estimator rejects', async () => {
    estimateEffort.mockRejectedValueOnce(new Error('boom'));
    const logger = makeLogger();

    dispatchEffortEstimate(baseInput, logger);

    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error), agentId: 'a1' }),
      expect.stringMatching(/dispatch failed/i)
    );
  });

  it('does not throw synchronously even when the inner estimator throws', () => {
    estimateEffort.mockRejectedValueOnce(new Error('cold-start failure'));
    const logger = makeLogger();

    expect(() => dispatchEffortEstimate(baseInput, logger)).not.toThrow();
  });
});
