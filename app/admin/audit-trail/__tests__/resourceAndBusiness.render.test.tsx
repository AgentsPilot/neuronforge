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
 * 2. The business name appears next to the user when there is one, and NOTHING
 *    appears when there is not. Blank is the chosen rendering for an
 *    agent-platform row, so a placeholder creeping in is a regression.
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

/** The rendered card for one log row, found by the text unique to it. */
async function cardFor(text: string | RegExp): Promise<HTMLElement> {
  const label = await screen.findByText(text);
  // The row card is the nearest ancestor carrying the row's rounded-xl shell.
  const card = label.closest('div.rounded-xl');
  if (!card) throw new Error(`No row card found for "${text}"`);
  return card as HTMLElement;
}

describe('a resource name that exists', () => {
  it('is shown under the Resource label, and the entity id is not in the metadata line', async () => {
    mockRoute([NAMED_ROW]);
    render(<AuditTrailPage />);

    const card = await cardFor('Weekly Digest Agent');
    expect(within(card).getByText('Weekly Digest Agent')).toBeTruthy();

    // The label and the value sit in the same element: "Resource: <name>".
    const resourceLine = within(card).getByText(/^Resource:/);
    expect(resourceLine.textContent).toContain('Weekly Digest Agent');
    expect(resourceLine.textContent).not.toContain(NAMED_ENTITY_ID);

    // No id-labelled fallback on a named row.
    expect(within(card).queryByText(/^Entity id:/)).toBeNull();
  });
});

describe('a resource name that is missing', () => {
  it('never presents the entity id under the Resource label', async () => {
    mockRoute([NAMELESS_ROW]);
    render(<AuditTrailPage />);

    // Note where a regression actually surfaces: restoring
    // `log.resource_name || log.entity_id` removes the "Entity id:" label
    // entirely, so this LOCATOR throws ("Unable to find an element with the text:
    // /^Entity id:/") before the assertion below ever runs. The guard holds —
    // the failure message just names the symptom rather than the cause.
    const card = await cardFor(/^Entity id:/);

    // THE regression guard. Before the fix this read "Resource: bbbbbbbb-...".
    const resourceLines = within(card).queryAllByText(/^Resource:/);
    for (const line of resourceLines) {
      expect(line.textContent).not.toContain(NAMELESS_ENTITY_ID);
    }
  });

  it('shows the id labelled as an id instead', async () => {
    mockRoute([NAMELESS_ROW]);
    render(<AuditTrailPage />);

    const idLine = await screen.findByText(/^Entity id:/);
    expect(idLine.textContent).toContain(NAMELESS_ENTITY_ID);
  });

  it('does not dress the missing name as an error', async () => {
    mockRoute([NAMELESS_ROW]);
    render(<AuditTrailPage />);

    await screen.findByText(/^Entity id:/);
    // ~44% of rows are in this state, several of them deliberately. No word
    // suggesting a defect, and no empty-value placeholder, may appear.
    for (const word of [/missing/i, /unknown resource/i, /no name/i, /n\/a/i, /—/]) {
      expect(screen.queryByText(word)).toBeNull();
    }
  });
});

describe('the business name', () => {
  it('is shown next to the user when the account has one', async () => {
    mockRoute([NAMED_ROW]);
    render(<AuditTrailPage />);

    const card = await cardFor('Weekly Digest Agent');
    const businessLine = within(card).getByText(/^Business:/);
    expect(businessLine.textContent).toContain('Acme Dental');
    // The user is still there — the business is an addition, not a replacement.
    expect(within(card).getByText(/^User:/).textContent).toContain('owner@example.com');
  });

  it('renders nothing at all when the account has no business profile', async () => {
    mockRoute([NAMELESS_ROW]);
    render(<AuditTrailPage />);

    await screen.findByText(/^Entity id:/);
    expect(screen.queryByText(/^Business:/)).toBeNull();
  });

  it('renders nothing when the business exists but has not named itself', async () => {
    mockRoute([{ ...NAMED_ROW, business: { company_name: null } }]);
    render(<AuditTrailPage />);

    await screen.findByText('Weekly Digest Agent');
    expect(screen.queryByText(/^Business:/)).toBeNull();
  });

  it('keeps each row on its own business across a mixed page', async () => {
    mockRoute([NAMED_ROW, NAMELESS_ROW]);
    render(<AuditTrailPage />);

    await waitFor(() => expect(screen.getByText('Weekly Digest Agent')).toBeTruthy());

    const namedCard = await cardFor('Weekly Digest Agent');
    expect(within(namedCard).getByText(/^Business:/).textContent).toContain('Acme Dental');

    const namelessCard = (await screen.findByText(/^Entity id:/)).closest('div.rounded-xl') as HTMLElement;
    expect(within(namelessCard).queryByText(/^Business:/)).toBeNull();
  });
});
