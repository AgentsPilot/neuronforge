/**
 * @jest-environment jsdom
 */

/**
 * AI cost & usage — the exact-window deep link from the Health landing (admin
 * reorganisation slice 4, SA C-9). Both bounds or neither; ISO with an offset;
 * sent verbatim; any period change clears it.
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
import { parseLinkedWindow, urlWithoutLinkedWindow } from '../linkedWindow';

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

describe('parseLinkedWindow', () => {
  const p = (q: string) => parseLinkedWindow(new URLSearchParams(q));

  it('accepts both bounds as ISO with an offset', () => {
    expect(p(`dateFrom=${FROM}&dateTo=${TO}`)).toEqual({ from: FROM, to: TO });
    expect(p('dateFrom=2026-09-25T08:14:00%2B03:00&dateTo=2026-09-26T08:14:00%2B03:00')).not.toBeNull();
  });

  it.each([
    [`dateFrom=${FROM}`],
    [`dateTo=${TO}`],
    ['dateFrom=2026-09-25T08:14&dateTo=2026-09-26T08:14'], // no offset
    ['dateFrom=2026-09-25&dateTo=2026-09-26'], // date only
    [`dateFrom=${TO}&dateTo=${FROM}`], // reversed
    ['dateFrom=garbage&dateTo=nonsense'],
  ])('ignores both for %s', (q) => {
    expect(p(q)).toBeNull();
  });
});

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
    expect((await screen.findByTestId('linked-window')).textContent).toContain('2026-09-25 08:14');
  });

  it('ignores an invalid pair and falls back to the default period', async () => {
    mockSearch = 'dateFrom=2026-09-25T08:14&dateTo=2026-09-26T08:14';
    const fetchMock = mockRoute();
    render(<AdminCostAnalytics />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const q = firstQuery(fetchMock);
    expect(q.get('dateFrom')).toBeNull();
    expect(q.get('period')).toBe('30');
    expect(screen.queryByTestId('linked-window')).toBeNull();
  });

  it('a period change clears the linked window', async () => {
    mockSearch = `dateFrom=${FROM}&dateTo=${TO}`;
    const fetchMock = mockRoute();
    render(<AdminCostAnalytics />);
    await screen.findByTestId('linked-window');

    fireEvent.click(screen.getByRole('button', { name: '7d' }));

    await waitFor(() => expect(screen.queryByTestId('linked-window')).toBeNull());
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
    await screen.findByTestId('linked-window');
    fireEvent.click(screen.getByRole('button', { name: 'Clear the linked window' }));
    await waitFor(() => expect(screen.queryByTestId('linked-window')).toBeNull());
    const params = new URLSearchParams(window.location.search);
    expect(params.get('dateFrom')).toBeNull();
    expect(params.get('dateTo')).toBeNull();
    // Other parameters survive.
    expect(params.get('scope')).toBe('bos');
    expect(params.get('user')).toBe('99999999-9999-4999-8999-999999999999');
  });

  it('a preset click also removes the window from the URL', async () => {
    linkTo(`dateFrom=${FROM}&dateTo=${TO}`);
    mockRoute();
    render(<AdminCostAnalytics />);
    await screen.findByTestId('linked-window');
    fireEvent.click(screen.getByRole('button', { name: '24h' }));
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('dateFrom')).toBeNull());
  });

  it('no preset is highlighted while a linked window applies; the default returns once it is cleared', async () => {
    linkTo(`dateFrom=${FROM}&dateTo=${TO}`);
    mockRoute();
    render(<AdminCostAnalytics />);
    await screen.findByTestId('linked-window');
    for (const label of ['24h', '7d', '30d', '90d']) {
      expect(screen.getByRole('button', { name: label }).className).not.toContain('bg-purple-500');
    }
    fireEvent.click(screen.getByRole('button', { name: 'Clear the linked window' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '30d' }).className).toContain('bg-purple-500'));
  });
});

describe('urlWithoutLinkedWindow', () => {
  it('drops only the two window parameters', () => {
    expect(urlWithoutLinkedWindow(`http://x/admin/analytics?scope=bos&dateFrom=${FROM}&dateTo=${TO}`)).toBe(
      '/admin/analytics?scope=bos'
    );
    expect(urlWithoutLinkedWindow(`http://x/admin/analytics?dateFrom=${FROM}`)).toBe('/admin/analytics');
  });

  it('returns null when there is nothing to remove', () => {
    expect(urlWithoutLinkedWindow('http://x/admin/analytics?scope=bos')).toBeNull();
  });
});
