/**
 * rowsToObjects — WP-SR `preserve_case` config (2026-05-10)
 *
 * Background: the runtime helper that converts a 2D array (e.g. Google Sheets
 * `{values: [[headers], [row1], ...]}`) to an array of objects has lowercased
 * header names since V6 introduction ("Id" → "id" etc.). The compiler's
 * `normalizeDataFormats` Phase 3.5 auto-injects this step before any LLM
 * `transform/map` consuming the 2D array.
 *
 * The auto-inject path was silently dead for ~30 days because
 * SchemaAwareDataExtractor.analyzeOutputSchema() was a stub (restored in
 * f1804f4). With it restored, the auto-inject fires — but the lowercased
 * keys collide with what the LLM emits in its downstream `field_mapping`:
 * the LLM references `item["Date"]` / `item["Lead Name"]` (the original
 * Sheet headers it saw at intent time), but the runtime produces
 * `item["date"]` / `item["lead name"]` — every lookup returns undefined,
 * every row becomes `{}`, every downstream filter drops everything, and
 * the user gets an empty email.
 *
 * Fix: opt-in `config.preserve_case: true` keeps headers as-is (just trim
 * whitespace). The compiler's auto-inject sets it; existing direct callers
 * retain the default lowercase behavior for backward compat.
 */

import { rowsToObjects, RowsToObjectsError } from '../transforms/RowsToObjects';

const SHEET_2D_ARRAY = [
  ['Date', 'Lead Name', 'Stage', 'Email'],
  ['14/12/2025', 'Lead 1', '4', 'a@x.com'],
  ['12/12/2025', 'Lead 2', '3', 'b@x.com'],
];

describe('rowsToObjects — WP-SR preserve_case', () => {
  it('default (no config): lowercases headers (backward compat)', () => {
    const out = rowsToObjects(SHEET_2D_ARRAY, {});
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      date: '14/12/2025',
      'lead name': 'Lead 1',
      stage: '4',
      email: 'a@x.com',
    });
    expect(out[1]).toEqual({
      date: '12/12/2025',
      'lead name': 'Lead 2',
      stage: '3',
      email: 'b@x.com',
    });
  });

  it('preserve_case: true → headers kept as-is (the WP-SR fix)', () => {
    const out = rowsToObjects(SHEET_2D_ARRAY, { preserve_case: true });
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      Date: '14/12/2025',
      'Lead Name': 'Lead 1',
      Stage: '4',
      Email: 'a@x.com',
    });
  });

  it('preserve_case: false explicitly → lowercases (same as default)', () => {
    const out = rowsToObjects(SHEET_2D_ARRAY, { preserve_case: false });
    expect(out[0]).toHaveProperty('date');
    expect(out[0]).not.toHaveProperty('Date');
  });

  it('preserve_case: true still trims whitespace from headers', () => {
    const data = [
      ['  Date  ', '  Lead Name  ', 'Stage'],
      ['14/12/2025', 'Lead 1', '4'],
    ];
    const out = rowsToObjects(data, { preserve_case: true });
    expect(out[0]).toEqual({ Date: '14/12/2025', 'Lead Name': 'Lead 1', Stage: '4' });
  });

  it('chained with WP-4 field_mapping that references original-case headers', () => {
    // This is the exact failure mode the auto-inject path produced before WP-SR:
    // step1 (read_range) → step2 (rows_to_objects) → step3 (LLM transform/map
    // with field_mapping {date: "Date", lead_name: "Lead Name", stage: "Stage"})
    const objects = rowsToObjects(SHEET_2D_ARRAY, { preserve_case: true });

    // Apply the LLM's field_mapping (manually — Mode 0 in transformMap)
    const mapping: Record<string, string> = {
      date: 'Date',
      lead_name: 'Lead Name',
      stage: 'Stage',
      email: 'Email',
    };
    const mapped = objects.map((item: any) => {
      const out: Record<string, any> = {};
      for (const [target, src] of Object.entries(mapping)) {
        out[target] = item[src];
      }
      return out;
    });

    expect(mapped[0]).toEqual({
      date: '14/12/2025',
      lead_name: 'Lead 1',
      stage: '4',
      email: 'a@x.com',
    });
    // Crucially: NOT { date: undefined, lead_name: undefined, ... }
    expect(mapped[0].date).not.toBeUndefined();
    // And the downstream filter on `item.stage === '4'` would now find Lead 1.
    const filtered = mapped.filter((it: any) => it.stage === '4');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].lead_name).toBe('Lead 1');
  });

  it('without preserve_case the same chain produces empty objects (regression demo)', () => {
    // Demonstrates the bug pattern: with default lowercase, the LLM's mapping
    // references uppercase headers and gets all undefineds → downstream filter
    // drops everything → user gets empty email.
    const objects = rowsToObjects(SHEET_2D_ARRAY, {}); // default: lowercase

    const mapping: Record<string, string> = { date: 'Date', stage: 'Stage' };
    const mapped = objects.map((item: any) => {
      const out: Record<string, any> = {};
      for (const [target, src] of Object.entries(mapping)) {
        out[target] = item[src];
      }
      return out;
    });

    expect(mapped[0].date).toBeUndefined();
    expect(mapped[0].stage).toBeUndefined();
  });

  // Edge cases (carried over from original transformRowsToObjects contract)

  it('empty input → empty output', () => {
    expect(rowsToObjects([], { preserve_case: true })).toEqual([]);
  });

  it('non-2D input (already objects) → returned as-is', () => {
    const objs = [{ a: 1 }, { a: 2 }];
    expect(rowsToObjects(objs, { preserve_case: true })).toBe(objs);
  });

  it('non-array input → throws RowsToObjectsError', () => {
    expect(() => rowsToObjects('not an array' as any, {})).toThrow(RowsToObjectsError);
  });

  it('explicit headers config → uses those + skips no rows', () => {
    const data = [
      ['14/12/2025', 'Lead 1'],
      ['12/12/2025', 'Lead 2'],
    ];
    const out = rowsToObjects(data, { headers: ['Date', 'Lead Name'], preserve_case: true });
    // No header skip: both rows kept, both use the explicit headers as keys
    expect(out).toEqual([
      { Date: '14/12/2025', 'Lead Name': 'Lead 1' },
      { Date: '12/12/2025', 'Lead Name': 'Lead 2' },
    ]);
  });

  it('only-header-row input → empty result array', () => {
    const out = rowsToObjects([['Date', 'Lead Name']], { preserve_case: true });
    expect(out).toEqual([]);
  });
});

