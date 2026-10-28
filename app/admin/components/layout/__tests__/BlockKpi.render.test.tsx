/**
 * @jest-environment jsdom
 *
 * Money MK-3a (SA-Q-MK3-8, T-14): `BlockKpi`, promoted from Finance to the
 * shared layout folder. Its markup is byte-identical to the Finance copy it
 * replaces: the hash below was taken from the Finance component on origin/main
 * (f8d32d60) with the same props, before the move. Finance's two callers
 * (Credits, Client payments) and the Leak check use it.
 */

import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { createHash } from 'crypto';

import { BlockKpi } from '@/app/admin/components/layout/BlockKpi';

const normalise = (html: string) => html.replace(/:r[0-9a-z]+:/g, ':id:');
const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

describe('BlockKpi (shared since MK-3a)', () => {
  it('a group named "label, value", the value, the pill, and the chip when given', () => {
    render(
      <BlockKpi
        label="Accounts over allowance"
        value="3"
        indicator={{ kind: 'leading', definition: 'Accounts whose credit use is above their allowance.' }}
        chip={{ tone: 'warn', label: '1 far over' }}
        testId="credits-over"
      />
    );
    const box = screen.getByTestId('credits-over-kpi');
    expect(box).toHaveAttribute('role', 'group');
    expect(box).toHaveAttribute('aria-label', 'Accounts over allowance, 3');
    expect(screen.getByTestId('credits-over')).toHaveTextContent('3');
    expect(screen.getByTestId('credits-over-chip')).toHaveTextContent('1 far over');
    expect(box).toHaveTextContent('Leading');
  });

  it('no chip when there is nothing to flag', () => {
    render(<BlockKpi label="L" value="0" indicator={{ kind: 'lagging', definition: 'D.' }} chip={null} testId="x" />);
    expect(screen.queryByTestId('x-chip')).toBeNull();
  });

  it('renders byte-identically to the Finance copy it replaced', () => {
    const { container } = render(
      <BlockKpi
        label="Businesses taking client payments"
        value="At least 4"
        indicator={{ kind: 'leading', definition: 'Businesses with a client payment in the window.' }}
        testId="takings"
      />
    );
    expect(sha256(normalise(container.innerHTML))).toBe(BLOCK_KPI_SHA256);
  });
});

/** Recorded from `app/admin/finance/components/BlockKpi.tsx` on origin/main f8d32d60, before the move. */
const BLOCK_KPI_SHA256 = 'd25574961e3c6024f6e360f006642c3e9f4ff9ab68fb8037f46731c18f71dfe0';

// ── Client payments in approximate dollars (FIN BD-56, slice 1b, SA-Q-5, CPU-5): the optional note ──
// Appended only: the cases above, and the hash, are unedited.
describe('BlockKpi note (slice 1b, SA-Q-5)', () => {
  it('N-1: a note renders inside the group, under the figure; the accessible name is unchanged', () => {
    render(
      <BlockKpi
        label="Client payments processed"
        value="≈ $12,346"
        indicator={{ kind: 'lagging', definition: 'D.' }}
        note="Our customers' revenue, not ours"
        testId="takings-usd"
      />
    );
    const box = screen.getByTestId('takings-usd-kpi');
    expect(box).toHaveAttribute('aria-label', 'Client payments processed, ≈ $12,346');
    const note = screen.getByTestId('takings-usd-note');
    expect(note).toHaveTextContent("Our customers' revenue, not ours");
    expect(box).toContainElement(note);
  });

  it('N-2: no note prop, no note element (the existing callers)', () => {
    render(<BlockKpi label="L" value="1" indicator={{ kind: 'leading', definition: 'D.' }} testId="y" />);
    expect(screen.queryByTestId('y-note')).toBeNull();
  });
});
