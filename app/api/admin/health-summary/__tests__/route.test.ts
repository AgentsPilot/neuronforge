/**
 * GET /api/admin/health-summary (admin reorganisation slice 4).
 *
 * The gate first (401/403 beat 400, and no read on any denial), strict Zod,
 * per-read isolation, the deadline that stops paging (C-4), the spend
 * exactness rules (C-1, C-4) and the leak check on the body and the log (C-7).
 */

import { NextRequest } from 'next/server';

const mockGetUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => mockGetUser() }));

const mockIsAdmin = jest.fn();
jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: { getInstance: () => ({ isAdmin: (...args: unknown[]) => mockIsAdmin(...args) }) },
}));

const mockLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {
      info: (...a: unknown[]) => mockLog.info(...a),
      warn: (...a: unknown[]) => mockLog.warn(...a),
      error: (...a: unknown[]) => mockLog.error(...a),
      debug: (...a: unknown[]) => mockLog.debug(...a),
    };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

const mockSettingsView = jest.fn();
jest.mock('@/lib/business-os/llm/adminSettingsView', () => ({
  buildAdminSettingsView: () => mockSettingsView(),
}));

const mockModeSetting = jest.fn();
jest.mock('@/lib/business-os/entitlements/mode', () => ({
  getEntitlementModeSetting: () => mockModeSetting(),
}));

const mockCount = jest.fn();
const mockCostPoints = jest.fn();
jest.mock('@/lib/repositories/AdminTokenUsageAnalyticsRepository', () => ({
  ADMIN_HEALTH_READ_LIMITS: { PAGE_SIZE: 1000, CEILING: 10000 },
  adminTokenUsageAnalyticsRepository: {
    countAllAccountsInWindow: (...a: unknown[]) => mockCount(...a),
    listCostPointsAllAccountsInWindow: (...a: unknown[]) => mockCostPoints(...a),
  },
}));

const mockAuditCount = jest.fn();
jest.mock('@/lib/repositories/AuditTrailRepository', () => ({
  auditTrailRepository: { countAdminEventsAllAccountsInWindow: (...a: unknown[]) => mockAuditCount(...a) },
}));

import { GET } from '../route';
import { bosRowFilter } from '@/lib/business-os/llm/callCatalog';

const ADMIN = { id: '11111111-1111-4111-8111-111111111111', email: 'ops@example.com' };
const OFF_AREA_ADMIN_EMAIL = 'changed-by@example.com';

function req(query = '') {
  return new NextRequest(`http://localhost/api/admin/health-summary${query}`, {
    headers: { 'x-correlation-id': 'corr-health' },
  });
}

function area(name: string, over: Record<string, unknown> = {}) {
  return {
    area: name,
    switchable: true,
    configuredEnabled: true,
    calls: [{ resolved: { enabled: true }, issues: [] }],
    areaIssues: [],
    // Present in the real view, and must never reach the response or the log.
    lastChangedBy: { kind: 'admin', at: null, email: OFF_AREA_ADMIN_EMAIL },
    ...over,
  };
}

/** A quiet platform: every read works and nothing matches a rule. */
function quiet() {
  mockSettingsView.mockResolvedValue({ areas: [area('insights'), area('chat')], generatedAt: 'x' });
  mockAuditCount.mockResolvedValue({ data: 0, error: null });
  mockCount.mockResolvedValue({ data: 0, error: null });
  mockCostPoints.mockResolvedValue({ data: { rows: [], reachedCeiling: false, completed: true, pages: 1 }, error: null });
  mockModeSetting.mockReturnValue({ effective: 'off', requested: 'off', refused: false });
}

const reads = () => [mockSettingsView, mockAuditCount, mockCount, mockCostPoints];

async function json(res: Response) {
  return (await res.json()) as {
    success: boolean;
    error?: string;
    details?: string;
    data?: { tiles: Array<{ id: string; status: string; headline: string; matchedRuleId: string | null; figures: Array<{ value: string; exact: boolean; note: string | null }> }> };
  };
}

const tile = (body: Awaited<ReturnType<typeof json>>, id: string) => body.data!.tiles.find((t) => t.id === id)!;

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue(ADMIN);
  mockIsAdmin.mockResolvedValue(true);
  quiet();
});

