/**
 * @jest-environment jsdom
 */

/**
 * Q-SA4-1 (user-approved 2026-10-04): an audit row whose account has no
 * profile name shows the row's sign-in email (`user_email`) instead of the
 * long account id. Order: name → `user_email` → account id, on the row line and
 * in the expanded "User" tile. A system row (no `user_id`) shows no User line.
 *
 * `user_email` is already in every row the route sends (`select('*')`) and is
 * matched by its search, so nothing new leaves the route.
 *
 * @see docs/workplans/ADMIN_HELPBOT_LOCK_AND_AUDIT_EMAIL_WORKPLAN.md
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

const NAMED_ACCOUNT = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const EMAIL_ACCOUNT = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const BARE_ACCOUNT = 'cccccccc-3333-4333-8333-cccccccccccc';

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

/** Named, and also has an email: the name wins. */
const NAMED_ROW = {
  ...baseRow, id: 'row-named', entity_id: 'e-1', user_id: NAMED_ACCOUNT,
  user_email: 'dana@example.test', users: { full_name: 'Dana Cohen' },
};
const EMAIL_ROW = {
  ...baseRow, id: 'row-email', entity_id: 'e-2', user_id: EMAIL_ACCOUNT,
  user_email: 'noname@example.test', users: null,
};
const BARE_ROW = {
  ...baseRow, id: 'row-bare', entity_id: 'e-3', user_id: BARE_ACCOUNT,
  user_email: null, users: null,
};
const SYSTEM_ROW = {
  ...baseRow, id: 'row-system', entity_id: 'e-4', resource_name: 'Nightly job',
  user_id: null, user_email: null,
};

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

/** The row card that contains `text`. */
async function cardContaining(text: string): Promise<HTMLElement> {
  const value = await screen.findByText(text);
  const card = value.closest('div.rounded-xl');
  if (!card) throw new Error(`No row card for "${text}"`);
  return card as HTMLElement;
}

/** The expanded "User" tile's value, after expanding the row showing `text`. */
async function userTileAfterExpanding(text: string): Promise<HTMLElement> {
  fireEvent.click(await screen.findByText(text));
  const tileLabel = await screen.findByText('User', { selector: 'div' });
  return tileLabel.parentElement as HTMLElement;
}

describe('audit row user label: name → sign-in email → account id', () => {
  it('E-1: a named row shows the name, not its email or id', async () => {
    mockRoute([NAMED_ROW]);
    render(<AuditTrailPage />);

    const line = within(await cardContaining('Dana Cohen')).getByText(/^User:/);
    expect(line.textContent).toBe('User: Dana Cohen');

    const tile = await userTileAfterExpanding('Dana Cohen');
    expect(within(tile).getByText('Dana Cohen')).toBeTruthy();
    expect(tile.textContent).not.toContain('dana@example.test');
  });

  it('E-2: an unnamed row with an email shows the email on the line and in the tile', async () => {
    mockRoute([EMAIL_ROW]);
    render(<AuditTrailPage />);

    const line = within(await cardContaining('noname@example.test')).getByText(/^User:/);
    expect(line.textContent).toBe('User: noname@example.test');
    expect(line.textContent).not.toContain(EMAIL_ACCOUNT);

    const tile = await userTileAfterExpanding('noname@example.test');
    expect(within(tile).getByText('noname@example.test')).toBeTruthy();
    expect(tile.textContent).not.toContain(EMAIL_ACCOUNT);
  });

  it('E-3: a row with neither a name nor an email shows the account id', async () => {
    mockRoute([BARE_ROW]);
    render(<AuditTrailPage />);

    const line = within(await cardContaining(BARE_ACCOUNT)).getByText(/^User:/);
    expect(line.textContent).toBe(`User: ${BARE_ACCOUNT}`);
  });

  it('E-4: a system row (no user) is unchanged: no User line and no User tile', async () => {
    mockRoute([SYSTEM_ROW]);
    render(<AuditTrailPage />);

    const card = await cardContaining('Nightly job');
    expect(within(card).queryByText(/^User:/)).toBeNull();

    fireEvent.click(await screen.findByText('Nightly job'));
    await screen.findByText('Event ID');
    expect(screen.queryByText('User', { selector: 'div' })).toBeNull();
  });
});
