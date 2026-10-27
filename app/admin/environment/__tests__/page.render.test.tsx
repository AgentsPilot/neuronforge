/**
 * @jest-environment jsdom
 *
 * The read-only Environment admin page (admin environment view EC-2; workplan
 * §2.7, P2-1 to P2-14; SA E2-1, E2-2). P2-1 to P2-5 are the guardrails listed
 * for EC-2 in requirement §7.
 *
 * Every payload here is hand-written with fake names and values. No test calls
 * the real route.
 */

import '@testing-library/jest-dom';
import { StrictMode } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('@/lib/logger/client', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { clientLogger: logger };
});

// EC-4: the filters read the page URL through useSearchParams (as the Businesses page tests do).
let mockSearch = '';
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

import AdminEnvironmentPage from '../page';
import type { EnvironmentLabel, EnvironmentViewPayload, EnvRow } from '@/lib/admin/environment-types';

const OPT = { production: 'optional', preview: 'optional', local: 'optional' } as const;

function row(name: string, display: EnvRow['display'], extra: Partial<EnvRow> = {}): EnvRow {
  return {
    name,
    group: 'features',
    role: `Role of ${name}.`,
    sensitivity: 'config',
    scope: 'server',
    expectedIn: OPT,
    display,
    diagnostics: [],
    ...extra,
  };
}

const CHECKED: Record<EnvironmentLabel, 'production' | 'preview' | 'local' | null> = {
  production: 'production',
  preview: 'preview',
  local: 'local',
  'vercel-development': 'local',
  unknown: null,
};

function payload(overrides: Partial<EnvironmentViewPayload> = {}, label: EnvironmentLabel = 'preview'): EnvironmentViewPayload {
  const checked = CHECKED[label];
  return {
    environment: {
      label,
      checkedAgainst: checked,
      facts: { host: 'deploy-x.example.test', region: 'abc1', branch: 'feature/x', commit: null },
    },
    groups: [
      {
        id: 'plugins',
        label: 'Plugins & OAuth',
        description: 'Plugin settings.',
        rows: [
          row('FAKE_SECRET_SET', { kind: 'status', set: true }, { sensitivity: 'secret' }),
          row('FAKE_SECRET_UNSET', { kind: 'status', set: false }, { sensitivity: 'secret' }),
        ],
      },
      {
        id: 'external',
        label: 'Other external services',
        description: 'Outside services.',
        rows: [row('FAKE_SHOWN', { kind: 'shown', text: 'https://example.test' }, { scope: 'browser-inlined' })],
      },
      {
        id: 'payments',
        label: 'Payments (Stripe)',
        description: 'Payment settings.',
        rows: [
          row('FAKE_FLAG_SET', { kind: 'flag', state: 'on', source: 'set' }, { sensitivity: 'flag' }),
          row('FAKE_FLAG_DEFAULT', { kind: 'flag', state: 'off', source: 'default' }, { sensitivity: 'flag' }),
          row('FAKE_FLAG_ODD', { kind: 'flag', state: 'on', source: 'unrecognised' }, { sensitivity: 'flag' }),
        ],
      },
      {
        id: 'admin',
        label: 'Admin & sign-in',
        description: 'Admin settings.',
        rows: [
          row('FAKE_ADMIN_LIST', { kind: 'count', entries: 3 }, { sensitivity: 'personal', seeAlsoPath: '/admin/settings' }),
          row('FAKE_ONE_LIST', { kind: 'count', entries: 1 }, { sensitivity: 'personal' }),
          row('FAKE_ODD_LINK', { kind: 'count', entries: 2 }, { sensitivity: 'personal', seeAlsoPath: '/admin/elsewhere' }),
          row('FAKE_HIDDEN', { kind: 'hidden', reason: 'not-plain-config' }),
          row('FAKE_BROKEN', { kind: 'hidden', reason: 'classification-error' }),
        ],
      },
    ],
    uncategorised: [],
    counts: {
      rows: 13,
      set: 9,
      notSet: 4,
      uncategorised: 0,
      platformHidden: 12,
      requiredNotSet: checked === null ? null : 0,
      shouldNotBeSet: checked === null ? null : 0,
      unrecognisedFlags: 0,
      surroundingWhitespace: 0,
      supabaseUrlMismatch: 0,
    },
    generatedAt: '2026-01-02T03:04:05.000Z',
    ...overrides,
  };
}

