/**
 * POST /api/admin/model-pricing/apply (AI model price review slice 8).
 *
 *   G  the gate comes first: on 401/403 the body is never read and nothing runs
 *   Z  strict Zod: ids and reasons only; an injected admin id, price or margin is 400
 *   L  an unknown line is 404, a decided line 409, before any write
 *   S  the route-side stale check and RC-7 refusals are 409 / 422 before the function
 *   O  override reasons follow the stored blocking flags (422 both ways)
 *   F  the function payload is allow-listed: the session admin id, ids, reasons,
 *      and the server's own margin record; database refusals map to their answers
 *   A  one AI_PRICING_APPLIED_LINE per line, in ONE logAndFlush call, before the
 *      response; the cache refresh is bounded (F-5); a flush failure still answers 200
 */

import { NextRequest } from 'next/server';

const mockGetUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => mockGetUser() }));
const mockIsAdmin = jest.fn();
jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: { getInstance: () => ({ isAdmin: (...args: unknown[]) => mockIsAdmin(...args) }) },
}));
jest.mock('@/lib/audit/recordRefusedAccess', () => ({ recordRefusedAccess: jest.fn(async () => undefined) }));

const logged: Array<{ level: string; args: unknown[] }> = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['info', 'warn', 'error', 'debug']) {
      logger[level] = (...args: unknown[]) => logged.push({ level, args });
    }
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

const order: string[] = [];
const mockLogAndFlush = jest.fn();
jest.mock('@/lib/audit/boundedAuditFlush', () => ({
  logAndFlush: (...args: unknown[]) => {
    order.push('audit');
    return mockLogAndFlush(...args);
  },
}));

const mockRefresh = jest.fn();
jest.mock('@/lib/ai/pricing', () => ({
  refreshPricingCache: () => {
    order.push('refresh');
    return mockRefresh();
  },
}));

const mockLoadSnapshot = jest.fn();
jest.mock('@/lib/ai/pricing-research/comparisonModel', () => ({ loadPricingSnapshot: () => mockLoadSnapshot() }));

const mockIsLineStale = jest.fn();
const mockReview = jest.fn();
const mockMargin = jest.fn();
jest.mock('@/lib/ai/pricing-research/applyDecision', () => ({
  auditPricesOf: jest.requireActual('@/lib/ai/pricing-research/applyDecision').auditPricesOf,
  EFFECTIVE_WORDS: 'In effect on all servers within 1 hour.',
  isLineStale: (...args: unknown[]) => mockIsLineStale(...args),
  reviewLineForApply: (...args: unknown[]) => mockReview(...args),
  marginItemsFor: (...args: unknown[]) => mockMargin(...args),
}));

const mockFindLines = jest.fn();
jest.mock('@/lib/repositories/AiPriceProposalRepository', () => ({
  aiPriceProposalRepository: { findLinesForDecision: (...args: unknown[]) => mockFindLines(...args) },
}));
const mockApply = jest.fn();
jest.mock('@/lib/repositories/AiPriceApplyRepository', () => ({
  aiPriceApplyRepository: {
    applyLines: (...args: unknown[]) => {
      order.push('apply');
      return mockApply(...args);
    },
  },
}));

import { POST } from '../route';

const LINE_A = '11111111-1111-4111-8111-111111111111';
const LINE_B = '22222222-2222-4222-8222-222222222222';
const SOURCE = 'https://developers.openai.com/api/docs/pricing';

function decisionLine(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    proposal_id: 'proposal-1',
    kind: 'token',
    provider: 'openai',
    model_name: id === LINE_A ? 'example-model-a' : 'example-model-b',
    image_size: null,
    image_quality: null,
    input_per_1m: '0.15',
    output_per_1m: '0.6',
    cached_input_per_1m: null,
    price_per_image: null,
    current_basis: 'table',
    current_row_id: 'row-1',
    current_input_cost_per_token: '0.00000015',
    current_output_cost_per_token: '0.0000006',
    current_cached_input_cost_per_token: '0.000000075',
    current_cost_per_image: null,
    source_url: SOURCE,
    checked_on: '2026-10-17',
    flags: [],
    state: 'pending',
    created_by: 'submitter-1',
    ...overrides,
  };
}

function post(body: unknown, raw?: string): NextRequest {
  return new NextRequest('http://localhost/api/admin/model-pricing/apply', {
    method: 'POST',
    body: raw ?? JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-correlation-id': 'corr-1' },
  });
}

const REASON = `Provider price change — source ${SOURCE} (checked 2026-10-17)`;
const MARGIN = { needed: true, items: [{ provider: 'openai', model: 'example-model-a', areas: ['Chat'], changes: [], fallbackDiffers: false }] };