// ─── column_N positional access (LLM's non-canonical pattern) ──────────────

/**
 * Pure mirror of the column_N branch in StepExecutor.transformMap Mode 0.
 * Lets us test the cascade end-to-end without pulling StepExecutor's
 * heavy import chain.
 */
function applyFieldMapping(item: any, mapping: Record<string, string>): any {
  const COLUMN_N = /^column_(\d+)$/;
  const out: Record<string, any> = {};
  for (const [target, src] of Object.entries(mapping)) {
    let value: any;
    const colMatch = typeof src === 'string' ? src.match(COLUMN_N) : null;
    if (colMatch) {
      const idx = parseInt(colMatch[1], 10);
      if (Array.isArray(item)) {
        value = item[idx];
      } else if (item && typeof item === 'object') {
        value = Object.values(item)[idx];
      }
    } else {
      value = item ? item[src] : undefined;
    }
    out[target] = value;
  }
  return out;
}

describe('field_mapping with column_N source keys (WP-SR runtime tolerance)', () => {
  it('column_N on array-of-objects from rows_to_objects (the leads scenario)', () => {
    // The exact pipeline shape produced by:
    // step1 read_range → step2 rows_to_objects {preserve_case:true} → step3 map
    const objects = rowsToObjects(SHEET_2D_ARRAY, { preserve_case: true });
    const mapping: Record<string, string> = {
      Date: 'column_0',
      'Lead Name': 'column_1',
      Stage: 'column_2',
      Email: 'column_3',
    };
    const mapped = objects.map((it: any) => applyFieldMapping(it, mapping));

    expect(mapped[0]).toEqual({
      Date: '14/12/2025',
      'Lead Name': 'Lead 1',
      Stage: '4',
      Email: 'a@x.com',
    });

    // Downstream filter on capital-S Stage works (LLM-emitted target keys preserve case).
    const filtered = mapped.filter((it: any) => it.Stage === '4');
    expect(filtered).toHaveLength(1);
    expect(filtered[0]['Lead Name']).toBe('Lead 1');
  });

  it('column_N on raw 2D array (defensive — same pattern, different shape)', () => {
    // Some pipelines may not auto-inject — runtime should still cope.
    const rows = [
      ['14/12/2025', 'Lead 1', '4'],
      ['12/12/2025', 'Lead 2', '3'],
    ];
    const mapping: Record<string, string> = { Date: 'column_0', Stage: 'column_2' };
    const mapped = rows.map((it: any) => applyFieldMapping(it, mapping));
    expect(mapped[0]).toEqual({ Date: '14/12/2025', Stage: '4' });
  });

  it('column_N out-of-range → undefined for that field', () => {
    const item = { Date: '14/12/2025', 'Lead Name': 'Lead 1' };
    const mapped = applyFieldMapping(item, { Out: 'column_99' });
    expect(mapped.Out).toBeUndefined();
  });

  it('non-column_N source keys still resolve as property names', () => {
    const item = { Date: '14/12/2025' };
    const mapped = applyFieldMapping(item, { date: 'Date' });
    expect(mapped.date).toBe('14/12/2025');
  });

  it('mixed mapping: some column_N, some property names', () => {
    const item = { Date: '14/12/2025', 'Lead Name': 'Lead 1', Stage: '4' };
    const mapped = applyFieldMapping(item, {
      date: 'Date',          // property
      lead_name: 'column_1', // positional
      stage: 'Stage',        // property
    });
    expect(mapped).toEqual({ date: '14/12/2025', lead_name: 'Lead 1', stage: '4' });
  });
});
