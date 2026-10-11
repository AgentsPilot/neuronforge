/**
 * @jest-environment jsdom
 */

/**
 * The shared filter bar (Admin Layout Standard C-8, §5.5). The first four
 * cases are the L-1a Refresh-only form, unchanged: Health and Jobs pass only
 * those props and must render exactly as before. L-1c adds the full form.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import { AdminFilterBar, type AdminActiveChip } from '@/app/admin/components/layout/AdminFilterBar';

describe('AdminFilterBar (Refresh)', () => {
  it('names the button "Refresh {what}", shows "Refresh", and calls onRefresh on click', () => {
    const onRefresh = jest.fn();
    render(<AdminFilterBar what="the x" busy={false} onRefresh={onRefresh} />);
    const button = screen.getByRole('button', { name: 'Refresh the x' });
    expect(button.textContent).toBe('Refresh');
    expect(button.getAttribute('aria-busy')).toBe('false');
    expect(button.getAttribute('type')).toBe('button');
    fireEvent.click(button);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('the bar has no search or region role', () => {
    render(<AdminFilterBar what="the x" busy={false} onRefresh={() => undefined} />);
    expect(screen.queryAllByRole('search')).toHaveLength(0);
    expect(screen.queryAllByRole('region')).toHaveLength(0);
  });

  it('while busy the button is aria-busy, disabled, spinning, and a click does not call', () => {
    const onRefresh = jest.fn();
    const { container } = render(<AdminFilterBar what="the x" busy onRefresh={onRefresh} />);
    const button = screen.getByRole('button', { name: 'Refresh the x' });
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(container.querySelector('svg')?.getAttribute('class')).toContain('animate-spin');
    fireEvent.click(button);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('shows no "Read at" text', () => {
    const { container } = render(<AdminFilterBar what="the x" busy={false} onRefresh={() => undefined} />);
    expect(container.textContent).not.toContain('Read at');
  });
});

describe('AdminFilterBar (full form, L-1c)', () => {
  const NONE = { kind: 'none' } as const;

  it('takes role="search" named Filters only when it holds controls, and never a region', () => {
    const { rerender } = render(<AdminFilterBar what="the x" busy={false} onRefresh={() => undefined} readAt="2026-10-11T14:02:00.000Z" />);
    expect(screen.queryAllByRole('search')).toHaveLength(0);
    rerender(<AdminFilterBar what="the x" busy={false} onRefresh={() => undefined} onClear={() => undefined} />);
    expect(screen.getByRole('search', { name: 'Filters' })).toBeTruthy();
    expect(screen.queryAllByRole('region')).toHaveLength(0);
  });

  it('lays out window, business, page filters, Clear, Refresh, in DOM order', () => {
    render(
      <AdminFilterBar
        what="the x"
        busy={false}
        onRefresh={() => undefined}
        windowControl={{ value: NONE, defaultValue: NONE, onChange: () => undefined }}
        business={<span data-testid="business-slot">B</span>}
        onClear={() => undefined}
      >
        <label htmlFor="f1">Page filter</label>
        <input id="f1" />
      </AdminFilterBar>,
    );
    const order = [
      screen.getByRole('group', { name: 'Window' }),
      screen.getByTestId('business-slot'),
      screen.getByLabelText('Page filter'),
      screen.getByRole('button', { name: 'Clear' }),
      screen.getByRole('button', { name: 'Refresh the x' }),
    ];
    for (let i = 1; i < order.length; i += 1) {
      expect(Boolean(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    }
  });

  it('Clear calls onClear, and canClear={false} disables it', () => {
    const onClear = jest.fn();
    const { rerender } = render(<AdminFilterBar what="the x" busy={false} onRefresh={() => undefined} onClear={onClear} canClear />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onClear).toHaveBeenCalledTimes(1);
    rerender(<AdminFilterBar what="the x" busy={false} onRefresh={() => undefined} onClear={onClear} canClear={false} />);
    expect((screen.getByRole('button', { name: 'Clear' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows "Read at HH:mm UTC" from readAt, through Date', () => {
    const { container } = render(
      <AdminFilterBar what="the x" busy={false} onRefresh={() => undefined} onClear={() => undefined} readAt="2026-10-11T16:02:30+02:00" />,
    );
    expect(container.textContent).toContain('Read at 14:02 UTC');
  });

  it('renders chips with their title, testid and X label; the X calls onRemove', () => {
    const onRemove = jest.fn();
    const chip: AdminActiveChip = {
      key: 'account',
      label: 'Account Acme',
      title: 'full-id',
      testId: 'chip-a',
      removeLabel: 'Remove account',
      onRemove,
    };
    render(<AdminFilterBar what="the x" busy={false} onRefresh={() => undefined} onClear={() => undefined} chips={[chip]} />);
    const element = screen.getByTestId('chip-a');
    expect(element.textContent).toBe('Account Acme');
    expect(element.querySelector('[title="full-id"]')?.textContent).toBe('Account Acme');
    fireEvent.click(screen.getByRole('button', { name: 'Remove account' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('a linked window shows its own chip; its X goes back to the default', () => {
    const onChange = jest.fn();
    render(
      <AdminFilterBar
        what="the x"
        busy={false}
        onRefresh={() => undefined}
        windowControl={{ value: { kind: 'linked', from: null, to: '2026-09-29T16:51' }, defaultValue: NONE, onChange }}
      />,
    );
    expect(screen.getByTestId('linked-window-chip').textContent).toBe('Linked window up to 2026-09-29 16:51 UTC');
    fireEvent.click(screen.getByRole('button', { name: 'Remove linked window' }));
    expect(onChange).toHaveBeenCalledWith(NONE);
  });

  it('no linked chip and no chip buttons without a linked window or chips', () => {
    render(
      <AdminFilterBar
        what="the x"
        busy={false}
        onRefresh={() => undefined}
        windowControl={{ value: NONE, defaultValue: NONE, onChange: () => undefined }}
      />,
    );
    expect(screen.queryByTestId('linked-window-chip')).toBeNull();
    expect(screen.queryAllByRole('button', { name: /^Remove/ })).toHaveLength(0);
  });
});
