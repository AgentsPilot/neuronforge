/**
 * @jest-environment jsdom
 */

/**
 * Money MK-0 (KPI restructure review §3.3 LL-1 to LL-5, SA-8, BD-46): the
 * leading / lagging indicator on the shared KPI tile, and on its own for block
 * KPIs. Workplan docs/workplans/ADMIN_MONEY_MK0_KPI_INDICATOR_WORKPLAN.md §5.
 *
 * The icon is a sibling of the tile's link, never inside it, so a click on it
 * never follows the tile. With no indicator, every mode renders exactly as
 * before (Pin A, `KpiStrip.callers.pin.render.test.tsx`, holds the bytes).
 */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';

import { KPI_INDICATOR_WORDS, KpiIndicator, KpiTile } from '@/app/admin/components/layout/KpiStrip';
import type { KpiIndicatorSpec, KpiTileProps } from '@/app/admin/components/layout/KpiStrip';

const LAGGING: KpiIndicatorSpec = { kind: 'lagging', definition: 'Cash owners paid us in the window.' };
const LEADING: KpiIndicatorSpec = { kind: 'leading', definition: 'Accounts that pay us now.' };

const tooltip = () => screen.getByRole('tooltip', { hidden: true });
const isOpen = () => !tooltip().hidden;

describe('the accessible name (LL-3) and the words (LL-2, LL-4)', () => {
  it('lagging: "Lagging indicator. {definition}", a clock icon, hidden from the tree', () => {
    render(<KpiTile label="Revenue" value="$10" href="#revenue" indicator={LAGGING} testId="tile-revenue" />);
    const icon = screen.getByRole('button', { name: 'Lagging indicator. Cash owners paid us in the window.' });
    expect(icon.getAttribute('type')).toBe('button');
    expect(icon.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByTestId('tile-revenue-indicator').getAttribute('data-indicator')).toBe('lagging');
  });

  it('leading: "Leading indicator. {definition}"', () => {
    render(<KpiTile label="Paying" value="3" href="#plans" indicator={LEADING} />);
    expect(screen.getByRole('button', { name: 'Leading indicator. Accounts that pay us now.' })).toBeTruthy();
  });

  it('the tooltip has two lines: the definition, then the LL-2 line from the one copy constant', () => {
    render(<KpiTile label="Revenue" href="#revenue" indicator={LAGGING} />);
    const lines = Array.from(tooltip().children).map((line) => line.textContent);
    expect(lines).toEqual([LAGGING.definition, KPI_INDICATOR_WORDS.lagging.line]);
    expect(KPI_INDICATOR_WORDS).toEqual({
      leading: { name: 'Leading indicator', line: 'Leading indicator: it tells you early what is coming' },
      lagging: { name: 'Lagging indicator', line: 'Lagging indicator: it tells you what already happened' },
    });
  });

  it('the icon is not colour-coded (LL-1): no status colour on it, whatever the tile status', () => {
    render(<KpiTile label="Problems" value="2" status="red" href="#problems" indicator={LEADING} />);
    const icon = screen.getByRole('button');
    expect(icon.className).toContain('text-slate-400');
    expect(icon.className).not.toMatch(/red|amber|green/);
  });
});

