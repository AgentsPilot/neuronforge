/**
 * @jest-environment jsdom
 *
 * Finance F-4 (AC-174 to AC-177, SA-WP-F4): the shared URL hook on the real
 * page, with jsdom's real `history` and a `replaceState` spy. The address bar
 * is written by the hook alone (`replaceState(null, …)`, never `pushState`,
 * never the router), in canonical keys; the REQUEST is held to the AC-173
 * literals (`financeRequestPins.ts`).
 *
 * F4-R1: the four kinds of link whose request changes on purpose (E-60) are
 * pinned here with their NEW request literal. F4-R2: the URL clean-up sends no
 * second request. F4-R3: the refused-Apply sentence clears on an applied
 * window, a preset click and Clear, and never reaches the URL.
 *
 * Reads are answered with a 404 body: the request and the address bar are the
 * subject, and the filter bar is mounted whatever the read returns.
 */

import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

let mockSearch = '';
const mockRouterReplace = jest.fn();
const mockRouterPush = jest.fn();
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mockSearch),
  useRouter: () => ({ replace: mockRouterReplace, push: mockRouterPush }),
  usePathname: () => '/admin/finance',
}));
const mockPickName = 'Acme Dental (picked)';
jest.mock('@/app/admin/components/layout/AdminBusinessPicker', () => ({
  ...jest.requireActual('@/app/admin/components/layout/AdminBusinessPicker'),
  AdminBusinessPicker: ({ onSelect }: { onSelect: (id: string, name: string | null) => void }) => (
    <button type="button" data-testid="picker-pick" onClick={() => onSelect('1A2B3C4D-1111-4111-8111-ABCDEFABCDEF', 'Acme Dental (picked)')}>
      pick
    </button>
  ),
}));

import { FinanceView } from '../components/FinanceView';
import { accountViewHref } from '../financeLinks';
import { FINANCE_REQUEST_PATH, PIN_ACCOUNT as A, pinnedRequest } from './financeRequestPins';
import type { FinanceWindowChoice } from '@/lib/business-os/finance/financeTypes';

// Each case renders the whole page several times; under a full parallel run the
// default 5 s per test is too tight (seen locally), and a timed-out case leaks into the next.
jest.setTimeout(30_000);

const REQ = (query: string) => `${FINANCE_REQUEST_PATH}?${query}`;
const CUSTOM = 'from=2026-09-01&to=2026-09-30';

let replaceSpy: jest.SpyInstance | null = null;
let pushSpy: jest.SpyInstance | null = null;
let fetchMock: jest.Mock;

function failedReads(): jest.Mock {
  const mock = jest.fn(async () => ({ ok: false, status: 404, json: async () => ({ success: false, error: 'Business not found' }) }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
  (global as any).fetch = mock;
  return mock;
}

/** Opens the page on a link, as a browser would: the address bar and `useSearchParams` agree. */
async function open(link: string) {
  mockSearch = link;
  window.history.replaceState(null, '', link ? `/admin/finance?${link}` : '/admin/finance');
  replaceSpy = jest.spyOn(window.history, 'replaceState');
  pushSpy = jest.spyOn(window.history, 'pushState');
  const view = render(<FinanceView />);
  await settle();
  return view;
}

/** Lets every pending read answer and every effect run. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Every `history.replaceState` call since the page opened. */
const replaceCalls = (): unknown[][] => (replaceSpy ? replaceSpy.mock.calls : []);
const address = () => `${window.location.pathname}${window.location.search}`;
const requests = () => fetchMock.mock.calls.map((call) => String((call as unknown[])[0]));

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  mockSearch = '';
  replaceSpy = null;
  pushSpy = null;
  fetchMock = failedReads();
});