beforeEach(() => {
  jest.clearAllMocks();
  logged.length = 0;
  order.length = 0;
  mockGetUser.mockResolvedValue({ id: 'admin-1', email: 'admin@example.com' });
  mockIsAdmin.mockResolvedValue(true);
  mockFindLines.mockImplementation(async (ids: string[]) => ({ data: ids.map((id) => decisionLine(id)), error: null }));
  mockLoadSnapshot.mockResolvedValue({ snapshot: true });
  mockIsLineStale.mockReturnValue(false);
  mockReview.mockImplementation((_snapshot: unknown, line: { flags: string[] }) => ({
    refusals: [],
    blockingChanged: false,
    blockingFlags: line.flags.filter((flag) => flag === 'large_move'),
  }));
  mockMargin.mockReturnValue(MARGIN);
  mockApply.mockImplementation(async (input: { lines: Array<{ line_id: string }> }) => ({
    data: input.lines.map((line) => ({
      batchId: 'batch-1',
      lineId: line.line_id,
      liveKind: 'token',
      newRowId: `new-${line.line_id}`,
      retiredRowIds: ['row-1'],
      appliedAt: '2026-10-17T10:15:00.000Z',
    })),
    error: null,
  }));
  mockRefresh.mockResolvedValue(undefined);
  mockLogAndFlush.mockResolvedValue(undefined);
});

describe('G: the gate comes first', () => {
  it('401 when signed out: the body is never read', async () => {
    mockGetUser.mockResolvedValue(null);
    const request = post({ lines: [{ lineId: LINE_A, reason: REASON }] });
    const json = jest.spyOn(request, 'json');
    const response = await POST(request);
    expect(response.status).toBe(401);
    expect(json).not.toHaveBeenCalled();
    expect(mockFindLines).not.toHaveBeenCalled();
    expect(mockApply).not.toHaveBeenCalled();
  });

  it('403 when not an admin: the body is never read', async () => {
    mockIsAdmin.mockResolvedValue(false);
    const request = post({ lines: [{ lineId: LINE_A, reason: REASON }] });
    const json = jest.spyOn(request, 'json');
    const response = await POST(request);
    expect(response.status).toBe(403);
    expect(json).not.toHaveBeenCalled();
    expect(mockApply).not.toHaveBeenCalled();
  });
});

describe('Z: invalid input is 400 and nothing is read or written', () => {
  it.each([
    ['not JSON', undefined, '{'],
    ['no lines', { lines: [] }, undefined],
    ['a line id that is not a uuid', { lines: [{ lineId: 'line-1', reason: REASON }] }, undefined],
    ['a reason too short', { lines: [{ lineId: LINE_A, reason: ' a ' }] }, undefined],
    ['the same line twice', { lines: [{ lineId: LINE_A, reason: REASON }, { lineId: LINE_A, reason: REASON }] }, undefined],
    ['an injected admin id', { lines: [{ lineId: LINE_A, reason: REASON }], adminUserId: 'someone-else' }, undefined],
    ['an injected price in a line', { lines: [{ lineId: LINE_A, reason: REASON, input_per_1m: '0.01' }] }, undefined],
    ['an injected margin record', { lines: [{ lineId: LINE_A, reason: REASON }], margin: { needed: false } }, undefined],
    ['51 lines', { lines: Array.from({ length: 51 }, (_v, index) => ({ lineId: `${String(index).padStart(8, '0')}-1111-4111-8111-111111111111`, reason: REASON })) }, undefined],
  ])('%s', async (_label, body, raw) => {
    const response = await POST(post(body, raw));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ success: false, code: 'invalid_input' });
    expect(mockFindLines).not.toHaveBeenCalled();
    expect(mockApply).not.toHaveBeenCalled();
    expect(mockLogAndFlush).not.toHaveBeenCalled();
  });
});

describe('L: the lines must exist and still be pending', () => {
  it('404 for an unknown line id, naming it', async () => {
    mockFindLines.mockResolvedValue({ data: [], error: null });
    const response = await POST(post({ lines: [{ lineId: LINE_A, reason: REASON }] }));
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: 'not_found', lineIds: [LINE_A] });
    expect(mockApply).not.toHaveBeenCalled();
  });

  it('409 for a line already applied or dismissed', async () => {
    mockFindLines.mockResolvedValue({ data: [decisionLine(LINE_A, { state: 'dismissed' })], error: null });
    const response = await POST(post({ lines: [{ lineId: LINE_A, reason: REASON }] }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'not_pending', lineIds: [LINE_A] });
    expect(mockApply).not.toHaveBeenCalled();
  });
});

