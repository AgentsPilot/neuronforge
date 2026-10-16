/**
 * @jest-environment jsdom
 *
 * Finance F-4, AC-173 (SA-WP-F4, F4-R1, F4-R5): the request to the finance
 * route and the route's query schema are byte-identical across F-4.
 *
 * Written FIRST and run green on the unchanged tree (067c4a3e, where the page
 * still read the URL with `parseFinanceUrl` and wrote it with `router.replace`),
 * then never edited again. Its SHA-256 is recorded in the workplan's
 * Implementation Notes at Step 0 and at handover; the two must be equal.
 *
 * Part A: every pinned page state renders the real view and sends exactly one
 * request, equal to its literal, with `cache: 'no-store'`. The navigation mock
 * offers both the router (before F-4) and `useSearchParams` (both), so the same
 * file runs on either side.
 *
 * Part B: the route's `DATE` and `buildQuerySchema` text (CRLF normalised, the
 * #394 lesson) hashes to a recorded constant, and the lists it imports from
 * the page keep their values. A planted one-character edit changes the hash.
 *
 * Part C: `serialiseFinanceUrl` (with its doc comment) hashes to a recorded
 * constant, so "API serialiser only" cannot drift silently.
 */

import '@testing-library/jest-dom';
import { act, render, screen } from '@testing-library/react';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

let mockSearch = '';
const mockReplace = jest.fn();
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mockSearch),
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
  usePathname: () => '/admin/finance',
}));
// The real picker searches as the admin types; a stand-in keeps the fetch count the page's own.
jest.mock('@/app/admin/components/layout/AdminBusinessPicker', () => ({
  ...jest.requireActual('@/app/admin/components/layout/AdminBusinessPicker'),
  AdminBusinessPicker: () => <div data-testid="picker-stand-in" />,
}));

import { FinanceView } from '../components/FinanceView';
import { ADMIN_WINDOW_CHOICES } from '@/app/admin/components/adminWindowPresets';
import { FINANCE_ACCOUNTS_SHOWS, FINANCE_ACCOUNTS_SORTS, FINANCE_GROUP_SHAPE } from '../financeUrl';
import { PINNED_REQUESTS } from './financeRequestPins';

const ROOT = process.cwd();
const ROUTE = path.join(ROOT, 'app', 'api', 'admin', 'business-os', 'finance', 'route.ts');
const URL_MODULE = path.join(ROOT, 'app', 'admin', 'finance', 'financeUrl.ts');

/** Recorded at Step 0 on 067c4a3e. */
const ROUTE_SCHEMA_SHA256 = 'da2682843092d8a64b1ba46daaf884f33521f69cfd3b23e8c95506c2459ed87f';
const SERIALISER_SHA256 = '60518fb6b4129371bb2fba2d248de5f28e0b60266e9df15c1917f9904fe0dcd8';

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const lf = (text: string) => text.replace(/\r\n/g, '\n');

/** From `start` through the first line that is exactly `}` after `after` (both must be present). */
function cut(text: string, start: string, after: string): string {
  const from = text.indexOf(start);
  const anchor = text.indexOf(after, from);
  if (from < 0 || anchor < 0) throw new Error(`cut: marker missing (${start} / ${after})`);
  const end = text.indexOf('\n}\n', anchor);
  const close = end < 0 && text.endsWith('\n}') ? text.length - 2 : end;
  if (close < 0) throw new Error('cut: no closing brace');
  return text.slice(from, close + 2);
}

const routeSchemaText = (source: string) => cut(lf(source), 'const DATE = ', 'function buildQuerySchema');

function serialiserText(source: string): string {
  const text = lf(source);
  const exported = text.indexOf('export function serialiseFinanceUrl(');
  if (exported < 0) throw new Error('serialiseFinanceUrl not found');
  const doc = text.lastIndexOf('/**', exported);
  return cut(text, text.slice(doc, exported), 'export function serialiseFinanceUrl(');
}

function failedRead(): jest.Mock {
  // A settled read with no payload: the request is the subject here, not the sections.
  const fetchMock = jest.fn(async () => ({ ok: false, status: 404, json: async () => ({ success: false, error: 'Business not found' }) }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
  (global as any).fetch = fetchMock;
  return fetchMock;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSearch = '';
  window.history.replaceState(null, '', '/admin/finance');
});

describe('AC-173 part A: each pinned page state sends exactly its pinned request, once', () => {
  it.each(PINNED_REQUESTS.map((pin) => [pin.row, pin.link, pin.request] as const))(
    'row %i: ?%s',
    async (_row, link, request) => {
      mockSearch = link;
      window.history.replaceState(null, '', link ? `/admin/finance?${link}` : '/admin/finance');
      const fetchMock = failedRead();
      render(<FinanceView />);
      await screen.findByTestId('finance-error', {}, { timeout: 10_000 });
      // Let any follow-up effect run (a URL clean-up must never send a second read).
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe(request);
      expect(init).toEqual(expect.objectContaining({ cache: 'no-store' }));
    },
    30_000
  );
});

describe('AC-173 part B: the route’s query schema is unchanged', () => {
  it('the DATE and buildQuerySchema text hashes to the recorded constant', () => {
    const text = routeSchemaText(fs.readFileSync(ROUTE, 'utf8'));
    expect(text.startsWith('const DATE = ')).toBe(true);
    expect(text).toContain('function buildQuerySchema(now: Date) {');
    expect(text.endsWith('\n}')).toBe(true);
    expect(sha256(text)).toBe(ROUTE_SCHEMA_SHA256);
  });

  it('the lists the route imports keep their values', () => {
    expect([...ADMIN_WINDOW_CHOICES]).toEqual(['today', '7d', '30d', 'this_month', 'custom']);
    expect([...FINANCE_ACCOUNTS_SORTS]).toEqual(['ai_cost', 'margin', 'paid', 'credits']);
    expect([...FINANCE_ACCOUNTS_SHOWS]).toEqual(['all', 'active', 'negative']);
    expect(FINANCE_GROUP_SHAPE.source).toBe('^(trial|founding_partner|comped|unknown_held|tier_set|tier:[a-z0-9_-]{1,40})$');
  });

  it('planted control: a one-character edit inside the schema changes the hash; CRLF does not', () => {
    const source = fs.readFileSync(ROUTE, 'utf8');
    const planted = source.replace(".default('this_month')", ".default('this_montH')");
    expect(planted).not.toBe(source);
    expect(sha256(routeSchemaText(planted))).not.toBe(sha256(routeSchemaText(source)));
    expect(sha256(routeSchemaText(lf(source).replace(/\n/g, '\r\n')))).toBe(sha256(routeSchemaText(source)));
  });
});

describe('AC-173 part C: serialiseFinanceUrl is unchanged', () => {
  it('its text (doc comment included) hashes to the recorded constant', () => {
    const text = serialiserText(fs.readFileSync(URL_MODULE, 'utf8'));
    expect(text.startsWith('/**')).toBe(true);
    expect(text).toContain('export function serialiseFinanceUrl(query: FinanceQuery): string {');
    expect(sha256(text)).toBe(SERIALISER_SHA256);
  });

  it('planted control: writing `range` instead of `preset` changes the hash', () => {
    const source = fs.readFileSync(URL_MODULE, 'utf8');
    const planted = source.replace("params.set('preset', query.preset);", "params.set('range', query.preset);");
    expect(planted).not.toBe(source);
    expect(sha256(serialiserText(planted))).not.toBe(sha256(serialiserText(source)));
  });
});