describe('the tooltip (SA-8): role, aria-describedby, focus, hover, Escape', () => {
  it('is linked by aria-describedby and closed by default', () => {
    render(<KpiTile label="Revenue" href="#revenue" indicator={LAGGING} />);
    const icon = screen.getByRole('button');
    expect(icon.getAttribute('aria-describedby')).toBe(tooltip().id);
    expect(isOpen()).toBe(false);
  });

  it('focus shows it; blur hides it', () => {
    render(<KpiTile label="Revenue" href="#revenue" indicator={LAGGING} />);
    const icon = screen.getByRole('button');
    act(() => icon.focus());
    expect(document.activeElement).toBe(icon);
    expect(isOpen()).toBe(true);
    expect(screen.getByRole('tooltip').textContent).toContain(LAGGING.definition);
    act(() => icon.blur());
    expect(isOpen()).toBe(false);
  });

  it('Escape closes it and focus stays on the icon; a new focus opens it again', () => {
    render(<KpiTile label="Revenue" href="#revenue" indicator={LAGGING} />);
    const icon = screen.getByRole('button');
    act(() => icon.focus());
    expect(isOpen()).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(isOpen()).toBe(false);
    expect(document.activeElement).toBe(icon);
    act(() => icon.blur());
    act(() => icon.focus());
    expect(isOpen()).toBe(true);
  });

  it('Escape closes a hover-opened tooltip without moving the pointer (WCAG 1.4.13)', () => {
    render(<KpiTile label="Revenue" href="#revenue" indicator={LAGGING} testId="t" />);
    fireEvent.mouseEnter(screen.getByTestId('t-indicator'));
    expect(isOpen()).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(isOpen()).toBe(false);
  });

  it('hover opens it, it stays open over the tooltip itself, and leaving closes it', () => {
    render(<KpiTile label="Revenue" href="#revenue" indicator={LAGGING} testId="t" />);
    const box = screen.getByTestId('t-indicator');
    fireEvent.mouseEnter(box);
    expect(isOpen()).toBe(true);
    // The tooltip is inside the hover box, so pointing at it is not a leave.
    fireEvent.mouseOver(tooltip());
    expect(isOpen()).toBe(true);
    fireEvent.mouseLeave(box);
    expect(isOpen()).toBe(false);
  });

  it('a click opens it (touch) and a second click keeps it open; blur closes it and removes the Escape listener', () => {
    const spy = jest.spyOn(window, 'removeEventListener');
    render(<KpiTile label="Revenue" href="#revenue" indicator={LAGGING} />);
    const icon = screen.getByRole('button');
    fireEvent.click(icon);
    expect(isOpen()).toBe(true);
    fireEvent.click(icon);
    expect(isOpen()).toBe(true);
    act(() => icon.focus());
    act(() => icon.blur());
    expect(isOpen()).toBe(false);
    expect(spy).toHaveBeenCalledWith('keydown', expect.any(Function), { capture: true });
    spy.mockRestore();
  });
});

describe('QA-MK0-N1: Escape inside a drawer', () => {
  /**
   * A drawer-like parent with both kinds of Escape handler a real drawer can
   * have: a React `onKeyDown` on an ancestor, and a native capture listener on
   * the document (the shape Radix's `useEscapeKeydown` registers).
   */
  function renderInDrawer() {
    const reactClose = jest.fn();
    const documentClose = jest.fn();
    const onDocumentKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') documentClose();
    };
    document.addEventListener('keydown', onDocumentKey, { capture: true });
    const view = render(
      <div
        role="dialog"
        onKeyDown={(event) => {
          if (event.key === 'Escape') reactClose();
        }}
      >
        <KpiTile label="Revenue" href="#revenue" indicator={LAGGING} />
      </div>
    );
    const cleanup = () => document.removeEventListener('keydown', onDocumentKey, { capture: true });
    return { ...view, reactClose, documentClose, cleanup };
  }

  it('an OPEN tooltip consumes Escape: it closes, and neither drawer handler sees the key', () => {
    const { reactClose, documentClose, cleanup } = renderInDrawer();
    const icon = screen.getByRole('button');
    act(() => icon.focus());
    expect(isOpen()).toBe(true);
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => {
      icon.dispatchEvent(event);
    });
    expect(isOpen()).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(reactClose).not.toHaveBeenCalled();
    expect(documentClose).not.toHaveBeenCalled();
    cleanup();
  });

  it('a CLOSED tooltip lets Escape pass untouched, so the second press closes the drawer', () => {
    const { reactClose, documentClose, cleanup } = renderInDrawer();
    const icon = screen.getByRole('button');
    act(() => icon.focus());
    fireEvent.keyDown(icon, { key: 'Escape' });
    expect(isOpen()).toBe(false);
    expect(reactClose).not.toHaveBeenCalled();
    const second = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => {
      icon.dispatchEvent(second);
    });
    expect(second.defaultPrevented).toBe(false);
    expect(reactClose).toHaveBeenCalledTimes(1);
    expect(documentClose).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('a key other than Escape is never stopped while the tooltip is open', () => {
    const { reactClose, cleanup } = renderInDrawer();
    const parentKeys: string[] = [];
    const icon = screen.getByRole('button');
    icon.parentElement?.parentElement?.addEventListener('keydown', (event) => parentKeys.push(event.key));
    act(() => icon.focus());
    fireEvent.keyDown(icon, { key: 'Tab' });
    expect(parentKeys).toEqual(['Tab']);
    expect(isOpen()).toBe(true);
    expect(reactClose).not.toHaveBeenCalled();
    cleanup();
  });
});

