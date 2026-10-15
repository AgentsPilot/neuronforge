/**
 * Money M-4 (OV-5, T1-B): the pure recorded AI cost builder. R4-1 to R4-11,
 * AC-156, AC-159, AC-160, AC-162 (the builder's half), AC-168, and TypeScript
 * ports of SQL checks 21 and 22 over the same fixture (6a retro conclusion 4),
 * so the builder and the cross-check agree on what the figures mean.
 */

import { COST_SCALE, toUnits } from '@/lib/business-os/credits/creditReport';
import { buildRecordedAiCost, type RecordedCostInput, type RecordedRowInput } from '../recordedCost';

const rows = (...costs: Array<number | string | null>): RecordedRowInput[] => costs.map((cost_usd) => ({ cost_usd }));
const units = (usd: number) => Math.round(usd * COST_SCALE);
const charged = (totalUsd: number, deletedUsd = 0, exact = true) => ({ totalUnits: units(totalUsd), deletedUnits: units(deletedUsd), exact });

function all(costs: RecordedRowInput[], completed = true): RecordedCostInput['read'] {
  return { kind: 'all_accounts', rows: costs, completed };
}
function one(costs: RecordedRowInput[], reachedCeiling = false): RecordedCostInput['read'] {
  return { kind: 'account', rows: costs, reachedCeiling };
}
const build = (input: Partial<RecordedCostInput> & Pick<RecordedCostInput, 'read'>) =>
  buildRecordedAiCost({ coverage: 'after_cutover', charged: charged(0), ...input });

// ── Checks 21 and 22, ported (§13): the SQL's own arithmetic over plain fixtures ──
interface UsageFixtureRow { user_id: string | null; feature: string; created_at: string; cost_usd: string | null }
interface LedgerFixtureRow { user_id: string | null; created_at: string; cost_usd: string }
const BOS = (feature: string) =>
  feature.startsWith('business-os') ||
  ['insight-generation', 'correlated-insight-generation', 'health-summary-generation', 'landing-page-generation', 'lead-reply'].includes(feature);
const inMonth = (iso: string, monthStart: string) => {
  const t = Date.parse(iso);
  const from = Date.parse(monthStart);
  const to = Date.UTC(new Date(from).getUTCFullYear(), new Date(from).getUTCMonth() + 1, 1);
  return t >= from && t < to;
};
/** SQL `sum(numeric)` in exact units, then `round(…, 6)`. */
const sumUnits = (values: Array<string | null>) => values.reduce((n, v) => n + (v === null ? 0 : toUnits(v, COST_SCALE)), 0);
const round6 = (u: number) => Math.round(u / 1e4) / 1e6;

function checkTwentyOne(usage: UsageFixtureRow[], ledger: LedgerFixtureRow[], monthStart: string) {
  const rec = usage.filter((r) => inMonth(r.created_at, monthStart) && BOS(r.feature));
  const chg = ledger.filter((r) => inMonth(r.created_at, monthStart));
  const recordedUnits = sumUnits(rec.map((r) => r.cost_usd));
  const chargedUnits = sumUnits(chg.filter((r) => r.user_id !== null).map((r) => r.cost_usd));
  const deletedUnits = sumUnits(chg.filter((r) => r.user_id === null).map((r) => r.cost_usd));
  return { recorded_usd: recordedUnits / COST_SCALE, charged_usd: chargedUnits / COST_SCALE, deleted_accounts_charged_usd: deletedUnits / COST_SCALE, not_charged_usd: round6(recordedUnits - chargedUnits) };
}
function checkTwentyTwo(usage: UsageFixtureRow[], ledger: LedgerFixtureRow[], monthStart: string, accountId: string) {
  return checkTwentyOne(usage.filter((r) => r.user_id === accountId), ledger.filter((r) => r.user_id === accountId), monthStart);
}

