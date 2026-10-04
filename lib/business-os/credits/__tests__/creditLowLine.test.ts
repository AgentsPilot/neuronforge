/**
 * The low-line audit record (credit deduction slice 8b; FR-49, FR-50, AC-44,
 * AC-45; SA SQ-44 to SQ-46, C-B1, Q-B1, Q-B4).
 *
 * The hook is real, and so are the band maths, the window rule and
 * `logAndFlush`. Faked: the logger, `AuditTrail` (so nothing reaches a
 * database), the entitlements service (snapshots carry the allowance a test
 * puts on them) and the reads, which are injected.
 */

import * as fs from 'fs';
import * as path from 'path';

const mockLogged: Array<{ level: string; fields: Record<string, unknown>; msg: string }> = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
      logger[level] = (first: unknown, second?: unknown) => {
        const fields = typeof first === 'object' && first !== null ? (first as Record<string, unknown>) : {};
        mockLogged.push({ level, fields, msg: typeof first === 'string' ? first : String(second ?? '') });
      };
    }
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

const mockAuditLog = jest.fn();
const mockAuditFlush = jest.fn();
jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrail: {
    log: (...args: unknown[]) => mockAuditLog(...args),
    flush: (...args: unknown[]) => mockAuditFlush(...args),
  },
}));

const mockSnapshot = jest.fn();
jest.mock('@/lib/business-os/entitlements/EntitlementService', () => ({
  getEntitlementService: () => ({ getSnapshot: (accountId: string) => mockSnapshot(accountId) }),
}));
jest.mock('@/lib/business-os/entitlements/creditAllowanceView', () => ({
  creditAllowanceForDisplay: (snapshot: { allowance?: unknown }) => snapshot.allowance ?? null,
}));

// Production wiring is never used here: every test injects its reads.
jest.mock('../creditLowLineDeps', () => ({
  creditLowLineDeps: () => {
    throw new Error('production low-line deps are not used in these tests');
  },
}));

import { __resetAuditFlushChainForTests, AUDIT_FLUSH_TIMEOUT_MS } from '@/lib/audit/boundedAuditFlush';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { ALL_ZERO_UUID } from '@/lib/platformAccount';
import { bandFor, LOW_LINE_PERCENT, type ShownPercentLeft } from '../creditBands';
import {
  checkCreditLowLine,
  CREDIT_LOW_LINE_READ_BUDGET_MS,
  crossedLowLine,
  isBelowLowLine,
  type CreditLowLineDeps,
  type CreditLowLineInput,
} from '../creditLowLine';
import type { OwnerCreditAllowance } from '../ownerCreditUsageTypes';

const ACCOUNT = '2f734ed5-3681-4049-880d-3de7b096bea3';
const ACTION = '55555555-5555-4555-8555-555555555555';
const SYS = '22222222-2222-4222-8222-222222222222';
/** A microsecond key, as PostgREST returns it. */
const PERIOD = '2026-09-23T19:55:01.28632+00:00';
const ANCHOR = '2026-08-23T19:55:01.28632+00:00';

const MONTHLY: OwnerCreditAllowance = { amount: 1000, per: 'month' };
const TRIAL: OwnerCreditAllowance = { amount: 2000, per: 'total' };

function input(overrides: Partial<CreditLowLineInput> = {}): CreditLowLineInput {
  return {
    accountId: ACCOUNT,
    credits: 20,
    periodStart: PERIOD,
    anchorSource: 'plan',
    actionId: ACTION,
    actionType: 'chat_turn',
    trigger: 'owner',
    chargeService: 'ai',
    ...overrides,
  };
}

interface Fake {
  deps: CreditLowLineDeps;
  findTotalsForPeriod: jest.Mock;
  listTotalsFrom: jest.Mock;
  findPeriodAnchor: jest.Mock;
}

/** Reads that answer with the given totals; `used` is credits_total after this charge. */
function fake(opts: { allowance?: OwnerCreditAllowance | null; used?: number | string; rows?: Array<number | string> } = {}): Fake {
  const findTotalsForPeriod = jest.fn().mockResolvedValue({
    data: opts.used === undefined ? null : { period_start: PERIOD, credits_total: opts.used },
    error: null,
  });
  const listTotalsFrom = jest.fn().mockResolvedValue({
    data: { rows: (opts.rows ?? []).map((credits_total) => ({ period_start: PERIOD, credits_total })), reachedCeiling: false },
    error: null,
  });
  const findPeriodAnchor = jest.fn().mockResolvedValue({ data: ANCHOR, error: null });
  mockSnapshot.mockResolvedValue({ allowance: opts.allowance === undefined ? MONTHLY : opts.allowance });
  return {
    deps: { findPeriodAnchor, owner: { findTotalsForPeriod, listTotalsFrom } as unknown as CreditLowLineDeps['owner'] },
    findTotalsForPeriod,
    listTotalsFrom,
    findPeriodAnchor,
  };
}

