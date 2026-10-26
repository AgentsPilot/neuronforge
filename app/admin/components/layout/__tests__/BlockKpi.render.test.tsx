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
const BLOCK_KPI_SHA256 = '99c6969c1c394f247177a882555aba230c92cad8208edf9a498e3c73bc24fad4';