describe('S: the route-side stale check and RC-7', () => {
  it('409 stale when today’s price no longer matches the snapshot', async () => {
    mockIsLineStale.mockImplementation((_s: unknown, line: { id: string }) => line.id === LINE_B);
    const response = await POST(post({ lines: [{ lineId: LINE_A, reason: REASON }, { lineId: LINE_B, reason: REASON }] }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'stale', lineIds: [LINE_B] });
    expect(mockApply).not.toHaveBeenCalled();
  });

  it('409 stale when a recomputable blocking flag changed (RC-7)', async () => {
    mockReview.mockReturnValue({ refusals: [], blockingChanged: true, blockingFlags: [] });
    const response = await POST(post({ lines: [{ lineId: LINE_A, reason: REASON }] }));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('stale');
  });

  it('422 refused when a bound refuses the price today', async () => {
    mockReview.mockReturnValue({ refusals: ['The input price is above the sanity ceiling of $1000 per 1M tokens'], blockingChanged: false, blockingFlags: [] });
    const response = await POST(post({ lines: [{ lineId: LINE_A, reason: REASON }] }));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: 'refused', lineIds: [LINE_A] });
    expect(mockApply).not.toHaveBeenCalled();
  });
});

describe('O: override reasons follow the stored blocking flags', () => {
  it('422 override_required for a flagged line with no override reason', async () => {
    mockFindLines.mockResolvedValue({ data: [decisionLine(LINE_A, { flags: ['large_move'] })], error: null });
    const response = await POST(post({ lines: [{ lineId: LINE_A, reason: REASON }] }));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: 'override_required', lineIds: [LINE_A] });
    expect(mockApply).not.toHaveBeenCalled();
  });

  it('422 override_not_needed for an override on a line with no blocking flag', async () => {
    const response = await POST(post({ lines: [{ lineId: LINE_A, reason: REASON, overrideReason: 'checked by hand' }] }));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: 'override_not_needed', lineIds: [LINE_A] });
    expect(mockApply).not.toHaveBeenCalled();
  });

  it('a flagged line with its override reason goes through, and the override reaches the function', async () => {
    mockFindLines.mockResolvedValue({ data: [decisionLine(LINE_A, { flags: ['large_move'] })], error: null });
    const response = await POST(post({ lines: [{ lineId: LINE_A, reason: REASON, overrideReason: 'Provider confirmed the rise' }] }));
    expect(response.status).toBe(200);
    expect(mockApply.mock.calls[0][0].lines).toEqual([{ line_id: LINE_A, reason: REASON, override_reason: 'Provider confirmed the rise' }]);
  });
});

