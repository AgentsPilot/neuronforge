/**
 * @jest-environment jsdom
 *
 * The one Model pricing table as the price comparison (AI model price review
 * slice 4; user decision UF-5; SA RC-4, RC-7, RC-9, N-1, N-2, NR-1, NR-4,
 * NR-5). Workplan cases T-1 to T-14; T-15 (save re-reads) is R-9 / R-13 in
 * `pages.render.test.tsx`.
 *
 * The comparison rows are built with the real `compareUnit` / `rowCoverage`,
 * so every colour, gap and label is the server's own.
 */

import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import type { ComparisonModel, ComparisonRow, PendingView } from '@/lib/ai/pricing-research/comparisonModel';
import { compareUnit, rowCoverage, type UnitComparisonInput } from '@/lib/ai/pricing-research/coverageColour';

const mockError = jest.fn();
// Slice 5: "Check provider prices" is tested on its own in providerPriceCheck.render.test.tsx.
// Here it is a static stand-in (no status read), so these page cases keep slice 4's call
// lists and timings.
jest.mock('@/app/admin/system-config/components/ProviderPriceCheck', () => ({
  __esModule: true,
  default: () => jest.requireActual('react').createElement('button', { type: 'button' }, 'Check provider prices'),
}));

jest.mock('@/lib/logger/client', () => {
  const logger: Record<string, unknown> = {
    info: jest.fn(),
    warn: jest.fn(),
    error: (...a: unknown[]) => mockError(...a),
    debug: jest.fn(),
  };
  logger.child = () => logger;
  return { clientLogger: logger };
});

import ModelPricingPage from '../page';
import { COMPARISON_URL, PRICING_URL, SERVER_NOW } from '../__fixtures__/priceComparison';

const OFFICIAL = 'https://developers.openai.com/api/docs/pricing';

function pendingView(unit: string, extra: Partial<PendingView> = {}): PendingView {
  return {
    lineId: `line-${unit}-${extra.sourceUrl ?? 'x'}`,
    proposalId: 'p-1',
    unit,
    sourceUrl: OFFICIAL,
    checkedOn: '2026-10-14',
    flags: [],
    flagLabels: [],
    crossCheck: 'not run',
    createdAt: '2026-10-14T10:00:00Z',
    createdBy: 'admin@example.com',
    ...extra,
  };
}

function row(
  modelName: string,
  inputs: UnitComparisonInput[],
  opts: Partial<ComparisonRow> & { used?: boolean } = {}
): ComparisonRow {
  const { used = false, ...rest } = opts;
  const units = inputs.map((input) => compareUnit(input, { usedByBusinessOs: used }));
  const coverage = rowCoverage(units);
  const gaps = units.map((unit) => unit.gapBasisPoints).filter((gap): gap is number => gap !== null);
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
    worstGapBasisPoints: gaps.length > 0 ? Math.min(...gaps) : null,
    pending: [],
    ...rest,
  };
}

const u = (unit: string, current: string | null, pending: string | null, basis: UnitComparisonInput['currentBasis'] = 'table') => ({
  unit,
  current,
  currentBasis: current === null ? ('unpriced' as const) : basis,
  pending,
});

const STORED = [
  { id: 'id-mini', provider: 'openai', model_name: 'gpt-4o-mini', input_cost_per_token: 0.00000015, output_cost_per_token: 0.0000006, effective_date: '2026-06-29' },
  { id: 'id-4o', provider: 'openai', model_name: 'gpt-4o', input_cost_per_token: 0.0000025, output_cost_per_token: 0.00001, effective_date: '2026-06-29' },
  { id: 'id-retired', provider: 'anthropic', model_name: 'claude-3-haiku', input_cost_per_token: 0.00000025, output_cost_per_token: 0.00000125, effective_date: '2024-01-01', retired_date: '2026-10-11' },
  { id: 'id-future', provider: 'openai', model_name: 'gpt-future-row', input_cost_per_token: 0.000001, output_cost_per_token: 0.000002, effective_date: '2026-11-01' },
  { id: 'id-old', provider: 'openai', model_name: 'gpt-older-row', input_cost_per_token: 0.000001, output_cost_per_token: 0.000002, effective_date: '2026-01-01' },
];

