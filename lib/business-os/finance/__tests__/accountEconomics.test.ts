/**
 * Account economics and AI margin (finance & business health slice 6a, Money
 * M-3, T1): AC-131 to AC-141 and AC-143 builder halves, the E-45 table
 * (AC-133), SA-W75 (the integer scale and its safe range, SA-WR-41), SA-W81,
 * SA-W82 (precedence, pairwise), SA-W86 (the Deleted row), SA-W87 (sorts) and
 * the cap. `checkNineteen` / `checkTwenty` are independent TypeScript ports of
 * the §13 SQL checks 19 and 20 (the 5a `checkSeventeen` precedent).
 *
 * Fixtures name no tier literal: the tier comes from `config.tierOrder`.
 */

import { getEntitlementConfig } from '@/lib/business-os/entitlements/source';
import { buildAccountEconomics, buildAccountMargin, type AccountEconomicsInput } from '../accountEconomics';
import type { AiCostUnitBucket, AiCostUnits } from '../aiCost';
import type { BoostPurchaseInput } from '../boostRevenue';
import type { CreditsSectionRow } from '../creditsSection';
import type { PlanPaymentInput } from '../planRevenue';
import { STRIPE_FEE_ESTIMATE } from '../financeRules';
import type { FinanceAccountsTabQuery, FinanceGroupKey, FinanceMarginValue } from '../financeTypes';

const TIER = getEntitlementConfig().tierOrder[0];
const TIER_KEY: FinanceGroupKey = `tier:${TIER}`;
const PLAN_KIND = 'invoice_paid';

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OWNER = uid(1);
const B = uid(2);
const C = uid(3);
const D = uid(4);
const PLATFORM = '00000000-0000-0000-0000-000000000000';
const COST_SCALE = 1e10;

