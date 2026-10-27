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
    ...extra,
  };
}

function payload(overrides: Partial<EnvironmentViewPayload> = {}, label: EnvironmentLabel = 'preview'): EnvironmentViewPayload {
  return {
    environment: { label, facts: { host: 'deploy-x.example.test', region: 'abc1', branch: 'feature/x', commit: null } },
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
    counts: { rows: 13, set: 9, notSet: 4, uncategorised: 0, platformHidden: 12 },
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

function expectReadOnly() {
  expect(document.querySelectorAll('input, select, textarea, form, [role="dialog"]')).toHaveLength(0);
  for (const button of screen.queryAllByRole('button')) {
    const name = button.getAttribute('aria-label') ?? button.textContent ?? '';
    expect(name.startsWith('Refresh') || name === 'Try again').toBe(true);
    expect(name).not.toMatch(/copy|reveal|show value|download/i);
  }
}

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