const hang = () => new Promise<never>(() => undefined);
const warns = () => mockLogged.filter((l) => l.level === 'warn' || l.level === 'error');
const entries = () => mockAuditLog.mock.calls.map((c) => c[0] as Record<string, unknown> & { details: Record<string, unknown> });

let savedSys: string | undefined;

beforeEach(() => {
  mockLogged.length = 0;
  mockAuditLog.mockReset().mockResolvedValue(undefined);
  mockAuditFlush.mockReset().mockResolvedValue(undefined);
  mockSnapshot.mockReset();
  savedSys = process.env.SYSTEM_ADMIN_USER_ID;
  process.env.SYSTEM_ADMIN_USER_ID = SYS;
  __resetAuditFlushChainForTests();
});

afterEach(() => {
  jest.useRealTimers();
  if (savedSys === undefined) delete process.env.SYSTEM_ADMIN_USER_ID;
  else process.env.SYSTEM_ADMIN_USER_ID = savedSys;
  __resetAuditFlushChainForTests();
});

describe('the crossing rule (pure)', () => {
  it('isBelowLowLine is exactly the red band, for every shown value', () => {
    const shown: ShownPercentLeft[] = [{ kind: 'less_than_one' }];
    for (let value = 0; value <= 100; value += 1) shown.push({ kind: 'percent', value });
    for (const s of shown) expect({ s, below: isBelowLowLine(s) }).toEqual({ s, below: bandFor(s) === 'below_line' });
    expect(LOW_LINE_PERCENT).toBe(10);
  });

  it.each([
    ['10% → 9%: crossed', 890, 910, true],
    ['exactly 10.000000% after: not crossed (10 is orange)', 880, 900, false],
    ['9% → 8%: already below', 910, 920, false],
    ['40% → over the allowance: crossed', 600, 1200, true],
    ['11% → less than 1%: crossed', 890, 995, true],
    ['nothing used → 50%: still above', 0, 500, false],
  ])('%s', (_name, before, after, crossed) => {
    expect(crossedLowLine(before, after, 1000).crossed).toBe(crossed);
  });

  it('records the shown figures, "less than 1%" as a string', () => {
    expect(crossedLowLine(890, 995, 1000)).toEqual({
      crossed: true,
      before: { kind: 'percent', value: 11 },
      after: { kind: 'less_than_one' },
    });
  });

  it('a negative "before" (the read did not see this charge) is an anomaly, never a crossing', () => {
    expect(crossedLowLine(-5, 15, 1000)).toEqual({ crossed: false, reason: 'anomaly' });
    expect(crossedLowLine(Number.NaN, 15, 1000)).toEqual({ crossed: false, reason: 'anomaly' });
  });

  it('no usable allowance is never a crossing', () => {
    expect(crossedLowLine(890, 910, 0)).toEqual({ crossed: false, reason: 'no_allowance' });
  });
});

