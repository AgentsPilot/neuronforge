/**
 * @jest-environment jsdom
 *
 * Admin Layout Standard L-10: the Business OS AI Settings tab on the standard
 * (workplan §6.3, S-1 to S-12). The characterisation suite for the tab's
 * content is `page.render.test.tsx`, which runs unedited; this file pins what
 * L-10 adds or moves: the header without actions, the Refresh-only bar, the
 * neutral KPI strip, the shared states, the read through `readAdminResponse`,
 * `StatusChip`, T-5 and the shared UTC times.
 *
 * Only `fetch` is mocked. The request must stay byte-identical: one argument,
 * the settings URL, no init (so a `GET` with no body).
 */

import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { ADMIN_NETWORK_ERROR } from '@/app/admin/components/layout/readAdminResponse';
import { area, call, issue, seedDerivedAreas, seedExcludedCalls } from '@/tests/helpers/bos-llm-admin-fixtures';

import BusinessOsLlmSettingsPage from '../page';
import { CALL_OFF_TITLE, SETTINGS_EMPTY } from '../copy';
import type { AreaView } from '../types';

const SETTINGS_URL = '/api/admin/business-os/llm-settings';
const GENERATED_AT = '2026-09-23T09:00:00.000Z';

interface Answer {
  status: number;
  /** A function body that throws stands for a non-JSON page (a proxy 502). */
  body: unknown | (() => never);
}

const ok = (areas: AreaView[]): Answer => ({ status: 200, body: { success: true, data: { areas, generatedAt: GENERATED_AT } } });

function respond(answer: Answer): Response {
  return {
    ok: answer.status >= 200 && answer.status < 300,
    status: answer.status,
    json: async () => (typeof answer.body === 'function' ? (answer.body as () => never)() : answer.body),
  } as Response;
}

/** The two other tabs' reads, by path prefix (S-1 opens both tabs). */
const OTHER_TAB_PREFIXES = ['/api/admin/business-os/credits/report', '/api/admin/business-os/ai-activity'];

/**
 * Every URL the stub was asked for that is neither the settings read nor one of
 * the two other tabs' reads (a ledger read included). Asserted empty after
 * every case: a throw inside the stub would be swallowed by the page's catch.
 */
let unexpectedUrls: string[] = [];

/**
 * Answers the settings read from `next`. The Costs and Activity reads never
 * answer, so they cause no update after the test; any other URL is recorded
 * as unexpected and fails the case.
 */
function stub(next: () => Answer | 'reject' | Promise<Answer>): jest.Mock {
  const mock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url !== SETTINGS_URL) {
      if (!OTHER_TAB_PREFIXES.some((prefix) => url.startsWith(prefix))) unexpectedUrls.push(url);
      return new Promise<Response>(() => {});
    }
    expect(init).toBeUndefined();
    const answer = await next();
    if (answer === 'reject') throw new TypeError('Failed to fetch');
    return respond(answer);
  });
  global.fetch = mock as unknown as typeof fetch;
  return mock;
}

let consoleError: jest.SpyInstance;
let consoleWarn: jest.SpyInstance;

beforeEach(() => {
  window.history.replaceState(null, '', '/admin/business-os-llm');
  unexpectedUrls = [];
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  // SA F-1: only the settings read and the two other tabs' reads, never a ledger read or anything else.
  expect(unexpectedUrls).toEqual([]);
  // The first words of each message and its first argument (React's component
  // name), so a failure says what complained and where.
  expect(consoleError.mock.calls.map((args) => `${String(args[0]).slice(0, 80)} ${String(args[1])}`)).toEqual([]);
  expect(consoleWarn.mock.calls.map((args) => String(args[0]).slice(0, 160))).toEqual([]);
  consoleError.mockRestore();
  consoleWarn.mockRestore();
});

const settingsPanel = () => document.getElementById('bos-llm-panel-settings') as HTMLElement;

async function openWith(areas: AreaView[]) {
  const fetchMock = stub(() => ok(areas));
  render(<BusinessOsLlmSettingsPage />);
  await screen.findByTestId(`area-card-${areas[0].area}`);
  return fetchMock;
}

