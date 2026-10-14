/**
 * The join and sort behind the one Model pricing table (AI model price review
 * slice 4; SA N-1, NR-1, O-9). Pure.
 */

import type { ComparisonRow } from '@/lib/ai/pricing-research/comparisonModel';

import { comparedRowFor, comparisonOf, SERVER_NOW, type StoredRowFixture } from '../__fixtures__/priceComparison';
import { bestGapBasisPoints, buildPriceTableRows, sortPriceTableRows } from '../priceTableRows';

const stored = (id: string, model: string, extra: Partial<StoredRowFixture> = {}): StoredRowFixture => ({
  id,
  provider: 'openai',
  model_name: model,
  input_cost_per_token: 0.00000015,
  output_cost_per_token: 0.0000006,
  effective_date: '2026-06-29',
  ...extra,
});

const gapRow = (model: string, gaps: Array<number | null>, provider: string | null = 'openai'): ComparisonRow => ({
  ...comparedRowFor(stored(`x-${model}`, model), { currentRowId: null, provider }),
  units: gaps.map((gap, index) => ({
    unit: index === 0 ? 'input' : 'output',
    current: '1',
    currentBasis: 'table' as const,
    pending: gap === null ? null : '1',
    colour: gap === null ? ('grey' as const) : gap < 0 ? ('red' as const) : ('green' as const),
    status: gap === null ? ('not_compared' as const) : gap < 0 ? ('undercharging' as const) : ('covered' as const),
    gapBasisPoints: gap,
    label: 'x',
  })),
  worstGapBasisPoints: gaps.some((gap) => gap !== null) ? Math.min(...gaps.filter((gap): gap is number => gap !== null)) : null,
  // Worst unit wins, as the server's rowCoverage does.
  colour: gaps.some((gap) => gap !== null && gap < 0) ? 'red' : gaps.some((gap) => gap !== null) ? 'green' : 'grey',
});

describe('buildPriceTableRows', () => {
  it('joins each comparison row to its stored row by currentRowId (N-1)', () => {
    const a = stored('a', 'model-a');
    const rows = buildPriceTableRows([a], comparisonOf([a]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'compared', stored: a });
  });

  it('a comparison row whose id has no stored match (the reads raced) has no stored row, so no Edit', () => {
    const a = stored('a', 'model-a');
    const rows = buildPriceTableRows([], comparisonOf([a]));
    expect(rows[0]).toMatchObject({ kind: 'compared', stored: null });
  });

  // QA mutation 5b: the join is by currentRowId only, never a fallback on provider + model name.
  it.each([
    ['null', null],
    ['an id with no stored row', 'no-such-id'],
  ])('a currentRowId of %s never joins an older same-model stored row by name; that row is superseded', (_label, rowId) => {
    const older = stored('older', 'model-a', { effective_date: '2026-01-01' });
    const compared = comparedRowFor(stored('ignored', 'model-a'), { currentRowId: rowId });
    const rows = buildPriceTableRows([older], comparisonOf([], [compared]));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ kind: 'compared', stored: null });
    expect(rows[1]).toMatchObject({ kind: 'superseded', stored: older });
  });

  it('a comparison-only row (fallback, image, pending-only) has no stored row', () => {
    const extra = comparedRowFor(stored('none', 'model-fallback'), { currentRowId: null, currentBasis: 'in_code_fallback' });
    const rows = buildPriceTableRows([], comparisonOf([], [extra]));
    expect(rows[0]).toMatchObject({ kind: 'compared', stored: null });
  });

  it('retired rows are labelled and go last', () => {
    const a = stored('a', 'model-a');
    const old = stored('r', 'model-old', { retired_date: '2026-10-11' });
    const rows = buildPriceTableRows([old, a], comparisonOf([a]));
    expect(rows.map((row) => row.kind)).toEqual(['compared', 'retired']);
    expect(rows[1]).toMatchObject({ retiredOn: '2026-10-11' });
  });

  it('NR-1: an unjoined row dated after the SERVER date starts later; one already in effect is superseded', () => {
    const a = stored('a', 'model-a');
    const future = stored('f', 'model-a', { effective_date: '2026-10-15' });
    const older = stored('o', 'model-a', { effective_date: '2026-01-01' });
    const today = stored('t', 'model-b', { effective_date: SERVER_NOW.slice(0, 10) });
    const rows = buildPriceTableRows([older, future, today, a], comparisonOf([a]));
    const byId = new Map(rows.filter((row) => row.kind !== 'compared').map((row) => [row.stored!.id, row]));
    expect(byId.get('f')).toMatchObject({ kind: 'starts_later', startsOn: '2026-10-15' });
    expect(byId.get('o')).toMatchObject({ kind: 'superseded' });
    // "Today" itself is in effect, so not "starts later".
    expect(byId.get('t')).toMatchObject({ kind: 'superseded' });
    // Order: compared, starts later, superseded, retired.
    expect(rows.map((row) => row.kind)).toEqual(['compared', 'starts_later', 'superseded', 'superseded']);
  });

  // QA Bug 2: the browser clock is pinned on the other side of the server date
  // in each direction, so a browser-clock version fails at any real date.
  describe('takes "today" from generatedAt, never the browser clock', () => {
    afterEach(() => jest.useRealTimers());

    it('server after the row, browser before it: superseded', () => {
      jest.useFakeTimers().setSystemTime(new Date('2020-01-01T00:00:00.000Z'));
      const row = stored('f', 'model-a', { effective_date: '2026-10-20' });
      const model = { ...comparisonOf([]), generatedAt: '2026-10-25T00:00:00.000Z' };
      expect(buildPriceTableRows([row], model)[0].kind).toBe('superseded');
    });

    it('server before the row, browser after it: starts later', () => {
      jest.useFakeTimers().setSystemTime(new Date('2099-01-01T00:00:00.000Z'));
      const row = stored('f', 'model-a', { effective_date: '2026-10-20' });
      const model = { ...comparisonOf([]), generatedAt: '2026-10-14T00:00:00.000Z' };
      expect(buildPriceTableRows([row], model)[0]).toMatchObject({ kind: 'starts_later', startsOn: '2026-10-20' });
    });
  });
});