const ACC_1 = '11111111-1111-4111-8111-111111111111';
const ACC_2 = '22222222-2222-4222-8222-222222222222';
const OCT = '2026-10-01T00:00:00.000Z';
/** Shaped like §11F.1: recorded 1.942075, charged 1.612137 (plus a deleted-account charge left out). */
const USAGE: UsageFixtureRow[] = [
  { user_id: ACC_1, feature: 'business-os-chat', created_at: '2026-10-02T10:00:00Z', cost_usd: '1.2000000000' },
  { user_id: ACC_1, feature: 'lead-reply', created_at: '2026-10-03T10:00:00Z', cost_usd: '0.4411000000' },
  { user_id: ACC_2, feature: 'business-os-insights', created_at: '2026-10-04T10:00:00Z', cost_usd: '0.3000000000' },
  { user_id: ACC_2, feature: 'business-os-chat', created_at: '2026-10-05T10:00:00Z', cost_usd: '0.0000000000' },
  { user_id: ACC_2, feature: 'business-os-chat', created_at: '2026-10-06T10:00:00Z', cost_usd: '0.000975' },
  // Not Business OS, and outside the month: left out by the filter and the window.
  { user_id: ACC_1, feature: 'agent-run', created_at: '2026-10-05T10:00:00Z', cost_usd: '9.0000000000' },
  { user_id: ACC_1, feature: 'business-os-chat', created_at: '2026-11-01T00:00:00Z', cost_usd: '5.0000000000' },
];
const LEDGER: LedgerFixtureRow[] = [
  { user_id: ACC_1, created_at: '2026-10-02T10:01:00Z', cost_usd: '1.3000000000' },
  { user_id: ACC_2, created_at: '2026-10-04T10:01:00Z', cost_usd: '0.3121370000' },
  { user_id: null, created_at: '2026-10-07T10:01:00Z', cost_usd: '0.7000000000' },
];

describe('checks 21 and 22, ported: the builder gives the same figures over the same fixture (AC-154, AC-155)', () => {
  it('check 21 (all accounts): recorded 1.942075, not charged 0.329938; the deleted bucket is left out', () => {
    const sql = checkTwentyOne(USAGE, LEDGER, OCT);
    expect(sql.recorded_usd).toBe(1.942075);
    expect(sql.charged_usd).toBe(1.612137);
    expect(sql.not_charged_usd).toBe(0.329938);

    // What the route would hand the builder: the Business OS rows of the window, and Section 3's units.
    const read = all(USAGE.filter((r) => inMonth(r.created_at, OCT) && BOS(r.feature)));
    const total = sumUnits(LEDGER.map((r) => r.cost_usd));
    const deleted = sumUnits(LEDGER.filter((r) => r.user_id === null).map((r) => r.cost_usd));
    const { recorded } = build({ read, charged: { totalUnits: total, deletedUnits: deleted, exact: true } });
    expect(recorded.recordedUsd).toBe(sql.recorded_usd);
    expect(recorded.aboveCharged).toEqual({ state: 'figure', usd: sql.not_charged_usd });
    expect(recorded.status).toBe('ok');
  });

  it('check 22 (one account): the same rule for ACC_1 alone, with no deleted bucket', () => {
    const sql = checkTwentyTwo(USAGE, LEDGER, OCT, ACC_1);
    expect(sql.recorded_usd).toBe(1.6411);
    expect(sql.not_charged_usd).toBe(0.3411);
    const read = one(USAGE.filter((r) => r.user_id === ACC_1 && inMonth(r.created_at, OCT) && BOS(r.feature)));
    const { recorded } = build({ read, charged: { totalUnits: sumUnits(['1.3000000000']), deletedUnits: 0, exact: true } });
    expect(recorded.recordedUsd).toBe(sql.recorded_usd);
    expect(recorded.aboveCharged).toEqual({ state: 'figure', usd: sql.not_charged_usd });
  });
});

