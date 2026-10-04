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

/** The "User: …" line of the row card that contains `text`. */
async function userLineContaining(text: string): Promise<HTMLElement> {
  const value = await screen.findByText(text);
  const card = value.closest('div.rounded-xl');
  if (!card) throw new Error(`No row card for "${text}"`);
  return within(card as HTMLElement).getByText(/^User:/);
}

describe('person names on the audit row', () => {
  it('R-1: shows the profile name on the row line and in the expanded User tile', async () => {
    mockRoute([NAMED_ROW]);
    render(<AuditTrailPage />);

    const line = await userLineContaining('Dana Cohen');
    expect(line.textContent).toBe('User: Dana Cohen');
    expect(line.textContent).not.toContain(NAMED_ACCOUNT);

    fireEvent.click(await screen.findByText('Dana Cohen'));

    const tileLabel = await screen.findByText('User', { selector: 'div' });
    const tile = tileLabel.parentElement as HTMLElement;
    expect(within(tile).getByText('Dana Cohen')).toBeTruthy();
  });

  it('R-2: an account with no name (users: null) still shows its id', async () => {
    mockRoute([UNNAMED_ROW]);
    render(<AuditTrailPage />);

    const line = await userLineContaining(UNNAMED_ACCOUNT);
    expect(line.textContent).toBe(`User: ${UNNAMED_ACCOUNT}`);
  });

  it('R-3: a row with no users key (failed lookup) renders and shows the id', async () => {
    mockRoute([UNKNOWN_ROW]);
    render(<AuditTrailPage />);

    const line = await userLineContaining(UNKNOWN_ACCOUNT);
    expect(line.textContent).toBe(`User: ${UNKNOWN_ACCOUNT}`);
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
