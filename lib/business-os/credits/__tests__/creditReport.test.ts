/**
 * The operator cost report builder (credit deduction slice 4a, workplan §4.1 to
 * §4.4 and §10.1).
 *
 * The fixture: two accounts, three periods, all three triggers, a failed
 * action, one fallback-priced charge and its reconciliation, a correction of an
 * AI charge that sits in a period NOT read (fetched by id), a correction whose
 * charge cannot be found, and a charge of a fixture service `sms_fixture`.
 */

import { buildCreditReport, CREDIT_REPORT_LIMITS, windowInstants, type CreditReportDeps } from '../creditReport';
import type { CreditLedgerRow, CreditTotalsRow } from '@/lib/repositories/BusinessOsCreditLedgerReadRepository';
import type { CreditBreakdownLine, CreditBreakdowns } from '../creditReportTypes';

/** The four breakdowns as a list (Object.values on an interface is untyped). */
const allBreakdowns = (b: CreditBreakdowns | null): CreditBreakdownLine[][] =>
  b ? [b.byActionType, b.byArea, b.byService, b.byTrigger] : [];

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const A_SEP = '2026-09-05T00:00:00+00:00';
const A_AUG = '2026-08-05T00:00:00+00:00';
const B_SEP = '2026-09-01T00:00:00+00:00';

const id = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
const OUTSIDE_ORIGINAL = id(900); // a charge in A's July period, not read with the rows
const LOST_ORIGINAL = id(999); // nowhere

let seq = 0;
function charge(
  user: string,
  period: string,
  credits: number,
  extra: Partial<CreditLedgerRow> = {}
): CreditLedgerRow {
  seq += 1;
  return {
    id: `row-${seq}`,
    kind: 'charge',
    action_id: id(seq),
    adjusts_action_id: null,
    reason_code: null,
    user_id: user,
    period_start: period,
    group_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    credits: credits.toFixed(6),
    cost_usd: (credits * 0.001).toFixed(10),
    credit_value_version: 0,
    is_fallback_priced: false,
    service: 'ai',
    action_type: 'chat_turn',
    triggered_by: 'owner',
    outcome: 'succeeded',
    created_at: `2026-09-${String(10 + (seq % 15)).padStart(2, '0')}T10:00:00+00:00`,
    ...extra,
  };
}

function adjustment(user: string, period: string, credits: number, adjusts: string, reason = 'fallback_price_reconciled'): CreditLedgerRow {
  seq += 1;
  return {
    id: `row-${seq}`,
    kind: 'adjustment',
    action_id: null,
    adjusts_action_id: adjusts,
    reason_code: reason,
    user_id: user,
    period_start: period,
    group_id: null,
    credits: credits.toFixed(6),
    cost_usd: (credits * 0.001).toFixed(10),
    credit_value_version: 0,
    is_fallback_priced: false,
    service: null,
    action_type: null,
    triggered_by: null,
    outcome: null,
    created_at: '2026-09-20T10:00:00+00:00',
  };
}

function totalsRow(user: string, period: string, f: {
  total: number; owner?: number; scheduled?: number; external?: number; adjustment?: number; cost: number; charges: number; fallback?: number;
}): CreditTotalsRow {
  return {
    user_id: user,
    period_start: period,
    credits_total: f.total.toFixed(6),
    credits_owner: (f.owner ?? 0).toFixed(6),
    credits_scheduled: (f.scheduled ?? 0).toFixed(6),
    credits_external: (f.external ?? 0).toFixed(6),
    credits_adjustment: (f.adjustment ?? 0).toFixed(6),
    cost_usd_total: f.cost.toFixed(10),
    charge_count: f.charges,
    fallback_priced_count: f.fallback ?? 0,
    updated_at: '2026-09-20T10:00:00+00:00',
  };
}

