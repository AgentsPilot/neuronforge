/**
 * POST /api/admin/model-pricing/manual-entries (AI model price review slice 3).
 *
 *   G  the gate comes first: on 401/403 the body is never read and nothing runs
 *   Z  strict Zod: invalid input is 400 and nothing is stored
 *   R  a hard refusal on any line is 422 and nothing is stored (O-7)
 *   S  the RPC gets an allow-listed payload: the admin id from the gate, the
 *      snapshot and flags from the server, prices as strings (C-12)
 *   E  23505 → 409, 42501 → 403 (O-15), anything else → 500 with no detail
 *   A  one AI_PRICE_MANUAL_ENTRY entry, flushed BEFORE the response (O-14)
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

const mockLoadSnapshot = jest.fn();
const mockLineContextFor = jest.fn();
jest.mock('@/lib/ai/pricing-research/comparisonModel', () => ({
  loadPricingSnapshot: () => mockLoadSnapshot(),
  lineContextFor: (...args: unknown[]) => mockLineContextFor(...args),
}));

const mockSubmit = jest.fn();
jest.mock('@/lib/repositories/AiPriceProposalRepository', () => ({
  aiPriceProposalRepository: {
    submitPending: (...args: unknown[]) => {
      order.push('submit');
      return mockSubmit(...args);
    },
  },
}));

import { POST } from '../route';

const today = new Date().toISOString().slice(0, 10);
const LINE = {
  kind: 'token',
  provider: 'openai',
  model_name: 'example-model',
  input_per_1m: '0.075',
  output_per_1m: '0.3',
  source_url: 'https://developers.openai.com/api/docs/pricing',
  checked_on: today,
};

function post(body: unknown, raw?: string): NextRequest {
  return new NextRequest('http://localhost/api/admin/model-pricing/manual-entries', {
    method: 'POST',
    body: raw ?? JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-correlation-id': 'corr-1' },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  logged.length = 0;
  order.length = 0;
  mockGetUser.mockResolvedValue({ id: 'admin-1', email: 'admin@example.com' });
  mockIsAdmin.mockResolvedValue(true);
  mockLoadSnapshot.mockResolvedValue({ snapshot: true });
  mockLineContextFor.mockReturnValue({
    context: {
      current: {},
      fallback: {},
      conservative: {},
      inCoverage: false,
      inputOnly: false,
    },
    snapshotFields: { input_per_1m: '0.075', output_per_1m: '0.3', current_basis: 'unpriced' },
  });
  mockSubmit.mockResolvedValue({
    data: [{ proposalId: 'proposal-1', lineId: 'line-1', lineIndex: 1, supersededLineId: null }],
    error: null,
  });
  mockLogAndFlush.mockResolvedValue(undefined);
});

describe('G: the gate comes first', () => {
  it('401 when signed out: the body is never read', async () => {
    mockGetUser.mockResolvedValue(null);
    const request = post({ lines: [LINE] });
    const json = jest.spyOn(request, 'json');
    const response = await POST(request);
    expect(response.status).toBe(401);
    expect(json).not.toHaveBeenCalled();
    expect(mockLoadSnapshot).not.toHaveBeenCalled();
    expect(mockSubmit).not.toHaveBeenCalled();
    expect(mockLogAndFlush).not.toHaveBeenCalled();
  });

  it('403 when not an admin: the body is never read', async () => {
    mockIsAdmin.mockResolvedValue(false);
    const request = post({ lines: [LINE] });
    const json = jest.spyOn(request, 'json');
    const response = await POST(request);
    expect(response.status).toBe(403);
    expect(json).not.toHaveBeenCalled();
    expect(mockSubmit).not.toHaveBeenCalled();
  });
});

describe('Z: invalid input is 400 and nothing is stored', () => {
  it.each([
    ['not JSON', undefined, '{'],
    ['no lines', {}, undefined],
    ['a price as a number', { lines: [{ ...LINE, input_per_1m: 0.075 }] }, undefined],
    ['10 decimals', { lines: [{ ...LINE, input_per_1m: '0.0750000001' }] }, undefined],
    ['an unofficial source', { lines: [{ ...LINE, source_url: 'https://example.com/prices' }] }, undefined],
    // CR-1: new URL() forgives these, the database CHECK does not: 400, never a 500.
    ['an upper-case scheme', { lines: [{ ...LINE, source_url: 'HTTPS://developers.openai.com/api/docs/pricing' }] }, undefined],
    ['a leading space', { lines: [{ ...LINE, source_url: ' https://developers.openai.com/api/docs/pricing' }] }, undefined],
    ['an admin id in the body (C-12)', { lines: [LINE], admin_user_id: 'someone-else' }, undefined],
    ['a snapshot in a line (C-12)', { lines: [{ ...LINE, current_basis: 'table' }] }, undefined],
  ])('%s', async (_label, body, raw) => {
    const response = await POST(post(body, raw));
    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload).toMatchObject({ success: false, code: 'invalid_input' });
    expect(mockLoadSnapshot).not.toHaveBeenCalled();
    expect(mockSubmit).not.toHaveBeenCalled();
    expect(mockLogAndFlush).not.toHaveBeenCalled();
  });
});

describe('R: a hard refusal on any line refuses the whole request (422)', () => {
  it('a zero input price', async () => {
    const response = await POST(post({ lines: [LINE, { ...LINE, model_name: 'example-two', input_per_1m: '0' }] }));
    expect(response.status).toBe(422);
    const payload = await response.json();
    expect(payload.code).toBe('refused');
    expect(payload.problems).toEqual([{ path: 'lines.1', message: 'The input price must be above 0' }]);
    expect(mockSubmit).not.toHaveBeenCalled();
    expect(mockLogAndFlush).not.toHaveBeenCalled();
  });

  it('the same model and unit twice', async () => {
    const response = await POST(post({ lines: [LINE, LINE] }));
    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe('duplicate_unit');
    expect(mockSubmit).not.toHaveBeenCalled();
  });
});

describe('S and A: the happy path', () => {
  it('stores the line as pending with an allow-listed payload, audits, then responds', async () => {
    const response = await POST(post({ lines: [LINE] }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      data: {
        proposalId: 'proposal-1',
        lines: [{ id: 'line-1', provider: 'openai', modelName: 'example-model', kind: 'token', flags: ['new_model'], supersededLineId: null }],
      },
    });

    expect(mockSubmit).toHaveBeenCalledWith({
      adminUserId: 'admin-1',
      sourceKind: 'manual',
      providerOutcomes: null,
      lines: [
        {
          input_per_1m: '0.075',
          output_per_1m: '0.3',
          current_basis: 'unpriced',
          kind: 'token',
          provider: 'openai',
          model_name: 'example-model',
          source_url: 'https://developers.openai.com/api/docs/pricing',
          checked_on: today,
          flags: ['new_model'],
        },
      ],
    });

    expect(order).toEqual(['submit', 'audit']);
    expect(mockLogAndFlush).toHaveBeenCalledTimes(1);
    const [entry, , context] = mockLogAndFlush.mock.calls[0];
    expect(entry).toMatchObject({
      action: 'AI_PRICE_MANUAL_ENTRY',
      entityType: 'ai_pricing',
      entityId: 'proposal-1',
      userId: 'admin-1',
      actorId: 'admin-1',
      severity: 'info',
      details: {
        entity_kind: 'price_proposal',
        proposal_id: 'proposal-1',
        correlationId: 'corr-1',
        lines: [expect.objectContaining({ line_id: 'line-1', input_per_1m: '0.075', source_url: LINE.source_url, flags: ['new_model'] })],
      },
    });
    expect(context).toEqual({ reason: 'manual price entry', continues: 'the pending price is stored' });
  });

  it('an audit failure does not change the answer (logAndFlush never rejects; it resolves after logging)', async () => {
    mockLogAndFlush.mockResolvedValue(undefined);
    expect((await POST(post({ lines: [LINE] }))).status).toBe(200);
  });
});

describe('E: errors', () => {
  it('23505 (a concurrent submit on the same unit) is 409', async () => {
    mockSubmit.mockResolvedValue({ data: null, error: Object.assign(new Error('dup'), { code: '23505' }) });
    const response = await POST(post({ lines: [LINE] }));
    expect(response.status).toBe(409);
    expect(mockLogAndFlush).not.toHaveBeenCalled();
  });

  it('42501 (no active admin_users row) is 403 with a warn log (O-15)', async () => {
    mockSubmit.mockResolvedValue({ data: null, error: Object.assign(new Error('no'), { code: '42501' }) });
    const response = await POST(post({ lines: [LINE] }));
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe('not_admin_row');
    expect(logged.some((entry) => entry.level === 'warn')).toBe(true);
  });

  it('anything else is 500 with no internal detail outside development', async () => {
    mockSubmit.mockResolvedValue({ data: null, error: new Error('relation secret_table does not exist') });
    const response = await POST(post({ lines: [LINE] }));
    expect(response.status).toBe(500);
    const payload = await response.json();
    expect(payload.details).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain('secret_table');
  });

  it('a snapshot read failure is 500 and nothing is stored', async () => {
    mockLoadSnapshot.mockRejectedValue(new Error('down'));
    const response = await POST(post({ lines: [LINE] }));
    expect(response.status).toBe(500);
    expect(mockSubmit).not.toHaveBeenCalled();
  });
});