let seq = 0;
function boost(extra: Partial<BoostPurchaseInput> = {}): BoostPurchaseInput {
  seq += 1;
  return {
    id: `bbbbbbbb-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    user_id: OWNER,
    status: 'paid',
    package_id: 'pkg-small',
    package_version: 1,
    currency: 'USD',
    amount_total_minor: 1000,
    amount_tax_minor: 0,
    credits_total: '5000.000000',
    ...extra,
  };
}
/** Slice 4b.2: a reversal event recorded in the window (R-n), on a purchase of `user_id`. */
type EventInput = NonNullable<AccountEconomicsInput['events']>['rows'][number];
function ev(amount: number, extra: Partial<EventInput> = {}, purchase: Partial<NonNullable<EventInput['purchase']>> = {}): EventInput {
  seq += 1;
  return {
    id: `cccccccc-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    purchase_id: 'pppppppp-0000-4000-8000-000000000001',
    kind: 'refund',
    amount_minor: amount,
    currency: 'USD',
    purchase: { user_id: OWNER, package_id: 'pkg-small', package_version: 1, amount_total_minor: 1000, amount_tax_minor: 0, paid: true, ...purchase },
    ...extra,
  };
}
const events = (rows: EventInput[]) => ({ rows, reachedCeiling: false });
function invoice(extra: Partial<PlanPaymentInput> = {}): PlanPaymentInput {
  seq += 1;
  return {
    id: `eeeeeeee-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    user_id: OWNER,
    kind: PLAN_KIND,
    tier: 'stored-tier-id',
    amount_minor: 7900,
    amount_tax_minor: 0,
    currency: 'usd',
    period_start: null,
    period_end: null,
    paid_at: '2026-10-12T18:21:09.000Z',
    ...extra,
  };
}

const bucket = (cost: number, rows = 1, unreadable = 0): AiCostUnitBucket => ({ cost, rows, unreadable });
function units(byAccount: Record<string, number | AiCostUnitBucket>, deleted: AiCostUnitBucket = bucket(0, 0)): AiCostUnits {
  const map = new Map<string, AiCostUnitBucket>(
    Object.entries(byAccount).map(([id, v]) => [id, typeof v === 'number' ? bucket(v) : v])
  );
  const total = bucket(deleted.cost, deleted.rows, deleted.unreadable);
  for (const b of map.values()) {
    total.cost += b.cost;
    total.rows += b.rows;
    total.unreadable += b.unreadable;
  }
  return { byAccount: map, deleted, total };
}

const position = (accountId: string, usedTenths: number): CreditsSectionRow => ({
  accountId,
  group: TIER_KEY,
  tierLabel: 'Tier label',
  kind: 'position',
  allowance: 1000,
  used: usedTenths,
  usedTenths,
  trial: false,
  overAllowance: false,
  farOverAllowance: false,
  giftedOutstanding: 0,
});

const QUERY: FinanceAccountsTabQuery = { sort: 'ai_cost', group: null, show: 'all' };

function input(over: Partial<AccountEconomicsInput> = {}): AccountEconomicsInput {
  return {
    coverage: 'after_cutover',
    aiCost: { units: units({ [OWNER]: 12_345_000_000 }), reachedCeiling: false },
    boosts: { rows: [boost()], reachedCeiling: false },
    plans: { rows: [invoice()], reachedCeiling: false },
    walk: { accountIds: [OWNER, B], capped: false },
    groupOf: (id) => (id === OWNER ? TIER_KEY : id === B ? 'trial' : undefined),
    foundingPartner: (id) => id === OWNER,
    tierLabelOf: (key) => (key === TIER_KEY ? 'Tier label' : null),
    credits: new Map([
      [OWNER, position(OWNER, 400)],
      [B, position(B, 100)],
    ]),
    isPlatform: (id) => id === PLATFORM,
    query: QUERY,
    cap: 200,
    groupOptions: [{ key: TIER_KEY, tierLabel: 'Tier label' }],
    refundOrDispute: false,
    // Slice 6b: the production config (290 bps + 30 minor units, USD).
    feeEstimate: STRIPE_FEE_ESTIMATE,
    ...over,
  };
}

const rowOf = (built: ReturnType<typeof buildAccountEconomics>, id: string) => built.section.rows.find((r) => r.accountId === id);
const marginOf = (built: ReturnType<typeof buildAccountEconomics>, id: string) => rowOf(built, id)?.margin;

// ── Independent ports of SQL checks 19 and 20 (§13) ─────────────────────────

const PAID = ['paid', 'partially_refunded', 'refunded', 'disputed', 'dispute_lost'];
type Rev = { account: string; currency: string; afterTax: number | null };
function sqlRevenue(boosts: BoostPurchaseInput[], plans: PlanPaymentInput[]): Rev[] {
  const out: Rev[] = [];
  for (const e of plans) {
    if (e.kind !== PLAN_KIND) continue;
    out.push({ account: e.user_id ?? 'deleted accounts', currency: String(e.currency).trim().toUpperCase(), afterTax: (e.amount_minor as number) - (e.amount_tax_minor as number) });
  }
  // Slice 4b.2 (FR-4B-11): a purchase of the window gives total minus tax whatever its status; its
  // refunds and lost disputes are separate dated events (check 26), so this port reads no refund column.
  for (const b of boosts) {
    if (!PAID.includes(b.status as string)) continue;
    const total = b.amount_total_minor as number;
    const tax = b.amount_tax_minor as number;
    out.push({ account: b.user_id ?? 'deleted accounts', currency: String(b.currency).trim().toUpperCase(), afterTax: total - tax });
  }
  return out;
}
interface CheckRow { usdMinor: number; otherCurrencies: string; inexact: number; aiCostUsd: number; marginUsd: number | null }
function checkNineteen(boosts: BoostPurchaseInput[], plans: PlanPaymentInput[], costUsdByAccount: Record<string, number>, monthStartsBeforeCutover = false): Map<string, CheckRow> {
  const rev = sqlRevenue(boosts, plans);
  const accounts = new Set([...rev.map((r) => r.account), ...Object.keys(costUsdByAccount)]);
  const out = new Map<string, CheckRow>();
  for (const account of accounts) {
    const mine = rev.filter((r) => r.account === account);
    const usdMinor = mine.filter((r) => r.currency === 'USD').reduce((n, r) => n + (r.afterTax ?? 0), 0);
    const other = mine.filter((r) => r.currency !== 'USD');
    const inexact = mine.filter((r) => r.afterTax === null).length;
    const cost = costUsdByAccount[account] ?? 0;
    const marginUsd =
      monthStartsBeforeCutover || other.length > 0 || inexact > 0 ? null : Math.round((usdMinor / 100 - cost) * 1e6) / 1e6;
    out.set(account, { usdMinor, otherCurrencies: [...new Set(other.map((r) => r.currency))].sort().join(','), inexact, aiCostUsd: cost, marginUsd });
  }
  return out;
}
function checkTwenty(boosts: BoostPurchaseInput[], plans: PlanPaymentInput[], totalCostUsd: number): { usdMinor: number; marginUsd: number | null } {
  const rev = sqlRevenue(boosts, plans);
  const usdMinor = rev.filter((r) => r.currency === 'USD').reduce((n, r) => n + (r.afterTax ?? 0), 0);
  const blocked = rev.some((r) => r.currency !== 'USD' || r.afterTax === null);
  return { usdMinor, marginUsd: blocked ? null : Math.round((usdMinor / 100 - totalCostUsd) * 1e6) / 1e6 };
}
const figure = (m: FinanceMarginValue | undefined) => (m?.kind === 'figure' ? Math.round(m.marginUsd * 1e6) / 1e6 : null);

// ── AC-132 / AC-135 / AC-142: the owner's October row ───────────────────────

describe('the owner row (AC-132, AC-134, AC-135): plan 79.00 + boost 10.00, tax 0, cost X', () => {
  it('paid us USD 89.00 after tax with its parts; AI cost X; margin 89.00 − X, equal to check 19', () => {
    const built = buildAccountEconomics(input());
    const row = rowOf(built, OWNER);
    expect(row?.paid).toEqual({
      failed: false,
      lines: [{ currency: 'USD', afterTax: 89, exact: true, planAfterTax: 79, boostsAfterTax: 10 }],
    });
    expect(row?.aiCost).toEqual({ kind: 'figure', costUsd: 1.2345, exact: true });
    expect(row?.margin).toEqual({ kind: 'figure', marginUsd: 87.7655, noRevenue: false });
    const check = checkNineteen([boost()], [invoice()], { [OWNER]: 1.2345 }).get(OWNER);
    expect(check?.usdMinor).toBe(8900);
    expect(figure(row?.margin)).toBe(check?.marginUsd);
    expect(row?.foundingPartner).toBe(true);
    expect(row?.group).toBe(TIER_KEY);
    expect(row?.tierLabel).toBe('Tier label');
    expect(row?.credits).toEqual({ kind: 'position', used: 400, allowance: 1000, usedTenths: 400 });
  });

  it('SA-W75: the subtraction is integer at the ledger scale, never two wire floats', () => {
    expect(marginOf(buildAccountEconomics(input()), OWNER)).toEqual({ kind: 'figure', marginUsd: 87.7655, noRevenue: false });
    // USD 1.00 paid and USD 0.9 cost: the float subtraction is 0.09999999999999998; the integer path is 0.1.
    expect(1 - 0.9).not.toBe(0.1);
    const built = buildAccountEconomics(
      input({
        boosts: { rows: [], reachedCeiling: false },
        plans: { rows: [invoice({ amount_minor: 100 })], reachedCeiling: false },
        aiCost: { units: units({ [OWNER]: 9_000_000_000 }), reachedCeiling: false },
      })
    );
    expect(marginOf(built, OWNER)).toEqual({ kind: 'figure', marginUsd: 0.1, noRevenue: false });
  });

  it('an account with no revenue: margin −cost, noRevenue true, equal to check 19', () => {
    const built = buildAccountEconomics(input({ aiCost: { units: units({ [OWNER]: 12_345_000_000, [B]: 5_000_000 }), reachedCeiling: false } }));
    expect(marginOf(built, B)).toEqual({ kind: 'figure', marginUsd: -0.0005, noRevenue: true });
    expect(figure(marginOf(built, B))).toBe(checkNineteen([], [], { [B]: 0.0005 }).get(B)?.marginUsd);
  });

  it('a negative margin keeps its sign (losses first under sort=margin)', () => {
    const built = buildAccountEconomics(input({ aiCost: { units: units({ [OWNER]: 900_000_000_000 }), reachedCeiling: false } }));
    expect(marginOf(built, OWNER)).toEqual({ kind: 'figure', marginUsd: -1, noRevenue: false });
  });
});

// ── AC-133: the E-45 table, one case per row ────────────────────────────────

describe('AC-133: paid us after tax, one case per rule (E-45)', () => {
  const paidOf = (rows: { boosts?: BoostPurchaseInput[]; plans?: PlanPaymentInput[] }) =>
    rowOf(
      buildAccountEconomics(
        input({ boosts: { rows: rows.boosts ?? [], reachedCeiling: false }, plans: { rows: rows.plans ?? [], reachedCeiling: false } })
      ),
      OWNER
    );

  type Rows = { boosts?: BoostPurchaseInput[]; plans?: PlanPaymentInput[] };
  it.each<[string, Rows, number]>([
    ['plan 7900 / tax 500 → 74.00', { plans: [invoice({ amount_minor: 7900, amount_tax_minor: 500 })] }, 74],
    ['boost paid 1000 / tax 100 → 9.00', { boosts: [boost({ amount_tax_minor: 100 })] }, 9],
    // Slice 4b.2 (FR-4B-11): the purchase status moves no money; refunds and losses are dated events.
    ['a refunded purchase paid in the window, tax 100 → 9.00 (its refund is an event)', { boosts: [boost({ status: 'refunded', amount_tax_minor: 100 })] }, 9],
    ['partially_refunded, tax 0 → its total', { boosts: [boost({ status: 'partially_refunded' })] }, 10],
    ['disputed, tax 100 → 9.00 (held now is never deducted)', { boosts: [boost({ status: 'disputed', amount_tax_minor: 100 })] }, 9],
    ['dispute_lost → its total (the loss is an event)', { boosts: [boost({ status: 'dispute_lost' })] }, 10],
  ])('%s', (_name, rows, expected) => {
    const row = paidOf(rows);
    expect(row?.paid.lines[0].afterTax).toBe(expected);
    expect(row?.margin.kind).toBe('figure');
    const check = checkNineteen(rows.boosts ?? [], rows.plans ?? [], { [OWNER]: 1.2345 }).get(OWNER);
    expect(check?.usdMinor).toBe(expected * 100);
    expect(figure(row?.margin)).toBe(check?.marginUsd);
  });

  it('SA-Q47 (4b.2): a refund event on a taxed purchase → the line and its boost part Unknown, margin Unknown', () => {
    const row = rowOf(
      buildAccountEconomics(
        input({
          boosts: { rows: [boost({ amount_tax_minor: 100 })], reachedCeiling: false },
          events: events([ev(400, {}, { amount_tax_minor: 100 })]),
          plans: { rows: [invoice()], reachedCeiling: false },
        })
      ),
      OWNER
    );
    expect(row?.paid.lines[0]).toEqual({ currency: 'USD', afterTax: null, exact: true, planAfterTax: 79, boostsAfterTax: null });
    expect(row?.margin).toEqual({ kind: 'unknown' });
  });

  it('SA-W81 (i): a paid boost whose tax is above its amount → Unknown on the page (check 19 gives a negative figure: a recorded difference)', () => {
    const rows = { boosts: [boost({ amount_total_minor: 100, amount_tax_minor: 120 })] };
    const row = paidOf(rows);
    expect(row?.paid.lines[0].afterTax).toBeNull();
    expect(row?.margin).toEqual({ kind: 'unknown' });
    expect(checkNineteen(rows.boosts, [], {}).get(OWNER)?.usdMinor).toBe(-20);
  });

  it('AC-226 (4b.2): a refund event on an untaxed purchase is taken off in the window it was recorded', () => {
    const built = buildAccountEconomics(input({ events: events([ev(400)]), plans: { rows: [], reachedCeiling: false } }));
    expect(rowOf(built, OWNER)?.paid.lines[0].afterTax).toBe(6);
  });

  it('SA-Q49 (4b.2): an account whose only boost money in the window is a refund is listed, negative', () => {
    const built = buildAccountEconomics(
      input({ boosts: { rows: [], reachedCeiling: false }, events: events([ev(1000, {}, { user_id: B })]), plans: { rows: [], reachedCeiling: false } })
    );
    expect(rowOf(built, B)?.paid.lines[0].afterTax).toBe(-10);
  });

  it('a lost dispute event is taken off; an opened dispute and an event on a never-paid purchase move nothing', () => {
    const built = buildAccountEconomics(
      input({
        events: events([ev(300, { kind: 'dispute_lost' }), ev(1000, { kind: 'dispute_opened' }), ev(500, {}, { paid: false })]),
        plans: { rows: [], reachedCeiling: false },
      })
    );
    expect(rowOf(built, OWNER)?.paid.lines[0].afterTax).toBe(7);
  });

  it('the event read failing makes the boost figures Unknown (as the purchase read failing does)', () => {
    const built = buildAccountEconomics(input({ events: null }));
    expect(rowOf(built, OWNER)?.paid.lines[0].boostsAfterTax).toBeNull();
    expect(built.section.notes.boostsFailed).toBe(true);
  });

  it('the picked business: buildAccountMargin takes the same events, so the summary equals the tab row (AC-226)', () => {
    const shared = { events: events([ev(400)]) };
    const tab = rowOf(buildAccountEconomics(input(shared)), OWNER);
    const one = buildAccountMargin({ ...input(shared), accountId: OWNER });
    expect(one.paid).toEqual(tab?.paid);
    expect(one.margin).toEqual(tab?.margin);
  });

  it('a non-paid-family boost and another plan kind are not counted (filtered by the exported family and kind)', () => {
    const row = paidOf({ boosts: [boost({ status: 'pending' })], plans: [invoice({ kind: 'invoice_failed' })] });
    expect(row?.paid.lines).toEqual([]);
    expect(row?.margin).toEqual({ kind: 'figure', marginUsd: -1.2345, noRevenue: true });
  });

  it('a zero plan invoice adds nothing and makes no line', () => {
    expect(paidOf({ plans: [invoice({ amount_minor: 0 })] })?.paid.lines).toEqual([]);
  });

  it('an unreadable row → the line "At least" (exact false) and the margin Unknown', () => {
    const row = paidOf({ boosts: [boost(), boost({ amount_total_minor: '1000' })] });
    expect(row?.paid.lines[0]).toMatchObject({ currency: 'USD', afterTax: 10, exact: false });
    expect(row?.margin).toEqual({ kind: 'unknown' });
  });

  it('test-mode and live rows count together: the builder has no mode field (AC-147)', () => {
    const row = paidOf({ boosts: [boost(), { ...boost(), livemode: false } as BoostPurchaseInput] });
    expect(row?.paid.lines[0].afterTax).toBe(20);
  });
});

// ── AC-136: other currencies ────────────────────────────────────────────────

describe('AC-136: other currencies are never summed with USD', () => {
  it('an ILS boost alone → n/a, its own line', () => {
    const built = buildAccountEconomics(input({ boosts: { rows: [boost({ currency: 'ils' })], reachedCeiling: false }, plans: { rows: [], reachedCeiling: false } }));
    expect(rowOf(built, OWNER)?.paid.lines).toEqual([{ currency: 'ILS', afterTax: 10, exact: true, planAfterTax: 0, boostsAfterTax: 10 }]);
    expect(marginOf(built, OWNER)).toEqual({ kind: 'other_currency' });
  });

  it('ILS beside USD → two lines, no USD-only margin; the platform line n/a too', () => {
    const built = buildAccountEconomics(input({ boosts: { rows: [boost({ currency: 'ILS' })], reachedCeiling: false } }));
    expect(rowOf(built, OWNER)?.paid.lines.map((l) => [l.currency, l.afterTax])).toEqual([
      ['ILS', 10],
      ['USD', 79],
    ]);
    expect(marginOf(built, OWNER)).toEqual({ kind: 'other_currency' });
    expect(built.section.platform.margin).toEqual({ kind: 'other_currency' });
    expect(checkNineteen([boost({ currency: 'ILS' })], [invoice()], {}).get(OWNER)?.marginUsd).toBeNull();
  });

  it('SA-W82: an Unknown-currency line gives Unknown, never n/a', () => {
    const built = buildAccountEconomics(input({ boosts: { rows: [boost({ currency: 'dollars' })], reachedCeiling: false } }));
    const lines = rowOf(built, OWNER)?.paid.lines ?? [];
    expect(lines.map((l) => l.currency)).toEqual(['USD', null]);
    expect(lines[1].afterTax).toBeNull();
    expect(marginOf(built, OWNER)).toEqual({ kind: 'unknown' });
  });
});

// ── SA-W82: precedence, pairwise ────────────────────────────────────────────

describe('SA-W82: Not available > n/a > Unknown > the figure (pairwise)', () => {
  const ils = { rows: [boost({ currency: 'ILS' })], reachedCeiling: false };
  const ceiling = { units: units({ [OWNER]: 1 }), reachedCeiling: true };
  it('Not available beats n/a', () => {
    expect(marginOf(buildAccountEconomics(input({ coverage: 'starts_before_cutover', boosts: ils })), OWNER)).toEqual({ kind: 'not_available' });
  });
  it('Not available beats Unknown', () => {
    expect(marginOf(buildAccountEconomics(input({ coverage: 'starts_before_cutover', aiCost: ceiling })), OWNER)).toEqual({ kind: 'not_available' });
  });
  it('n/a beats Unknown', () => {
    expect(marginOf(buildAccountEconomics(input({ boosts: ils, aiCost: ceiling })), OWNER)).toEqual({ kind: 'other_currency' });
  });
  it('Unknown beats the figure', () => {
    expect(marginOf(buildAccountEconomics(input({ aiCost: ceiling })), OWNER)).toEqual({ kind: 'unknown' });
  });
  it('Not available beats the figure, and n/a beats the figure', () => {
    expect(marginOf(buildAccountEconomics(input({ coverage: 'starts_before_cutover' })), OWNER)).toEqual({ kind: 'not_available' });
    expect(marginOf(buildAccountEconomics(input({ boosts: ils })), OWNER)).toEqual({ kind: 'other_currency' });
  });
});

// ── AC-137 / AC-138: ceilings and failures ──────────────────────────────────

describe('AC-137: a read at its ceiling', () => {
  it.each([
    ['R-a', { aiCost: { units: units({ [OWNER]: 12_345_000_000 }), reachedCeiling: true } }],
    ['R-k', { boosts: { rows: [boost()], reachedCeiling: true } }],
    ['R-m', { plans: { rows: [invoice()], reachedCeiling: true } }],
  ])('%s at its ceiling → "At least" on that part, the margin Unknown on every row, the tab partial', (name, over) => {
    const built = buildAccountEconomics(input(over));
    for (const row of built.section.rows) expect(row.margin.kind).not.toBe('figure');
    expect(built.section.platform.margin).toEqual({ kind: 'unknown' });
    expect(built.section.status).toBe('partial');
    const owner = rowOf(built, OWNER);
    if (name === 'R-a') expect(owner?.aiCost).toEqual({ kind: 'figure', costUsd: 1.2345, exact: false });
    else expect(owner?.paid.lines[0].exact).toBe(false);
  });
});

describe('AC-138: each read failing alone shows Unknown in its column only', () => {
  it('the ledger fails → AI cost Unknown on every row, margin Unknown, paid us as read', () => {
    const built = buildAccountEconomics(input({ aiCost: null }));
    expect(rowOf(built, OWNER)?.aiCost).toEqual({ kind: 'unknown' });
    expect(rowOf(built, OWNER)?.paid.lines[0].afterTax).toBe(89);
    expect(built.section.platform.aiCost).toEqual({ kind: 'unknown' });
    expect(built.section.status).toBe('partial');
    expect(built.section.notes.ledgerFailed).toBe(true);
  });

  it('the boosts fail → paid us Unknown with the plan part still shown', () => {
    const built = buildAccountEconomics(input({ boosts: null }));
    expect(rowOf(built, OWNER)?.paid).toEqual({ failed: true, lines: [{ currency: 'USD', afterTax: null, exact: true, planAfterTax: 79, boostsAfterTax: null }] });
    expect(marginOf(built, OWNER)).toEqual({ kind: 'unknown' });
    expect(rowOf(built, OWNER)?.aiCost.kind).toBe('figure');
  });

  it('the plans fail → paid us Unknown with the boost part still shown', () => {
    const built = buildAccountEconomics(input({ plans: null }));
    expect(rowOf(built, OWNER)?.paid.lines[0]).toEqual({ currency: 'USD', afterTax: null, exact: true, planAfterTax: null, boostsAfterTax: 10 });
    expect(built.section.notes.plansFailed).toBe(true);
  });

  it('the plan walk fails → only money accounts, the notice, credits Unknown; money columns as read', () => {
    const built = buildAccountEconomics(input({ walk: null, credits: null, groupOf: () => undefined }));
    expect(built.section.rows.map((r) => r.accountId)).toEqual([OWNER]);
    expect(built.section.notes.walkIncomplete).toBe(true);
    expect(rowOf(built, OWNER)?.credits).toEqual({ kind: 'unknown' });
    expect(rowOf(built, OWNER)?.noPlanRow).toBe(false);
    expect(marginOf(built, OWNER)?.kind).toBe('figure');
    expect(built.section.status).toBe('partial');
  });

  it('the positions pass fails → credits Unknown, the tab partial, the rest as read', () => {
    const built = buildAccountEconomics(input({ credits: null }));
    expect(rowOf(built, OWNER)?.credits).toEqual({ kind: 'unknown' });
    expect(marginOf(built, OWNER)?.kind).toBe('figure');
    expect(built.section.status).toBe('partial');
    expect(built.section.notes.creditsUnavailable).toBe(true);
  });

  it('all three money reads fail → the tab unknown', () => {
    expect(buildAccountEconomics(input({ aiCost: null, boosts: null, plans: null })).section.status).toBe('unknown');
  });

  it('everything read → ok', () => {
    expect(buildAccountEconomics(input()).section.status).toBe('ok');
  });

  it('a per-account unreadable ledger amount makes that account’s cost Unknown only (SA-W79)', () => {
    const built = buildAccountEconomics(input({ aiCost: { units: units({ [OWNER]: bucket(10, 2, 1), [B]: 5 }), reachedCeiling: false } }));
    expect(rowOf(built, OWNER)?.aiCost).toEqual({ kind: 'unknown' });
    expect(marginOf(built, OWNER)).toEqual({ kind: 'unknown' });
    expect(rowOf(built, B)?.aiCost.kind).toBe('figure');
    expect(built.section.platform.aiCost).toEqual({ kind: 'unknown' });
  });
});

// ── AC-139: the cut-over ────────────────────────────────────────────────────

describe('AC-139: before the charging cut-over', () => {
  it('starts_before_cutover → not_available on every row and the platform line; revenue and cost still present', () => {
    const built = buildAccountEconomics(input({ coverage: 'starts_before_cutover' }));
    for (const row of built.section.rows) expect(row.margin).toEqual({ kind: 'not_available' });
    expect(built.section.platform.margin).toEqual({ kind: 'not_available' });
    expect(rowOf(built, OWNER)?.paid.lines[0].afterTax).toBe(89);
    expect(rowOf(built, OWNER)?.aiCost.kind).toBe('figure');
    expect(checkNineteen([boost()], [invoice()], { [OWNER]: 1 }, true).get(OWNER)?.marginUsd).toBeNull();
  });

  it('entirely_before_cutover → the cost reads the cut-over notice (never 0), the margin not_available', () => {
    const built = buildAccountEconomics(input({ coverage: 'entirely_before_cutover', aiCost: { units: units({}), reachedCeiling: false } }));
    expect(rowOf(built, OWNER)?.aiCost).toEqual({ kind: 'before_cutover' });
    expect(built.section.platform.aiCost).toEqual({ kind: 'before_cutover' });
    expect(marginOf(built, OWNER)).toEqual({ kind: 'not_available' });
  });
});

// ── AC-131: which accounts ──────────────────────────────────────────────────

describe('AC-131: which accounts (M3-FR-2, SA-Q49, SA-W85, SA-W86)', () => {
  it('8 walk ids plus one money-only id → 9 rows; the extra one noPlanRow, unknown_held, credits "No plan row"', () => {
    const walk = [uid(10), uid(11), uid(12), uid(13), uid(14), uid(15), uid(16), uid(17)];
    const built = buildAccountEconomics(
      input({ walk: { accountIds: walk, capped: false }, boosts: { rows: [boost({ user_id: uid(99) })], reachedCeiling: false }, plans: { rows: [], reachedCeiling: false }, aiCost: { units: units({}), reachedCeiling: false } })
    );
    expect(built.section.rows).toHaveLength(9);
    const extra = rowOf(built, uid(99));
    expect(extra).toMatchObject({ noPlanRow: true, group: 'unknown_held', credits: { kind: 'no_plan_row' }, foundingPartner: false });
    expect(built.counts.noPlanRow).toBe(1);
  });

  it('a NULL user_id row → the Deleted row, last, outside the cap and the count; in the platform line', () => {
    const deleted = bucket(3_000_000_000, 2);
    const built = buildAccountEconomics(
      input({
        cap: 1,
        aiCost: { units: units({ [OWNER]: 12_345_000_000 }, deleted), reachedCeiling: false },
        boosts: { rows: [boost(), boost({ user_id: null })], reachedCeiling: false },
      })
    );
    expect(built.section.rows).toHaveLength(1);
    expect(built.section.counts).toEqual({ accounts: 2, matching: 2, shown: 1, notListed: 1 });
    expect(built.section.deleted).toEqual({
      paid: { failed: false, lines: [{ currency: 'USD', afterTax: 10, exact: true, planAfterTax: 0, boostsAfterTax: 10 }] },
      aiCost: { kind: 'figure', costUsd: 0.3, exact: true },
      margin: { kind: 'figure', marginUsd: 9.7, noRevenue: false },
      // Slice 6b: the 1000 boost is one charge, fee 29 + 30 = 59.
      marginAfterFees: { kind: 'figure', afterFeesUsd: 9.11, feesUsd: 0.59, currency: 'USD', noRevenue: false },
    });
    expect(built.section.platform.includesDeleted).toBe(true);
    expect(built.section.platform.paid.lines[0].afterTax).toBe(99);
    expect(built.shownIds).toEqual([OWNER]);
  });

  it('a platform id → kind platform, never in the names ids (no link, SA-W85)', () => {
    const built = buildAccountEconomics(input({ aiCost: { units: units({ [OWNER]: 1, [PLATFORM]: 99 }), reachedCeiling: false } }));
    expect(rowOf(built, PLATFORM)?.kind).toBe('platform');
    expect(built.shownIds).not.toContain(PLATFORM);
    expect(built.shownIds).toContain(OWNER);
  });

  it('SA-W86: the Deleted row shows only with group = all; with show=negative only when its margin is negative; with show=active always', () => {
    const deleted = bucket(3_000_000_000, 1);
    const base = { aiCost: { units: units({ [OWNER]: 1 }, deleted), reachedCeiling: false } };
    expect(buildAccountEconomics(input({ ...base, query: { ...QUERY, group: TIER_KEY } })).section.deleted).toBeNull();
    expect(buildAccountEconomics(input({ ...base, query: { ...QUERY, show: 'negative' } })).section.deleted?.margin).toEqual({ kind: 'figure', marginUsd: -0.3, noRevenue: true });
    const notNegative = buildAccountEconomics(input({ ...base, boosts: { rows: [boost({ user_id: null })], reachedCeiling: false }, query: { ...QUERY, show: 'negative' } }));
    expect(notNegative.section.deleted).toBeNull();
    expect(buildAccountEconomics(input({ ...base, query: { ...QUERY, show: 'active' } })).section.deleted).not.toBeNull();
  });
});

// ── AC-134: the platform line ───────────────────────────────────────────────

describe('AC-134: the platform line covers every account, before any filter or cap', () => {
  it('its cost is units.total (deleted included), and it is identical under every filter, sort and cap (deep-equal)', () => {
    const u = units({ [OWNER]: 12_345_000_000, [B]: 7 }, bucket(5_000_000, 1));
    const reference = buildAccountEconomics(input({ aiCost: { units: u, reachedCeiling: false } })).section.platform;
    expect(reference.aiCost).toEqual({ kind: 'figure', costUsd: u.total.cost / COST_SCALE, exact: true });
    for (const query of [
      { sort: 'margin', group: TIER_KEY, show: 'negative' },
      { sort: 'paid', group: 'trial', show: 'active' },
      { sort: 'credits', group: `tier:no-such-tier`, show: 'all' },
    ] as FinanceAccountsTabQuery[]) {
      expect(buildAccountEconomics(input({ aiCost: { units: u, reachedCeiling: false }, query, cap: 1 })).section.platform).toEqual(reference);
    }
    const twenty = checkTwenty([boost()], [invoice()], u.total.cost / COST_SCALE);
    expect(twenty.usdMinor).toBe(8900);
    expect(figure(reference.margin)).toBe(twenty.marginUsd);
  });
});

// ── AC-140: sorts ───────────────────────────────────────────────────────────

describe('AC-140: the four sorts (SA-W87), ties by id', () => {
  // OWNER: USD 89 paid, cost 1.2345 → margin 87.7655
  // B: no revenue, cost 2 → margin −2
  // C: ILS paid 10, cost 0.5 → n/a
  // D: USD unreadable line (Unknown margin), cost 3
  const fixture = () =>
    input({
      walk: { accountIds: [OWNER, B, C, D], capped: false },
      groupOf: () => TIER_KEY,
      aiCost: { units: units({ [OWNER]: 12_345_000_000, [B]: 20_000_000_000, [C]: 5_000_000_000, [D]: 30_000_000_000 }), reachedCeiling: false },
      boosts: { rows: [boost(), boost({ user_id: C, currency: 'ILS' }), boost({ user_id: D, amount_total_minor: 'x' })], reachedCeiling: false },
      credits: new Map([
        [OWNER, position(OWNER, 400)],
        [B, position(B, 900)],
        [C, { ...position(C, 0), kind: 'no_allowance', usedTenths: null, used: null, allowance: null }],
      ]),
    });
  const order = (sort: FinanceAccountsTabQuery['sort']) =>
    buildAccountEconomics({ ...fixture(), query: { ...QUERY, sort } }).section.rows.map((r) => r.accountId);

  it('AI cost, highest first (default)', () => expect(order('ai_cost')).toEqual([D, B, OWNER, C]));
  it('AI margin, lowest first; then n/a and Unknown by AI cost', () => expect(order('margin')).toEqual([B, OWNER, D, C]));
  it('Paid us: all-USD first by amount (Unknown last among them), then other currencies, then no revenue', () =>
    expect(order('paid')).toEqual([OWNER, D, C, B]));
  it('Credits used: usedTenths highest first; then No allowance; then Unknown', () => expect(order('credits')).toEqual([B, OWNER, C, D]));

  it('201 accounts: the account ranked 201 by AI cost is ranked 1 by margin → absent by default, present under sort=margin', () => {
    const ids = Array.from({ length: 201 }, (_, i) => uid(1000 + i));
    const costs: Record<string, number> = {};
    ids.forEach((id, i) => {
      costs[id] = (201 - i) * 1_000_000_000;
    });
    const loser = uid(1200);
    const over = {
      walk: { accountIds: ids, capped: false },
      aiCost: { units: units(costs), reachedCeiling: false },
      boosts: { rows: ids.filter((id) => id !== loser).map((id) => boost({ user_id: id, amount_total_minor: 100_000 })), reachedCeiling: false },
      plans: { rows: [], reachedCeiling: false },
      credits: null,
    };
    const byCost = buildAccountEconomics(input(over));
    expect(byCost.section.rows).toHaveLength(200);
    expect(byCost.section.rows.map((r) => r.accountId)).not.toContain(loser);
    const byMargin = buildAccountEconomics(input({ ...over, query: { ...QUERY, sort: 'margin' } }));
    expect(byMargin.section.rows[0].accountId).toBe(loser);
  });
});

// ── AC-141: filters ─────────────────────────────────────────────────────────

describe('AC-141: group and show narrow the rows; the platform line never moves', () => {
  it('group matches the account’s group; a well-formed unknown tier matches nothing', () => {
    const built = buildAccountEconomics(input({ query: { ...QUERY, group: 'trial' } }));
    expect(built.section.rows.map((r) => r.accountId)).toEqual([B]);
    expect(buildAccountEconomics(input({ query: { ...QUERY, group: 'tier:no-such-tier' } })).section.rows).toEqual([]);
  });

  it('show=active: paid us or used AI in the window', () => {
    const built = buildAccountEconomics(input({ query: { ...QUERY, show: 'active' } }));
    expect(built.section.rows.map((r) => r.accountId)).toEqual([OWNER]);
  });

  it('show=negative excludes n/a, Unknown and Not available', () => {
    const u = { units: units({ [OWNER]: 900_000_000_000, [B]: 1 }), reachedCeiling: false };
    expect(buildAccountEconomics(input({ aiCost: u, query: { ...QUERY, show: 'negative' } })).section.rows.map((r) => r.accountId)).toEqual([OWNER, B]);
    expect(buildAccountEconomics(input({ aiCost: u, coverage: 'starts_before_cutover', query: { ...QUERY, show: 'negative' } })).section.rows).toEqual([]);
    expect(buildAccountEconomics(input({ aiCost: { ...u, reachedCeiling: true }, query: { ...QUERY, show: 'negative' } })).section.rows).toEqual([]);
  });
});

// ── AC-143: the cap ─────────────────────────────────────────────────────────

describe('AC-143: 250 accounts → 200 shown, the honest count, the Deleted row extra', () => {
  it('counts and names ids', () => {
    const ids = Array.from({ length: 250 }, (_, i) => uid(2000 + i));
    const built = buildAccountEconomics(
      input({ walk: { accountIds: ids, capped: false }, aiCost: { units: units({}, bucket(1, 1)), reachedCeiling: false }, boosts: { rows: [], reachedCeiling: false }, plans: { rows: [], reachedCeiling: false } })
    );
    expect(built.section.counts).toEqual({ accounts: 250, matching: 250, shown: 200, notListed: 50 });
    expect(built.section.deleted).not.toBeNull();
    expect(built.shownIds).toHaveLength(200);
    expect(built.shownIds.every((id) => ids.includes(id))).toBe(true);
  });
});

// ── SA-WR-41: the safe range ────────────────────────────────────────────────

describe('SA-WR-41: the safe range is about USD 900,719 (revenue × 1e8 and cost units alike)', () => {
  const MAX_SAFE_MINOR = Math.floor(Number.MAX_SAFE_INTEGER / 1e8); // 90,071,992 minor = USD 900,719.92
  it('revenue just below the bound → the exact figure; just above → Unknown (row and platform line)', () => {
    const below = buildAccountEconomics(
      input({ boosts: { rows: [boost({ amount_total_minor: MAX_SAFE_MINOR })], reachedCeiling: false }, plans: { rows: [], reachedCeiling: false }, aiCost: { units: units({ [OWNER]: 0 }), reachedCeiling: false } })
    );
    expect(marginOf(below, OWNER)).toEqual({ kind: 'figure', marginUsd: MAX_SAFE_MINOR / 100, noRevenue: false });
    expect(below.section.platform.margin).toEqual({ kind: 'figure', marginUsd: MAX_SAFE_MINOR / 100, noRevenue: false });
    const above = buildAccountEconomics(
      input({ boosts: { rows: [boost({ amount_total_minor: MAX_SAFE_MINOR + 1 })], reachedCeiling: false }, plans: { rows: [], reachedCeiling: false }, aiCost: { units: units({ [OWNER]: 0 }), reachedCeiling: false } })
    );
    expect(marginOf(above, OWNER)).toEqual({ kind: 'unknown' });
    expect(above.section.platform.margin).toEqual({ kind: 'unknown' });
    // The paid figure itself is still shown: only the margin needs the common scale.
    expect(rowOf(above, OWNER)?.paid.lines[0].afterTax).toBe((MAX_SAFE_MINOR + 1) / 100);
  });

  it('cost units past Number.MAX_SAFE_INTEGER → the cost and the margin Unknown (row and platform line), never a figure', () => {
    const built = buildAccountEconomics(input({ aiCost: { units: units({ [OWNER]: Number.MAX_SAFE_INTEGER + 2 }), reachedCeiling: false } }));
    expect(rowOf(built, OWNER)?.aiCost).toEqual({ kind: 'unknown' });
    expect(marginOf(built, OWNER)).toEqual({ kind: 'unknown' });
    expect(built.section.platform.margin).toEqual({ kind: 'unknown' });
    const justBelow = buildAccountEconomics(input({ aiCost: { units: units({ [OWNER]: Number.MAX_SAFE_INTEGER }), reachedCeiling: false } }));
    expect(rowOf(justBelow, OWNER)?.aiCost).toEqual({ kind: 'figure', costUsd: Number.MAX_SAFE_INTEGER / COST_SCALE, exact: true });
  });
});

// ── AC-142: the picked business ─────────────────────────────────────────────

describe('AC-142: buildAccountMargin uses the same functions as the tab row', () => {
  it('the owner: equal to the tab row for the same reads, and to 89.00 − X', () => {
    const tab = rowOf(buildAccountEconomics(input()), OWNER);
    const picked = buildAccountMargin({
      accountId: OWNER,
      coverage: 'after_cutover',
      aiCost: { units: units({ [OWNER]: 12_345_000_000 }), reachedCeiling: false },
      boosts: { rows: [boost()], reachedCeiling: false },
      plans: { rows: [invoice()], reachedCeiling: false },
      feeEstimate: STRIPE_FEE_ESTIMATE,
    });
    expect(picked).toEqual({ paid: tab?.paid, aiCost: tab?.aiCost, margin: tab?.margin, marginAfterFees: tab?.marginAfterFees });
    expect(picked.margin).toEqual({ kind: 'figure', marginUsd: 87.7655, noRevenue: false });
  });

  it('a failed boost read → Unknown; before the cut-over → not_available', () => {
    const base = { accountId: OWNER, coverage: 'after_cutover' as const, aiCost: { units: units({ [OWNER]: 1 }), reachedCeiling: false }, plans: { rows: [], reachedCeiling: false }, feeEstimate: STRIPE_FEE_ESTIMATE };
    expect(buildAccountMargin({ ...base, boosts: null }).margin).toEqual({ kind: 'unknown' });
    expect(buildAccountMargin({ ...base, coverage: 'starts_before_cutover', boosts: { rows: [], reachedCeiling: false } }).margin).toEqual({ kind: 'not_available' });
  });
});

// ── Slice 6b (§11K, AC-243 to AC-250, AC-252, E-72 to E-74, SA-W-6b-11) ─────
// The margin after ESTIMATED Stripe fees, beside the AI margin. Fees in minor
// units: 7900 → 259, 1000 → 59 at the default 290 bps + 30.
describe('slice 6b: margin after Stripe fees (estimate)', () => {
  const afterFeesOf = (built: ReturnType<typeof buildAccountEconomics>, id: string) => rowOf(built, id)?.marginAfterFees;
  const feesOf = (value: unknown) => (value as { feesUsd?: number } | undefined)?.feesUsd;
  const noPlans = { rows: [] as PlanPaymentInput[], reachedCeiling: false };

  it('AC-250 / AC-246: the owner in October (plan 7900 + boost 1000) has fees 259 + 59 = 318 (USD 3.18); the AI margin is unchanged', () => {
    const built = buildAccountEconomics(input());
    expect(marginOf(built, OWNER)).toEqual({ kind: 'figure', marginUsd: 87.7655, noRevenue: false });
    expect(afterFeesOf(built, OWNER)).toEqual({ kind: 'figure', afterFeesUsd: 84.5855, feesUsd: 3.18, currency: 'USD', noRevenue: false });
    // AC-246: margin after fees = AI margin − fees / 100 (check 19 minus check 27).
    expect(Math.round((87.7655 - 318 / 100) * 1e4) / 1e4).toBe(84.5855);
    expect(built.section.feeEstimate).toEqual({ currency: 'USD', percent: 2.9, fixed: 0.3 });
  });

  it('AC-243: fees are rounded per charge, then summed (two 1000 boosts = 118, not round(2000 × 2.9%) + 30 = 88)', () => {
    const built = buildAccountEconomics(input({ boosts: { rows: [boost(), boost()], reachedCeiling: false }, plans: noPlans }));
    expect(feesOf(afterFeesOf(built, OWNER))).toBe(1.18);
  });

  it('AC-243 / AC-245: a zero invoice is no charge, and a refused plan row (another kind) is no charge', () => {
    const built = buildAccountEconomics(
      input({
        boosts: { rows: [], reachedCeiling: false },
        plans: { rows: [invoice(), invoice({ amount_minor: 0 }), invoice({ kind: 'invoice_voided' })], reachedCeiling: false },
      })
    );
    expect(feesOf(afterFeesOf(built, OWNER))).toBe(2.59);
  });

  it('6B-R3 (E-72): a zero-total paid-family boost is no charge: fee 0, and the margin after fees equals the AI margin', () => {
    const built = buildAccountEconomics(input({ boosts: { rows: [boost({ amount_total_minor: 0 })], reachedCeiling: false }, plans: noPlans }));
    expect(marginOf(built, OWNER)).toEqual({ kind: 'figure', marginUsd: -1.2345, noRevenue: false });
    expect(afterFeesOf(built, OWNER)).toEqual({ kind: 'figure', afterFeesUsd: -1.2345, feesUsd: 0, currency: 'USD', noRevenue: false });
    expect(built.section.platform.marginAfterFees).toEqual({ kind: 'figure', afterFeesUsd: -1.2345, feesUsd: 0, currency: 'USD', noRevenue: false });
  });

  it('AC-245 / FE-5 / FE-6: refunded, partly refunded, disputed and lost boosts keep their fee on the gross; a boost outside the family has none', () => {
    const rows = [
      boost({ status: 'refunded' }),
      boost({ status: 'partially_refunded' }),
      boost({ status: 'disputed' }),
      boost({ status: 'dispute_lost' }),
      boost({ status: 'pending' }),
      boost({ status: 'failed' }),
    ];
    const built = buildAccountEconomics(input({ boosts: { rows, reachedCeiling: false }, plans: noPlans }));
    expect(marginOf(built, OWNER)?.kind).toBe('figure');
    expect(feesOf(afterFeesOf(built, OWNER))).toBe(2.36);
  });

  it('SA-W-6b-11: the fee stays on the charge: the same purchase refunded later carries the same fee as when it was only paid', () => {
    const paid = buildAccountEconomics(input({ boosts: { rows: [boost()], reachedCeiling: false }, plans: noPlans }));
    // Slice 4b.2: the refund is a dated event; the purchase keeps its fee.
    const refunded = buildAccountEconomics(
      input({ boosts: { rows: [boost({ status: 'refunded' })], reachedCeiling: false }, events: events([ev(1000)]), plans: noPlans })
    );
    expect(feesOf(afterFeesOf(paid, OWNER))).toBe(0.59);
    expect(feesOf(afterFeesOf(refunded, OWNER))).toBe(0.59);
    // The revenue moved with the refund; the fee did not.
    expect(marginOf(refunded, OWNER)).not.toEqual(marginOf(paid, OWNER));
  });

  it('AC-244: the config is data: 350 bps + 25 changes every fee (7900 → 302, 1000 → 60) with no code change', () => {
    const built = buildAccountEconomics(input({ feeEstimate: { USD: { percentBps: 350, fixedMinor: 25 } } }));
    expect(feesOf(afterFeesOf(built, OWNER))).toBe(3.62);
    expect(built.section.feeEstimate).toEqual({ currency: 'USD', percent: 3.5, fixed: 0.25 });
  });

  it.each([
    ['percentBps 1001', { USD: { percentBps: 1001, fixedMinor: 30 } }],
    ['a fraction', { USD: { percentBps: 2.9, fixedMinor: 30 } }],
    ['a negative', { USD: { percentBps: 290, fixedMinor: -1 } }],
    ['no USD entry', { EUR: { percentBps: 290, fixedMinor: 30 } }],
    ['null', null],
  ])('AC-244 / E-73: an invalid config (%s) makes every margin after fees Unknown and feeEstimate null; the AI margin and status are unchanged', (_name, config) => {
    const good = buildAccountEconomics(input());
    const bad = buildAccountEconomics(input({ feeEstimate: config }));
    expect(afterFeesOf(bad, OWNER)).toEqual({ kind: 'unknown' });
    expect(bad.section.platform.marginAfterFees).toEqual({ kind: 'unknown' });
    expect(bad.section.feeEstimate).toBeNull();
    expect(marginOf(bad, OWNER)).toEqual(marginOf(good, OWNER));
    expect(bad.section.status).toBe(good.section.status);
    expect(buildAccountMargin({ ...input({ feeEstimate: config }), accountId: OWNER }).marginAfterFees).toEqual({ kind: 'unknown' });
  });

  it('AC-247: the word states follow the AI margin (SA-W82), never 0', () => {
    const before = buildAccountEconomics(input({ coverage: 'starts_before_cutover' }));
    expect(afterFeesOf(before, OWNER)).toEqual({ kind: 'not_available' });
    expect(before.section.platform.marginAfterFees).toEqual({ kind: 'not_available' });
    const ils = buildAccountEconomics(input({ boosts: { rows: [boost(), boost({ currency: 'ILS' })], reachedCeiling: false } }));
    expect(afterFeesOf(ils, OWNER)).toEqual({ kind: 'other_currency' });
    const ilsAlone = buildAccountEconomics(input({ boosts: { rows: [boost({ currency: 'ILS' })], reachedCeiling: false }, plans: noPlans }));
    expect(afterFeesOf(ilsAlone, OWNER)).toEqual({ kind: 'other_currency' });
    expect(afterFeesOf(buildAccountEconomics(input({ boosts: null })), OWNER)).toEqual({ kind: 'unknown' });
    expect(afterFeesOf(buildAccountEconomics(input({ plans: { rows: [invoice()], reachedCeiling: true } })), OWNER)).toEqual({ kind: 'unknown' });
    expect(afterFeesOf(buildAccountEconomics(input({ boosts: { rows: [boost({ amount_total_minor: 'x' })], reachedCeiling: false } })), OWNER)).toEqual({
      kind: 'unknown',
    });
    const inexact = buildAccountEconomics(
      input({
        boosts: { rows: [boost({ status: 'partially_refunded', amount_tax_minor: 100 })], reachedCeiling: false },
        events: events([ev(300, {}, { amount_tax_minor: 100 })]),
      })
    );
    expect(afterFeesOf(inexact, OWNER)).toEqual({ kind: 'unknown' });
  });

  it('AC-248: an account with AI cost and no charge has fees 0 and a margin after fees equal to its AI margin, with the no-revenue flag', () => {
    const built = buildAccountEconomics(input({ aiCost: { units: units({ [OWNER]: 12_345_000_000, [B]: 5_000_000_000 }), reachedCeiling: false } }));
    expect(marginOf(built, B)).toEqual({ kind: 'figure', marginUsd: -0.5, noRevenue: true });
    expect(afterFeesOf(built, B)).toEqual({ kind: 'figure', afterFeesUsd: -0.5, feesUsd: 0, currency: 'USD', noRevenue: true });
  });

  it('AC-249: the platform line covers every account and the Deleted row, unchanged by any filter, sort or cap', () => {
    const base = {
      aiCost: { units: units({ [OWNER]: 12_345_000_000 }, bucket(3_000_000_000, 2)), reachedCeiling: false },
      boosts: { rows: [boost(), boost({ user_id: null })], reachedCeiling: false },
    };
    const all = buildAccountEconomics(input(base));
    // Plan 259 + two boosts 59 + 59 = 377; revenue 99.00, cost 1.2345 + 0.30 = 1.5345.
    expect(all.section.platform.marginAfterFees).toEqual({ kind: 'figure', afterFeesUsd: 93.6955, feesUsd: 3.77, currency: 'USD', noRevenue: false });
    const overs: Array<Partial<AccountEconomicsInput>> = [
      { cap: 1 },
      { query: { ...QUERY, sort: 'margin' } },
      { query: { ...QUERY, show: 'negative' } },
      { query: { ...QUERY, group: 'trial' } },
    ];
    for (const over of overs) {
      expect(buildAccountEconomics(input({ ...base, ...over })).section.platform.marginAfterFees).toEqual(all.section.platform.marginAfterFees);
    }
  });

  it('AC-252 / FE-15: sort and the negative filter read the AI margin, never the margin after fees', () => {
    // OWNER: one 1000 boost, cost 9.90, AI margin +0.10, after fees −0.49. B: one 5 boost, no cost, AI margin +0.05.
    const over: Partial<AccountEconomicsInput> = {
      aiCost: { units: units({ [OWNER]: 99_000_000_000, [B]: 0 }), reachedCeiling: false },
      boosts: { rows: [boost(), boost({ user_id: B, amount_total_minor: 5 })], reachedCeiling: false },
      plans: noPlans,
    };
    const sorted = buildAccountEconomics(input({ ...over, query: { ...QUERY, sort: 'margin' } }));
    expect(afterFeesOf(sorted, OWNER)).toEqual({ kind: 'figure', afterFeesUsd: -0.49, feesUsd: 0.59, currency: 'USD', noRevenue: false });
    // Lowest AI margin first: B (+0.05) before OWNER (+0.10), whatever the fees say.
    expect(sorted.section.rows.map((r) => r.accountId)).toEqual([B, OWNER]);
    const sortedBadConfig = buildAccountEconomics(input({ ...over, query: { ...QUERY, sort: 'margin' }, feeEstimate: null }));
    expect(sortedBadConfig.section.rows.map((r) => r.accountId)).toEqual([B, OWNER]);
    // "Negative AI margin": neither AI margin is negative, so no row, although OWNER's margin after fees is.
    expect(buildAccountEconomics(input({ ...over, query: { ...QUERY, show: 'negative' } })).section.rows).toEqual([]);
  });

  it('AC-250 (FE-14): buildAccountMargin gives the same margin after fees as the tab row', () => {
    const tab = rowOf(buildAccountEconomics(input()), OWNER);
    const picked = buildAccountMargin({ ...input(), accountId: OWNER });
    expect(picked.marginAfterFees).toEqual(tab?.marginAfterFees);
    expect(feesOf(picked.marginAfterFees)).toBe(3.18);
  });
});