function fixture() {
  seq = 0;
  const c1 = charge(A, A_SEP, 2); // chat, owner
  const c2 = charge(A, A_SEP, 1, { action_type: 'insight_run', triggered_by: 'scheduled', outcome: 'failed' });
  const c3 = charge(A, A_SEP, 0.5, {
    action_type: 'lead_reply_recommendation',
    triggered_by: 'external',
    is_fallback_priced: true,
    created_at: '2026-09-18T08:00:00+00:00',
  });
  const c4 = charge(A, A_SEP, 1, { service: 'sms_fixture', action_type: 'reminder_sms' });
  const adj1 = adjustment(A, A_SEP, -0.2, c3.action_id as string); // reconciles the fallback charge
  const adj2 = adjustment(A, A_SEP, -0.3, OUTSIDE_ORIGINAL, 'fixture_correction');
  const c5 = charge(A, A_AUG, 1);
  const c6 = charge(B, B_SEP, 3);
  const adj3 = adjustment(B, B_SEP, -0.1, LOST_ORIGINAL, 'fixture_correction');

  const outsideOriginal = charge(A, '2026-07-05T00:00:00+00:00', 0.3, {
    action_id: OUTSIDE_ORIGINAL,
    action_type: 'website_full_site',
  });

  const rows = [c1, c2, c3, c4, adj1, adj2, c5, c6, adj3];
  const totals = [
    // A September: charges 2 + 1 + 0.5 + 1; corrections -0.2 - 0.3.
    totalsRow(A, A_SEP, { total: 4, owner: 3, scheduled: 1, external: 0.5, adjustment: -0.5, cost: 0.004, charges: 4, fallback: 1 }),
    totalsRow(A, A_AUG, { total: 1, owner: 1, cost: 0.001, charges: 1 }),
    totalsRow(B, B_SEP, { total: 2.9, owner: 3, adjustment: -0.1, cost: 0.0029, charges: 1 }),
  ];
  return { rows, totals, outsideOriginal, c3 };
}

// ---- A ledger mock that honours the range the way Postgres does (CR-B1) ----
//
// `period_start` is a microsecond `timestamptz`; a JS Date is milliseconds. A
// mock that ignored the range, or compared at millisecond precision, could not
// see a bound that silently drops the newest period's rows. So the mock parses
// every `period_start` to MICROSECONDS and applies the repository's contract:
// `from <= period_start < to` (half-open).

const MICROS_PER_MS = BigInt(1000);

/** Microseconds since the epoch of a PostgREST timestamptz string. */
function micros(ts: string): bigint {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(ts);
  if (!m) throw new Error(`fixture timestamp not understood: ${ts}`);
  const wholeSecondMs = Date.parse(`${m[1]}${m[3]}`);
  return BigInt(wholeSecondMs) * MICROS_PER_MS + BigInt((m[2] ?? '').padEnd(6, '0'));
}

const dateMicros = (d: Date) => BigInt(d.getTime()) * MICROS_PER_MS;

function inRange(periodStart: string, range: { from: Date; to: Date }): boolean {
  const v = micros(periodStart);
  return v >= dateMicros(range.from) && v < dateMicros(range.to);
}

function depsFor(
  f: ReturnType<typeof fixture>,
  overrides: Partial<Record<keyof NonNullable<CreditReportDeps['ledger']>, jest.Mock>> & { findNames?: jest.Mock } = {}
) {
  const ledger = {
    listTotalsForPeriodsInRange:
      overrides.listTotalsForPeriodsInRange ??
      jest.fn().mockImplementation(async (range: { from: Date; to: Date }) => ({
        data: { rows: f.totals.filter((t) => inRange(t.period_start, range)), reachedCeiling: false },
        error: null,
      })),
    listTotalsForAccountInRange:
      overrides.listTotalsForAccountInRange ??
      jest.fn().mockImplementation(async (userId: string, range: { from: Date; to: Date }) => ({
        data: {
          rows: f.totals.filter((t) => t.user_id === userId && inRange(t.period_start, range)),
          reachedCeiling: false,
        },
        error: null,
      })),
    listRowsForAccountPeriods:
      overrides.listRowsForAccountPeriods ??
      jest.fn().mockImplementation(async (userIds: readonly string[], range: { from: Date; to: Date }) => ({
        data: {
          rows: f.rows.filter(
            (r) => r.user_id !== null && userIds.includes(r.user_id) && inRange(r.period_start, range)
          ),
          reachedCeiling: false,
        },
        error: null,
      })),
    findChargesByActionIds:
      overrides.findChargesByActionIds ??
      jest.fn().mockImplementation(async (ids: string[]) => ({
        data: ids.includes(OUTSIDE_ORIGINAL) ? [f.outsideOriginal] : [],
        error: null,
      })),
  };
  const findNames =
    overrides.findNames ??
    jest.fn().mockResolvedValue({
      data: [
        { user_id: A, company_name: 'Alpha Studio' },
        { user_id: B, company_name: 'Beta Bakery' },
      ],
      error: null,
    });
  return { ledger, findNames, now: () => new Date('2026-09-29T12:00:00.000Z') };
}

