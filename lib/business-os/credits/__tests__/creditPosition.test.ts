/**
 * readCreditPosition — the credit position of ONE account the caller has
 * already resolved and authorised (credit deduction slice 11c, SA S11-SQ-9,
 * OP-23, W11c-2, W11c-13).
 *
 * A NEW file on purpose: the four owner suites stay unedited (G11c-2), and
 * this one proves the extraction from the outside:
 *   - the same figures as the owner card for the same deps (monthly, trial
 *     total, calendar month, corrections);
 *   - it takes the account as given (never the seam) and never throws;
 *   - the injected allowance is honoured, and "no plan row → no allowance"
 *     still wins over it;
 *   - cross-check (S11-AC-6): `used` equals the operator report's credits for
 *     the same rows and period;
 *   - source guard (W11c-2): exactly two product files name
 *     `readCreditPosition`, and exactly one names `adminCreditPositionDeps`.
 */

const mockResolveAccountId = jest.fn((id: string) => id);
jest.mock('@/lib/business-os/entitlements/account', () => ({
  resolveAccountId: (id: string) => mockResolveAccountId(id),
}));
jest.mock('@/lib/business-os/entitlements/EntitlementService', () => ({
  getEntitlementService: () => ({ getSnapshot: jest.fn() }),
}));

import * as fs from 'fs';
import * as path from 'path';
import type { CreditLedgerRow, CreditTotalsRow } from '@/lib/repositories/BusinessOsCreditLedgerReadRepository';
import type { OwnerCreditChargeRow, OwnerCreditTotalsRow } from '@/lib/repositories/BusinessOsCreditOwnerReadRepository';
import { buildCreditReport, type CreditReportDeps } from '../creditReport';
import { readCreditPosition, readOwnerCreditUsage, type OwnerCreditUsageDeps } from '../ownerCreditUsage';

const A = '11111111-1111-4111-8111-111111111111';
const ANCHOR = '2026-08-14T09:31:07.123456+00:00';
const PERIOD = '2026-09-14T09:31:07.123456+00:00';
const PREVIOUS = '2026-08-14T09:31:07.123456+00:00';
const NOW = new Date('2026-09-30T12:00:00.000Z');
const id = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;

let seq = 0;
function row(kind: 'charge' | 'adjustment', credits: number, extra: Partial<CreditLedgerRow> = {}): CreditLedgerRow {
  seq += 1;
  return {
    id: `row-${seq}`,
    kind,
    action_id: kind === 'charge' ? id(seq) : null,
    adjusts_action_id: null,
    reason_code: kind === 'adjustment' ? 'fallback_price_reconciled' : null,
    user_id: A,
    period_start: PERIOD,
    group_id: null,
    credits: credits.toFixed(6),
    cost_usd: '0.0000000000',
    credit_value_version: 0,
    is_fallback_priced: false,
    service: kind === 'charge' ? 'ai' : null,
    action_type: kind === 'charge' ? 'chat_turn' : null,
    triggered_by: kind === 'charge' ? 'owner' : null,
    outcome: kind === 'charge' ? 'succeeded' : null,
    created_at: '2026-09-20T10:00:00+00:00',
    ...extra,
  };
}

const chat = row('charge', 2.4, { triggered_by: 'owner' });
const nightly = row('charge', 1.3, { action_type: 'insight_generation', triggered_by: 'scheduled' });
const leadReply = row('charge', 0.081, { action_type: 'lead_reply_recommendation', triggered_by: 'external' });
const fixChat = row('adjustment', -0.4, { adjusts_action_id: chat.action_id });
const ROWS = [chat, nightly, leadReply, fixChat];

function totalsFor(rows: CreditLedgerRow[], periodStart = PERIOD): CreditTotalsRow {
  const sum = (pick: (r: CreditLedgerRow) => boolean) =>
    rows.filter(pick).reduce((s, r) => s + Number(r.credits), 0).toFixed(6);
  return {
    user_id: A,
    period_start: periodStart,
    credits_total: sum(() => true),
    credits_owner: sum((r) => r.kind === 'charge' && r.triggered_by === 'owner'),
    credits_scheduled: sum((r) => r.kind === 'charge' && r.triggered_by === 'scheduled'),
    credits_external: sum((r) => r.kind === 'charge' && r.triggered_by === 'external'),
    credits_adjustment: sum((r) => r.kind === 'adjustment'),
    cost_usd_total: '0',
    charge_count: rows.filter((r) => r.kind === 'charge').length,
    fallback_priced_count: 0,
    updated_at: '2026-09-20T10:00:00+00:00',
  };
}

const TOTALS = totalsFor(ROWS);
const PREVIOUS_TOTALS = totalsFor([row('charge', 5, { period_start: PREVIOUS })], PREVIOUS);