describe('AC-156: the difference', () => {
  it('recorded 1.94 and charged 1.61 → 0.33', () => {
    const { recorded } = build({ read: all(rows('1.94')), charged: charged(1.61) });
    expect(recorded).toEqual({ status: 'ok', recordedUsd: 1.94, recordedExact: true, aboveCharged: { state: 'figure', usd: 0.33 }, chargedAboveUsd: null });
  });

  it('equal → "None", and no charged-above figure', () => {
    const { recorded } = build({ read: all(rows('1.61')), charged: charged(1.61) });
    expect(recorded.aboveCharged).toEqual({ state: 'none', usd: null });
    expect(recorded.chargedAboveUsd).toBeNull();
    expect(recorded.status).toBe('ok');
  });

  it('R4-6: charged above recorded → "None" with how far above; a negative "above" is never produced', () => {
    const { recorded } = build({ read: all(rows('1.00')), charged: charged(1.25) });
    expect(recorded.aboveCharged).toEqual({ state: 'none', usd: null });
    expect(recorded.chargedAboveUsd).toBe(0.25);
  });

  it('R4-4: with all accounts the deleted bucket is left out of the charged side', () => {
    // Charged total 2.00 of which 0.70 is deleted accounts: like for like is 1.30.
    const { recorded } = build({ read: all(rows('1.50')), charged: charged(2, 0.7) });
    expect(recorded.aboveCharged).toEqual({ state: 'figure', usd: 0.2 });
  });

  it('R4-8: exact at COST_SCALE: 0.1 + 0.2 prints 0.3, not 0.30000000000000004', () => {
    const { recorded } = build({ read: all(rows(0.1, 0.2)), charged: charged(0) });
    expect(recorded.recordedUsd).toBe(0.3);
    expect(recorded.aboveCharged.usd).toBe(0.3);
  });

  it('R4-8: USD 0 is a real 0, not unreadable; numeric strings are read', () => {
    const { recorded, counts } = build({ read: all(rows(0, '0', '0.0000000000', '1.5')), charged: charged(1.5) });
    expect(counts.unreadable).toBe(0);
    expect(recorded.recordedExact).toBe(true);
    expect(recorded.aboveCharged.state).toBe('none');
  });
});

describe('AC-159 / R4-5: before the cut-over', () => {
  it.each(['starts_before_cutover', 'entirely_before_cutover'] as const)('%s → "Not available", the recorded figure still shown', (coverage) => {
    const { recorded } = build({ read: all(rows('2.5')), coverage, charged: charged(0) });
    expect(recorded.aboveCharged).toEqual({ state: 'not_available', usd: null });
    expect(recorded.recordedUsd).toBe(2.5);
    expect(recorded.status).toBe('ok');
  });

  it('rule order (SA-W101): before the cut-over wins over an inexact side', () => {
    const { recorded } = build({ read: all(rows('2.5'), false), coverage: 'starts_before_cutover', charged: null });
    expect(recorded.aboveCharged.state).toBe('not_available');
    expect(recorded.recordedExact).toBe(false);
    expect(recorded.status).toBe('partial');
  });
});

