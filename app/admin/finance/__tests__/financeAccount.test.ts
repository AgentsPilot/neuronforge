/**
 * @jest-environment node
 *
 * Money M-1 (T11): the picked business's name (M1-FR-3, SA-Q32) and its paying
 * state (E-35), both pure.
 *
 *   - Name order: (a) the picked name for exactly this id, (b) a payload row for
 *     exactly this id (Section 4, then Section 3, then takings, then overdue),
 *     only a `found` name, `platform` labelled, (c) nothing.
 *   - Paying: every group key. A tier group is Paying; trial, Founding Partner,
 *     comped and unknown/held are Not paying; `tier_set`, a failed section and
 *     no counted group are Unknown.
 */

import type {
  FinanceAccountsSection,
  FinanceGroupCount,
  FinanceGroupKey,
  FinancePayload,
} from '@/lib/business-os/finance/financeTypes';
import { accountNameFor, payingStateOf, pickedGroupOf } from '../financeAccount';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

type Row = { accountId: string; name: string | null; nameStatus: string };

/** Only the parts `accountNameFor` reads; the rest of the payload is irrelevant to it. */
function payload(accountId: string | null, rows: { credits?: Row[]; top?: Row[]; takings?: Row[]; invoices?: Row[]; instalments?: Row[] }): FinancePayload {
  const due = (list: Row[] | undefined) => ({ status: 'ok', figures: list ? { rows: list } : null });
  return {
    accountId,
    credits: { figures: rows.credits ? { rows: rows.credits } : null },
    aiCost: { figures: rows.top ? { topAccounts: rows.top } : null },
    takings: { figures: rows.takings ? { rows: rows.takings } : null },
    paymentProblems: { overdueInvoices: due(rows.invoices), overdueInstalments: due(rows.instalments) },
  } as unknown as FinancePayload;
}

describe('accountNameFor (M1-FR-3, SA-Q32)', () => {
  const full = payload(A, {
    credits: [{ accountId: A, name: 'From credits', nameStatus: 'found' }],
    top: [{ accountId: A, name: 'From AI cost', nameStatus: 'found' }],
    takings: [{ accountId: A, name: 'From takings', nameStatus: 'found' }],
    invoices: [{ accountId: A, name: 'From invoices', nameStatus: 'found' }],
  });

  it('(a) the picked name wins, but only for exactly this id and only when not blank', () => {
    expect(accountNameFor(A, { accountId: A, name: 'Picked' }, full)).toEqual({ name: 'Picked', platform: false });
    expect(accountNameFor(A, { accountId: B, name: 'Other' }, full)).toEqual({ name: 'From credits', platform: false });
    expect(accountNameFor(A, { accountId: A, name: '   ' }, full)).toEqual({ name: 'From credits', platform: false });
    expect(accountNameFor(A, { accountId: A, name: null }, full)).toEqual({ name: 'From credits', platform: false });
  });

  it('(b) the payload order: Section 4, Section 3, takings, overdue invoices, overdue instalments', () => {
    expect(accountNameFor(A, null, full).name).toBe('From credits');
    expect(accountNameFor(A, null, payload(A, { top: [{ accountId: A, name: 'From AI cost', nameStatus: 'found' }], takings: [{ accountId: A, name: 'From takings', nameStatus: 'found' }] })).name).toBe('From AI cost');
    expect(accountNameFor(A, null, payload(A, { takings: [{ accountId: A, name: 'From takings', nameStatus: 'found' }], invoices: [{ accountId: A, name: 'From invoices', nameStatus: 'found' }] })).name).toBe('From takings');
    expect(accountNameFor(A, null, payload(A, { invoices: [{ accountId: A, name: 'From invoices', nameStatus: 'found' }] })).name).toBe('From invoices');
    expect(accountNameFor(A, null, payload(A, { instalments: [{ accountId: A, name: 'From instalments', nameStatus: 'found' }] })).name).toBe('From instalments');
  });

  it('(b) only a row for exactly this id, only a found name, and only a payload for this account', () => {
    expect(accountNameFor(A, null, payload(A, { credits: [{ accountId: B, name: 'Not this one', nameStatus: 'found' }] }))).toEqual({ name: null, platform: false });
    expect(accountNameFor(A, null, payload(A, { credits: [{ accountId: A, name: null, nameStatus: 'missing' }, { accountId: A, name: 'x', nameStatus: 'unavailable' }] }))).toEqual({ name: null, platform: false });
    // A payload for all businesses (or another account) never names the picked id.
    expect(accountNameFor(A, null, payload(null, { credits: [{ accountId: A, name: 'All view', nameStatus: 'found' }] }))).toEqual({ name: null, platform: false });
    expect(accountNameFor(A, null, null)).toEqual({ name: null, platform: false });
  });

  it('(b) a platform row says platform, never a business name', () => {
    expect(accountNameFor(A, null, payload(A, { credits: [{ accountId: A, name: null, nameStatus: 'platform' }] }))).toEqual({ name: null, platform: true });
  });

  it('(c) nothing found: no name, so the chip shows the short id', () => {
    expect(accountNameFor(A, null, payload(A, {}))).toEqual({ name: null, platform: false });
  });
});

describe('payingStateOf (E-35)', () => {
  const group = (key: FinanceGroupKey, count: number, foundingPartners = 0): FinanceGroupCount => ({
    key, tierLabel: key.startsWith('tier:') ? 'Label' : null, count, grace: 0, pastDue: 0, foundingPartners,
  });
  const section = (key: FinanceGroupKey | null, status: FinanceAccountsSection['status'] = 'ok'): FinanceAccountsSection => ({
    status,
    scope: 'one',
    figures: status === 'unknown'
      ? null
      : {
          total: key ? 1 : 0,
          groups: (['trial', 'founding_partner', 'comped', 'tier:any', 'unknown_held'] as FinanceGroupKey[])
            .filter((k) => k !== key)
            .map((k) => group(k, 0))
            .concat(key ? [group(key, 1)] : []),
          payingKnown: key !== 'tier_set',
          byState: {},
          foundingNoEndDate: 0,
          dormantFounding: 0,
          newInWindow: { total: 0, byOrigin: [] },
          endingIn30Days: 0,
        },
  });

  it.each([
    ['tier:any', 'paying'],
    ['trial', 'not_paying'],
    ['founding_partner', 'not_paying'],
    ['comped', 'not_paying'],
    ['unknown_held', 'not_paying'],
    ['tier_set', 'unknown'],
  ] as const)('group %s → %s', (key, expected) => {
    expect(payingStateOf(section(key))).toBe(expected);
    expect(pickedGroupOf(section(key))?.key).toBe(key);
  });

  it('a section that could not load, or no counted group → Unknown, and no group', () => {
    expect(payingStateOf(section(null, 'unknown'))).toBe('unknown');
    expect(pickedGroupOf(section(null, 'unknown'))).toBeNull();
    expect(payingStateOf(section(null))).toBe('unknown');
    expect(pickedGroupOf(section(null))).toBeNull();
  });
});
