/**
 * @jest-environment node
 *
 * The Summary & checks bar's values (Admin Layout Standard L-9a; Money MK-2,
 * MK-3).
 *
 * Money MK-3b (SA-CR-MK3B F-2, ruled): the tab's own spec and request builder
 * are retired; their cases moved, retargeted to the page's one spec and its
 * report request, to `app/admin/ai-cost/__tests__/aiCostFilters.test.ts`. What
 * stays here: the bar's default and extra window equal the page spec's, so the
 * bar can never offer or reset to a window the page does not read.
 */

import * as fs from 'fs';
import * as path from 'path';

import { AI_COST_FILTER_SPEC } from '@/app/admin/ai-cost/aiCostFilters';
import { ANALYTICS_WINDOW_EXTRAS } from '@/app/admin/analytics/analyticsFilters';
import { COSTS_DEFAULT_WINDOW, COSTS_WINDOW_EXTRAS } from '../costsFilters';

describe('the bar values equal the page spec (MK-3b)', () => {
  // Money MK-2 (SA-7, ruled): the default moved from 30 days to This month.
  it('defaults to This month, the page spec’s default', () => {
    expect(COSTS_DEFAULT_WINDOW).toEqual({ kind: 'preset', preset: 'this_month' });
    expect(COSTS_DEFAULT_WINDOW).toEqual(AI_COST_FILTER_SPEC.window.defaultValue);
  });

  it('lists 90 days after the standard five (D-2 (b)), the page spec’s only extra; never 24 hours or since_start', () => {
    expect(COSTS_WINDOW_EXTRAS).toEqual(['90d']);
    expect(COSTS_WINDOW_EXTRAS).toEqual(ANALYTICS_WINDOW_EXTRAS);
    expect(COSTS_WINDOW_EXTRAS).not.toContain('24h');
    expect(COSTS_WINDOW_EXTRAS).not.toContain('since_start');
  });

  it('F-2: the retired spec and request builder are gone', () => {
    const code = fs.readFileSync(path.join(process.cwd(), 'app/admin/business-os-llm/costsFilters.ts'), 'utf8');
    expect(code).not.toMatch(/export const COSTS_FILTER_SPEC|export function costsRouteSearch/);
  });
});
