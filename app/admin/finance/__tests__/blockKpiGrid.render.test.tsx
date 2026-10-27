/**
 * @jest-environment jsdom
 *
 * Block KPIs on the five-tile grid (the user's request of 2026-10-27;
 * docs/workplans/ADMIN_BLOCK_KPI_5_GRID_WORKPLAN.md). Every section headline
 * tile on Finance sits directly in the shared `KpiStrip`, the page-top strip's
 * own grid, so a single tile is one column of five and two tiles are two
 * equal columns, never a full-width or half-width box.
 *
 * The grid's classes are read from a bare `KpiStrip`, so the test follows the
 * top strip if its grid changes, and the five-column class is also named, so a
 * strip that stopped being five wide would fail here too.
 */

import '@testing-library/jest-dom';
import { render, screen, within } from '@testing-library/react';

import { KpiStrip } from '@/app/admin/components/layout/KpiStrip';
import { CreditsSection } from '../components/CreditsSection';
import { TakingsSection } from '../components/TakingsSection';
import { takingsSectionWith, usdOk } from './clientPaymentsUsdFixtures';
import type { FinanceCreditsSection } from '@/lib/business-os/finance/financeTypes';

function stripGridClass(): string {
  const { container, unmount } = render(<KpiStrip />);
  const className = (container.firstElementChild as HTMLElement).className;
  unmount();
  return className;
}

/** The tile's row: its parent is the strip's grid, and the row holds exactly `tiles` cells. */
function expectOnStripGrid(tileTestId: string, tiles: number, gridClass: string) {
  const row = screen.getByTestId(tileTestId).parentElement as HTMLElement;
  expect(row.className).toBe(gridClass);
  expect(row).toHaveClass('grid', 'auto-rows-fr', 'grid-cols-2', 'md:grid-cols-3', 'xl:grid-cols-5');
  expect(row.children).toHaveLength(tiles);
  return row;
}

const credits: FinanceCreditsSection = {
  status: 'ok',
  scope: 'all',
  farOverAllowancePercent: 150,
  figures: { accounts: 4, overAllowance: 1, farOverAllowance: 1, unknownAccounts: 0, noAllowanceAccounts: 0, rows: [] },
  gifted: null,
};

describe('Finance block KPIs on the five-tile grid', () => {
  it('Client payments, one tile (no dollar figure): one cell of the strip grid, not full width', () => {
    const gridClass = stripGridClass();
    render(<TakingsSection takings={takingsSectionWith(undefined)} windowLabel="This month" onRetry={() => undefined} />);
    const row = expectOnStripGrid('takings-businesses-kpi', 1, gridClass);
    expect(within(row).getByTestId('takings-businesses-kpi')).toHaveAttribute('role', 'group');
  });

  it('Client payments, two tiles (with the dollar figure): two cells of the same grid, the businesses tile first', () => {
    const gridClass = stripGridClass();
    render(<TakingsSection takings={takingsSectionWith(usdOk())} windowLabel="This month" onRetry={() => undefined} />);
    const row = expectOnStripGrid('takings-usd-kpi', 2, gridClass);
    expect(Array.from(row.children).map((c) => c.getAttribute('data-testid'))).toEqual(['takings-businesses-kpi', 'takings-usd-kpi']);
    // The existing hook still wraps the row, and the old two-column grid is gone.
    expect(screen.getByTestId('takings-headlines')).toContainElement(row);
    expect(screen.getByTestId('takings-headlines')).not.toHaveClass('sm:grid-cols-2');
  });

  it('Credits, one tile ("Accounts over allowance"): one cell of the strip grid', () => {
    const gridClass = stripGridClass();
    render(<CreditsSection credits={credits} windowLabel="This month" onRetry={() => undefined} />);
    expectOnStripGrid('credits-over-kpi', 1, gridClass);
    // The chip and the pill are unchanged inside the tile.
    expect(screen.getByTestId('credits-over-chip')).toBeInTheDocument();
    expect(screen.getByTestId('credits-over-kpi')).toHaveTextContent('Leading');
  });
});
