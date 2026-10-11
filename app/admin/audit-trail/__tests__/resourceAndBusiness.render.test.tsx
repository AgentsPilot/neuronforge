/**
 * @jest-environment jsdom
 */

/**
 * Two rendering rules on the audit row's metadata line.
 *
 * 1. A MISSING resource name must read as missing. The line used to be
 *    `{log.resource_name || log.entity_id}` under a literal "Resource:" label,
 *    so a row with no name printed the entity's GUID *as if it were the name*.
 *    Measured on production: 25,706 of 58,775 rows (~44%) have a NULL
 *    `resource_name`, and some of those omissions are DELIBERATE —
 *    lib/business-os/llm/aiActionAudit.ts leaves the field unset because it
 *    "could carry content or credentials". So the fix must distinguish the two
 *    cases without implying the nameless rows are broken.
 *
 *    The assertion that matters is not "the guid appears" — it appeared before
 *    too. It is that the guid is NOT presented under the Resource label. A
 *    regression back to `||` would still show the guid and would still satisfy
 *    any test that merely looked for the id, which is why the label/value
 *    pairing is asserted here rather than the value alone.
 *
 * 2. The business name appears next to the user when there is one. When there
 *    is none, the Business cell shows an em dash: since Admin Layout Standard
 *    L-1d the row is a table row, and §5.7 "never blank" replaced the card's
 *    omitted line (SA Q-4). It must never carry a name it does not have.
 *
 * L-1d (cards → table): the rows are found by `closest('tr')` and the values by
 * their cell testids (`audit-cell-resource`, `-business`, `-user`) instead of
 * the card's inline "Resource:" / "Entity id:" / "User:" / "Business:" labels.
 * The column header names the cell now, so the label/value pairing the first
 * rule needs is the cell itself.
 *
 * This renders the real page component in jsdom, following the convention of the
 * sibling suites in this folder (Playwright is not installed — CLAUDE.md
 * § Testing).
 */

import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';

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

const NAMED_ENTITY_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const NAMELESS_ENTITY_ID = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

const baseRow = {
  details: null,
  changes: null,
  severity: 'info',
  created_at: '2026-09-28T10:00:00.000Z',
  compliance_flags: [],
};

/** A row a writer gave a name to, for a business that has named itself. */
const NAMED_ROW = {
  ...baseRow,
  id: 'row-named',
  user_id: 'user-1',
  action: 'AGENT_EXECUTED',
  entity_type: 'agent',
  entity_id: NAMED_ENTITY_ID,
  resource_name: 'Weekly Digest Agent',
  users: { email: 'owner@example.com' },
  business: { company_name: 'Acme Dental' },
};

/** A row whose writer omitted the name on purpose (the aiActionAudit shape). */
const NAMELESS_ROW = {
  ...baseRow,
  id: 'row-nameless',
  user_id: 'user-2',
  action: 'BUSINESS_AI_ACTION_COMPLETED',
  entity_type: 'ai_action',
  entity_id: NAMELESS_ENTITY_ID,
  resource_name: null,
  users: { email: 'other@example.com' },
  business: null,
};

function mockRoute(logs: unknown[]): jest.Mock {
  const fetchMock = jest.fn(async () => ({
    ok: true,
    json: async () => ({
      success: true,
      logs,
      pagination: { page: 1, pageSize: 20, total: logs.length, totalPages: 1, hasMore: false, showing: logs.length },
    }),
  }));
  (global as unknown as { fetch: jest.Mock }).fetch = fetchMock;
  return fetchMock;
}

/** The table row for one log, found by the text unique to it. */
async function rowFor(text: string | RegExp): Promise<HTMLElement> {
  const label = await screen.findByText(text);
  const row = label.closest('tr');
  if (!row) throw new Error(`No table row found for "${text}"`);
  return row as HTMLElement;
}

const cell = (row: HTMLElement, name: 'resource' | 'business' | 'user') =>
  within(row).getByTestId(`audit-cell-${name}`);

