/**
 * @jest-environment jsdom
 */

/**
 * The shared filter bar, Refresh part only (Admin Layout Standard C-8, §5.5).
 * No "Read at" in L-1a (SA workplan review ruling 3c, W-2: moved to L-1c).
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import { AdminFilterBar } from '@/app/admin/components/layout/AdminFilterBar';

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
