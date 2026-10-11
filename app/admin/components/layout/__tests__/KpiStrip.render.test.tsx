/**
 * @jest-environment jsdom
 */

/**
 * The shared KPI strip and tile (Admin Layout Standard C-11, §5.4): the whole
 * tile is a link (K-6), its name reads label, value and status (K-7), the
 * status row is icon plus words (K-4), and loading shows fixed placeholders
 * (K-10).
 */

import React from 'react';
import { render, screen } from '@testing-library/react';

import { KpiStrip, KpiTile } from '@/app/admin/components/layout/KpiStrip';

describe('KpiTile', () => {
  it('a neutral tile is one link to its anchor, named "label, value", with no status row', () => {
    render(<KpiTile label="Queues" value="5" href="#queues" testId="kpi-queues" />);
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('#queues');
    expect(link).toBe(screen.getByRole('link', { name: 'Queues, 5' }));
    expect(link.getAttribute('data-testid')).toBe('kpi-queues');
    expect(link.textContent).not.toContain('Needs action');
    expect(link.querySelector('svg')).toBeNull();
    expect(link.className).toContain('border-slate-700');
    expect(link.className).not.toContain('border-red-500/40');
    expect(link.hasAttribute('aria-describedby')).toBe(false);
  });

  it('a red tile says "Needs action" with a hidden icon, a red card, and the status in its name', () => {
    render(<KpiTile label="Stuck items" value="3" status="red" href="#queues" />);
    const link = screen.getByRole('link', { name: 'Stuck items, 3, needs action' });
    expect(link.textContent).toContain('Needs action');
    const icon = link.querySelector('svg');
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
    expect(link.className).toContain('border-red-500/40');
    expect(link.className).not.toContain('border-slate-700');
    expect(link.getAttribute('data-status')).toBe('red');
  });

  it('the sub-line is the link description, not part of its name', () => {
    render(<KpiTile label="Stuck items" value="0" sub="across 5 queues" href="#queues" />);
    const link = screen.getByRole('link', { name: 'Stuck items, 0' });
    const describedBy = link.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toBe('across 5 queues');
  });

  it('K-3 sizes and the A-1 focus ring', () => {
    render(<KpiTile label="Jobs" value="12,345" href="#jobs" />);
    const link = screen.getByRole('link');
    expect(link.className).toContain('focus-visible:ring-2');
    expect(link.className).toContain('focus-visible:ring-purple-500');
    const value = screen.getByText('12,345');
    expect(value.className).toContain('text-2xl');
    expect(value.className).toContain('tabular-nums');
    expect(screen.getByText('Jobs').className).toContain('text-sm');
  });

  it('never a button and never a region', () => {
    render(<KpiTile label="Jobs" value="7" status="red" sub="x" href="#jobs" />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryAllByRole('region')).toHaveLength(0);
    expect(document.querySelector('section')).toBeNull();
  });
});

describe('KpiStrip', () => {
  it('lays the tiles out on the K-2 grid', () => {
    const { container } = render(
      <KpiStrip>
        <KpiTile label="Jobs" value="7" href="#jobs" />
        <KpiTile label="Queues" value="5" href="#queues" />
      </KpiStrip>
    );
    const strip = container.firstElementChild as HTMLElement;
    expect(strip.className).toBe('grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5');
    expect(screen.getAllByRole('link')).toHaveLength(2);
    expect(strip.hasAttribute('role')).toBe(false);
  });

  it('loading renders the placeholders, hidden, and no tile even when children are passed (K-10)', () => {
    render(
      <KpiStrip loading placeholderCount={4}>
        <KpiTile label="Jobs" value="7" href="#jobs" />
      </KpiStrip>
    );
    const placeholders = screen.getAllByTestId('kpi-placeholder');
    expect(placeholders).toHaveLength(4);
    for (const placeholder of placeholders) {
      expect(placeholder.getAttribute('aria-hidden')).toBe('true');
      expect(placeholder.className).toContain('h-28');
    }
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryAllByRole('region')).toHaveLength(0);
  });
});