describe('a click on the icon never follows the tile (LL-3)', () => {
  it('filter mode: the icon click does not apply the filter; the tile click still does', () => {
    const apply = jest.fn();
    render(<KpiTile label="Problems" value="2" filter={{ href: '/admin/x?scope=p', apply }} indicator={LEADING} />);
    fireEvent.click(screen.getByRole('button'));
    expect(apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('link'));
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('anchor and link modes: the icon is not inside the link, so its click reaches no link', () => {
    for (const props of [
      { href: '#revenue' as const },
      { link: '/admin/finance' as const },
    ]) {
      const clickedLinks: Array<Element | null> = [];
      const { unmount } = render(
        <div onClick={(event) => clickedLinks.push((event.target as Element).closest('a'))}>
          <KpiTile label="Revenue" value="$10" indicator={LAGGING} {...(props as Partial<KpiTileProps>)} />
        </div>
      );
      const link = screen.getByRole('link');
      const icon = screen.getByRole('button');
      expect(link.contains(icon)).toBe(false);
      expect(link.querySelector('button, [tabindex]')).toBeNull();
      fireEvent.click(icon);
      expect(clickedLinks).toEqual([null]);
      unmount();
    }
  });

  it("the link's own name and description are unchanged by the indicator", () => {
    render(<KpiTile label="Revenue" value="$10" sub="this month" href="#revenue" indicator={LAGGING} />);
    const link = screen.getByRole('link', { name: 'Revenue, $10' });
    expect(link.getAttribute('aria-describedby')).not.toContain(tooltip().id);
    expect(link.className).toContain('pr-9');
  });
});

describe('no indicator, no change (T-6)', () => {
  const MODES: Array<[string, KpiTileProps]> = [
    ['anchor', { label: 'Queues', value: '5', href: '#queues', testId: 'k' }],
    ['filter', { label: 'Stuck', value: '3', status: 'red', filter: { href: '/admin/x?f=1', apply: () => undefined }, testId: 'k' }],
    ['link', { label: 'Revenue', value: '$1', link: '/admin/finance', sub: 'this month', testId: 'k' }],
    ['group', { label: 'Plans', value: '4', status: 'amber', detail: 'one is ending', testId: 'k' }],
  ];

  it.each(MODES)('%s: absent and null render the same HTML, with no button, no tooltip, no wrapper and no padding', (_mode, props) => {
    const absent = render(<KpiTile {...props} />);
    const absentHtml = absent.container.innerHTML.replace(/:r[0-9a-z]+:/g, ':id:');
    absent.unmount();
    const withNull = render(<KpiTile {...props} indicator={null} />);
    const nullHtml = withNull.container.innerHTML.replace(/:r[0-9a-z]+:/g, ':id:');
    expect(nullHtml).toBe(absentHtml);
    expect(withNull.container.querySelector('button, [role="tooltip"]')).toBeNull();
    expect(withNull.container.firstElementChild?.getAttribute('data-testid')).toBe('k');
    expect(absentHtml).not.toContain('pr-9');
    withNull.unmount();
  });
});

describe('block KPIs: KpiIndicator on its own (T-8)', () => {
  it('renders the same name, the tooltip and the Escape behaviour outside a tile', () => {
    render(
      <div className="relative">
        <h3>Accounts over allowance</h3>
        <KpiIndicator indicator={LEADING} testId="block-indicator" />
      </div>
    );
    const icon = screen.getByRole('button', { name: 'Leading indicator. Accounts that pay us now.' });
    act(() => icon.focus());
    expect(isOpen()).toBe(true);
    expect(screen.getByRole('tooltip').textContent).toContain(KPI_INDICATOR_WORDS.leading.line);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(isOpen()).toBe(false);
  });
});