describe('AC-160 / AC-168 / R4-9: "At least" and Unknown', () => {
  it('AC-168: all accounts, completed false with FEWER rows than the ceiling → "At least" and Unknown (E-53, F-1)', () => {
    const { recorded, counts } = build({ read: all(rows('1', '2'), false), charged: charged(1) });
    expect(recorded).toMatchObject({ status: 'partial', recordedUsd: 3, recordedExact: false, aboveCharged: { state: 'unknown', usd: null } });
    expect(counts).toEqual({ rows: 2, completed: false, reachedCeiling: null, unreadable: 0 });
  });

  it('AC-168: the same rows with completed true → the figure', () => {
    const { recorded } = build({ read: all(rows('1', '2'), true), charged: charged(1) });
    expect(recorded).toMatchObject({ status: 'ok', recordedExact: true, aboveCharged: { state: 'figure', usd: 2 } });
  });

  it('AC-168: one account with reachedCeiling true → "At least" and Unknown; false → exact', () => {
    const capped = build({ read: one(rows('1'), true), charged: charged(0.5) });
    expect(capped.recorded).toMatchObject({ status: 'partial', recordedExact: false, aboveCharged: { state: 'unknown' } });
    expect(capped.counts).toEqual({ rows: 1, completed: null, reachedCeiling: true, unreadable: 0 });
    const full = build({ read: one(rows('1'), false), charged: charged(0.5) });
    expect(full.recorded).toMatchObject({ status: 'ok', recordedExact: true, aboveCharged: { state: 'figure', usd: 0.5 } });
  });

  it.each([null, 'abc', '', 'NaN', Number.POSITIVE_INFINITY])('AC-160: an unreadable cost (%p) counts as 0, is counted, and makes it "At least" and Unknown', (bad) => {
    const { recorded, counts } = build({ read: all(rows('1.25', bad as number | string | null)), charged: charged(1) });
    expect(counts.unreadable).toBe(1);
    expect(recorded).toMatchObject({ status: 'partial', recordedUsd: 1.25, recordedExact: false, aboveCharged: { state: 'unknown', usd: null } });
  });

  it('the ledger side not exact → the difference Unknown, the recorded figure exact', () => {
    const { recorded } = build({ read: all(rows('2')), charged: charged(1, 0, false) });
    expect(recorded).toMatchObject({ status: 'partial', recordedUsd: 2, recordedExact: true, aboveCharged: { state: 'unknown' } });
  });

  it('the ledger read failed (charged null) → the difference Unknown', () => {
    const { recorded } = build({ read: all(rows('2')), charged: null });
    expect(recorded.aboveCharged).toEqual({ state: 'unknown', usd: null });
    expect(recorded.recordedUsd).toBe(2);
  });

  it('AC-161: a failed or timed-out read → both Unknown, never 0', () => {
    const { recorded, counts } = build({ read: { kind: 'failed' }, charged: charged(1) });
    expect(recorded).toEqual({ status: 'unknown', recordedUsd: null, recordedExact: false, aboveCharged: { state: 'unknown', usd: null }, chargedAboveUsd: null });
    expect(counts).toEqual({ rows: null, completed: null, reachedCeiling: null, unreadable: 0 });
  });

  it('a sum past the safe-integer range → Unknown, never a rounded figure', () => {
    const { recorded } = build({ read: all(rows('600000', '600000')), charged: charged(0) });
    expect(recorded.status).toBe('unknown');
    expect(recorded.recordedUsd).toBeNull();
  });
});

describe('AC-162: the window edge (the builder half)', () => {
  it('only the rows it is handed count: a row at `end` that an end-exclusive read leaves out adds nothing', () => {
    const end = '2026-10-15T00:00:00.000Z';
    const inclusiveEnd = new Date(Date.parse(end) - 1).toISOString();
    const fixture = [
      { created_at: '2026-10-14T23:59:59.999Z', cost_usd: '1' },
      { created_at: end, cost_usd: '100' },
    ];
    // What a reader honouring `lte(inclusiveEnd)` returns.
    const read = fixture.filter((r) => r.created_at <= inclusiveEnd);
    const { recorded } = build({ read: all(read), charged: charged(0) });
    expect(recorded.recordedUsd).toBe(1);
  });
});

describe('R4-11: never added', () => {
  it('no field of the result is recorded plus charged', () => {
    const { recorded } = build({ read: all(rows('1.94')), charged: charged(1.61) });
    expect(Object.keys(recorded).sort()).toEqual(['aboveCharged', 'chargedAboveUsd', 'recordedExact', 'recordedUsd', 'status']);
    const numbers = JSON.stringify(recorded).match(/-?\d+(\.\d+)?/g) ?? [];
    expect(numbers).not.toContain('3.55');
  });
});
