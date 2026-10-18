/**
 * @jest-environment jsdom
 *
 * The price history drawer (AI model price review slice 9; MP-FR-17, UF-4,
 * SA SC9-2, SC9-4, SC9-6, SC9-7, SC9-8, SC9-10, SC9-11). The body is mounted
 * directly for every state and sentence; one page-level case pins the wiring:
 * History on compared and stored-only rows, none on an image row without a
 * provider, exactly one GET when the drawer opens and no write, focus back on
 * the button when it closes.
 */

import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import type { ComparisonModel, ComparisonRow } from '@/lib/ai/pricing-research/comparisonModel';
import { compareUnit, rowCoverage } from '@/lib/ai/pricing-research/coverageColour';
import type { PriceHistoryData, PriceHistoryRow } from '@/lib/ai/pricing-research/priceHistorySchema';

jest.mock('@/app/admin/system-config/components/ProviderPriceCheck', () => ({
  __esModule: true,
  default: () => jest.requireActual('react').createElement('button', { type: 'button' }, 'Check provider prices'),
}));
jest.mock('@/lib/logger/client', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { clientLogger: logger };
});

import { PriceHistoryDrawerBody } from '../components/PriceHistoryDrawerBody';
import ModelPricingPage from '../page';
import { COMPARISON_URL, PRICING_URL, SERVER_NOW } from '../__fixtures__/priceComparison';
import { HISTORY_WORDS } from '../priceReviewCopy';

const HISTORY_URL = '/api/admin/model-pricing/history';

function historyRow(over: Partial<PriceHistoryRow>): PriceHistoryRow {
  return {
    rowId: 'row-1',
    status: 'current',
    prices: { kind: 'token', inputPer1m: '0.15', outputPer1m: '0.6', cachedInputPer1m: null, cachedNote: 'half_of_input', storedAsZero: false },
    effectiveDate: '2026-06-29',
    replacedOn: null,
    neverCharged: false,
    retiredOn: null,
    createdAt: '2026-06-29T10:00:00Z',
    provenance: { kind: 'none' },
    retirement: null,
    preReviewNote: true,
    syncRuns: [],
    moreSyncRuns: 0,
    ...over,
  };
}

function data(rows: PriceHistoryRow[], over: Partial<PriceHistoryData> = {}): PriceHistoryData {
  return {
    generatedAt: '2026-10-18T12:00:00.000Z',
    kind: 'token',
    provider: 'openai',
    modelName: 'gpt-4o-mini',
    truncated: false,
    auditTruncated: false,
    syncTruncated: false,
    units: rows.length > 0 ? [{ size: null, quality: null, rows }] : [],
    ...over,
  };
}

const ready = (value: PriceHistoryData) => ({ kind: 'ready' as const, data: value });