function expand(areaName: string) {
  const card = screen.getByTestId(`area-card-${areaName}`);
  act(() => {
    fireEvent.click(within(card).getAllByRole('button')[0]);
  });
  return screen.getByTestId(`area-card-${areaName}`);
}

/** The planted fixture of S-9: one area off, one with two calls off, one with row issues, chat with excluded calls, one without `excludedCalls`. */
function planted(): AreaView[] {
  const noExcluded = area({ area: 'website', key: 'bos_llm_area_website' });
  delete (noExcluded as Partial<AreaView>).excludedCalls;
  return [
    area({ area: 'insights' }),
    area({ area: 'scheduling', key: 'bos_llm_area_scheduling', configuredEnabled: false, calls: [call(), call({ callName: 'b' })] }),
    area({
      area: 'leads',
      key: 'bos_llm_area_leads',
      calls: [
        call({ callName: 'a', resolved: { enabled: false, provider: 'openai', model: 'gpt-4o-mini', temperature: 0.2 } }),
        call({ callName: 'b', resolved: { enabled: false, provider: 'openai', model: 'gpt-4o-mini', temperature: 0.2 } }),
        call({ callName: 'c' }),
      ],
    }),
    area({
      area: 'crm',
      key: 'bos_llm_area_crm',
      areaIssues: [issue({ area: 'crm', level: 'row', field: 'row' }), issue({ area: 'crm', level: 'row', field: 'calls' })],
    }),
    area({ area: 'chat', key: 'bos_llm_area_chat', excludedCalls: seedExcludedCalls() }),
    noExcluded,
  ];
}

describe('S-1 / S-2: the header has no actions; Refresh lives in the Settings bar', () => {
  it('one h1, the badge, no button in the header on any tab; the bar on Settings only', async () => {
    stub(() => ok([area()]));
    render(<BusinessOsLlmSettingsPage />);
    await screen.findByTestId('area-card-insights');

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const header = document.querySelector('header') as HTMLElement;
    expect(within(header).getByText('Read-only')).toBeInTheDocument();
    expect(within(header).queryAllByRole('button')).toHaveLength(0);

    const refresh = screen.getByRole('button', { name: 'Refresh the settings' });
    expect(refresh).toHaveTextContent('Refresh');
    expect(settingsPanel()).toContainElement(refresh);
    expect(screen.getByText('Read at 09:00 UTC')).toBeInTheDocument();
    expect(screen.queryByRole('search')).toBeNull();
    expect(screen.queryByText(/read at 2026/i)).toBeNull();

    for (const other of ['costs', 'activity']) {
      fireEvent.click(screen.getByTestId(`tab-${other}`));
      expect(within(header).queryAllByRole('button', { hidden: true })).toHaveLength(0);
      expect(screen.queryByRole('button', { name: 'Refresh the settings', hidden: true })).toBeNull();
      expect(screen.queryByText('Read at 09:00 UTC')).toBeNull();
    }
  });
});

describe('S-3 / S-4: the read and Refresh send the same single GET', () => {
  it('mounts with one call; Refresh re-sends it, keeps the cards and sets aria-busy', async () => {
    let release: (answer: Answer) => void = () => {};
    let count = 0;
    const fetchMock = stub(() => {
      count += 1;
      if (count === 1) return ok([area()]);
      return new Promise<Answer>((resolve) => {
        release = resolve;
      });
    });
    render(<BusinessOsLlmSettingsPage />);
    await screen.findByTestId('area-card-insights');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]).toEqual([SETTINGS_URL]);
    const content = screen.getByTestId('settings-content');
    expect(content).toHaveAttribute('aria-busy', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Refresh the settings' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]).toEqual([SETTINGS_URL]);
    expect(content).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Refresh the settings' })).toBeDisabled();
    expect(screen.getByTestId('area-card-insights')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();

    await act(async () => release(ok([area()])));
    await waitFor(() => expect(content).toHaveAttribute('aria-busy', 'false'));
    expect(fetchMock.mock.calls.every((args) => args.length === 1)).toBe(true);
  });

  it('no ledger request, and the tab switch back to Settings does not re-read', async () => {
    const fetchMock = await openWith([area()]);
    fireEvent.click(screen.getByTestId('tab-activity'));
    fireEvent.click(screen.getByTestId('tab-settings'));
    const settingsCalls = fetchMock.mock.calls.filter((args) => String(args[0]) === SETTINGS_URL);
    expect(settingsCalls).toHaveLength(1);
  });
});