const log = { error: jest.fn(), warn: jest.fn() };
const WINDOW = { from: '2026-09-01', to: '2026-09-30' };
const byKey = <T extends { key: string | null; unresolved: boolean }>(lines: T[]) =>
  Object.fromEntries(lines.map((l) => [l.unresolved ? '(unresolved)' : l.key ?? '(none)', l]));

beforeEach(() => jest.clearAllMocks());

describe('windowInstants', () => {
  it('turns inclusive UTC dates into [start, end)', () => {
    const { start, end } = windowInstants(WINDOW);
    expect(start.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });
});

describe('happy path: the fixture ledger', () => {
  it('reads totals AND rows of periods that started up to 31 days before the window, with one half-open day window', async () => {
    const f = fixture();
    const deps = depsFor(f);
    await buildCreditReport({ window: WINDOW, accountId: null }, log, deps);

    const [range, paging] = deps.ledger.listTotalsForPeriodsInRange.mock.calls[0];
    expect(range.from.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    // Exclusive: the day after the window's last day (CR-B1), not "minus 1 ms".
    expect(range.to.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(paging).toEqual({ pageSize: 1000, ceiling: CREDIT_REPORT_LIMITS.TOTALS_CEILING });
    expect(deps.ledger.listTotalsForAccountInRange).not.toHaveBeenCalled();

    const [ids, rowsRange] = deps.ledger.listRowsForAccountPeriods.mock.calls[0];
    expect([...ids].sort()).toEqual([A, B]);
    // The SAME window as the totals, never one rebuilt from the periods read.
    expect(rowsRange.from.toISOString()).toBe(range.from.toISOString());
    expect(rowsRange.to.toISOString()).toBe(range.to.toISOString());
    // Only the one original outside the rows read is fetched, plus the lost one.
    expect(deps.ledger.findChargesByActionIds).toHaveBeenCalledTimes(1);
    expect([...deps.ledger.findChargesByActionIds.mock.calls[0][0]].sort()).toEqual([OUTSIDE_ORIGINAL, LOST_ORIGINAL].sort());
    expect(deps.findNames).toHaveBeenCalledWith(expect.arrayContaining([A, B]));
  });

  it('every period equals its totals row, compared by the totals row\'s own rules (AC-23, S-7)', async () => {
    const f = fixture();
    const report = await buildCreditReport({ window: WINDOW, accountId: null }, log, depsFor(f));

    expect(report.sections).toEqual({ totals: 'ok', rows: 'ok', names: 'ok', originals: 'ok' });
    expect(report.incomplete).toBe(false);
    expect(report.periods).toHaveLength(3);
    expect(report.periods.every((p) => p.matches === true)).toBe(true);
    expect(report.mismatchedPeriods).toBe(0);

    const aSep = report.periods.find((p) => p.accountId === A && p.periodStart === A_SEP)!;
    expect(aSep.companyName).toBe('Alpha Studio');
    // The period with corrections passes: they sit in their own bucket, and
    // owner / scheduled / external are the charges' own triggers.
    expect(aSep.fromRows).toEqual({
      creditsTotal: 4,
      creditsOwner: 3,
      creditsScheduled: 1,
      creditsExternal: 0.5,
      creditsAdjustment: -0.5,
      costUsd: 0.004,
      charges: 4,
      fallbackPriced: 1,
    });
    expect(report.grandTotal.stored.creditsTotal).toBeCloseTo(7.9, 9);
    expect(report.grandTotal.fromRows).toEqual(report.grandTotal.stored);
  });

  it('every breakdown sums to the grand total', async () => {
    const report = await buildCreditReport({ window: WINDOW, accountId: null }, log, depsFor(fixture()));
    const total = report.grandTotal.stored;
    for (const lines of allBreakdowns(report.breakdowns)) {
      const credits = lines.reduce((s, l) => s + l.credits, 0);
      const cost = lines.reduce((s, l) => s + l.costUsd, 0);
      const charges = lines.reduce((s, l) => s + l.charges, 0);
      expect(credits).toBeCloseTo(total.creditsTotal, 9);
      expect(cost).toBeCloseTo(total.costUsd, 12);
      expect(charges).toBe(total.charges);
    }
  });

  it('a correction is counted under its charge\'s service, action type, area and trigger (N-10, net)', async () => {
    const report = await buildCreditReport({ window: WINDOW, accountId: null }, log, depsFor(fixture()));
    const byType = byKey(report.breakdowns!.byActionType);
    const byService = byKey(report.breakdowns!.byService);
    const byArea = byKey(report.breakdowns!.byArea);
    const byTrigger = byKey(report.breakdowns!.byTrigger);

    // The reconciliation of the fallback charge sits under its charge.
    expect(byType.lead_reply_recommendation).toMatchObject({ charges: 1, corrections: 1 });
    expect(byType.lead_reply_recommendation.credits).toBeCloseTo(0.3, 9);
    expect(byType.lead_reply_recommendation.correctionCredits).toBeCloseTo(-0.2, 9);
    expect(byTrigger.external.credits).toBeCloseTo(0.3, 9);
    expect(byArea.leads.credits).toBeCloseTo(0.3, 9);

    // The correction whose charge sits in another period was resolved by id.
    expect(byType.website_full_site).toMatchObject({ charges: 0, corrections: 1 });
    expect(byType.website_full_site.credits).toBeCloseTo(-0.3, 9);
    expect(byArea.website.credits).toBeCloseTo(-0.3, 9);
    expect(byTrigger.owner.credits).toBeCloseTo(2 + 1 + 1 + 3 - 0.3, 9);

    // ai: every AI charge plus its corrections; the fixture service is its own bucket.
    expect(byService.ai.credits).toBeCloseTo(2 + 1 + 0.5 - 0.2 - 0.3 + 1 + 3, 9);
    expect(byService.sms_fixture).toMatchObject({ charges: 1, credits: 1 });
    // …with area "not declared" (null key, not unresolved).
    expect(byArea['(none)']).toMatchObject({ unresolved: false, credits: 1 });

    expect(byType.insight_run).toMatchObject({ charges: 1, failedCharges: 1 });
  });

  it('a correction whose charge cannot be found is counted in the unresolved bucket, never dropped', async () => {
    const report = await buildCreditReport({ window: WINDOW, accountId: null }, log, depsFor(fixture()));
    expect(report.unresolvedCorrections.count).toBe(1);
    expect(report.unresolvedCorrections.credits).toBeCloseTo(-0.1, 9);
    for (const lines of allBreakdowns(report.breakdowns)) {
      const unresolved = lines.filter((l) => l.unresolved);
      expect(unresolved).toHaveLength(1);
      expect(unresolved[0].credits).toBeCloseTo(-0.1, 9);
      // Listed last.
      expect(lines[lines.length - 1].unresolved).toBe(true);
    }
  });

  it('lists fallback-priced charges newest first, with whether each is reconciled (FR-12c)', async () => {
    const f = fixture();
    const report = await buildCreditReport({ window: WINDOW, accountId: null }, log, depsFor(f));
    expect(report.fallback.count).toBe(1);
    expect(report.fallback.reconciled).toBe(1);
    expect(report.fallback.items).toEqual([
      {
        accountId: A,
        companyName: 'Alpha Studio',
        createdAt: '2026-09-18T08:00:00+00:00',
        actionType: 'lead_reply_recommendation',
        groupId: f.c3.group_id,
        actionId: f.c3.action_id,
        credits: 0.5,
        costUsd: 0.0005,
        reconciled: true,
      },
    ]);
  });

  it('spreads: succeeded non-fallback charges only, failed count beside, "few examples" below 10 (S-6)', async () => {
    const report = await buildCreditReport({ window: WINDOW, accountId: null }, log, depsFor(fixture()));
    const chat = report.spreads.find((s) => s.actionType === 'chat_turn')!;
    expect(chat).toMatchObject({ service: 'ai', area: 'chat', examples: 3, failed: 0, fewExamples: true });
    expect(chat.credits.p50).toBe(2);
    expect(chat.credits.p90).toBeCloseTo(2.8, 9);
    expect(chat.costUsd.p50).toBeCloseTo(0.002, 12);

    const insight = report.spreads.find((s) => s.actionType === 'insight_run')!;
    expect(insight).toMatchObject({ examples: 0, failed: 1 });
    expect(insight.costUsd).toEqual({ p50: null, p90: null });

    const lead = report.spreads.find((s) => s.actionType === 'lead_reply_recommendation')!;
    expect(lead).toMatchObject({ examples: 0, fallbackExcluded: 1 });

    // Corrections are never examples.
    expect(report.spreads.find((s) => s.actionType === 'website_full_site')).toBeUndefined();
  });

  it('returns every account in the window with its name, for the account filter', async () => {
    const report = await buildCreditReport({ window: WINDOW, accountId: null }, log, depsFor(fixture()));
    expect(report.accounts).toEqual([
      { accountId: A, companyName: 'Alpha Studio' },
      { accountId: B, companyName: 'Beta Bakery' },
    ]);
    expect(report.accountFilter).toBeNull();
  });

  it('narrowed to one account, reads only that account\'s totals', async () => {
    const f = fixture();
    const deps = depsFor(f);
    const report = await buildCreditReport({ window: WINDOW, accountId: B }, log, deps);
    expect(deps.ledger.listTotalsForPeriodsInRange).not.toHaveBeenCalled();
    expect(deps.ledger.listTotalsForAccountInRange.mock.calls[0][0]).toBe(B);
    expect(deps.ledger.listRowsForAccountPeriods.mock.calls[0][0]).toEqual([B]);
    expect(report.accountFilter).toBe(B);
    expect(report.periods.map((p) => p.accountId)).toEqual([B]);
    // Rows of other accounts, had the read returned any, are not counted.
    expect(report.grandTotal.fromRows!.creditsTotal).toBeCloseTo(2.9, 9);
  });
});

describe('failure paths', () => {
  it('a totals row that disagrees with its rows is flagged, and both figures are shown', async () => {
    const f = fixture();
    f.totals[0] = totalsRow(A, A_SEP, { total: 4.5, owner: 3.5, scheduled: 1, external: 0.5, adjustment: -0.5, cost: 0.0045, charges: 5, fallback: 1 });
    const report = await buildCreditReport({ window: WINDOW, accountId: null }, log, depsFor(f));
    const aSep = report.periods.find((p) => p.periodStart === A_SEP)!;
    expect(aSep.matches).toBe(false);
    expect(aSep.stored!.creditsTotal).toBe(4.5);
    expect(aSep.fromRows!.creditsTotal).toBe(4);
    expect(report.mismatchedPeriods).toBe(1);
  });

  it('rows that hit the ceiling make the report incomplete, and the check is "not checked", not "equal"', async () => {
    const f = fixture();
    const deps = depsFor(f, {
      listRowsForAccountPeriods: jest.fn().mockResolvedValue({ data: { rows: f.rows, reachedCeiling: true }, error: null }),
    });
    const report = await buildCreditReport({ window: WINDOW, accountId: null }, log, deps);
    expect(report.incomplete).toBe(true);
    expect(report.incompleteReasons).toEqual(['rows_ceiling']);
    expect(report.periods.every((p) => p.matches === null)).toBe(true);
  });

  it('totals that hit the ceiling make the report incomplete', async () => {
    const f = fixture();
    const deps = depsFor(f, {
      listTotalsForPeriodsInRange: jest.fn().mockResolvedValue({ data: { rows: f.totals, reachedCeiling: true }, error: null }),
    });
    const report = await buildCreditReport({ window: WINDOW, accountId: null }, log, deps);
    expect(report.incompleteReasons).toContain('totals_ceiling');
  });

  it('a failed rows read fails its sections only: the periods are still shown from the totals', async () => {
    const f = fixture();
    const deps = depsFor(f, {
      listRowsForAccountPeriods: jest.fn().mockResolvedValue({ data: null, error: new Error('rows down') }),
    });
    const report = await buildCreditReport({ window: WINDOW, accountId: null }, log, deps);
    expect(report.sections).toMatchObject({ totals: 'ok', rows: 'failed', names: 'ok', originals: 'skipped' });
    expect(report.periods).toHaveLength(3);
    expect(report.periods.every((p) => p.fromRows === null && p.matches === null)).toBe(true);
    expect(report.breakdowns).toBeNull();
    expect(report.grandTotal.fromRows).toBeNull();
    expect(report.grandTotal.stored.creditsTotal).toBeCloseTo(7.9, 9);
    expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ read: 'credit ledger rows' }), expect.any(String));
  });

  it('a rejected rows read is handled the same way', async () => {
    const f = fixture();
    const deps = depsFor(f, { listRowsForAccountPeriods: jest.fn().mockRejectedValue(new Error('threw')) });
    const report = await buildCreditReport({ window: WINDOW, accountId: null }, log, deps);
    expect(report.sections.rows).toBe('failed');
  });

  it('a failed name lookup leaves the figures intact, without names', async () => {
    const deps = depsFor(fixture(), { findNames: jest.fn().mockResolvedValue({ data: null, error: new Error('x') }) });
    const report = await buildCreditReport({ window: WINDOW, accountId: null }, log, deps);
    expect(report.sections.names).toBe('failed');
    expect(report.periods.every((p) => p.companyName === null)).toBe(true);
    expect(report.periods.every((p) => p.matches === true)).toBe(true);
  });

  it('a failed originals read leaves those corrections unresolved and says so', async () => {
    const deps = depsFor(fixture(), {
      findChargesByActionIds: jest.fn().mockResolvedValue({ data: null, error: new Error('x') }),
    });
    const report = await buildCreditReport({ window: WINDOW, accountId: null }, log, deps);
    expect(report.sections.originals).toBe('failed');
    expect(report.unresolvedCorrections.count).toBe(2);
    // The period check does not depend on resolving corrections.
    expect(report.periods.every((p) => p.matches === true)).toBe(true);
  });

  it('a failed totals read fails the report without reading anything else', async () => {
    const f = fixture();
    const deps = depsFor(f, {
      listTotalsForPeriodsInRange: jest.fn().mockResolvedValue({ data: null, error: new Error('down') }),
    });
    const report = await buildCreditReport({ window: WINDOW, accountId: null }, log, deps);
    expect(report.sections).toEqual({ totals: 'failed', rows: 'skipped', names: 'skipped', originals: 'skipped' });
    expect(report.periods).toEqual([]);
    expect(deps.ledger.listRowsForAccountPeriods).not.toHaveBeenCalled();
    expect(deps.findNames).not.toHaveBeenCalled();
  });

  it('no totals rows: the empty report, with nothing else read', async () => {
    const f = fixture();
    const deps = depsFor(f, {
      listTotalsForPeriodsInRange: jest.fn().mockResolvedValue({ data: { rows: [], reachedCeiling: false }, error: null }),
    });
    const report = await buildCreditReport({ window: WINDOW, accountId: null }, log, deps);
    expect(report.periods).toEqual([]);
    expect(report.sections.totals).toBe('ok');
    expect(report.incomplete).toBe(false);
    expect(deps.ledger.listRowsForAccountPeriods).not.toHaveBeenCalled();
  });

  it('rows of a shown account whose period has no totals row are reported as a mismatch, never dropped', async () => {
    const f = fixture();
    const stray = charge(B, '2026-08-20T00:00:00+00:00', 2);
    f.rows.push(stray);
    const report = await buildCreditReport({ window: WINDOW, accountId: null }, log, depsFor(f));
    const line = report.periods.find((p) => p.periodStart === stray.period_start)!;
    expect(line).toMatchObject({ accountId: B, stored: null, matches: false });
    expect(line.fromRows!.creditsTotal).toBe(2);
    expect(report.mismatchedPeriods).toBe(1);
  });

  it('an unreadable amount is counted as 0 and reported', async () => {
    const f = fixture();
    f.totals[1] = { ...f.totals[1], credits_total: 'garbage' };
    const report = await buildCreditReport({ window: WINDOW, accountId: null }, log, depsFor(f));
    expect(report.unreadableAmounts).toBe(1);
    expect(report.periods.find((p) => p.periodStart === A_AUG)!.matches).toBe(false);
  });
});

