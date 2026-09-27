/**
 * QA edge probes for GET /api/admin/health-summary (admin reorganisation
 * slice 4). Complements route.test.ts: parameter shapes on the strict schema,
 * denial with a parameter, the spend window handed to the repository, zero
 * previous spend, exactly-at-threshold values, window boundary rows, and the
 * count failing while a ceiling-truncated read succeeds.
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

const ADMIN = { id: '11111111-1111-4111-8111-111111111111', email: 'ops@example.com' };
const NOW = new Date('2026-09-26T10:30:45.123Z');
const END = Date.parse('2026-09-26T10:30:00.000Z');
const H = 3_600_000;
const D = 24 * H;

function req(query = '') {
  return new NextRequest(`http://localhost/api/admin/health-summary${query}`, {
    headers: { 'x-correlation-id': 'corr-qa' },
  });
}

type Body = {
  success: boolean;
  error?: string;
  data?: {
    windows: Record<string, string>;
    tiles: Array<{
      id: string;
      status: string;
      headline: string;
      matchedRuleId: string | null;
      figures: Array<{ label: string; value: string; exact: boolean; note: string | null; href: string | null }>;
    }>;
  };
};

async function body(res: Response) {
  return (await res.json()) as Body;
}
const tile = (b: Body, id: string) => b.data!.tiles.find((t) => t.id === id)!;

function quiet() {
  mockSettingsView.mockResolvedValue({ areas: [], generatedAt: 'x' });
  mockAuditCount.mockResolvedValue({ data: 0, error: null });
  mockCount.mockResolvedValue({ data: 0, error: null });
  mockCostPoints.mockResolvedValue({ data: { rows: [], reachedCeiling: false, completed: true, pages: 1 }, error: null });
  mockModeSetting.mockReturnValue({ effective: 'off', requested: 'off', refused: false });
}

let seq = 0;
const row = (atMs: number, cost: number | string) => ({
  id: `r-${seq++}`,
  created_at: new Date(atMs).toISOString(),
  cost_usd: cost,
});

function spendRows(rows: ReturnType<typeof row>[], completed = true) {
  mockCostPoints.mockResolvedValue({
    data: { rows, reachedCeiling: !completed, completed, pages: 1 },
    error: null,
  });
  mockCount.mockResolvedValue({ data: rows.length, error: null });
}

beforeAll(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  jest.setSystemTime(NOW);
});
afterAll(() => jest.useRealTimers());

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue(ADMIN);
  mockIsAdmin.mockResolvedValue(true);
  quiet();
});

describe('QA: the strict schema rejects every parameter shape', () => {
  it.each([['?_=1700000000'], ['?refresh='], ['?a=1&a=2'], ['?scope=bos'], ['?dateFrom=2026-09-01T00:00:00Z']])(
    '%s → 400, fixed message, no read',
    async (query) => {
      const res = await GET(req(query));
      expect(res.status).toBe(400);
      expect((await body(res)).error).toBe('This endpoint takes no parameters');
      for (const m of [mockSettingsView, mockAuditCount, mockCount, mockCostPoints, mockModeSetting]) {
        expect(m).not.toHaveBeenCalled();
      }
    }
  );

  it('signed out with a parameter → 401 (the gate wins), no read', async () => {
    mockGetUser.mockResolvedValue(null);
    const res = await GET(req('?x=1'));
    expect(res.status).toBe(401);
    expect(mockIsAdmin).not.toHaveBeenCalled();
    expect(mockCostPoints).not.toHaveBeenCalled();
  });
});

describe('QA: windows handed to the reads', () => {
  it('the spend reads span [end − 14 d, end] with end floored to the minute; audit reads use the same end', async () => {
    const b = await body(await GET(req()));
    expect(b.data!.windows.end).toBe('2026-09-26T10:30:00.000Z');
    const [, window] = mockCostPoints.mock.calls[0];
    expect(window).toEqual({ start: new Date(END - 14 * D).toISOString(), end: new Date(END).toISOString() });
    expect(mockCount.mock.calls[0][1]).toEqual(window);
    for (const call of mockAuditCount.mock.calls) {
      expect(call[2].end).toBe(new Date(END).toISOString());
    }
  });
});

describe('QA: boundary rows land in exactly one window', () => {
  it('end, 24 h start, previous-24 h start, 7 d start and 14 d start', async () => {
    // Powers of two, so every sum identifies exactly which rows it holds.
    spendRows([
      row(END, 1), //                 last 24 h + last 7 d (inclusive end)
      row(END - D, 2), //             last 24 h (inclusive start) + last 7 d
      row(END - D - 1, 4), //         previous 24 h + last 7 d
      row(END - 2 * D, 8), //         previous 24 h (inclusive start) + last 7 d
      row(END - 2 * D - 1, 16), //    last 7 d only
      row(END - 7 * D, 32), //        last 7 d (inclusive start)
      row(END - 7 * D - 1, 64), //    previous 7 d
      row(END - 14 * D, 128), //      previous 7 d (inclusive start)
    ]);
    const b = await body(await GET(req()));
    const spend = tile(b, 'bos_ai_spend');
    const f24 = spend.figures.find((f) => f.label === 'Last 24 h')!;
    const f7 = spend.figures.find((f) => f.label === 'Last 7 days')!;
    expect(f24.value).toContain('$3.00 (previous 24 h: $12.00)');
    expect(f24.value).toContain('2 calls');
    expect(f7.value).toContain('$63.00 (previous 7 days: $192.00)');
    expect(f7.value).toContain('6 calls');
    // $3 today is above the $1 floor but under 2× $12 → no rule; exact → Normal? No:
    // spend24h 3 < 20; ratios fail; week 63 < 1.5 × 192 → Normal.
    expect(spend.status).toBe('neutral');
    expect(spend.headline).toBe('Normal');
  });
});

describe('QA: zero previous spend (ratio baseline 0)', () => {
  it('both periods zero → Normal', async () => {
    spendRows([]);
    const spend = tile(await body(await GET(req())), 'bos_ai_spend');
    expect(spend.status).toBe('neutral');
  });

  it('new spend under every floor ($0.99 vs $0) → Normal', async () => {
    spendRows([row(END - H, 0.99)]);
    const spend = tile(await body(await GET(req())), 'bos_ai_spend');
    expect(spend.status).toBe('neutral');
  });

  it('new spend at the doubled floor ($1 vs $0) → amber "doubled"', async () => {
    spendRows([row(END - H, 1)]);
    const spend = tile(await body(await GET(req())), 'bos_ai_spend');
    expect(spend.matchedRuleId).toBe('spend.doubled24h');
    expect(spend.status).toBe('amber');
  });

  it('new spend at the tripled floor ($5 vs $0) → red "tripled"', async () => {
    spendRows([row(END - H, 5)]);
    const spend = tile(await body(await GET(req())), 'bos_ai_spend');
    expect(spend.matchedRuleId).toBe('spend.tripled24h');
    expect(spend.status).toBe('red');
  });
});

describe('QA: exactly at the thresholds', () => {
  it('24 h spend exactly $20 → red ceiling rule', async () => {
    spendRows([row(END - H, '20.00'), row(END - 30 * H, 20)]);
    const spend = tile(await body(await GET(req())), 'bos_ai_spend');
    expect(spend.matchedRuleId).toBe('spend.ceiling24h');
  });

  it('24 h spend exactly 3× previous, at the floor ($6 vs $2) → red tripled', async () => {
    spendRows([row(END - H, 6), row(END - 30 * H, 2)]);
    const spend = tile(await body(await GET(req())), 'bos_ai_spend');
    expect(spend.matchedRuleId).toBe('spend.tripled24h');
  });

  it('24 h spend exactly 2× previous ($2 vs $1) → amber doubled', async () => {
    spendRows([row(END - H, 2), row(END - 30 * H, 1)]);
    const spend = tile(await body(await GET(req())), 'bos_ai_spend');
    expect(spend.matchedRuleId).toBe('spend.doubled24h');
  });

  it('week exactly 1.5× previous at the floor ($7.50 vs $5) → amber week50', async () => {
    spendRows([row(END - 3 * D, 7.5), row(END - 10 * D, 5)]);
    const spend = tile(await body(await GET(req())), 'bos_ai_spend');
    expect(spend.matchedRuleId).toBe('spend.week50');
  });

  it('failures: exactly 5 → red count; exactly 2 of 10 → red share; 1 of 10 → amber', async () => {
    const counts = (failed: number, completed: number) =>
      mockAuditCount.mockImplementation((_ctx: unknown, filter: { action?: string }) =>
        Promise.resolve({
          data: filter.action === 'BUSINESS_AI_ACTION_FAILED' ? failed : filter.action ? completed : 0,
          error: null,
        })
      );
    counts(5, 0);
    expect(tile(await body(await GET(req())), 'bos_ai_failures').matchedRuleId).toBe('failures.count24h');
    counts(2, 8);
    expect(tile(await body(await GET(req())), 'bos_ai_failures').matchedRuleId).toBe('failures.share24h');
    counts(1, 9);
    expect(tile(await body(await GET(req())), 'bos_ai_failures').matchedRuleId).toBe('failures.any24h');
    counts(2, 7); // 2 of 9: under the 10-action minimum → amber, not the share rule
    expect(tile(await body(await GET(req())), 'bos_ai_failures').matchedRuleId).toBe('failures.any24h');
  });

  it('critical: exactly 1 in 24 h → amber, never red', async () => {
    mockAuditCount.mockImplementation((_ctx: unknown, filter: { severity?: string }) =>
      Promise.resolve({ data: filter.severity === 'critical' ? 1 : 0, error: null })
    );
    const t = tile(await body(await GET(req())), 'critical_audit');
    expect(t.status).toBe('amber');
  });
});

describe('QA: the count fails while a ceiling-truncated read succeeds', () => {
  it('lower bounds, no "calls", no OI-P1 note, amber — never Normal', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(END - i * 60_000, 0.01)); // all inside 24 h
    mockCostPoints.mockResolvedValue({ data: { rows, reachedCeiling: true, completed: false, pages: 1 }, error: null });
    mockCount.mockResolvedValue({ data: null, error: new Error('count failed') });
    const spend = tile(await body(await GET(req())), 'bos_ai_spend');
    expect(spend.status).toBe('amber');
    for (const f of spend.figures) {
      expect(f.value).toMatch(/^at least /);
      expect(f.value).not.toMatch(/calls/);
      expect(f.note).toBeNull();
      expect(f.exact).toBe(false);
    }
    // The count failure is not surfaced as text anywhere in the response.
    expect(JSON.stringify(await body(await GET(req())))).not.toMatch(/count failed/);
  });
});

describe('QA: nothing leaks on a read error', () => {
  it('a repository error message never reaches the body or the log arguments', async () => {
    const secret = 'relation "token_usage" leaked-secret-xyz';
    mockCostPoints.mockResolvedValue({ data: null, error: new Error(secret) });
    mockAuditCount.mockRejectedValue(new Error(secret));
    mockSettingsView.mockRejectedValue(new Error(secret));
    const res = await GET(req());
    expect(res.status).toBe(200);
    const text = JSON.stringify(await body(res));
    expect(text).not.toContain('leaked-secret-xyz');
    const logged = JSON.stringify([...mockLog.info.mock.calls, ...mockLog.warn.mock.calls, ...mockLog.error.mock.calls]);
    expect(logged).not.toContain('leaked-secret-xyz');
  });
});
