/**
 * @jest-environment jsdom
 *
 * Runtime proof for the Model pricing split (ADMIN_BOS_CLEANUP slice 2;
 * conditions C2-2, C2-3, C2-4, C2-5; SA W2-1, W2-8, O-5). Workplan cases
 * R-1 to R-10. R-11: AI_MODEL_PRICE_REVIEW slice 1 (exact price display).
 *
 * AI_MODEL_PRICE_REVIEW slice 4 (UF-5, SA NR-3): the table is now the price
 * comparison, so the page also reads `/api/admin/model-pricing/comparison`.
 * The stub answers it by default from the same rows; each edited case keeps
 * its original intent, stated in a one-line comment. R-12 and R-13 are new.
 *
 * AI_MODEL_PRICE_REVIEW slice 6 (MP-FR-11): Sync and Edit are gone. R-5, R-9
 * and R-13 tested them and are deleted; R-10 keeps its intent on the surviving
 * silent re-read (the price check's `onFinished`, SA O-9); R-14 is new. R-15
 * (SA CR-2) keeps the recovery half of the deleted `pages.edge.qa` E-3.
 *
 * P = the Model pricing page (`/admin/system-config`).
 * B = the parked AgentsPilot billing page (`/admin/agentspilot-billing`).
 *
 * `fetch` is a URL router that records every call, so each case can say which
 * routes a page read and which it never touched.
 */

import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const mockError = jest.fn();
// Slice 5: "Check provider prices" is tested on its own in providerPriceCheck.render.test.tsx.
// Here it is a stand-in (no status read), so these page cases keep slice 4's call lists and
// timings. Slice 6: clicking it calls `onFinished`, the page's surviving silent re-read.
jest.mock('@/app/admin/system-config/components/ProviderPriceCheck', () => ({
  __esModule: true,
  default: ({ onFinished }: { onFinished?: () => void }) =>
    jest
      .requireActual('react')
      .createElement('button', { type: 'button', 'data-testid': 'price-check-stand-in', onClick: () => onFinished?.() }, 'Check provider prices'),
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
import AgentsPilotBillingPage from '../../agentspilot-billing/page';
import { COMPARISON_URL, okComparison } from '../__fixtures__/priceComparison';

const PRICING_URL = '/api/admin/system-config/pricing';
const READ_FAILED_BANNER = 'Could not load model prices.';

const ROWS = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    provider: 'openai',
    model_name: 'gpt-4o-mini',
    input_cost_per_token: 0.00000015,
    output_cost_per_token: 0.0000006,
    effective_date: '2026-09-01T00:00:00.000Z',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    provider: 'anthropic',
    model_name: 'claude-haiku',
    input_cost_per_token: 0.0000008,
    output_cost_per_token: 0.000004,
    effective_date: '2026-09-01T00:00:00.000Z',
  },
];

type Reply = { status: number; body?: unknown; text?: string } | 'reject';
type Route = (method: string, init?: RequestInit) => Reply;

interface Call {
  url: string;
  method: string;
  body?: string;
}

/**
 * Answers each URL from its route. A route may return different replies on
 * successive calls by closing over its own counter.
 */
function stubFetch(routes: Record<string, Route>) {
  const calls: Call[] = [];
  // Slice 4: the comparison read is answered from ROWS unless a case routes it.
  const all: Record<string, Route> = { [COMPARISON_URL]: () => okComparison(ROWS), ...routes };
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: typeof init?.body === 'string' ? init.body : undefined });
    const route = all[url];
    if (!route) throw new Error(`unexpected fetch: ${method} ${url}`);
    const reply = route(method, init);
    if (reply === 'reject') throw new TypeError('Failed to fetch');
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      statusText: '',
      json: async () => reply.body,
      text: async () => reply.text ?? '',
    };
  }) as unknown as typeof fetch;
  return calls;
}

const okRows = (rows: unknown[] = ROWS): Reply => ({ status: 200, body: { success: true, data: rows } });

