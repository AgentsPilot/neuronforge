/**
 * @jest-environment jsdom
 */

/**
 * The audit trail's account filter can now be SET from the UI, not only cleared.
 *
 * The filter itself was already correct — `app/api/admin/audit-trail/route.ts`
 * does `.eq('user_id', accountId)` at the database level — but the page had no
 * way to choose an account, so an operator needed the UUID in a URL first. These
 * tests pin the behaviour that closes that, and the two things about it that are
 * easy to regress:
 *
 *   1. the picked account reaches the ROUTE as `user_id` (the DB-level filter),
 *      never the free-text `search` (which filters one page in memory);
 *   2. no business name and no search text reaches a log line (AC-B13).
 *
 * Renders the real page in jsdom like the sibling suites (Playwright is not
 * installed — CLAUDE.md § Testing) and asserts with `toBeTruthy()` /
 * `toBeNull()`, because jest-dom is not configured in this project.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock('@/components/UserProvider', () => ({
  useAuth: () => ({ user: { id: 'admin-user', email: 'admin@example.com' } }),
}));

const loggerCalls: unknown[][] = [];
const record = (...args: unknown[]) => {
  loggerCalls.push(args);
};

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: jest.fn(record),
    warn: jest.fn(record),
    error: jest.fn(record),
    debug: jest.fn(record),
    child: jest.fn().mockReturnThis(),
  }),
}));

let mockSearch = '';
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

import { ARCHIVING_OVERVIEW_URL } from '@/hooks/useLatestArchiveCutoff';

import AuditTrailPage from '../page';
import { BUSINESS_SEARCH_PATH } from '../BusinessAccountPicker';

const ACME = '99999999-9999-4999-8999-999999999999';
const UNNAMED = '22222222-2222-4222-8222-222222222222';
const NO_PROFILE = '33333333-3333-4333-8333-333333333333';

interface BusinessRow {
  userId: string;
  companyName: string | null;
}

const DEFAULT_BUSINESSES: BusinessRow[] = [
  { userId: ACME, companyName: 'Acme Dental' },
  { userId: UNNAMED, companyName: null },
];

interface MockOptions {
  businesses?: BusinessRow[];
  limit?: number;
  businessesResponse?: { status: number; body: unknown };
  businessesThrows?: boolean;
}

/** The audit list + the reused business list + the unrelated archive notice. */
function mockFetch(options: MockOptions = {}): jest.Mock {
  const { businesses = DEFAULT_BUSINESSES, limit = 50 } = options;

  const fetchMock = jest.fn(async (url: string) => {
    if (String(url).startsWith(BUSINESS_SEARCH_PATH)) {
      if (options.businessesThrows) throw new Error('network down');
      if (options.businessesResponse) {
        return {
          ok: options.businessesResponse.status < 400,
          status: options.businessesResponse.status,
          json: async () => options.businessesResponse!.body,
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            businesses,
            limit,
            platformAccountIds: ['00000000-0000-0000-0000-000000000000'],
            platformAccountEnvIgnored: false,
          },
        }),
      };
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        logs: [],
        pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0, hasMore: false, showing: 0 },
      }),
    };
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
  (global as any).fetch = fetchMock;
  return fetchMock;
}

function auditUrls(fetchMock: jest.Mock): string[] {
  return fetchMock.mock.calls.map(([url]) => String(url)).filter((url) => url.startsWith('/api/admin/audit-trail?'));
}

function businessUrls(fetchMock: jest.Mock): string[] {
  return fetchMock.mock.calls.map(([url]) => String(url)).filter((url) => url.startsWith(BUSINESS_SEARCH_PATH));
}

/** Focus the picker and wait for its first list. */
async function openPicker(fetchMock: jest.Mock): Promise<HTMLElement> {
  const input = await screen.findByTestId('business-picker-input');
  fireEvent.focus(input);
  await waitFor(() => expect(businessUrls(fetchMock).length).toBeGreaterThan(0));
  return input;
}

beforeEach(() => {
  jest.clearAllMocks();
  loggerCalls.length = 0;
  mockSearch = '';
  window.history.replaceState({}, '', '/admin/audit-trail');
});

describe('finding a business by name', () => {
  it('lists businesses when the field is first used, with no search term', async () => {
    const fetchMock = mockFetch();
    render(<AuditTrailPage />);

    await openPicker(fetchMock);
    expect(businessUrls(fetchMock)).toEqual([BUSINESS_SEARCH_PATH]);
    expect((await screen.findByTestId('business-picker-options')).textContent).toContain('Acme Dental');
  });

  it('does not touch the business list until the picker is used', async () => {
    const fetchMock = mockFetch();
    render(<AuditTrailPage />);

    // The page load itself must not cost a business-profiles read.
    await waitFor(() => expect(auditUrls(fetchMock).length).toBe(1));
    expect(businessUrls(fetchMock)).toEqual([]);
  });

  it('sends what was typed as the server-side search term', async () => {
    const fetchMock = mockFetch();
    render(<AuditTrailPage />);

    const input = await openPicker(fetchMock);
    fireEvent.change(input, { target: { value: 'acme' } });

    await waitFor(() => expect(businessUrls(fetchMock)).toContain(`${BUSINESS_SEARCH_PATH}?search=acme`));
  });

  it('says so when a name matches nothing', async () => {
    const fetchMock = mockFetch({ businesses: [] });
    render(<AuditTrailPage />);

    await openPicker(fetchMock);
    expect((await screen.findByTestId('business-picker-empty')).textContent).toContain('No business matches');
  });
});

