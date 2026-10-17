/**
 * @jest-environment jsdom
 *
 * Money M-1 (T12): the account header (E-35) and the account summary
 * (M1-FR-5, M1-FR-6), rendered from section fixtures.
 *
 *   - AC-110: the header's name, group (with the Founding Partner chip) and
 *     Paying / Not paying / Unknown; the summary's charged AI cost, boost net
 *     per currency, the plan line, credits and group; "Unknown" on a failed
 *     part, "At least" on a partial one.
 *   - AC-112: two boost currencies are two lines and never a total.
 *   - AC-113: the links carry the id and the window, never a name.
 *
 * The "equals the same figure in its section on one render" half is in
 * financePage.render.test.tsx, where the whole page renders.
 *
 * Money M-2 (AC-122, M2-FR-6, S5-F7): the M-1 placeholder assertion is
 * replaced by "Paid us: plan" per currency and "Paid us, total" from the
 * server's per-currency totals; the refund-timing note on the boosts line
 * under the panel's own condition.
 */

import '@testing-library/jest-dom';
import { cleanup, render, screen, within } from '@testing-library/react';

import type {
  FinanceAccountsSection,
  FinanceAiCostSection,
  FinanceBoostLine,
  FinanceBoostRevenue,
  FinanceCreditRow,
  FinanceCreditsSection,
  FinanceGroupKey,
  FinancePlanRevenue,
  FinanceRevenueSection,
  FinanceWindowInfo,
} from '@/lib/business-os/finance/financeTypes';
import { AccountHeader } from '../components/AccountHeader';
import { AccountSummary } from '../components/AccountSummary';
import {
  ACCOUNT_CUTOVER_ENTIRELY,
  ACCOUNT_CUTOVER_NOTE,
  ACCOUNT_NONE_IN_WINDOW,
  ACCOUNT_PAYING_TEXT,
  ACCOUNT_PAID_TOTAL,
  ACCOUNT_SCOPE_NOTE,
  ACCOUNTS_FOUNDING_CHIP,
  CREDITS_NO_ALLOWANCE,
  NAME_PLATFORM,
  REVENUE_CUT_OFF,
  REVENUE_REFUND_TIMING_NOTE,
} from '../financeCopy';
import { activityHref, analyticsHref, businessesHref, costsHref } from '../financeLinks';

const A = '11111111-1111-4111-8111-111111111111';
const WINDOW: FinanceWindowInfo = { preset: 'this_month', from: '2026-10-01', to: '2026-10-14', start: '2026-10-01T00:00:00.000Z', end: '2026-10-15T00:00:00.000Z' };

function accounts(key: FinanceGroupKey | null, foundingPartners = 0, status: FinanceAccountsSection['status'] = 'ok'): FinanceAccountsSection {
  if (status === 'unknown') return { status, scope: 'one', figures: null };
  const keys: FinanceGroupKey[] = ['trial', 'founding_partner', 'comped', 'tier:x', 'unknown_held'];
  return {
    status,
    scope: 'one',
    figures: {
      total: key ? 1 : 0,
      groups: keys.map((k) => ({
        key: k,
        tierLabel: k === 'tier:x' ? 'Essentials-ish' : null,
        count: k === key ? 1 : 0,
        grace: 0,
        pastDue: 0,
        foundingPartners: k === key ? foundingPartners : 0,
      })),
      payingKnown: true,
      byState: {},
      foundingNoEndDate: 0,
      dormantFounding: 0,
      newInWindow: { total: 0, byOrigin: [] },
      endingIn30Days: 0,
    },
  };
}

function aiCost(extra: Partial<FinanceAiCostSection> = {}, exact = true): FinanceAiCostSection {
  return {
    status: 'ok',
    coverage: 'after_cutover',
    figures: {
      exact, costUsd: 3.5, credits: 120, chargedActions: 10, rows: 11, byTrigger: [],
      byGroup: { status: 'ok', lines: [] }, topAccounts: [], deleted: { costUsd: 0, credits: 0, rows: 0 },
      unreadableAmounts: 0, unresolvedAdjustments: 0,
    },
    ...extra,
  };
}