/**
 * Names of every button whose accessible name starts with "Edit" (QA E-2: any Edit
 * button, not only one titled "Edit pricing"). A DOM walk, not a role query, to
 * stay fast under load.
 */
function editButtonNames(): string[] {
  return Array.from(document.querySelectorAll('button'))
    .map((button) => button.getAttribute('aria-label') ?? button.getAttribute('title') ?? button.textContent ?? '')
    .map((name) => name.trim())
    .filter((name) => /^edit/i.test(name));
}

beforeEach(() => {
  mockError.mockReset();
});

describe('P: Model pricing', () => {
  it('R-1: shows the h1 and the rows, open by default, and reads only the pricing route', async () => {
    const calls = stubFetch({ [PRICING_URL]: () => okRows() });

    render(<ModelPricingPage />);

    expect(await screen.findByText('gpt-4o-mini')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Model pricing$/);
    expect(screen.getByText('claude-haiku')).toBeInTheDocument();
    expect(screen.queryByText('System Config')).not.toBeInTheDocument();
    // Intent kept: only the pricing routes are read (slice 4: the list and the comparison).
    expect(calls.map((c) => `${c.method} ${c.url}`).sort()).toEqual([`GET ${COMPARISON_URL}`, `GET ${PRICING_URL}`].sort());
  });

  it('R-1 (W2-8): the toggle collapses the open card', async () => {
    stubFetch({ [PRICING_URL]: () => okRows() });

    render(<ModelPricingPage />);
    await screen.findByText('gpt-4o-mini');

    // Intent and assertions unchanged; fireEvent skips userEvent's per-ancestor pointer checks, so the case stays under 2 s in the parallel gate.
    fireEvent.click(screen.getByTestId('pricing-toggle'));

    expect(screen.queryByText('gpt-4o-mini')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('a successful empty list is a true answer: the table, no failure line, no banner', async () => {
    // Intent kept: two empty answers are a true empty table (slice 4: both reads empty).
    stubFetch({ [PRICING_URL]: () => okRows([]), [COMPARISON_URL]: () => okComparison([]) });

    render(<ModelPricingPage />);

    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.getByText('No models to show.')).toBeInTheDocument();
    expect(screen.queryByTestId('pricing-read-failed')).not.toBeInTheDocument();
    expect(screen.queryByText(READ_FAILED_BANNER)).not.toBeInTheDocument();
  });

  function expectReadFailed() {
    expect(screen.getByText(READ_FAILED_BANNER)).toBeInTheDocument();
    expect(screen.getByTestId('pricing-read-failed')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText('gpt-4o-mini')).not.toBeInTheDocument();
  }

  it('R-2: a 500 shows the banner and the failure line, never an empty table', async () => {
    stubFetch({ [PRICING_URL]: () => ({ status: 500, body: { success: false, error: 'boom' } }) });

    render(<ModelPricingPage />);

    await screen.findByText(READ_FAILED_BANNER);
    expectReadFailed();
  });

  it('R-3: a 200 with success false is a failed read too', async () => {
    stubFetch({ [PRICING_URL]: () => ({ status: 200, body: { success: false, error: 'nope' } }) });

    render(<ModelPricingPage />);

    await screen.findByText(READ_FAILED_BANNER);
    expectReadFailed();
  });

  it('R-4: a thrown fetch is a failed read, logged with { err }', async () => {
    stubFetch({ [PRICING_URL]: () => 'reject' });

    render(<ModelPricingPage />);

    await screen.findByText(READ_FAILED_BANNER);
    expectReadFailed();
    expect(mockError).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(TypeError) }),
      'Model prices read threw'
    );
  });

  it('R-10 (O-5): a failed silent re-read clears the old table instead of leaving it as current', async () => {
    let reads = 0;
    stubFetch({
      [PRICING_URL]: () => {
        reads += 1;
        return reads === 1 ? okRows() : { status: 500, body: { success: false } };
      },
    });

    render(<ModelPricingPage />);
    await screen.findByText('gpt-4o-mini');

    // Intent kept; slice 6 (SA O-9): Sync is gone, so the silent re-read is the one a stored price check triggers.
    fireEvent.click(screen.getByTestId('price-check-stand-in'));

    await screen.findByText(READ_FAILED_BANNER);
    expectReadFailed();
  });

  // AI_MODEL_PRICE_REVIEW slice 1 (MP-FR-1, D-2 option C): the price is shown
  // exactly. Before, 8 fixed decimals showed $0.075 per 1M as $0.08 per 1M.
  // Intent kept in slice 4: the per-1M price is the server's text, never rounded.
  it('R-11: a sub-cent per-1M price is shown exactly, never rounded', async () => {
    const row = {
      ...ROWS[0],
      model_name: 'gemini-1.5-flash',
      input_cost_per_token: 0.000000075,
      output_cost_per_token: 0.0000003,
    };
    stubFetch({ [PRICING_URL]: () => okRows([row]), [COMPARISON_URL]: () => okComparison([row]) });

    render(<ModelPricingPage />);
    const tr = (await screen.findByText('gemini-1.5-flash')).closest('tr') as HTMLElement;

    expect(within(tr).getByText('$0.075')).toBeInTheDocument();
    expect(within(tr).getByText('$0.3')).toBeInTheDocument();
    expect(within(tr).queryByText('$0.08')).not.toBeInTheDocument();
  });

  // Slice 6 (MP-FR-11, SA SC6-6 c): nothing on the page changes a live price.
  it('R-14: no Sync, no Edit, the new helper line, and only GETs are sent', async () => {
    const calls = stubFetch({ [PRICING_URL]: () => okRows() });

    render(<ModelPricingPage />);
    await screen.findByText('gpt-4o-mini');

    expect(screen.queryByText('Sync Latest Pricing')).not.toBeInTheDocument();
    expect(screen.queryAllByTitle('Edit pricing')).toHaveLength(0);
    expect(editButtonNames()).toEqual([]);
    expect(screen.queryAllByTitle('Save')).toHaveLength(0);
    expect(screen.queryByText(/Sync copies a built-in price list/)).not.toBeInTheDocument();
    expect(
      screen.getByText('Cost per token for each AI model, as charged today. Live prices cannot be changed on this page until Apply arrives.')
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('price-check-stand-in'));
    await waitFor(() => expect(calls).toHaveLength(4));
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });

  // SA CR-2: the recovery half of the deleted pages.edge.qa E-3. After a failed read, Refresh
  // reads again; a good read brings the table back and clears the banner and the failure line.
  it('R-15: Refresh after a failed read brings the table back and clears the failure', async () => {
    let reads = 0;
    stubFetch({
      [PRICING_URL]: () => {
        reads += 1;
        return reads === 1 ? { status: 500, body: { success: false, error: 'boom' } } : okRows();
      },
    });

    render(<ModelPricingPage />);
    await screen.findByText(READ_FAILED_BANNER);
    expectReadFailed();

    fireEvent.click(screen.getByLabelText('Refresh'));

    expect(await screen.findByText('gpt-4o-mini')).toBeInTheDocument();
    expect(screen.queryByText(READ_FAILED_BANNER)).not.toBeInTheDocument();
    expect(screen.queryByTestId('pricing-read-failed')).not.toBeInTheDocument();
    expect(reads).toBe(2);
  });

  // Slice 4 (R-9 row 4, SA RC-4): a retired row is labelled. Slice 6: no row offers Edit.
  it('R-12: a retired row reads "Retired <date>"; no row has Edit', async () => {
    const retired = {
      ...ROWS[1],
      id: '33333333-3333-4333-8333-333333333333',
      model_name: 'claude-3-haiku',
      effective_date: '2024-01-01',
      retired_date: '2026-10-11',
    };
    stubFetch({ [PRICING_URL]: () => okRows([...ROWS, retired]), [COMPARISON_URL]: () => okComparison([...ROWS, retired]) });

    render(<ModelPricingPage />);
    // Intent kept; page layout slice (UF-7): retired rows are hidden until "Show retired" is on.
    fireEvent.click(await screen.findByTestId('show-retired-toggle'));
    const tr = (await screen.findByText('claude-3-haiku')).closest('tr') as HTMLElement;

    expect(within(tr).getByText('Retired 2026-10-11')).toBeInTheDocument();
    expect(screen.queryAllByTitle('Edit pricing')).toHaveLength(0);
  });

});

