/**
 * @jest-environment jsdom
 *
 * Block KPIs on the five-tile grid (the user's request of 2026-10-27;
 * docs/workplans/ADMIN_BLOCK_KPI_5_GRID_WORKPLAN.md): the AI cost page's Leak
 * check headline, "Businesses with uncharged calls", sits directly in the
 * shared `KpiStrip`, so it is one column of five like a top-strip tile. The
 * drawer variant still renders no KPI.
 */

import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';

import { KpiStrip } from '@/app/admin/components/layout/KpiStrip';
import { LeakCheckPanel } from '../components/costs/LeakCheckPanel';

let fetchMock: jest.Mock;
beforeEach(() => {
  fetchMock = jest.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
  (global as any).fetch = fetchMock;
});

describe('AI cost Leak check block KPI on the five-tile grid', () => {
  it('one tile: one cell of the strip grid; no read on mount', () => {
    const { container, unmount } = render(<KpiStrip />);
    const gridClass = (container.firstElementChild as HTMLElement).className;
    unmount();

    render(<LeakCheckPanel accountId="" accountLabel={null} />);
    const row = screen.getByTestId('leak-kpi-uncharged-kpi').parentElement as HTMLElement;
    expect(row.className).toBe(gridClass);
    expect(row).toHaveClass('grid', 'auto-rows-fr', 'grid-cols-2', 'md:grid-cols-3', 'xl:grid-cols-5');
    expect(row.children).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('the drawer variant: no KPI and no empty grid', () => {
    const { container } = render(<LeakCheckPanel accountId="" accountLabel={null} variant="drawer" />);
    expect(screen.queryByTestId('leak-kpi-uncharged-kpi')).toBeNull();
    expect(container.querySelector('.xl\\:grid-cols-5')).toBeNull();
  });
});