describe('sortPriceTableRows (O-9)', () => {
  const rows = [
    gapRow('m-null', [null, null]),
    gapRow('m-plus', [3500, 100]),
    gapRow('m-minus', [-900, 0]),
    gapRow('m-tiny', [-1, 50]),
  ];
  const retired = stored('r', 'model-old', { retired_date: '2026-10-11' });
  const table = buildPriceTableRows([retired], { ...comparisonOf([]), rows });
  const names = (mode: 'recommended' | 'undercharged' | 'above') =>
    sortPriceTableRows(table, mode).map((row) => (row.kind === 'compared' ? row.comparison.modelName : `retired:${row.stored!.model_name}`));

  it('recommended keeps the server order, retired last', () => {
    expect(names('recommended')).toEqual(['m-null', 'm-plus', 'm-minus', 'm-tiny', 'retired:model-old']);
  });

  it('most undercharged first, null gaps last, retired after', () => {
    expect(names('undercharged')).toEqual(['m-minus', 'm-tiny', 'm-plus', 'm-null', 'retired:model-old']);
  });

  it('furthest above provider first uses the highest unit gap, null last', () => {
    expect(names('above')).toEqual(['m-plus', 'm-tiny', 'm-minus', 'm-null', 'retired:model-old']);
  });

  it('ties fall back to provider (null as empty) then model', () => {
    const tied = [gapRow('b', [10]), gapRow('a', [10], null), gapRow('c', [10], 'anthropic')];
    const sorted = sortPriceTableRows(buildPriceTableRows([], { ...comparisonOf([]), rows: tied }), 'undercharged');
    expect(sorted.map((row) => (row.kind === 'compared' ? row.comparison.modelName : ''))).toEqual(['a', 'c', 'b']);
  });

  it('most undercharged first: a red row under 1 bp (gap rounds to 0) sorts before a green row at 0', () => {
    const tiny = { ...gapRow('z-red', [0]), colour: 'red' as const };
    const sorted = sortPriceTableRows(buildPriceTableRows([], { ...comparisonOf([]), rows: [gapRow('a-green', [0]), tiny] }), 'undercharged');
    expect(sorted.map((row) => (row.kind === 'compared' ? row.comparison.modelName : ''))).toEqual(['z-red', 'a-green']);
  });

  it('SA F-3: most undercharged first puts a red row with no gap (not priced) before green and grey rows', () => {
    const notPriced = { ...gapRow('n-not-priced', [null]), colour: 'red' as const };
    const sorted = sortPriceTableRows(
      buildPriceTableRows([], { ...comparisonOf([]), rows: [gapRow('a-green', [500]), gapRow('b-grey', [null]), notPriced, gapRow('c-red', [-50])] }),
      'undercharged'
    );
    expect(sorted.map((row) => (row.kind === 'compared' ? row.comparison.modelName : ''))).toEqual([
      'c-red',
      'n-not-priced',
      'a-green',
      'b-grey',
    ]);
  });

  it('bestGapBasisPoints is the highest unit gap or null', () => {
    expect(bestGapBasisPoints(gapRow('x', [-5, 20]))).toBe(20);
    expect(bestGapBasisPoints(gapRow('y', [null]))).toBeNull();
  });
});