afterEach(() => {
  // The address bar is written by the hook alone (S-6, U-2). (The imported table self-check opens no page.)
  if (replaceSpy === null || pushSpy === null) return;
  expect(pushSpy).not.toHaveBeenCalled();
  expect(mockRouterReplace).not.toHaveBeenCalled();
  expect(mockRouterPush).not.toHaveBeenCalled();
  for (const call of replaceCalls()) expect(call[0]).toBeNull();
});

describe('AC-174: old links keep working, and the address bar takes the canonical keys', () => {
  it('an old-key bookmark is rewritten once to range / account (unknown keys kept), with ONE read', async () => {
    await open(`preset=custom&${CUSTOM}&accountId=${A}&utm_source=x`);
    expect(requests()).toEqual([pinnedRequest(9)]);
    expect(replaceSpy).toHaveBeenCalledTimes(1);
    expect(address()).toBe(`/admin/finance?utm_source=x&range=custom&${CUSTOM}&account=${A}`);
  });

  it('the Businesses page "Open money view" link (BusinessOsPanel) opens this business on This month', async () => {
    await open(`accountId=${encodeURIComponent(A)}&preset=this_month`);
    expect(requests()).toEqual([pinnedRequest(10)]);
    expect(address()).toBe(`/admin/finance?account=${A}`);
    expect(screen.getByTestId('business-filter-chip')).toHaveTextContent('Business: 1a2b3c4d');
  });

  it.each<FinanceWindowChoice>(['today', '7d', '30d', 'this_month', 'custom'])(
    'an Accounts row link (accountViewHref), window %s: the same window and business, no tab, one read',
    async (preset) => {
      const linkWindow = preset === 'custom' ? { preset, from: '2026-09-01', to: '2026-09-30' } : { preset, from: '2026-10-01', to: '2026-10-09' };
      const href = accountViewHref(A, linkWindow);
      await open(href.slice('/admin/finance?'.length));
      const dates = preset === 'custom' ? `&${CUSTOM}` : '';
      expect(requests()).toEqual([REQ(`preset=${preset}${dates}&accountId=${A}`)]);
      expect(address()).toBe(preset === 'this_month' ? `/admin/finance?account=${A}` : `/admin/finance?range=${preset}${dates}&account=${A}`);
      expect(screen.queryByRole('tablist')).toBeNull();
    }
  );

  it('an outside change (a Link to this page, Back) is re-read and sends its request', async () => {
    const view = await open('range=7d');
    expect(requests()).toEqual([pinnedRequest(3)]);
    mockSearch = `preset=this_month&accountId=${A}`;
    window.history.replaceState(null, '', `/admin/finance?${mockSearch}`);
    view.rerender(<FinanceView />);
    await settle();
    expect(requests()).toEqual([pinnedRequest(3), pinnedRequest(7)]);
    expect(address()).toBe(`/admin/finance?account=${A}`);
  });
});