describe('AC-44: one entry at the crossing charge, and only there', () => {
  it('a monthly crossing writes exactly one entry with the agreed shape (SQ-46, C-B1)', async () => {
    const f = fake({ used: 910 }); // 890 before this 20-credit charge: 11% → 9%
    await checkCreditLowLine(input(), f.deps);

    expect(entries()).toHaveLength(1);
    const entry = entries()[0];
    expect(entry).toEqual({
      action: AUDIT_EVENTS.BOS_CREDIT_LOW_LINE_CROSSED,
      entityType: 'business_os_credit_period',
      entityId: ACCOUNT,
      userId: ACCOUNT,
      actorId: SYS,
      details: {
        periodStart: PERIOD,
        periodKind: 'monthly',
        allowance: 1000,
        percentBefore: 11,
        percentAfter: 9,
        lowLine: 10,
        service: 'ai',
        actionId: ACTION,
        actionType: 'chat_turn',
        trigger: 'owner',
      },
    });
    // The registration decides the severity: the writer passes none.
    expect(entry).not.toHaveProperty('severity');
    expect(entry).not.toHaveProperty('resourceName');
    // The actor is never the account (a null actor would be stored as it).
    expect(entry.actorId).not.toBe(ACCOUNT);
    // Written out before returning, not left in the queue (KI-23).
    expect(mockAuditFlush).toHaveBeenCalledTimes(1);
  });

  it('the details carry no cost, token, dollar or used-credit key', () => {
    const banned = /cost|token|usd|dollar|^used/i;
    return checkCreditLowLine(input(), fake({ used: 910 }).deps).then(() => {
      const keys = Object.keys(entries()[0].details);
      expect(keys.filter((k) => banned.test(k))).toEqual([]);
    });
  });

  it('the Pino info line is written BEFORE the audit entry is handed to the trail', async () => {
    const order: string[] = [];
    mockAuditLog.mockImplementation(() => {
      order.push(`audit:${mockLogged.some((l) => l.fields.event === 'bos_credit_low_line_crossed')}`);
      return Promise.resolve();
    });
    await checkCreditLowLine(input(), fake({ used: 910 }).deps);
    expect(order).toEqual(['audit:true']);
    const info = mockLogged.find((l) => l.fields.event === 'bos_credit_low_line_crossed');
    expect(info).toMatchObject({ level: 'info', fields: { accountId: ACCOUNT, actionId: ACTION, percentBefore: 11, percentAfter: 9, lowLine: 10 } });
  });

  it('the next charge in the same period (already below) writes none', async () => {
    await checkCreditLowLine(input(), fake({ used: 930 }).deps); // 910 → 930: 9% → 7%
    expect(entries()).toHaveLength(0);
  });

  it('an action that starts below the line writes none', async () => {
    await checkCreditLowLine(input({ credits: 5 }), fake({ used: 960 }).deps);
    expect(entries()).toHaveLength(0);
  });

  it('one action from 40% to over the allowance writes one, at 0%', async () => {
    await checkCreditLowLine(input({ credits: 600 }), fake({ used: 1200 }).deps);
    expect(entries()).toHaveLength(1);
    expect(entries()[0].details).toMatchObject({ percentBefore: 40, percentAfter: 0 });
  });

  it('a charge ending exactly at 10.000000% left writes none (10 is orange)', async () => {
    await checkCreditLowLine(input(), fake({ used: 900 }).deps);
    expect(entries()).toHaveLength(0);
  });

  it('a crossing to "less than 1%" records it as a string', async () => {
    await checkCreditLowLine(input({ credits: 105 }), fake({ used: 995 }).deps);
    expect(entries()[0].details).toMatchObject({ percentBefore: 11, percentAfter: 'less_than_one' });
  });

  it('a new period (the first charge after a reset) writes none', async () => {
    await checkCreditLowLine(input({ credits: 1 }), fake({ used: 1 }).deps);
    expect(entries()).toHaveLength(0);
  });

  it('a trial crossing writes one, summed from the anchor over every period', async () => {
    const f = fake({ allowance: TRIAL, rows: [1000, '820.5'] }); // 1,820.5 of 2,000 after: 9%; before (−30): 10.975% → 10
    await checkCreditLowLine(input({ credits: 30 }), f.deps);
    expect(f.findPeriodAnchor).toHaveBeenCalledWith(ACCOUNT);
    expect(f.listTotalsFrom).toHaveBeenCalledWith(ACCOUNT, ANCHOR, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(f.findTotalsForPeriod).not.toHaveBeenCalled();
    expect(entries()).toHaveLength(1);
    expect(entries()[0].details).toMatchObject({ periodKind: 'trial_total', allowance: 2000, percentBefore: 10, percentAfter: 8 });
  });

  it('no allowance (or an unavailable snapshot) writes none and reads no totals', async () => {
    const f = fake({ allowance: null, used: 910 });
    await checkCreditLowLine(input(), f.deps);
    expect(f.findTotalsForPeriod).not.toHaveBeenCalled();
    expect(f.findPeriodAnchor).not.toHaveBeenCalled();
    expect(entries()).toHaveLength(0);
    expect(warns()).toEqual([]);
  });
});

describe('reads (SQ-44, Q-B1)', () => {
  it.each([
    ['calendar_month', input({ anchorSource: 'calendar_month' })],
    ['credits 0', input({ credits: 0 })],
    ['credits negative', input({ credits: -1 })],
  ])('%s → zero reads and no timer', async (_n, given) => {
    jest.useFakeTimers();
    const f = fake({ used: 910 });
    await checkCreditLowLine(given, f.deps);
    expect(mockSnapshot).not.toHaveBeenCalled();
    expect(f.findTotalsForPeriod).not.toHaveBeenCalled();
    expect(f.findPeriodAnchor).not.toHaveBeenCalled();
    expect(f.listTotalsFrom).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('monthly: ONE totals read with the charge\'s own key, verbatim; no anchor read (Q-B1)', async () => {
    const f = fake({ used: 100 });
    await checkCreditLowLine(input(), f.deps);
    expect(f.findTotalsForPeriod).toHaveBeenCalledTimes(1);
    expect(f.findTotalsForPeriod).toHaveBeenCalledWith(ACCOUNT, PERIOD, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(f.findPeriodAnchor).not.toHaveBeenCalled();
    expect(f.listTotalsFrom).not.toHaveBeenCalled();
  });

  it('never re-derives the key from "now": a clock a month later still reads the charge\'s key', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-30T00:00:00Z'), doNotFake: ['setTimeout', 'clearTimeout'] });
    const f = fake({ used: 100 });
    await checkCreditLowLine(input(), f.deps);
    expect(f.findTotalsForPeriod.mock.calls[0][1]).toBe(PERIOD);
  });

  it('the allowance goes through the account seam to getSnapshot', async () => {
    await checkCreditLowLine(input(), fake({ used: 100 }).deps);
    expect(mockSnapshot).toHaveBeenCalledWith(ACCOUNT);
  });

  it('trial with no anchor any more → no entry, no totals read', async () => {
    const f = fake({ allowance: TRIAL, rows: [1900] });
    f.findPeriodAnchor.mockResolvedValue({ data: null, error: null });
    await checkCreditLowLine(input(), f.deps);
    expect(f.listTotalsFrom).not.toHaveBeenCalled();
    expect(entries()).toHaveLength(0);
  });

  const failures: Array<[string, (f: Fake) => void, string]> = [
    ['totals read error', (f) => f.findTotalsForPeriod.mockResolvedValue({ data: null, error: Object.assign(new Error('x'), { code: '57014' }) }), 'read_failed'],
    ['no row for the charge\'s own key (Q-B4)', (f) => f.findTotalsForPeriod.mockResolvedValue({ data: null, error: null }), 'anomaly'],
    ['a total below this charge (Q-B4)', (f) => f.findTotalsForPeriod.mockResolvedValue({ data: { credits_total: 5 }, error: null }), 'anomaly'],
    ['an unparseable figure', (f) => f.findTotalsForPeriod.mockResolvedValue({ data: { credits_total: 'abc' }, error: null }), 'unreadable_figure'],
    ['a rejecting read', (f) => f.findTotalsForPeriod.mockRejectedValue(new TypeError('boom')), 'exception'],
    ['a throwing snapshot', () => mockSnapshot.mockImplementation(() => { throw new RangeError('boom'); }), 'exception'],
  ];

  it.each(failures)('%s → one warn, no entry, never a throw', async (_n, arrange, reason) => {
    const f = fake({ used: 910 });
    arrange(f);
    await expect(checkCreditLowLine(input(), f.deps)).resolves.toBeUndefined();
    expect(entries()).toHaveLength(0);
    expect(warns()).toHaveLength(1);
    expect(warns()[0].fields).toMatchObject({ event: 'bos_credit_low_line_check_failed', reason, accountId: ACCOUNT, actionId: ACTION });
  });

  it('the failure log carries a code or class name, never an error message', async () => {
    const f = fake({ used: 910 });
    f.findTotalsForPeriod.mockRejectedValue(new TypeError('secret owner text'));
    await checkCreditLowLine(input(), f.deps);
    expect(JSON.stringify(mockLogged)).not.toContain('secret owner text');
    expect(warns()[0].fields.errCode).toBe('TypeError');
  });

  it.each([
    ['trial ceiling reached', (f: Fake) => f.listTotalsFrom.mockResolvedValue({ data: { rows: [], reachedCeiling: true }, error: null }), 'ceiling'],
    ['trial anchor read error', (f: Fake) => f.findPeriodAnchor.mockResolvedValue({ data: null, error: new Error('x') }), 'read_failed'],
    ['trial unparseable row', (f: Fake) => f.listTotalsFrom.mockResolvedValue({ data: { rows: [{ credits_total: null }], reachedCeiling: false }, error: null }), 'unreadable_figure'],
  ])('%s → one warn, no entry (never a partial sum)', async (_n, arrange, reason) => {
    const f = fake({ allowance: TRIAL, rows: [1900] });
    arrange(f);
    await checkCreditLowLine(input(), f.deps);
    expect(entries()).toHaveLength(0);
    expect(warns()).toHaveLength(1);
    expect(warns()[0].fields).toMatchObject({ reason });
  });
});

describe('the read budget (NI-6 at unit level, FR-50)', () => {
  it.each([
    ['the snapshot', (f: Fake) => mockSnapshot.mockImplementation(() => hang()) && f],
    ['the totals read', (f: Fake) => f.findTotalsForPeriod.mockImplementation(() => hang())],
  ])('%s hangs → gives up at the budget, one warn, no timer left', async (_n, arrange) => {
    jest.useFakeTimers();
    const f = fake({ used: 910 });
    arrange(f);
    let done = false;
    const run = checkCreditLowLine(input(), f.deps).then(() => {
      done = true;
    });
    await jest.advanceTimersByTimeAsync(CREDIT_LOW_LINE_READ_BUDGET_MS - 1);
    expect(done).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await run;
    expect(done).toBe(true);
    expect(warns()).toHaveLength(1);
    expect(warns()[0].fields).toMatchObject({ reason: 'timeout' });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('a timed-out owner read is aborted', async () => {
    jest.useFakeTimers();
    const f = fake({ used: 910 });
    let signal: AbortSignal | undefined;
    f.findTotalsForPeriod.mockImplementation((_a: string, _p: string, o: { signal: AbortSignal }) => {
      signal = o.signal;
      return hang();
    });
    const run = checkCreditLowLine(input(), f.deps);
    await jest.advanceTimersByTimeAsync(CREDIT_LOW_LINE_READ_BUDGET_MS);
    await run;
    expect(signal?.aborted).toBe(true);
  });

  it('a read that answers AFTER the budget writes no entry', async () => {
    jest.useFakeTimers();
    const f = fake({ used: 910 });
    let answer: (v: unknown) => void = () => undefined;
    f.findTotalsForPeriod.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    const run = checkCreditLowLine(input(), f.deps);
    await jest.advanceTimersByTimeAsync(CREDIT_LOW_LINE_READ_BUDGET_MS);
    await run;
    answer({ data: { period_start: PERIOD, credits_total: 910 }, error: null }); // would have been a crossing
    await jest.advanceTimersByTimeAsync(AUDIT_FLUSH_TIMEOUT_MS * 2);
    expect(entries()).toHaveLength(0);
    expect(mockLogged.some((l) => l.fields.event === 'bos_credit_low_line_crossed')).toBe(false);
  });

  it('the budget is 500 ms (SA SQ-44)', () => {
    expect(CREDIT_LOW_LINE_READ_BUDGET_MS).toBe(500);
  });
});

describe('the audit write (SQ-46, C-B1, C-B3)', () => {
  it('a flush that hangs is bounded by logAndFlush (2 s): resolves, one warn, no timer left', async () => {
    jest.useFakeTimers();
    mockAuditFlush.mockImplementation(() => hang());
    let done = false;
    const run = checkCreditLowLine(input(), fake({ used: 910 }).deps).then(() => {
      done = true;
    });
    await jest.advanceTimersByTimeAsync(AUDIT_FLUSH_TIMEOUT_MS - 1);
    expect(done).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await run;
    expect(done).toBe(true);
    expect(warns()).toHaveLength(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('a failing audit write never throws', async () => {
    mockAuditLog.mockRejectedValue(new Error('queue full'));
    await expect(checkCreditLowLine(input(), fake({ used: 910 }).deps)).resolves.toBeUndefined();
    expect(warns().length + mockLogged.filter((l) => l.level === 'error').length).toBeGreaterThan(0);
  });

  it('a non-UUID SYSTEM_ADMIN_USER_ID gives the all-zero actor, never the account', async () => {
    process.env.SYSTEM_ADMIN_USER_ID = 'not-a-uuid';
    await checkCreditLowLine(input(), fake({ used: 910 }).deps);
    expect(entries()[0].actorId).toBe(ALL_ZERO_UUID);
  });

  it('an unset SYSTEM_ADMIN_USER_ID gives the all-zero actor', async () => {
    delete process.env.SYSTEM_ADMIN_USER_ID;
    await checkCreditLowLine(input(), fake({ used: 910 }).deps);
    expect(entries()[0].actorId).toBe(ALL_ZERO_UUID);
  });
});

describe('source guards', () => {
  const code = fs
    .readFileSync(path.join(__dirname, '..', 'creditLowLine.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('passes no severity: the registration is the only source (SQ-46)', () => {
    const SEVERITY_KEY = /\bseverity\s*:/;
    expect(SEVERITY_KEY.test("{ action, severity: 'warning' }")).toBe(true);
    expect(code).not.toMatch(SEVERITY_KEY);
  });

  it('never imports the recorder or runAiAction (no runtime cycle)', () => {
    expect(code).not.toMatch(/aiChargeRecorder|aiActionAudit/);
  });

  it('reads credit lots nowhere (BD-25: the plan allowance only)', () => {
    expect(code).not.toMatch(/credit_lot|CreditLot/);
  });

  it('builds no period key from a clock', () => {
    expect(code).not.toMatch(/new Date\(|Date\.now\(/);
  });
});
