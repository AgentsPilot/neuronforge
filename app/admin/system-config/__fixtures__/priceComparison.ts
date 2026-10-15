/**
 * Test fixtures for the Model pricing page (AI model price review slice 4).
 * Builds comparison replies shaped exactly like
 * `GET /api/admin/model-pricing/comparison` from stored pricing rows, so a
 * suite can keep one list of rows and derive both replies from it.
 *
 * Test-only: imported by the suites under `../__tests__/`, never by the page.
 */

import type { ComparisonModel, ComparisonRow } from '@/lib/ai/pricing-research/comparisonModel';
import type { UnitComparison } from '@/lib/ai/pricing-research/coverageColour';

export const PRICING_URL = '/api/admin/system-config/pricing';
export const COMPARISON_URL = '/api/admin/model-pricing/comparison';
export const MANUAL_URL = '/api/admin/model-pricing/manual-entries';
/** Slice 5: the provider price check status, read once when the card opens. */
export const FETCH_RUNS_URL = '/api/admin/model-pricing/fetch-runs';

/** The server date used by every fixture reply (NR-1: "today" is the server's). */
export const SERVER_NOW = '2026-10-14T12:00:00.000Z';

export interface StoredRowFixture {
  id: string;
  provider: string;
  model_name: string;
  input_cost_per_token: number;
  output_cost_per_token: number;
  effective_date: string;
  retired_date?: string | null;
}

/**
 * Per token (a JSON number, as the pricing route sends it) to the per-1M
 * decimal string the comparison route sends. Test arithmetic only: rounded at
 * 9 decimals, the precision the route keeps.
 */
export function per1m(perToken: number): string {
  return String(Math.round(perToken * 1e15) / 1e9);
}

export function greyUnit(unit: string, current: string | null): UnitComparison {
  return {
    unit,
    current,
    currentBasis: current === null ? 'unpriced' : 'table',
    pending: null,
    colour: 'grey',
    status: 'not_compared',
    gapBasisPoints: null,
    label: current === null ? 'Not compared' : 'No new price',
  };
}

/** A grey "No new price" row for a stored row (what the route answers with nothing pending). */
export function comparedRowFor(row: StoredRowFixture, overrides: Partial<ComparisonRow> = {}): ComparisonRow {
  return {
    kind: 'token',
    provider: row.provider,
    modelName: row.model_name,
    currentRowId: row.id,
    areas: [],
    usedByBusinessOs: false,
    usageLabel: 'not used by Business OS',
    currentBasis: 'table',
    currentNote: 'stored price; charges pick a change up within 1 h',
    units: [greyUnit('input', per1m(row.input_cost_per_token)), greyUnit('output', per1m(row.output_cost_per_token))],
    colour: 'grey',
    redUnits: [],
    summary: 'Not compared',
    worstGapBasisPoints: null,
    pending: [],
    ...overrides,
  };
}

export function comparisonOf(rows: readonly StoredRowFixture[], extra: ComparisonRow[] = []): ComparisonModel {
  return {
    generatedAt: SERVER_NOW,
    embedding: { status: 'not_set', label: 'not set (service default applies)' },
    rows: [...rows.filter((row) => !row.retired_date).map((row) => comparedRowFor(row)), ...extra],
  };
}

export function okComparison(rows: readonly StoredRowFixture[], extra: ComparisonRow[] = []) {
  return { status: 200, body: { success: true, data: comparisonOf(rows, extra) } };
}
