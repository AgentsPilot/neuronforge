/**
 * @jest-environment jsdom
 *
 * QA edge cases for the Model pricing page (ADMIN_BOS_CLEANUP slice 2, QA
 * 2026-10-03). They cover what `pages.render.test.tsx` leaves open:
 *
 * - E-1: a failed price save keeps the row's old value and shows an error
 *   (W2-1 changed the success path; the failure path must not touch the row).
 * - E-2: two rows saved one after the other both show their saved values
 *   (the functional row update must not lose the first save).
 * - E-3: a failed re-read closes an open editor (SA O-5 optimisation), so a
 *   later good read does not reopen the editor on a row it no longer owns.
 */

import '@testing-library/jest-dom';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('@/lib/logger/client', () => {
  const logger: Record<string, unknown> = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  logger.child = () => logger;
  return { clientLogger: logger };
});

import ModelPricingPage from '../page';

const PRICING_URL = '/api/admin/system-config/pricing';
const SYNC_URL = '/api/admin/system-config/pricing/sync';

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

type Reply = { status: number; body?: unknown } | 'reject';

function stubFetch(route: (url: string, method: string, body?: string) => Reply) {
  const calls: string[] = [];
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${url}`);
    const reply = route(url, method, typeof init?.body === 'string' ? init.body : undefined);
    if (reply === 'reject') throw new TypeError('Failed to fetch');
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      statusText: '',
      json: async () => reply.body,
      text: async () => '',
    };
  }) as unknown as typeof fetch;
  return calls;
}

const rowOf = (name: string) => screen.getByText(name).closest('tr') as HTMLElement;

describe('Model pricing page: QA edge cases', () => {
  it.each([
    ['a 500', { status: 500, body: { success: false, error: 'boom' } } as Reply, 'Failed to update pricing'],
    ['a 200 with success false', { status: 200, body: { success: false, error: 'Row locked' } } as Reply, 'Row locked'],
    ['a thrown fetch', 'reject' as Reply, 'Failed to fetch'],
  ])('E-1: %s on save keeps the old price and shows an error', async (_label, putReply, message) => {
    stubFetch((url, method) => (method === 'PUT' ? putReply : { status: 200, body: { success: true, data: ROWS } }));

    render(<ModelPricingPage />);
    await screen.findByText('gpt-4o-mini');

    await userEvent.click(within(rowOf('gpt-4o-mini')).getByTitle('Edit pricing'));
    await userEvent.click(within(rowOf('gpt-4o-mini')).getAllByTitle('Increase')[0]);
    await userEvent.click(within(rowOf('gpt-4o-mini')).getByTitle('Save'));

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.queryByText('Pricing updated successfully!')).not.toBeInTheDocument();

    // The editor stays open on failure (as before); cancelling shows the stored price, unchanged.
    await userEvent.click(within(rowOf('gpt-4o-mini')).getByTitle('Cancel'));
    expect(within(rowOf('gpt-4o-mini')).getByText('$0.00000015')).toBeInTheDocument();
  });

  it('E-2: two rows saved in sequence both show their saved values', async () => {
    const calls = stubFetch((url, method, body) => {
      if (method === 'PUT') {
        const { id } = JSON.parse(body ?? '{}') as { id: string };
        const base = ROWS.find((r) => r.id === id)!;
        return {
          status: 200,
          body: { success: true, data: { ...base, input_cost_per_token: base.input_cost_per_token * 10 } },
        };
      }
      return { status: 200, body: { success: true, data: ROWS } };
    });

    render(<ModelPricingPage />);
    await screen.findByText('gpt-4o-mini');

    await userEvent.click(within(rowOf('gpt-4o-mini')).getByTitle('Edit pricing'));
    await userEvent.click(within(rowOf('gpt-4o-mini')).getByTitle('Save'));
    await screen.findByText('Pricing updated successfully!');

    await userEvent.click(within(rowOf('claude-haiku')).getByTitle('Edit pricing'));
    await userEvent.click(within(rowOf('claude-haiku')).getByTitle('Save'));

    expect(await within(rowOf('claude-haiku')).findByText('$0.00000800')).toBeInTheDocument();
    expect(within(rowOf('gpt-4o-mini')).getByText('$0.00000150')).toBeInTheDocument();
    expect(calls).toEqual([`GET ${PRICING_URL}`, `PUT ${PRICING_URL}`, `PUT ${PRICING_URL}`]);
  });

  it('E-3: a failed re-read closes an open editor, so the next good read shows plain rows', async () => {
    let reads = 0;
    stubFetch((url) => {
      if (url === SYNC_URL) return { status: 200, body: { success: true, message: 'ok' } };
      reads += 1;
      return reads === 2 ? { status: 500, body: { success: false } } : { status: 200, body: { success: true, data: ROWS } };
    });

    const view = render(<ModelPricingPage />);
    await screen.findByText('gpt-4o-mini');

    await userEvent.click(within(rowOf('gpt-4o-mini')).getByTitle('Edit pricing'));
    expect(within(rowOf('gpt-4o-mini')).getByTitle('Save')).toBeInTheDocument();

    // Sync succeeds, its re-read fails: the table and the editor go.
    await userEvent.click(screen.getByRole('button', { name: /Sync Latest Pricing/ }));
    await screen.findByTestId('pricing-read-failed');

    // The header refresh button (no accessible name) re-reads successfully.
    const refresh = view.container.querySelector('header button') as HTMLButtonElement;
    await userEvent.click(refresh);

    await screen.findByText('gpt-4o-mini');
    expect(screen.queryByTestId('pricing-read-failed')).not.toBeInTheDocument();
    expect(screen.queryByText('Could not load model prices.')).not.toBeInTheDocument();
    expect(within(rowOf('gpt-4o-mini')).queryByTitle('Save')).not.toBeInTheDocument();
    expect(within(rowOf('gpt-4o-mini')).getByTitle('Edit pricing')).toBeInTheDocument();
  });
});