const ROWS: ComparisonRow[] = [
  row('gpt-4o', [u('input', '2.5', '2.75'), u('output', '10', '10')], {
    currentRowId: 'id-4o',
    used: true,
    areas: [
      { area: 'website', label: 'website', callNames: ['full_site'], enabled: true },
      { area: 'intake', label: 'intake', callNames: ['intake'], enabled: false },
    ],
    pending: [
      pendingView('tokens', {
        sourceUrl: 'https://example.com/pricing',
        flags: ['large_move', 'cached_input_listed'],
        flagLabels: [
          { flag: 'large_move', label: 'price moves more than 50%' },
          { flag: 'cached_input_listed', label: 'provider lists a cached-input price' },
        ],
      }),
    ],
  }),
  row('gpt-tiny', [u('input', '0.99999', '1'), u('output', '1', '1')], { pending: [pendingView('tokens')] }),
  row('gpt-4o-mini', [u('input', '0.15', '0.15'), u('output', '0.6', '0.6'), u('cached_input', '0.075', null, 'derived')], {
    currentRowId: 'id-mini',
    used: true,
    areas: [{ area: 'chat', label: 'chat', callNames: ['planner'], enabled: true }],
    pending: [pendingView('tokens')],
  }),
  row('cheap-model', [u('input', '1.35', '1'), u('output', '2', '2')], { pending: [pendingView('tokens')] }),
  row('claude-3-5-sonnet', [u('input', '3', null, 'in_code_fallback'), u('output', '15', null, 'in_code_fallback')], {
    provider: 'anthropic',
    currentBasis: 'in_code_fallback',
  }),
  row('unpriced-model', [u('input', null, null), u('output', null, null)], { used: true, usageLabel: 'leads' }),
  row('gpt-image-x', [u('image 1024x1024 high', null, '0.04'), u('image 1024x1024 low', null, '0.01')], {
    kind: 'image',
    pending: [
      pendingView('image 1024x1024 high', { flags: ['new_model'], flagLabels: [{ flag: 'new_model', label: 'not used yet' }] }),
      pendingView('image 1024x1024 low', { flags: ['new_model'], flagLabels: [{ flag: 'new_model', label: 'not used yet' }] }),
    ],
  }),
  row('gpt-image-1', [u('image 1024x1024 high', '0.25', '0.04', 'in_code_fallback')], { kind: 'image', provider: null }),
];

const MODEL: ComparisonModel = { generatedAt: SERVER_NOW, embedding: { status: 'not_set', label: 'x' }, rows: ROWS };

type Reply = { status: number; body?: unknown } | 'reject';

function stubFetch(comparison: Reply = { status: 200, body: { success: true, data: MODEL } }) {
  const calls: string[] = [];
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    const reply: Reply = url === COMPARISON_URL ? comparison : url === PRICING_URL ? { status: 200, body: { success: true, data: STORED } } : { status: 404 };
    if (reply === 'reject') throw new TypeError('Failed to fetch');
    return { ok: reply.status >= 200 && reply.status < 300, status: reply.status, json: async () => reply.body };
  }) as unknown as typeof fetch;
  return calls;
}

const rowOf = (name: string) => screen.getByText(name).closest('tr') as HTMLElement;
const cellsOf = (name: string) => within(rowOf(name)).getAllByRole('cell');

beforeEach(() => mockError.mockReset());
afterEach(() => jest.useRealTimers());

async function renderTable() {
  const calls = stubFetch();
  render(<ModelPricingPage />);
  await screen.findByText('gpt-4o-mini');
  return calls;
}

