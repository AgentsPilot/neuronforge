/**
 * @jest-environment jsdom
 */

/**
 * The Open-row button (Admin Layout Standard C-9, §5.8 D-2; A-1).
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import { OpenRowButton } from '@/app/admin/components/layout/OpenRowButton';

const LABEL = 'Open details for User Login at 2026-10-10 09:00 UTC';

describe('OpenRowButton', () => {
  it('shows "Open", is named by the label, and hides its icon', () => {
    render(<OpenRowButton label={LABEL} onOpen={jest.fn()} testId="x-open" />);
    const button = screen.getByRole('button', { name: LABEL });
    expect(button.textContent).toBe('Open');
    expect(button.getAttribute('data-testid')).toBe('x-open');
    const icon = button.querySelector('svg');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
  });

  it('a click hands the button itself to onOpen, once', () => {
    const onOpen = jest.fn();
    render(<OpenRowButton label={LABEL} onOpen={onOpen} />);
    const button = screen.getByRole('button', { name: LABEL });
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0]).toBe(button);
  });

  it('is type="button", so it never submits a form', () => {
    const onSubmit = jest.fn((event: React.FormEvent) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <OpenRowButton label={LABEL} onOpen={jest.fn()} />
      </form>
    );
    const button = screen.getByRole('button', { name: LABEL });
    expect(button.getAttribute('type')).toBe('button');
    fireEvent.click(button);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('A-1: a purple focus-visible ring, never the colourless ring-ring or a plain focus: ring', () => {
    render(<OpenRowButton label={LABEL} onOpen={jest.fn()} />);
    const classes = screen.getByRole('button', { name: LABEL }).className.split(/\s+/);
    expect(classes).toContain('focus-visible:ring-2');
    expect(classes).toContain('focus-visible:ring-purple-500');
    expect(classes.some((cls) => cls.startsWith('focus:'))).toBe(false);
    expect(classes.some((cls) => cls.includes('ring-ring'))).toBe(false);
  });
});
