/**
 * @jest-environment jsdom
 */

/**
 * ADMIN_BOS_CLEANUP slice 4 on the audit-trail page.
 *
 * 1. Person names. The route now sends `users: { full_name }` from `profiles`
 *    (it used to read a `users` table that does not exist, so every row showed
 *    the account id). The page's existing fallback chain is unchanged; these
 *    pin that a name renders, and that both "no name" (`users: null`) and
 *    "lookup failed" (no `users` key) still render the account id rather than
 *    erroring.
 * 2. The search placeholder. It offered to search by "agent", which the route
 *    does not match. It now names the fields the route searches, in the page's
 *    own labels (FR-AT3, SA ruling O-2).
 *
 * Renders the real page in jsdom, like the sibling suites (Playwright is not
 * installed — CLAUDE.md § Testing).
 *
 * L-1d (cards → table, inline expand → drawer): the user line is the row's
 * `audit-cell-user` cell, and a bare account id there is shortened with the
 * full id in `title` (§5.7 Ids). R-1 opens the drawer through the row's Open
 * button and reads its `dt` / `dd` pair.
 */

import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';

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

import AuditTrailPage from '../page';

const PLACEHOLDER = 'Search by email, action, resource or entity ID…';

const NAMED_ACCOUNT = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const UNNAMED_ACCOUNT = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const UNKNOWN_ACCOUNT = 'cccccccc-3333-4333-8333-cccccccccccc';

const baseRow = {
  action: 'BUSINESS_AI_ACTION_COMPLETED',
  entity_type: 'ai_action',
  resource_name: 'Weekly Digest',
  details: null,
  changes: null,
  severity: 'info',
  created_at: '2026-09-28T10:00:00.000Z',
  compliance_flags: [],
  business: null,
};

const NAMED_ROW = { ...baseRow, id: 'row-named', entity_id: 'e-1', user_id: NAMED_ACCOUNT, users: { full_name: 'Dana Cohen' } };
const UNNAMED_ROW = { ...baseRow, id: 'row-unnamed', entity_id: 'e-2', user_id: UNNAMED_ACCOUNT, users: null };
/** The shape a failed name lookup produces: no `users` key at all. */
const UNKNOWN_ROW = { ...baseRow, id: 'row-unknown', entity_id: 'e-3', user_id: UNKNOWN_ACCOUNT };

function mockRoute(logs: unknown[]): void {
  (global as unknown as { fetch: jest.Mock }).fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({
      success: true,
      logs,
      userLookup: 'ok',
      pagination: { page: 1, pageSize: 20, total: logs.length, totalPages: 1, hasMore: false, showing: logs.length },
    }),
  }));
}

/** The User cell of the table row that contains `text`. */
async function userLineContaining(text: string): Promise<HTMLElement> {
  const value = await screen.findByText(text);
  const row = value.closest('tr');
  if (!row) throw new Error(`No table row for "${text}"`);
  return within(row as HTMLElement).getByTestId('audit-cell-user');
}

describe('person names on the audit row', () => {
  it('R-1: shows the profile name on the row line and in the expanded User tile', async () => {
    mockRoute([NAMED_ROW]);
    render(<AuditTrailPage />);

    const line = await userLineContaining('Dana Cohen');
    expect(line.textContent).toBe('Dana Cohen');
    expect(line.textContent).not.toContain(NAMED_ACCOUNT);

    fireEvent.click(screen.getByRole('button', { name: /^Open details for/ }));

    const tileLabel = await screen.findByText('User', { selector: 'dt' });
    const tile = tileLabel.parentElement as HTMLElement;
    expect(within(tile).getByText('Dana Cohen')).toBeTruthy();
  });

  it('R-2: an account with no name (users: null) still shows its id, short, whole on hover', async () => {
    mockRoute([UNNAMED_ROW]);
    render(<AuditTrailPage />);

    const line = await userLineContaining(`${UNNAMED_ACCOUNT.slice(0, 8)}…`);
    expect(line.textContent).toBe(`${UNNAMED_ACCOUNT.slice(0, 8)}…`);
    expect(line.querySelector(`[title="${UNNAMED_ACCOUNT}"]`)).toBeTruthy();
  });

  it('R-3: a row with no users key (failed lookup) renders and shows the id, short, whole on hover', async () => {
    mockRoute([UNKNOWN_ROW]);
    render(<AuditTrailPage />);

    const line = await userLineContaining(`${UNKNOWN_ACCOUNT.slice(0, 8)}…`);
    expect(line.textContent).toBe(`${UNKNOWN_ACCOUNT.slice(0, 8)}…`);
    expect(line.querySelector(`[title="${UNKNOWN_ACCOUNT}"]`)).toBeTruthy();
  });
});

describe('the search placeholder (FR-AT3)', () => {
  it('R-4: names the fields the route searches, and not agents', async () => {
    mockRoute([]);
    render(<AuditTrailPage />);

    // The filters render after the first load, so wait for the field itself.
    const input = (await screen.findByLabelText('Search')) as HTMLInputElement;
    expect(input.id).toBe('audit-search');
    expect(input.placeholder).toBe(PLACEHOLDER);
    expect(input.placeholder).not.toMatch(/agent/i);
  });
});