const boostLine = (extra: Partial<FinanceBoostLine> = {}): FinanceBoostLine => ({
  currency: 'USD', purchases: 1, gross: 10, tax: 0, refunded: 0, held: 0, lost: 0, net: 10, creditsSold: 5000, unreadable: 0, unreadableCredits: 0, ...extra,
});

function boosts(lines: FinanceBoostLine[] | null, notes: Partial<NonNullable<FinanceBoostRevenue['notes']>> = {}): FinanceBoostRevenue {
  if (lines === null) return { status: 'unknown', scope: 'one', lines: null, packages: null, deletedAccounts: null, notes: null };
  return {
    status: 'ok',
    scope: 'one',
    lines,
    packages: [],
    deletedAccounts: null,
    notes: { empty: lines.length === 0, exact: true, otherStatusPurchases: 0, unreadablePurchases: 0, refundOrDispute: false, ...notes },
  };
}

const creditRow = (extra: Partial<FinanceCreditRow> = {}): FinanceCreditRow => ({
  accountId: A, name: 'Acme', nameStatus: 'found', group: 'tier:x', tierLabel: 'Essentials-ish', kind: 'position',
  allowance: 100, used: 40, usedTenths: 400, trial: false, overAllowance: false, farOverAllowance: false, giftedOutstanding: 12.5, ...extra,
});

function credits(row: FinanceCreditRow | null, status: FinanceCreditsSection['status'] = 'ok'): FinanceCreditsSection {
  if (status === 'unknown') return { status, scope: 'one', farOverAllowancePercent: 150, figures: null, gifted: null } as FinanceCreditsSection;
  return {
    status,
    scope: 'one',
    farOverAllowancePercent: 150,
    figures: { accounts: 1, overAllowance: 0, farOverAllowance: 0, unknownAccounts: 0, noAllowanceAccounts: 0, rows: row ? [row] : [] },
    gifted: null,
  } as FinanceCreditsSection;
}

/** The owner's October plan payment: USD 79.00, exact. */
function plans(extra: Partial<FinancePlanRevenue> = {}): FinancePlanRevenue {
  return {
    status: 'ok',
    scope: 'one',
    lines: [{ currency: 'USD', payments: 1, received: 79, tax: 0, businesses: 1, zeroAmountInvoices: 0, unreadable: 0, exact: true }],
    accounts: null,
    accountsTotal: null,
    payments: [],
    paymentsTotal: 1,
    deletedAccounts: null,
    notes: { empty: false, exact: true, zeroAmountInvoices: 0, unreadable: 0, otherKind: 0 },
    ...extra,
  };
}

function revenue(b: FinanceBoostRevenue, p: FinancePlanRevenue = plans(), totals: FinanceRevenueSection['totals'] = [
  { currency: 'USD', boostsNet: 10, plansReceived: 79, total: 89 },
]): FinanceRevenueSection {
  return { status: 'ok', state: 'recorded', plans: p, boosts: b, totals };
}

function renderSummary(parts: Partial<{ ai: FinanceAiCostSection; b: FinanceBoostRevenue; p: FinancePlanRevenue; t: FinanceRevenueSection['totals']; c: FinanceCreditsSection; acc: FinanceAccountsSection }> = {}) {
  render(
    <AccountSummary
      accountId={A}
      window={WINDOW}
      aiCost={parts.ai ?? aiCost()}
      revenue={revenue(parts.b ?? boosts([boostLine()]), parts.p ?? plans(), parts.t === undefined ? undefined : parts.t)}
      credits={parts.c ?? credits(creditRow())}
      accounts={parts.acc ?? accounts('tier:x')}
    />
  );
  return screen.getByTestId('account-summary');
}

