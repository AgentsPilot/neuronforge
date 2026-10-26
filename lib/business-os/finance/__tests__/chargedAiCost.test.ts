/**
 * Money MK-2 (SA-1): the shared charged AI cost read and builder
 * (`chargedAiCost.ts`). The equality with Finance's Section 3 is proven in
 * `financeHealth.test.ts` ("MK-2: …"); here: the read's scope and range, the
 * cut-over clamp, exactness, the deleted bucket, the failure path, and that
 * Charge checks' This month is the same instants as Finance's.
 */

import type { CreditLedgerRow } from '@/lib/repositories/BusinessOsCreditLedgerReadRepository';
import { CHARGING_CUTOVER_FLOOR_MS } from '@/lib/business-os/credits/aiActivity';
import { windowInstants } from '@/lib/business-os/credits/creditReport';
// Money MK-3b (SA-CR-MK3B F-2, ruled): the AI cost page builds the report request (`reportSearch`).
import { AI_COST_FILTER_SPEC, reportSearch } from '@/app/admin/ai-cost/aiCostFilters';
import { buildChargedAiCostInWindow, CHARGED_LEDGER_READ, readChargedWindow } from '../chargedAiCost';
import { resolveFinanceWindow } from '../financeWindow';

const A = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-11-09T12:00:00.000Z');