describe('the gate, and nothing before it', () => {
  it('401 when signed out, with no read', async () => {
    mockGetUser.mockResolvedValue(null);
    const res = await GET(req());
    expect(res.status).toBe(401);
    for (const r of reads()) expect(r).not.toHaveBeenCalled();
  });

  it('401 when the auth lookup throws', async () => {
    mockGetUser.mockRejectedValue(new Error('supabase down'));
    const res = await GET(req());
    expect(res.status).toBe(401);
    for (const r of reads()) expect(r).not.toHaveBeenCalled();
  });

  it('403 when signed in but not an admin, with no read', async () => {
    mockIsAdmin.mockResolvedValue(false);
    const res = await GET(req());
    expect(res.status).toBe(403);
    for (const r of reads()) expect(r).not.toHaveBeenCalled();
  });

  it('403 when the admin check throws (fail closed)', async () => {
    mockIsAdmin.mockRejectedValue(new Error('boom'));
    expect((await GET(req())).status).toBe(403);
    for (const r of reads()) expect(r).not.toHaveBeenCalled();
  });

  it('401/403 beat 400: a non-admin with a bad parameter gets 403', async () => {
    mockIsAdmin.mockResolvedValue(false);
    expect((await GET(req('?x=1'))).status).toBe(403);
  });
});

describe('Zod: the route takes no parameters', () => {
  it('400 on any parameter, with a fixed message and no read', async () => {
    const res = await GET(req('?_=123'));
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe('This endpoint takes no parameters');
    for (const r of reads()) expect(r).not.toHaveBeenCalled();
  });
});

describe('happy path', () => {
  it('seven tiles in order; quiet means Normal everywhere measured; jobs and queues not measured', async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data!.tiles.map((t) => t.id)).toEqual([
      'bos_ai_settings', 'bos_ai_failures', 'bos_ai_spend', 'critical_audit', 'entitlements_mode', 'scheduled_jobs', 'queues',
    ]);
    for (const id of ['bos_ai_settings', 'bos_ai_failures', 'bos_ai_spend', 'critical_audit', 'entitlements_mode']) {
      expect(tile(body, id).status).toBe('neutral');
      expect(tile(body, id).headline).toBe('Normal');
    }
    expect(tile(body, 'scheduled_jobs').status).toBe('not_measured');
    expect(tile(body, 'queues').status).toBe('not_measured');
  });

  it('passes the Business OS row filter unchanged, with the admin context and a deadline signal', async () => {
    await GET(req());
    const [context, window, filters, opts] = mockCostPoints.mock.calls[0];
    expect(context).toEqual({ correlationId: 'corr-health', adminId: ADMIN.id });
    expect(filters).toEqual({ featureFilter: bosRowFilter() });
    expect(opts).toMatchObject({ pageSize: 1000, ceiling: 10000 });
    expect(opts.signal).toBeInstanceOf(AbortSignal);
    expect(Date.parse(window.end) - Date.parse(window.start)).toBe(14 * 24 * 3600 * 1000);
    expect(mockCount.mock.calls[0][2]).toEqual({ featureFilter: bosRowFilter() });
  });

  it('counts the failed, completed and critical audit rows in the right windows', async () => {
    await GET(req());
    const calls = mockAuditCount.mock.calls.map(([, filter, window]) => ({ filter, span: Date.parse(window.end) - Date.parse(window.start) }));
    const day = 24 * 3600 * 1000;
    expect(calls).toEqual(
      expect.arrayContaining([
        { filter: { action: 'BUSINESS_AI_ACTION_FAILED' }, span: day },
        { filter: { action: 'BUSINESS_AI_ACTION_FAILED' }, span: 7 * day },
        { filter: { action: 'BUSINESS_AI_ACTION_COMPLETED' }, span: day },
        { filter: { severity: 'critical' }, span: day },
        { filter: { severity: 'critical' }, span: 7 * day },
      ])
    );
  });

  it('colours from the first matching rule: 6 failures in 24 h is red "5+ AI failures in the last 24 hours"', async () => {
    mockAuditCount.mockImplementation(async (_c: unknown, filter: { action?: string }) => ({
      data: filter.action === 'BUSINESS_AI_ACTION_FAILED' ? 6 : 0,
      error: null,
    }));
    const body = await json(await GET(req()));
    expect(tile(body, 'bos_ai_failures').status).toBe('red');
    expect(tile(body, 'bos_ai_failures').headline).toBe('5+ AI failures in the last 24 hours');
  });

  it('an area configured off turns the settings tile amber, counted with the page\'s own rule', async () => {
    mockSettingsView.mockResolvedValue({
      areas: [area('insights', { configuredEnabled: false, calls: [{ resolved: { enabled: false }, issues: [] }] }), area('chat')],
      generatedAt: 'x',
    });
    const body = await json(await GET(req()));
    const settings = tile(body, 'bos_ai_settings');
    expect(settings.status).toBe('amber');
    expect(settings.headline).toBe('AI switched off somewhere');
    // The area is off; its call is NOT counted again (areaOffSummary).
    expect(settings.figures[0].value).toBe('1');
    expect(settings.figures[1].value).toBe('0');
  });

  it('sums spend per window from the rows read', async () => {
    const now = Date.now();
    mockCount.mockResolvedValue({ data: 2, error: null });
    mockCostPoints.mockResolvedValue({
      data: {
        rows: [
          { id: 'a', created_at: new Date(now - 2 * 3600 * 1000).toISOString(), cost_usd: '1.5' },
          { id: 'b', created_at: new Date(now - 3 * 24 * 3600 * 1000).toISOString(), cost_usd: 2 },
        ],
        reachedCeiling: false,
        completed: true,
        pages: 1,
      },
      error: null,
    });
    const body = await json(await GET(req()));
    const spend = tile(body, 'bos_ai_spend');
    expect(spend.figures[0].value).toContain('$1.50');
    expect(spend.figures[1].value).toContain('$3.50');
    expect(spend.figures.every((f) => f.exact)).toBe(true);
  });
});

