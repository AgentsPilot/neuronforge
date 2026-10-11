/**
 * @jest-environment jsdom
 */

/**
 * AI cost & usage — the exact-window deep link from the Health landing (admin
 * reorganisation slice 4, SA C-9). Both bounds or neither; ISO with an offset;
 * sent verbatim; any period change clears it.
 *
 * L-2a: the parse rule moved into `analyticsFilters.ts` (its unit cases moved
 * to `analyticsFilters.test.ts`), the chip is the shared bar's
 * (`linked-window-chip`, X "Remove linked window"), the window buttons carry the
 * standard labels and `aria-pressed`, and the URL follows the standard contract
 * (BOS scope is the default, so it is omitted; `user` is rewritten to `account`).
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

// RC-1 (L-2a): the page and the shared business picker log through `clientLogger.child`.
jest.mock('@/lib/logger/client', () => {
  const noop = () => undefined;
  return { clientLogger: { child: () => ({ error: noop, warn: noop, info: noop, debug: noop }) } };
});

let mockSearch = '';
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mockSearch),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

import AdminCostAnalytics from '../page';

const FROM = '2026-09-25T08:14:00.000Z';
const TO = '2026-09-26T08:14:00.000Z';

function okBody() {
  return {
    success: true,
    totals: { cost: 1.5, tokens: 100, inputTokens: 60, outputTokens: 40, calls: 3 },
    items: [],
    filters: {},
    availableFilters: { providers: [], models: [], activities: [], users: [], agents: [] },
    period: { from: FROM, to: TO },
    scope: 'bos',
    possiblyIncomplete: false,
  };
}

function mockRoute(): jest.Mock {
  const fetchMock = jest.fn(async () => ({ ok: true, status: 200, json: async () => okBody() }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
  (global as any).fetch = fetchMock;
  return fetchMock;
}

const firstQuery = (m: jest.Mock) => new URL(String(m.mock.calls[0][0]), 'http://x').searchParams;

beforeEach(() => {
  jest.clearAllMocks();
  mockSearch = '';
  window.history.replaceState(null, '', '/admin/analytics');
});

/** Mirror the linked URL in both the mocked search params and the address bar. */
function linkTo(query: string) {
  mockSearch = query;
  window.history.replaceState(null, '', `/admin/analytics?${query}`);
}

describe('the page', () => {
  it('sends a linked window verbatim, with scope=bos, and shows the chip', async () => {
    mockSearch = `scope=bos&dateFrom=${FROM}&dateTo=${TO}`;
    const fetchMock = mockRoute();
    render(<AdminCostAnalytics />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const q = firstQuery(fetchMock);
    expect(q.get('dateFrom')).toBe(FROM);
    expect(q.get('dateTo')).toBe(TO);
    expect(q.get('scope')).toBe('bos');
    expect(q.get('period')).toBeNull();
    expect((await screen.findByTestId('linked-window-chip')).textContent).toContain('2026-09-25 08:14');
  });

  it('ignores an invalid pair and falls back to the default period', async () => {
    mockSearch = 'dateFrom=2026-09-25T08:14&dateTo=2026-09-26T08:14';
    const fetchMock = mockRoute();
    render(<AdminCostAnalytics />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const q = firstQuery(fetchMock);
    expect(q.get('dateFrom')).toBeNull();
    expect(q.get('period')).toBe('30');
    expect(screen.queryByTestId('linked-window-chip')).toBeNull();
  });

  it('a period change clears the linked window', async () => {
    mockSearch = `dateFrom=${FROM}&dateTo=${TO}`;
    const fetchMock = mockRoute();
    render(<AdminCostAnalytics />);
    await screen.findByTestId('linked-window-chip');

    fireEvent.click(screen.getByRole('button', { name: '7 days' }));

    await waitFor(() => expect(screen.queryByTestId('linked-window-chip')).toBeNull());
    await waitFor(() => {
      const last = new URL(String(fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0]), 'http://x').searchParams;
      expect(last.get('period')).toBe('7');
      expect(last.get('dateFrom')).toBeNull();
    });
  });

  it('the chip can be cleared by hand, and clearing it removes the window from the URL (SA code review 4)', async () => {
    linkTo(`scope=bos&user=99999999-9999-4999-8999-999999999999&dateFrom=${FROM}&dateTo=${TO}`);
    mockRoute();
    render(<AdminCostAnalytics />);
    await screen.findByTestId('linked-window-chip');
    fireEvent.click(screen.getByRole('button', { name: 'Remove linked window' }));
    await waitFor(() => expect(screen.queryByTestId('linked-window-chip')).toBeNull());
    const params = new URLSearchParams(window.location.search);
    expect(params.get('dateFrom')).toBeNull();
    expect(params.get('dateTo')).toBeNull();
    expect(params.get('from')).toBeNull();
    expect(params.get('to')).toBeNull();
    // The business survives under its standard name (U-9); BOS scope is the default, so it is omitted (U-3).
    expect(params.get('account')).toBe('99999999-9999-4999-8999-999999999999');
    expect(params.get('user')).toBeNull();
    expect(params.get('scope')).toBeNull();
  });

  it('a preset click also removes the window from the URL', async () => {
    linkTo(`dateFrom=${FROM}&dateTo=${TO}`);
    mockRoute();
    render(<AdminCostAnalytics />);
    await screen.findByTestId('linked-window-chip');
    fireEvent.click(screen.getByRole('button', { name: '24 hours' }));
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('dateFrom')).toBeNull());
  });

  it('no preset is highlighted while a linked window applies; the default returns once it is cleared', async () => {
    linkTo(`dateFrom=${FROM}&dateTo=${TO}`);
    mockRoute();
    render(<AdminCostAnalytics />);
    await screen.findByTestId('linked-window-chip');
    for (const label of ['24 hours', '7 days', '30 days', '90 days']) {
      expect(screen.getByRole('button', { name: label }).getAttribute('aria-pressed')).toBe('false');
    }
    fireEvent.click(screen.getByRole('button', { name: 'Remove linked window' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '30 days' }).getAttribute('aria-pressed')).toBe('true'));
  });
});
