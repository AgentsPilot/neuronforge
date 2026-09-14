/**
 * What leaves the building.
 *
 * The privacy promise for this layer is "numbers, not names", and a promise
 * that depends on remembering to be careful is not a promise. These tests are
 * the mechanism: if a label or an id ever appears in the payload, they fail.
 */

import { buildAnalysisPayload } from '../analyse/payload';
import type { QueryResult } from '../types';

const grouped: QueryResult = {
  op: 'compute',
  entity: 'transactions',
  agg: { fn: 'sum', field: 'net_amount' },
  value: 931.33,
  groups: [
    { key: 'בדיקה 3', value: 600, id: '8742fcd8-fdfc-4e32-bb1f-c599cf72adf5' },
    { key: 'בדיקה 1', value: 331.33, id: '11111111-2222-3333-4444-555555555555' },
  ],
  approximate: false,
} as QueryResult;

const plain = (value: number | null): QueryResult =>
  ({ op: 'compute', entity: 'refunds', agg: { fn: 'sum', field: 'amount' }, value, approximate: false }) as QueryResult;

const build = (results: QueryResult[], question = 'which service earns most') =>
  buildAnalysisPayload({
    question,
    language: 'he',
    currency: 'USD',
    steps: results.map((_, i) => ({ id: `s${i + 1}` })),
    results,
  });

describe('names and ids never leave', () => {
  it('carries group values but not their labels or ids', () => {
    const payload = build([grouped]);
    const serialised = JSON.stringify(payload);

    expect(payload.steps[0].groups).toEqual([
      { ref: 'g1', value: 600 },
      { ref: 'g2', value: 331.33 },
    ]);

    // The whole payload, not just the field we happen to look at.
    expect(serialised).not.toContain('בדיקה');
    expect(serialised).not.toContain('8742fcd8');
    expect(serialised).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
  });

  it('keeps the order, so a ref can be resolved back to its label', () => {
    // g1 must be groups[0]. If this drifts, the rendered sentence names the
    // wrong service while looking entirely correct.
    const payload = build([grouped]);

    // `QueryResult` is a union and only its compute arm has groups — narrowed
    // here rather than left to `any`, so this test would notice if the shape
    // it is asserting about stopped existing.
    const source = grouped as { groups: Array<{ value: number }> };

    expect(payload.steps[0].groups?.[0].value).toBe(source.groups[0].value);
    expect(payload.steps[0].groups?.[1].value).toBe(source.groups[1].value);
  });

  it('describes WHAT was measured, never WHICH rows', () => {
    expect(build([grouped]).steps[0].measure).toBe('sum of transactions.net_amount');
  });
});

describe('the numbers themselves', () => {
  it('carries each step under its plan id', () => {
    const payload = build([plain(523), plain(408.33)]);

    expect(payload.steps.map((s) => [s.id, s.value])).toEqual([
      ['s1', 523],
      ['s2', 408.33],
    ]);
  });

  it('passes a null value through rather than coercing it', () => {
    // A step that matched nothing must arrive as null, so the sentence can
    // avoid claiming a figure. Zero would be a different, wrong, claim.
    expect(build([plain(null)]).steps[0].value).toBeNull();
  });

  it('marks an approximate aggregate so the sentence cannot overstate it', () => {
    const capped = { ...(plain(100) as object), approximate: true } as QueryResult;
    expect(build([capped]).steps[0].approximate).toBe(true);
  });

  it('omits groups entirely for an ungrouped aggregate', () => {
    expect(build([plain(523)]).steps[0].groups).toBeUndefined();
  });
});
