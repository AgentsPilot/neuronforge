/**
 * @jest-environment jsdom
 */

/**
 * The filter card was tightened so more audit rows fit on one screen. That is a
 * presentation change, so there is nothing new to test — what needs pinning is
 * the two things the tightening MOVED, because a later density pass could move
 * them again without noticing:
 *
 *   1. `Clear All Filters` no longer has a row of its own; it occupies the grid
 *      slot the seven fields leave empty. It must still clear every filter, and
 *      it must still be the LAST control in the card, so nobody has re-ordered
 *      the tab sequence to win a pixel.
 *   2. The labels shrank to `text-xs`, which makes an unassociated label a
 *      smaller and worse click target than before. Every control is therefore
 *      reachable BY ITS LABEL — `getByLabelText` fails if a `htmlFor`/`id` pair
 *      is dropped.
 *
 * Deliberately no assertion on a Tailwind class: a test that pins `p-4` pins
 * the decision rather than the behaviour, and would have to be edited by the
 * next person to change any of it. Heights are not measurable here anyway —
 * jsdom does no layout.
 *
 * jsdom like the sibling suites (Playwright is not installed — CLAUDE.md
 * § Testing), asserting with `toBeTruthy()` / `toBe()` because jest-dom is not
 * configured in this project.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

jest.mock('@/components/UserProvider', () => ({
  useAuth: () => ({ user: { id: 'admin-user', email: 'admin@example.com' } }),
}));

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
}));

import AuditTrailPage from '../page';

const EMPTY_PAGE = {
  success: true,
  logs: [],
  pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0, showing: 0, hasMore: false },
};

function mockRoute(): jest.Mock {
  const fetchMock = jest.fn(async () => ({ ok: true, json: async () => EMPTY_PAGE }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
  (global as any).fetch = fetchMock;
  return fetchMock;
}

const fetchedUrls = (mock: jest.Mock): string[] => mock.mock.calls.map(([u]) => String(u));

const auditUrls = (mock: jest.Mock): string[] =>
  fetchedUrls(mock).filter((url) => url.includes('/api/admin/audit-trail'));

beforeEach(() => {
  jest.clearAllMocks();
  mockSearch = '';
});

describe('every filter control is reachable by its label', () => {
  it.each([
    'Account',
    'Search',
    'Action Type',
    'Severity',
    'From Date',
    'To Date',
    'Entity Type',
  ])('%s', async (label) => {
    mockRoute();
    render(<AuditTrailPage />);
    expect(await screen.findByLabelText(label)).toBeTruthy();
  });
});

describe('Clear All Filters, now inside the field grid', () => {
  it('still clears every filter', async () => {
    mockSearch = 'severity=critical&entity_type=agent';
    const fetchMock = mockRoute();
    render(<AuditTrailPage />);

    fireEvent.change(await screen.findByLabelText('Search'), { target: { value: 'acme' } });
    await waitFor(() => expect(auditUrls(fetchMock).some((u) => u.includes('search=acme'))).toBe(true));

    // `findBy`, not `getBy`: with no rows loaded the page swaps the WHOLE
    // screen — filters included — for a spinner while a refetch is in flight
    // (`loading && logs.length === 0`), so the card is briefly gone after the
    // search above. Pre-existing behaviour, untouched by the density pass.
    fireEvent.click(await screen.findByText('Clear All Filters'));

    await waitFor(() => {
      const last = auditUrls(fetchMock).at(-1) as string;
      expect(last.includes('search=')).toBe(false);
      expect(last.includes('severity=')).toBe(false);
      expect(last.includes('entity_type=')).toBe(false);
    });
  });

  it('is still the last control in the card, so the tab order is unchanged', async () => {
    mockRoute();
    render(<AuditTrailPage />);

    const entityType = await screen.findByLabelText('Entity Type');
    const clear = screen.getByText('Clear All Filters');
    // A bitmask: FOLLOWING is set when `clear` comes after the select in the
    // document, which is the order the browser tabs them in.
    const position = entityType.compareDocumentPosition(clear);

    expect(Boolean(position & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });
});
