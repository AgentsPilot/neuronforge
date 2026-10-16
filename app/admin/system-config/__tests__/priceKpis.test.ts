/**
 * The Model pricing KPI figures (AI model price review page layout slice,
 * user feedback UF-7). Pure cases, plus the browser-file source rules of
 * slice 4 (RC-1, RC-2, RC-8) for the new file.
 *
 * Rows are built with the real `compareUnit` / `rowCoverage`, so every gap is
 * the server's own basis points.
 */

import * as fs from 'fs';
import * as path from 'path';

import type { AreaTag } from '@/lib/ai/pricing-research/areaTags';
import type { ComparisonRow, PendingView } from '@/lib/ai/pricing-research/comparisonModel';
import { compareUnit, rowCoverage, type UnitComparisonInput } from '@/lib/ai/pricing-research/coverageColour';
import type { FetchStatus, SourceStatus } from '@/lib/ai/pricing-research/fetchOutcomes';

import { lastCheckKpi, modelsInUseKpi, pendingKpi, underchargingKpi } from '../priceKpis';

const NOW = '2026-10-14T12:00:00.000Z';

const u = (unit: string, current: string | null, pending: string | null): UnitComparisonInput => ({
  unit,
  current,
  currentBasis: current === null ? 'unpriced' : 'table',
  pending,
});

function pendingView(lineId: string, unit = 'tokens'): PendingView {
  return {
    lineId,
    proposalId: 'p-1',
    unit,
    sourceUrl: 'https://developers.openai.com/api/docs/pricing',
    checkedOn: '2026-10-14',
    flags: [],
    flagLabels: [],
    crossCheck: 'not run',
    createdAt: '2026-10-14T10:00:00Z',
    createdBy: 'admin@example.com',
  };
}

function row(modelName: string, inputs: UnitComparisonInput[], extra: Partial<ComparisonRow> & { used?: boolean } = {}): ComparisonRow {
  const { used = false, ...rest } = extra;
  const units = inputs.map((input) => compareUnit(input, { usedByBusinessOs: used }));
  const coverage = rowCoverage(units);
  return {
    kind: 'token',
    provider: 'openai',
    modelName,
    currentRowId: null,
    areas: [],
    usedByBusinessOs: used,
    usageLabel: 'not used by Business OS',
    currentBasis: 'table',
    currentNote: null,
    units,
    colour: coverage.colour,
    redUnits: coverage.redUnits,
    summary: coverage.summary,
    worstGapBasisPoints: null,
    pending: [],
    ...rest,
  };
}

const source = (lastOkAt: string | null): SourceStatus => ({
  lastRun: null,
  lastOkAt,
  lastFailure: null,
  lastRunCounts: null,
  lastRunVerdicts: null,
});
const status = (lastOkAt: string | null): FetchStatus => ({
  lastRunAt: lastOkAt,
  openai: source(lastOkAt),
  litellm: source(null),
  manualProviders: ['anthropic', 'google', 'kimi'],
});

describe('Undercharging', () => {
  it('K-1: no red row is a neutral 0', () => {
    expect(underchargingKpi([row('gpt-4o', [u('input', '2.5', '2.5')])])).toEqual({
      value: '0',
      sub: 'no model is undercharged',
      status: null,
    });
  });

  it('K-2: counts red rows and names the single worst unit, red', () => {
    const rows = [
      row('gpt-4o', [u('input', '2.2', '2.5'), u('output', '10', '10')]), // input -12.00%
      row('gpt-tiny', [u('input', '0.95', '1'), u('cached_input', '0.4', '0.5')]), // -5.00%, cached -20.00%
      row('cheap-model', [u('input', '3', '2')]), // green
    ];
    expect(underchargingKpi(rows)).toEqual({ value: '2', sub: 'worst -20.00% (gpt-tiny cached input)', status: 'red' });
  });

  it('K-3: a red unit under 1 bp reads "less than -0.01%", never 0.00%', () => {
    expect(underchargingKpi([row('gpt-tiny', [u('input', '0.99999', '1')])]).sub).toBe('worst less than -0.01% (gpt-tiny input)');
  });

  it('K-4: red rows that are only "Not priced" say so', () => {
    const rows = [row('unpriced-model', [u('input', null, null), u('output', null, null)], { used: true })];
    expect(underchargingKpi(rows)).toEqual({ value: '1', sub: '1 not priced', status: 'red' });
  });
});

