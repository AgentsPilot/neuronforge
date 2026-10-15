/**
 * @jest-environment jsdom
 */

/**
 * Audit trail as the Admin Layout Standard L-1d pilot (part 2): the cards are
 * a §5.7 table built on the shared table classes, the inline expand is one
 * page-level `AdminDrawer` opened from an `OpenRowButton` in the first column,
 * severity is a `StatusChip`, and the search caveat is an `AdminNotice`.
 *
 * A new file, so the L-1c pins in `auditTrail.layout.render` stay as they
 * were. Same mocks (RC-1): the page logs through `clientLogger.child`, and
 * `useSearchParams` answers the arrival string and never echoes a write.
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

jest.mock('@/components/UserProvider', () => ({
  useAuth: () => ({ user: { id: 'admin-user', email: 'admin@example.com' } }),
}));

// The original account picker still logs through `createLogger` (until L-1e).
jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
  }),
}));

jest.mock('@/lib/logger/client', () => {
  const noop = () => undefined;
  return { clientLogger: { child: () => ({ error: noop, warn: noop, info: noop, debug: noop }) } };
});

let mockSearch = '';
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

import { ARCHIVING_OVERVIEW_URL } from '@/hooks/useLatestArchiveCutoff';
import { ADMIN_BUTTON } from '@/app/admin/components/layout/adminTable';

import AuditTrailPage from '../page';

const ACCOUNT = '99999999-9999-4999-8999-999999999999';

/** A system row (no user, no business) whose writer stored generic details. */
const LOGIN = {
  id: 'log-1',
  user_id: null,
  action: 'USER_LOGIN',
  entity_type: 'user',
  entity_id: 'entity-1',
  resource_name: 'Front desk',
  details: { ip: '10.0.0.1' },
  changes: null,
  severity: 'info',
  created_at: '2026-10-10T09:00:00.000Z',
  compliance_flags: [],
};

/** A Business OS AI action: allow-listed fields only, `groupId` absent on purpose. */
const AI = {
  id: 'log-2',
  user_id: ACCOUNT,
  action: 'BUSINESS_AI_ACTION_COMPLETED',
  entity_type: 'ai_action',
  entity_id: '33333333-3333-4333-8333-333333333333',
  resource_name: null,
  details: { area: 'chat', callCount: 2, estimatedCostUsd: 0.5, secretKey: 'never shown' },
  changes: null,
  severity: 'warning',
  created_at: '2026-10-10T08:30:00.000Z',
  compliance_flags: [],
  users: { full_name: 'Dana Cohen' },
  business: { company_name: 'Acme Dental' },
};

const CRITICAL = { ...LOGIN, id: 'log-3', action: 'AGENT_DELETED', severity: 'critical', details: null };
const ODD = { ...LOGIN, id: 'log-4', action: 'AGENT_UPDATED', severity: 'notice', details: null };
/** A stored value that names an Object.prototype member must still read as unknown. */
const PROTO = { ...LOGIN, id: 'log-5', action: 'AGENT_UPDATED', severity: 'constructor', details: null };
/** A-7: an empty stored severity still reads in words. */
const EMPTY = { ...LOGIN, id: 'log-6', action: 'AGENT_UPDATED', severity: '', details: null };

type Answer =
  | { kind: 'rows'; logs: unknown[]; total?: number; totalPages?: number; hasMore?: boolean }
  | { kind: 'html'; status: number }
  | { kind: 'deferred' };

let answer: Answer = { kind: 'rows', logs: [] };
/** Settles the read held by a `deferred` answer with these rows (QA B-1). */
let releaseDeferred: ((logs: unknown[]) => void) | null = null;

function respond(current: Answer): Promise<unknown> {
  if (current.kind === 'deferred') {
    return new Promise((resolve) => {
      releaseDeferred = (logs) => resolve(respond({ kind: 'rows', logs }));
    });
  }
  if (current.kind === 'html') {
    return Promise.resolve({
      ok: false,
      status: current.status,
      json: async () => {
        throw new SyntaxError("Unexpected token '<'");
      },
    });
  }
  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      logs: current.logs,
      pagination: {
        page: 1,
        pageSize: 20,
        total: current.total ?? current.logs.length,
        totalPages: current.totalPages ?? 1,
        hasMore: current.hasMore ?? false,
        showing: current.logs.length,
      },
    }),
  });
}

