/**
 * @jest-environment jsdom
 *
 * Runtime proof for the Model pricing split (ADMIN_BOS_CLEANUP slice 2;
 * conditions C2-2, C2-3, C2-4, C2-5; SA W2-1, W2-8, O-5). Workplan cases
 * R-1 to R-10.
 *
 * P = the Model pricing page (`/admin/system-config`).
 * B = the parked AgentsPilot billing page (`/admin/agentspilot-billing`).
 *
 * `fetch` is a URL router that records every call, so each case can say which
 * routes a page read and which it never touched.
 */

import '@testing-library/jest-dom';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockError = jest.fn();
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

const PRICING_URL = '/api/admin/system-config/pricing';
const SYNC_URL = '/api/admin/system-config/pricing/sync';
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
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: typeof init?.body === 'string' ? init.body : undefined });
    const route = routes[url];
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
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([`GET ${PRICING_URL}`]);
  });

  it('R-1 (W2-8): the toggle collapses the open card', async () => {
    stubFetch({ [PRICING_URL]: () => okRows() });

    render(<ModelPricingPage />);
    await screen.findByText('gpt-4o-mini');

    await userEvent.click(screen.getByTestId('pricing-toggle'));

    expect(screen.queryByText('gpt-4o-mini')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('a successful empty list is a true answer: the table, no failure line, no banner', async () => {
    stubFetch({ [PRICING_URL]: () => okRows([]) });

    render(<ModelPricingPage />);

    expect(await screen.findByRole('table')).toBeInTheDocument();
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

  it('R-5: Sync posts to the sync route, re-reads prices once, and shows the message', async () => {
    const calls = stubFetch({
      [PRICING_URL]: () => okRows(),
      [SYNC_URL]: () => ({ status: 200, body: { success: true, message: 'ok' } }),
    });

    render(<ModelPricingPage />);
    await screen.findByText('gpt-4o-mini');

    await userEvent.click(screen.getByRole('button', { name: /Sync Latest Pricing/ }));

    expect(await screen.findByText('ok')).toBeInTheDocument();
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `GET ${PRICING_URL}`,
      `POST ${SYNC_URL}`,
      `GET ${PRICING_URL}`,
    ]);
  });

  it('R-9 (W2-1): a saved price shows as saved, from the PUT reply, with no extra read', async () => {
    const saved = { ...ROWS[0], input_cost_per_token: 0.0000025 };
    const calls = stubFetch({
      [PRICING_URL]: (method) =>
        method === 'PUT'
          ? { status: 200, body: { success: true, data: saved, message: 'Pricing updated successfully' } }
          : okRows(),
    });

    render(<ModelPricingPage />);
    const row = (await screen.findByText('gpt-4o-mini')).closest('tr') as HTMLElement;
    expect(within(row).getByText('$0.00000015')).toBeInTheDocument();

    await userEvent.click(within(row).getByTitle('Edit pricing'));
    await userEvent.click(within(row).getByTitle('Save'));

    expect(await screen.findByText('Pricing updated successfully!')).toBeInTheDocument();
    const after = screen.getByText('gpt-4o-mini').closest('tr') as HTMLElement;
    expect(within(after).getByText('$0.00000250')).toBeInTheDocument();
    expect(within(after).queryByText('$0.00000015')).not.toBeInTheDocument();
    // The other row is untouched.
    const other = screen.getByText('claude-haiku').closest('tr') as HTMLElement;
    expect(within(other).getByText('$0.00000080')).toBeInTheDocument();
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([`GET ${PRICING_URL}`, `PUT ${PRICING_URL}`]);
  });

  it('R-10 (O-5): a failed re-read after Sync clears the old table instead of leaving it as current', async () => {
    let reads = 0;
    stubFetch({
      [PRICING_URL]: () => {
        reads += 1;
        return reads === 1 ? okRows() : { status: 500, body: { success: false } };
      },
      [SYNC_URL]: () => ({ status: 200, body: { success: true, message: 'ok' } }),
    });

    render(<ModelPricingPage />);
    await screen.findByText('gpt-4o-mini');

    await userEvent.click(screen.getByRole('button', { name: /Sync Latest Pricing/ }));

    await screen.findByText(READ_FAILED_BANNER);
    expectReadFailed();
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

    await userEvent.click(screen.getByTestId('billing-toggle'));

    expect(screen.getByRole('heading', { name: 'AgentsPilot boost packs' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add Boost Pack/ })).toBeInTheDocument();
    // The grace period loaded from the settings read.
    expect(screen.getByDisplayValue('5')).toBeInTheDocument();
  });

  it('R-7 (C2-3): the read-only dump shows the calculator only', async () => {
    stubFetch(routesFor());

    const { container } = render(<AgentsPilotBillingPage />);
    await screen.findByRole('heading', { level: 1 });

    await userEvent.click(screen.getByTestId('advanced-toggle'));

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

    await userEvent.click(screen.getByTestId('calc-toggle'));

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
