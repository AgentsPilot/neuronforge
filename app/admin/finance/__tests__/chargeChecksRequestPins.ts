/**
 * Money M-5, AC-188 (SA-WP-M5, M5-R4): the fixed set of Charge checks URL
 * states and the exact requests each one sends. Written and run green on the
 * unchanged tree (98735db9), where the report was the Business OS AI page's
 * Costs & credits tab, before any M-5 edit.
 *
 * RULED RE-FREEZE, Money MK-2 (SA-RR-MK SA-7, pin table row MK-2; workplan
 * ADMIN_MONEY_MK2_ONE_AI_COST_WORKPLAN.md RU-1 to RU-4): the default window
 * moved from 30 days to This month, so rows 1, 7, 9 and 10 (the default, and
 * the two states ignored on arrival) now send `from=2026-10-01` where they
 * sent `from=2026-09-17`. Every other literal, every leak request and the pin
 * test file itself are unchanged. Never edited otherwise.
 *
 * The clock is fixed at PIN_NOW, so every window resolves to the same dates on
 * both sides of the move.
 *
 * Jest collects every file under `__tests__/`, so this module carries one
 * self-check of the table; a file that imports it runs that check too.
 */

export const PIN_NOW = new Date('2026-10-16T10:00:00.000Z');
export const PIN_ACCOUNT = '1a2b3c4d-1111-4111-8111-abcdefabcdef';

export const REPORT_PATH = '/api/admin/business-os/credits/report';
export const LEAK_PATH = '/api/admin/business-os/credits/leak-check';

export interface PinnedChargeRequest {
  /** The row number. */
  row: number;
  /** The Charge checks query string (no `tab`; the old side prefixes `tab=costs`). */
  state: string;
  /** The exact report request. */
  report: string;
  /** The exact leak-check request after "Run leak check", or null when not pressed. */
  leak: string | null;
}

const R = (query: string) => `${REPORT_PATH}?${query}`;
const L = (query: string) => `${LEAK_PATH}?${query}`;

export const PINNED_CHARGE_REQUESTS: readonly PinnedChargeRequest[] = [
  { row: 1, state: '', report: R('from=2026-10-01&to=2026-10-16'), leak: L('from=2026-10-15&to=2026-10-15') },
  { row: 2, state: 'range=7d', report: R('from=2026-10-10&to=2026-10-16'), leak: null },
  { row: 3, state: 'range=90d', report: R('from=2026-07-19&to=2026-10-16'), leak: null },
  { row: 4, state: 'range=today', report: R('from=2026-10-16&to=2026-10-16'), leak: null },
  { row: 5, state: 'range=this_month', report: R('from=2026-10-01&to=2026-10-16'), leak: null },
  { row: 6, state: 'range=custom&from=2026-09-01&to=2026-09-30', report: R('from=2026-09-01&to=2026-09-30'), leak: null },
  {
    row: 7,
    state: `account=${PIN_ACCOUNT}`,
    report: R(`from=2026-10-01&to=2026-10-16&accountId=${PIN_ACCOUNT}`),
    leak: L(`from=2026-10-15&to=2026-10-15&accountId=${PIN_ACCOUNT}`),
  },
  { row: 8, state: `range=7d&account=${PIN_ACCOUNT}`, report: R(`from=2026-10-10&to=2026-10-16&accountId=${PIN_ACCOUNT}`), leak: null },
  // Ignored on arrival (U-4): an account that is not a UUID, a one-sided custom window.
  { row: 9, state: 'account=nope', report: R('from=2026-10-01&to=2026-10-16'), leak: null },
  { row: 10, state: 'range=custom&from=2026-09-01', report: R('from=2026-10-01&to=2026-10-16'), leak: null },
];

describe('the AC-188 table (self-check)', () => {
  it('has rows 1 to 10, each report on the report route and each leak on the leak route', () => {
    expect(PINNED_CHARGE_REQUESTS.map((pin) => pin.row)).toEqual(Array.from({ length: 10 }, (_, i) => i + 1));
    for (const pin of PINNED_CHARGE_REQUESTS) {
      expect(pin.report.startsWith(`${REPORT_PATH}?from=`)).toBe(true);
      expect(pin.state).not.toMatch(/(^|&)tab=/);
      if (pin.leak !== null) expect(pin.leak.startsWith(`${LEAK_PATH}?from=`)).toBe(true);
    }
  });
});