let seq = 0;
function row(user_id: string | null, cost: string, extra: Partial<CreditLedgerRow> = {}): CreditLedgerRow {
  seq += 1;
  return {
    id: String(seq),
    kind: 'charge',
    action_id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(seq).padStart(12, '0')}`,
    adjusts_action_id: null,
    reason_code: null,
    user_id,
    period_start: '2026-11-01T00:00:00+00:00',
    group_id: null,
    credits: '1',
    cost_usd: cost,
    credit_value_version: 0,
    is_fallback_priced: false,
    service: 'ai',
    action_type: 'chat_turn',
    triggered_by: 'owner',
    outcome: 'succeeded',
    created_at: '2026-11-05T10:00:00+00:00',
    ...extra,
  };
}

function ledger(rows: CreditLedgerRow[], reachedCeiling = false) {
  return {
    listRowsOfAllAccountsCreatedInRange: jest.fn(() => Promise.resolve({ data: { rows, reachedCeiling }, error: null })),
    listRowsForAccountCreatedInRange: jest.fn(() => Promise.resolve({ data: { rows, reachedCeiling }, error: null })),
  };
}

const logger = () => ({ error: jest.fn() });
const window = { start: new Date('2026-11-01T00:00:00.000Z'), end: new Date('2026-11-10T00:00:00.000Z') };

describe('the read', () => {
  it('all businesses: R-a only, over [start, end), pages of 1,000', async () => {
    const l = ledger([]);
    await buildChargedAiCostInWindow({ window, accountId: null }, logger(), { ledger: l });
    expect(l.listRowsForAccountCreatedInRange).not.toHaveBeenCalled();
    expect(l.listRowsOfAllAccountsCreatedInRange).toHaveBeenCalledWith({ from: window.start, to: window.end }, CHARGED_LEDGER_READ);
    expect(CHARGED_LEDGER_READ).toEqual({ pageSize: 1000, ceiling: 20000 });
  });

  it('one business: R-a′ only, with exactly that id', async () => {
    const l = ledger([]);
    await buildChargedAiCostInWindow({ window, accountId: A }, logger(), { ledger: l });
    expect(l.listRowsOfAllAccountsCreatedInRange).not.toHaveBeenCalled();
    expect(l.listRowsForAccountCreatedInRange).toHaveBeenCalledWith(A, { from: window.start, to: window.end }, CHARGED_LEDGER_READ);
  });

  it('a window entirely before the cut-over reads nothing: an exact 0', async () => {
    const l = ledger([row(A, '5')]);
    const early = { start: new Date('2026-09-01T00:00:00.000Z'), end: new Date('2026-09-10T00:00:00.000Z') };
    const tile = await buildChargedAiCostInWindow({ window: early, accountId: null }, logger(), { ledger: l });
    expect(l.listRowsOfAllAccountsCreatedInRange).not.toHaveBeenCalled();
    expect(tile).toMatchObject({ status: 'ok', coverage: 'entirely_before_cutover', costUsd: 0, rows: 0 });
  });

  it('a window starting before the cut-over reads from the cut-over', async () => {
    const l = ledger([]);
    const spanning = { start: new Date('2026-09-20T00:00:00.000Z'), end: new Date('2026-10-05T00:00:00.000Z') };
    const read = readChargedWindow(l, null, spanning);
    await read.result;
    expect(read.coverage).toBe('starts_before_cutover');
    expect(l.listRowsOfAllAccountsCreatedInRange).toHaveBeenCalledWith(
      { from: new Date(CHARGING_CUTOVER_FLOOR_MS), to: spanning.end },
      CHARGED_LEDGER_READ
    );
  });
});

describe('the figure', () => {
  it('nets charges and corrections, deleted accounts inside the total and on their own line', async () => {
    const charge = row(A, '0.5');
    const rows = [
      charge,
      row(A, '-0.1', { kind: 'adjustment', action_id: null, adjusts_action_id: charge.action_id, credits: '-0.2' }),
      row(null, '0.25'),
    ];
    const tile = await buildChargedAiCostInWindow({ window, accountId: null }, logger(), { ledger: ledger(rows) });
    expect(tile).toEqual({
      status: 'ok',
      coverage: 'after_cutover',
      costUsd: 0.65,
      credits: 1.8,
      charges: 2,
      rows: 3,
      deleted: { costUsd: 0.25, credits: 1, rows: 1 },
      unreadableAmounts: 0,
    });
  });

  it('the ceiling makes it partial (a lower bound)', async () => {
    const tile = await buildChargedAiCostInWindow({ window, accountId: null }, logger(), { ledger: ledger([row(A, '1')], true) });
    expect(tile).toMatchObject({ status: 'partial', costUsd: 1 });
  });

  it('an unreadable amount counts as 0, is counted, and makes it partial', async () => {
    const tile = await buildChargedAiCostInWindow({ window, accountId: null }, logger(), {
      ledger: ledger([row(A, '1'), row(A, 'not-a-number')]),
    });
    expect(tile).toMatchObject({ status: 'partial', costUsd: 1, unreadableAmounts: 1 });
  });

  it('a failed or throwing read is unknown, logged with { err }, never a rejection', async () => {
    const failing = {
      listRowsOfAllAccountsCreatedInRange: jest.fn(() => Promise.resolve({ data: null, error: new Error('down') })),
      listRowsForAccountCreatedInRange: jest.fn(() => {
        throw new Error('sync');
      }),
    };
    for (const accountId of [null, A]) {
      const log = logger();
      const tile = await buildChargedAiCostInWindow({ window, accountId }, log, { ledger: failing });
      expect(tile).toEqual({
        status: 'unknown',
        coverage: 'after_cutover',
        costUsd: null,
        credits: null,
        charges: null,
        rows: null,
        deleted: null,
        unreadableAmounts: 0,
      });
      expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ err: expect.any(Error) }), 'Charged AI cost read failed');
    }
  });
});

describe('the default window is the same on both pages (T-2)', () => {
  it("Charge checks' This month default resolves to Finance's This month instants", () => {
    expect(AI_COST_FILTER_SPEC.window.defaultValue).toEqual({ kind: 'preset', preset: 'this_month' });
    const params = new URLSearchParams(reportSearch(AI_COST_FILTER_SPEC.window.defaultValue, '', NOW));
    const charges = windowInstants({ from: params.get('from') as string, to: params.get('to') as string });
    const finance = resolveFinanceWindow({ preset: 'this_month' }, NOW);
    expect(charges.start.toISOString()).toBe(finance.start.toISOString());
    expect(charges.end.toISOString()).toBe(finance.end.toISOString());
  });
});