describe('CR-B1: a microsecond period_start (the normal case for a plan account)', () => {
  // PROD shape: `period_anchor DEFAULT now()`, e.g. `2026-09-23 19:55:01.28632` UTC.
  const MICRO_SEP = '2026-09-05T10:11:12.345678+00:00';
  const MICRO_AUG = '2026-08-05T10:11:12.345678+00:00';

  function microFixture() {
    seq = 500;
    const rows = [
      charge(A, MICRO_SEP, 2),
      charge(A, MICRO_SEP, 1, { action_type: 'insight_run', triggered_by: 'scheduled' }),
      charge(A, MICRO_AUG, 1),
    ];
    const totals = [
      totalsRow(A, MICRO_SEP, { total: 3, owner: 2, scheduled: 1, cost: 0.003, charges: 2 }),
      totalsRow(A, MICRO_AUG, { total: 1, owner: 1, cost: 0.001, charges: 1 }),
    ];
    return { rows, totals, outsideOriginal: charge(A, MICRO_AUG, 0), c3: rows[0] };
  }

  it('the mock compares at microsecond precision (so a millisecond bound is caught)', () => {
    expect(inRange(MICRO_SEP, { from: new Date(0), to: new Date(Date.parse(MICRO_SEP)) })).toBe(false);
    expect(inRange(MICRO_SEP, { from: new Date(0), to: new Date(Date.parse(MICRO_SEP) + 1) })).toBe(true);
    expect(inRange(MICRO_SEP, { from: new Date(Date.parse(MICRO_SEP)), to: new Date(8.64e15) })).toBe(true);
  });

  it.each([
    ['all accounts', null],
    ['one account (its current period is the newest one read)', A],
  ])('%s: the newest period matches its rows, and its rows are in every breakdown', async (_name, accountId) => {
    const f = microFixture();
    const deps = depsFor(f);
    const report = await buildCreditReport({ window: WINDOW, accountId }, log, deps);

    // The rows read is bounded like the totals read, and its upper bound lies
    // AFTER the raw newest period_start at microsecond precision.
    const totalsRange = (
      accountId
        ? deps.ledger.listTotalsForAccountInRange.mock.calls[0][1]
        : deps.ledger.listTotalsForPeriodsInRange.mock.calls[0][0]
    ) as { from: Date; to: Date };
    const rowsRange = deps.ledger.listRowsForAccountPeriods.mock.calls[0][1] as { from: Date; to: Date };
    expect(rowsRange.from.getTime()).toBe(totalsRange.from.getTime());
    expect(rowsRange.to.getTime()).toBe(totalsRange.to.getTime());
    expect(dateMicros(rowsRange.to) > micros(MICRO_SEP)).toBe(true);

    expect(report.rowsRead).toBe(3);
    expect(report.periods).toHaveLength(2);
    expect(report.periods.every((p) => p.matches === true)).toBe(true);
    expect(report.mismatchedPeriods).toBe(0);
    const sep = report.periods.find((p) => p.periodStart === MICRO_SEP)!;
    expect(sep.fromRows).toMatchObject({ creditsTotal: 3, charges: 2 });

    const byType = byKey(report.breakdowns!.byActionType);
    expect(byType.insight_run).toMatchObject({ charges: 1, credits: 1 });
    expect(byType.chat_turn).toMatchObject({ charges: 2, credits: 3 });
    expect(report.spreads.find((s) => s.actionType === 'insight_run')).toMatchObject({ examples: 1 });
  });
});

