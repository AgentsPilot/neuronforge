/**
 * @jest-environment jsdom
 *
 * "Check provider prices" (AI model price review slice 5; SA RR-1 monitoring,
 * SC-12, SC-13). The browser `fetch` is a stub that answers only the
 * fetch-runs route and fails the case on anything else (SC-16). `fireEvent`,
 * not `userEvent`, keeps every case well under a second.
 */

import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock('@/lib/logger/client', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { clientLogger: logger };
});

import ProviderPriceCheck from '../components/ProviderPriceCheck';
import { FETCH_RUNS_URL } from '../__fixtures__/priceComparison';
import type { FetchStatus, FetchRunSummary, ProviderOutcomes } from '@/lib/ai/pricing-research/fetchOutcomes';

type Reply = { status: number; body: unknown } | 'reject' | Promise<{ status: number; body: unknown }>;

const NO_COUNTS = { lastRunCounts: null, lastRunVerdicts: null };

function statusOf(overrides: Partial<FetchStatus> = {}): FetchStatus {
  return {
    lastRunAt: '2026-10-15T09:00:00.000Z',
    openai: {
      lastRun: { outcome: 'ok', at: '2026-10-15T09:00:00.000Z' },
      lastOkAt: '2026-10-15T09:00:00.000Z',
      lastFailure: { outcome: 'blocked', at: '2026-10-14T08:30:00.000Z' },
      lastRunCounts: { linesStored: 24, needsManual: 2, notFound: 2, refused: 0 },
      lastRunVerdicts: null,
    },
    // Slice 10: Anthropic is read automatically (deliberate edit of the slice 5 status double).
    anthropic: {
      lastRun: { outcome: 'ok', at: '2026-10-15T09:00:00.000Z' },
      lastOkAt: '2026-10-15T09:00:00.000Z',
      lastFailure: null,
      lastRunCounts: { linesStored: 8, needsManual: 0, notFound: 5, refused: 0 },
      lastRunVerdicts: null,
    },
    litellm: {
      lastRun: { outcome: 'ok', at: '2026-10-15T09:00:00.000Z' },
      lastOkAt: '2026-10-15T09:00:00.000Z',
      lastFailure: null,
      lastRunCounts: null,
      lastRunVerdicts: { agrees: 20, differs: 2, notListed: 1, unavailable: 0 },
    },
    manualProviders: ['google', 'kimi'],
    ...overrides,
  };
}

const OUTCOMES: ProviderOutcomes = {
  openai: {
    outcome: 'ok',
    fetched_at: '2026-10-15T09:00:00.000Z',
    duration_ms: 300,
    bytes: 23231,
    lines_stored: 24,
    needs_manual: [{ model_name: 'gpt-4o', reason: 'cell_not_single_price', cell: '$0.75 through December 31, 2026' }],
    not_found: ['gpt-4-turbo'],
    refused: [],
    name_notes: [],
  },
  // Slice 10 deliberate edit (SC10-2): a new round always carries Anthropic's adapter outcome.
  anthropic: {
    outcome: 'ok',
    fetched_at: '2026-10-15T09:00:00.000Z',
    duration_ms: 250,
    bytes: 50428,
    lines_stored: 7,
    needs_manual: [{ model_name: 'claude-sonnet-5', reason: 'cell_not_single_price', cell: '$2 / MTok<sup>3</sup>' }],
    not_found: ['claude-3-haiku-20240307'],
    refused: [],
    name_notes: [{ model_name: 'claude-opus-4-1-20250805', note: 'retired, except on Bedrock and Google Cloud' }],
  },
  google: { outcome: 'manual_only' },
  kimi: { outcome: 'manual_only' },
  litellm: { outcome: 'ok', fetched_at: '2026-10-15T09:00:00.000Z', duration_ms: 400, bytes: 2828373, agrees: 20, differs: 2, not_listed: 1, unavailable: 0 },
};
const SUMMARY: FetchRunSummary = { roundId: 'round-1', providerOutcomes: OUTCOMES, problems: [] };

