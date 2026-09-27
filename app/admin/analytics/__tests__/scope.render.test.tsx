/**
 * @jest-environment jsdom
 */

/**
 * AI cost & usage — the "Business OS only" lens (admin reorganisation slice 2a).
 * On by default (user decision, 2026-09-25); a link can turn it off or narrow
 * it to one account; the parked 1,000-row cap is stated on screen.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
  }),
}));

let mockSearch = '';
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mockSearch),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

import AdminCostAnalytics from '../page';

const ACCOUNT = '99999999-9999-4999-8999-999999999999';

function okBody(extra: Record<string, unknown> = {}) {
  return {
    success: true,
    totals: { cost: 1.5, tokens: 100, inputTokens: 60, outputTokens: 40, calls: 3 },
    items: [],
    filters: {},
    availableFilters: { providers: [], models: [], activities: [], users: [], agents: [] },
    categoryTotals: {
      creation: { cost: 0, tokens: 0, calls: 0 },
      execution: { cost: 0, tokens: 0, calls: 0 },
      memory: { cost: 0, tokens: 0, calls: 0 },
      system: { cost: 1.5, tokens: 100, calls: 3 },
    },
    period: { from: '2026-09-01T00:00:00.000Z', to: '2026-09-08T00:00:00.000Z' },
    scope: 'bos',
    possiblyIncomplete: false,
    ...extra,
  };
}

function mockRoute(response: { ok: boolean; status?: number; body: unknown }): jest.Mock {
  const fetchMock = jest.fn(async () => ({ ok: response.ok, status: response.status, json: async () => response.body }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
  (global as any).fetch = fetchMock;
  return fetchMock;
}

const urls = (m: jest.Mock): string[] => m.mock.calls.map(([u]) => String(u));

beforeEach(() => {
  jest.clearAllMocks();
  mockSearch = '';
});

describe('the Business OS lens', () => {
  it('is on by default: the first request asks for scope=bos', async () => {
    const fetchMock = mockRoute({ ok: true, body: okBody() });
    render(<AdminCostAnalytics />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(urls(fetchMock)[0]).toContain('scope=bos');
    expect((await screen.findByTestId('scope-toggle')).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('scope-notes').textContent).toContain('legacy-tagged');
    expect(screen.getByTestId('scope-notes').textContent).toContain('USD');
  });

  it('turns off in one click', async () => {
    const fetchMock = mockRoute({ ok: true, body: okBody() });
    render(<AdminCostAnalytics />);

    fireEvent.click(await screen.findByTestId('scope-toggle'));

    await waitFor(() => expect(urls(fetchMock).some((u) => u.includes('scope=all'))).toBe(true));
  });

  it('honours a deep link: ?scope=all&user=<id>', async () => {
    mockSearch = `scope=all&user=${ACCOUNT}`;
    const fetchMock = mockRoute({ ok: true, body: okBody({ scope: 'all' }) });
    render(<AdminCostAnalytics />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(urls(fetchMock)[0]).toContain('scope=all');
    expect(urls(fetchMock)[0]).toContain(`user=${ACCOUNT}`);
  });

  it('always states the parked 1,000-call limit, and warns when a period reached it', async () => {
    mockRoute({ ok: true, body: okBody({ possiblyIncomplete: true }) });
    render(<AdminCostAnalytics />);

    expect((await screen.findByTestId('incomplete-banner')).textContent).toContain('lower');
    expect(screen.getByTestId('scope-notes').textContent).toContain('1,000');
  });

  it('shows the existing error state when the route fails', async () => {
    mockRoute({ ok: false, body: { success: false, error: 'Invalid query parameters' } });
    render(<AdminCostAnalytics />);
    await waitFor(() => expect(document.body.textContent).toContain('Failed to fetch data'));
  });

  it('a 400 from the route says the query was not valid, not "Failed to fetch data"', async () => {
    mockRoute({ ok: false, status: 400, body: { success: false, error: 'Invalid query parameters' } });
    render(<AdminCostAnalytics />);
    await waitFor(() => expect(document.body.textContent).toContain('not valid'));
    expect(document.body.textContent).not.toContain('Failed to fetch data');
  });
});

describe('a custom date range with the start after the end (QA E-3)', () => {
  it('shows a clear message and does not send the reversed range', async () => {
    const fetchMock = mockRoute({ ok: true, body: okBody() });
    render(<AdminCostAnalytics />);

    fireEvent.click(await screen.findByRole('button', { name: /Custom/ }));
    await waitFor(() => expect(document.querySelectorAll('input[type="date"]')).toHaveLength(2));
    const [from, to] = Array.from(document.querySelectorAll('input[type="date"]')) as HTMLInputElement[];
    fireEvent.change(from, { target: { value: '2026-09-20' } });
    fireEvent.change(to, { target: { value: '2026-09-01' } });
    const callsBefore = fetchMock.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect((await screen.findByTestId('date-range-error')).textContent).toContain('start date is after the end date');
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
    expect(urls(fetchMock).some((u) => u.includes('2026-09-20') && u.includes('2026-09-01'))).toBe(false);
  });
});
