/**
 * @jest-environment jsdom
 *
 * Model pricing page layout (AI model price review page layout slice, user
 * feedback UF-7, 2026-10-16): the "Show retired" toggle, the KPI strip and the
 * help drawer. Workplan §6.
 *
 * `ProviderPriceCheck` is a stand-in (as in the slice 5 page suites) that
 * reports `mockCheckStatus` through `onStatus` on mount, the way the real one
 * reports its own status read; the real component's read is tested in
 * `providerPriceCheck.render.test.tsx`.
 */

import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import type { ComparisonModel, ComparisonRow } from '@/lib/ai/pricing-research/comparisonModel';
import { compareUnit, rowCoverage, type UnitComparisonInput } from '@/lib/ai/pricing-research/coverageColour';
import type { FetchStatus } from '@/lib/ai/pricing-research/fetchOutcomes';

let mockCheckStatus: FetchStatus | null | undefined;
jest.mock('@/app/admin/system-config/components/ProviderPriceCheck', () => {
  const React = jest.requireActual('react');
  function MockProviderPriceCheck({ onStatus }: { onStatus?: (status: FetchStatus | null) => void }) {
    React.useEffect(() => {
      if (mockCheckStatus !== undefined) onStatus?.(mockCheckStatus);
    }, [onStatus]);
    return React.createElement('button', { type: 'button' }, 'Check provider prices');
  }
  return { __esModule: true, default: MockProviderPriceCheck };
});

jest.mock('@/lib/logger/client', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { clientLogger: logger };
});

import ModelPricingPage from '../page';
import { COMPARISON_URL, PRICING_URL, SERVER_NOW } from '../__fixtures__/priceComparison';

const u = (unit: string, current: string | null, pending: string | null): UnitComparisonInput => ({
  unit,
  current,
  currentBasis: current === null ? 'unpriced' : 'table',
  pending,
});

