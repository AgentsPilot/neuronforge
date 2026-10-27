/**
 * @jest-environment jsdom
 *
 * Money MK-9: F-K5's breakdown section (S5B-FR-8 to FR-16; SA-WP-MK9). Every
 * figure is the server's; the section labels it, and says Unknown in words,
 * never 0. No billing mode is named (MK9-R1).
 */

import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';

import type { FinancePaying, FinancePayingBreakdown } from '@/lib/business-os/finance/financeTypes';
import { PayingBreakdownSection } from '../components/PayingBreakdownSection';
import { PAYING_BREAKDOWN } from '../financeCopy';

const PAYING: FinancePaying = { scope: 'all', status: 'ok', paying: 9, accounts: 50 };
const READY: FinancePayingBreakdown = {
  comped: { total: 6, assignedNoSubscription: 4, endedOrNotPaying: 2 },
  trials: { status: 'ok', endedInWindow: 12, stillRunning: 7, paid: 5, paidBeforeEnd: 3, rate: { paid: 5, base: 12, percent: 42 }, minimumForRate: 10 },
};
const show = (breakdown: FinancePayingBreakdown, paying: FinancePaying | undefined = PAYING) =>
  render(<PayingBreakdownSection breakdown={breakdown} paying={paying} onRetry={jest.fn()} />);

describe('PayingBreakdownSection', () => {
  it('happy path: Paying as the tile counts it, the Comped split, trial-to-paid with its rate, the note and the limits', () => {
    show(READY);
    expect(screen.getByRole('heading', { name: 'Paying accounts' })).toBeInTheDocument();
    expect(screen.getByTestId('paying-breakdown-paying')).toHaveTextContent('Paying: 9 of 50 accounts');
    expect(screen.getByTestId('paying-breakdown-comped-line')).toHaveTextContent(
      'Comped: 6 · Assigned, no subscription 4 · Subscription ended or not paying 2'
    );
    expect(screen.getByTestId('paying-breakdown-trials-line')).toHaveTextContent(
      'Trials ended in this window: 12 · Paid: 5 (of which before the trial ended: 3)'
    );
    expect(screen.getByTestId('paying-breakdown-rate')).toHaveTextContent('Rate: 5 of 12 (42%)');
    expect(screen.getByTestId('paying-breakdown-running')).toHaveTextContent('Still running: 7');
    expect(screen.getByTestId('section-paying-breakdown')).toHaveTextContent(PAYING_BREAKDOWN.note);
    expect(screen.getByTestId('section-paying-breakdown')).toHaveTextContent(PAYING_BREAKDOWN.limits);
  });

  it('below the floor: counts only and the reason, with the minimum from the payload', () => {
    show({ ...READY, trials: { ...READY.trials, endedInWindow: 4, paid: 1, paidBeforeEnd: 0, rate: null } });
    expect(screen.getByTestId('paying-breakdown-rate')).toHaveTextContent('Too few trials for a rate (a rate needs at least 10)');
  });

  it('failure paths: Paid Unknown (never 0); Comped could not check; trials could not be read', () => {
    const { unmount } = show({ comped: null, trials: { ...READY.trials, paid: null, paidBeforeEnd: null, rate: null } });
    expect(screen.getByTestId('paying-breakdown-comped-unknown')).toHaveTextContent('Comped: Could not check');
    expect(screen.getByTestId('paying-breakdown-trials-line')).toHaveTextContent('Paid: Unknown');
    expect(screen.getByTestId('paying-breakdown-trials-line')).not.toHaveTextContent('Paid: 0');
    unmount();
    show({ comped: null, trials: { status: 'unknown', endedInWindow: null, stillRunning: null, paid: null, paidBeforeEnd: null, rate: null, minimumForRate: 10 } });
    expect(screen.getByTestId('section-paying-breakdown')).toHaveAttribute('data-status', 'unknown');
  });

  it('MK9-FU-1: with Paid unknown, "Paid: Unknown" is said ONCE, with its reason, and there is no rate line', () => {
    show({ ...READY, trials: { ...READY.trials, paid: null, paidBeforeEnd: null, rate: null } });
    const section = screen.getByTestId('section-paying-breakdown');
    expect(section.textContent?.match(/Paid: Unknown/g)).toHaveLength(1);
    expect(screen.getByTestId('paying-breakdown-trials-line')).toHaveTextContent(
      'Trials ended in this window: 12 · Paid: Unknown (first payments could not be read)'
    );
    expect(screen.queryByTestId('paying-breakdown-rate')).toBeNull();
    // The other lines of the block are unchanged.
    expect(screen.getByTestId('paying-breakdown-running')).toHaveTextContent('Still running: 7');
  });

  it('MK9-FU-1: a cut walk with Paid unknown keeps its cut-off rate line, and Paid: Unknown stays single', () => {
    show({ ...READY, trials: { ...READY.trials, status: 'partial', paid: null, paidBeforeEnd: null, rate: null } });
    expect(screen.getByTestId('paying-breakdown-rate')).toHaveTextContent(PAYING_BREAKDOWN.noRateCutOff);
    expect(screen.getByTestId('section-paying-breakdown').textContent?.match(/Paid: Unknown/g)).toHaveLength(1);
  });

  it('a cut walk: "at least" counts, a notice, and no rate', () => {
    show({ ...READY, trials: { ...READY.trials, status: 'partial', rate: null } });
    expect(screen.getByTestId('paying-breakdown-cut-off')).toBeInTheDocument();
    expect(screen.getByTestId('paying-breakdown-trials-line')).toHaveTextContent('At least 12');
    expect(screen.getByTestId('paying-breakdown-rate')).toHaveTextContent(PAYING_BREAKDOWN.noRateCutOff);
  });

  // MK9-FU-2 (SA-WP-FU2, option A): Comped rests on the same plan walk as the trial counts, so a cut walk
  // makes it a lower bound too. The flag is the walk's own, carried on `trials.status`.
  it('MK9-FU-2: a cut walk makes Comped and both its parts "At least"', () => {
    show({ ...READY, trials: { ...READY.trials, status: 'partial', rate: null } });
    expect(screen.getByTestId('paying-breakdown-comped-line')).toHaveTextContent(
      'Comped: At least 6 · Assigned, no subscription At least 4 · Subscription ended or not paying At least 2'
    );
  });

  it('MK9-FU-2: an exact walk shows the Comped figures plain, with no "At least"', () => {
    show(READY);
    expect(screen.getByTestId('paying-breakdown-comped-line')).not.toHaveTextContent(/At least/i);
  });

  it('MK9-FU-2: a cut walk with the paying read failed still says "Could not check", never "At least"', () => {
    show({ comped: null, trials: { ...READY.trials, status: 'partial', rate: null } });
    expect(screen.getByTestId('paying-breakdown-comped-unknown')).toHaveTextContent('Comped: Could not check');
    expect(screen.getByTestId('paying-breakdown-comped')).not.toHaveTextContent(/At least/i);
  });

  it('Paying unknown is said in words', () => {
    show(READY, { scope: 'all', status: 'unknown', paying: null, accounts: null });
    expect(screen.getByTestId('paying-breakdown-paying')).toHaveTextContent('Paying: Unknown');
  });

  it('names no billing mode anywhere in its copy (MK9-R1)', () => {
    show(READY);
    expect(screen.getByTestId('section-paying-breakdown').textContent).not.toMatch(/livemode|test.?mode|live.?mode|stripe/i);
    expect(JSON.stringify(PAYING_BREAKDOWN)).not.toMatch(/livemode|test.?mode|live.?mode|stripe/i);
  });
});