describe('AccountHeader (E-35)', () => {
  it('the name, the plan group with the Founding Partner chip, "Paying" (neutral), and the scope sentence', () => {
    render(<AccountHeader accountId={A} name={{ name: 'Acme Dental', platform: false }} accounts={accounts('tier:x', 1)} />);
    expect(screen.getByTestId('account-header-name')).toHaveTextContent('Acme Dental');
    expect(screen.getByTestId('account-header-name')).toHaveAttribute('title', A);
    expect(screen.getByTestId('account-header-group')).toHaveTextContent('Essentials-ish');
    expect(screen.getByTestId('account-header-group-founding')).toHaveTextContent(ACCOUNTS_FOUNDING_CHIP);
    const paying = screen.getByTestId('account-header-paying');
    expect(paying).toHaveTextContent(ACCOUNT_PAYING_TEXT.paying);
    expect(paying.className).not.toMatch(/emerald|green/);
    expect(screen.getByTestId('account-scope-note')).toHaveTextContent(ACCOUNT_SCOPE_NOTE);
  });

  it.each([
    ['trial', ACCOUNT_PAYING_TEXT.not_paying],
    ['founding_partner', ACCOUNT_PAYING_TEXT.not_paying],
    ['comped', ACCOUNT_PAYING_TEXT.not_paying],
    ['unknown_held', ACCOUNT_PAYING_TEXT.not_paying],
  ] as const)('group %s → "%s"', (key, text) => {
    render(<AccountHeader accountId={A} name={{ name: 'Acme', platform: false }} accounts={accounts(key)} />);
    expect(screen.getByTestId('account-header-paying')).toHaveTextContent(text);
    expect(screen.queryByTestId('account-header-group-founding')).toBeNull();
  });

  it('Section 1 could not load → group and paying state "Unknown"; no name → the short id; platform → labelled', () => {
    const { unmount } = render(<AccountHeader accountId={A} name={{ name: null, platform: false }} accounts={accounts(null, 0, 'unknown')} />);
    expect(screen.getByTestId('account-header-name')).toHaveTextContent('11111111…');
    expect(screen.getByTestId('account-header-group')).toHaveTextContent('Unknown');
    expect(screen.getByTestId('account-header-paying')).toHaveTextContent(ACCOUNT_PAYING_TEXT.unknown);
    unmount();
    render(<AccountHeader accountId={A} name={{ name: null, platform: true }} accounts={accounts('tier:x')} />);
    expect(screen.getByTestId('account-header-name')).toHaveTextContent(NAME_PLATFORM);
  });
});