describe('CR-S1: the totals read stopped at its ceiling', () => {
  it('a period whose totals row was not read is "not checked", not a mismatch, and is not counted', async () => {
    const f = fixture();
    // Rows of a B period whose totals row sits beyond the totals ceiling.
    const beyond = charge(B, '2026-08-20T00:00:00+00:00', 2);
    f.rows.push(beyond);
    // Exactly at the ceiling reads as "may be incomplete" (the repository's
    // `>=` rule, the same for both reads), so the builder treats it as such.
    const deps = depsFor(f, {
      listTotalsForPeriodsInRange: jest.fn().mockResolvedValue({ data: { rows: f.totals, reachedCeiling: true }, error: null }),
    });
    const report = await buildCreditReport({ window: WINDOW, accountId: null }, log, deps);

    expect(report.incompleteReasons).toEqual(['totals_ceiling']);
    const line = report.periods.find((p) => p.periodStart === beyond.period_start)!;
    expect(line).toMatchObject({ accountId: B, stored: null, matches: null });
    expect(line.fromRows!.creditsTotal).toBe(2);
    expect(report.mismatchedPeriods).toBe(0);
    // The periods whose totals rows WERE read are still checked.
    expect(report.periods.filter((p) => p.stored !== null).every((p) => p.matches === true)).toBe(true);
  });
});

