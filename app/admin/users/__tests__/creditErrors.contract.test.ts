/**
 * Every refusal the Credits block and its forms can meet has a sentence
 * (credit deduction slice 11c, workplan §11c.6.4, G11c-7, SA W11c-7).
 * Modelled on `summaryErrors.contract.test.ts`: the codes are read from the
 * server sources, so a new refusal without copy is a red test rather than a
 * raw code on the screen.
 */

import * as fs from 'fs';
import * as path from 'path';

import { CREDIT_ERROR_COPY, GENERIC_ERROR_COPY, creditErrorSentence } from '../creditCopy';

const read = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), 'utf8');

const CREDIT_OPS = 'lib/business-os/credits/creditAdminOps.ts';
const VIEW_ROUTE = 'app/api/admin/business-os/credits/accounts/[accountId]/route.ts';
const ADMIN_OPS = 'lib/business-os/entitlements/adminOps.ts';
const POST_ROUTE = 'app/api/admin/business-os/entitlements/accounts/[accountId]/route.ts';
const GATE = 'lib/admin/requireAdminRoute.ts';

// Quote-agnostic, as in the summary contract.
// (No back-reference on purpose: this file sits where Tailwind scans.)
const codesIn = (source: string) => [
  ...new Set([...source.matchAll(/error:\s*(?:'([^']+)'|"([^"]+)"|`([^`]+)`)/g)].map((m) => m[1] ?? m[2] ?? m[3])),
];

const scanned = [...new Set([...codesIn(read(CREDIT_OPS)), ...codesIn(read(VIEW_ROUTE))])];

/**
 * Codes the two ops reach through the shared checks in front of them, and the
 * gate. Listed (those files hold many codes the credit ops can never reach),
 * and each is asserted to occur in its source, so a stale entry fails.
 */
const SHARED: Array<[string, string]> = [
  ['own_account', ADMIN_OPS],
  ['not_a_business_os_account', ADMIN_OPS],
  ['tenant_check_failed', ADMIN_OPS],
  ['plan_read_failed', ADMIN_OPS],
  ['plan_row_missing', ADMIN_OPS],
  ['invalid_body', POST_ROUTE],
  ['invalid_account_id', POST_ROUTE],
  ['Internal server error', POST_ROUTE],
  ['Unauthorized', GATE],
  ['Forbidden', GATE],
];

const ALL = [...new Set([...scanned, ...SHARED.map(([code]) => code)])];

describe('the credit refusals all have copy', () => {
  it('found the codes to check: at least the 13 credit-op codes of slice 11b, and the view route\'s', () => {
    const fromOps = codesIn(read(CREDIT_OPS));
    expect(fromOps.length).toBeGreaterThanOrEqual(13);
    expect(fromOps).toEqual(
      expect.arrayContaining([
        'platform_account',
        'credit_lots_unreadable',
        'payment_hold_check_failed',
        'awaiting_payment',
        'expires_at_in_past',
        'lot_write_failed',
        'idempotency_key_conflict',
        'lot_read_failed',
        'lot_not_found',
        'paid_credits_locked',
        'lot_expired',
        'nothing_left',
        'exceeds_remaining',
      ])
    );
    expect(codesIn(read(VIEW_ROUTE))).toEqual(
      expect.arrayContaining(['invalid_account_id', 'platform_account', 'tenant_check_failed', 'not_a_business_os_account', 'Internal server error'])
    );
  });

  it.each(SHARED)('the shared code %s still occurs in %s (no stale entry)', (code, file) => {
    expect(codesIn(read(file))).toContain(code);
  });

  it.each(ALL)('%s has a sentence, not a code', (code) => {
    const copy = CREDIT_ERROR_COPY[code];
    expect(copy).toBeDefined();
    expect(copy).not.toContain(code);
    expect(copy.length).toBeGreaterThan(20);
  });

  it('an unknown code gets the generic sentence, never the code', () => {
    expect(creditErrorSentence('some_new_code')).toBe(GENERIC_ERROR_COPY);
    expect(creditErrorSentence('unknown')).toBe(GENERIC_ERROR_COPY);
    expect(creditErrorSentence('constructor')).toBe(GENERIC_ERROR_COPY);
  });
});