describe('AccountSummary (M1-FR-5, M1-FR-6)', () => {
  it('AC-110: charged AI cost, boost net, the M-1 plan placeholder, credits and group; one landmark', () => {
    const summary = renderSummary();
    expect(summary.tagName).toBe('SECTION');
    expect(summary).toHaveAttribute('aria-labelledby', 'account-summary-heading');
    expect(within(summary).queryAllByRole('navigation')).toHaveLength(0);
    expect(screen.getByTestId('account-summary-ai-cost')).toHaveTextContent('USD 3.50');
    expect(screen.getByTestId('account-summary-boost-USD')).toHaveTextContent('USD 10.00');
    // M-2 (the M-1 placeholder assertion replaced): the plan line and the total, USD 79.00 and USD 89.00.
    expect(screen.getByTestId('account-summary-plan-USD')).toHaveTextContent('USD 79.00');
    expect(screen.getByTestId('account-summary-total-USD')).toHaveTextContent('USD 89.00');
    expect(screen.getByText(ACCOUNT_PAID_TOTAL)).toBeInTheDocument();
    expect(screen.getByTestId('account-summary-credits')).toHaveTextContent('Allowance 100 · used 40 (40.0%) · gifted outstanding 12.5');
    expect(screen.getByTestId('account-summary-group')).toHaveTextContent('Essentials-ish');
  });

  it('AI cost: partial → "At least"; failed → "Unknown"; starts before cut-over → the note; entirely before → the note instead of a figure', () => {
    let summary = renderSummary({ ai: aiCost({ status: 'partial' }, false) });
    expect(within(summary).getByTestId('account-summary-ai-cost')).toHaveTextContent('At least USD 3.50');
    cleanup();
    summary = renderSummary({ ai: { status: 'unknown', coverage: 'after_cutover', figures: null } });
    expect(within(summary).getByTestId('account-summary-ai-cost')).toHaveTextContent('Unknown');
    cleanup();
    summary = renderSummary({ ai: aiCost({ coverage: 'starts_before_cutover' }) });
    expect(within(summary).getByTestId('account-summary-ai-cost')).toHaveTextContent(`USD 3.50${ACCOUNT_CUTOVER_NOTE}`);
    cleanup();
    summary = renderSummary({ ai: aiCost({ coverage: 'entirely_before_cutover' }) });
    const line = within(summary).getByTestId('account-summary-ai-cost');
    expect(line).toHaveTextContent(ACCOUNT_CUTOVER_ENTIRELY);
    expect(line.textContent).not.toMatch(/USD|0\.00/);
  });

  it('AC-112: two boost currencies are two lines, never a total', () => {
    const summary = renderSummary({ b: boosts([boostLine({ currency: 'EUR', net: 7.5 }), boostLine()]) });
    expect(within(summary).getByTestId('account-summary-boost-EUR')).toHaveTextContent('EUR 7.50');
    expect(within(summary).getByTestId('account-summary-boost-USD')).toHaveTextContent('USD 10.00');
    expect(within(summary).getByTestId('account-summary-boosts').textContent).not.toMatch(/17\.50/);
  });

  it('boosts: failed → "Unknown"; empty → "None in this window"; net cut off → the panel text', () => {
    let summary = renderSummary({ b: boosts(null) });
    expect(within(summary).getByTestId('account-summary-boosts')).toHaveTextContent('Unknown');
    cleanup();
    summary = renderSummary({ b: boosts([]) });
    expect(within(summary).getByTestId('account-summary-boosts')).toHaveTextContent(ACCOUNT_NONE_IN_WINDOW);
    expect(within(summary).getByTestId('account-summary-boosts').textContent).not.toMatch(/0\.00/);
    cleanup();
    summary = renderSummary({ b: boosts([boostLine({ net: null })], { exact: false }) });
    expect(within(summary).getByTestId('account-summary-boost-USD')).toHaveTextContent(REVENUE_CUT_OFF);
  });

  it('credits: no allowance, unknown kind, no row, a failed section, gifted unknown', () => {
    let summary = renderSummary({ c: credits(creditRow({ kind: 'no_allowance', allowance: null, used: null, usedTenths: null })) });
    expect(within(summary).getByTestId('account-summary-credits')).toHaveTextContent(`${CREDITS_NO_ALLOWANCE} · gifted outstanding 12.5`);
    for (const c of [credits(creditRow({ kind: 'unknown' })), credits(null), credits(null, 'unknown')]) {
      cleanup();
      summary = renderSummary({ c });
      expect(within(summary).getByTestId('account-summary-credits')).toHaveTextContent('Unknown');
    }
    cleanup();
    summary = renderSummary({ c: credits(creditRow({ giftedOutstanding: null })) });
    expect(within(summary).getByTestId('account-summary-credits')).toHaveTextContent('gifted outstanding Unknown');
  });

  it('AC-113: the four links carry this id and the window, never a name', () => {
    const summary = renderSummary();
    const hrefs = within(summary).getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([activityHref(A, WINDOW), costsHref(A, WINDOW), analyticsHref(A, WINDOW), businessesHref(A)]);
    for (const href of hrefs) {
      expect(href).toContain(A);
      expect(href).not.toMatch(/Acme/);
    }
  });

  it('M2-FR-6: plan line states — failed "Unknown", empty "None in this window" (no 0.00), cut off "At least"', () => {
    let summary = renderSummary({ p: plans({ status: 'unknown', lines: null, notes: null }) });
    expect(within(summary).getByTestId('account-summary-plan')).toHaveTextContent('Unknown');
    cleanup();
    summary = renderSummary({ p: plans({ lines: [], notes: { empty: true, exact: true, zeroAmountInvoices: 0, unreadable: 0, otherKind: 0 } }) });
    expect(within(summary).getByTestId('account-summary-plan')).toHaveTextContent(ACCOUNT_NONE_IN_WINDOW);
    expect(within(summary).getByTestId('account-summary-plan').textContent).not.toMatch(/0\.00/);
    cleanup();
    summary = renderSummary({ p: plans({ lines: [{ currency: 'USD', payments: 1, received: 79, tax: 0, businesses: 1, zeroAmountInvoices: 0, unreadable: 0, exact: false }] }) });
    expect(within(summary).getByTestId('account-summary-plan-USD')).toHaveTextContent('At least USD 79.00');
  });

  it('AC-122: "Paid us, total" per currency from the server totals; Unknown where a total is null or a read failed; never across currencies', () => {
    let summary = renderSummary({ t: [{ currency: 'EUR', boostsNet: 0, plansReceived: 25, total: 25 }, { currency: 'USD', boostsNet: 10, plansReceived: 79, total: null }] });
    expect(within(summary).getByTestId('account-summary-total-EUR')).toHaveTextContent('EUR 25.00');
    expect(within(summary).getByTestId('account-summary-total-USD')).toHaveTextContent('Unknown');
    expect(within(summary).getByTestId('account-summary-total').textContent).not.toMatch(/104|114/);
    cleanup();
    summary = renderSummary({ t: null });
    expect(within(summary).getByTestId('account-summary-total')).toHaveTextContent('Unknown');
    cleanup();
    summary = renderSummary({ t: [] });
    expect(within(summary).getByTestId('account-summary-total')).toHaveTextContent(ACCOUNT_NONE_IN_WINDOW);
  });

  it('S5-F7 (SA-WR-38): the refund-timing note shows on the boosts line exactly when the panel shows it', () => {
    let summary = renderSummary({ b: boosts([boostLine({ refunded: 5, net: 5 })], { refundOrDispute: true }) });
    expect(within(summary).getByTestId('account-summary-refund-note')).toHaveTextContent(REVENUE_REFUND_TIMING_NOTE);
    cleanup();
    summary = renderSummary();
    expect(within(summary).queryByTestId('account-summary-refund-note')).toBeNull();
  });
});

