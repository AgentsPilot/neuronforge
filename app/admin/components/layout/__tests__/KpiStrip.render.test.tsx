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
import { createEvent, fireEvent, render, screen } from '@testing-library/react';

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

describe('KpiTile filter mode (L-2a, Q-14, R-7)', () => {
  const HREF = '/admin/analytics?scope=all&category=memory';

  function setup(current?: boolean) {
    const apply = jest.fn();
    render(<KpiTile label="Memory" value="$0.50" testId="kpi-memory" filter={{ href: HREF, apply, current }} />);
    return { apply, link: screen.getByRole('link', { name: 'Memory, $0.50' }) };
  }

  /** Fires a click and reports whether the page prevented the browser's own handling. */
  function click(element: HTMLElement, init: MouseEventInit = {}): boolean {
    const event = createEvent.click(element, { button: 0, ...init });
    fireEvent(element, event);
    return event.defaultPrevented;
  }

  it('is one real link to the filtered view, named per K-7, never a button or a region', () => {
    const { link } = setup();
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe(HREF);
    expect(link.getAttribute('data-testid')).toBe('kpi-memory');
    expect(link.hasAttribute('aria-current')).toBe(false);
    expect(link.className).toContain('border-slate-700');
    expect(link.className).toContain('focus-visible:ring-purple-500');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryAllByRole('region')).toHaveLength(0);
  });

  it('a plain left click applies the patch once and prevents the navigation', () => {
    const { apply, link } = setup();
    expect(click(link)).toBe(true);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it.each<[string, MouseEventInit]>([
    ['ctrl', { ctrlKey: true }],
    ['meta', { metaKey: true }],
    ['shift', { shiftKey: true }],
    ['alt', { altKey: true }],
    ['right button', { button: 2 }],
    ['middle button', { button: 1 }],
  ])('a %s click is left to the browser: no apply, default not prevented', (_name, init) => {
    const { apply, link } = setup();
    expect(click(link, init)).toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });

  it('current: aria-current="true" and the purple ring instead of the neutral border', () => {
    const { link } = setup(true);
    expect(link.getAttribute('aria-current')).toBe('true');
    expect(link.className).toContain('border-purple-500');
    expect(link.className).toContain('ring-1');
    expect(link.className).toContain('ring-purple-500/50');
    expect(link.className).not.toContain('border-slate-700');
  });

  it('a status wins over current', () => {
    render(<KpiTile label="Total spend" value="$1.50" status="amber" filter={{ href: HREF, apply: jest.fn(), current: true }} />);
    const link = screen.getByRole('link', { name: 'Total spend, $1.50, needs a look' });
    expect(link.className).toContain('border-amber-500/40');
    expect(link.className).not.toContain('ring-purple-500/50');
  });
});

describe('KpiTile with no target (K-6, L-2a)', () => {
  it('is a group carrying the K-7 name: not a link, not a button, not a region', () => {
    render(<KpiTile label="Avg cost per call" value="$0.50" sub="per call" testId="kpi-avg" />);
    const tile = screen.getByRole('group', { name: 'Avg cost per call, $0.50' });
    expect(tile.tagName).toBe('DIV');
    expect(tile.getAttribute('data-testid')).toBe('kpi-avg');
    expect(document.getElementById(tile.getAttribute('aria-describedby')!)?.textContent).toBe('per call');
    expect(tile.className).toContain('border-slate-700');
    expect(tile.className).not.toContain('hover:');
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryAllByRole('region')).toHaveLength(0);
    expect(document.querySelector('section')).toBeNull();
  });
});

describe('the amber status (K-4, L-2a)', () => {
  it('says "Needs a look" with a hidden icon, an amber card, and the status in its name', () => {
    render(<KpiTile label="Total spend" value="$1.50" status="amber" href="#spend" />);
    const link = screen.getByRole('link', { name: 'Total spend, $1.50, needs a look' });
    expect(link.textContent).toContain('Needs a look');
    const icon = link.querySelector('svg');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
    expect(link.className).toContain('border-amber-500/40');
    expect(link.className).not.toContain('border-slate-700');
    expect(link.getAttribute('data-status')).toBe('amber');
    expect(link.querySelector('.text-amber-300')).not.toBeNull();
  });
});
