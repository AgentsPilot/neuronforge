/**
 * The owner card and the operator report agree (credit deduction slice 6a,
 * workplan §7 "Cross-check").
 *
 * The SAME ledger rows — charges and corrections of one account in one period —
 * are fed to the operator cost report (`buildCreditReport`, the admin
 * "Costs & credits" tab) and to the owner card (`readOwnerCreditUsage`). The
 * card's used must equal the report's credits for that account and period, and
 * its split must equal the report's by-trigger breakdown. QA checks the same
 * thing by eye on a live account (AC-33); this pins it in code.
 */

jest.mock('@/lib/business-os/entitlements/EntitlementService', () => ({
  getEntitlementService: () => ({ getSnapshot: jest.fn() }),
}));

import type { CreditLedgerRow, CreditTotalsRow } from '@/lib/repositories/BusinessOsCreditLedgerReadRepository';
import type { OwnerCreditChargeRow, OwnerCreditTotalsRow } from '@/lib/repositories/BusinessOsCreditOwnerReadRepository';
import { buildCreditReport, type CreditReportDeps } from '../creditReport';
import { readOwnerCreditUsage, type OwnerCreditUsageDeps } from '../ownerCreditUsage';

const A = '11111111-1111-4111-8111-111111111111';
const PERIOD = '2026-09-14T09:31:07.123456+00:00';
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

const briefing = row('charge', 0.215, { action_type: 'briefing_narration', triggered_by: 'owner' });
const chat = row('charge', 2.4, { triggered_by: 'owner' });
const nightly = row('charge', 1.3, { action_type: 'insight_generation', triggered_by: 'scheduled' });
const leadReply = row('charge', 0.081, { action_type: 'lead_reply_recommendation', triggered_by: 'external' });
const fixChat = row('adjustment', -0.4, { adjusts_action_id: chat.action_id });
const fixNightly = row('adjustment', 0.05, { adjusts_action_id: nightly.action_id });
const ROWS = [briefing, chat, nightly, leadReply, fixChat, fixNightly];

/** The totals row the database keeps for these rows (the recorder's sums). */
function totalsFor(rows: CreditLedgerRow[]): CreditTotalsRow {
  const sum = (pick: (r: CreditLedgerRow) => boolean) =>
    rows.filter(pick).reduce((s, r) => s + Number(r.credits), 0).toFixed(6);
  return {
    user_id: A,
    period_start: PERIOD,
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

/** Owner-granted columns only, as the owner repository would return them. */
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

const log = { warn: jest.fn(), error: jest.fn() };

async function report() {
  const deps: CreditReportDeps = {
    ledger: {
      listTotalsForPeriodsInRange: async () => ({ data: { rows: [TOTALS], reachedCeiling: false }, error: null }),
      listTotalsForAccountInRange: async () => ({ data: { rows: [TOTALS], reachedCeiling: false }, error: null }),
      listRowsForAccountPeriods: async () => ({ data: { rows: ROWS, reachedCeiling: false }, error: null }),
      findChargesByActionIds: async () => ({ data: [], error: null }),
    },
    findNames: async () => ({ data: [], error: null }),
    now: () => new Date('2026-09-30T12:00:00.000Z'),
  };
  return buildCreditReport({ window: { from: '2026-09-14', to: '2026-09-30' }, accountId: A }, log, deps);
}

async function card() {
  const deps: OwnerCreditUsageDeps = {
    findPeriodAnchor: async () => ({ data: PERIOD, error: null }),
    periodStartFor: async () => ({ data: PERIOD, error: null }),
    owner: {
      findTotalsForPeriod: async (_a, key) => ({ data: key === PERIOD ? asOwnerTotals(TOTALS) : null, error: null }),
      listTotalsFrom: async () => ({ data: { rows: [asOwnerTotals(TOTALS)], reachedCeiling: false }, error: null }),
      listAdjustmentsForPeriods: async () => ({
        data: { rows: ROWS.filter((r) => r.kind === 'adjustment').map(asOwnerRow), reachedCeiling: false },
        error: null,
      }),
      findChargesByActionIds: async (_a, ids) => ({
        data: ROWS.filter((r) => r.kind === 'charge' && ids.includes(r.action_id!)).map(asOwnerRow),
        error: null,
      }),
    },
    now: () => new Date('2026-09-30T12:00:00.000Z'),
    readAllowance: async () => ({ amount: 32250, per: 'month' }),
  };
  return readOwnerCreditUsage(A, deps, log);
}

describe('owner card vs the operator report, same rows', () => {
  it('used equals the report\'s credits for the account and period (stored and recomputed)', async () => {
    const [r, c] = await Promise.all([report(), card()]);
    const line = r.periods.find((p) => p.accountId === A && p.periodStart === PERIOD);

    expect(line).toBeDefined();
    expect(line!.matches).toBe(true);
    expect(c.data!.used).toBeCloseTo(line!.stored!.creditsTotal, 6);
    expect(c.data!.used).toBeCloseTo(line!.fromRows!.creditsTotal, 6);
  });

  it('"by you" and "automatic" equal the report\'s by-trigger breakdown, corrections included', async () => {
    const [r, c] = await Promise.all([report(), card()]);
    const byTrigger = new Map((r.breakdowns?.byTrigger ?? []).map((l) => [l.key, l.credits]));

    expect(c.data!.usedByOwner).toBeCloseTo(byTrigger.get('owner') ?? 0, 6);
    expect(c.data!.usedAutomatic).toBeCloseTo((byTrigger.get('scheduled') ?? 0) + (byTrigger.get('external') ?? 0), 6);
    // Non-vacuity: corrections really moved both parts.
    expect(c.data!.usedByOwner).toBeCloseTo(0.215 + 2.4 - 0.4, 6);
    expect(c.data!.usedAutomatic).toBeCloseTo(1.3 + 0.081 + 0.05, 6);
  });
});
