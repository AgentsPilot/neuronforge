/**
 * @jest-environment jsdom
 *
 * Finance F-4 (AC-177, Admin Layout Standard §5.5): the finance filter bar is
 * the SHARED `AdminFilterBar`. This file replaces the LF-6 local-alignment
 * pins (the local row, its spacers and its py-2 controls are gone; the shared
 * bar's own alignment is pinned in `AdminFilterBar.render.test.tsx`).
 *
 * Pinned here: `role="search"` "Filters"; the shared Window group with the five
 * standard labels and Custom as a real button; no From / To / Apply until
 * Custom; the picker in the bar; the help line as the bar's LAST line, named by
 * the picker's input (`aria-describedby`, L-4a SA Q-5); Clear, "Read at" and
 * Refresh in the bar; the business chip in the bar's chip row; and the SA-W5
 * problem line, red and an alert, under the bar.
 *
 * jsdom does not lay out, so these are structure pins. The picker is a stand-in
 * with the real one's shape (label, input); the real `businessFilterChip` is kept.
 */

import '@testing-library/jest-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';

jest.mock('@/app/admin/components/layout/AdminBusinessPicker', () => ({
  ...jest.requireActual('@/app/admin/components/layout/AdminBusinessPicker'),
  AdminBusinessPicker: ({ describedBy }: { describedBy?: string }) => (
    <div data-testid="picker-stand-in">
      <label htmlFor="stand-in-input">Business</label>
      <input id="stand-in-input" aria-describedby={describedBy} />
    </div>
  ),
}));

import { FinanceFilterBar } from '../components/FinanceFilterBar';
import { FILTER_BUSINESS_HELP } from '../financeCopy';
import { FINANCE_DEFAULT_WINDOW, type FinanceFilters } from '../financeFilters';

const A = '11111111-1111-4111-8111-111111111111';
// Money MK-4 (QA-MK4-1): `status` joined the filters ('' = all).
const DEFAULTS: FinanceFilters = { window: FINANCE_DEFAULT_WINDOW, account: '', tab: '', sort: 'ai_cost', group: '', show: 'all', status: '' };

function renderBar(overrides: Partial<Parameters<typeof FinanceFilterBar>[0]> = {}) {
  const props = {
    filters: DEFAULTS,
    onWindowChange: jest.fn(),
    onPick: jest.fn(),
    onRemoveBusiness: jest.fn(),
    chipName: null,
    onClear: jest.fn(),
    canClear: false,
    busy: false,
    readAt: '2026-10-14T09:05:00.000Z',
    onRefresh: jest.fn(),
    windowProblem: null,
    ...overrides,
  };
  render(<FinanceFilterBar {...props} />);
  return { props, bar: screen.getByRole('search', { name: 'Filters' }) };
}

