/**
 * AM-7 coverage pin (plan payments P-8a.3, AC-AM.4; workplan §5.6 T9).
 *
 * The requirement (§7 AM-7) lists the money events that must each write an
 * audit entry. This pin maps every one to its registered `AUDIT_EVENTS` key and
 * to the source file that emits it, read in CODE (comments stripped), so an
 * emitter that stops naming its event fails here.
 *
 * The events whose slice is not built yet are listed with their owner. No
 * `BOS_BILLING_*` key for them may appear unannounced: when P-6b, P-7a or
 * P-7b.2 registers one, this test fails until the map below names its emitter.
 *
 * It reads files only and writes nothing (no CI time beyond the Jest job).
 */

import * as fs from 'fs';
import * as path from 'path';

import { AUDIT_EVENTS, EVENT_METADATA } from '@/lib/audit/events';

const ROOT = process.cwd();

const codeOf = (file: string) =>
  fs
    .readFileSync(path.join(ROOT, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

/** AM-7's built events: the requirement's words → the key → who writes it. */
const BUILT: ReadonlyArray<{ am7: string; key: keyof typeof AUDIT_EVENTS; emitter: string }> = [
  { am7: 'Checkout started', key: 'BOS_BILLING_CHECKOUT_STARTED', emitter: 'app/api/business-os/billing/plan/checkout/route.ts' },
  // "Paid", "plan assigned" and "upgraded" (the paid upgrade invoice carries its billingReason).
  { am7: 'Paid / plan assigned / upgraded', key: 'BOS_BILLING_INVOICE_PAID', emitter: 'lib/business-os/billing/planPaymentApply.ts' },
  { am7: 'Upgrade requested', key: 'BOS_BILLING_UPGRADE_REQUESTED', emitter: 'app/api/business-os/billing/plan/upgrade/route.ts' },
  { am7: 'Failed', key: 'BOS_BILLING_PAYMENT_FAILED', emitter: 'lib/business-os/billing/planPaymentApply.ts' },
  { am7: 'Failed (3-D Secure renewal)', key: 'BOS_BILLING_PAYMENT_ACTION_REQUIRED', emitter: 'lib/business-os/billing/planPaymentApply.ts' },
  { am7: 'Payment refused (mismatch)', key: 'BOS_BILLING_PAYMENT_REFUSED', emitter: 'lib/business-os/billing/planPaymentApply.ts' },
  { am7: 'First payment stamped', key: 'BOS_BILLING_FIRST_PAYMENT_STAMPED', emitter: 'lib/business-os/billing/planPaymentApply.ts' },
  { am7: 'Ended', key: 'BOS_BILLING_SUBSCRIPTION_ENDED', emitter: 'lib/business-os/billing/planSubscriptionMirror.ts' },
  // P-7a.1 (workplan §4.9): the owner's own cancel and reactivate, from Settings → Plan.
  { am7: 'Cancelled', key: 'BOS_BILLING_SUBSCRIPTION_CANCELLED', emitter: 'app/api/business-os/billing/plan/cancel/route.ts' },
  { am7: 'Reactivated', key: 'BOS_BILLING_SUBSCRIPTION_REACTIVATED', emitter: 'app/api/business-os/billing/plan/reactivate/route.ts' },
  // "Admin override on a subscribed account": both entries carry `subscribed` (T10, SA Q-7).
  { am7: 'Admin override on a subscribed account (tier)', key: 'BOS_ENTITLEMENT_TIER_ASSIGNED', emitter: 'lib/business-os/entitlements/adminOps.ts' },
  { am7: 'Admin override on a subscribed account (override)', key: 'BOS_ENTITLEMENT_OVERRIDE_ADDED', emitter: 'lib/business-os/entitlements/adminOps.ts' },
];

/** AM-7 events not built yet, and the slice that owns each. */
const NOT_BUILT: ReadonlyArray<{ am7: string; owner: string; keyPattern: RegExp }> = [
  { am7: 'Downgrade scheduled', owner: 'P-7b.2', keyPattern: /^BOS_BILLING_.*DOWNGRADE/ },
  { am7: 'Refund flagged', owner: 'P-6b', keyPattern: /^BOS_BILLING_.*REFUND/ },
  { am7: 'Dispute flagged', owner: 'P-6b', keyPattern: /^BOS_BILLING_.*DISPUTE/ },
];

describe('AM-7: every built money event is registered and emitted (AC-AM.4)', () => {
  it.each(BUILT.map((row) => [row.am7, row.key, row.emitter] as const))('%s → %s, written by %s', (_am7, key, emitter) => {
    expect(AUDIT_EVENTS[key]).toBe(key);
    // The billing events are classified in the registry (severity and flags, never at the call site).
    // The two entitlement events predate that rule: the admin route passes 'warning' itself, and
    // giving them metadata would change their stored classification, which is not this slice's.
    if (key.startsWith('BOS_BILLING_')) expect(EVENT_METADATA[key]).toBeDefined();
    expect(fs.existsSync(path.join(ROOT, emitter))).toBe(true);
    expect(codeOf(emitter)).toMatch(new RegExp(`\\b${key}\\b`));
  });

  it('the code-only reader ignores a comment (planted control)', () => {
    const planted = '// BOS_BILLING_CHECKOUT_STARTED\n/* BOS_BILLING_INVOICE_PAID */\nconst x = 1;';
    const stripped = planted.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(stripped).not.toMatch(/BOS_BILLING_/);
  });

  it('T10: assign_tier and add_override both put `subscribed` in their audit details', () => {
    const ops = codeOf('lib/business-os/entitlements/adminOps.ts');
    expect(ops.match(/auditDetails: \{ subscribed/g)).toHaveLength(2);
    expect(codeOf('app/api/admin/business-os/entitlements/accounts/[accountId]/route.ts')).toMatch(
      /\.\.\.\(outcome\.auditDetails \?\? \{\}\)/
    );
  });
});

describe('AM-7: events not built yet are owned, and not registered unannounced', () => {
  const keys = Object.keys(AUDIT_EVENTS);

  it.each(NOT_BUILT.map((row) => [row.am7, row.owner, row.keyPattern] as const))(
    '%s (owner %s): no key yet; adding one must add it to BUILT',
    (_am7, _owner, pattern) => {
      expect(keys.filter((key) => pattern.test(key))).toEqual([]);
    }
  );

  it('every BOS_BILLING_* key is either an AM-7 event above or a known non-money event', () => {
    // Not money events: the TEST MODE ONLY test clock (P-6a.1).
    const NON_MONEY = ['BOS_BILLING_TEST_CLOCK_ATTACHED'];
    const mapped = new Set<string>([...BUILT.map((row) => row.key), ...NON_MONEY]);
    expect(keys.filter((key) => key.startsWith('BOS_BILLING_') && !mapped.has(key))).toEqual([]);
  });
});