// ── Slice 6a (Money M-3, M3-FR-8, AC-142 render half; SA-WR-43) ─────────────
// A separate import, so the lines above stay unedited.
import type { FinanceAccountMargin } from '@/lib/business-os/finance/financeTypes';
import { ACCOUNT_MARGIN, ACCOUNT_UNKNOWN, ECON_MARGIN_NOT_AVAILABLE, ECON_MARGIN_OTHER_CURRENCY, ECON_NO_REVENUE } from '../financeCopy';

describe('slice 6a: the summary’s AI margin line (M3-FR-8)', () => {
  const margin = (m: FinanceAccountMargin['margin']): FinanceAccountMargin => ({
    paid: { failed: false, lines: [] },
    aiCost: { kind: 'figure', costUsd: 1.2345, exact: true },
    margin: m,
    // Slice 6b: the margin after fees follows the AI margin's word; a figure with no fees here.
    marginAfterFees: m.kind === 'figure' ? { kind: 'figure', afterFeesUsd: m.marginUsd, feesUsd: 0, currency: 'USD', noRevenue: m.noRevenue } : m,
  });
  const renderWith = (accountMargin: FinanceAccountMargin | null) => {
    cleanup();
    render(
      <AccountSummary
        accountId={A}
        window={WINDOW}
        aiCost={aiCost()}
        revenue={revenue(boosts([boostLine()]))}
        credits={credits(creditRow())}
        accounts={accounts('tier:x')}
        accountMargin={accountMargin}
      />
    );
    return screen.getByTestId('account-summary-margin');
  };

  it('sits directly under "Paid us, total", labelled "AI margin (USD)", the figure through formatUsd', () => {
    const line = renderWith(margin({ kind: 'figure', marginUsd: 87.7655, noRevenue: false }));
    expect(line).toHaveTextContent('USD 87.7655');
    const labels = [...screen.getByTestId('account-summary').querySelectorAll('dt')].map((dt) => dt.textContent);
    expect(labels[labels.indexOf(ACCOUNT_PAID_TOTAL) + 1]).toBe(ACCOUNT_MARGIN);
    expect(ACCOUNT_MARGIN).toBe('AI margin (USD)');
  });

  it('SA-WR-43: a negative margin keeps its sign; no revenue says so', () => {
    const line = renderWith(margin({ kind: 'figure', marginUsd: -0.1234, noRevenue: true }));
    expect(within(line).getByTestId('account-summary-margin-value')).toHaveTextContent('USD -0.1234');
    expect(line).toHaveTextContent(ECON_NO_REVENUE);
  });

  it.each([
    [{ kind: 'not_available' } as const, ECON_MARGIN_NOT_AVAILABLE],
    [{ kind: 'other_currency' } as const, ECON_MARGIN_OTHER_CURRENCY],
    [{ kind: 'unknown' } as const, ACCOUNT_UNKNOWN],
  ])('%o → its words, never a 0', (m, text) => {
    const line = renderWith(margin(m));
    expect(line).toHaveTextContent(text);
    expect(line.textContent).not.toMatch(/0\.00/);
  });

  it('no accountMargin in the payload → "Unknown"', () => {
    expect(renderWith(null)).toHaveTextContent(ACCOUNT_UNKNOWN);
  });
});