function stub(getReply: () => Reply, postReply: () => Reply) {
  const calls: string[] = [];
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${url}`);
    if (url !== FETCH_RUNS_URL) throw new Error(`unexpected request ${method} ${url}`);
    const reply = await (method === 'POST' ? postReply() : getReply());
    if (reply === 'reject') throw new TypeError('Failed to fetch');
    return { ok: reply.status >= 200 && reply.status < 300, status: reply.status, json: async () => reply.body };
  }) as unknown as typeof fetch;
  return calls;
}

const okStatus = (status: FetchStatus = statusOf()) => () => ({ status: 200, body: { success: true, data: status } });

describe('status on load', () => {
  it('shows OpenAI read with counts, last success and last failure, the manual providers, LiteLLM and images', async () => {
    stub(okStatus(), () => ({ status: 500, body: {} }));
    render(<ProviderPriceCheck onFinished={jest.fn()} />);
    expect(await screen.findByText('OpenAI: 24 prices read 2026-10-15 09:00 UTC; 2 need manual entry; 2 not on the page')).toBeInTheDocument();
    // One for OpenAI, one for Anthropic (slice 10 deliberate edit: was two), one for the second list (F-6).
    expect(screen.getAllByText('Last successful check: 2026-10-15 09:00 UTC')).toHaveLength(3);
    expect(screen.getByText('Last failure: the provider blocked the check at 2026-10-14 08:30 UTC')).toBeInTheDocument();
    // Slice 10 deliberate edit: Anthropic is no longer manual entry.
    expect(screen.getByText('Google and Kimi: manual entry for now.')).toBeInTheDocument();
    expect(screen.getByText('Second price list (LiteLLM): 20 agree, 2 differ, 1 not listed.')).toBeInTheDocument();
    // SA F-6: the second list's own history, under its line.
    expect(screen.getAllByTestId('litellm-history').map((line) => line.textContent)).toEqual(['Last successful check: 2026-10-15 09:00 UTC']);
    expect(screen.getByText('Image prices: manual entry (OpenAI publishes them only in a calculator).')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check provider prices' })).toBeEnabled();
  });

  it.each([
    ['blocked', 'OpenAI: the provider blocked the check at 2026-10-15 09:00 UTC. Enter prices by hand.'],
    ['layout_changed', 'OpenAI: the pricing page layout changed; no prices were read at 2026-10-15 09:00 UTC. Enter prices by hand.'],
    ['timeout', 'OpenAI: the page did not answer within 10 seconds at 2026-10-15 09:00 UTC. Enter prices by hand.'],
    ['http_404', 'OpenAI: the page answered with status 404 at 2026-10-15 09:00 UTC. Enter prices by hand.'],
  ])('OpenAI %s is said in words', async (outcome, words) => {
    const status = statusOf();
    stub(okStatus({ ...status, openai: { ...status.openai, lastRun: { outcome, at: '2026-10-15T09:00:00.000Z' }, ...NO_COUNTS } }), () => ({ status: 500, body: {} }));
    render(<ProviderPriceCheck onFinished={jest.fn()} />);
    expect(await screen.findByText(words)).toBeInTheDocument();
  });

  it('never checked; LiteLLM unavailable', async () => {
    const status = statusOf();
    stub(
      okStatus({
        ...status,
        openai: { lastRun: null, lastOkAt: null, lastFailure: null, ...NO_COUNTS },
        litellm: {
          ...status.litellm,
          lastRun: { outcome: 'network_error', at: '2026-10-15T09:00:00.000Z' },
          lastFailure: { outcome: 'network_error', at: '2026-10-15T09:00:00.000Z' },
          lastRunVerdicts: null,
        },
      }),
      () => ({ status: 500, body: {} })
    );
    render(<ProviderPriceCheck onFinished={jest.fn()} />);
    expect(await screen.findByText('OpenAI: not checked yet.')).toBeInTheDocument();
    expect(screen.getByText('Second price list (LiteLLM): unavailable; prices still loaded (the page could not be reached).')).toBeInTheDocument();
    expect(screen.getAllByTestId('litellm-history').map((line) => line.textContent)).toEqual([
      'Last successful check: 2026-10-15 09:00 UTC',
      'Last failure: the page could not be reached at 2026-10-15 09:00 UTC',
    ]);
  });

  it('a failed or malformed status read is said, never drawn', async () => {
    stub(() => ({ status: 200, body: { success: true, data: [] } }), () => ({ status: 500, body: {} }));
    render(<ProviderPriceCheck onFinished={jest.fn()} />);
    expect(await screen.findByText('The last check could not be loaded.')).toBeInTheDocument();
    expect(screen.queryByText(/OpenAI:/)).not.toBeInTheDocument();
  });
});

describe('the button', () => {
  it('is busy while the check runs, then re-reads the status and the table', async () => {
    let release: (reply: { status: number; body: unknown }) => void = () => undefined;
    const pending = new Promise<{ status: number; body: unknown }>((resolve) => {
      release = resolve;
    });
    const calls = stub(okStatus(), () => pending);
    const onFinished = jest.fn();
    render(<ProviderPriceCheck onFinished={onFinished} />);
    await screen.findByText(/OpenAI: 24 prices read/);

    fireEvent.click(screen.getByRole('button', { name: 'Check provider prices' }));
    const busy = await screen.findByRole('button', { name: 'Checking provider prices…' });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(onFinished).not.toHaveBeenCalled();

    release({ status: 200, body: { success: true, data: SUMMARY } });
    await waitFor(() => expect(onFinished).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Check provider prices' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Check provider prices' })).not.toHaveAttribute('aria-busy');
    expect(calls).toEqual([`GET ${FETCH_RUNS_URL}`, `POST ${FETCH_RUNS_URL}`, `GET ${FETCH_RUNS_URL}`]);
    expect(screen.getByText('Saved as pending prices. Nothing is charged until a price is applied.')).toBeInTheDocument();
    // Slice 10 deliberate edit: the lists are grouped by provider, so each item names it.
    expect(screen.getByText('OpenAI: Needs manual entry: gpt-4o (the price cell is not exactly one price: "$0.75 through December 31, 2026")')).toBeInTheDocument();
    expect(screen.getByText('OpenAI: Not on the provider page: gpt-4-turbo')).toBeInTheDocument();
  });

  it('a 409 shows the server words in the alert and re-reads nothing', async () => {
    const message = 'Prices were checked less than a minute ago. Try again in 42 s.';
    const calls = stub(okStatus(), () => ({ status: 409, body: { success: false, error: message, code: 'too_soon', retryAfterSeconds: 42 } }));
    const onFinished = jest.fn();
    render(<ProviderPriceCheck onFinished={onFinished} />);
    await screen.findByText(/OpenAI: 24 prices read/);
    fireEvent.click(screen.getByRole('button', { name: 'Check provider prices' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(onFinished).not.toHaveBeenCalled();
    expect(calls).toEqual([`GET ${FETCH_RUNS_URL}`, `POST ${FETCH_RUNS_URL}`]);
    expect(screen.getByRole('button', { name: 'Check provider prices' })).toBeEnabled();
  });

  it('a network failure is said in the alert', async () => {
    stub(okStatus(), () => 'reject');
    render(<ProviderPriceCheck onFinished={jest.fn()} />);
    await screen.findByText(/OpenAI: 24 prices read/);
    fireEvent.click(screen.getByRole('button', { name: 'Check provider prices' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server. Check your connection and try again.');
  });
});

describe('Anthropic (slice 10)', () => {
  it('its own line in words, with its last success and last failure', async () => {
    const status = statusOf();
    stub(
      okStatus({
        ...status,
        anthropic: {
          ...status.anthropic,
          lastRun: { outcome: 'layout_changed', at: '2026-10-15T09:00:00.000Z' },
          lastOkAt: '2026-10-14T09:00:00.000Z',
          lastFailure: { outcome: 'layout_changed', at: '2026-10-15T09:00:00.000Z' },
          ...NO_COUNTS,
        },
      }),
      () => ({ status: 500, body: {} })
    );
    render(<ProviderPriceCheck onFinished={jest.fn()} />);
    expect(
      await screen.findByText('Anthropic: the pricing page layout changed; no prices were read at 2026-10-15 09:00 UTC. Enter prices by hand.')
    ).toBeInTheDocument();
    const block = screen.getByTestId('price-check-anthropic');
    expect(block).toHaveTextContent('Last successful check: 2026-10-14 09:00 UTC');
    expect(block).toHaveTextContent('Last failure: the pricing page layout changed; no prices were read at 2026-10-15 09:00 UTC');
    // OpenAI's line is untouched by Anthropic's failure.
    expect(screen.getByText('OpenAI: 24 prices read 2026-10-15 09:00 UTC; 2 need manual entry; 2 not on the page')).toBeInTheDocument();
  });

  it('counts after a run; "not checked yet" when it never ran', async () => {
    stub(okStatus(), () => ({ status: 500, body: {} }));
    const { unmount } = render(<ProviderPriceCheck onFinished={jest.fn()} />);
    expect(await screen.findByText('Anthropic: 8 prices read 2026-10-15 09:00 UTC; 5 not on the page')).toBeInTheDocument();
    unmount();

    const status = statusOf();
    stub(okStatus({ ...status, anthropic: { lastRun: null, lastOkAt: null, lastFailure: null, ...NO_COUNTS } }), () => ({ status: 500, body: {} }));
    render(<ProviderPriceCheck onFinished={jest.fn()} />);
    expect(await screen.findByText('Anthropic: not checked yet.')).toBeInTheDocument();
  });

  it('a status from before slice 10 (no anthropic key) still draws, without an Anthropic line', async () => {
    const older: Record<string, unknown> = { ...statusOf({ manualProviders: ['anthropic', 'google', 'kimi'] }) };
    delete older.anthropic;
    stub(() => ({ status: 200, body: { success: true, data: older } }), () => ({ status: 500, body: {} }));
    render(<ProviderPriceCheck onFinished={jest.fn()} />);
    expect(await screen.findByText(/OpenAI: 24 prices read/)).toBeInTheDocument();
    expect(screen.queryByTestId('price-check-anthropic')).not.toBeInTheDocument();
    expect(screen.getByText('Anthropic, Google and Kimi: manual entry for now.')).toBeInTheDocument();
  });

  it('after a check: lists grouped by provider, and Anthropic page notes', async () => {
    stub(okStatus(), () => ({ status: 200, body: { success: true, data: SUMMARY } }));
    render(<ProviderPriceCheck onFinished={jest.fn()} />);
    await screen.findByText(/OpenAI: 24 prices read/);
    fireEvent.click(screen.getByRole('button', { name: 'Check provider prices' }));
    expect(
      await screen.findByText('Anthropic: Needs manual entry: claude-sonnet-5 (the price cell is not exactly one price: "$2 / MTok<sup>3</sup>")')
    ).toBeInTheDocument();
    expect(screen.getByText('Anthropic: Not on the provider page: claude-3-haiku-20240307')).toBeInTheDocument();
    expect(screen.getByText('Anthropic page notes: claude-opus-4-1-20250805: retired, except on Bedrock and Google Cloud')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Anthropic: Needs manual entry' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'OpenAI: Needs manual entry' })).toBeInTheDocument();
  });

  it('SC10-8: an older summary (Anthropic manual_only, problems without provider) still renders', async () => {
    const older = {
      roundId: 'round-0',
      providerOutcomes: { ...OUTCOMES, anthropic: { outcome: 'manual_only' } },
      problems: [{ model_name: 'gpt-4o', messages: ['x'] }],
    };
    stub(okStatus(), () => ({ status: 200, body: { success: true, data: older } }));
    const onFinished = jest.fn();
    render(<ProviderPriceCheck onFinished={onFinished} />);
    await screen.findByText(/OpenAI: 24 prices read/);
    fireEvent.click(screen.getByRole('button', { name: 'Check provider prices' }));
    await waitFor(() => expect(onFinished).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Saved as pending prices. Nothing is charged until a price is applied.')).toBeInTheDocument();
    expect(screen.getByText('OpenAI: Not on the provider page: gpt-4-turbo')).toBeInTheDocument();
    expect(screen.queryByTestId('price-check-run-anthropic')).not.toBeInTheDocument();
  });
});