describe('choosing a business', () => {
  it('filters the audit trail by user_id — the database-level filter, not the search', async () => {
    const fetchMock = mockFetch();
    render(<AuditTrailPage />);

    await openPicker(fetchMock);
    fireEvent.click(await screen.findByText('Acme Dental'));

    await waitFor(() => expect(auditUrls(fetchMock).length).toBe(2));
    const latest = auditUrls(fetchMock).at(-1)!;
    const params = new URLSearchParams(latest.split('?')[1]);
    expect(params.get('user_id')).toBe(ACME);
    // THE regression that would look like it worked: routing the name through the
    // in-memory free-text search, which only ever sees one window of rows.
    expect(params.get('search')).toBeNull();
  });

  it('goes back to every account when the chip is cleared', async () => {
    // Filter state is the only source of truth here — the URL is a record of
    // arrival and is deliberately never written to — so clearing is observable
    // exactly where it matters: the next request drops `user_id` entirely.
    const fetchMock = mockFetch();
    render(<AuditTrailPage />);

    await openPicker(fetchMock);
    fireEvent.click(await screen.findByText('Acme Dental'));
    await waitFor(() => expect(auditUrls(fetchMock).length).toBe(2));

    fireEvent.click(await screen.findByLabelText('Show every account'));
    await waitFor(() => expect(auditUrls(fetchMock).length).toBe(3));
    expect(new URLSearchParams(auditUrls(fetchMock).at(-1)!.split('?')[1]).get('user_id')).toBeNull();
  });

  it('shows the active account chip once an account is chosen', async () => {
    const fetchMock = mockFetch();
    render(<AuditTrailPage />);

    expect(screen.queryByTestId('account-filter-chip')).toBeNull();
    await openPicker(fetchMock);
    fireEvent.click(await screen.findByText('Acme Dental'));

    expect(await screen.findByTestId('account-filter-chip')).toBeTruthy();
  });

  it('can be driven from the keyboard', async () => {
    const fetchMock = mockFetch();
    render(<AuditTrailPage />);

    const input = await openPicker(fetchMock);
    fireEvent.keyDown(input, { key: 'ArrowDown' }); // 0 -> 1, the unnamed business
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(auditUrls(fetchMock).length).toBe(2));
    expect(new URLSearchParams(auditUrls(fetchMock).at(-1)!.split('?')[1]).get('user_id')).toBe(UNNAMED);
  });

  it('closes the list and clears the box, leaving the chip as the single indicator', async () => {
    const fetchMock = mockFetch();
    render(<AuditTrailPage />);

    const input = await openPicker(fetchMock);
    fireEvent.change(input, { target: { value: 'acme' } });
    fireEvent.click(await screen.findByText('Acme Dental'));

    await waitFor(() => expect(screen.queryByTestId('business-picker-options')).toBeNull());
    expect((input as HTMLInputElement).value).toBe('');
  });
});

describe('a business with no name, and an account with no business profile', () => {
  it('shows an unnamed business as unnamed and still lets it be picked', async () => {
    const fetchMock = mockFetch();
    render(<AuditTrailPage />);

    await openPicker(fetchMock);
    const unnamed = await screen.findByText('Unnamed business');
    // Never the entity id in the name's place — the same mistake the account chip
    // was just fixed for.
    expect(unnamed.textContent).not.toContain(UNNAMED.slice(0, 8));

    fireEvent.click(unnamed);
    await waitFor(() => expect(auditUrls(fetchMock).length).toBe(2));
    expect(new URLSearchParams(auditUrls(fetchMock).at(-1)!.split('?')[1]).get('user_id')).toBe(UNNAMED);
  });

  it('treats a blank company name as unnamed rather than printing empty space', async () => {
    const fetchMock = mockFetch({ businesses: [{ userId: UNNAMED, companyName: '   ' }] });
    render(<AuditTrailPage />);

    await openPicker(fetchMock);
    expect(await screen.findByText('Unnamed business')).toBeTruthy();
  });

  it('states out loud that only accounts with a profile can be found by name', async () => {
    mockFetch();
    render(<AuditTrailPage />);

    // Permanently visible, not hidden behind an empty result: an account with no
    // business_profiles row can never appear, however long the operator types.
    const hint = await screen.findByTestId('business-picker-hint');
    expect(hint.textContent).toContain('Only accounts with a business profile can be found by name');
    expect(hint.textContent).toContain('Paste a full account id');
  });

  it('offers a pasted account id, so an account with no profile is still reachable', async () => {
    const fetchMock = mockFetch({ businesses: [] });
    render(<AuditTrailPage />);

    const input = await openPicker(fetchMock);
    fireEvent.change(input, { target: { value: NO_PROFILE } });

    const pasted = await screen.findByTestId('business-picker-pasted');
    fireEvent.click(pasted);

    await waitFor(() => expect(auditUrls(fetchMock).length).toBe(2));
    expect(new URLSearchParams(auditUrls(fetchMock).at(-1)!.split('?')[1]).get('user_id')).toBe(NO_PROFILE);
  });

  it('does not offer a pasted id for text that is not a full account id', async () => {
    const fetchMock = mockFetch({ businesses: [] });
    render(<AuditTrailPage />);

    const input = await openPicker(fetchMock);
    fireEvent.change(input, { target: { value: NO_PROFILE.slice(0, 20) } });

    await waitFor(() => expect(screen.queryByTestId('business-picker-empty')).toBeTruthy());
    expect(screen.queryByTestId('business-picker-pasted')).toBeNull();
  });
});

