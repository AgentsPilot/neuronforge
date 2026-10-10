/**
 * @jest-environment jsdom
 */

/**
 * The Health landing (admin reorganisation slices 4 and 5): renders what the
 * route sends; green only on a tile the route sent as green, labelled
 * "Healthy" (SA C-10R); distinct looks for green / For information / Not
 * measured / Could not check; accessible labels (SA C-16); the rules with
 * their generated conditions (SA C-22); a visible page link that says where it
 * goes (RC-5.2); and no link to the legacy dashboard (U-6).
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
  }),
}));

// HealthGrid logs through `clientLogger.child` (Admin Layout Standard L-1a, F-56).
// `@/lib/logger/client` re-exports from `@/lib/logger`, whose mock above has no
// `clientLogger`, so without this the module-scope `child` call throws (RC-1).
jest.mock('@/lib/logger/client', () => {
  const noop = () => undefined;
  const child = () => ({ error: noop, warn: noop, info: noop, debug: noop });
  return { clientLogger: { child } };
});

import AdminHealthPage from '../page';
import { STATUS_STYLES } from '../components/health/HealthTile';
import type { HealthSummary, HealthTile } from '@/lib/admin/health/healthTypes';

const GREEN = /\b(?:bg|text|border)-(?:green|emerald)-/;

function tile(over: Partial<HealthTile> & Pick<HealthTile, 'id' | 'status'>): HealthTile {
  return {
    title: over.id,
    headline: 'All clear',
    matchedRuleId: null,
    figures: [],
    rules: [],
    otherwise: null,
    footnote: null,
    pageLink: null,
    ...over,
  };
}

const SUMMARY: HealthSummary = {
  generatedAt: '2026-09-26T10:30:12.000Z',
  windows: {
    end: '2026-09-26T10:30:00.000Z',
    last24hStart: '2026-09-25T10:30:00.000Z',
    previous24hStart: '2026-09-24T10:30:00.000Z',
    last7dStart: '2026-09-19T10:30:00.000Z',
    previous7dStart: '2026-09-12T10:30:00.000Z',
  },
  tiles: [
    tile({
      id: 'bos_ai_failures',
      status: 'red',
      headline: '5+ AI failures in the last 24 hours',
      matchedRuleId: 'failures.count24h',
      figures: [
        {
          label: 'Failed AI actions, last 24 h',
          value: '6 of 20 actions',
          exact: true,
          href: '/admin/audit-trail?action=BUSINESS_AI_ACTION_FAILED&date_from=2026-09-25T10%3A30&date_to=2026-09-26T10%3A30',
          linkLabel: 'Failed AI actions, last 24 hours: 6, open in audit trail',
          note: null,
        },
      ],
      rules: [
        { colour: 'red', description: '5+ AI failures in the last 24 hours', condition: 'failed AI actions in 24 h ≥ 5' },
        { colour: 'amber', description: 'AI failures in the last 24 hours', condition: 'failed AI actions in 24 h ≥ 1' },
      ],
      otherwise: 'Otherwise: green, "All clear".',
    }),
    tile({
      id: 'bos_ai_spend',
      status: 'amber',
      headline: 'Total is a minimum; not all calls counted',
      figures: [
        {
          label: 'AI spend, last 7 days (USD)',
          value: 'at least $12.10 (previous 7 days: $3.00)',
          exact: false,
          href: '/admin/analytics?scope=bos&dateFrom=x&dateTo=y',
          linkLabel: 'Business OS AI spend, last 7 days: at least $12.10, open in AI cost & usage',
          note: null,
        },
      ],
    }),
    tile({ id: 'critical_audit', status: 'green' }),
    tile({
      id: 'entitlements_mode',
      status: 'neutral',
      headline: 'Shadow mode: Plans are checked and logged; nothing is blocked.',
      figures: [{ label: 'Mode in effect', value: 'Shadow', exact: true, href: null, linkLabel: null, note: null }],
      pageLink: { href: '/admin/business-os-tiers', text: 'Open Plans & entitlements (plans and account lookup)' },
    }),
    tile({ id: 'bos_ai_settings', status: 'unavailable', headline: 'Could not check just now' }),
    tile({ id: 'scheduled_jobs', status: 'not_measured', headline: 'Not measured yet', footnote: 'No page yet.' }),
  ],
};

function mockRoute(body: unknown = { success: true, data: SUMMARY }, ok = true): jest.Mock {
  const fetchMock = jest.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => body }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
  (global as any).fetch = fetchMock;
  return fetchMock;
}

beforeEach(() => jest.clearAllMocks());

describe('the Health page', () => {
  it('fetches with no parameters and no-store (the route rejects parameters)', async () => {
    const fetchMock = mockRoute();
    render(<AdminHealthPage />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0]).toEqual(['/api/admin/health-summary', { cache: 'no-store' }]);
  });

  it('shows each tile\'s headline and status label', async () => {
    mockRoute();
    render(<AdminHealthPage />);
    const red = await screen.findByTestId('health-tile-bos_ai_failures');
    expect(within(red).getByTestId('headline').textContent).toBe('5+ AI failures in the last 24 hours');
    expect(within(red).getByTestId('status-label').textContent).toBe('Needs action');
    const green = screen.getByTestId('health-tile-critical_audit');
    expect(within(green).getByTestId('status-label').textContent).toBe('Healthy');
    expect(within(green).getByTestId('headline').textContent).toBe('All clear');
    expect(within(screen.getByTestId('health-tile-entitlements_mode')).getByTestId('status-label').textContent).toBe(
      'For information'
    );
    expect(within(screen.getByTestId('health-tile-scheduled_jobs')).getByTestId('headline').textContent).toBe(
      'Not measured yet'
    );
  });

  it('renders green only on the tile the route sent as green (C-10R)', async () => {
    mockRoute();
    render(<AdminHealthPage />);
    await screen.findByTestId('health-tile-bos_ai_failures');
    const sections = screen.getAllByRole('region');
    expect(sections.length).toBe(SUMMARY.tiles.length);
    for (const section of sections) {
      const isGreen = section.getAttribute('data-status') === 'green';
      expect(GREEN.test(section.outerHTML)).toBe(isGreen);
    }
  });

  it('with no green tile in the summary, nothing on the page is green', async () => {
    mockRoute({ success: true, data: { ...SUMMARY, tiles: SUMMARY.tiles.filter((t) => t.status !== 'green') } });
    const { container } = render(<AdminHealthPage />);
    await screen.findByTestId('health-tile-bos_ai_failures');
    expect(container.innerHTML).not.toMatch(GREEN);
  });

  it('green, For information, Not measured and Could not check all look different (C-10R)', () => {
    const cls = (s: keyof typeof STATUS_STYLES) => `${STATUS_STYLES[s].card} ${STATUS_STYLES[s].accent}`;
    expect(new Set([cls('green'), cls('neutral'), cls('not_measured'), cls('unavailable')]).size).toBe(4);
    for (const [status, style] of Object.entries(STATUS_STYLES)) {
      expect(GREEN.test(`${style.card} ${style.accent}`)).toBe(status === 'green');
    }
    expect(STATUS_STYLES.green.label).toBe('Healthy');
    expect(STATUS_STYLES.neutral.label).toBe('For information');
  });

  it('the entitlements tile shows a visible link that says where it goes, and no number (RC-5.2)', async () => {
    mockRoute();
    render(<AdminHealthPage />);
    const ent = await screen.findByTestId('health-tile-entitlements_mode');
    const link = within(ent).getByTestId('page-link');
    expect(link.textContent).toBe('Open Plans & entitlements (plans and account lookup)');
    expect(link.getAttribute('href')).toBe('/admin/business-os-tiers');
    expect(within(ent).getByText('Mode in effect')).toBeTruthy();
    expect(ent.textContent).not.toMatch(/\d/);
  });

  it('a tile without a page link renders none', async () => {
    mockRoute();
    render(<AdminHealthPage />);
    const red = await screen.findByTestId('health-tile-bos_ai_failures');
    expect(within(red).queryByTestId('page-link')).toBeNull();
  });

  it('the not-measured tile has no link', async () => {
    mockRoute();
    render(<AdminHealthPage />);
    const jobs = await screen.findByTestId('health-tile-scheduled_jobs');
    expect(jobs.querySelector('a')).toBeNull();
  });

  it('figure links carry a descriptive accessible name, and a lower bound keeps "at least"', async () => {
    mockRoute();
    render(<AdminHealthPage />);
    const link = await screen.findByRole('link', { name: 'Failed AI actions, last 24 hours: 6, open in audit trail' });
    expect(link.textContent).toBe('6 of 20 actions');
    expect(within(screen.getByTestId('health-tile-bos_ai_spend')).getByRole('link').textContent).toContain('at least $12.10');
  });

  it('lists the tile\'s rules in order with their generated conditions (C-22)', async () => {
    mockRoute();
    render(<AdminHealthPage />);
    const list = within(await screen.findByTestId('health-tile-bos_ai_failures')).getByTestId('rule-list');
    const items = within(list).getAllByRole('listitem').map((li) => li.textContent);
    expect(items[0]).toContain('5+ AI failures in the last 24 hours');
    expect(items[0]).toContain('failed AI actions in 24 h ≥ 5');
    expect(items[1]).toContain('AI failures in the last 24 hours');
    expect(within(list).getByTestId('rule-otherwise').textContent).toBe('Otherwise: green, "All clear".');
  });

  it('renders the closing line the route sent, and none when it sent none (SA code review 2)', async () => {
    mockRoute();
    render(<AdminHealthPage />);
    const spend = await screen.findByTestId('health-tile-bos_ai_spend');
    expect(within(spend).queryByTestId('rule-otherwise')).toBeNull();
  });

  it('has no link to the legacy dashboard (U-6)', async () => {
    mockRoute();
    const { container } = render(<AdminHealthPage />);
    await screen.findByTestId('health-tile-bos_ai_failures');
    expect(container.innerHTML).not.toContain('platform-dashboard');
  });

  it('has exactly one h1, "Health", while loading and once loaded', async () => {
    mockRoute();
    render(<AdminHealthPage />);
    const whileLoading = screen.getAllByRole('heading', { level: 1 });
    expect(whileLoading).toHaveLength(1);
    expect(whileLoading[0].textContent).toBe('Health');
    await screen.findByTestId('health-tile-bos_ai_failures');
    const loaded = screen.getAllByRole('heading', { level: 1 });
    expect(loaded).toHaveLength(1);
    expect(loaded[0].textContent).toBe('Health');
  });

  it('Refresh refetches and is aria-busy while loading', async () => {
    const fetchMock = mockRoute();
    render(<AdminHealthPage />);
    await screen.findByTestId('health-tile-bos_ai_failures');
    const button = screen.getByRole('button', { name: 'Refresh the health summary' });
    expect(button.getAttribute('aria-busy')).toBe('false');
    fireEvent.click(button);
    expect(button.getAttribute('aria-busy')).toBe('true');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toBe('/api/admin/health-summary');
  });

  it('a failed load says so, without inventing tiles', async () => {
    mockRoute({ success: false, error: 'Forbidden' }, false);
    render(<AdminHealthPage />);
    expect((await screen.findByTestId('health-error')).textContent).toBe('Forbidden');
    expect(screen.queryByTestId('health-tile-bos_ai_failures')).toBeNull();
  });
});
