/**
 * Money MK-9: F-K5's breakdown (S5B-FR-8 to FR-16; SA-WP-MK9, MK9-R1 to R4).
 * The pure rules, the trial end after a tier (SA-Q114), the rate floor as data
 * (SA-Q116), and the parity with the Subscriptions list (S5B-FR-10, MK9-R4).
 */

import * as fs from 'fs';
import * as path from 'path';

import type { AdminBillingRow } from '@/lib/repositories/BusinessOsBillingAdminReadRepository';
import { getEntitlementConfig } from '@/lib/business-os/entitlements/source';
import { stateForCohort } from '@/lib/business-os/entitlements/lifecycle';
import { isPayingBillingRow } from '@/lib/business-os/billing/payingSubscriptionStatuses';
import { buildSubscriptions } from '@/lib/admin/billing/subscriptionsView';
import { compedSplit, trialsToPaid, type BreakdownStatusRow } from '../payingBreakdown';
import { classifyAccounts, isTrialRow, trialEndOf } from '../planGroups';
// The plan row type, through the function that takes it (RC-15: only the repository layer names the plan repository).
type BusinessOsAccountPlan = Parameters<typeof trialEndOf>[0];
import { FINANCE_TRIAL_TO_PAID } from '../financeRules';
import type { FinanceGroupKey } from '../financeTypes';