function mockFetch(): jest.Mock {
  const fetchMock = jest.fn((url: string) => {
    if (String(url) === ARCHIVING_OVERVIEW_URL) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, data: { runs: [] } }) });
    }
    return respond(answer);
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
  (global as any).fetch = fetchMock;
  return fetchMock;
}

const auditUrls = (mock: jest.Mock): string[] =>
  mock.mock.calls.map(([u]) => String(u)).filter((u) => u.startsWith('/api/admin/audit-trail?'));

async function settled() {
  await waitFor(() =>
    expect((screen.getByRole('button', { name: 'Refresh the audit trail' }) as HTMLButtonElement).disabled).toBe(false),
  );
}

async function renderRows(logs: unknown[]): Promise<jest.Mock> {
  answer = { kind: 'rows', logs };
  const fetchMock = mockFetch();
  render(<AuditTrailPage />);
  await screen.findByTestId('audit-table');
  await settled();
  return fetchMock;
}

const rows = () => screen.getAllByTestId('audit-row');

beforeEach(() => {
  jest.clearAllMocks();
  mockSearch = '';
  window.history.replaceState(null, '', '/admin/audit-trail');
  answer = { kind: 'rows', logs: [] };
  releaseDeferred = null;
});

describe('the table (§5.7)', () => {
  it('one table named "Audit events", 8 unique column headers in order, one row per log', async () => {
    await renderRows([LOGIN, AI]);
    const table = screen.getByRole('table', { name: 'Audit events' });
    expect(screen.getAllByRole('table')).toHaveLength(1);
    const headers = within(table).getAllByRole('columnheader');
    const names = headers.map((h) => h.textContent);
    // LF-8: "Details" (screen-reader-only) is now the narrow last column.
    expect(names).toEqual(['Time (UTC)', 'Event', 'Severity', 'Entity', 'Resource', 'Business', 'User', 'Details']);
    expect(new Set(names).size).toBe(names.length);
    for (const header of headers) expect(header.getAttribute('scope')).toBe('col');
    expect(rows()).toHaveLength(2);
  });

  it('the Time cell is UTC "YYYY-MM-DD HH:mm UTC"', async () => {
    await renderRows([LOGIN]);
    const cells = within(rows()[0]).getAllByRole('cell');
    expect(cells[0].textContent).toBe('2026-10-10 09:00 UTC');
  });

  it('severity is a chip in words with its tone; an unknown value shows its raw word as unknown', async () => {
    await renderRows([CRITICAL, AI, LOGIN, ODD, PROTO, EMPTY]);
    const chips = screen.getAllByTestId('audit-severity');
    expect(chips.map((c) => [c.textContent, c.getAttribute('data-tone')])).toEqual([
      ['Critical', 'danger'],
      ['Warning', 'warn'],
      ['Info', 'info'],
      ['notice', 'unknown'],
      ['constructor', 'unknown'],
      ['Unknown', 'unknown'],
    ]);
  });

  // LF-8 (user request 2026-10-15): an icon in the narrow last cell; was the word "Open" in the first.
  it('the Open button is an icon in the last cell, named by the event and its time', async () => {
    await renderRows([LOGIN]);
    const cells = within(rows()[0]).getAllByRole('cell');
    const last = cells[cells.length - 1];
    const button = within(last).getByRole('button');
    expect(button.getAttribute('aria-label')).toBe('Open details for User Login at 2026-10-10 09:00 UTC');
    expect(button.textContent).toBe('');
    expect(button.getAttribute('data-testid')).toBe('audit-open-details');
    expect(last.classList.contains('w-10')).toBe(true);
  });

  it('LF-8: the Open column is narrow and its header word is for screen readers only', async () => {
    await renderRows([LOGIN]);
    const headers = within(screen.getByRole('table', { name: 'Audit events' })).getAllByRole('columnheader');
    const last = headers[headers.length - 1];
    expect(last.classList.contains('w-10')).toBe(true);
    const word = last.querySelector('span');
    expect(word?.className).toBe('sr-only');
    expect(word?.textContent).toBe('Details');
  });

  it('a row with no business and a system row show an em dash in Business and User (§5.7)', async () => {
    await renderRows([LOGIN, AI]);
    const [system, ai] = rows();
    expect(within(system).getByTestId('audit-cell-business').textContent).toBe('—');
    expect(within(system).getByTestId('audit-cell-user').textContent).toBe('—');
    expect(within(ai).getByTestId('audit-cell-business').textContent).toBe('Acme Dental');
    expect(within(ai).getByTestId('audit-cell-user').textContent).toBe('Dana Cohen');
  });
});

