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
 * Amended by Admin Layout Standard L-1c: the card became the shared filter
 * bar. The two minute-precision "From Date" / "To Date" inputs are now the
 * standard Window control's Custom range ("From (UTC)" / "To (UTC)", shown
 * after clicking Custom), and "Clear All Filters" is the bar's "Clear", which
 * follows the page's own filters and precedes Refresh (§5.5 order).
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

// RC-1 (Admin Layout Standard L-1c): the page logs through `clientLogger.child`,
// and `@/lib/logger/client` re-exports from the mocked `@/lib/logger` above.
jest.mock('@/lib/logger/client', () => {
  const noop = () => undefined;
  return { clientLogger: { child: () => ({ error: noop, warn: noop, info: noop, debug: noop }) } };
});

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
    'Window',
    'Business',
    'Search',
    'Action Type',
    'Severity',
    'Entity Type',
  ])('%s', async (label) => {
    mockRoute();
    render(<AuditTrailPage />);
    expect(await screen.findByLabelText(label)).toBeTruthy();
  });

  it('Window has a VISIBLE label that names the group (L-4a; a bare aria-label would also satisfy getByLabelText)', async () => {
    mockRoute();
    render(<AuditTrailPage />);
    const group = await screen.findByRole('group', { name: 'Window' });
    const label = document.getElementById(group.getAttribute('aria-labelledby') ?? '');
    expect(label?.textContent).toBe('Window');
  });

  it('From (UTC) and To (UTC), once Custom is clicked', async () => {
    mockRoute();
    render(<AuditTrailPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Custom' }));
    expect(screen.getByLabelText('From (UTC)')).toBeTruthy();
    expect(screen.getByLabelText('To (UTC)')).toBeTruthy();
  });
});

describe('Clear, in the filter bar', () => {
  it('still clears every filter', async () => {
    mockSearch = 'severity=critical&entity_type=agent';
    const fetchMock = mockRoute();
    render(<AuditTrailPage />);

    fireEvent.change(await screen.findByLabelText('Search'), { target: { value: 'acme' } });
    await waitFor(() => expect(auditUrls(fetchMock).some((u) => u.includes('search=acme'))).toBe(true));

    fireEvent.click(await screen.findByRole('button', { name: 'Clear' }));

    await waitFor(() => {
      const last = auditUrls(fetchMock).at(-1) as string;
      expect(last.includes('search=')).toBe(false);
      expect(last.includes('severity=')).toBe(false);
      expect(last.includes('entity_type=')).toBe(false);
    });
  });

  it('Clear follows the page filters and precedes Refresh', async () => {
    mockRoute();
    render(<AuditTrailPage />);

    const entityType = await screen.findByLabelText('Entity Type');
    const clear = screen.getByRole('button', { name: 'Clear' });
    const refresh = screen.getByRole('button', { name: 'Refresh the audit trail' });
    // A bitmask: FOLLOWING is set when the argument comes after the node in the
    // document, which is the order the browser tabs them in.
    expect(Boolean(entityType.compareDocumentPosition(clear) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(Boolean(clear.compareDocumentPosition(refresh) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });
});
