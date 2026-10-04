/**
 * @jest-environment jsdom
 */

/**
 * The "Credits left" cell of a Businesses row (credit deduction slice 8a;
 * FR-48, AC-43; BD-21): the same percentage and band colour as the owner's
 * card, from the one band module; the text is always there; no counts.
 */

import React from 'react';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';

import { bandColor, type CreditBandId } from '@/lib/business-os/credits/creditBands';
import { CreditsLeftCell } from '../components/CreditsLeftCell';
import type { RowBusiness, RowCreditsLeft } from '../types';

const BUSINESS: RowBusiness = { companyName: 'Acme Therapy', vertical: 'therapist' };

/** jsdom reports colours as rgb(); compare through the same conversion. */
function rgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

const renderCell = (business: RowBusiness | null | undefined, creditsLeft?: RowCreditsLeft) =>
  render(<CreditsLeftCell business={business} creditsLeft={creditsLeft} />);

describe('CreditsLeftCell', () => {
  it.each<[string, RowCreditsLeft, string, CreditBandId]>([
    ['100%', { kind: 'percent', value: 100, trial: false }, '100%', 'plenty'],
    ['64%', { kind: 'percent', value: 64, trial: false }, '64%', 'plenty'],
    ['59%', { kind: 'percent', value: 59, trial: false }, '59%', 'comfortable'],
    ['29%', { kind: 'percent', value: 29, trial: false }, '29%', 'low'],
    ['10%', { kind: 'percent', value: 10, trial: false }, '10%', 'low'],
    ['9%', { kind: 'percent', value: 9, trial: false }, '9%', 'below_line'],
    ['less than 1%', { kind: 'less_than_one', trial: false }, 'less than 1%', 'below_line'],
    ['0%', { kind: 'percent', value: 0, trial: false }, '0%', 'below_line'],
  ])('%s: the text, and a dot in the band colour', (_name, credits, text, band) => {
    renderCell(BUSINESS, credits);
    const cell = screen.getByTestId('row-credits-left');
    // Colour is never the only signal: the percentage is written.
    expect(cell).toHaveTextContent(text);
    expect(cell).toHaveAttribute('data-band', band);
    expect(screen.getByTestId('row-credits-dot')).toHaveStyle({ backgroundColor: rgb(bandColor(band)) });
    expect(screen.queryByTestId('row-credits-trial')).toBeNull();
  });

  it('a trial carries a "trial" marker', () => {
    renderCell(BUSINESS, { kind: 'percent', value: 87, trial: true });
    expect(screen.getByTestId('row-credits-left')).toHaveTextContent('87%');
    expect(screen.getByTestId('row-credits-trial')).toHaveTextContent('trial');
  });

  it.each<[string, RowBusiness | null | undefined, RowCreditsLeft | undefined, string]>([
    ['no Business OS business', null, undefined, '—'],
    ['the business lookup failed', undefined, undefined, 'Unknown'],
    ['the figure could not be read', BUSINESS, { kind: 'unknown' }, 'Unknown'],
    ['the pass did not answer this row', BUSINESS, undefined, 'Unknown'],
    ['no allowance', BUSINESS, { kind: 'no_allowance' }, 'No allowance'],
  ])('%s → "%s"-style text, no colour dot', (_name, business, credits, text) => {
    renderCell(business, credits);
    expect(screen.getByTestId('row-credits-left')).toHaveTextContent(text);
    expect(screen.queryByTestId('row-credits-dot')).toBeNull();
  });

  it('shows no credit count, token or dollar', () => {
    const { container } = renderCell(BUSINESS, { kind: 'percent', value: 64, trial: true });
    expect(container.textContent).not.toMatch(/credit|token|\$|cost|usd|\d{3,}/i);
  });
});