describe('F: the function call and its refusals', () => {
  it('sends the session admin id, the ids and reasons only, and the server margin record', async () => {
    await POST(post({ lines: [{ lineId: LINE_A, reason: `  ${REASON}  ` }, { lineId: LINE_B, reason: 'Applied after review' }] }));
    expect(mockApply).toHaveBeenCalledWith({
      adminUserId: 'admin-1',
      lines: [
        { line_id: LINE_A, reason: REASON },
        { line_id: LINE_B, reason: 'Applied after review' },
      ],
      margin: MARGIN,
    });
    expect(mockMargin).toHaveBeenCalledWith({ snapshot: true }, [expect.objectContaining({ id: LINE_A }), expect.objectContaining({ id: LINE_B })]);
  });

  it.each([
    ['P8002', undefined, 409, 'stale'],
    ['23505', undefined, 409, 'stale'],
    ['P8001', LINE_A, 409, 'not_pending'],
    ['P8007', LINE_A, 409, 'starts_later'],
    ['55P03', undefined, 409, 'busy'],
    ['40P01', undefined, 409, 'busy'],
    ['P8003', LINE_A, 422, 'override_required'],
    ['P8006', LINE_A, 422, 'override_not_needed'],
    ['P8004', undefined, 404, 'not_found'],
    ['42501', undefined, 403, 'not_admin_row'],
  ])('database %s → %s %s, nothing audited', async (code, details, status, answer) => {
    mockApply.mockResolvedValue({ data: null, error: Object.assign(new Error('refused'), { code, details }) });
    const response = await POST(post({ lines: [{ lineId: LINE_A, reason: REASON }] }));
    expect(response.status).toBe(status);
    const payload = await response.json();
    expect(payload.code).toBe(answer);
    if (details) expect(payload.lineIds).toEqual([details]);
    expect(mockLogAndFlush).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('CR8-1: 42501 (also the emergency stop) answers words that are true in both cases, quoted by the runbook', async () => {
    mockApply.mockResolvedValue({ data: null, error: Object.assign(new Error('permission denied'), { code: '42501' }) });
    const response = await POST(post({ lines: [{ lineId: LINE_A, reason: REASON }] }));
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe(
      'Prices cannot be changed right now: your admin access is not recorded, or an operator has switched Apply off. Ask an operator.'
    );
  });

  it('an unknown database error is a 500 with no detail outside development', async () => {
    mockApply.mockResolvedValue({ data: null, error: Object.assign(new Error('connection reset'), { code: 'XX000' }) });
    const response = await POST(post({ lines: [{ lineId: LINE_A, reason: REASON }] }));
    expect(response.status).toBe(500);
    const payload = await response.json();
    expect(payload.details).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain('connection reset');
  });
});

describe('A: refresh, audit and response', () => {
  it('applies, refreshes this server, audits one entry per line in one call, then answers', async () => {
    const response = await POST(post({ lines: [{ lineId: LINE_A, reason: REASON }, { lineId: LINE_B, reason: REASON }] }));
    expect(response.status).toBe(200);
    expect(order).toEqual(['apply', 'refresh', 'audit']);
    expect(await response.json()).toEqual({
      success: true,
      data: {
        batchId: 'batch-1',
        appliedAt: '2026-10-17T10:15:00.000Z',
        effective: 'In effect on all servers within 1 hour.',
        lines: [
          { lineId: LINE_A, kind: 'token', provider: 'openai', modelName: 'example-model-a' },
          { lineId: LINE_B, kind: 'token', provider: 'openai', modelName: 'example-model-b' },
        ],
        marginReview: MARGIN,
      },
    });
    expect(mockLogAndFlush).toHaveBeenCalledTimes(1);
    const [entries, , context] = mockLogAndFlush.mock.calls[0];
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      action: 'AI_PRICING_APPLIED_LINE',
      entityType: 'ai_pricing',
      entityId: LINE_A,
      userId: 'admin-1',
      actorId: 'admin-1',
      severity: 'warning',
      details: expect.objectContaining({
        entity_kind: 'price_line',
        batch_id: 'batch-1',
        proposal_id: 'proposal-1',
        old_input_per_token: '0.00000015',
        new_input_per_1m: '0.15',
        source_url: SOURCE,
        checked_on: '2026-10-17',
        reason: REASON,
        override_reason: null,
        submitted_by: 'submitter-1',
        applied_by: 'admin-1',
        new_row_id: `new-${LINE_A}`,
        retired_row_ids: ['row-1'],
      }),
    });
    expect(context).toEqual({ reason: 'price apply', continues: 'the price is applied' });
  });

  it('F-5: a hung refresh does not hold the answer; it is logged and the Apply stands', async () => {
    jest.useFakeTimers();
    try {
      mockRefresh.mockReturnValue(new Promise(() => undefined));
      const pending = POST(post({ lines: [{ lineId: LINE_A, reason: REASON }] }));
      await jest.advanceTimersByTimeAsync(2_000);
      const response = await pending;
      expect(response.status).toBe(200);
      expect(logged.some((entry) => entry.level === 'warn' && entry.args[1] === 'Price cache refresh after Apply did not finish; charges follow within 1 hour')).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('R06c: the audit is awaited before the response', async () => {
    let release: () => void = () => undefined;
    mockLogAndFlush.mockReturnValue(new Promise<void>((resolve) => {
      release = resolve;
    }));
    let settled = false;
    const pending = POST(post({ lines: [{ lineId: LINE_A, reason: REASON }] })).then((response) => {
      settled = true;
      return response;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mockLogAndFlush).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    release();
    expect((await pending).status).toBe(200);
  });

  it('QA edge case: a failure after the function committed never says "Nothing was changed"', async () => {
    mockLogAndFlush.mockImplementation(() => {
      throw new Error('audit exploded synchronously');
    });
    const response = await POST(post({ lines: [{ lineId: LINE_A, reason: REASON }] }));
    expect(response.status).toBe(500);
    const payload = await response.json();
    expect(payload.code).toBe('applied_unconfirmed');
    expect(payload.error).toBe('The prices were applied, but the page could not confirm it. Reload the page to see them.');
    expect(JSON.stringify(payload)).not.toContain('Nothing was changed');
  });

  it('a failing refresh or audit flush still answers 200: the price is already applied', async () => {
    mockRefresh.mockRejectedValue(new Error('cache down'));
    mockLogAndFlush.mockRejectedValue(new Error('flush failed'));
    const response = await POST(post({ lines: [{ lineId: LINE_A, reason: REASON }] }));
    expect(response.status).toBe(200);
    expect(logged.some((entry) => entry.level === 'error' && entry.args[1] === 'Apply audit failed; the database provenance remains the record')).toBe(true);
  });
});