describe('S-5 to S-8: the shared states', () => {
  it('S-5: loading keeps the header and tabs, shows the shared words and four placeholders', async () => {
    stub(() => new Promise<Answer>(() => {}));
    render(<BusinessOsLlmSettingsPage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Business OS AI');
    expect(screen.getByTestId('tab-settings')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Reading the settings…');
    expect(screen.getAllByTestId('kpi-placeholder')).toHaveLength(4);
    expect(screen.queryByText(/^Read at/)).toBeNull();
  });

  it.each([
    ['the route sentence on a 500', { status: 500, body: { success: false, error: 'Could not read the Business OS AI settings' } }, 'Could not read the Business OS AI settings'],
    ['the fixed fallback for a non-JSON page', { status: 502, body: () => { throw new SyntaxError("Unexpected token '<'"); } }, 'Could not read the settings. Try again in a moment.'],
    ['the fixed fallback for a 200 without success', { status: 200, body: { data: {} } }, 'Could not read the settings. Try again in a moment.'],
    ['the session sentence on a 403', { status: 403, body: { success: false, error: 'Forbidden' } }, 'Your admin session has ended. Sign in again.'],
    ['the session sentence on a 401', { status: 401, body: { success: false, error: 'Unauthorized' } }, 'Your admin session has ended. Sign in again.'],
  ] as const)('S-6: %s', async (_label, answer, words) => {
    stub(() => answer as Answer);
    render(<BusinessOsLlmSettingsPage />);
    const message = await screen.findByTestId('page-error');
    expect(message).toHaveTextContent(words);
    expect(message.textContent).toBe(words);
    expect(screen.getByRole('alert')).toContainElement(message);
    expect(document.body.textContent).not.toMatch(/Unexpected token|SyntaxError/);
    expect(screen.queryByTestId('kpi-placeholder')).toBeNull();
  });

  it('S-6: a rejected fetch says the shared network words; Try again re-reads and recovers', async () => {
    let first = true;
    const fetchMock = stub(() => {
      if (first) {
        first = false;
        return 'reject';
      }
      return ok([area()]);
    });
    render(<BusinessOsLlmSettingsPage />);
    expect(await screen.findByTestId('page-error')).toHaveTextContent(ADMIN_NETWORK_ERROR);
    expect(document.body.textContent).not.toContain('Failed to fetch');

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByTestId('area-card-insights');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('page-error')).toBeNull();
  });

  it('S-7: a failed refresh keeps the cards, shows the error and hides the strip', async () => {
    let count = 0;
    stub(() => {
      count += 1;
      return count === 1 ? ok([area()]) : { status: 500, body: { success: false, error: 'Could not read the Business OS AI settings' } };
    });
    render(<BusinessOsLlmSettingsPage />);
    await screen.findByTestId('area-card-insights');
    expect(screen.getByTestId('settings-kpi-areas')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh the settings' }));
    expect(await screen.findByTestId('page-error')).toHaveTextContent('Could not read the Business OS AI settings');
    expect(screen.getByTestId('area-card-insights')).toBeInTheDocument();
    expect(screen.queryByTestId('settings-kpi-areas')).toBeNull();
    // Read at keeps the last good read (§5.5, SA N-1).
    expect(screen.getByText('Read at 09:00 UTC')).toBeInTheDocument();
  });

  it('S-8: zero areas shows the empty sentence, no Clear filters, and a strip of zeros with no links', async () => {
    stub(() => ok([]));
    render(<BusinessOsLlmSettingsPage />);
    const empty = await screen.findByTestId('settings-empty');
    expect(empty).toHaveTextContent(SETTINGS_EMPTY);
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
    for (const id of ['areas', 'calls', 'calls-off', 'row-issues']) {
      const tile = screen.getByTestId(`settings-kpi-${id}`);
      expect(tile.tagName).not.toBe('A');
      expect(tile).toHaveTextContent('0');
    }
  });
});

describe('S-9: the KPI strip counts with the cards’ own rules, all neutral', () => {
  it('on the seed fixture: values, no colour, no links where nothing is off', async () => {
    const areas = seedDerivedAreas();
    await openWith(areas);
    const calls = areas.reduce((sum, a) => sum + a.calls.length + (a.excludedCalls ?? []).length, 0);
    expect(screen.getByTestId('settings-kpi-areas')).toHaveAccessibleName(`Areas, ${areas.length}`);
    expect(screen.getByTestId('settings-kpi-calls')).toHaveAccessibleName(`Calls, ${calls}`);
    for (const id of ['areas', 'calls', 'calls-off', 'row-issues']) {
      expect(screen.getByTestId(`settings-kpi-${id}`)).toHaveAttribute('data-status', 'neutral');
    }
    expect(screen.getByTestId('settings-kpi-areas').tagName).toBe('DIV');
    expect(screen.getByTestId('settings-kpi-calls').tagName).toBe('DIV');
  });

  it('on a planted fixture: off calls, the singular area sub-line, row issues, anchors to existing cards', async () => {
    const areas = planted();
    await openWith(areas);

    expect(screen.getByTestId('settings-kpi-areas')).toHaveAccessibleName('Areas, 6');
    // insights 1 + scheduling 2 + leads 3 + crm 1 + chat 1 + 4 excluded + website 1 (no excludedCalls key).
    expect(screen.getByTestId('settings-kpi-calls')).toHaveAccessibleName('Calls, 13');

    const off = screen.getByTestId('settings-kpi-calls-off');
    expect(off).toHaveAccessibleName('Calls configured off, 2');
    expect(off).toHaveTextContent('plus 1 area configured off');
    expect(off.tagName).toBe('A');
    expect(off).toHaveAttribute('href', '#bos-llm-area-scheduling');

    const issues = screen.getByTestId('settings-kpi-row-issues');
    expect(issues).toHaveAccessibleName('Row issues, 2');
    expect(issues).toHaveAttribute('href', '#bos-llm-area-crm');

    for (const tile of [off, issues]) {
      expect(tile).toHaveAttribute('data-status', 'neutral');
      const target = (tile.getAttribute('href') as string).slice(1);
      expect(document.getElementById(target)).toBe(screen.getByTestId(`area-card-${target.replace('bos-llm-area-', '')}`));
    }
    // No tile names an area (page.render looks areas up by their text).
    expect(within(screen.getByTestId('settings-kpi-calls-off').parentElement as HTMLElement).queryByText(/scheduling|crm/)).toBeNull();
  });

  it('two areas off read "areas"', async () => {
    await openWith([
      area({ area: 'insights', configuredEnabled: false }),
      area({ area: 'leads', key: 'bos_llm_area_leads', configuredEnabled: false }),
    ]);
    expect(screen.getByTestId('settings-kpi-calls-off')).toHaveTextContent('plus 2 areas configured off');
    expect(screen.getByTestId('settings-kpi-calls-off')).toHaveAccessibleName('Calls configured off, 0');
  });
});

describe('S-10: chips are the shared StatusChip, words, test ids and titles kept', () => {
  it('tones, icons and hover text', async () => {
    await openWith([
      area({ area: 'insights', configuredEnabled: false, areaIssues: [issue({ level: 'row', field: 'row' })] }),
      area({
        area: 'leads',
        key: 'bos_llm_area_leads',
        calls: [
          call({
            callName: 'a',
            provenance: { enabled: 'default', provider: 'default', model: 'call', temperature: 'default' },
            resolved: { enabled: false, provider: 'openai', model: 'gpt-4o-mini', temperature: 0.2 },
          }),
          call({ callName: 'b' }),
        ],
      }),
    ]);

    const insights = screen.getByTestId('area-card-insights');
    const state = within(insights).getByTestId('state-chip');
    expect(state).toHaveAttribute('data-tone', 'warn');
    expect(state.textContent).toBe('Configured: off');
    expect(state.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    const issueChip = within(insights).getByTestId('area-issue-chip');
    expect(issueChip).toHaveAttribute('data-tone', 'warn');
    expect(issueChip.textContent).toBe('1 row issue');
    const count = within(insights).getByTestId('call-count-chip');
    expect(count).toHaveAttribute('data-tone', 'neutral');
    expect(count.textContent).toBe('1 call');

    const leads = screen.getByTestId('area-card-leads');
    expect(within(leads).getByTestId('calls-off-chip').textContent).toBe('1 call configured off');
    expect(within(leads).getByTestId('calls-off-chip')).toHaveAttribute('data-tone', 'warn');
    const perCall = within(leads).getByTestId('set-per-call-chip');
    expect(perCall.getAttribute('title')).toBeTruthy();
    expect(perCall.textContent).toBe('1 set per call');
    expect(perCall.querySelector('[data-tone="info"]')).not.toBeNull();

    const card = expand('leads');
    const callChip = within(card).getByTestId('call-state-chip');
    expect(callChip.getAttribute('title')).toBe(CALL_OFF_TITLE);
    expect(callChip.textContent).toBe('Configured: off');
    expect(callChip.querySelector('[data-tone="warn"] svg[aria-hidden="true"]')).not.toBeNull();
    // T-7: no purple chip left on the cards.
    expect(settingsPanel().querySelector('[class*="bg-purple-500/15"]')).toBeNull();
  });
});

describe('S-11 / S-12: T-5 and the shared UTC times', () => {
  it('S-11: no slate-500 or slate-600 text anywhere in the Settings panel, cards expanded', async () => {
    const areas = [
      ...planted(),
      area({ area: 'onboarding', key: 'bos_llm_area_onboarding', rowPresent: false, storedRow: null, updatedAt: null, lastChangedBy: { kind: 'no_row' } }),
    ];
    await openWith(areas);
    for (const a of areas) {
      const card = expand(a.area);
      const toggle = within(card).queryByRole('button', { name: /stored row/i });
      if (toggle) fireEvent.click(toggle);
      expect(settingsPanel().querySelector('[class*="text-slate-500"], [class*="text-slate-600"]')).toBeNull();
      expand(a.area);
    }
    expect(screen.getByTestId('page-standing-note').className).toContain('text-slate-400');
  });

  it('S-12: an offset instant prints in UTC; a missing one says so; never 1970', async () => {
    await openWith([
      area({
        updatedAt: '2026-09-21T12:14:08+02:00',
        lastChangedBy: { kind: 'not_recorded', at: '2026-09-21T12:14:08+02:00' },
      }),
      area({
        area: 'leads',
        key: 'bos_llm_area_leads',
        updatedAt: null,
        lastChangedBy: { kind: 'admin', at: null, email: 'ops@example.com' },
      }),
    ]);
    const insights = screen.getByTestId('area-card-insights');
    expect(within(insights).getByTestId('last-changed')).toHaveTextContent('at 2026-09-21 10:14 UTC');

    const card = expand('insights');
    fireEvent.click(within(card).getByRole('button', { name: /stored row/i }));
    expect(within(card).getByText('Written at 2026-09-21 10:14 UTC')).toBeInTheDocument();
    expand('insights');

    const leads = expand('leads');
    expect(within(leads).getAllByTestId('last-changed')[0]).toHaveTextContent('(time not recorded)');
    fireEvent.click(within(leads).getByRole('button', { name: /stored row/i }));
    expect(within(leads).getByText('No write timestamp recorded')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/1970|Invalid Date/);
  });
});