describe('one table: ours next to provider (UF-5)', () => {
  it('T-1: a joined row shows ours, provider and gap per unit, in the one table', async () => {
    await renderTable();
    expect(screen.getAllByRole('table')).toHaveLength(1);
    const cells = cellsOf('gpt-4o-mini').map((cell) => cell.textContent);
    // Model, Used by, then input ours / provider / gap (with the cached sub-line), output ours / provider / gap.
    expect(cells[2]).toContain('$0.15');
    expect(cells[3]).toContain('$0.15');
    expect(cells[4]).toContain('0.00%');
    expect(cells[5]).toBe('$0.6');
    expect(cells[6]).toBe('$0.6');
    expect(cells[7]).toBe('0.00%');
    // SA F-1: when the charged stored price took effect; none on a row with no stored price.
    expect(within(rowOf('gpt-4o-mini')).getByText('In effect since 2026-06-29')).toBeInTheDocument();
    expect(within(rowOf('claude-3-5-sonnet')).queryByText(/In effect since/)).not.toBeInTheDocument();
  });

  it('T-1b: the two-row header has unit groups and ours / provider / gap columns (NR-5)', async () => {
    await renderTable();
    expect(screen.getByRole('columnheader', { name: 'Input /1M' })).toHaveAttribute('scope', 'colgroup');
    expect(screen.getByRole('columnheader', { name: 'Output /1M' })).toHaveAttribute('scope', 'colgroup');
    expect(screen.getAllByRole('columnheader', { name: 'ours' })).toHaveLength(2);
    for (const header of screen.getAllByRole('columnheader', { name: 'gap' })) expect(header).toHaveAttribute('scope', 'col');
  });

  it('T-2: a red row says Undercharging in words and names the red unit; a sub-1 bp gap never reads 0.00%', async () => {
    await renderTable();
    const tr = rowOf('gpt-4o');
    const chip = within(tr).getByText('Undercharging');
    expect(chip).toHaveAttribute('data-tone', 'danger');
    expect(chip.textContent).toBe('Undercharging');
    expect(within(tr).getByTestId('row-summary')).toHaveTextContent('Undercharging: input -9.09%');
    expect(within(tr).getByText('-9.09%')).toBeInTheDocument();
    expect(within(rowOf('gpt-tiny')).getByText('less than -0.01%')).toBeInTheDocument();
  });

  it('T-3: ours above provider is green with the gap in text (BQ-3)', async () => {
    await renderTable();
    const tr = rowOf('cheap-model');
    expect(within(tr).getByText('Covered')).toHaveAttribute('data-tone', 'ok');
    expect(within(tr).getByText('+35.00%')).toBeInTheDocument();
  });

  it('T-4: a row with no new price is grey "No new price" and still shows ours exactly, with its basis', async () => {
    await renderTable();
    const tr = rowOf('claude-3-5-sonnet');
    expect(within(tr).getByText('No new price')).toHaveAttribute('data-tone', 'unknown');
    expect(within(tr).getByText('$3')).toBeInTheDocument();
    expect(within(tr).getAllByText('built-in fallback')).toHaveLength(2);
  });

  it('T-5: a pending-only image model reads "New model" and "not used yet"', async () => {
    await renderTable();
    const tr = rowOf('gpt-image-x');
    expect(within(tr).getByText('New model')).toBeInTheDocument();
    expect(within(tr).getByText('not used yet')).toBeInTheDocument();
  });

  it('T-6: a Business OS model with no price reads "Not priced"', async () => {
    await renderTable();
    const tr = rowOf('unpriced-model');
    expect(within(tr).getByText('Undercharging')).toBeInTheDocument();
    expect(within(tr).getByTestId('row-summary')).toHaveTextContent('input not priced, output not priced');
    expect(within(tr).getAllByText('not priced').length).toBeGreaterThan(0);
  });

  it('T-7: areas as chips, "(off)" when switched off; otherwise "not used by Business OS"', async () => {
    await renderTable();
    expect(within(rowOf('gpt-4o')).getByText('website')).toBeInTheDocument();
    expect(within(rowOf('gpt-4o')).getByText('intake (off)')).toBeInTheDocument();
    expect(within(rowOf('cheap-model')).getByText('not used by Business OS')).toBeInTheDocument();
  });

  it('T-8: flags in words; a blocking flag says it needs a reason to apply', async () => {
    await renderTable();
    const tr = rowOf('gpt-4o');
    expect(within(tr).getByText('price moves more than 50% (needs a reason to apply)')).toBeInTheDocument();
    expect(within(tr).getByText('provider lists a cached-input price')).toBeInTheDocument();
  });

  it('T-9: the cached sub-line shows on an OpenAI row with a derived value; an image row lists its units in one merged cell (NR-5)', async () => {
    await renderTable();
    const mini = rowOf('gpt-4o-mini');
    expect(within(mini).getByTestId('cached-ours')).toHaveTextContent('cached: $0.075 (derived: half of input)');
    expect(within(mini).getByTestId('cached-provider')).toHaveTextContent('cached: —');
    expect(within(rowOf('cheap-model')).queryByTestId('cached-ours')).not.toBeInTheDocument();

    const image = rowOf('gpt-image-1');
    const merged = within(image).getAllByRole('cell').find((cell) => cell.getAttribute('colspan') === '6');
    expect(merged).toBeDefined();
    const items = within(merged as HTMLElement).getAllByRole('listitem').map((item) => item.textContent);
    expect(items).toEqual(['1024x1024 high, per image: ours $0.25 (built-in fallback) · provider $0.04 · gap +525.00%']);
  });

  it('T-10: a source link only for an allowed host (RC-9), with the checked date', async () => {
    await renderTable();
    const link = within(rowOf('gpt-4o-mini')).getByRole('link', { name: 'Provider page' });
    expect(link).toHaveAttribute('href', OFFICIAL);
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(within(rowOf('gpt-4o-mini')).getByText('Checked 2026-10-14')).toBeInTheDocument();
    // An off-list host renders no link.
    expect(within(rowOf('gpt-4o')).queryByRole('link')).not.toBeInTheDocument();
  });

  it('T-11: retired, starts-later and superseded rows (RC-4, NR-1); Edit only where it is charged', async () => {
    // QA Bug 2: the browser clock is pinned far past every fixture date, so a
    // version that used the browser clock instead of the server's generatedAt
    // would call the 2026-11-01 row superseded, whatever today's real date is.
    // Only Date is faked; timers stay real for the testing library.
    jest.useFakeTimers({
      doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'performance', 'hrtime'],
    });
    jest.setSystemTime(new Date('2099-01-01T00:00:00.000Z'));
    await renderTable();
    // Intent kept; page layout slice (UF-7): retired and superseded rows show only with "Show retired" on.
    fireEvent.click(screen.getByTestId('show-retired-toggle'));
    expect(within(rowOf('claude-3-haiku')).getByText('Retired 2026-10-11')).toBeInTheDocument();
    expect(within(rowOf('claude-3-haiku')).queryByTitle('Edit pricing')).not.toBeInTheDocument();
    expect(within(rowOf('gpt-future-row')).getByText('Starts 2026-11-01')).toBeInTheDocument();
    expect(within(rowOf('gpt-future-row')).getByTitle('Edit pricing')).toBeInTheDocument();
    expect(within(rowOf('gpt-older-row')).getByText('Superseded by a newer row, not charged')).toBeInTheDocument();
    expect(within(rowOf('gpt-older-row')).queryByTitle('Edit pricing')).not.toBeInTheDocument();
    // A joined row keeps Edit; a comparison-only row has none.
    expect(within(rowOf('gpt-4o')).getByTitle('Edit pricing')).toBeInTheDocument();
    expect(within(rowOf('claude-3-5-sonnet')).queryByTitle('Edit pricing')).not.toBeInTheDocument();
  });

  it('T-11b: the editor fields say "per token" (NR-4)', async () => {
    await renderTable();
    fireEvent.click(within(rowOf('gpt-4o-mini')).getByTitle('Edit pricing'));
    expect(within(rowOf('gpt-4o-mini')).getByLabelText('Input, per token')).toBeInTheDocument();
    expect(within(rowOf('gpt-4o-mini')).getByLabelText('Output, per token')).toBeInTheDocument();
  });

  it('T-12: sort by gap, stored-only rows last', async () => {
    await renderTable();
    // Intent kept; page layout slice (UF-7): "Show retired" on, so every stored-only row is in the order.
    fireEvent.click(screen.getByTestId('show-retired-toggle'));
    // QA Bug 1: plain DOM queries and fireEvent keep this case well under a second.
    const order = () =>
      Array.from(document.querySelectorAll('tbody tr')).map((tr) => tr.querySelector('td .font-mono')?.textContent);

    expect(order()[0]).toBe('gpt-4o');
    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'undercharged' } });
    // SA F-3: red rows first, so the not-priced row (no gap) comes right after the red gaps.
    expect(order().slice(0, 3)).toEqual(['gpt-4o', 'gpt-tiny', 'unpriced-model']);
    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'above' } });
    expect(order().slice(0, 2)).toEqual(['gpt-image-1', 'cheap-model']);
    expect(order().slice(-3)).toEqual(['gpt-future-row', 'gpt-older-row', 'claude-3-haiku']);
  });

  it.each([
    ['a 500', { status: 500, body: { success: false, error: 'boom' } } as Reply],
    ['a 200 with success false', { status: 200, body: { success: false } } as Reply],
    ['a rejected fetch', 'reject' as Reply],
  ])('T-13: %s on the comparison fails the whole table (N-4)', async (_label, reply) => {
    stubFetch(reply);
    render(<ModelPricingPage />);
    await screen.findByText('Could not load model prices.');
    expect(screen.getByTestId('pricing-read-failed')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(mockError).toHaveBeenCalledWith(expect.objectContaining({ read: 'comparison' }), 'Price comparison read failed');
  });

  it('T-14: read-only note, notice rules, no Apply / Dismiss / History, one Check provider prices; toggle states', async () => {
    const calls = await renderTable();
    expect(calls.sort()).toEqual([`GET ${COMPARISON_URL}`, `GET ${PRICING_URL}`].sort());
    expect(screen.getByTestId('price-review-note')).toHaveTextContent('Nothing in the provider column is charged yet.');
    // Lines are pending, so no "nothing entered" notice.
    expect(screen.queryByTestId('no-pending-notice')).not.toBeInTheDocument();
    const names = screen.getAllByRole('button').map((button) => button.getAttribute('aria-label') ?? button.textContent ?? '');
    // Slice 5 deliberately adds the one "Check provider prices" button; Apply, Dismiss and History are still later slices.
    for (const name of names) expect(name).not.toMatch(/apply|dismiss|history/i);
    expect(names.filter((name) => /check|fetch/i.test(name))).toEqual(['Check provider prices']);
    expect(screen.getByTestId('pricing-toggle')).toHaveAttribute('aria-expanded', 'true');
  });

  it('T-14b: with nothing pending the notice names the button', async () => {
    const quiet: ComparisonModel = { ...MODEL, rows: ROWS.map((entry) => ({ ...entry, pending: [] })) };
    stubFetch({ status: 200, body: { success: true, data: quiet } });
    render(<ModelPricingPage />);
    expect(await screen.findByTestId('no-pending-notice')).toHaveTextContent('Use Enter provider price to add one.');
  });

  it('T-15 (SA F-4, NR-2): the table is busy while the comparison is re-read after a save, then not', async () => {
    // QA timing (one 5 s timeout under load): a save re-renders the whole page about six times, and with the
    // full ten-row fixture each render is the cost. Intent kept with only the row being saved, and one
    // waitFor on the busy flag replaces a no-op findByText plus a timer.
    const quiet: ComparisonModel = { ...MODEL, rows: ROWS.filter((r) => r.currentRowId === 'id-mini') };
    const storedMini = STORED.filter((r) => r.id === 'id-mini');
    let release: () => void = () => undefined;
    let comparisonReads = 0;
    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (url === COMPARISON_URL) {
        comparisonReads += 1;
        const reply = { ok: true, status: 200, json: async () => ({ success: true, data: quiet }) };
        if (comparisonReads === 1) return reply;
        // The re-read after the save waits until the test releases it.
        return new Promise((resolve) => {
          release = () => resolve(reply);
        });
      }
      const data = method === 'PUT' ? storedMini[0] : storedMini;
      return { ok: true, status: 200, json: async () => ({ success: true, data }) };
    }) as unknown as typeof fetch;

    render(<ModelPricingPage />);
    await screen.findByText('gpt-4o-mini');
    expect(screen.getByTestId('pricing-table-wrap')).not.toHaveAttribute('aria-busy');

    fireEvent.click(within(rowOf('gpt-4o-mini')).getByTitle('Edit pricing'));
    fireEvent.click(within(rowOf('gpt-4o-mini')).getByTitle('Save'));
    await screen.findByText('Pricing updated successfully!');
    expect(screen.getByTestId('pricing-table-wrap')).toHaveAttribute('aria-busy', 'true');

    release();
    await waitFor(() => expect(screen.getByTestId('pricing-table-wrap')).not.toHaveAttribute('aria-busy'));
    expect(within(rowOf('gpt-4o-mini')).getByTitle('Edit pricing')).toBeInTheDocument();
    expect(comparisonReads).toBe(2);
  });

  it('a row button opens the form pre-filled with that model', async () => {
    await renderTable();
    fireEvent.click(within(rowOf('gpt-4o')).getByRole('button', { name: 'Enter provider price for gpt-4o' }));
    const form = screen.getByRole('form', { name: 'Enter a provider price' });
    expect(within(form).getByLabelText('Model id')).toHaveValue('gpt-4o');
    expect(within(form).getByLabelText('Provider')).toHaveValue('openai');
  });

  it('an image row with no provider leaves Provider unselected (O-8)', async () => {
    await renderTable();
    fireEvent.click(within(rowOf('gpt-image-1')).getByRole('button', { name: 'Enter provider price for gpt-image-1' }));
    const form = screen.getByRole('form', { name: 'Enter a provider price' });
    expect(within(form).getByLabelText('Provider')).toHaveValue('');
    expect(within(form).getByLabelText('Image')).toBeChecked();
  });
});
