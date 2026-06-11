/**
 * POST /api/v2/agents/[agentId]/estimate-effort — route tests.
 *
 * Covers AC-5 (override succeeds + previous logged), AC-2 happy/exhaustion
 * via the API path, plus auth / not-found / validation edge cases.
 */

const getUser = jest.fn();
jest.mock('@/lib/auth', () => ({
  getUser: () => getUser(),
}));

const estimateEffort = jest.fn();
jest.mock('@/lib/effort-estimator', () => ({
  estimateEffort: (input: unknown) => estimateEffort(input),
}));

import { NextRequest } from 'next/server';
import { POST } from '../route';

function makeRequest(body: unknown = {}) {
  return new NextRequest('http://localhost/api/v2/agents/a1/estimate-effort', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'x-correlation-id': 'test-corr' },
  });
}

function makeParams(agentId = 'a1') {
  return { params: Promise.resolve({ agentId }) };
}

describe('POST /api/v2/agents/[agentId]/estimate-effort', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 401 when no session', async () => {
    getUser.mockResolvedValue(null);

    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('Unauthorized');
    expect(estimateEffort).not.toHaveBeenCalled();
  });

  it('returns 400 when the body has unexpected fields (Zod strict)', async () => {
    getUser.mockResolvedValue({ id: 'u1', email: 'x@y.z', user_metadata: {} });

    const res = await POST(makeRequest({ unexpected: true }), makeParams());
    expect(res.status).toBe(400);
    expect(estimateEffort).not.toHaveBeenCalled();
  });

  it('AC-5 happy path: returns 201 with estimate + previousEstimate + duration', async () => {
    getUser.mockResolvedValue({
      id: 'u1',
      email: 'x@y.z',
      user_metadata: { role: 'founder', domain: 'logistics' },
    });
    const newEstimate = {
      reasoning: 'Founder in logistics, ~5 min triage.',
      is_bulk_workflow: true,
      total_manual_time_seconds: 300,
      generated_at: '2026-06-10T00:00:00.000Z',
      model: 'gpt-4o-mini',
      version: '1' as const,
    };
    const prior = { ...newEstimate, total_manual_time_seconds: 120 };
    estimateEffort.mockResolvedValue({
      success: true,
      estimate: newEstimate,
      previousEstimate: prior,
      attempts: 1,
      totalDurationMs: 850,
    });

    const res = await POST(makeRequest(), makeParams('a1'));
    expect(res.status).toBe(201);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.agentId).toBe('a1');
    expect(body.data.estimate).toEqual(newEstimate);
    expect(body.data.previousEstimate).toEqual(prior);
    expect(body.data.attempts).toBe(1);
    expect(body.data.durationMs).toBe(850);

    expect(estimateEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'a1',
        userId: 'u1',
        reason: 'api_request',
        correlationId: 'test-corr',
      })
    );
  });

  it('returns 404 when the agent is not found (attempts === 0)', async () => {
    getUser.mockResolvedValue({ id: 'u1', email: 'x@y.z', user_metadata: {} });
    estimateEffort.mockResolvedValue({
      success: false,
      attempts: 0,
      totalDurationMs: 10,
      errorMessage: 'agent not found',
    });

    const res = await POST(makeRequest(), makeParams('missing'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('Agent not found');
  });

  it('returns 503 when the estimator exhausts retries', async () => {
    getUser.mockResolvedValue({ id: 'u1', email: 'x@y.z', user_metadata: {} });
    estimateEffort.mockResolvedValue({
      success: false,
      attempts: 3,
      totalDurationMs: 21000,
      errorMessage: 'LLM down',
    });

    const res = await POST(makeRequest(), makeParams('a1'));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('Estimator exhausted retries');
  });

  it('returns 500 when the estimator throws unexpectedly', async () => {
    getUser.mockResolvedValue({ id: 'u1', email: 'x@y.z', user_metadata: {} });
    estimateEffort.mockRejectedValue(new Error('kaboom'));

    const res = await POST(makeRequest(), makeParams('a1'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('Internal server error');
  });
});