describe('the drawer (C-9, R-6)', () => {
  it('Open shows the row in a dialog named "event time", with Event ID and the exact stored time', async () => {
    await renderRows([LOGIN]);
    fireEvent.click(screen.getByRole('button', { name: /^Open details for User Login/ }));
    const dialog = await screen.findByRole('dialog', { name: 'User Login 2026-10-10 09:00 UTC' });
    // textContent proves the literal space (SA S-4); jsdom's role name pads elements anyway.
    expect(within(dialog).getByRole('heading', { level: 2 }).textContent).toBe('User Login 2026-10-10 09:00 UTC');
    expect(dialog.getAttribute('data-testid')).toBe('audit-drawer');
    const eventId = within(dialog).getByText('Event ID', { selector: 'dt' });
    expect((eventId.parentElement as HTMLElement).textContent).toContain('log-1');
    expect(within(dialog).getByTestId('audit-recorded').textContent).toBe('2026-10-10T09:00:00.000Z');
  });

  it('an AI row shows "AI action details" with its allow-listed fields only, and no "Event details"', async () => {
    await renderRows([AI]);
    fireEvent.click(screen.getByRole('button', { name: /^Open details for/ }));
    const dialog = await screen.findByRole('dialog');
    const ai = within(dialog).getByRole('group', { name: 'AI action details' });
    expect(within(ai).getByText('Area', { selector: 'dt' })).toBeTruthy();
    expect(within(ai).getByText('Estimated Cost', { selector: 'dt' })).toBeTruthy();
    // SA M-4: an undefined field is omitted, not shown empty.
    expect(within(ai).queryByText('Grouping ID')).toBeNull();
    // The allow-list holds: a key it does not name never reaches the screen.
    expect(dialog.textContent).not.toContain('never shown');
    expect(within(dialog).queryByRole('group', { name: 'Event details' })).toBeNull();
  });

  it('a non-AI row with details shows "Event details"', async () => {
    await renderRows([LOGIN]);
    fireEvent.click(screen.getByRole('button', { name: /^Open details for/ }));
    const dialog = await screen.findByRole('dialog');
    const details = within(dialog).getByRole('group', { name: 'Event details' });
    expect(details.textContent).toContain('10.0.0.1');
  });

  it('each section has exactly one heading, its own h3 (SA M-4)', async () => {
    await renderRows([AI]);
    fireEvent.click(screen.getByRole('button', { name: /^Open details for/ }));
    const dialog = await screen.findByRole('dialog');
    const groups = within(dialog).getAllByRole('group');
    expect(groups.length).toBeGreaterThan(1);
    for (const group of groups) {
      const headings = within(group).getAllByRole('heading');
      expect({ group: group.getAttribute('aria-labelledby'), count: headings.length }).toEqual({
        group: headings[0].id,
        count: 1,
      });
      expect(headings[0].tagName).toBe('H3');
    }
    expect(within(dialog).queryByRole('heading', { name: 'AI Action Details' })).toBeNull();
  });

  it('Escape closes it and focus returns to that row\'s Open button', async () => {
    await renderRows([LOGIN, AI]);
    const second = within(rows()[1]).getByRole('button', { name: /^Open details for/ });
    second.focus();
    fireEvent.click(second);
    const dialog = await screen.findByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(second);
  });

  it('opening and closing rows asks the route for nothing (R-6)', async () => {
    const fetchMock = await renderRows([LOGIN, AI]);
    const before = fetchMock.mock.calls.length;
    for (const row of rows()) {
      fireEvent.click(within(row).getByRole('button', { name: /^Open details for/ }));
      const dialog = await screen.findByRole('dialog');
      fireEvent.keyDown(dialog, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    }
    expect(fetchMock.mock.calls.length).toBe(before);
  });

  it('opening another row shows that row', async () => {
    await renderRows([LOGIN, AI]);
    fireEvent.click(within(rows()[0]).getByRole('button', { name: /^Open details for/ }));
    fireEvent.keyDown(await screen.findByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(within(rows()[1]).getByRole('button', { name: /^Open details for/ }));
    expect(await screen.findByRole('dialog', { name: 'Business Ai Action Completed 2026-10-10 08:30 UTC' })).toBeTruthy();
  });
});

describe('count line, pager and the search notice', () => {
  it('the count line keeps its words: "Showing 2 of 2 audit logs"', async () => {
    await renderRows([LOGIN, AI]);
    expect(screen.getByTestId('audit-count').textContent).toBe('Showing 2 of 2 audit logs');
  });

  it('the caveat is an AdminNotice, shown only while searching, with no role', async () => {
    const fetchMock = await renderRows([LOGIN]);
    expect(screen.queryByTestId('audit-search-caveat')).toBeNull();

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'acme' } });
    await waitFor(() => expect(auditUrls(fetchMock).some((u) => u.includes('search=acme'))).toBe(true));
    const notice = await screen.findByTestId('audit-search-caveat');
    expect(notice.textContent).toBe(
      'Search scans only the current page of results. Use the Action, Entity Type, Severity and date filters for complete results.',
    );
    expect((notice.parentElement as HTMLElement).className).toContain('border-amber-500/40');
    expect((notice.parentElement as HTMLElement).hasAttribute('role')).toBe(false);
    expect(screen.getByTestId('audit-count').textContent).toBe('Showing 1 matches on this page (Page 1)');
  });

  it('a 20-row page pages by the unfiltered total, with the shared button style', async () => {
    answer = { kind: 'rows', logs: Array.from({ length: 20 }, (_, i) => ({ ...LOGIN, id: `r${i}` })), total: 45, totalPages: 3, hasMore: true };
    const fetchMock = mockFetch();
    render(<AuditTrailPage />);
    await screen.findByTestId('audit-table');
    await settled();

    expect(screen.getByTestId('audit-count').textContent).toBe('Showing 20 of 45 audit logs (Page 1 of 3)');
    const previous = screen.getByRole('button', { name: 'Previous' }) as HTMLButtonElement;
    expect(previous.className).toBe(ADMIN_BUTTON);
    expect(previous.disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(auditUrls(fetchMock)).toHaveLength(2));
    expect(new URLSearchParams(auditUrls(fetchMock)[1].split('?')[1]).get('page')).toBe('2');
  });
});

