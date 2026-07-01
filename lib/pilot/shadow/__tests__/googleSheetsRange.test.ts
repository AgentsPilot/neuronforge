/**
 * Tests for the Google Sheets range resolver (Calibration Option A, Phase 2).
 * Injected metadata reader — no network. Covers the confidence heuristic +
 * no-clobber + A1 preservation + graceful failure.
 */

import { createGoogleSheetsRangeResolver, type SheetsTab } from '../parameterResolvers/googleSheetsRange';
import type { ResolverContext } from '../parameterResolvers/types';

const PARSE_ERR = '[EXECUTION_ERROR] Unable to parse range: Sheet1';

function ctx(overrides: Partial<ResolverContext> = {}): ResolverContext {
  return {
    currentValue: 'Sheet1',
    resolvedInputs: { spreadsheet_id: '1pM8abc', sheet_range: 'Sheet1' },
    stepParams: { range: '{{input.sheet_range}}', spreadsheet_id: '{{input.spreadsheet_id}}' },
    stepId: 'step1',
    userId: 'user-1',
    rawError: PARSE_ERR,
    ...overrides,
  };
}

function reader(tabs: SheetsTab[]) {
  return async () => tabs;
}

describe('googleSheetsRange resolver', () => {
  it('appliesTo only the "Unable to parse range" error', () => {
    const r = createGoogleSheetsRangeResolver(reader([]));
    expect(r.appliesTo(ctx())).toBe(true);
    expect(r.appliesTo(ctx({ rawError: 'Some other error' }))).toBe(false);
  });

  it('single tab → resolved (0.95) with the tab title', async () => {
    const r = createGoogleSheetsRangeResolver(reader([{ title: 'Leads', index: 0 }]));
    const res = await r.resolve(ctx());
    expect(res.status).toBe('resolved');
    if (res.status === 'resolved') {
      expect(res.value).toBe('Leads');
      expect(res.confidence).toBe(0.95);
    }
  });

  it('multiple tabs, no match → ambiguous; candidates[0] is the first tab by index', async () => {
    const r = createGoogleSheetsRangeResolver(reader([
      { title: 'Q1', index: 1 },
      { title: 'Leads', index: 0 }, // out of order on purpose
      { title: 'Q2', index: 2 },
    ]));
    const res = await r.resolve(ctx());
    expect(res.status).toBe('ambiguous');
    if (res.status === 'ambiguous') {
      expect(res.candidates[0].value).toBe('Leads'); // index 0 wins
      expect(res.candidates.map((c) => c.label)).toEqual(['Leads', 'Q1', 'Q2']);
    }
  });

  it('no-clobber: requested name already matches a real tab → unresolved', async () => {
    const r = createGoogleSheetsRangeResolver(reader([{ title: 'Sheet1', index: 0 }, { title: 'X', index: 1 }]));
    const res = await r.resolve(ctx({ currentValue: 'Sheet1' }));
    expect(res.status).toBe('unresolved');
  });

  it('preserves an A1 suffix (Sheet1!A1:B10 → Leads!A1:B10)', async () => {
    const r = createGoogleSheetsRangeResolver(reader([{ title: 'Leads', index: 0 }]));
    const res = await r.resolve(ctx({ currentValue: 'Sheet1!A1:B10' }));
    expect(res.status).toBe('resolved');
    if (res.status === 'resolved') expect(res.value).toBe('Leads!A1:B10');
  });

  it('no readable tabs → unresolved', async () => {
    const r = createGoogleSheetsRangeResolver(reader([]));
    expect((await r.resolve(ctx())).status).toBe('unresolved');
  });

  it('reader throws → unresolved (non-blocking)', async () => {
    const r = createGoogleSheetsRangeResolver(async () => { throw new Error('403'); });
    expect((await r.resolve(ctx())).status).toBe('unresolved');
  });

  it('no spreadsheet id available → unresolved', async () => {
    const r = createGoogleSheetsRangeResolver(reader([{ title: 'Leads', index: 0 }]));
    const res = await r.resolve(ctx({ resolvedInputs: {}, stepParams: { range: '{{input.sheet_range}}', spreadsheet_id: '{{input.spreadsheet_id}}' } }));
    expect(res.status).toBe('unresolved');
  });

  it('reads the spreadsheet id from the EP-key-hint input name too', async () => {
    const r = createGoogleSheetsRangeResolver(reader([{ title: 'Leads', index: 0 }]));
    const res = await r.resolve(ctx({ resolvedInputs: { 'google-sheets__table/get__spreadsheet_id': '1pM8abc' } }));
    expect(res.status).toBe('resolved');
  });
});