describe('B: AgentsPilot billing', () => {
  const SETTINGS = [
    {
      id: 's1',
      key: 'payment_grace_period_days',
      value: '5',
      category: 'billing',
      description: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      updated_by: null,
    },
  ];

  function routesFor(settings: Reply = { status: 200, body: { success: true, data: SETTINGS } }) {
    return {
      '/api/admin/system-config': () => settings,
      '/api/admin/boost-packs': () => ({ status: 200, body: { success: true, data: [] } }),
      '/api/pricing/config': () => ({
        status: 200,
        body: { success: true, config: { calculatorEstimation: { baseTokens: 1200 }, creditCostUsd: 0.00048 } },
      }),
    } as Record<string, Route>;
  }

  it('R-6: reads the three AgentsPilot routes, never the pricing route, and heads the boost packs as AgentsPilot', async () => {
    const calls = stubFetch(routesFor());

    render(<AgentsPilotBillingPage />);

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('AgentsPilot');
    expect(calls.map((c) => c.url).sort()).toEqual(
      ['/api/admin/boost-packs', '/api/admin/system-config', '/api/pricing/config'].sort()
    );
    expect(calls.some((c) => c.url.startsWith(PRICING_URL))).toBe(false);

    // Intent and assertions unchanged; fireEvent skips userEvent's per-ancestor pointer checks, so the case stays under 2 s in the parallel gate.
    fireEvent.click(screen.getByTestId('billing-toggle'));

    expect(screen.getByRole('heading', { name: 'AgentsPilot boost packs' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add Boost Pack/ })).toBeInTheDocument();
    // The grace period loaded from the settings read.
    expect(screen.getByDisplayValue('5')).toBeInTheDocument();
  });

  it('R-7 (C2-3): the read-only dump shows the calculator only', async () => {
    stubFetch(routesFor());

    const { container } = render(<AgentsPilotBillingPage />);
    await screen.findByRole('heading', { level: 1 });

    // Intent and assertions unchanged; fireEvent skips userEvent's per-ancestor pointer checks, so the case stays under 2 s in the parallel gate.
    fireEvent.click(screen.getByTestId('advanced-toggle'));

    const pre = container.querySelector('pre');
    expect(pre).not.toBeNull();
    const dump = JSON.parse(pre!.textContent ?? '');
    expect(Object.keys(dump)).toEqual(['calculator']);
    expect(dump.calculator.baseTokens).toBe(1200);
  });

  it('the calculator section still opens from its own toggle', async () => {
    stubFetch(routesFor());

    render(<AgentsPilotBillingPage />);
    await screen.findByRole('heading', { level: 1 });

    // Intent and assertions unchanged; fireEvent skips userEvent's per-ancestor pointer checks, so the case stays under 2 s in the parallel gate.
    fireEvent.click(screen.getByTestId('calc-toggle'));

    expect(screen.getByText('Save Calculator Config')).toBeInTheDocument();
  });

  it('R-8: a failed settings read shows the error banner, as before', async () => {
    stubFetch(routesFor({ status: 500, body: { success: false }, text: 'server error' }));

    render(<AgentsPilotBillingPage />);

    expect(await screen.findByText(/Failed to fetch system settings: 500/)).toBeInTheDocument();
    await waitFor(() =>
      expect(mockError).toHaveBeenCalledWith({ status: 500 }, 'Settings read failed')
    );
  });
});