function row(modelName: string, inputs: UnitComparisonInput[], extra: Partial<ComparisonRow> = {}): ComparisonRow {
  const units = inputs.map((input) => compareUnit(input, { usedByBusinessOs: false }));
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

const pending = (lineId: string) => ({
  lineId,
  proposalId: 'p-1',
  unit: 'tokens',
  sourceUrl: 'https://developers.openai.com/api/docs/pricing',
  checkedOn: '2026-10-14',
  flags: [],
  flagLabels: [],
  crossCheck: 'not run',
  createdAt: '2026-10-14T10:00:00Z',
  createdBy: 'admin@example.com',
});

const STORED = [
  { id: 'id-4o', provider: 'openai', model_name: 'gpt-4o', input_cost_per_token: 0.0000022, output_cost_per_token: 0.00001, effective_date: '2026-06-29' },
  { id: 'id-mini', provider: 'openai', model_name: 'gpt-4o-mini', input_cost_per_token: 0.00000015, output_cost_per_token: 0.0000006, effective_date: '2026-06-29' },
  { id: 'id-retired', provider: 'anthropic', model_name: 'claude-3-haiku', input_cost_per_token: 0.00000025, output_cost_per_token: 0.00000125, effective_date: '2024-01-01', retired_date: '2026-10-11' },
  { id: 'id-old', provider: 'openai', model_name: 'gpt-older-row', input_cost_per_token: 0.000001, output_cost_per_token: 0.000002, effective_date: '2026-01-01' },
  { id: 'id-future', provider: 'openai', model_name: 'gpt-future-row', input_cost_per_token: 0.000001, output_cost_per_token: 0.000002, effective_date: '2026-11-01' },
];

// QA: two red rows and three red units (-5.00%, -12.00%, -5.00%), the worst neither first nor last, so the
// page pins the worst-gap choice. "off-model" has only a switched-off area (SA F-1: not in use).
const RED_ROWS: ComparisonRow[] = [
  row('red-first', [u('input', '0.95', '1')]),
  row('gpt-4o', [u('input', '2.2', '2.5'), u('output', '9.5', '10')], {
    currentRowId: 'id-4o',
    areas: [{ area: 'website', label: 'website', callNames: ['full_site'], enabled: true }],
    pending: [pending('l-1')],
  }),
  row('gpt-4o-mini', [u('input', '0.15', '0.15'), u('output', '0.6', '0.6')], { currentRowId: 'id-mini', pending: [pending('l-2')] }),
  row('quiet-model', [u('input', '1', null)]),
  row('off-model', [u('input', '1', null)], { areas: [{ area: 'chat', label: 'chat', callNames: ['planner'], enabled: false }] }),
];

const GREEN_ROWS: ComparisonRow[] = [
  row('gpt-4o', [u('input', '2.5', '2.5')], { currentRowId: 'id-4o' }),
  row('gpt-4o-mini', [u('input', '0.15', null)], { currentRowId: 'id-mini' }),
];

const status = (lastOkAt: string | null): FetchStatus => {
  const source = { lastRun: null, lastOkAt, lastFailure: null, lastRunCounts: null, lastRunVerdicts: null };
  return { lastRunAt: lastOkAt, openai: source, litellm: { ...source, lastOkAt: null }, manualProviders: ['anthropic', 'google', 'kimi'] };
};

type StoredRow = (typeof STORED)[number] & { retired_date?: string };

function stubFetch(rows: ComparisonRow[] | 'fail' = RED_ROWS, stored: readonly StoredRow[] = STORED) {
  const model: ComparisonModel = { generatedAt: SERVER_NOW, embedding: { status: 'not_set', label: 'x' }, rows: rows === 'fail' ? [] : rows };
  global.fetch = jest.fn(async (url: string) => {
    const reply =
      url === COMPARISON_URL
        ? rows === 'fail'
          ? { status: 500, body: { success: false, error: 'boom' } }
          : { status: 200, body: { success: true, data: model } }
        : url === PRICING_URL
          ? { status: 200, body: { success: true, data: stored } }
          : { status: 404, body: {} };
    return { ok: reply.status === 200, status: reply.status, json: async () => reply.body, text: async () => '' };
  }) as unknown as typeof fetch;
}

async function renderPage(rows: ComparisonRow[] | 'fail' = RED_ROWS, stored: readonly StoredRow[] = STORED) {
  stubFetch(rows, stored);
  render(<ModelPricingPage />);
  if (rows === 'fail') await screen.findByTestId('pricing-read-failed');
  else await screen.findByText('gpt-4o-mini');
}

// Within the table only, and the toggle by test id: role queries over the whole page are the slow part (QA timing).
const rowNames = () =>
  Array.from(screen.getByTestId('pricing-table-wrap').querySelectorAll('tbody tr')).map((tr) => tr.querySelector('td .font-mono')?.textContent);
const toggleOf = () => screen.getByTestId('show-retired-toggle');
const tile = (id: string) => screen.getByTestId(id);

beforeEach(() => {
  mockCheckStatus = status('2026-10-01T12:00:00.000Z');
});

describe('Show retired (UF-7): off by default; superseded rows follow it', () => {
  it('L-1a: off by default: retired and superseded rows hidden, a starts-later row shown, the count said', async () => {
    await renderPage();
    const toggle = toggleOf();
    expect(toggle).toHaveTextContent('Show retired');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    const names = rowNames();
    expect(names).not.toContain('claude-3-haiku');
    expect(names).not.toContain('gpt-older-row');
    // A row that starts later will be charged, so it always shows.
    expect(names).toContain('gpt-future-row');
    expect(screen.getByTestId('retired-hidden-line')).toHaveTextContent('2 retired or superseded rows hidden.');
  });

  it('L-1b: on shows them and drops the line; off hides them again', async () => {
    await renderPage();
    const toggle = toggleOf();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(rowNames()).toEqual(expect.arrayContaining(['claude-3-haiku', 'gpt-older-row', 'gpt-future-row']));
    expect(screen.queryByTestId('retired-hidden-line')).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(rowNames()).not.toContain('claude-3-haiku');
  });

  it('L-1c: one hidden row is said in the singular', async () => {
    await renderPage(RED_ROWS, STORED.filter((stored) => stored.id !== 'id-old'));
    expect(screen.getByTestId('retired-hidden-line')).toHaveTextContent(/^1 retired or superseded row hidden\.$/);
  });
});

describe('KPI strip (UF-7)', () => {
  it('L-2: Undercharging is red with the count and the worst gap in words', async () => {
    await renderPage();
    const undercharging = tile('kpi-undercharging');
    expect(undercharging).toHaveAttribute('data-status', 'red');
    expect(undercharging).toHaveAttribute('aria-label', 'Undercharging, 2, needs action');
    expect(within(undercharging).getByText('worst -12.00% (gpt-4o input)')).toBeInTheDocument();
    expect(within(undercharging).getByText('Needs action')).toBeInTheDocument();
  });

  it('L-3: Undercharging 0 is a neutral tile; Pending prices and Models in use count from the comparison', async () => {
    await renderPage(GREEN_ROWS);
    expect(tile('kpi-undercharging')).toHaveAttribute('data-status', 'neutral');
    expect(tile('kpi-undercharging')).toHaveAttribute('aria-label', 'Undercharging, 0');
    expect(tile('kpi-pending')).toHaveAttribute('aria-label', 'Pending prices, 0');
    expect(tile('kpi-models-in-use')).toHaveAttribute('aria-label', 'Models in use, 0');
  });

  it('L-4: Pending prices counts the pending lines; Models in use the rows with an area, of all compared', async () => {
    await renderPage();
    expect(tile('kpi-pending')).toHaveAttribute('aria-label', 'Pending prices, 2');
    expect(within(tile('kpi-pending')).getByText('awaiting Apply')).toBeInTheDocument();
    // "off-model" has only an "(off)" area, so it is not counted (SA F-1).
    expect(tile('kpi-models-in-use')).toHaveAttribute('aria-label', 'Models in use, 1');
    expect(within(tile('kpi-models-in-use')).getByText('of 5 compared')).toBeInTheDocument();
  });

  it('L-5: a check 13 days before the server time is neutral, with its time and age', async () => {
    await renderPage();
    const lastCheck = tile('kpi-last-check');
    await waitFor(() => expect(lastCheck).toHaveAttribute('aria-label', 'Last provider check, 2026-10-01 12:00 UTC'));
    expect(lastCheck).toHaveAttribute('data-status', 'neutral');
    expect(within(lastCheck).getByText('13 days ago')).toBeInTheDocument();
  });

  it('L-6: a check older than 90 days (pinned server date) is red, in words too', async () => {
    // SERVER_NOW is 2026-10-14T12:00Z; 2026-07-15 is 91 days earlier.
    mockCheckStatus = status('2026-07-15T12:00:00.000Z');
    await renderPage();
    const lastCheck = tile('kpi-last-check');
    await waitFor(() => expect(lastCheck).toHaveAttribute('data-status', 'red'));
    expect(lastCheck).toHaveAttribute('aria-label', 'Last provider check, 2026-07-15 12:00 UTC, needs action');
    expect(within(lastCheck).getByText('91 days ago; older than 90 days')).toBeInTheDocument();
  });

  it('L-7: never checked is red and says "never checked"', async () => {
    mockCheckStatus = status(null);
    await renderPage();
    const lastCheck = tile('kpi-last-check');
    await waitFor(() => expect(lastCheck).toHaveAttribute('aria-label', 'Last provider check, Never checked, needs action'));
    expect(within(lastCheck).getByText('never checked; use Check provider prices')).toBeInTheDocument();
  });

  it('L-8: a failed status read is "Unavailable", amber', async () => {
    mockCheckStatus = null;
    await renderPage();
    await waitFor(() => expect(tile('kpi-last-check')).toHaveAttribute('data-status', 'amber'));
    expect(tile('kpi-last-check')).toHaveAttribute('aria-label', 'Last provider check, Unavailable, needs a look');
  });

  it('L-8b: before any status report the tile reads "Reading…"', async () => {
    mockCheckStatus = undefined;
    await renderPage();
    expect(tile('kpi-last-check')).toHaveAttribute('aria-label', 'Last provider check, Reading…');
  });

  it('L-9: a failed table read draws no KPI strip (C2-4)', async () => {
    await renderPage('fail');
    expect(screen.queryByTestId('kpi-undercharging')).not.toBeInTheDocument();
  });
});

describe('Help drawer (UF-7)', () => {
  it('L-10: no always-open info box; ? opens the drawer, Esc closes it and focus returns', async () => {
    await renderPage();
    expect(screen.queryByText('About Model Pricing')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    const help = screen.getByTestId('pricing-help-button');
    expect(help).toHaveAccessibleName('About model pricing');
    fireEvent.click(help);

    const dialog = await screen.findByTestId('pricing-help-drawer');
    expect(dialog).toHaveAttribute('role', 'dialog');
    expect(dialog).toHaveAccessibleName('About model pricing');
    expect(within(dialog).getByText(/Copies a built-in price list, kept in the code/)).toBeInTheDocument();
    expect(within(dialog).getByText(/in effect on all servers within 1 hour/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Apply \(coming later\)/)).toBeInTheDocument();
    expect(within(dialog).getByText(/History \(coming later\)/)).toBeInTheDocument();
    expect(within(dialog).getByText(/will be removed in a later update, when Apply arrives/)).toBeInTheDocument();

    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(help).toHaveFocus();
  });
});