describe('Pending prices and Models in use', () => {
  it('K-5: distinct pending lines; an image line shown under two units counts once', () => {
    const rows = [
      row('gpt-4o', [u('input', '2.5', '2.75')], { pending: [pendingView('l-1')] }),
      row('gpt-image-x', [u('image 1024x1024 high', null, '0.04')], {
        kind: 'image',
        pending: [pendingView('l-2', 'image 1024x1024 high'), pendingView('l-2', 'image 1024x1024 low'), pendingView('l-3', 'image 1024x1024 high')],
      }),
      row('quiet', [u('input', '1', null)]),
    ];
    expect(pendingKpi(rows)).toEqual({ value: '3', sub: 'awaiting Apply', status: null });
    expect(pendingKpi([])).toEqual({ value: '0', sub: 'awaiting Apply', status: null });
  });

  it('K-6: rows with at least one switched-on area tag, of all compared rows (SA F-1)', () => {
    const on = (area: AreaTag['area']): AreaTag => ({ area, label: area, callNames: [area], enabled: true });
    const off = (area: AreaTag['area']): AreaTag => ({ area, label: area, callNames: [area], enabled: false });
    const rows = [
      row('gpt-4o', [u('input', '2.5', null)], { areas: [on('website')] }),
      // Its only tag is "(off)": not in use.
      row('gpt-4o-mini', [u('input', '0.15', null)], { areas: [off('chat')] }),
      // One off tag and one on tag: in use.
      row('mixed-model', [u('input', '1', null)], { areas: [off('intake'), on('leads')] }),
      row('quiet', [u('input', '1', null)]),
    ];
    expect(modelsInUseKpi(rows)).toEqual({ value: '2', sub: 'of 4 compared', status: null });
    expect(modelsInUseKpi([rows[1]])).toEqual({ value: '0', sub: 'of 1 compared', status: null });
  });
});

describe('Last provider check (now = the server generatedAt)', () => {
  it('K-7: not read yet, read failed, never checked', () => {
    expect(lastCheckKpi(undefined, NOW)).toEqual({ value: 'Reading…', sub: null, status: null });
    expect(lastCheckKpi(null, NOW)).toEqual({ value: 'Unavailable', sub: 'The last check could not be loaded.', status: 'amber' });
    expect(lastCheckKpi(status(null), NOW)).toEqual({
      value: 'Never checked',
      sub: 'never checked; use Check provider prices',
      status: 'red',
    });
  });

  it('K-8: a recent check is neutral, with its age', () => {
    expect(lastCheckKpi(status('2026-10-14T09:00:00.000Z'), NOW)).toEqual({ value: '2026-10-14 09:00 UTC', sub: 'today', status: null });
    expect(lastCheckKpi(status('2026-10-13T11:00:00.000Z'), NOW).sub).toBe('1 day ago');
    expect(lastCheckKpi(status('2026-10-01T12:00:00.000Z'), NOW).sub).toBe('13 days ago');
  });

  it('K-9: exactly 90 days is not stale; one millisecond more is red', () => {
    // 2026-10-14T12:00Z minus 90 days = 2026-07-16T12:00Z.
    expect(lastCheckKpi(status('2026-07-16T12:00:00.000Z'), NOW)).toEqual({ value: '2026-07-16 12:00 UTC', sub: '90 days ago', status: null });
    expect(lastCheckKpi(status('2026-07-16T11:59:59.999Z'), NOW)).toEqual({
      value: '2026-07-16 11:59 UTC',
      sub: '90 days ago; older than 90 days',
      status: 'red',
    });
  });

  it('K-10: the browser clock plays no part', () => {
    const real = Date.now;
    Date.now = () => Date.parse('2099-01-01T00:00:00.000Z');
    try {
      expect(lastCheckKpi(status('2026-10-01T12:00:00.000Z'), NOW).status).toBeNull();
    } finally {
      Date.now = real;
    }
  });
});

describe('priceKpis.ts source rules (slice 4 RC-1, RC-2, RC-8)', () => {
  const text = fs.readFileSync(path.join(process.cwd(), 'app/admin/system-config/priceKpis.ts'), 'utf8').replace(/\r\n/g, '\n');

  it('K-11: no console and no number parsing or formatting', () => {
    expect(text).not.toContain('console.');
    for (const banned of ['Number(', 'parseFloat(', 'parseInt(', 'toFixed(']) expect(text).not.toContain(banned);
  });

  it('K-12: server-only pricing-research modules are type imports; values only from coverageColour', () => {
    const lines = text.split('\n').filter((line) => line.includes("from '@/lib/ai/pricing-research/"));
    for (const line of lines) {
      const moduleName = line.match(/pricing-research[/]([A-Za-z]+)'/)?.[1] ?? '';
      if (['comparisonModel', 'fetchOutcomes'].includes(moduleName)) expect(line.startsWith('import type {')).toBe(true);
      else expect(moduleName).toBe('coverageColour');
    }
  });
});