describe('the list is capped by the repository, so the cap is admitted', () => {
  it('says the list is the first N when it comes back full', async () => {
    const businesses = Array.from({ length: 3 }, (_, index) => ({
      userId: `4444444${index}-4444-4444-8444-44444444444${index}`,
      companyName: `Business ${index}`,
    }));
    const fetchMock = mockFetch({ businesses, limit: 3 });
    render(<AuditTrailPage />);

    await openPicker(fetchMock);
    expect((await screen.findByTestId('business-picker-truncated')).textContent).toContain('First 3 matches only');
  });

  it('says nothing about a cap when the list is short', async () => {
    const fetchMock = mockFetch({ limit: 50 });
    render(<AuditTrailPage />);

    await openPicker(fetchMock);
    await screen.findByText('Acme Dental');
    expect(screen.queryByTestId('business-picker-truncated')).toBeNull();
  });
});

describe('a business name never reaches a log line (AC-B13)', () => {
  it('logs nothing that carries a name or the search text', async () => {
    const fetchMock = mockFetch();
    render(<AuditTrailPage />);

    const input = await openPicker(fetchMock);
    fireEvent.change(input, { target: { value: 'acme' } });
    await waitFor(() => expect(businessUrls(fetchMock)).toContain(`${BUSINESS_SEARCH_PATH}?search=acme`));
    fireEvent.click(await screen.findByText('Acme Dental'));
    await waitFor(() => expect(auditUrls(fetchMock).length).toBe(2));

    const logged = JSON.stringify(loggerCalls);
    expect(logged).not.toContain('Acme Dental');
    expect(logged).not.toContain('acme');
  });

  it('logs a failed lookup without the term that produced it', async () => {
    const fetchMock = mockFetch({ businessesThrows: true });
    render(<AuditTrailPage />);

    const input = await screen.findByTestId('business-picker-input');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'acme dental' } });

    await waitFor(() => expect(loggerCalls.length).toBeGreaterThan(0));
    const logged = JSON.stringify(loggerCalls);
    expect(logged).not.toContain('acme dental');
    // Something was recorded, so the failure is not silent.
    expect(logged).toContain('Business list for the audit account filter failed');
    expect(fetchMock).toHaveBeenCalled();
  });
});

describe('when the business list cannot be read', () => {
  it('shows the route’s refusal and keeps the rest of the page working', async () => {
    const fetchMock = mockFetch({ businessesResponse: { status: 403, body: { success: false, error: 'Forbidden' } } });
    render(<AuditTrailPage />);

    await openPicker(fetchMock);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Forbidden'));
    // The audit rows were still fetched; the picker failing is not the page failing.
    expect(auditUrls(fetchMock).length).toBe(1);
  });

  it('degrades to an empty list when the response shape is not what it expects', async () => {
    const fetchMock = mockFetch({ businessesResponse: { status: 200, body: { success: true, data: {} } } });
    render(<AuditTrailPage />);

    await openPicker(fetchMock);
    expect(await screen.findByTestId('business-picker-empty')).toBeTruthy();
  });
});

describe('the deep link still works', () => {
  it('filters by the id in the URL on arrival and leaves the URL alone', async () => {
    mockSearch = `user_id=${ACME}`;
    window.history.replaceState({}, '', `/admin/audit-trail?user_id=${ACME}`);
    const fetchMock = mockFetch();
    render(<AuditTrailPage />);

    await waitFor(() => expect(auditUrls(fetchMock).length).toBe(1));
    expect(new URLSearchParams(auditUrls(fetchMock)[0].split('?')[1]).get('user_id')).toBe(ACME);
    expect(new URLSearchParams(window.location.search).get('user_id')).toBe(ACME);
  });
});

describe('the unrelated fetches this page already makes', () => {
  it('still only asks for the log list and the archive notice on mount', async () => {
    const fetchMock = mockFetch();
    render(<AuditTrailPage />);

    await waitFor(() => expect(auditUrls(fetchMock).length).toBe(1));
    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls.filter((url) => url !== ARCHIVING_OVERVIEW_URL)).toEqual(auditUrls(fetchMock));
  });
});