// ── Money M-4 (OV-5, M4-FR-2, T11-B): the summary's "Recorded above charged" line ──
// A separate import, so the lines above stay unedited.
import type { FinanceRecordedAiCost } from '@/lib/business-os/finance/financeTypes';
import { RecordedAboveValue } from '../components/RecordedCostLines';
import { ABOVE_NONE, ABOVE_NOT_AVAILABLE, ACCOUNT_AI_COST, ACCOUNT_RECORDED_ABOVE, aboveChargedAboveLine, RECORDED_LABEL, RECORDED_UNKNOWN } from '../financeCopy';

describe('Money M-4: the summary’s "Recorded above charged" line (M4-FR-2)', () => {
  const rec = (extra: Partial<FinanceRecordedAiCost> = {}): FinanceRecordedAiCost => ({
    status: 'ok', recordedUsd: 3.75, recordedExact: true, aboveCharged: { state: 'figure', usd: 0.25 }, chargedAboveUsd: null, ...extra,
  });
  const renderWith = (recorded: FinanceRecordedAiCost | undefined) => {
    cleanup();
    return renderSummary({ ai: aiCost({ recorded }) });
  };

  it('sits directly under "Charged AI cost"; the value, and never the recorded figure itself', () => {
    const summary = renderWith(rec());
    const labels = [...summary.querySelectorAll('dt')].map((dt) => dt.textContent);
    expect(labels[labels.indexOf(ACCOUNT_AI_COST) + 1]).toBe(ACCOUNT_RECORDED_ABOVE);
    expect(ACCOUNT_RECORDED_ABOVE).toBe('Recorded above charged');
    expect(within(summary).getByTestId('account-summary-recorded-above')).toHaveTextContent('USD 0.25');
    expect(summary.textContent).not.toContain('3.75');
    expect(within(summary).queryByText(RECORDED_LABEL)).toBeNull();
  });

  it.each([
    [rec({ aboveCharged: { state: 'none', usd: null } }), ABOVE_NONE],
    [rec({ aboveCharged: { state: 'none', usd: null }, chargedAboveUsd: 0.4 }), `${ABOVE_NONE}${aboveChargedAboveLine('USD 0.40')}`],
    [rec({ aboveCharged: { state: 'not_available', usd: null } }), ABOVE_NOT_AVAILABLE],
    [rec({ status: 'partial', recordedExact: false, aboveCharged: { state: 'unknown', usd: null } }), RECORDED_UNKNOWN],
  ])('AC-158: %o → the same text Section 3’s renderer gives', (recorded, text) => {
    const summary = renderWith(recorded);
    const value = within(summary).getByTestId('account-summary-recorded-above-value');
    expect(value.textContent).toBe(text);
    cleanup();
    render(<RecordedAboveValue recorded={recorded} testId="section3" />);
    expect(screen.getByTestId('section3').textContent).toBe(text);
  });

  it('no recorded key → no line', () => {
    const summary = renderWith(undefined);
    expect(within(summary).queryByTestId('account-summary-recorded-above')).toBeNull();
  });
});

// ── Slice 6b (FE-14, AC-250, AC-251): the summary's "Margin after Stripe fees (estimate, USD)" line ──
// A separate import, so the lines above stay unedited.
import { MarginAfterFeesValue } from '../components/AccountEconomicsTable';
import { ACCOUNT_AFTER_FEES } from '../financeCopy';

