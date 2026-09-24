/**
 * @jest-environment jsdom
 */

/**
 * AC-A4 / AC-A4b regression: while a free-text search is active, the page must
 * not DISPLAY any total derived from the route's unfiltered count.
 *
 * Why this file exists (QA BUG-1, 2026-09-23). T4 branched the left-hand count
 * line on `isSearchActive`, but the pagination control beside it kept printing
 * `Page {currentPage} of {pagination.totalPages}` unconditionally — and
 * `totalPages` is `ceil(unfilteredCount / pageSize)` (route.ts:201). The same
 * card therefore read "Showing 2 matches on this page (Page 1) — Search scans
 * only the current page…" next to "Page 1 of 717". The caveat was honest and
 * the number beside it was not.
 *
 * The distinction this suite pins:
 *   - the printed NUMBER is in scope — AC-A4b is about what the page displays;
 *   - the pager's BEHAVIOUR is out of scope (Non-Goal 2 / SA's JC-4). First,
 *     Previous, Next and Last still page the unfiltered stream, which is what
 *     the route actually does. Both halves are asserted here so a later reader
 *     cannot "fix" one by breaking the other.
 *
 * This renders the real page component in jsdom. It is not a substitute for the
 * E2E this repo does not have (CLAUDE.md § Testing — Playwright is not
 * installed); it is the closest available check on rendered output, and a
 * source-level scan could not tell a branched label from an unbranched one.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

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

import AuditTrailPage from '../page';

/** The unfiltered table in this fixture: 14,332 rows => 717 pages of 20. */
const UNFILTERED_TOTAL = 14332;
const UNFILTERED_TOTAL_PAGES = 717;

const row = (id: string) => ({
  id,
  user_id: 'u1',
  action: 'AGENT_EXECUTED',
  entity_type: 'agent',
  entity_id: 'a1',
  resource_name: 'Test Agent',
  details: null,
  changes: null,
  severity: 'info',
  created_at: '2026-09-23T10:00:00.000Z',
  compliance_flags: [],
  users: { email: 'owner@example.com' },
});

/**
 * Stands in for the route. `showing` is the only thing search changes — the
 * route filters in memory AFTER counting, so `total` / `totalPages` keep
 * describing the unfiltered table. That asymmetry IS the bug's cause, so the
 * fixture reproduces it rather than smoothing it over.
 */
function mockRoute(): jest.Mock {
  const fetchMock = jest.fn(async (url: string) => {
    const searching = url.includes('search=');
    const logs = searching ? [row('r1'), row('r2')] : Array.from({ length: 20 }, (_, i) => row(`r${i}`));
    return {
      ok: true,
      json: async () => ({
        success: true,
        logs,
        pagination: {
          page: 1,
          pageSize: 20,
          total: UNFILTERED_TOTAL,
          totalPages: UNFILTERED_TOTAL_PAGES,
          showing: logs.length,
          hasMore: true,
        },
      }),
    };
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; the cast is the standard test stub shape
  (global as any).fetch = fetchMock;
  return fetchMock as unknown as jest.Mock;
}

/** The pager's own label — the element BUG-1 was about. */
function pagerLabel(): HTMLElement {
  const next = screen.getByRole('button', { name: 'Next' });
  const pager = next.parentElement as HTMLElement;
  return within(pager).getByText(/^Page \d/);
}

async function typeSearch(term: string) {
  const input = screen.getByPlaceholderText(/search/i);
  fireEvent.change(input, { target: { value: term } });
  await waitFor(() => {
    expect((global.fetch as jest.Mock).mock.calls.some(([u]) => String(u).includes('search='))).toBe(true);
  });
}

describe('the audit page never prints an unfiltered total while searching', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRoute();
  });

  it('shows the full "Page n of m" and the real total when no search is active', async () => {
    render(<AuditTrailPage />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toBeTruthy());

    expect(pagerLabel().textContent).toBe(`Page 1 of ${UNFILTERED_TOTAL_PAGES}`);
    expect(document.body.textContent).toContain(`Showing 20 of ${UNFILTERED_TOTAL} audit logs`);
  });

  it('drops the unfiltered page count from the pager label once a search is active', async () => {
    render(<AuditTrailPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toBeTruthy());

    await typeSearch('gmail');

    await waitFor(() => {
      expect(pagerLabel().textContent).toBe('Page 1');
    });
    expect(pagerLabel().textContent).not.toContain('of');
  });

  it('leaves NO rendering of the unfiltered total anywhere on the page while searching', async () => {
    // The assertion that actually pins BUG-1: 717 and 14,332 are both derived
    // from the unfiltered count, and neither may reach the DOM under a search.
    render(<AuditTrailPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toBeTruthy());

    await typeSearch('gmail');

    await waitFor(() => expect(document.body.textContent).toContain('matches on this page'));

    const text = document.body.textContent ?? '';
    expect(text).not.toContain(String(UNFILTERED_TOTAL_PAGES));
    expect(text).not.toContain(String(UNFILTERED_TOTAL));
    expect(text).toContain('Showing 2 matches on this page');
    expect(text).toContain('Search scans only the current page of results');
  });

  it('restores the full label when the search term is cleared', async () => {
    render(<AuditTrailPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toBeTruthy());

    await typeSearch('gmail');
    await waitFor(() => expect(pagerLabel().textContent).toBe('Page 1'));

    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: '' } });

    await waitFor(() => {
      expect(pagerLabel().textContent).toBe(`Page 1 of ${UNFILTERED_TOTAL_PAGES}`);
    });
    expect(document.body.textContent).toContain(`of ${UNFILTERED_TOTAL} audit logs`);
  });

  it('treats a whitespace-only term as no search, in the pager label too (X-2)', async () => {
    render(<AuditTrailPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toBeTruthy());

    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: '   ' } });

    await waitFor(() => {
      expect(pagerLabel().textContent).toBe(`Page 1 of ${UNFILTERED_TOTAL_PAGES}`);
    });
    expect((global.fetch as jest.Mock).mock.calls.every(([u]) => !String(u).includes('search='))).toBe(true);
  });

  it('does NOT change the pager buttons — Non-Goal 2 / JC-4 is about behaviour', async () => {
    // The exemption covers First/Previous/Next/Last and their enable-disable
    // logic, which still run off the unfiltered totalPages. Only the label moved.
    render(<AuditTrailPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toBeTruthy());

    await typeSearch('gmail');
    await waitFor(() => expect(pagerLabel().textContent).toBe('Page 1'));

    for (const name of ['First', 'Previous', 'Next', 'Last']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
    // Page 1 of an unfiltered 717: back is disabled, forward is not.
    expect((screen.getByRole('button', { name: 'First' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Previous' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'Last' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
