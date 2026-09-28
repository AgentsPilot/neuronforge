/**
 * @jest-environment jsdom
 */

/**
 * QA probes for admin reorganisation slice 5, PR-1: the REAL evaluator output
 * rendered through the REAL tile component. Green (emerald) classes appear only
 * on a tile the evaluator proved clear; the entitlements tile has a visible,
 * descriptively named link to Plans & entitlements, a "Mode in effect" label,
 * and is never green in any mode.
 */

import React from 'react';
import { render, screen, within } from '@testing-library/react';

import { HealthTile } from '../components/health/HealthTile';
import { evaluateHealth, type HealthInputs } from '@/lib/admin/health/evaluateHealth';
import { computeHealthWindows } from '@/lib/admin/health/windows';

const W = computeHealthWindows(new Date('2026-09-27T10:30:00Z'));
const m = (value: number, exact = true) => ({ value, exact });
const GREEN = /\b(?:bg|text|border)-(?:green|emerald)-/;

function inputs(over: Partial<HealthInputs> = {}): HealthInputs {
  return {
    windows: W,
    settings: { ok: true, value: { areasOff: 0, callsOff: 0, ignored: 0, adjusted: 0, offAreas: [], ignoredAreas: [] } },
    failures: { ok: true, value: { failed24h: 0, failed7d: 0, completed24h: 0 } },
    spend: {
      ok: true,
      value: {
        sums: { spend24h: m(0), spendPrev24h: m(0), spend7d: m(0), spendPrev7d: m(0), calls24h: m(0), calls7d: m(0) },
        callsKnown: true,
      },
    },
    critical: { ok: true, value: { last24h: 0, last7d: 0 } },
    entitlements: { ok: true, value: { effective: 'shadow', refused: false } },
    ...over,
  };
}

function renderAll(i: HealthInputs) {
  const tiles = evaluateHealth(i);
  render(
    <div>
      {tiles.map((t) => (
        <HealthTile key={t.id} tile={t} />
      ))}
    </div>
  );
  return tiles;
}

const hasGreen = (el: HTMLElement) =>
  [el, ...Array.from(el.querySelectorAll('*'))].some((n) => GREEN.test((n as HTMLElement).className?.toString() ?? ''));

describe('QA S5 render: green only where the evaluator proved clear', () => {
  it('quiet day: 4 tiles green "Healthy", entitlements "For information", 6/7 "Not measured yet"', () => {
    const tiles = renderAll(inputs());
    for (const t of tiles) {
      const region = screen.getByTestId(`health-tile-${t.id}`);
      expect(hasGreen(region)).toBe(t.status === 'green');
    }
    expect(within(screen.getByTestId('health-tile-bos_ai_settings')).getByTestId('status-label').textContent).toContain('Healthy');
    expect(within(screen.getByTestId('health-tile-bos_ai_settings')).getByTestId('headline').textContent).toContain('All clear');
    expect(within(screen.getByTestId('health-tile-entitlements_mode')).getByTestId('status-label').textContent).toContain('For information');
    expect(within(screen.getByTestId('health-tile-scheduled_jobs')).getByTestId('status-label').textContent).toContain('Not measured yet');
    expect(within(screen.getByTestId('health-tile-queues')).getByTestId('status-label').textContent).toContain('Not measured yet');
  });

  it('every read failed: no green anywhere, "Could not check" on the five measured tiles', () => {
    renderAll(inputs({ settings: { ok: false }, failures: { ok: false }, spend: { ok: false }, critical: { ok: false }, entitlements: { ok: false } }));
    for (const id of ['bos_ai_settings', 'bos_ai_failures', 'bos_ai_spend', 'critical_audit', 'entitlements_mode']) {
      const region = screen.getByTestId(`health-tile-${id}`);
      expect(hasGreen(region)).toBe(false);
      expect(within(region).getByTestId('status-label').textContent).toContain('Could not check');
    }
  });

  it('a lower-bound spend renders amber "Needs a look", not green', () => {
    renderAll(
      inputs({
        spend: {
          ok: true,
          value: {
            sums: { spend24h: m(2, false), spendPrev24h: m(0), spend7d: m(2, false), spendPrev7d: m(0), calls24h: m(1001, false), calls7d: m(1001, false) },
            callsKnown: true,
          },
        },
      })
    );
    const region = screen.getByTestId('health-tile-bos_ai_spend');
    expect(hasGreen(region)).toBe(false);
    expect(within(region).getByTestId('status-label').textContent).toContain('Needs a look');
  });
});

describe('QA S5 render: the entitlements tile', () => {
  it.each([
    ['off', false, 'Off mode: Plans are not checked.', 'For information'],
    ['shadow', false, 'Shadow mode: Plans are checked and logged; nothing is blocked.', 'For information'],
    ['enforce', false, 'Enforce mode: Plan limits are applied to customers.', 'For information'],
    ['shadow', true, 'Enforcement requested but not active', 'Needs a look'],
  ] as const)('effective=%s refused=%s', (effective, refused, headline, label) => {
    renderAll(inputs({ entitlements: { ok: true, value: { effective, refused } } }));
    const region = screen.getByTestId('health-tile-entitlements_mode');
    expect(hasGreen(region)).toBe(false);
    expect(within(region).getByTestId('headline').textContent).toBe(headline);
    expect(within(region).getByTestId('status-label').textContent).toBe(label);
    expect(within(region).getByText('Mode in effect')).toBeTruthy();
    const link = within(region).getByRole('link', { name: 'Open Plans & entitlements (plans and account lookup)' });
    expect(link.getAttribute('href')).toBe('/admin/business-os-tiers');
    // Only one link on the tile: the mode word is no longer itself a link.
    expect(within(region).getAllByRole('link')).toHaveLength(1);
    if (refused) expect(region.textContent).toMatch(/launch gate refused it/);
    // No unlabelled number on the tile (FR-E3): the rule list is collapsed text, also digit-free.
    expect(region.textContent ?? '').not.toMatch(/\d/);
  });
});