const config = getEntitlementConfig();
const TIER = config.tierOrder[0];
const TRIAL = Object.keys(config.cohorts).find((id) => stateForCohort(id) === 'trial') as string;
const NOW = new Date('2026-10-20T12:00:00.000Z');
const WINDOW = { start: new Date('2026-10-01T00:00:00.000Z'), end: new Date('2026-10-21T00:00:00.000Z') };
const id = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`;

function plan(n: number, extra: Partial<BusinessOsAccountPlan> = {}): BusinessOsAccountPlan {
  return {
    user_id: id(n), tier: null, plan_version: 1, tier_expires_at: null, cohort: null, cohort_expires_at: null,
    onboarding_started_at: '2026-09-01T00:00:00Z', profile_created_at: '2026-09-01T00:00:00Z', trial_started_at: null,
    trial_ends_at: null, grace_ends_at: null, period_anchor: '2026-09-01T00:00:00Z', origin: 'trigger', updated_by_admin_id: null,
    created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
    ...extra,
  };
}
const status = (n: number, subscription_status: string | null, ended_at: string | null = null): BreakdownStatusRow => ({
  user_id: id(n),
  subscription_status,
  ended_at,
});

describe('compedSplit (BQ-22, MK9-R4)', () => {
  const groups = (entries: Array<[number, FinanceGroupKey]>) => new Map(entries.map(([n, g]) => [id(n), g]));

  it('every comped account lands in exactly one part, and the two add up to Comped; other groups are ignored', () => {
    const split = compedSplit({
      groupByAccount: groups([
        [1, 'comped'], // no row at all
        [2, 'comped'], // a row with no status (never subscribed): assigned
        [3, 'comped'], // canceled
        [4, 'comped'], // unpaid
        [5, 'comped'], // an ended paying-status row (lapsed payer in grace)
        [6, 'comped'], // trialing
        [7, `tier:${TIER}`],
        [8, 'trial'],
      ]),
      statusRows: [
        status(2, null),
        status(3, 'canceled'),
        status(4, 'unpaid'),
        status(5, 'active', '2026-10-10T00:00:00.000Z'),
        status(6, 'trialing'),
        status(7, 'active'),
      ],
      isPaying: isPayingBillingRow,
    });
    expect(split).toEqual({ total: 6, assignedNoSubscription: 2, endedOrNotPaying: 4 });
    expect(split!.assignedNoSubscription + split!.endedOrNotPaying).toBe(split!.total);
  });

  it('a lapsed payer in grace (ended subscription, plan still in force) is "ended or not paying", never assigned', () => {
    const split = compedSplit({
      groupByAccount: groups([[5, 'comped']]),
      statusRows: [status(5, 'active', '2026-10-10T00:00:00.000Z')],
      isPaying: isPayingBillingRow,
    });
    expect(split).toEqual({ total: 1, assignedNoSubscription: 0, endedOrNotPaying: 1 });
  });

  it('failure path: the paying read failed → null (Could not check), never 0', () => {
    expect(compedSplit({ groupByAccount: groups([[1, 'comped']]), statusRows: null, isPaying: isPayingBillingRow })).toBeNull();
  });
});

describe('trialsToPaid (BQ-23, MK9-R1)', () => {
  const trial = (n: number, endsAt: string | null) => ({ accountId: id(n), endsAt });
  const run = (
    trials: Array<{ accountId: string; endsAt: string | null }> | null,
    firstPayments: Array<{ accountId: string; paidAt: string }> | null,
    extra: { capped?: boolean; minimumTrials?: number } = {}
  ) =>
    trialsToPaid({
      trials,
      capped: extra.capped ?? false,
      firstPayments,
      window: WINDOW,
      now: NOW,
      minimumTrials: extra.minimumTrials ?? FINANCE_TRIAL_TO_PAID.minimumTrials,
    });

  it('the window bounds are UTC and half-open; paid is any time up to now; "before" is strictly before the end', () => {
    const result = run(
      [
        trial(1, '2026-10-01T00:00:00.000Z'), // on the start: in
        trial(2, '2026-09-30T23:59:59.999Z'), // before the start: out
        trial(3, '2026-10-21T00:00:00.000Z'), // on the end: out (and still running: after now)
        trial(4, '2026-10-10T00:00:00.000Z'), // in, paid before
        trial(5, '2026-10-10T00:00:00.000Z'), // in, paid exactly at the end: not "before"
        trial(6, '2026-10-12T00:00:00.000Z'), // in, paid after
        trial(7, '2026-11-15T00:00:00.000Z'), // still running
        trial(8, null), // clock never started: neither
      ],
      [
        { accountId: id(4), paidAt: '2026-10-05T00:00:00.000Z' },
        { accountId: id(5), paidAt: '2026-10-10T00:00:00.000Z' },
        { accountId: id(6), paidAt: '2026-10-19T00:00:00.000Z' },
        { accountId: id(7), paidAt: '2026-10-02T00:00:00.000Z' }, // a running trial that paid: not in the base
      ]
    );
    expect(result).toEqual({
      status: 'ok',
      endedInWindow: 4,
      stillRunning: 2,
      paid: 3,
      paidBeforeEnd: 1,
      rate: null,
      minimumForRate: 10,
    });
  });

  it('SA-CR-MK9 C-1: a trial ending later today (inside a preset window that ends at the next UTC midnight) is running, not ended; never both', () => {
    // NOW is 2026-10-20T12:00Z; the window ends 2026-10-21T00:00Z.
    const result = run(
      [trial(1, '2026-10-20T18:00:00.000Z'), trial(2, '2026-10-20T11:00:00.000Z'), trial(3, '2026-10-20T12:00:00.000Z')],
      [{ accountId: id(1), paidAt: '2026-10-19T00:00:00.000Z' }]
    );
    // 1 ends after now: running only. 2 ended before now: ended. 3 ends exactly now: ended (not running).
    expect(result).toEqual(expect.objectContaining({ endedInWindow: 2, stillRunning: 1, paid: 0, paidBeforeEnd: 0 }));
  });

  it('the rate: none at 9 trials ended, shown at 10; the floor is data (a planted 5 changes it)', () => {
    const ended = (count: number) => Array.from({ length: count }, (_, i) => trial(i + 1, '2026-10-10T00:00:00.000Z'));
    const paidFirst = [{ accountId: id(1), paidAt: '2026-10-05T00:00:00.000Z' }];
    expect(run(ended(9), paidFirst).rate).toBeNull();
    expect(run(ended(10), paidFirst).rate).toEqual({ paid: 1, base: 10, percent: 10 });
    expect(FINANCE_TRIAL_TO_PAID.minimumTrials).toBe(10);
    expect(run(ended(5), paidFirst, { minimumTrials: 5 }).rate).toEqual({ paid: 1, base: 5, percent: 20 });
  });

  it('failure path: the first-payment result is missing → Paid and Paid before are Unknown (null), never 0; the rest renders', () => {
    const result = run([trial(1, '2026-10-10T00:00:00.000Z'), trial(2, '2026-11-15T00:00:00.000Z')], null);
    expect(result).toEqual(expect.objectContaining({ status: 'ok', endedInWindow: 1, stillRunning: 1, paid: null, paidBeforeEnd: null, rate: null }));
  });

  it('a cut walk is "partial" with no rate; a failed walk is unknown', () => {
    const many = Array.from({ length: 12 }, (_, i) => trial(i + 1, '2026-10-10T00:00:00.000Z'));
    expect(run(many, [], { capped: true })).toEqual(expect.objectContaining({ status: 'partial', endedInWindow: 12, rate: null }));
    expect(run(null, [])).toEqual(expect.objectContaining({ status: 'unknown', endedInWindow: null, paid: null }));
  });
});

describe('isTrialRow and trialEndOf (CF-6, SA-Q114)', () => {
  it('a trial row is known by its cohort; the end honours pins, also after a tier is in force', () => {
    const row = plan(1, { cohort: TRIAL, trial_started_at: '2026-09-20T00:00:00.000Z', trial_ends_at: '2026-10-04T00:00:00.000Z' });
    expect(isTrialRow(row)).toBe(true);
    expect(isTrialRow(plan(2))).toBe(false);
    expect(trialEndOf(row, config, NOW)).toBe('2026-10-04T00:00:00.000Z');
    // After it paid: a tier is in force, and the trial's end is still found.
    const paidRow = { ...row, tier: TIER, tier_expires_at: '2026-11-04T00:00:00.000Z' };
    expect(trialEndOf(paidRow, config, NOW)).toBe('2026-10-04T00:00:00.000Z');
  });

  it('without a pinned end, the end comes from the cohort duration from the pinned start', () => {
    const row = plan(3, { cohort: TRIAL, trial_started_at: '2026-10-01T00:00:00.000Z' });
    const end = trialEndOf(row, config, NOW);
    expect(end).not.toBeNull();
    expect(Date.parse(end as string)).toBeGreaterThan(Date.parse('2026-10-01T00:00:00.000Z'));
  });
});

describe('parity with the Subscriptions list (S5B-FR-10, MK9-R4)', () => {
  const billing = (n: number, patch: Partial<AdminBillingRow> = {}): AdminBillingRow => ({
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    user_id: id(n),
    livemode: false,
    subscription_status: 'active',
    bought_tier: TIER,
    current_period_end: '2026-11-10T00:00:00.000Z',
    cancel_at_period_end: false,
    pending_tier: null,
    last_paid_at: '2026-10-10T00:00:00.000Z',
    last_payment_failed_at: null,
    failed_attempts: 0,
    founder_discount_applied_at: null,
    ended_at: null,
    ...patch,
  });

  it('"Assigned, no subscription" equals the list’s No Stripe rows with a tier in force; the tier groups equal the paying rows', () => {
    const inForce = '2026-12-01T00:00:00.000Z';
    const planRows = [
      plan(1, { tier: TIER, tier_expires_at: inForce }), // paying
      plan(2, { tier: TIER, tier_expires_at: inForce }), // assigned (no billing row)
      plan(3, { tier: TIER, tier_expires_at: inForce }), // assigned (a row with no status: not billed, MK-8 isBilled)
      plan(4, { tier: TIER, tier_expires_at: inForce }), // canceled: ended or not paying
      plan(5, { tier: TIER, tier_expires_at: inForce }), // past due: paying
    ];
    const billingRows = [
      billing(1),
      billing(3, { subscription_status: null }),
      billing(4, { subscription_status: 'canceled', ended_at: '2026-10-15T00:00:00.000Z' }),
      billing(5, { subscription_status: 'past_due' }),
    ];
    // The finance side sees the same rows as status rows (the R4 adapter's shape).
    const statusRows = billingRows.map((b) => ({ user_id: b.user_id as string, subscription_status: b.subscription_status, ended_at: b.ended_at, bought_tier: b.bought_tier }));
    const payingIds = new Set(statusRows.filter(isPayingBillingRow).map((r) => r.user_id));
    const classified = classifyAccounts({ rows: planRows, payingIds, paidTierHints: new Map(), window: WINDOW, now: NOW, config });
    const split = compedSplit({ groupByAccount: classified.groupByAccount, statusRows, isPaying: isPayingBillingRow });

    const list = buildSubscriptions({ billingRows, planRows, config, now: NOW, mode: 'test', status: null });
    const noStripeInForce = list.rows.filter((r) => r.status === 'no_stripe' && r.planOnRecord !== null).length;
    expect(split?.assignedNoSubscription).toBe(noStripeInForce);
    expect(split?.assignedNoSubscription).toBe(2);
    const tierTotal = classified.figures.groups.filter((g) => g.key.startsWith('tier:')).reduce((s, g) => s + g.count, 0);
    expect(tierTotal).toBe(payingIds.size);
    expect(split).toEqual({ total: 3, assignedNoSubscription: 2, endedOrNotPaying: 1 });
  });
});

describe('source (MK9-R3)', () => {
  const code = fs
    .readFileSync(path.join(__dirname, '..', 'payingBreakdown.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  const MODE = /livemode|test.?mode|live.?mode|stripe/i;
  const REPO = /from\s+['"][^'"]*(repositories|supabase|server-only)[^'"]*['"]/;

  it('names no billing mode and imports no repository (planted controls bite)', () => {
    expect(code).not.toMatch(MODE);
    expect(code).not.toMatch(REPO);
    expect(MODE.test("const x = row.livemode;")).toBe(true);
    expect(REPO.test("import { x } from '@/lib/repositories/BusinessOsBillingAdminReadRepository';")).toBe(true);
  });

  it('no cohort literal: trials are known through stateForCohort only', () => {
    const groups = fs.readFileSync(path.join(__dirname, '..', 'planGroups.ts'), 'utf8');
    expect(groups).toMatch(/stateForCohort\(row\.cohort\) === 'trial'/);
    expect(code).not.toMatch(/cohort/);
  });
});
