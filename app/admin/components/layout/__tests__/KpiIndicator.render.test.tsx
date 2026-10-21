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

import { KPI_INDICATOR_PILL, KPI_INDICATOR_WORDS, KpiIndicator, KpiStrip, KpiTile, tooltipClampFor, tooltipPlacementFor } from '@/app/admin/components/layout/KpiStrip';
import type { KpiIndicatorSpec, KpiTileProps } from '@/app/admin/components/layout/KpiStrip';

const LAGGING: KpiIndicatorSpec = { kind: 'lagging', definition: 'Cash owners paid us in the window.' };
const LEADING: KpiIndicatorSpec = { kind: 'leading', definition: 'Accounts that pay us now.' };

const tooltip = () => screen.getByRole('tooltip', { hidden: true });
const isOpen = () => !tooltip().hidden;

describe('the accessible name (LL-3) and the words (LL-2, LL-4)', () => {
  // MK-0a (ruled edit): the word pill replaced the clock / arrow icon; the accessible name is unchanged.
  it('lagging: "Lagging indicator. {definition}", the pill reads "Lagging", no icon', () => {
    render(<KpiTile label="Revenue" value="$10" href="#revenue" indicator={LAGGING} testId="tile-revenue" />);
    const icon = screen.getByRole('button', { name: 'Lagging indicator. Cash owners paid us in the window.' });
    expect(icon.getAttribute('type')).toBe('button');
    expect(icon.textContent).toBe('Lagging');
    expect(icon.querySelector('svg')).toBeNull();
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

  it('the pill is not colour-coded (LL-1, BD-11): a neutral border and secondary text, whatever the tile status', () => {
    render(<KpiTile label="Problems" value="2" status="red" href="#problems" indicator={LEADING} />);
    const icon = screen.getByRole('button');
    expect(icon.className).toContain('border-slate-600');
    expect(icon.className).toContain('text-slate-300');
    expect(icon.className).not.toMatch(/red|amber|green|emerald/);
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

  // MK-0a (ruled edit): the tooltip is the pill's sibling now (below the box), so a short close delay
  // lets the pointer cross from the pill to it (WCAG 1.4.13 hoverable).
  it('hover opens it, it stays open while the pointer moves onto the tooltip, and leaving both closes it after the delay', () => {
    jest.useFakeTimers();
    render(<KpiTile label="Revenue" href="#revenue" indicator={LAGGING} testId="t" />);
    const pill = screen.getByTestId('t-indicator');
    fireEvent.mouseEnter(pill);
    expect(isOpen()).toBe(true);
    fireEvent.mouseLeave(pill);
    fireEvent.mouseEnter(tooltip());
    act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(isOpen()).toBe(true);
    fireEvent.mouseLeave(tooltip());
    act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(isOpen()).toBe(false);
    jest.useRealTimers();
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
    // MK-0a (ruled edit): room for the pill, and the full cell height.
    expect(link.className).toContain('pr-20');
    expect(link.className).toContain('h-full');
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
    expect(absentHtml).not.toContain('pr-20');
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

// ── MK-0a (the user's decisions, 2026-10-19): the pill, the tooltip below the box, equal tiles ──
describe('MK-0a: the word pill, the tooltip placed against the box, equal tiles', () => {
  it('the pill reads "Leading" or "Lagging" (one copy each); the name keeps the full words', () => {
    expect(KPI_INDICATOR_PILL).toEqual({ leading: 'Leading', lagging: 'Lagging' });
    render(<KpiTile label="MRR" value="$49" href="#mrr" indicator={LEADING} />);
    const pill = screen.getByRole('button', { name: `Leading indicator. ${LEADING.definition}` });
    expect(pill.textContent).toBe('Leading');
  });

  it('the tooltip is a SIBLING of the tile link inside the box, never inside the link or its value', () => {
    render(<KpiTile label="Revenue" value="$10" href="#revenue" indicator={LAGGING} testId="k" />);
    const box = screen.getByTestId('k-box');
    const link = screen.getByRole('link');
    const tip = screen.getByTestId('k-indicator-tooltip');
    expect(tip.parentElement).toBe(box);
    expect(link.contains(tip)).toBe(false);
    expect(screen.getByTestId('k-indicator').contains(tip)).toBe(false);
    // After the link in the box: it opens below it, not over the value.
    expect(link.compareDocumentPosition(tip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(box.className).toContain('relative');
  });

  it('opens BELOW the box by default, the box width (left-0 right-0), with data-placement="below"', () => {
    render(<KpiTile label="Revenue" href="#revenue" indicator={LAGGING} testId="k" />);
    act(() => screen.getByRole('button').focus());
    const tip = screen.getByTestId('k-indicator-tooltip');
    expect(tip.getAttribute('data-placement')).toBe('below');
    expect(tip.className).toContain('top-full');
    expect(tip.className).toContain('left-0');
    expect(tip.className).toContain('right-0');
    expect(tip.className).not.toContain('bottom-full');
  });

  it('flips ABOVE the box when the viewport has too little room under it', () => {
    render(<KpiTile label="Revenue" href="#revenue" indicator={LAGGING} testId="k" />);
    const box = screen.getByTestId('k-box');
    const height = window.innerHeight;
    box.getBoundingClientRect = () => ({ top: height - 140, bottom: height - 40, left: 0, right: 200, width: 200, height: 100, x: 0, y: height - 140, toJSON: () => ({}) }) as DOMRect;
    act(() => screen.getByRole('button').focus());
    const tip = screen.getByTestId('k-indicator-tooltip');
    expect(tip.getAttribute('data-placement')).toBe('above');
    expect(tip.className).toContain('bottom-full');
    expect(tip.className).not.toContain('top-full');
  });

  it('the placement rule: below unless the room under is short AND there is more above', () => {
    expect(tooltipPlacementFor({ top: 100, bottom: 200 }, 800)).toBe('below');
    expect(tooltipPlacementFor({ top: 600, bottom: 700 }, 800)).toBe('above');
    expect(tooltipPlacementFor({ top: 20, bottom: 120 }, 200)).toBe('below');
  });

  it('a block KPI uses the same placement: the tooltip is the sibling of the pill inside its own box', () => {
    render(
      <div className="relative" data-testid="block-box">
        <span>Accounts over allowance</span>
        <KpiIndicator indicator={LEADING} testId="block" className="absolute right-2 top-2" />
      </div>
    );
    const tip = screen.getByTestId('block-tooltip');
    expect(tip.parentElement).toBe(screen.getByTestId('block-box'));
    expect(tip.getAttribute('data-placement')).toBe('below');
  });

  it('equal tiles: the strip has equal rows (auto-rows-fr) and equal columns; an indicator tile and its box fill the cell', () => {
    const { container } = render(
      <KpiStrip>
        <KpiTile label="A" value="1" href="#a" />
        <KpiTile label="A very long label that wraps over several lines in a narrow column" value="2" href="#b" indicator={LAGGING} testId="long" />
      </KpiStrip>
    );
    const strip = container.firstElementChild as HTMLElement;
    expect(strip.className).toMatch(/\bgrid\b/);
    expect(strip.className).toContain('auto-rows-fr');
    expect(strip.className).toMatch(/\bgrid-cols-2\b/);
    expect(strip.className).not.toMatch(/items-(start|center|end)/);
    expect(screen.getByTestId('long-box').className).toContain('h-full');
    expect(screen.getByTestId('long').className).toContain('h-full');
  });

  it('no click-through and Escape still consumed only while open (the MK-0 behaviour, unchanged)', () => {
    const apply = jest.fn();
    const outer = jest.fn();
    render(
      <div onKeyDown={(event) => event.key === 'Escape' && outer()}>
        <KpiTile label="P" value="1" filter={{ href: '/x', apply }} indicator={LEADING} />
      </div>
    );
    const pill = screen.getByRole('button');
    fireEvent.click(pill);
    expect(apply).not.toHaveBeenCalled();
    expect(isOpen()).toBe(true);
    fireEvent.keyDown(pill, { key: 'Escape' });
    expect(isOpen()).toBe(false);
    expect(outer).not.toHaveBeenCalled();
    fireEvent.keyDown(pill, { key: 'Escape' });
    expect(outer).toHaveBeenCalledTimes(1);
  });
});

// ── MK-0a QA findings (optional, fixed): the viewport clamp and the flip margin ──
describe('MK-0a QA: the tooltip stays inside the viewport; the flip keeps a margin', () => {
  const rectAt = (left: number, width: number, top = 100, height = 100) =>
    ({ left, right: left + width, width, top, bottom: top + height, height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

  it('clamp rule: fits → null (markup unchanged); a right-column tile on a 375px phone → right-aligned, the width capped by a 16px gutter', () => {
    expect(tooltipClampFor({ left: 16, right: 336, width: 320 }, 1024)).toBeNull();
    // Right column of a 2-column strip on a phone: the box is 160px wide, starting at 199px; 199 + 224 > 375 - 16.
    const clamp = tooltipClampFor({ left: 199, right: 359, width: 160 }, 375);
    expect(clamp).toEqual({ right: 0, left: 'auto', minWidth: 0, width: 224 });
    // Its left edge then sits at 359 - 224 = 135px: inside the gutter.
    expect(359 - clamp!.width).toBeGreaterThanOrEqual(16);
    // A box too near the left for 224px right-aligned: the width is capped to keep the left gutter.
    expect(tooltipClampFor({ left: 150, right: 200, width: 50 }, 210)).toEqual({ right: 0, left: 'auto', minWidth: 0, width: 184 });
  });

  it('a tile near the right edge renders its open tooltip right-aligned (data-align="end", inline right:0), inside the viewport', () => {
    const width = window.innerWidth;
    render(<KpiTile label="Paying" value="18%" href="#p" indicator={LAGGING} testId="k" />);
    screen.getByTestId('k-box').getBoundingClientRect = () => rectAt(width - 120, 104);
    act(() => screen.getByRole('button').focus());
    const tip = screen.getByTestId('k-indicator-tooltip');
    expect(tip.getAttribute('data-align')).toBe('end');
    expect(tip.style.right).toBe('0px');
    // jsdom's style parser drops left:auto; the browser keeps it, and right:0 pins the edge either way.
    expect(parseFloat(tip.style.width)).toBeLessThanOrEqual(width - 16);
  });

  it('a closed or fitting tooltip adds no style or align attribute (Pin A markup unchanged)', () => {
    render(<KpiTile label="Revenue" value="$10" href="#r" indicator={LEADING} testId="k" />);
    const tip = screen.getByTestId('k-indicator-tooltip');
    expect(tip.hasAttribute('style')).toBe(false);
    expect(tip.hasAttribute('data-align')).toBe(false);
    act(() => screen.getByRole('button').focus());
    expect(tip.hasAttribute('style')).toBe(false);
  });

  it('flip margin: it needs the measured height plus the gap and an 8px margin, not 2px of slack', () => {
    // 120px tall tooltip: needs 120 + 16 = 136px under the box (the old rule flipped only under 160, and ignored the height).
    expect(tooltipPlacementFor({ top: 500, bottom: 600 }, 600 + 140, 120)).toBe('below');
    // Exactly the needed room stays below; one pixel less flips.
    expect(tooltipPlacementFor({ top: 500, bottom: 600 }, 600 + 136, 120)).toBe('below');
    expect(tooltipPlacementFor({ top: 500, bottom: 600 }, 600 + 135, 120)).toBe('above');
    // Unmeasured (jsdom, first paint): the assumed 160px plus the margins.
    expect(tooltipPlacementFor({ top: 500, bottom: 600 }, 600 + 175, 0)).toBe('above');
    expect(tooltipPlacementFor({ top: 500, bottom: 600 }, 600 + 176, 0)).toBe('below');
  });
});