type FakeResponse = { ok: boolean; status: number; json: () => Promise<unknown> };
const answer = (status: number, body: unknown): FakeResponse => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const okAnswer = (data: EnvironmentViewPayload = payload()) => answer(200, { success: true, data });

const REQUEST = ['/api/admin/environment', { method: 'GET', cache: 'no-store' }];

function stubFetch(...answers: FakeResponse[]) {
  const fetchMock = jest.fn(async () => {
    const next = answers.shift();
    if (!next) throw new Error('no answer left');
    return next;
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function heldFetch() {
  const pending: Array<(value: FakeResponse) => void> = [];
  const fetchMock = jest.fn(() => new Promise<FakeResponse>((resolve) => pending.push(resolve)));
  global.fetch = fetchMock as unknown as typeof fetch;
  return { fetchMock, pending };
}

const valueCell = (name: string) => {
  const tr = document.querySelector(`tr[data-name="${name}"]`);
  if (!tr) throw new Error(`no row ${name}`);
  return within(tr.querySelector('[data-testid="env-value"]') as HTMLElement);
};
const valueText = (name: string) =>
  (document.querySelector(`tr[data-name="${name}"] [data-testid="env-value"]`)?.textContent ?? '').trim();

async function renderReady(data: EnvironmentViewPayload = payload()) {
  const fetchMock = stubFetch(okAnswer(data));
  render(<AdminEnvironmentPage />);
  await screen.findByTestId('environment-card');
  return fetchMock;
}

/**
 * P2-11, updated for EC-4 (P4-13): the only inputs are the name search and the
 * group select; the only buttons are Refresh, Clear (and the empty state's
 * Clear filters), and Try again. Nothing copies, reveals or downloads.
 */
function expectReadOnly() {
  expect(document.querySelectorAll('textarea, form, [role="dialog"]')).toHaveLength(0);
  const inputs = [...document.querySelectorAll('input')];
  expect(inputs.map((i) => i.getAttribute('type'))).toEqual(['search']);
  expect(document.querySelectorAll('select')).toHaveLength(1);
  for (const button of screen.queryAllByRole('button')) {
    const name = button.getAttribute('aria-label') ?? button.textContent ?? '';
    expect(name.startsWith('Refresh') || ['Try again', 'Clear', 'Clear filters'].includes(name)).toBe(true);
    expect(name).not.toMatch(/copy|reveal|show value|download/i);
  }
}

beforeEach(() => {
  mockSearch = '';
  window.history.replaceState(null, '', '/admin/environment');
});

describe('Environment page', () => {
  it('P2-1 header: one h1, the purpose, the Read-only badge, Refresh with Read at in the bar', async () => {
    await renderReady();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Environment');
    expect(screen.getByText(/every setting the app reads, with secrets shown only as Set or Not set/)).toBeInTheDocument();
    expect(screen.getByTestId('read-only-badge')).toHaveTextContent('Read-only');
    expect(within(screen.getByRole('banner')).queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Refresh the environment settings' })).toBeInTheDocument();
    expect(screen.getByText(/Read at .*UTC/)).toBeInTheDocument();
  });

  it.each([
    ['production', 'Production', 'info'],
    ['preview', 'Preview', 'info'],
    ['vercel-development', 'Vercel development', 'info'],
    ['local', 'Local (merged .env files)', 'info'],
    ['unknown', 'Unknown environment', 'warn'],
  ] as const)('P2-2 the %s chip reads "%s" with tone %s', async (label, words, tone) => {
    await renderReady(payload({}, label));
    const chip = screen.getByTestId('environment-chip');
    expect(chip).toHaveTextContent(words);
    expect(chip).toHaveAttribute('data-tone', tone);
    if (label === 'local') expect(screen.getByTestId('local-note')).toBeInTheDocument();
    else expect(screen.queryByTestId('local-note')).not.toBeInTheDocument();
  });

  it('P2-3 masked rows read Set / Not set and nothing else; a classification error has no Set chip (E2-1)', async () => {
    await renderReady();
    expect(valueText('FAKE_SECRET_SET')).toBe('Set');
    expect(valueText('FAKE_SECRET_UNSET')).toBe('Not set');
    expect(valueText('FAKE_HIDDEN')).toBe('SetHidden: does not look like plain configuration');
    expect(valueText('FAKE_BROKEN')).toBe('Hidden: could not be checked');
    expect(valueCell('FAKE_BROKEN').queryByText('Set')).not.toBeInTheDocument();
  });

  it('P2-4 Uncategorised is always shown: "None" when empty, rows when present', async () => {
    await renderReady();
    expect(within(screen.getByTestId('uncategorised-card')).getByText('None')).toBeInTheDocument();
  });

  it('P2-4b Uncategorised lists its rows with Set / Not set', async () => {
    await renderReady(
      payload({
        uncategorised: [
          row('FAKE_UNKNOWN_A', { kind: 'status', set: true }, { group: 'uncategorised', sensitivity: 'secret', expectedIn: null }),
          row('FAKE_UNKNOWN_B', { kind: 'status', set: false }, { group: 'uncategorised', sensitivity: 'secret', expectedIn: null }),
        ],
      })
    );
    const card = within(screen.getByTestId('uncategorised-card'));
    expect(card.getByText('FAKE_UNKNOWN_A')).toBeInTheDocument();
    expect(valueText('FAKE_UNKNOWN_A')).toBe('Set');
    expect(valueText('FAKE_UNKNOWN_B')).toBe('Not set');
    expect(card.queryByText('None')).not.toBeInTheDocument();
  });

  it('P2-5 a failed refresh clears every card and Read at; Try again recovers', async () => {
    const user = userEvent.setup();
    stubFetch(okAnswer(), answer(500, { success: false, error: 'The environment view could not be built.' }), okAnswer());
    render(<AdminEnvironmentPage />);
    await screen.findByTestId('environment-card');

    await user.click(screen.getByRole('button', { name: 'Refresh the environment settings' }));
    await screen.findByTestId('environment-error');
    expect(screen.getByTestId('environment-error')).toHaveTextContent('The environment view could not be built.');
    expect(screen.queryByTestId('environment-card')).not.toBeInTheDocument();
    expect(screen.queryAllByTestId('group-card')).toHaveLength(0);
    expect(screen.queryByTestId('uncategorised-card')).not.toBeInTheDocument();
    expect(screen.queryByTestId('platform-hidden-line')).not.toBeInTheDocument();
    expect(screen.queryByText(/Read at/)).not.toBeInTheDocument();
    expectReadOnly();

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByTestId('environment-card');
    expect(screen.queryByTestId('environment-error')).not.toBeInTheDocument();
  });

  it('P2-6 one card per group in payload order, external included, with named headers', async () => {
    await renderReady();
    const cards = screen.getAllByTestId('group-card');
    expect(cards.map((c) => c.getAttribute('data-group'))).toEqual(['plugins', 'external', 'payments', 'admin']);
    expect(within(cards[1]).getByRole('heading', { level: 2 })).toHaveTextContent('Other external services');
    expect(within(cards[1]).getByText('Outside services.')).toBeInTheDocument();
    for (const card of cards) {
      expect(within(card).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Name', 'Value', 'Role', 'Scope']);
    }
  });

  it('P2-7 the platform count line', async () => {
    await renderReady();
    expect(screen.getByTestId('platform-hidden-line')).toHaveTextContent(
      '12 settings set by the hosting platform or operating system are not shown.'
    );
  });

  it('P2-8 the standing notes, the facts, and the scope words', async () => {
    await renderReady();
    const notes = screen.getByTestId('environment-notes');
    expect(notes).toHaveTextContent('A change made in Vercel appears here after the next deploy.');
    expect(notes).toHaveTextContent('Settings whose name starts with NEXT_PUBLIC_ are built into the browser code');
    const card = within(screen.getByTestId('environment-card'));
    expect(card.getByText('deploy-x.example.test')).toBeInTheDocument();
    expect(card.getByText('Not provided')).toBeInTheDocument();
    const shownRow = document.querySelector('tr[data-name="FAKE_SHOWN"]') as HTMLElement;
    expect(within(shownRow).getByText('Built into the browser bundle')).toBeInTheDocument();
    const serverRow = document.querySelector('tr[data-name="FAKE_SECRET_SET"]') as HTMLElement;
    expect(within(serverRow).getByText('Server')).toBeInTheDocument();
    expect(valueText('FAKE_SHOWN')).toBe('https://example.test');
  });

  it('P2-9 flags: On / Off, (default), and the unrecognised words follow the state', async () => {
    await renderReady();
    expect(valueText('FAKE_FLAG_SET')).toBe('On');
    expect(valueText('FAKE_FLAG_DEFAULT')).toBe('Off(default)');
    expect(valueText('FAKE_FLAG_ODD')).toBe('OnSet, not a recognised value: reads as On');
  });

  it('P2-10 personal: counts, and a link only for an allow-listed path (E2-2)', async () => {
    await renderReady();
    expect(valueText('FAKE_ADMIN_LIST')).toBe('3 entriesSee Admin users');
    expect(valueCell('FAKE_ADMIN_LIST').getByRole('link', { name: 'See Admin users' })).toHaveAttribute('href', '/admin/settings');
    expect(valueText('FAKE_ONE_LIST')).toBe('1 entry');
    expect(valueCell('FAKE_ONE_LIST').queryByRole('link')).not.toBeInTheDocument();
    expect(valueText('FAKE_ODD_LINK')).toBe('2 entries');
    expect(valueCell('FAKE_ODD_LINK').queryByRole('link')).not.toBeInTheDocument();
  });

  it('P2-11 read-only in loading, ready and error states', async () => {
    const { pending } = heldFetch();
    render(<AdminEnvironmentPage />);
    expect(screen.getByText(/Reading the environment settings/)).toBeInTheDocument();
    expectReadOnly();
    await act(async () => pending.shift()?.(okAnswer()));
    await screen.findByTestId('environment-card');
    expectReadOnly();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Refresh the environment settings' }));
    await act(async () => pending.shift()?.(answer(500, {})));
    await screen.findByTestId('environment-error');
    expectReadOnly();
  });

  it('P2-12 every request is the one GET, no query string, no-store', async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch(okAnswer(), answer(500, {}), okAnswer());
    render(<AdminEnvironmentPage />);
    await screen.findByTestId('environment-card');
    await user.click(screen.getByRole('button', { name: 'Refresh the environment settings' }));
    await screen.findByTestId('environment-error');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByTestId('environment-card');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const call of fetchMock.mock.calls) expect(call).toEqual(REQUEST);
  });

  it.each([
    ['a malformed 200', answer(200, { success: true, data: { groups: 'nope' } }), 'Could not read the environment settings. Try again in a moment.'],
    ['a non-JSON body', { ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token'); } }, 'Could not read the environment settings. Try again in a moment.'],
    ['a 401', answer(401, { success: false, error: 'Unauthorized' }), 'Your admin session has ended. Sign in again.'],
  ] as const)('P2-13 %s shows the fixed words', async (_case, response, words) => {
    stubFetch(response as FakeResponse);
    render(<AdminEnvironmentPage />);
    expect(await screen.findByTestId('environment-error')).toHaveTextContent(words);
    expect(screen.queryByTestId('environment-card')).not.toBeInTheDocument();
  });

  describe('QA §6.2: a malformed row or fact shows the fallback state, not a crash', () => {
    const base = payload();
    const firstGroup = base.groups[0];
    const withFirstRow = (bad: unknown) => ({
      ...base,
      groups: [{ ...firstGroup, rows: [{ ...firstGroup.rows[0], ...(bad as object) }] }, ...base.groups.slice(1)],
    });
    it.each([
      ['rows not an array', { ...base, groups: [{ ...firstGroup, rows: { not: 'an array' } }] }],
      ['display null', withFirstRow({ display: null })],
      ['shown.text an object', withFirstRow({ display: { kind: 'shown', text: { nested: 'FAKE-object' } } })],
      ['a fact that is an object', { ...base, environment: { ...base.environment, facts: { ...base.environment.facts, host: { nested: 'FAKE-object' } } } }],
    ])('%s', async (_case, data) => {
      stubFetch(answer(200, { success: true, data }));
      render(<AdminEnvironmentPage />);
      expect(await screen.findByTestId('environment-error')).toHaveTextContent(
        'Could not read the environment settings. Try again in a moment.'
      );
      expect(screen.queryByTestId('environment-card')).not.toBeInTheDocument();
      expect(screen.queryAllByTestId('group-card')).toHaveLength(0);
      expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
      expect(document.body.textContent).not.toContain('FAKE-object');
    });
  });

  it('QA §6.2: long names and values carry the wrapping classes', async () => {
    await renderReady();
    const nameCell = document.querySelector('tr[data-name="FAKE_SHOWN"] [data-testid="env-name"]') as HTMLElement;
    expect(nameCell.className).toMatch(/\bbreak-all\b/);
    const shownText = within(document.querySelector('tr[data-name="FAKE_SHOWN"]') as HTMLElement).getByText('https://example.test');
    expect(shownText.className).toMatch(/\bbreak-all\b/);
    const valueCellEl = document.querySelector('tr[data-name="FAKE_SHOWN"] [data-testid="env-value"]') as HTMLElement;
    expect(valueCellEl.className).toMatch(/\bbreak-words\b/);
  });

  describe('EC-4: diagnostics, KPI strip and filters (workplan §4.7 P4-1 to P4-16)', () => {
    function diagPayload(label: EnvironmentLabel = 'production'): EnvironmentViewPayload {
      const base = payload({}, label);
      const checked = CHECKED[label];
      return {
        ...base,
        groups: [
          {
            id: 'payments',
            label: 'Payments (Stripe)',
            description: 'Payment settings.',
            rows: [
              row('FAKE_REQUIRED', { kind: 'status', set: false }, { sensitivity: 'secret', diagnostics: checked ? ['required-not-set'] : [] }),
              row('FAKE_FORBIDDEN', { kind: 'status', set: true }, { sensitivity: 'secret', diagnostics: checked ? ['should-not-be-set'] : [] }),
              row('FAKE_ODD_FLAG', { kind: 'flag', state: 'off', source: 'unrecognised' }, { sensitivity: 'flag', diagnostics: ['unrecognised-flag'] }),
            ],
          },
          {
            id: 'email',
            label: 'Email',
            description: 'Email settings.',
            rows: [row('FAKE_PADDED', { kind: 'status', set: true }, { sensitivity: 'secret', diagnostics: ['surrounding-whitespace'] })],
          },
        ],
        uncategorised: [row('FAKE_UNKNOWN_X', { kind: 'status', set: true }, { group: 'uncategorised', sensitivity: 'secret', expectedIn: null })],
        counts: {
          ...base.counts,
          rows: 5,
          set: 4,
          notSet: 1,
          uncategorised: 1,
          requiredNotSet: checked ? 1 : null,
          shouldNotBeSet: checked ? 1 : null,
          unrecognisedFlags: 1,
          surroundingWhitespace: 1,
        },
      };
    }
    const tile = (id: string) => screen.getByTestId(id);

    it('P4-1 / P4-2 five tiles with their words; amber only above 0; no green; K-7 names', async () => {
      await renderReady(diagPayload());
      const ids = ['kpi-set', 'kpi-required-not-set', 'kpi-should-not-be-set', 'kpi-values-to-check', 'kpi-uncategorised'];
      for (const id of ids) expect(tile(id)).toBeInTheDocument();
      expect(tile('kpi-set')).toHaveAttribute('data-status', 'neutral');
      expect(tile('kpi-required-not-set')).toHaveAttribute('data-status', 'amber');
      expect(tile('kpi-should-not-be-set')).toHaveAttribute('data-status', 'amber');
      expect(tile('kpi-values-to-check')).toHaveAttribute('data-status', 'amber');
      expect(tile('kpi-values-to-check')).toHaveTextContent('1 unrecognised switch value, 1 with spaces around');
      expect(tile('kpi-uncategorised')).toHaveAttribute('data-status', 'neutral');
      expect(document.querySelectorAll('[data-status="green"]')).toHaveLength(0);
      expect(tile('kpi-required-not-set')).toHaveAttribute('aria-label', 'Required, not set, 1, needs a look');
    });

    it('P4-2b a zero count is neutral, not green', async () => {
      await renderReady(payload({}, 'production'));
      expect(tile('kpi-required-not-set')).toHaveAttribute('data-status', 'neutral');
      expect(tile('kpi-required-not-set')).toHaveTextContent('0');
      expect(tile('kpi-required-not-set').tagName).not.toBe('A');
    });

    it('P4-3 an unknown environment: the two expectation tiles are not measured, and the card says checks are off', async () => {
      await renderReady(diagPayload('unknown'));
      for (const id of ['kpi-required-not-set', 'kpi-should-not-be-set']) {
        expect(tile(id)).toHaveAttribute('data-status', 'not_measured');
        expect(tile(id)).toHaveTextContent('Not checked: the environment is not recognised');
      }
      expect(screen.getByTestId('checked-note')).toHaveTextContent('Checks against the expected settings are off');
      // Value checks stay on (SA Q4-2).
      expect(tile('kpi-values-to-check')).toHaveAttribute('data-status', 'amber');
    });

    it('P4-4 tiles anchor to the first visible matching row and to the Uncategorised card; Set has no target', async () => {
      await renderReady(diagPayload());
      expect(tile('kpi-set').tagName).not.toBe('A');
      expect(tile('kpi-required-not-set')).toHaveAttribute('href', '#env-row-FAKE_REQUIRED');
      expect(tile('kpi-should-not-be-set')).toHaveAttribute('href', '#env-row-FAKE_FORBIDDEN');
      expect(tile('kpi-values-to-check')).toHaveAttribute('href', '#env-row-FAKE_ODD_FLAG');
      expect(tile('kpi-uncategorised')).toHaveAttribute('href', '#uncategorised');
      expect(document.getElementById('env-row-FAKE_REQUIRED')).not.toBeNull();
      expect(document.getElementById('uncategorised')).toBe(screen.getByTestId('uncategorised-card'));
      // Uncategorised rows carry no anchor.
      expect(document.querySelector('tr[data-name="FAKE_UNKNOWN_X"]')?.id).toBe('');
    });

    it('P4-4b a filter that hides every match removes the link, not the value', async () => {
      const user = userEvent.setup();
      await renderReady(diagPayload());
      await user.type(screen.getByLabelText('Name'), 'PADDED');
      expect(tile('kpi-required-not-set').tagName).not.toBe('A');
      expect(tile('kpi-required-not-set')).toHaveTextContent('1');
      expect(tile('kpi-values-to-check')).toHaveAttribute('href', '#env-row-FAKE_PADDED');
    });

    it('P4-5 placeholders while loading; a failed refresh hides the strip (K-10)', async () => {
      const { pending } = heldFetch();
      render(<AdminEnvironmentPage />);
      expect(screen.getAllByTestId('kpi-placeholder')).toHaveLength(5);
      await act(async () => pending.shift()?.(okAnswer(diagPayload())));
      await screen.findByTestId('kpi-set');
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: 'Refresh the environment settings' }));
      await act(async () => pending.shift()?.(answer(500, {})));
      await screen.findByTestId('environment-error');
      expect(screen.queryByTestId('kpi-set')).not.toBeInTheDocument();
      expect(screen.queryAllByTestId('kpi-placeholder')).toHaveLength(0);
    });

    it('P4-6 / P4-14 region order: header, strip, filter bar (role search, named Filters), content', async () => {
      await renderReady(diagPayload());
      const order = [
        screen.getByRole('banner'),
        tile('kpi-set'),
        screen.getByRole('search', { name: 'Filters' }),
        screen.getByTestId('environment-content'),
      ];
      for (let i = 1; i < order.length; i += 1) {
        expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      }
    });

    it('P4-7 search narrows rows by name, is never written to the URL, and is read from an inbound link', async () => {
      const user = userEvent.setup();
      const replace = jest.spyOn(window.history, 'replaceState');
      await renderReady(diagPayload());
      await user.type(screen.getByLabelText('Name'), 'forbid');
      expect(screen.getAllByTestId('env-row').map((r) => r.getAttribute('data-name'))).toEqual(['FAKE_FORBIDDEN']);
      for (const call of replace.mock.calls) expect(String(call[2] ?? '')).not.toMatch(/search=/);
      expect(window.location.search).not.toMatch(/search=/);
      replace.mockRestore();
    });

    it('P4-7b an inbound ?search= is read', async () => {
      mockSearch = 'search=padded';
      await renderReady(diagPayload());
      expect(screen.getByLabelText('Name')).toHaveValue('padded');
      expect(screen.getAllByTestId('env-row').map((r) => r.getAttribute('data-name'))).toEqual(['FAKE_PADDED']);
    });

    it('P4-8 the group filter: in the URL by replace, default omitted, an unknown id means All', async () => {
      const user = userEvent.setup();
      await renderReady(diagPayload());
      await user.selectOptions(screen.getByLabelText('Group'), 'email');
      expect(screen.getAllByTestId('group-card').map((c) => c.getAttribute('data-group'))).toEqual(['email']);
      expect(screen.queryByTestId('uncategorised-card')).not.toBeInTheDocument();
      expect(window.location.search).toBe('?group=email');
      await user.selectOptions(screen.getByLabelText('Group'), '');
      expect(window.location.search).toBe('');
    });

    it('P4-8b an unknown inbound group id is ignored', async () => {
      mockSearch = 'group=staging';
      await renderReady(diagPayload());
      expect(screen.getAllByTestId('group-card')).toHaveLength(2);
      expect(screen.getByTestId('uncategorised-card')).toBeInTheDocument();
    });

    it('P4-9 Clear resets both filters and is disabled at the defaults', async () => {
      const user = userEvent.setup();
      await renderReady(diagPayload());
      const clearButton = screen.getByRole('button', { name: 'Clear' });
      expect(clearButton).toBeDisabled();
      await user.type(screen.getByLabelText('Name'), 'x');
      await user.selectOptions(screen.getByLabelText('Group'), 'payments');
      expect(clearButton).toBeEnabled();
      await user.click(clearButton);
      expect(screen.getByLabelText('Name')).toHaveValue('');
      expect(screen.getByLabelText('Group')).toHaveValue('');
      expect(screen.getAllByTestId('group-card')).toHaveLength(2);
    });

    it('P4-10 nothing matches: the no-match words; Uncategorised reads "No match" under search', async () => {
      const user = userEvent.setup();
      await renderReady(diagPayload());
      await user.type(screen.getByLabelText('Name'), 'no-such-name');
      expect(screen.getByTestId('environment-no-match')).toHaveTextContent('No settings match the filters.');
      expect(screen.queryAllByTestId('group-card')).toHaveLength(0);
      expect(within(screen.getByTestId('uncategorised-card')).getByText('No match')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Clear filters' }));
      expect(screen.getAllByTestId('group-card')).toHaveLength(2);
    });

    it('P4-11 each code renders its fixed words as an amber chip; "Required, not set" replaces "Not set"', async () => {
      await renderReady(diagPayload());
      expect(valueText('FAKE_REQUIRED')).toBe('Required, not set');
      expect(valueCell('FAKE_REQUIRED').getByText('Required, not set').closest('[data-tone]')).toHaveAttribute('data-tone', 'warn');
      expect(valueText('FAKE_FORBIDDEN')).toBe('SetShould not be set on this environment');
      expect(valueText('FAKE_ODD_FLAG')).toBe('OffSet, not a recognised value: reads as Off');
      expect(valueText('FAKE_PADDED')).toBe('SetSpaces or line breaks around the value Code that does not trim them reads a different value.');
      for (const chip of document.querySelectorAll('[data-testid="env-diagnostic"] [data-tone]')) expect(chip).toHaveAttribute('data-tone', 'warn');
    });

    it('P4-12 (E4-4) no fetch URL has a "?" after a group change, a Refresh and a Try again', async () => {
      const user = userEvent.setup();
      const fetchMock = stubFetch(okAnswer(diagPayload()), okAnswer(diagPayload()), answer(500, {}), okAnswer(diagPayload()));
      render(<AdminEnvironmentPage />);
      await screen.findByTestId('environment-card');
      await user.selectOptions(screen.getByLabelText('Group'), 'email');
      await user.type(screen.getByLabelText('Name'), 'padded');
      await user.click(screen.getByRole('button', { name: 'Refresh the environment settings' }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      await screen.findByTestId('environment-card');
      await user.click(screen.getByRole('button', { name: 'Refresh the environment settings' }));
      await screen.findByTestId('environment-error');
      await user.click(screen.getByRole('button', { name: 'Try again' }));
      await screen.findByTestId('environment-card');
      expect(fetchMock).toHaveBeenCalledTimes(4);
      for (const call of fetchMock.mock.calls) {
        expect(call).toEqual(REQUEST);
        expect(String((call as unknown[])[0])).not.toContain('?');
      }
      // Refresh kept the filters.
      expect(screen.getByLabelText('Group')).toHaveValue('email');
    });

    it('P4-13 read-only with the filters present, in ready, filtered and error states', async () => {
      const user = userEvent.setup();
      stubFetch(okAnswer(diagPayload()), answer(500, {}));
      render(<AdminEnvironmentPage />);
      await screen.findByTestId('environment-card');
      expectReadOnly();
      await user.type(screen.getByLabelText('Name'), 'no-such-name');
      expectReadOnly();
      await user.click(screen.getByRole('button', { name: 'Refresh the environment settings' }));
      await screen.findByTestId('environment-error');
      expectReadOnly();
    });

    it('P4-15 vercel-development says it is checked against the local expectations', async () => {
      await renderReady(diagPayload('vercel-development'));
      expect(screen.getByTestId('checked-note')).toHaveTextContent('Checked against the local expectations.');
    });

    it('P4-16 a diagnostic row renders only the fixed words: extra row fields carry nothing to the page', async () => {
      const data = diagPayload();
      (data.groups[0].rows[0] as unknown as Record<string, unknown>).note = 'FAKE-smuggled-note';
      await renderReady(data);
      expect(document.body.textContent).not.toContain('FAKE-smuggled-note');
    });
  });

  it('P2-14 a late answer does not overwrite a newer one (StrictMode mounts twice, so two reads race)', async () => {
    const { pending } = heldFetch();
    render(
      <StrictMode>
        <AdminEnvironmentPage />
      </StrictMode>
    );
    await waitFor(() => expect(pending).toHaveLength(2));
    const [first, second] = [pending[0], pending[1]];
    await act(async () => second(okAnswer(payload({}, 'production'))));
    await screen.findByTestId('environment-card');
    await act(async () => first(okAnswer(payload({}, 'unknown'))));
    expect(screen.getByTestId('environment-chip')).toHaveTextContent('Production');
  });
});

describe('EC-6: Supabase project label (workplan §8.4 S6-10; SA OQ-1, OQ-3, SA-L6)', () => {
  function supabasePayload(): EnvironmentViewPayload {
    const base = payload({}, 'production');
    return {
      ...base,
      groups: [
        {
          id: 'database',
          label: 'Database',
          description: 'Database settings.',
          rows: [
            row(
              'FAKE_PUBLIC_DB_URL',
              { kind: 'shown', text: 'https://fakeref1.supabase.co' },
              {
                group: 'database',
                scope: 'browser-inlined',
                diagnostics: ['supabase-url-mismatch'],
                supabaseProject: { kind: 'known', label: 'Fake-dev-project', role: 'development-staging' },
              }
            ),
            row(
              'FAKE_SERVER_DB_URL',
              { kind: 'shown', text: 'https://fakeref2.supabase.co' },
              { group: 'database', diagnostics: ['supabase-url-mismatch'], supabaseProject: { kind: 'unknown' } }
            ),
            row('FAKE_PLAIN_URL', { kind: 'shown', text: 'https://db.example.test' }, { group: 'database' }),
          ],
        },
      ],
      counts: { ...base.counts, rows: 3, set: 3, notSet: 0, requiredNotSet: 0, shouldNotBeSet: 0, supabaseUrlMismatch: 1 },
    };
  }

  it('shows the label then the role words beside the origin, "Unknown project" as neutral text, and nothing on a plain row', async () => {
    await renderReady(supabasePayload());
    expect(valueText('FAKE_PUBLIC_DB_URL')).toBe(
      'https://fakeref1.supabase.coFake-dev-project Development and stagingNot the same address as the other Supabase URL'
    );
    const known = valueCell('FAKE_PUBLIC_DB_URL').getByTestId('env-supabase-project');
    expect(known).toHaveTextContent('Fake-dev-project Development and staging');
    // Origin first, then the label (OQ-1).
    const origin = valueCell('FAKE_PUBLIC_DB_URL').getByText('https://fakeref1.supabase.co');
    expect(origin.compareDocumentPosition(known) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const unknown = valueCell('FAKE_SERVER_DB_URL').getByTestId('env-supabase-project');
    expect(unknown).toHaveTextContent(/^Unknown project$/);
    // OQ-3: not a chip, not amber.
    expect(unknown.closest('[data-tone]')).toBeNull();
    expect(unknown.querySelector('[data-tone]')).toBeNull();

    expect(valueCell('FAKE_PLAIN_URL').queryByTestId('env-supabase-project')).toBeNull();
    expect(valueText('FAKE_PLAIN_URL')).toBe('https://db.example.test');
  });

  it('the mismatch is an amber chip in words on both rows, and counts in "Values to check"', async () => {
    await renderReady(supabasePayload());
    for (const name of ['FAKE_PUBLIC_DB_URL', 'FAKE_SERVER_DB_URL']) {
      const chip = valueCell(name).getByText('Not the same address as the other Supabase URL');
      expect(chip.closest('[data-tone]')).toHaveAttribute('data-tone', 'warn');
      expect(chip.closest('[data-testid="env-diagnostic"]')).toHaveAttribute('data-code', 'supabase-url-mismatch');
    }
    const tile = screen.getByTestId('kpi-values-to-check');
    expect(tile).toHaveAttribute('data-status', 'amber');
    expect(tile).toHaveTextContent('1 Supabase address mismatch');
    expect(tile).toHaveAttribute('href', '#env-row-FAKE_PUBLIC_DB_URL');
  });

  it('a payload with a malformed project is the fallback, not a crash', async () => {
    const data = supabasePayload();
    (data.groups[0].rows[0] as unknown as Record<string, unknown>).supabaseProject = { kind: 'known', label: 'FAKE-x', role: 'FAKE-role' };
    stubFetch(okAnswer(data));
    render(<AdminEnvironmentPage />);
    await screen.findByTestId('environment-error');
    expect(document.body.textContent).not.toContain('FAKE-role');
  });
});