describe('slice 6b: the summary’s margin after Stripe fees line (FE-14)', () => {
  const OWNER_MARGIN: FinanceAccountMargin = {
    paid: { failed: false, lines: [{ currency: 'USD', afterTax: 89, exact: true, planAfterTax: 79, boostsAfterTax: 10 }] },
    aiCost: { kind: 'figure', costUsd: 1.2345, exact: true },
    margin: { kind: 'figure', marginUsd: 87.7655, noRevenue: false },
    // The test account in October: plan 7900 + boost 1000 → fees 259 + 59 = 318.
    marginAfterFees: { kind: 'figure', afterFeesUsd: 84.5855, feesUsd: 3.18, currency: 'USD', noRevenue: false },
  };
  const renderWith = (accountMargin: FinanceAccountMargin | null) => {
    cleanup();
    render(
      <AccountSummary
        accountId={A}
        window={WINDOW}
        aiCost={aiCost()}
        revenue={revenue(boosts([boostLine()]))}
        credits={credits(creditRow())}
        accounts={accounts('tier:x')}
        accountMargin={accountMargin}
      />
    );
    return screen.getByTestId('account-summary');
  };

  it('sits directly under "AI margin (USD)", labelled exactly, with the fee line "Stripe fees, estimate: USD 3.18"', () => {
    const summary = renderWith(OWNER_MARGIN);
    const labels = [...summary.querySelectorAll('dt')].map((dt) => dt.textContent);
    expect(labels[labels.indexOf(ACCOUNT_MARGIN) + 1]).toBe('Margin after Stripe fees (estimate, USD)');
    expect(ACCOUNT_AFTER_FEES).toBe('Margin after Stripe fees (estimate, USD)');
    expect(within(summary).getByTestId('account-summary-after-fees-value')).toHaveTextContent(/^USD 84\.5855$/);
    expect(within(summary).getByTestId('account-summary-after-fees-value-fees')).toHaveTextContent(/^Stripe fees, estimate: USD 3\.18$/);
  });

  it('AC-250: the summary prints the same text as the tab row cell for the same value', () => {
    const summary = renderWith(OWNER_MARGIN);
    const summaryText = within(summary).getByTestId('account-summary-after-fees').textContent;
    cleanup();
    render(<MarginAfterFeesValue value={OWNER_MARGIN.marginAfterFees} testId="row-cell" />);
    expect(screen.getByTestId('row-cell').parentElement?.textContent).toBe(summaryText);
  });

  it.each([
    [{ kind: 'not_available' } as const, ECON_MARGIN_NOT_AVAILABLE],
    [{ kind: 'other_currency' } as const, ECON_MARGIN_OTHER_CURRENCY],
    [{ kind: 'unknown' } as const, ACCOUNT_UNKNOWN],
  ])('%o → its words, no fee line, never a 0', (value, text) => {
    const summary = renderWith({ ...OWNER_MARGIN, marginAfterFees: value });
    const line = within(summary).getByTestId('account-summary-after-fees');
    expect(line).toHaveTextContent(text);
    expect(within(summary).queryByTestId('account-summary-after-fees-value-fees')).toBeNull();
    expect(line.textContent).not.toMatch(/0\.00/);
  });

  it('no accountMargin in the payload → "Unknown"', () => {
    const summary = renderWith(null);
    expect(within(summary).getByTestId('account-summary-after-fees')).toHaveTextContent(ACCOUNT_UNKNOWN);
  });
});

// ── DF-6 (E-82, DF6-R2): the summary shows the view's since-start line as given ──
describe('DF-6: the summary window line', () => {
  const SINCE: FinanceWindowInfo = { preset: 'since_start', from: '2026-09-29', to: '2026-10-17', start: '2026-09-29T16:50:53.914Z', end: '2026-10-17T12:00:00.000Z' };
  const renderLine = (window: FinanceWindowInfo, windowLine?: string | null) => {
    cleanup();
    render(
      <AccountSummary
        accountId={A}
        window={window}
        aiCost={aiCost()}
        revenue={revenue(boosts([boostLine()]))}
        credits={credits(creditRow())}
        accounts={accounts('tier:x')}
        windowLine={windowLine}
      />
    );
    return screen.getByTestId('account-summary');
  };

  it('AC-266: shows the line it is given, under the heading, unformatted', () => {
    const summary = renderLine(SINCE, 'Since it started: 2026-09-29 16:50 to now (UTC)');
    expect(within(summary).getByTestId('account-summary-window')).toHaveTextContent('Since it started: 2026-09-29 16:50 to now (UTC)');
  });

  it('E-82: no line when none is given (every other window)', () => {
    expect(within(renderLine(WINDOW)).queryByTestId('account-summary-window')).toBeNull();
    expect(within(renderLine(WINDOW, null)).queryByTestId('account-summary-window')).toBeNull();
  });

  it('AC-258: over the since-start window no margin reads "Not available"', () => {
    expect(renderLine(SINCE, 'x').textContent).not.toContain('Not available');
  });
});
