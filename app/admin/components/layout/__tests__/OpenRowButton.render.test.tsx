/**
 * @jest-environment jsdom
 */

/**
 * The Open-row button (Admin Layout Standard C-9, §5.8 D-2; A-1).
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import { OpenRowButton, OpenRowHeader } from '@/app/admin/components/layout/OpenRowButton';
import { ADMIN_TH_OPEN } from '@/app/admin/components/layout/adminTable';
import { BusinessOpenHeader } from '@/app/admin/finance/components/BusinessDrawer';

const LABEL = 'Open details for User Login at 2026-10-10 09:00 UTC';

describe('OpenRowButton', () => {
  // LF-8 (user request 2026-10-15): an icon only; was the visible word "Open".
  it('is an icon only, named by the label, with the label as its tooltip and its icon hidden', () => {
    render(<OpenRowButton label={LABEL} onOpen={jest.fn()} testId="x-open" />);
    const button = screen.getByRole('button', { name: LABEL });
    expect(button.textContent).toBe('');
    expect(button.getAttribute('aria-label')).toBe(LABEL);
    expect(button.getAttribute('title')).toBe(LABEL);
    expect(button.getAttribute('data-testid')).toBe('x-open');
    const icons = button.querySelectorAll('svg');
    expect(icons).toHaveLength(1);
    expect(icons[0].getAttribute('aria-hidden')).toBe('true');
  });

  it('LF-8: a 32 px square hit target, the icon centred', () => {
    render(<OpenRowButton label={LABEL} onOpen={jest.fn()} />);
    const button = screen.getByRole('button', { name: LABEL });
    for (const cls of ['h-8', 'w-8', 'inline-flex', 'items-center', 'justify-center']) {
      expect({ cls, present: button.classList.contains(cls) }).toEqual({ cls, present: true });
    }
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

describe('OpenRowHeader (moved unchanged from Finance, Money MK-8b SA-Q-MK8B-1)', () => {
  it('is the narrow Open column header with an sr-only "Details" name', () => {
    render(
      <table>
        <thead>
          <tr>
            <OpenRowHeader />
          </tr>
        </thead>
      </table>
    );
    const header = screen.getByRole('columnheader', { name: 'Details' });
    expect(header.getAttribute('scope')).toBe('col');
    expect(header.className).toBe(ADMIN_TH_OPEN);
    expect(header.querySelector('span')?.className).toBe('sr-only');
  });

  it("Finance's name is the shared component itself (a re-export, never a copy)", () => {
    expect(BusinessOpenHeader).toBe(OpenRowHeader);
  });
});
