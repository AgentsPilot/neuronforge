/**
 * planPaymentNotice (plan payments P-6a.2; workplan §5.6; SA C-1 ruling, Q-5,
 * C-13): every row of the predicate's table, the one answer the banner and
 * Settings → Plan both render.
 */

import fs from 'fs';
import path from 'path';

import {
  CONFIRM_URL_PREFIX,
  planPaymentNotice,
  type PaymentNoticeBillingFacts,
} from '@/lib/business-os/billing/planPaymentNotice';
import { HOSTED_INVOICE_URL_PREFIX } from '@/lib/repositories/BusinessOsBillingAccountRepository';

const TIER = 'tier_probe';
const FAILED_AT = '2026-10-15T07:05:55.000Z';
const DUE = '2027-01-15T07:05:22.000Z';
const ENDED = '2027-02-01T00:00:00.000Z';
const GRACE_END = '2027-01-21T07:05:22.000Z';
const URL = 'https://invoice.stripe.com/i/acct_probe/test_notice?s=ap';

function row(overrides: Partial<PaymentNoticeBillingFacts> = {}): PaymentNoticeBillingFacts {
  return {
    livemode: false,
    subscriptionStatus: 'active',
    failedAttempts: 0,
    lastPaymentFailedAt: null,
    actionRequiredInvoiceUrl: null,
    endedAt: null,
    currentPeriodEnd: DUE,
    boughtTier: TIER,
    ...overrides,
  };
}

const ACTIVE = { state: 'active', graceEndsAt: null };
const GRACE = { state: 'grace', graceEndsAt: GRACE_END };
const PAUSED = { state: 'paused', graceEndsAt: GRACE_END };
const TEST = { serverLivemode: false, enforcing: false };
const ENFORCING = { serverLivemode: false, enforcing: true };

describe('planPaymentNotice', () => {
  it('no row, or a row of the other Stripe mode (PF-15) → null', () => {
    expect(planPaymentNotice(null, ACTIVE, TEST)).toBeNull();
    expect(planPaymentNotice(row({ subscriptionStatus: 'past_due', failedAttempts: 2 }), ACTIVE, { serverLivemode: true, enforcing: false })).toBeNull();
  });

  it('a healthy subscription → null (renewing is Settings\' own sentence)', () => {
    expect(planPaymentNotice(row(), ACTIVE, TEST)).toBeNull();
    expect(planPaymentNotice(row({ lastPaymentFailedAt: FAILED_AT }), ACTIVE, TEST)).toBeNull();
  });

  it('C-1: the column branch is failed_attempts > 0, never a date comparison', () => {
    // Recorded failure, status not moved yet (the status event not landed).
    expect(planPaymentNotice(row({ failedAttempts: 2, lastPaymentFailedAt: FAILED_AT }), ACTIVE, TEST)).toEqual({
      kind: 'payment_failed',
      tier: TIER,
      failedAt: FAILED_AT,
      attempts: 2,
      pauseBy: null,
    });
    // A real-time failure date long before the clock-time due date changes nothing.
    expect(planPaymentNotice(row({ failedAttempts: 1, lastPaymentFailedAt: '2020-01-01T00:00:00.000Z' }), ACTIVE, TEST)).toMatchObject({ kind: 'payment_failed' });
  });

  it.each(['past_due', 'unpaid'])('status %s alone opens it: one attempt, the due date as the date', (status) => {
    expect(planPaymentNotice(row({ subscriptionStatus: status }), ACTIVE, TEST)).toEqual({
      kind: 'payment_failed',
      tier: TIER,
      failedAt: DUE,
      attempts: 1,
      pauseBy: null,
    });
  });

  it('pauseBy is the lifecycle\'s own grace end, only while it reads grace', () => {
    expect(planPaymentNotice(row({ failedAttempts: 1, lastPaymentFailedAt: FAILED_AT }), GRACE, TEST)).toMatchObject({ kind: 'payment_failed', pauseBy: GRACE_END });
    expect(planPaymentNotice(row({ failedAttempts: 1 }), { state: 'unknown', graceEndsAt: GRACE_END }, TEST)).toMatchObject({ pauseBy: null });
  });

  it('Q-5: paused wording only when enforcing; before S-5 it keeps the payment wording', () => {
    expect(planPaymentNotice(row({ failedAttempts: 3, lastPaymentFailedAt: FAILED_AT }), PAUSED, TEST)).toMatchObject({ kind: 'payment_failed', pauseBy: null });
    expect(planPaymentNotice(row({ failedAttempts: 3, lastPaymentFailedAt: FAILED_AT }), PAUSED, ENFORCING)).toEqual({
      kind: 'paused',
      tier: TIER,
      failedAt: FAILED_AT,
      attempts: 3,
    });
  });

  it('action_required needs an open failure AND a Stripe-hosted URL (re-checked here, C-13)', () => {
    expect(planPaymentNotice(row({ subscriptionStatus: 'past_due', failedAttempts: 1, lastPaymentFailedAt: FAILED_AT, actionRequiredInvoiceUrl: URL }), ACTIVE, TEST)).toEqual({
      kind: 'action_required',
      tier: TIER,
      failedAt: FAILED_AT,
      dueOn: DUE,
      confirmUrl: URL,
    });
    expect(planPaymentNotice(row({ failedAttempts: 1, actionRequiredInvoiceUrl: 'https://evil.example/pay' }), ACTIVE, TEST)).toMatchObject({ kind: 'payment_failed' });
    // A URL left over with no open failure says nothing.
    expect(planPaymentNotice(row({ actionRequiredInvoiceUrl: URL }), ACTIVE, TEST)).toBeNull();
    // It wins over paused, even when enforcing: the bank's question is the next step.
    expect(planPaymentNotice(row({ failedAttempts: 1, actionRequiredInvoiceUrl: URL }), PAUSED, ENFORCING)).toMatchObject({ kind: 'action_required' });
  });

  it('ended: shown while grace or paused; hidden when the lifecycle is anything else (a Founding Partner back on free access, AC-F6.5)', () => {
    const ended = row({ subscriptionStatus: 'canceled', endedAt: ENDED, failedAttempts: 9 });
    expect(planPaymentNotice(ended, PAUSED, TEST)).toEqual({ kind: 'ended', tier: TIER, endedAt: ENDED });
    expect(planPaymentNotice(ended, GRACE, TEST)).toEqual({ kind: 'ended', tier: TIER, endedAt: ENDED });
    expect(planPaymentNotice(ended, { state: 'champion', graceEndsAt: null }, TEST)).toBeNull();
    expect(planPaymentNotice(ended, ACTIVE, TEST)).toBeNull();
  });

  it('U-10: an upgrade failure leaves the status active and the columns untouched, so nothing is said', () => {
    expect(planPaymentNotice(row({ subscriptionStatus: 'active' }), GRACE, TEST)).toBeNull();
  });

  it('no bought tier → the tier is null (the banner uses the product name)', () => {
    expect(planPaymentNotice(row({ boughtTier: null, failedAttempts: 1 }), ACTIVE, TEST)).toMatchObject({ tier: null });
  });

  it('the confirm prefix is the billing repository\'s, and this file imports nothing', () => {
    expect(CONFIRM_URL_PREFIX).toBe(HOSTED_INVOICE_URL_PREFIX);
    const source = fs.readFileSync(path.join(process.cwd(), 'lib', 'business-os', 'billing', 'planPaymentNotice.ts'), 'utf8');
    expect(source).not.toMatch(/^\s*import\s/m);
  });
});
