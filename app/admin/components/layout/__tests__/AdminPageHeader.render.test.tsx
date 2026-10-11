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