describe('a resource name that exists', () => {
  it('is shown in the Resource cell, and the entity id is not on the row', async () => {
    mockRoute([NAMED_ROW]);
    render(<AuditTrailPage />);

    const row = await rowFor('Weekly Digest Agent');
    const resource = cell(row, 'resource');
    expect(resource.textContent).toBe('Weekly Digest Agent');
    expect(resource.textContent).not.toContain(NAMED_ENTITY_ID);

    // No id-labelled fallback on a named row.
    expect(within(row).queryByText(/^Entity id/)).toBeNull();
    expect(row.textContent).not.toContain(NAMED_ENTITY_ID.slice(0, 8));
  });
});

describe('a resource name that is missing', () => {
  it('never presents the entity id as the resource name', async () => {
    mockRoute([NAMELESS_ROW]);
    render(<AuditTrailPage />);

    // Note where a regression actually surfaces: restoring
    // `log.resource_name || log.entity_id` removes the "Entity id" label
    // entirely, so this LOCATOR throws before the assertion below ever runs.
    // The guard holds — the failure message just names the symptom.
    const row = await rowFor(/^Entity id$/);

    // THE regression guard. Before the fix this read "Resource: bbbbbbbb-...".
    const resource = cell(row, 'resource');
    expect(resource.textContent?.startsWith('Entity id ')).toBe(true);
    expect(resource.textContent).not.toBe(NAMELESS_ENTITY_ID);
  });

  it('shows the id labelled as an id instead: short in the cell, whole on hover', async () => {
    mockRoute([NAMELESS_ROW]);
    render(<AuditTrailPage />);

    const resource = cell(await rowFor(/^Entity id$/), 'resource');
    expect(resource.textContent).toBe(`Entity id ${NAMELESS_ENTITY_ID.slice(0, 8)}…`);
    expect(resource.querySelector(`[title="${NAMELESS_ENTITY_ID}"]`)).toBeTruthy();
  });

  it('does not dress the missing name as an error (in the Resource cell)', async () => {
    mockRoute([NAMELESS_ROW]);
    render(<AuditTrailPage />);

    // ~44% of rows are in this state, several of them deliberately. No word
    // suggesting a defect, and no empty-value placeholder, may appear in the
    // Resource cell. Scoped to that cell since L-1d: the em dash is now the
    // §5.7 rendering of an empty Business or User cell (SA Q-4).
    const text = cell(await rowFor(/^Entity id$/), 'resource').textContent ?? '';
    for (const word of [/missing/i, /unknown resource/i, /no name/i, /n\/a/i, /—/]) {
      expect({ word: String(word), found: word.test(text) }).toEqual({ word: String(word), found: false });
    }
  });
});

describe('the business name', () => {
  it('is shown next to the user when the account has one', async () => {
    mockRoute([NAMED_ROW]);
    render(<AuditTrailPage />);

    const row = await rowFor('Weekly Digest Agent');
    expect(cell(row, 'business').textContent).toBe('Acme Dental');
    // The user is still there — the business is an addition, not a replacement.
    expect(cell(row, 'user').textContent).toBe('owner@example.com');
  });

  it('shows an em dash and no name when the account has no business profile (§5.7)', async () => {
    mockRoute([NAMELESS_ROW]);
    render(<AuditTrailPage />);

    const business = cell(await rowFor(/^Entity id$/), 'business');
    expect(business.textContent).toBe('—');
  });

  it('shows an em dash when the business exists but has not named itself', async () => {
    mockRoute([{ ...NAMED_ROW, business: { company_name: null } }]);
    render(<AuditTrailPage />);

    const business = cell(await rowFor('Weekly Digest Agent'), 'business');
    expect(business.textContent).toBe('—');
  });

  it('keeps each row on its own business across a mixed page', async () => {
    mockRoute([NAMED_ROW, NAMELESS_ROW]);
    render(<AuditTrailPage />);

    await waitFor(() => expect(screen.getByText('Weekly Digest Agent')).toBeTruthy());

    const namedRow = await rowFor('Weekly Digest Agent');
    expect(cell(namedRow, 'business').textContent).toBe('Acme Dental');

    const namelessRow = await rowFor(/^Entity id$/);
    expect(namelessRow).not.toBe(namedRow);
    expect(cell(namelessRow, 'business').textContent).toBe('—');
    expect(namelessRow.textContent).not.toContain('Acme Dental');
  });
});
