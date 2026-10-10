/**
 * The admin view helpers of credit top-ups (credits boost slice 6a; SA C-4,
 * N-3; workplan §3.2): words for every status and every flag reason the boost
 * code can write, Stripe links from the row's own mode and anchored ids only,
 * and the field-by-field payload.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import {
  ADMIN_BOOST_FLAG_REASON_WORDS,
  ADMIN_BOOST_STATUS_WORDS,
  adminBoostFlagReasonWords,
  adminBoostStatusTone,
  adminBoostStatusWords,
  mergeNewestFirst,
  stripeDashboardUrl,
  toAdminBoostPurchaseRow,
} from '@/lib/business-os/boost/boostAdminView';
import { BOOST_FLAG_REASONS, BOOST_PURCHASE_STATUSES } from '@/lib/repositories/BusinessOsBoostPurchaseRepository';
import { purchaseRow } from '@/lib/business-os/boost/__fixtures__/boostWebhookFixtures';

const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8');

describe('status words', () => {
  it('every purchase status has words; "Chargeback lost" for dispute_lost', () => {
    for (const status of BOOST_PURCHASE_STATUSES) expect(ADMIN_BOOST_STATUS_WORDS[status]).toBeTruthy();
    expect(adminBoostStatusWords('dispute_lost')).toBe('Chargeback lost (payment reversed)');
    expect(adminBoostStatusWords('flagged_mismatch')).toBe('Needs review');
    expect(adminBoostStatusWords('something_new')).toBe('something_new');
  });

  it('tones: money in, reversed or contested, review, waiting, closed', () => {
    expect(adminBoostStatusTone('paid')).toBe('paid');
    for (const status of ['partially_refunded', 'refunded', 'disputed', 'dispute_lost']) expect(adminBoostStatusTone(status)).toBe('reversed');
    expect(adminBoostStatusTone('flagged_mismatch')).toBe('review');
    expect(adminBoostStatusTone('awaiting_payment')).toBe('waiting');
    expect(adminBoostStatusTone('expired')).toBe('closed');
  });
});

describe('flag reasons in words (2b SA N-3)', () => {
  /**
   * Every literal the boost code can store as `flag_reason`: 2b's credit
   * function, 4a's `flagRow`, and 4b.2's `finding` / `raceOrFinding` (a stuck
   * row is flagged with the finding's reason since 4b.2 CR-1), plus the two
   * `reconcile_<step>_<kind>` templates for the session step.
   */
  function writtenReasons(): string[] {
    const handler = read('lib/business-os/boost/boostWebhookHandler.ts');
    const pass = read('lib/business-os/boost/boostReconcilePass.ts');
    const literals = [
      ...[...handler.matchAll(/flagRow\('([a-z_:]+)'/g)].map((m) => m[1]),
      ...[...pass.matchAll(/finding\(\w+, '([a-z_:]+)'/g)].map((m) => m[1]),
      ...[...pass.matchAll(/raceOrFinding\(\s*\w+,\s*'([a-z_:]+)'/g)].map((m) => m[1]),
    ];
    const templates = ['reconcile_session_missing', 'reconcile_session_refused', 'transition_not_allowed:expired', 'transition_not_allowed:failed'];
    return [...new Set([...BOOST_FLAG_REASONS, ...literals, ...templates])];
  }

  it('the scan finds the writers (no dead scan)', () => {
    const reasons = writtenReasons();
    for (const known of ['session_unreadable', 'no_payment_required', 'reconcile_session_unreadable', 'paid_not_creditable']) expect(reasons).toContain(known);
  });

  it('every reason a stuck purchase can be flagged with has words', () => {
    // Findings on rows that are never flagged (disputed or paid rows, a failed SQL call) are audit-only.
    const auditOnly = new Set([
      'deterministic_failure',
      'reversal_unexpected',
      'reconcile_dispute_status',
      'reconcile_dispute_mismatch',
      'reconcile_dispute_id_missing',
      'reconcile_second_dispute',
      'reconcile_receipt_no_payment_intent',
      'dispute_unreadable',
      'dispute_id_unreadable',
    ]);
    const missing = writtenReasons().filter((code) => !auditOnly.has(code) && !ADMIN_BOOST_FLAG_REASON_WORDS[code]);
    expect(missing).toEqual([]);
  });

  it('an unknown code is shown raw; no code → null', () => {
    expect(adminBoostFlagReasonWords('a_new_code')).toBe('a_new_code');
    expect(adminBoostFlagReasonWords(null)).toBeNull();
    expect(adminBoostFlagReasonWords('amount_mismatch')).toBe('the amount paid does not match the package price');
  });
});

describe('SA C-4: Stripe dashboard links', () => {
  it('the row\'s own mode decides /test/ (a test-mode row read on a live key still links to the test dashboard)', () => {
    expect(stripeDashboardUrl('payment', 'pi_3Abc123', false)).toBe('https://dashboard.stripe.com/test/payments/pi_3Abc123');
    expect(stripeDashboardUrl('payment', 'pi_3Abc123', true)).toBe('https://dashboard.stripe.com/payments/pi_3Abc123');
    expect(stripeDashboardUrl('dispute', 'dp_1XyZ', false)).toBe('https://dashboard.stripe.com/test/disputes/dp_1XyZ');
    expect(stripeDashboardUrl('dispute', 'du_1XyZ', true)).toBe('https://dashboard.stripe.com/disputes/du_1XyZ');
  });

  it.each([
    ['payment', null],
    ['payment', ''],
    ['payment', 'pi_'],
    ['payment', 'ch_3Abc'],
    ['payment', 'pi_abc/../../evil'],
    ['payment', 'pi_abc?x=1'],
    ['payment', 'pi_ab c'],
    ['payment', 'javascript:alert(1)'],
    ['payment', 'xpi_abc'],
    ['payment', 'pi_abc\n'],
    ['dispute', 'pi_3Abc123'],
    ['dispute', 'dp_x#y'],
  ] as const)('%s %p → no link (plain text)', (kind, id) => {
    expect(stripeDashboardUrl(kind, id, true)).toBeNull();
  });
});

describe('money and the payload', () => {
  it('SA CR-1: has no money formatter of its own (no typed "/ 100"); the block uses lib/business-os/currency.ts', () => {
    const code = read('lib/business-os/boost/boostAdminView.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(code).not.toMatch(/\/\s*100\b|Intl\.NumberFormat|formatMinorAmount/);
    const block = read('app/admin/users/components/BoostBlock.tsx');
    expect(block).toMatch(/import \{ formatMinorAmount \} from '@\/lib\/business-os\/currency'/);
    expect(block).not.toMatch(/\/\s*100\b/);
  });

  it('builds a row field by field: ids only for Stripe, no receipt link, no account', () => {
    const row = toAdminBoostPurchaseRow(purchaseRow({ status: 'flagged_mismatch', flagReason: 'no_session', receiptUrl: 'https://pay.stripe.com/r' }));
    expect(row).not.toHaveProperty('accountId');
    expect(row).not.toHaveProperty('receiptUrl');
    expect(JSON.stringify(row)).not.toContain('pay.stripe.com');
    expect(row).toMatchObject({ status: 'flagged_mismatch', flagReason: 'no_session' });
  });

  it('merges both modes newest first', () => {
    const merged = mergeNewestFirst(
      [purchaseRow({ id: 'a', createdAt: '2026-10-01T00:00:00.000Z' }), purchaseRow({ id: 'c', createdAt: '2026-10-03T00:00:00.000Z' })],
      [purchaseRow({ id: 'b', livemode: true, createdAt: '2026-10-02T00:00:00.000Z' })]
    );
    expect(merged.map((row) => row.id)).toEqual(['c', 'b', 'a']);
  });

  it('the module is pure: no server import (the client block uses it)', () => {
    const code = read('lib/business-os/boost/boostAdminView.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(code).not.toMatch(/server-only|supabaseServer|@\/lib\/logger/);
    for (const match of code.matchAll(/^import (?!type )/gm)) throw new Error(`value import found at ${match.index}`);
  });
});
