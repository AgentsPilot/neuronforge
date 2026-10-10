/**
 * @jest-environment jsdom
 */

/**
 * The shared loading and error states (Admin Layout Standard C-3, §5.10).
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import { AdminError, AdminLoading } from '@/app/admin/components/layout/AdminStates';

describe('AdminLoading', () => {
  it('says "Reading {what}…" with a hidden spinner icon, in a status live region', () => {
    const { container } = render(<AdminLoading what="the health summary" />);
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('Reading the health summary…');
    const icon = container.querySelector('svg');
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
    expect(icon?.getAttribute('class')).toContain('animate-spin');
    expect(screen.queryAllByRole('region')).toHaveLength(0);
  });
});

describe('AdminError', () => {
  it('puts the testid on the message element, whose text is exactly the message (RC-3)', () => {
    render(<AdminError message="Forbidden" testId="x-error" />);
    expect(screen.getByTestId('x-error').textContent).toBe('Forbidden');
    expect(screen.getByRole('alert').contains(screen.getByTestId('x-error'))).toBe(true);
    expect(screen.queryAllByRole('region')).toHaveLength(0);
  });

  it('renders no button without onRetry', () => {
    render(<AdminError message="Forbidden" testId="x-error" />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('with onRetry, "Try again" calls it once and sits outside the testid element', () => {
    const onRetry = jest.fn();
    render(<AdminError message="Forbidden" testId="x-error" onRetry={onRetry} />);
    const button = screen.getByRole('button', { name: 'Try again' });
    expect(button.getAttribute('type')).toBe('button');
    expect(screen.getByTestId('x-error').contains(button)).toBe(false);
    expect(screen.getByTestId('x-error').textContent).toBe('Forbidden');
    fireEvent.click(button);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