describe('Finance F-4: the shared filter bar (AC-177)', () => {
  it('is the shared bar: role="search" named "Filters", inside the finance filters block', () => {
    const { bar } = renderBar();
    expect(screen.getByTestId('finance-filters')).toContainElement(bar);
    expect(bar).toHaveClass('rounded-xl', 'border', 'border-slate-700');
  });

  it('the Window group carries the five standard labels; Custom is a real button; From / To / Apply only after Custom', () => {
    const { bar } = renderBar();
    const group = within(bar).getByRole('group', { name: 'Window' });
    const buttons = within(group).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Today', '7 days', '30 days', 'This month', 'Custom']);
    for (const button of buttons) expect(button).toHaveAttribute('aria-pressed');
    expect(within(group).getByRole('button', { name: 'This month' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('7d')).toBeNull();
    expect(screen.queryByLabelText('From (UTC)')).toBeNull();
    fireEvent.click(within(group).getByRole('button', { name: 'Custom' }));
    expect(within(bar).getByLabelText('From (UTC)')).toBeInTheDocument();
    expect(within(bar).getByLabelText('To (UTC)')).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: 'Apply' })).toBeInTheDocument();
  });

  it('a custom window shows its dates in the open Custom row', () => {
    renderBar({ filters: { ...DEFAULTS, window: { kind: 'custom', from: '2026-09-01', to: '2026-09-30' } } });
    expect(screen.getByRole('button', { name: 'Custom' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('From (UTC)')).toHaveValue('2026-09-01');
    expect(screen.getByLabelText('To (UTC)')).toHaveValue('2026-09-30');
  });

  it('a preset click hands the window to the view', () => {
    const { props } = renderBar();
    fireEvent.click(screen.getByRole('button', { name: '30 days' }));
    expect(props.onWindowChange).toHaveBeenCalledWith({ kind: 'preset', preset: '30d' });
  });

  it('the picker is in the bar; the help line is the bar’s last line and the picker input names it', () => {
    const { bar } = renderBar();
    expect(bar).toContainElement(screen.getByTestId('picker-stand-in'));
    const help = screen.getByTestId('finance-business-help');
    expect(help).toHaveTextContent(FILTER_BUSINESS_HELP);
    expect(bar.lastElementChild).toBe(help);
    expect(help).toHaveClass('text-slate-400');
    const helpId = help.getAttribute('id');
    expect(helpId).toBeTruthy();
    expect(screen.getByLabelText('Business')).toHaveAttribute('aria-describedby', helpId);
  });

  it('Clear, "Read at" and Refresh ("Refresh the finance page") are in the bar', () => {
    const { bar, props } = renderBar({ canClear: true });
    const clear = within(bar).getByRole('button', { name: 'Clear' });
    expect(clear).toBeEnabled();
    fireEvent.click(clear);
    expect(props.onClear).toHaveBeenCalledTimes(1);
    expect(within(bar).getByText(/^Read at /)).toHaveTextContent('Read at 09:05 UTC');
    const refresh = within(bar).getByRole('button', { name: 'Refresh the finance page' });
    fireEvent.click(refresh);
    expect(props.onRefresh).toHaveBeenCalledTimes(1);
  });

  it('Clear is disabled when there is nothing to clear; Refresh is busy while a read runs', () => {
    renderBar({ canClear: false, busy: true });
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
    const refresh = screen.getByRole('button', { name: 'Refresh the finance page' });
    expect(refresh).toHaveAttribute('aria-busy', 'true');
    expect(refresh).toBeDisabled();
  });

  it('a business shows the shared chip in the bar; its X hands back to the view', () => {
    const { bar, props } = renderBar({ filters: { ...DEFAULTS, account: A }, chipName: 'Acme Dental' });
    const chip = within(bar).getByTestId('business-filter-chip');
    expect(chip).toHaveTextContent('Business: Acme Dental');
    fireEvent.click(within(chip).getByRole('button', { name: 'Remove business' }));
    expect(props.onRemoveBusiness).toHaveBeenCalledTimes(1);
  });

  it('no business, no chip', () => {
    renderBar();
    expect(screen.queryByTestId('business-filter-chip')).toBeNull();
  });

  it('SA-W5 (a): the refused-window sentence is a red alert under the bar, absent when null', () => {
    renderBar({ windowProblem: 'The window may be at most 92 days' });
    const problem = screen.getByTestId('finance-window-problem');
    expect(problem).toHaveTextContent('The window may be at most 92 days');
    expect(problem).toHaveAttribute('role', 'alert');
    expect(problem).toHaveClass('text-red-300');
    expect(screen.getByRole('search', { name: 'Filters' })).not.toContainElement(problem);
  });
});

// ── DF-6 (DF6-FR-9, L-148): "Since it started" only with a business picked ──
describe('DF-6: the since-start choice in the Window group', () => {
  const labels = (bar: HTMLElement) => within(within(bar).getByRole('group', { name: 'Window' })).getAllByRole('button').map((b) => b.textContent);

  it('all businesses: the five standard choices only', () => {
    const { bar } = renderBar();
    expect(labels(bar)).toEqual(['Today', '7 days', '30 days', 'This month', 'Custom']);
  });

  it('a business picked: "Since it started" after Custom; a click applies the extra', () => {
    const { bar, props } = renderBar({ filters: { ...DEFAULTS, account: A } });
    expect(labels(bar)).toEqual(['Today', '7 days', '30 days', 'This month', 'Custom', 'Since it started']);
    fireEvent.click(within(bar).getByRole('button', { name: 'Since it started' }));
    expect(props.onWindowChange).toHaveBeenLastCalledWith({ kind: 'extra', extra: 'since_start' });
  });
});