describe('the drawer body', () => {
  it('loading and error states use the shared admin words', () => {
    const { rerender } = render(<PriceHistoryDrawerBody state={{ kind: 'loading' }} emptyBasis={null} />);
    expect(screen.getByRole('status')).toHaveTextContent('Reading the price history…');
    rerender(<PriceHistoryDrawerBody state={{ kind: 'error', message: 'Could not read the price history. Try again in a moment.' }} emptyBasis={null} />);
    expect(screen.getByTestId('price-history-error')).toHaveTextContent('Could not read the price history.');
  });

  it.each([
    ['in_code_fallback', 'No stored price for this model. Charges use the built-in price list.'],
    ['unpriced', 'No stored price for this model. Charges use no price: this model is not priced.'],
  ])('the empty state names how the model is charged (%s)', (basis, words) => {
    render(<PriceHistoryDrawerBody state={ready(data([]))} emptyBasis={basis} />);
    expect(screen.getByTestId('history-empty')).toHaveTextContent(words);
  });

  it('the current row: Charged today in words, prices as sent, the cached rule, read only', () => {
    render(<PriceHistoryDrawerBody state={ready(data([historyRow({})]))} emptyBasis="table" />);
    expect(screen.getByTestId('history-status-row-1')).toHaveTextContent('Charged today');
    const cells = within(screen.getByTestId('history-row-row-1')).getAllByRole('cell').map((cell) => cell.textContent);
    expect(cells[1]).toBe('0.15');
    expect(cells[2]).toBe('0.6');
    expect(cells[3]).toBe('not set (charged at half the input price)');
    expect(screen.getByText(HISTORY_WORDS.readOnly)).toBeInTheDocument();
    expect(screen.getByTestId('history-provenance-row-1')).toHaveTextContent('Before price review: no record in the live audit trail.');
    expect(screen.getByTestId('history-details-row-1')).toHaveTextContent(HISTORY_WORDS.preReview);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('an applied row: who, when, why, override, source, entered by, batch and margin review', () => {
    const row = historyRow({
      preReviewNote: false,
      provenance: {
        kind: 'applied',
        appliedBy: { kind: 'admin', email: 'a@example.com' },
        appliedAt: '2026-10-18T09:00:00Z',
        reason: 'Provider price change',
        overrideReason: 'Checked by hand',
        sourceUrl: 'https://developers.openai.com/api/docs/pricing',
        checkedOn: '2026-10-17',
        enteredBy: { kind: 'not_on_admin_list' },
        entrySource: 'fetch',
        batch: { lineCount: 3, marginReview: 'done', reviewedBy: { kind: 'system' }, reviewedAt: '2026-10-18T10:00:00Z', reviewNote: 'Plans fine' },
      },
    });
    render(<PriceHistoryDrawerBody state={ready(data([row]))} emptyBasis={null} />);
    const text = screen.getByTestId('history-provenance-row-1').textContent ?? '';
    expect(text).toContain('Applied by a@example.com on 2026-10-18 09:00 UTC.');
    expect(text).toContain('Reason: Provider price change');
    expect(text).toContain('Override reason: Checked by hand');
    expect(text).toContain('(checked 2026-10-17).');
    expect(text).toContain('Entered by not on the admin list, by the provider price check.');
    expect(text).toContain('Applied together with 2 other prices. Margin review: done by system on 2026-10-18 10:00 UTC: Plans fine');
    expect(screen.getByRole('link', { name: 'https://developers.openai.com/api/docs/pricing' })).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('the record missing, the runbook reference by row id, and the old audit with values as recorded', () => {
    const rows = [
      historyRow({ rowId: 'missing', provenance: { kind: 'provenance_missing' }, preReviewNote: false }),
      historyRow({ rowId: '549fcc6e-3f63-4d06-b959-71c77759a12e', provenance: { kind: 'runbook' }, createdAt: '2026-10-16T19:56:29Z', preReviewNote: false }),
      historyRow({
        rowId: 'audited',
        status: 'retired',
        provenance: {
          kind: 'audit',
          events: [
            { action: 'updated', by: { kind: 'admin', email: 'a@example.com' }, at: '2026-09-26T00:00:00Z', inputPer1m: '0.15', outputPer1m: '0.6', beforeInputPer1m: '0.075', beforeOutputPer1m: null },
            { action: 'created', by: { kind: 'system' }, at: '2026-09-25T00:00:00Z', inputPer1m: null, outputPer1m: null, beforeInputPer1m: null, beforeOutputPer1m: null },
          ],
        },
      }),
    ];
    render(<PriceHistoryDrawerBody state={ready(data(rows))} emptyBasis={null} />);
    expect(screen.getByTestId('history-provenance-missing')).toHaveTextContent('The record of this change could not be read.');
    expect(screen.getByTestId('history-provenance-549fcc6e-3f63-4d06-b959-71c77759a12e')).toHaveTextContent(
      'Changed by operator (emergency SQL runbook).Reference: emergency SQL runbook, run log entry for row 549fcc6e-3f63-4d06-b959-71c77759a12e, written 2026-10-16 19:56 UTC.'
    );
    const audit = screen.getByTestId('history-provenance-audited').textContent ?? '';
    expect(audit).toContain('Edited by a@example.com on 2026-09-26 00:00 UTC: Input /1M from 0.075 to 0.15, Output /1M 0.6 (as recorded).');
    expect(audit).toContain('Created by system on 2026-09-25 00:00 UTC: values not recorded.');
  });

  it('SA CR9-2 / CR9-5: an actor not recorded is said so; the footnote claims only recorded deletions', () => {
    const row = historyRow({
      provenance: {
        kind: 'audit',
        events: [{ action: 'created', by: { kind: 'not_recorded' }, at: '2026-09-25T00:00:00Z', inputPer1m: null, outputPer1m: null, beforeInputPer1m: null, beforeOutputPer1m: null }],
      },
    });
    render(<PriceHistoryDrawerBody state={ready(data([row]))} emptyBasis={null} />);
    expect(screen.getByTestId('history-provenance-row-1')).toHaveTextContent('Created by not recorded on 2026-09-25 00:00 UTC: values not recorded.');
    expect(screen.getByText('Prices deleted before 2026-10-16 are not listed here; the audit trail page shows any recorded deletion.')).toBeInTheDocument();
  });

  it('retirement words, never charged, until, stored as 0, and a cached rate other providers ignore', () => {
    const rows = [
      historyRow({ rowId: 'dup', status: 'retired', replacedOn: '2026-06-29', neverCharged: true, retiredOn: '2026-10-11', retirement: { kind: 'cleanup' } }),
      historyRow({ rowId: 'old', status: 'retired', replacedOn: '2026-10-18', retiredOn: '2026-10-18', retirement: { kind: 'replaced' } }),
      historyRow({ rowId: 'gone', status: 'retired', replacedOn: '2026-10-12', retiredOn: '2026-10-12', retirement: { kind: 'no_record' } }),
      historyRow({
        rowId: 'zero',
        status: 'not_charged',
        prices: { kind: 'token', inputPer1m: '0', outputPer1m: null, cachedInputPer1m: '0.3', cachedNote: 'stored_not_used', storedAsZero: true },
      }),
    ];
    render(<PriceHistoryDrawerBody state={ready(data(rows))} emptyBasis={null} />);
    expect(screen.getByTestId('history-retirement-dup')).toHaveTextContent(HISTORY_WORDS.cleanup);
    expect(screen.getByTestId('history-details-dup')).toHaveTextContent(HISTORY_WORDS.neverCharged);
    expect(screen.getByTestId('history-retirement-old')).toHaveTextContent(HISTORY_WORDS.replaced);
    expect(within(screen.getByTestId('history-row-old')).getByText('until 2026-10-18')).toBeInTheDocument();
    expect(screen.getByTestId('history-retirement-gone')).toHaveTextContent(HISTORY_WORDS.retiredNoRecord);
    expect(screen.getByTestId('history-status-zero')).toHaveTextContent('Stored, not charged');
    expect(screen.getByTestId('history-details-zero')).toHaveTextContent(HISTORY_WORDS.storedAsZero);
    const cells = within(screen.getByTestId('history-row-zero')).getAllByRole('cell').map((cell) => cell.textContent);
    expect(cells[2]).toBe('not readable');
    expect(cells[3]).toBe('0.3 (stored, not used for this provider)');
  });

  it('Sync runs with their caveat, the more line, and every truncation notice', () => {
    const run = { at: '2026-09-10T00:00:00Z', by: { kind: 'admin' as const, email: 'a@example.com' }, modelsUpdated: 3, modelsAdded: 1 };
    render(
      <PriceHistoryDrawerBody
        state={ready(data([historyRow({ syncRuns: [run], moreSyncRuns: 4 })], { truncated: true, auditTruncated: true, syncTruncated: true }))}
        emptyBasis={null}
      />
    );
    expect(screen.getByTestId('history-sync-run')).toHaveTextContent(
      'Sync ran on 2026-09-10 00:00 UTC by a@example.com (3 updated, 1 added) (all models; no per-model record; it may or may not have changed this price).'
    );
    expect(screen.getByText('and 4 more Sync runs in this period.')).toBeInTheDocument();
    expect(screen.getByTestId('history-truncated')).toHaveTextContent('Showing the newest 200 prices.');
    expect(screen.getByTestId('history-audit-truncated')).toHaveTextContent('Older audit events may not be shown.');
    expect(screen.getByTestId('history-sync-truncated')).toHaveTextContent('Older Sync runs may not be shown.');
  });

  it('image units are headed by size and quality, with the per-image price', () => {
    const value = data([], {
      kind: 'image',
      modelName: 'gpt-image-1-mini',
      units: [{ size: '1024x1024', quality: 'low', rows: [historyRow({ prices: { kind: 'image', perImage: '0.005', storedAsZero: false } })] }],
    });
    render(<PriceHistoryDrawerBody state={ready(value)} emptyBasis={null} />);
    expect(screen.getByRole('heading', { name: 'Image 1024x1024 low' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Per image' })).toBeInTheDocument();
    expect(within(screen.getByTestId('history-row-row-1')).getAllByRole('cell')[1]).toHaveTextContent('0.005');
  });
});

describe('the page wiring', () => {
  function comparedRow(modelName: string, extra: Partial<ComparisonRow> = {}): ComparisonRow {
    const units = [compareUnit({ unit: 'input', current: '0.15', currentBasis: 'table', pending: null }, { usedByBusinessOs: false })];
    const coverage = rowCoverage(units);
    return {
      kind: 'token',
      provider: 'openai',
      modelName,
      currentRowId: null,
      areas: [],
      usedByBusinessOs: false,
      usageLabel: 'not used by Business OS',
      currentBasis: 'table',
      currentNote: null,
      units,
      colour: coverage.colour,
      redUnits: coverage.redUnits,
      summary: coverage.summary,
      worstGapBasisPoints: null,
      pending: [],
      ...extra,
    };
  }

  const STORED = [
    { id: 'id-mini', provider: 'openai', model_name: 'gpt-4o-mini', input_cost_per_token: 0.00000015, output_cost_per_token: 0.0000006, effective_date: '2026-06-29' },
    { id: 'id-future', provider: 'openai', model_name: 'gpt-future-row', input_cost_per_token: 0.000001, output_cost_per_token: 0.000002, effective_date: '2026-11-01' },
  ];
  const MODEL: ComparisonModel = {
    generatedAt: SERVER_NOW,
    embedding: { status: 'not_set', label: 'x' },
    rows: [
      comparedRow('gpt-4o-mini', { currentRowId: 'id-mini' }),
      comparedRow('gpt-image-1', { kind: 'image', provider: null, currentBasis: 'in_code_fallback' }),
    ],
  };

  it('History on compared and stored-only rows, none without a provider; one GET, no write; focus returns', async () => {
    const calls: string[] = [];
    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url === COMPARISON_URL) return { ok: true, status: 200, json: async () => ({ success: true, data: MODEL }) };
      if (url === PRICING_URL) return { ok: true, status: 200, json: async () => ({ success: true, data: STORED }) };
      if (url.startsWith(HISTORY_URL)) return { ok: true, status: 200, json: async () => ({ success: true, data: data([historyRow({ rowId: 'id-mini' })]) }) };
      return { ok: false, status: 404, json: async () => ({}) };
    }) as unknown as typeof fetch;

    render(<ModelPricingPage />);
    await screen.findByText('gpt-4o-mini');
    expect(screen.getByRole('button', { name: 'Price history for gpt-4o-mini' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Price history for gpt-future-row' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Price history for gpt-image-1' })).not.toBeInTheDocument();

    const before = calls.length;
    const button = screen.getByTestId('history-c:token:openai:gpt-4o-mini');
    fireEvent.click(button);
    const drawer = await screen.findByTestId('price-history-drawer');
    expect(drawer).toHaveAccessibleName('Price history gpt-4o-mini');
    expect(await within(drawer).findByTestId('history-status-id-mini')).toHaveTextContent('Charged today');
    expect(calls.slice(before)).toEqual([`GET ${HISTORY_URL}?kind=token&provider=openai&model=gpt-4o-mini`]);

    fireEvent.keyDown(drawer, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('price-history-drawer')).not.toBeInTheDocument());
    expect(button).toHaveFocus();
    expect(calls.every((call) => call.startsWith('GET '))).toBe(true);
  });
});
