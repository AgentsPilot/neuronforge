/**
 * @jest-environment jsdom
 *
 * LF-6 (user request 2026-10-14): the finance filter bar's alignment, pinned
 * the way L-4a pinned the shared bar. The Account picker carries a two-line
 * help line under its input; on a bottom-aligned row that pushed every other
 * control down. Now the row is top-aligned, the controls with no label of
 * their own sit under `AdminFieldSpacer`, the labelled fields' label row is
 * the spacer's height, the controls are as tall as the picker input, and the
 * help line stays inside the picker column.
 *
 * jsdom does not lay out, so these are class and structure pins. The picker is
 * replaced by a stand-in with the real one's shape (label, input, help line).
 * Class tokens are checked with toHaveClass, so no regex is needed.
 */

import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';

jest.mock('@/app/admin/audit-trail/BusinessAccountPicker', () => ({
  BusinessAccountPicker: () => (
    <div data-testid="picker-stand-in">
      <label htmlFor="stand-in-input">Account</label>
      <input id="stand-in-input" />
      <p data-testid="business-picker-hint">Only accounts with a business profile can be found by name.</p>
    </div>
  ),
}));

import { FinanceFilterBar } from '../components/FinanceFilterBar';
import { DEFAULT_FINANCE_QUERY } from '../financeUrl';
import { FILTER_APPLY, FILTER_FROM, FILTER_TO } from '../financeCopy';

function renderBar() {
  render(
    <FinanceFilterBar query={DEFAULT_FINANCE_QUERY} resolved={{ from: '2026-10-01', to: '2026-10-14' }} onChange={jest.fn()} />
  );
  return { row: screen.getByTestId('finance-filters').firstElementChild as HTMLElement };
}

/** The spacer is the first child of the control's column: aria-hidden, invisible, a label's height. */
function spacerColumnOf(control: HTMLElement): HTMLElement {
  const column = control.parentElement as HTMLElement;
  const spacer = column.firstElementChild as HTMLElement;
  expect(spacer).not.toBe(control);
  expect(spacer).toHaveAttribute('aria-hidden', 'true');
  // The same label class as every labelled bar field (ADMIN_FIELD_LABEL), made invisible.
  expect(spacer).toHaveClass('invisible', 'block', 'text-[11px]', 'mb-1');
  return column;
}

describe('LF-6: the finance filter bar lines up', () => {
  it('the controls row is top-aligned, never bottom-aligned', () => {
    const { row } = renderBar();
    expect(row).toHaveClass('flex', 'flex-wrap', 'items-start');
    expect(row).not.toHaveClass('items-end');
  });

  it('the Window group, which has no label of its own, sits under a spacer', () => {
    const { row } = renderBar();
    const group = screen.getByRole('group', { name: 'Window' });
    expect(spacerColumnOf(group).parentElement).toBe(row);
  });

  it('Apply, which has no label of its own, sits under a spacer', () => {
    const { row } = renderBar();
    const apply = screen.getByRole('button', { name: FILTER_APPLY });
    expect(spacerColumnOf(apply).parentElement).toBe(row);
  });

  it('From and To are a label row then the input, the label row as tall as the spacer (11px line plus a 4px gap)', () => {
    const { row } = renderBar();
    for (const name of [FILTER_FROM, FILTER_TO]) {
      const field = screen.getByLabelText(name).parentElement as HTMLElement;
      expect(field.tagName).toBe('LABEL');
      expect(field.parentElement).toBe(row);
      expect(field).toHaveClass('flex', 'flex-col', 'gap-1', 'text-[11px]');
    }
  });

  it('the controls are as tall as the picker input (py-2 inputs and Apply, py-1.5 presets in the p-0.5 frame)', () => {
    renderBar();
    expect(screen.getByLabelText(FILTER_FROM)).toHaveClass('py-2', 'text-xs');
    expect(screen.getByLabelText(FILTER_TO)).toHaveClass('py-2', 'text-xs');
    expect(screen.getByRole('button', { name: FILTER_APPLY })).toHaveClass('py-2', 'text-xs');
    const group = screen.getByRole('group', { name: 'Window' });
    expect(group).toHaveClass('p-0.5');
    const presets = Array.from(group.children);
    expect(presets).toHaveLength(5);
    for (const preset of presets) expect(preset).toHaveClass('py-1.5', 'text-xs');
  });

  it('the help line stays inside the picker column, under its input, and is not an item of the row', () => {
    const { row } = renderBar();
    const hint = screen.getByTestId('business-picker-hint');
    const pickerColumn = screen.getByTestId('picker-stand-in').parentElement as HTMLElement;
    expect(pickerColumn.parentElement).toBe(row);
    expect(pickerColumn).toContainElement(hint);
    expect(Array.from(row.children)).not.toContain(hint);
    // Five items, in order: Window, From, To, Apply, the picker.
    expect(row.children).toHaveLength(5);
    expect(row.lastElementChild).toBe(pickerColumn);
  });
});
