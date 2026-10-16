/**
 * Finance F-4, AC-173 (SA-WP-F4, F4-R1, F4-R5): the fixed set of page states
 * and the exact request each one sends to the finance route. Written and run
 * green on the unchanged tree (067c4a3e) before any F-4 edit; never edited
 * after that (F4-R5).
 *
 * Shared by the pin test and the F-4 interaction tests, so an in-page choice
 * is held to the same literal as the link that reaches the same state.
 *
 * Jest collects every file under `__tests__/`, so this module carries one
 * self-check of the table; a file that imports it runs that check too.
 */

/** A business id, lower case. Row 8 sends it upper case and expects it lower-cased. */
export const PIN_ACCOUNT = '1a2b3c4d-1111-4111-8111-abcdefabcdef';
export const PIN_ACCOUNT_UPPER = PIN_ACCOUNT.toUpperCase();

export const FINANCE_REQUEST_PATH = '/api/admin/business-os/finance';

export interface PinnedRequest {
  /** The row number in the workplan's AC-173 table. */
  row: number;
  /** The page link (old keys, valid on both sides of F-4). */
  link: string;
  /** The exact request URL. */
  request: string;
}

const R = (query: string) => `${FINANCE_REQUEST_PATH}?${query}`;
const CUSTOM = 'from=2026-09-01&to=2026-09-30';

export const PINNED_REQUESTS: readonly PinnedRequest[] = [
  { row: 1, link: '', request: R('preset=this_month') },
  { row: 2, link: 'preset=today', request: R('preset=today') },
  { row: 3, link: 'preset=7d', request: R('preset=7d') },
  { row: 4, link: 'preset=30d', request: R('preset=30d') },
  { row: 5, link: 'preset=this_month', request: R('preset=this_month') },
  { row: 6, link: `preset=custom&${CUSTOM}`, request: R(`preset=custom&${CUSTOM}`) },
  { row: 7, link: `preset=this_month&accountId=${PIN_ACCOUNT}`, request: R(`preset=this_month&accountId=${PIN_ACCOUNT}`) },
  { row: 8, link: `preset=7d&accountId=${PIN_ACCOUNT_UPPER}`, request: R(`preset=7d&accountId=${PIN_ACCOUNT}`) },
  { row: 9, link: `preset=custom&${CUSTOM}&accountId=${PIN_ACCOUNT}`, request: R(`preset=custom&${CUSTOM}&accountId=${PIN_ACCOUNT}`) },
  { row: 10, link: `accountId=${PIN_ACCOUNT}&preset=this_month`, request: R(`preset=this_month&accountId=${PIN_ACCOUNT}`) },
  { row: 11, link: 'tab=accounts', request: R('preset=this_month&tab=accounts') },
  {
    row: 12,
    link: 'tab=accounts&sort=margin&group=trial&show=negative',
    request: R('preset=this_month&tab=accounts&sort=margin&group=trial&show=negative'),
  },
  {
    row: 13,
    link: 'preset=30d&tab=accounts&group=tier%3Aessentials&show=active',
    request: R('preset=30d&tab=accounts&group=tier%3Aessentials&show=active'),
  },
  {
    row: 14,
    link: `preset=custom&${CUSTOM}&tab=accounts&sort=paid`,
    request: R(`preset=custom&${CUSTOM}&tab=accounts&sort=paid`),
  },
  { row: 15, link: 'preset=30d&from=2020-01-01&to=2020-01-02', request: R('preset=30d') },
];

/** One row by its number. */
export function pinnedRequest(row: number): string {
  const found = PINNED_REQUESTS.find((pin) => pin.row === row);
  if (!found) throw new Error(`No pinned request row ${row}`);
  return found.request;
}

describe('the AC-173 table (self-check)', () => {
  it('has rows 1 to 15, each request on the finance route', () => {
    expect(PINNED_REQUESTS.map((pin) => pin.row)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    for (const pin of PINNED_REQUESTS) expect(pin.request.startsWith(`${FINANCE_REQUEST_PATH}?preset=`)).toBe(true);
  });
});