describe('failure isolation', () => {
  it('one audit read failing makes only its tile unavailable; the error is logged, not returned', async () => {
    mockAuditCount.mockImplementation(async (_c: unknown, filter: { severity?: string }) =>
      filter.severity ? { data: null, error: new Error('relation "secret_table" does not exist') } : { data: 0, error: null }
    );
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(tile(body, 'critical_audit').status).toBe('unavailable');
    expect(tile(body, 'bos_ai_failures').status).toBe('neutral');
    expect(JSON.stringify(body)).not.toContain('secret_table');
  });

  it.each([
    ['no areas list', { generatedAt: 'x' }],
    ['an area without areaIssues', { areas: [{ area: 'insights', switchable: true, configuredEnabled: true, calls: [] }] }],
    ['an area without calls', { areas: [{ area: 'insights', switchable: true, configuredEnabled: true, areaIssues: [] }] }],
    ['null', null],
  ])('a settings view with %s makes only the settings tile unavailable, never a 500 (B-1)', async (_, view) => {
    mockSettingsView.mockResolvedValue(view);
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(tile(body, 'bos_ai_settings').status).toBe('unavailable');
    for (const id of ['bos_ai_failures', 'bos_ai_spend', 'critical_audit', 'entitlements_mode']) {
      expect(tile(body, id).status).toBe('neutral');
    }
    const served = mockLog.info.mock.calls.find(([, msg]) => msg === 'Health summary served');
    expect(served?.[0].reads).toContainEqual(expect.objectContaining({ read: 'settings', ok: false }));
  });

  it('the settings view throwing makes only the settings tile unavailable', async () => {
    mockSettingsView.mockRejectedValue(new Error('pricing read failed'));
    const body = await json(await GET(req()));
    expect(tile(body, 'bos_ai_settings').status).toBe('unavailable');
    expect(tile(body, 'bos_ai_spend').status).toBe('neutral');
  });

  it('spend: the page read failing → unavailable (C-4)', async () => {
    mockCostPoints.mockResolvedValue({ data: null, error: new Error('timeout') });
    expect(tile(await json(await GET(req())), 'bos_ai_spend').status).toBe('unavailable');
  });

  it('spend: only the count failing → figures still exact by natural completion, no "calls", no OI-P1 note (C-4)', async () => {
    mockCount.mockResolvedValue({ data: null, error: new Error('count failed') });
    const spend = tile(await json(await GET(req())), 'bos_ai_spend');
    expect(spend.status).toBe('neutral');
    expect(spend.figures.every((f) => f.exact && f.note === null && !f.value.includes('calls'))).toBe(true);
  });

  it('spend: the ceiling reached inside the 24 h window → "at least", the ratios cannot fire, amber', async () => {
    const recent = new Date(Date.now() - 60 * 1000).toISOString();
    mockCount.mockResolvedValue({ data: 20000, error: null });
    mockCostPoints.mockResolvedValue({
      data: { rows: [{ id: 'a', created_at: recent, cost_usd: 3 }], reachedCeiling: true, completed: false, pages: 10 },
      error: null,
    });
    const spend = tile(await json(await GET(req())), 'bos_ai_spend');
    expect(spend.figures[0].value).toContain('at least');
    expect(spend.figures[0].exact).toBe(false);
    expect(spend.status).toBe('amber');
    expect(spend.matchedRuleId).toBe('spend.lowerBound');
  });

  it('the entitlements refusal turns that tile amber', async () => {
    mockModeSetting.mockReturnValue({ effective: 'shadow', requested: 'enforce', refused: true });
    const t = tile(await json(await GET(req())), 'entitlements_mode');
    expect(t.status).toBe('amber');
    expect(t.headline).toBe('Enforcement requested but not active');
  });
});