describe('F4-R1 (E-60): the four kinds of link whose request changes on purpose, each with its new literal', () => {
  it('1. one bad value among good ones: only the bad one is dropped (before: everything reset to preset=this_month)', async () => {
    await open('preset=7d&accountId=acme&tab=accounts&sort=margin');
    expect(requests()).toEqual([REQ('preset=7d&tab=accounts&sort=margin')]);
    expect(address()).toBe('/admin/finance?range=7d&tab=accounts&sort=margin');
    expect(screen.queryByTestId('finance-url-notice')).toBeNull();
  });

  it('2a. a business together with the tab keeps the business (before: everything reset); F4-R2: one read, URL cleaned', async () => {
    await open(`tab=accounts&account=${A}&sort=margin`);
    expect(requests()).toEqual([pinnedRequest(7)]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(address()).toBe(`/admin/finance?account=${A}`);
  });

  it('2b. sort / group / show without the tab keep the window (before: everything reset); one read, URL cleaned', async () => {
    await open('preset=30d&sort=margin&show=active');
    expect(requests()).toEqual([REQ('preset=30d')]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(address()).toBe('/admin/finance?range=30d');
  });

  it('3. from / to with no range is an implied custom window (before: the dates were dropped, This month)', async () => {
    await open(`${CUSTOM}&accountId=${A}`);
    expect(requests()).toEqual([REQ(`preset=custom&${CUSTOM}&accountId=${A}`)]);
    expect(address()).toBe(`/admin/finance?range=custom&${CUSTOM}&account=${A}`);
  });

  it('4. a repeated key: the first value wins (before: everything reset to preset=this_month)', async () => {
    await open('preset=7d&preset=30d');
    expect(requests()).toEqual([REQ('preset=7d')]);
    expect(address()).toBe('/admin/finance?range=7d');
  });
});

describe('AC-175: a bad link drops only the bad filter, silently', () => {
  it('range=year with a business: This month for that business, no notice', async () => {
    await open(`range=year&account=${A}`);
    expect(requests()).toEqual([pinnedRequest(7)]);
    expect(address()).toBe(`/admin/finance?account=${A}`);
    expect(screen.queryByTestId('finance-url-notice')).toBeNull();
    expect(screen.queryByText(/could not use/)).toBeNull();
  });

  it('a malformed business with 7 days: 7 days for all businesses', async () => {
    await open('account=acme&range=7d');
    expect(requests()).toEqual([pinnedRequest(3)]);
    expect(address()).toBe('/admin/finance?range=7d');
  });
});

describe('AC-177: the window presets and Custom (the shared DatePresets)', () => {
  it('a preset click writes range and sends the pinned request; a second click on the pressed preset goes back to This month', async () => {
    await open(`account=${A}`);
    fireEvent.click(screen.getByRole('button', { name: '7 days' }));
    await settle();
    expect(requests()).toEqual([pinnedRequest(7), pinnedRequest(8)]);
    expect(address()).toBe(`/admin/finance?range=7d&account=${A}`);
    expect(screen.getByRole('button', { name: '7 days' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '7 days' }));
    await settle();
    expect(requests()).toEqual([pinnedRequest(7), pinnedRequest(8), pinnedRequest(7)]);
    expect(address()).toBe(`/admin/finance?account=${A}`);
  });

  it('Custom opens From / To; Apply needs both dates; a valid Apply sends the custom request', async () => {
    await open('');
    expect(screen.queryByLabelText('From (UTC)')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    const from = screen.getByLabelText('From (UTC)');
    const to = screen.getByLabelText('To (UTC)');
    fireEvent.change(from, { target: { value: '' } });
    fireEvent.change(to, { target: { value: '' } });
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    fireEvent.change(from, { target: { value: '2026-09-01' } });
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    fireEvent.change(to, { target: { value: '2026-09-30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await settle();
    expect(requests()).toEqual([pinnedRequest(1), pinnedRequest(6)]);
    expect(address()).toBe(`/admin/finance?range=custom&${CUSTOM}`);
  });
});

describe('SA-W5 (a) and F4-R3: a custom window the route would refuse is never applied', () => {
  async function refuse(fromValue: string, toValue: string) {
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    fireEvent.change(screen.getByLabelText('From (UTC)'), { target: { value: fromValue } });
    fireEvent.change(screen.getByLabelText('To (UTC)'), { target: { value: toValue } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await settle();
  }

  it('more than 92 days: the red sentence, no read, the address bar untouched, the row still open', async () => {
    await open('range=7d');
    const writes = replaceCalls().length;
    await refuse('2026-06-01', '2026-09-30');
    const problem = screen.getByTestId('finance-window-problem');
    expect(problem).toHaveTextContent('The window may be at most 92 days');
    expect(problem).toHaveAttribute('role', 'alert');
    expect(problem).toHaveClass('text-red-300');
    expect(requests()).toEqual([pinnedRequest(3)]);
    expect(replaceCalls().length).toBe(writes);
    expect(address()).toBe('/admin/finance?range=7d');
    expect(screen.getByLabelText('From (UTC)')).toHaveValue('2026-06-01');
    expect(window.location.href).not.toMatch(/92|window|problem/i);
  });

  it('an end after today UTC is refused with its own sentence', async () => {
    await open('');
    await refuse('2026-09-01', '2999-01-01');
    expect(screen.getByTestId('finance-window-problem')).toHaveTextContent('The end date must not be after today (UTC)');
    expect(requests()).toEqual([pinnedRequest(1)]);
  });

  it('the sentence clears on a valid Apply (an applied window)', async () => {
    await open('');
    await refuse('2026-06-01', '2026-09-30');
    expect(screen.getByTestId('finance-window-problem')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('From (UTC)'), { target: { value: '2026-09-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await settle();
    expect(screen.queryByTestId('finance-window-problem')).toBeNull();
    expect(requests()).toEqual([pinnedRequest(1), pinnedRequest(6)]);
  });

  it('the sentence clears on a preset click', async () => {
    await open('');
    await refuse('2026-06-01', '2026-09-30');
    fireEvent.click(screen.getByRole('button', { name: '30 days' }));
    await settle();
    expect(screen.queryByTestId('finance-window-problem')).toBeNull();
    expect(requests()).toEqual([pinnedRequest(1), pinnedRequest(4)]);
  });

  it('the sentence clears on Clear', async () => {
    await open(`account=${A}`);
    await refuse('2026-06-01', '2026-09-30');
    expect(screen.getByTestId('finance-window-problem')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await settle();
    expect(screen.queryByTestId('finance-window-problem')).toBeNull();
  });

  it('the sentence clears when an outside change applies another window', async () => {
    const view = await open('');
    await refuse('2026-06-01', '2026-09-30');
    mockSearch = 'range=today';
    window.history.replaceState(null, '', '/admin/finance?range=today');
    view.rerender(<FinanceView />);
    await settle();
    expect(screen.queryByTestId('finance-window-problem')).toBeNull();
  });
});

describe('SA-W4: Clear', () => {
  it('is disabled at the defaults', async () => {
    await open('');
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
  });

  it('resets the window and the business and goes back to the default request', async () => {
    await open(`range=7d&account=${A}`);
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await settle();
    expect(requests()).toEqual([pinnedRequest(8), pinnedRequest(1)]);
    expect(address()).toBe('/admin/finance');
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
  });

  it('on the Accounts tab: resets sort / group / show and stays on the tab', async () => {
    await open('range=30d&tab=accounts&sort=margin&show=negative');
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await settle();
    expect(requests()).toEqual([REQ('preset=30d&tab=accounts&sort=margin&show=negative'), pinnedRequest(11)]);
    expect(address()).toBe('/admin/finance?tab=accounts');
  });
});

describe('the business: pick, chip X (AC-109, M3-FR-1)', () => {
  it('a pick is one write: the account (lower case), the tab keys dropped; the name never in the URL or a request', async () => {
    await open('tab=accounts&sort=paid');
    const writes = replaceCalls().length;
    fireEvent.click(screen.getByTestId('picker-pick'));
    await settle();
    expect(replaceCalls().length).toBe(writes + 1);
    expect(address()).toBe(`/admin/finance?account=${A}`);
    expect(requests()).toEqual([REQ('preset=this_month&tab=accounts&sort=paid'), pinnedRequest(7)]);
    expect(screen.getByTestId('business-filter-chip')).toHaveTextContent(`Business: ${mockPickName}`);
    for (const url of [...requests(), ...replaceCalls().map((call) => String(call[2]))]) expect(url).not.toContain('Acme');
  });

  it('the chip X "Remove business" goes back to all businesses', async () => {
    await open(`account=${A}&range=30d`);
    fireEvent.click(screen.getByRole('button', { name: 'Remove business' }));
    await settle();
    expect(address()).toBe('/admin/finance?range=30d');
    expect(requests()).toEqual([REQ(`preset=30d&accountId=${A}`), pinnedRequest(4)]);
  });
});

describe('Refresh and Read at, in the bar (DV-1 ended)', () => {
  it('Refresh re-sends the same request and does not touch the address bar', async () => {
    await open(`range=7d&account=${A}`);
    const writes = replaceCalls().length;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh the finance page' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await settle();
    expect(requests()).toEqual([pinnedRequest(8), pinnedRequest(8)]);
    expect(replaceCalls().length).toBe(writes);
    expect(within(screen.getByRole('search', { name: 'Filters' })).getByRole('button', { name: 'Refresh the finance page' })).toBeInTheDocument();
  });
});


// ── DF-6 (§11L.5, AC-264, AC-265): since it started. A NEW state beside the AC-173 table (SA-Q96) ──
describe('DF-6: since it started (one business)', () => {
  const SINCE = REQ(`preset=since_start&accountId=${A}`);

  it('AC-264: range=since_start with a business loads the choice and sends exactly its request', async () => {
    await open(`range=since_start&account=${A}`);
    expect(requests()).toEqual([SINCE]);
    expect(address()).toBe(`/admin/finance?range=since_start&account=${A}`);
    expect(screen.getByRole('button', { name: 'Since it started' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('AC-264: the legacy preset=since_start&accountId reaches the same state and request', async () => {
    await open(`preset=since_start&accountId=${A}`);
    expect(requests()).toEqual([SINCE]);
    expect(address()).toBe(`/admin/finance?range=since_start&account=${A}`);
  });

  it.each([
    ['no business', 'range=since_start'],
    ['a bad business', 'range=since_start&account=acme'],
  ])('AC-264 / SA-W-DF6-4: %s → This month, all businesses, exactly ONE request (preset=this_month)', async (_name, link) => {
    await open(link);
    await settle();
    expect(requests()).toEqual([pinnedRequest(1)]);
    expect(address()).toBe('/admin/finance');
    expect(screen.queryByTestId('finance-url-notice')).toBeNull();
  });

  it('AC-264: dates beside it are ignored; the choice and the business are kept', async () => {
    await open(`range=since_start&from=2026-10-01&to=2026-10-02&account=${A}`);
    expect(requests()).toEqual([SINCE]);
    expect(address()).toBe(`/admin/finance?range=since_start&account=${A}`);
  });

  it('AC-264: with tab=accounts and a business, the tab is dropped and the window kept', async () => {
    await open(`range=since_start&tab=accounts&account=${A}`);
    expect(requests()).toEqual([SINCE]);
    expect(address()).toBe(`/admin/finance?range=since_start&account=${A}`);
  });

  it('AC-265: offered only with a business picked', async () => {
    const view = await open('');
    expect(screen.queryByRole('button', { name: 'Since it started' })).toBeNull();
    view.unmount();
    await open(`account=${A}`);
    expect(screen.getByRole('button', { name: 'Since it started' })).toBeInTheDocument();
  });

  it('AC-265: choosing it sends its request; removing the business switches to This month in ONE write', async () => {
    await open(`account=${A}`);
    fireEvent.click(screen.getByRole('button', { name: 'Since it started' }));
    await settle();
    expect(address()).toBe(`/admin/finance?range=since_start&account=${A}`);
    expect(requests()).toEqual([pinnedRequest(7), SINCE]);
    const writes = replaceCalls().length;
    fireEvent.click(screen.getByRole('button', { name: 'Remove business' }));
    await settle();
    expect(replaceCalls().length).toBe(writes + 1);
    expect(address()).toBe('/admin/finance');
    expect(requests()).toEqual([pinnedRequest(7), SINCE, pinnedRequest(1)]);
  });

  it('AC-265: Clear resets it to This month and all businesses', async () => {
    await open(`range=since_start&account=${A}`);
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await settle();
    expect(address()).toBe('/admin/finance');
    expect(requests()).toEqual([SINCE, pinnedRequest(1)]);
  });
});