const asOwnerTotals = (t: CreditTotalsRow): OwnerCreditTotalsRow => ({
  period_start: t.period_start,
  credits_total: t.credits_total,
  credits_owner: t.credits_owner,
  credits_scheduled: t.credits_scheduled,
  credits_external: t.credits_external,
  credits_adjustment: t.credits_adjustment,
});
const asOwnerRow = (r: CreditLedgerRow): OwnerCreditChargeRow => ({
  kind: r.kind,
  action_id: r.action_id,
  adjusts_action_id: r.adjusts_action_id,
  credits: r.credits,
  triggered_by: r.triggered_by,
  period_start: r.period_start,
  user_id: r.user_id,
  service: r.service,
  action_type: r.action_type,
});

function makeLog() {
  return { warn: jest.fn(), error: jest.fn() };
}

function deps(options: {
  anchor?: string | null;
  allowance?: { amount: number; per: 'month' | 'total' } | null;
  anchorError?: boolean;
} = {}): OwnerCreditUsageDeps {
  const anchor = options.anchor === undefined ? ANCHOR : options.anchor;
  return {
    findPeriodAnchor: async () => (options.anchorError ? { data: null, error: new Error('anchor read failed') } : { data: anchor, error: null }),
    periodStartFor: async () => ({ data: PERIOD, error: null }),
    owner: {
      findTotalsForPeriod: async (_a, key) => ({ data: key === TOTALS.period_start ? asOwnerTotals(TOTALS) : null, error: null }),
      listTotalsFrom: async () => ({
        data: { rows: [asOwnerTotals(PREVIOUS_TOTALS), asOwnerTotals(TOTALS)], reachedCeiling: false },
        error: null,
      }),
      listAdjustmentsForPeriods: async () => ({
        data: { rows: ROWS.filter((r) => r.kind === 'adjustment').map(asOwnerRow), reachedCeiling: false },
        error: null,
      }),
      findChargesByActionIds: async (_a, ids) => ({
        data: ROWS.filter((r) => r.kind === 'charge' && ids.includes(r.action_id!)).map(asOwnerRow),
        error: null,
      }),
    },
    now: () => NOW,
    readAllowance: async () => (options.allowance === undefined ? { amount: 32250, per: 'month' } : options.allowance),
  };
}

beforeEach(() => jest.clearAllMocks());

describe('readCreditPosition gives the owner card\'s figures for the same deps', () => {
  it.each([
    ['monthly', deps()],
    ['trial total', deps({ allowance: { amount: 2000, per: 'total' } })],
    ['calendar month (no plan row)', deps({ anchor: null })],
    ['no allowance', deps({ allowance: null })],
  ])('%s', async (_label, d) => {
    const [position, card] = await Promise.all([readCreditPosition(A, d, makeLog()), readOwnerCreditUsage(A, d, makeLog())]);
    expect(position.error).toBeNull();
    expect(card.error).toBeNull();
    const p = position.data!;
    const c = card.data!;
    expect({ kind: p.kind, resetsOn: p.resetsOn }).toEqual(c.period);
    expect(p.allowance).toEqual(c.allowance);
    expect([p.used, p.usedByOwner, p.usedAutomatic]).toEqual([c.used, c.usedByOwner, c.usedAutomatic]);
  });

  it('the trial total sums every period from the anchor (non-vacuity: differs from the monthly figure)', async () => {
    const monthly = await readCreditPosition(A, deps(), makeLog());
    const trial = await readCreditPosition(A, deps({ allowance: { amount: 2000, per: 'total' } }), makeLog());
    expect(trial.data!.kind).toBe('trial_total');
    expect(trial.data!.key).toBe(ANCHOR);
    expect(trial.data!.used).toBeCloseTo(monthly.data!.used + 5, 6);
  });

  it('corrections are attributed under their charge\'s trigger', async () => {
    const position = await readCreditPosition(A, deps(), makeLog());
    expect(position.data!.usedByOwner).toBeCloseTo(2.4 - 0.4, 6);
    expect(position.data!.usedAutomatic).toBeCloseTo(1.3 + 0.081, 6);
  });
});

describe('the account is taken as given', () => {
  it('never calls the account seam (the caller resolved and authorised it)', async () => {
    await readCreditPosition(A, deps(), makeLog());
    expect(mockResolveAccountId).not.toHaveBeenCalled();
  });

  it('the owner wrappers still go through the seam (non-vacuity of the mock)', async () => {
    await readOwnerCreditUsage(A, deps(), makeLog());
    expect(mockResolveAccountId).toHaveBeenCalledWith(A);
  });

  it('the account reaches every read unchanged', async () => {
    const seen: string[] = [];
    const d = deps();
    const wrapped: OwnerCreditUsageDeps = {
      ...d,
      findPeriodAnchor: async (a) => (seen.push(a), d.findPeriodAnchor(a)),
      owner: {
        findTotalsForPeriod: async (a, k) => (seen.push(a), d.owner.findTotalsForPeriod(a, k)),
        listTotalsFrom: async (a, k) => (seen.push(a), d.owner.listTotalsFrom(a, k)),
        listAdjustmentsForPeriods: async (a, k) => (seen.push(a), d.owner.listAdjustmentsForPeriods(a, k)),
        findChargesByActionIds: async (a, k) => (seen.push(a), d.owner.findChargesByActionIds(a, k)),
      },
    };
    await readCreditPosition(A, wrapped, makeLog());
    expect(seen.length).toBeGreaterThanOrEqual(3);
    expect(new Set(seen)).toEqual(new Set([A]));
  });
});