describe('C-4: the deadline stops work', () => {
  beforeEach(() => jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] }));
  afterEach(() => jest.useRealTimers());

  it('a read past its deadline makes its tile unavailable, and the signal is aborted', async () => {
    let seenSignal: AbortSignal | undefined;
    mockCostPoints.mockImplementation(
      (_c: unknown, _w: unknown, _f: unknown, opts: { signal: AbortSignal }) =>
        new Promise((resolve) => {
          seenSignal = opts.signal;
          // Settles long after the deadline: must not surface as an unhandled rejection.
          setTimeout(() => resolve({ data: { rows: [], reachedCeiling: false, completed: true, pages: 1 }, error: null }), 60_000);
        })
    );
    const pending = GET(req());
    await jest.advanceTimersByTimeAsync(5001);
    const body = await json(await pending);
    expect(tile(body, 'bos_ai_spend').status).toBe('unavailable');
    expect(seenSignal?.aborted).toBe(true);
    await jest.advanceTimersByTimeAsync(60_000);
  });
});

describe('C-7: nothing leaks', () => {
  it('500 on an unexpected throw, with no details in production', async () => {
    const env = process.env as Record<string, string | undefined>;
    const original = env.NODE_ENV;
    env.NODE_ENV = 'production';
    // Every read is isolated per tile, so force a throw outside them: the
    // "served" log line is the last thing before the response.
    mockLog.info.mockImplementationOnce(() => {
      throw new Error('internal detail');
    });
    try {
      const res = await GET(req());
      expect(res.status).toBe(500);
      const body = await json(res);
      expect(body.error).toBe('Could not build the health summary');
      expect(body.details).toBeUndefined();
    } finally {
      env.NODE_ENV = original;
    }
  });

  it('the body and every log argument carry no email, no lastChangedBy and no error message', async () => {
    mockSettingsView.mockResolvedValue({
      areas: [area('insights', { configuredEnabled: false })],
      generatedAt: 'x',
    });
    mockAuditCount.mockImplementation(async (_c: unknown, filter: { severity?: string }) =>
      filter.severity ? { data: null, error: new Error('permission denied for table audit_trail') } : { data: 1, error: null }
    );
    const body = await json(await GET(req()));
    const everything = JSON.stringify(body) + JSON.stringify([...mockLog.info.mock.calls, ...mockLog.warn.mock.calls, ...mockLog.error.mock.calls]);
    expect(everything).not.toContain(OFF_AREA_ADMIN_EMAIL);
    expect(everything).not.toContain(ADMIN.email);
    expect(everything).not.toContain('lastChangedBy');
    expect(everything).not.toContain('permission denied');
  });

  it('logs one "served" line with timings and statuses', async () => {
    await GET(req());
    const served = mockLog.info.mock.calls.find(([, msg]) => msg === 'Health summary served');
    expect(served?.[0]).toMatchObject({ adminUserId: ADMIN.id, totalMs: expect.any(Number) });
    expect(Array.isArray(served?.[0].reads)).toBe(true);
  });
});