describe('QA B-1: the open row leaves the page', () => {
  it('a read that lands without the open row closes the drawer, keeps focus off <body>, and a later read does not reopen it', async () => {
    await renderRows([LOGIN, AI]);

    // A Refresh is in flight when the admin opens a row.
    answer = { kind: 'deferred' };
    fireEvent.click(screen.getByRole('button', { name: 'Refresh the audit trail' }));
    await waitFor(() => expect(releaseDeferred).not.toBeNull());
    const second = within(rows()[1]).getByRole('button', { name: /^Open details for/ });
    second.focus();
    fireEvent.click(second);
    await screen.findByRole('dialog');

    // The read lands without that row.
    await act(async () => {
      releaseDeferred?.([LOGIN]);
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(rows()).toHaveLength(1));
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
    expect(document.activeElement?.isConnected).toBe(true);

    // A later read brings the row back: the drawer stays closed.
    releaseDeferred = null;
    answer = { kind: 'rows', logs: [LOGIN, AI] };
    fireEvent.click(screen.getByRole('button', { name: 'Refresh the audit trail' }));
    await waitFor(() => expect(rows()).toHaveLength(2));
    await settled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('failure paths', () => {
  it('a failed FIRST read shows the red box and no count line (SA N-2)', async () => {
    answer = { kind: 'html', status: 500 };
    mockFetch();
    render(<AuditTrailPage />);
    expect(await screen.findByTestId('audit-error')).toBeTruthy();
    expect(screen.queryByTestId('audit-count')).toBeNull();
    expect(screen.queryByTestId('audit-table')).toBeNull();
    expect(document.body.textContent).not.toContain('Showing 0');
  });

  it('a failed Refresh keeps the table rows and the count line', async () => {
    await renderRows([LOGIN, AI]);
    answer = { kind: 'html', status: 502 };
    fireEvent.click(screen.getByRole('button', { name: 'Refresh the audit trail' }));
    expect(await screen.findByTestId('audit-error')).toBeTruthy();
    expect(rows()).toHaveLength(2);
    expect(screen.getByTestId('audit-count').textContent).toBe('Showing 2 of 2 audit logs');
  });
});