describe('failure', () => {
  it('a read failure returns { error }, never throws, and logs with the message passed in', async () => {
    const log = makeLog();
    const result = await readCreditPosition(A, deps({ anchorError: true }), log, 'Admin credit position read failed');
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: A, code: 'period_read_failed' }),
      'Admin credit position read failed'
    );
  });

  it('defaults the message when none is passed', async () => {
    const log = makeLog();
    await readCreditPosition(A, deps({ anchorError: true }), log);
    expect(log.error).toHaveBeenCalledWith(expect.any(Object), 'Credit position read failed');
  });
});

describe('the allowance', () => {
  it('honours the injected readAllowance', async () => {
    const position = await readCreditPosition(A, deps({ allowance: { amount: 777, per: 'month' } }), makeLog());
    expect(position.data!.allowance).toEqual({ amount: 777, per: 'month' });
  });

  it('"no plan row → no allowance" still wins over the injected allowance', async () => {
    const position = await readCreditPosition(A, deps({ anchor: null, allowance: { amount: 777, per: 'month' } }), makeLog());
    expect(position.data!.allowance).toBeNull();
    expect(position.data!.kind).toBe('calendar_month');
  });
});

describe('cross-check with the operator report (S11-AC-6)', () => {
  it('used equals the report\'s credits for the same rows and period', async () => {
    const reportDeps: CreditReportDeps = {
      ledger: {
        listTotalsForPeriodsInRange: async () => ({ data: { rows: [TOTALS], reachedCeiling: false }, error: null }),
        listTotalsForAccountInRange: async () => ({ data: { rows: [TOTALS], reachedCeiling: false }, error: null }),
        listRowsForAccountPeriods: async () => ({ data: { rows: ROWS, reachedCeiling: false }, error: null }),
        findChargesByActionIds: async () => ({ data: [], error: null }),
      },
      findNames: async () => ({ data: [], error: null }),
      now: () => NOW,
    };
    const [report, position] = await Promise.all([
      buildCreditReport({ window: { from: '2026-09-14', to: '2026-09-30' }, accountId: A }, makeLog(), reportDeps),
      readCreditPosition(A, deps(), makeLog()),
    ]);
    const line = report.periods.find((p) => p.accountId === A && p.periodStart === PERIOD);
    expect(line).toBeDefined();
    expect(position.data!.used).toBeCloseTo(line!.stored!.creditsTotal, 6);
    expect(position.data!.used).toBeCloseTo(line!.fromRows!.creditsTotal, 6);
  });
});

describe('source guard: who may call readCreditPosition and the admin wiring (SA W11c-2)', () => {
  const ROOT = process.cwd();
  const SCANNED = ['app', 'lib', 'components', 'hooks'];
  const DEPS_FILE = 'lib/business-os/credits/adminCreditPositionDeps.ts';
  const ADMIN_ROUTE = 'app/api/admin/business-os/credits/accounts/[accountId]/route.ts';

  /** Comments stripped: prose about a function is not a call to it. */
  const codeOf = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  function productFiles(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name.startsWith('.')) continue;
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) productFiles(rel, out);
      else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) out.push(rel);
    }
    return out;
  }

  const files = SCANNED.flatMap((dir) => productFiles(dir));
  const naming = (symbol: string, sources: Array<{ file: string; code: string }>) =>
    sources.filter(({ code }) => new RegExp(`(?<![A-Za-z0-9_$])${symbol}(?![A-Za-z0-9_$])`).test(code)).map(({ file }) => file).sort();

  it('the rule sees a planted caller, and ignores one in a comment', () => {
    const planted = [
      { file: 'lib/x/sneaky.ts', code: codeOf("import { readCreditPosition } from '@/lib/business-os/credits/ownerCreditUsage';") },
      { file: 'lib/x/prose.ts', code: codeOf('// readCreditPosition is explained here\n/* adminCreditPositionDeps too */') },
      { file: 'lib/x/wiring.ts', code: codeOf("import { adminCreditPositionDeps } from '@/lib/business-os/credits/adminCreditPositionDeps';") },
    ];
    expect(naming('readCreditPosition', planted)).toEqual(['lib/x/sneaky.ts']);
    expect(naming('adminCreditPositionDeps', planted)).toEqual(['lib/x/wiring.ts']);
  });

  it('scans a non-trivial number of files', () => {
    expect(files.length).toBeGreaterThan(500);
  });

  const sources = files.map((file) => ({ file, code: codeOf(fs.readFileSync(path.join(ROOT, file), 'utf8')) }));

  it('exactly two product files name readCreditPosition: the builder and the admin route', () => {
    expect(naming('readCreditPosition', sources)).toEqual([ADMIN_ROUTE, 'lib/business-os/credits/ownerCreditUsage.ts'].sort());
  });

  it('exactly one product file uses the admin service-role wiring: the admin route', () => {
    expect(naming('adminCreditPositionDeps', sources.filter(({ file }) => file !== DEPS_FILE))).toEqual([ADMIN_ROUTE]);
  });
});
