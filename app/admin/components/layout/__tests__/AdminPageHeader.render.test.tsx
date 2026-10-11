/**
 * @jest-environment jsdom
 */

/**
 * The shared admin page header (Admin Layout Standard C-2, §5.3).
 */

import React from 'react';
import { render, screen } from '@testing-library/react';

import { AdminPageHeader } from '@/app/admin/components/layout/AdminPageHeader';

describe('AdminPageHeader', () => {
  it('renders one h1 with the title, the purpose, and the As of line on slate-400', () => {
    render(<AdminPageHeader title="Health" purpose="Is anything wrong?" asOf="As of 10:30 UTC." />);
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0].textContent).toBe('Health');
    expect(screen.getByText('Is anything wrong?')).toBeTruthy();
    const asOf = screen.getByTestId('as-of');
    expect(asOf.textContent).toBe('As of 10:30 UTC.');
    expect(asOf.className).toContain('text-slate-400');
  });

  it('renders no As of element without asOf, and none for null', () => {
    const { rerender } = render(<AdminPageHeader title="Health" purpose="p" />);
    expect(screen.queryByTestId('as-of')).toBeNull();
    rerender(<AdminPageHeader title="Health" purpose="p" asOf={null} />);
    expect(screen.queryByTestId('as-of')).toBeNull();
  });

  it('renders no region (the page region count is unchanged)', () => {
    const { container } = render(<AdminPageHeader title="Health" purpose="p" asOf="x" />);
    expect(screen.queryAllByRole('region')).toHaveLength(0);
    expect(container.querySelector('section')).toBeNull();
  });
});

describe('AdminPageHeader actions (L-1c)', () => {
  it('renders the actions and still exactly one h1', () => {
    render(<AdminPageHeader title="Audit trail" purpose="p" actions={<button type="button">Export CSV</button>} />);
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('renders no actions without the prop', () => {
    render(<AdminPageHeader title="Health" purpose="p" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('AdminPageHeader badge (L-3)', () => {
  it('renders the badge as a neutral chip beside the one h1, with its test id', () => {
    render(<AdminPageHeader title="Archiving" purpose="p" badge={{ label: 'Runs off', testId: 'runs-off-badge' }} />);
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    const chip = screen.getByTestId('runs-off-badge');
    expect(chip.tagName).toBe('SPAN');
    expect(chip.textContent).toBe('Runs off');
    expect(chip.getAttribute('data-tone')).toBe('neutral');
    // Beside the title: the chip and the h1 share one row.
    expect(chip.parentElement).toBe(headings[0].parentElement);
    expect(chip.querySelector('svg')).toBeNull();
  });

  it('without a badge the h1 is a direct child of the first div (the pre-L-3 DOM) and no chip renders', () => {
    const { container } = render(<AdminPageHeader title="Health" purpose="p" asOf="As of x." />);
    const firstDiv = container.querySelector('header > div');
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.parentElement).toBe(firstDiv);
    expect(container.querySelector('[data-tone]')).toBeNull();
    expect(firstDiv?.children).toHaveLength(3);
  });
});
