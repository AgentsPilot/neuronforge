/**
 * Section 3's sums (finance & business health slice 1a, S1-FR-16, AC-7,
 * AC-10 method, AC-15, SA-WR-5).
 */

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

import type { CreditLedgerRow } from '@/lib/repositories/BusinessOsCreditLedgerReadRepository';
import { missingOriginalIds, summariseAiCost, type SummariseAiCostInput } from '../aiCost';
import type { FinanceGroupKey } from '../financeTypes';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const PLATFORM = '00000000-0000-0000-0000-000000000000';

let n = 0;
function row(extra: Partial<CreditLedgerRow> = {}): CreditLedgerRow {
  n += 1;
  return {
    id: String(n),
    kind: 'charge',
    action_id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`,
    adjusts_action_id: null,
    reason_code: null,
    user_id: A,
    period_start: '2026-10-01T00:00:00+00:00',
    group_id: null,
    credits: '1.000000',
    cost_usd: '0.1000000000',
    credit_value_version: 0,
    is_fallback_priced: false,
    service: 'ai',
    action_type: 'chat_turn',
    triggered_by: 'owner',
    outcome: 'succeeded',
    created_at: '2026-10-05T10:00:00+00:00',
    ...extra,
  };
}

const base = (rows: CreditLedgerRow[], extra: Partial<SummariseAiCostInput> = {}): SummariseAiCostInput => ({
  rows,
  reachedCeiling: false,
  originals: [],
  groupOf: () => 'founding_partner',
  groupsComplete: true,
  tierLabelOf: () => null,
  isPlatform: (id) => id === PLATFORM,
  ...extra,
});

const trigger = (figures: ReturnType<typeof summariseAiCost>['figures'], key: string) =>
  figures.byTrigger.find((t) => t.trigger === key);

describe('summariseAiCost', () => {
  it('sums exactly: $0.1 + $0.2 + $0.0 is 0.3, not 0.30000000000000004', () => {
    const { figures } = summariseAiCost(
      base([row({ cost_usd: '0.1' }), row({ cost_usd: 0.2 }), row({ cost_usd: '0', credits: '0.000001' })])
    );
    expect(figures.costUsd).toBe(0.3);
    expect(figures.credits).toBe(2.000001);
    expect(figures.chargedActions).toBe(3);
    expect(figures.exact).toBe(true);
  });

  it('nets an adjustment under its charge’s trigger, when the charge is in the read set', () => {
    const charge = row({ triggered_by: 'scheduled', cost_usd: '1.0' });
    const adj = row({
      kind: 'adjustment',
      action_id: null,
      adjusts_action_id: charge.action_id,
      service: null,
      action_type: null,
      triggered_by: null,
      cost_usd: '-0.25',
      credits: '-1',
    });
    const { figures } = summariseAiCost(base([charge, adj]));
    expect(figures.costUsd).toBe(0.75);
    expect(figures.chargedActions).toBe(1);
    expect(trigger(figures, 'scheduled')).toEqual({ trigger: 'scheduled', costUsd: 0.75, credits: 0, rows: 2 });
    expect(figures.unresolvedAdjustments).toBe(0);
  });

  it('resolves an adjustment whose original was fetched from outside the window', () => {
    const original = row({ triggered_by: 'external' });
    const adj = row({ kind: 'adjustment', action_id: null, adjusts_action_id: original.action_id, service: null, triggered_by: null, cost_usd: '-0.05' });
    const { figures } = summariseAiCost(base([adj], { originals: [original] }));
    expect(trigger(figures, 'external')?.rows).toBe(1);
    // The original itself is NOT counted: it is outside the window.
    expect(figures.costUsd).toBe(-0.05);
    expect(figures.rows).toBe(1);
  });

  it('an adjustment whose original belongs to another account is unattributed, and counted', () => {
    const original = row({ user_id: B });
    const adj = row({ kind: 'adjustment', action_id: null, adjusts_action_id: original.action_id, service: null, triggered_by: null });
    const { figures } = summariseAiCost(base([adj], { originals: [original] }));
    expect(trigger(figures, 'unattributed')?.rows).toBe(1);
    expect(figures.unresolvedAdjustments).toBe(1);
  });

  it('a deleted account’s row is in the total AND its own bucket, never in the top 10', () => {
    const { figures, top } = summariseAiCost(base([row({ user_id: null, cost_usd: '5' }), row({ cost_usd: '1' })]));
    expect(figures.costUsd).toBe(6);
    expect(figures.deleted).toEqual({ costUsd: 5, credits: 1, rows: 1 });
    expect(top.map((t) => t.accountId)).toEqual([A]);
  });

  it('SA-WR-5: a platform account is counted in the total and marked in the top 10', () => {
    const { figures, top } = summariseAiCost(base([row({ user_id: PLATFORM, cost_usd: '2' }), row({ cost_usd: '1' })]));
    expect(figures.costUsd).toBe(3);
    expect(top[0]).toEqual({ accountId: PLATFORM, costUsd: 2, credits: 1, isPlatform: true });
    expect(top[1].isPlatform).toBe(false);
  });

  it('AC-15: a read at its ceiling is not exact', () => {
    expect(summariseAiCost(base([row()], { reachedCeiling: true })).figures.exact).toBe(false);
  });

  it('AC-7: no rows → zeros, exact', () => {
    const { figures, top } = summariseAiCost(base([]));
    expect(figures).toMatchObject({ exact: true, costUsd: 0, credits: 0, chargedActions: 0, rows: 0 });
    expect(top).toEqual([]);
    expect(figures.byTrigger.every((t) => t.rows === 0)).toBe(true);
  });

  it('an unreadable amount counts as 0 and is counted', () => {
    const { figures } = summariseAiCost(base([row({ cost_usd: 'abc' }), row({ cost_usd: '0.5' })]));
    expect(figures.costUsd).toBe(0.5);
    expect(figures.unreadableAmounts).toBe(1);
  });

  it('SA-1: an unreadable amount makes the figures not exact (never shown as an exact total)', () => {
    expect(summariseAiCost(base([row({ cost_usd: 'abc' })])).figures.exact).toBe(false);
    expect(summariseAiCost(base([row({ cost_usd: '0.5' })])).figures.exact).toBe(true);
  });

  it('SA-2: the plan walk at its ceiling → the by-group breakdown is partial, not ok', () => {
    expect(summariseAiCost(base([row()], { groupsComplete: false })).figures.byGroup.status).toBe('partial');
    expect(summariseAiCost(base([row()])).figures.byGroup.status).toBe('ok');
  });

  it('11 accounts → the top 10 by cost, ties by account id ascending', () => {
    const ids = Array.from({ length: 11 }, (_, i) => `${String(i).padStart(8, '0')}-1111-4111-8111-111111111111`);
    const rows = ids.map((id, i) => row({ user_id: id, cost_usd: i < 3 ? '1' : String(i) }));
    const { top } = summariseAiCost(base(rows));
    expect(top).toHaveLength(10);
    expect(top[0].accountId).toBe(ids[10]);
    // Three accounts tie at $1: the two lowest ids survive the cut.
    expect(top.slice(-2).map((t) => t.accountId)).toEqual([ids[0], ids[1]]);
  });

  it('breaks down by current plan group; no plan row → Unknown/held; walk failed → unknown', () => {
    const groups: Record<string, FinanceGroupKey> = { [A]: 'comped' };
    const { figures } = summariseAiCost(
      base([row({ cost_usd: '2' }), row({ user_id: B, cost_usd: '1' }), row({ user_id: null })], {
        groupOf: (id) => groups[id],
      })
    );
    expect(figures.byGroup.status).toBe('ok');
    expect(figures.byGroup.lines.map((l) => [l.key, l.costUsd])).toEqual([
      ['comped', 2],
      ['unknown_held', 1],
    ]);
    expect(summariseAiCost(base([row()], { groupOf: null })).figures.byGroup).toEqual({ status: 'unknown', lines: [] });
  });
});

describe('missingOriginalIds', () => {
  it('lists only the adjustments’ charges that are not in the read set', () => {
    const charge = row();
    const inSet = row({ kind: 'adjustment', action_id: null, adjusts_action_id: charge.action_id });
    const outside = row({ kind: 'adjustment', action_id: null, adjusts_action_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
    expect(missingOriginalIds([charge, inSet, outside])).toEqual(['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb']);
  });
});