describe('QA Low items (2026-09-29)', () => {
  it('an unresolved cross-account reconciliation never marks the other account\'s charge reconciled (Low 4, D-2)', async () => {
    const f = fixture();
    // B's fallback-priced charge, and a reconciliation on A that points at it.
    const bFallback = charge(B, B_SEP, 0.4, { is_fallback_priced: true, created_at: '2026-09-19T08:00:00+00:00' });
    const crossAccount = adjustment(A, A_SEP, -0.1, bFallback.action_id as string);
    f.rows.push(bFallback, crossAccount);
    // Keep the totals honest so only the flag is under test.
    f.totals[0] = totalsRow(A, A_SEP, { total: 3.9, owner: 3, scheduled: 1, external: 0.5, adjustment: -0.6, cost: 0.0039, charges: 4, fallback: 1 });
    f.totals[2] = totalsRow(B, B_SEP, { total: 3.3, owner: 3.4, adjustment: -0.1, cost: 0.0033, charges: 2, fallback: 1 });
    const report = await buildCreditReport({ window: WINDOW, accountId: null }, log, depsFor(f));

    const item = report.fallback.items.find((i) => i.actionId === bFallback.action_id)!;
    expect(item.reconciled).toBe(false);
    // A's own, resolved reconciliation still counts.
    expect(report.fallback.items.find((i) => i.actionId === f.c3.action_id)!.reconciled).toBe(true);
    expect(report.fallback.reconciled).toBe(1);
    expect(report.unresolvedCorrections.count).toBe(2); // the lost one + the cross-account one
  });

  it('a synchronous throw from the name lookup fails only the names section (edge 7)', async () => {
    const deps = depsFor(fixture(), {
      findNames: jest.fn(() => {
        throw new Error('sync throw');
      }),
    });
    const report = await buildCreditReport({ window: WINDOW, accountId: null }, log, deps);
    expect(report.sections).toEqual({ totals: 'ok', rows: 'ok', names: 'failed', originals: 'ok' });
    expect(report.periods.every((p) => p.matches === true)).toBe(true);
  });

  it('a synchronous throw from the rows read fails only the rows section', async () => {
    const deps = depsFor(fixture(), {
      listRowsForAccountPeriods: jest.fn(() => {
        throw new Error('sync throw');
      }),
    });
    const report = await buildCreditReport({ window: WINDOW, accountId: null }, log, deps);
    expect(report.sections.rows).toBe('failed');
    expect(report.periods).toHaveLength(3);
  });
});
