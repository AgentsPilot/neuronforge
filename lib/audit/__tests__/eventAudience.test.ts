/**
 * The audit event audience map (admin reorganisation slice 2c, SA C-11).
 *
 * The load-bearing assertions:
 *   - every registered event has exactly one audience, and no entry names an
 *     event that is not registered — so a new event cannot be hidden or shown
 *     without somebody deciding;
 *   - the 15 / 61 / 84 split is pinned, so any reclassification is a visible diff;
 *   - an untagged event is visible, which is what actually protects production
 *     (no CI job runs this suite).
 */

import { AUDIT_EVENTS } from '../events';
import {
  AUDIT_EVENT_AUDIENCE,
  OPERATOR_AUDIENCES,
  audienceOf,
  isVisibleTo,
  type AuditAudience,
} from '../eventAudience';

const registered: string[] = Object.values(AUDIT_EVENTS);
const tagged = AUDIT_EVENT_AUDIENCE as Readonly<Record<string, AuditAudience>>;

function eventsTagged(audience: AuditAudience): string[] {
  return Object.keys(tagged).filter((event) => tagged[event] === audience);
}

describe('AUDIT_EVENT_AUDIENCE is exhaustive over the catalogue', () => {
  it('tags every registered event (fails on an unclassified event)', () => {
    const untagged = registered.filter((event) => !(event in tagged));
    expect(untagged).toEqual([]);
  });

  it('tags nothing that is not registered (fails on a stale entry)', () => {
    const stale = Object.keys(tagged).filter((event) => !registered.includes(event));
    expect(stale).toEqual([]);
  });

  it('uses only the three audiences', () => {
    for (const audience of Object.values(tagged)) {
      expect(['bos', 'shared', 'agentspilot']).toContain(audience);
    }
  });

  // +2 Business OS (BOS_INVITE_CREATED, BOS_INVITE_REVOKED): invite-only signup, Slice 0.
  // +1 Business OS (BOS_INVITE_OPENED_BY_EXISTING_ACCOUNT): invite-only signup, Slice 1a.
  // +4 Business OS (BOS_INVITE_REDEEMED, _PLAN_PROVISIONED, _REDEMPTION_REFUSED, _REDEMPTION_INCOMPLETE): Slice 1b.
  // +2 Business OS (BOS_INVITE_EMAIL_SENT, BOS_INVITE_EMAIL_NOT_SENT): Slice 2a.
  // +3 Business OS (BOS_FRIEND_INVITE_CREATED, _REVOKED, _REFUSED): Slice 5a.
  // +1 Business OS (PAYMENT_PLAN_CANCELLED): registered so its severity has one
  //    owner; it was written only by its call site, hence "Unknown event" rows.
  // +2 Business OS (BOS_CREDIT_LOT_GRANTED, BOS_CREDIT_LOT_REDUCED): credit deduction slice 11b.
  // +1 Business OS (BOS_CREDIT_LOW_LINE_CROSSED): credit deduction slice 8b.
  // +1 Business OS (BOS_QUEUE_DRAIN_STARTED): ADMIN_BOS_CLEANUP slice 7d, Drain now.
  // +1 Business OS (BOS_QUEUE_ITEM_CANCELLED): ADMIN_BOS_CLEANUP slice 7b, cancel one queue item (2026-10-04).
  // +1 Business OS (BUSINESS_DELETION_PREVIEWED): admin delete AD-1b, read-only deletion preview (2026-10-04).
  // +2 Business OS (BOS_INVITE_INVITER_NOTIFIED, _NOT_NOTIFIED): invite N-1, the inviter told (2026-10-05).
  // +1 Business OS (BOS_QUEUE_ITEM_RETRIED): ADMIN_BOS_CLEANUP slice 7c, retry one queue item (2026-10-04).
  // +1 Business OS (BUSINESS_DELETION_STARTED): admin delete AD-2a, the confirmed write-ahead row (2026-10-06).
  // +1 Business OS (BUSINESS_TEST_ACCOUNT_REMOVED): operator test-account cleanup, OX-1 (2026-10-06).
  // +1 Business OS (BOS_BOOST_CHECKOUT_STARTED): credits boost slice 3, the boost checkout (2026-10-06).
  // +1 Business OS (BOS_BILLING_CHECKOUT_STARTED): plan payments P-3a, an owner opened a plan checkout (2026-10-07).
  // +1 Business OS (BUSINESS_TEST_ACCOUNT_REMOVAL_REFUSED): admin Danger Zone cleanup, OX-1r (2026-10-07).
  // +2 Business OS (BOS_BILLING_INVOICE_PAID, BOS_BILLING_PAYMENT_REFUSED): plan payments P-3b.1, registered ahead of the webhook (2026-10-07).
  // +3 Business OS (BOS_BOOST_CREDITED, _PAYMENT_FAILED, _FLAGGED): credits boost slice 4a, the webhook (2026-10-07).
  // +1 Business OS (BOS_BOOST_PAYMENT_REVERSED): credits boost slice 4b.1, refunds and disputes (2026-10-08).
  // +1 Business OS (BOS_BOOST_RECONCILE_TRIGGERED): credits boost slice 4b.2, the admin reconcile trigger (2026-10-09).
  // +2 Business OS (BOS_BOOST_CAP_OVERRIDE_SET, _ENDED): credits boost slice 6b, the admin spending limit (2026-10-10).
  // +1 Business OS (BOS_BILLING_FIRST_PAYMENT_STAMPED): plan payments P-5a.1, the first payment stamp (2026-10-11).
  // +1 Business OS (BOS_TEST_CREDITS_TAKEN): test harness take credits, slice TC-1 (2026-10-11).
  // +1 Business OS (BOS_BILLING_UPGRADE_REQUESTED): plan payments P-7b.1a, an owner confirmed an upgrade (2026-10-13).
  // +1 shared (AI_PRICE_MANUAL_ENTRY): AI model price review slice 3, a pending price entered by hand (2026-10-14).
  // +1 Business OS (BOS_BILLING_TEST_CLOCK_ATTACHED): plan payments P-6a.1, the test-mode test clock attach (2026-10-15).
  // +1 shared (AI_PRICE_FETCH_RUN): AI model price review slice 5, "Check provider prices" (2026-10-15).
  // +3 Business OS (BOS_BILLING_PAYMENT_FAILED, _PAYMENT_ACTION_REQUIRED, _SUBSCRIPTION_ENDED): plan payments P-6a.2, renewal failures and the end (2026-10-15).
  // +6 shared (DATA_EXPORT_REQUESTED, _READY, _FAILED, _DOWNLOADED, _EXPIRED, _DOWNLOADED_BY_ADMIN): data export DE-8a, names only (2026-10-17).
  // +3 shared (AI_PRICING_APPLIED_LINE, AI_PRICE_LINE_DISMISSED, AI_PRICE_MARGIN_REVIEW_DONE): AI model price review slice 8, Apply and Dismiss (2026-10-17).
  // +2 Business OS (ACCOUNT_PSEUDONYMISED, ACCOUNT_DELETION_REFUSED): data export DE-10b.1, close and anonymise (2026-10-18).
  // +2 shared (EXCHANGE_RATE_UPDATED, EXCHANGE_RATE_ENABLED_CHANGED): Admin Exchange Rates slice 1a, SA O-6 (2026-10-19).
  it('pins the split: 60 Business OS, 74 shared, 84 AgentsPilot', () => {
    expect(registered).toHaveLength(218);
    expect(eventsTagged('bos')).toHaveLength(60);
    expect(eventsTagged('shared')).toHaveLength(74);
    expect(eventsTagged('agentspilot')).toHaveLength(84);
  });
});

describe('specific tags', () => {
  it.each([
    [AUDIT_EVENTS.BUSINESS_AI_ACTION_FAILED, 'bos'],
    [AUDIT_EVENTS.BUSINESS_AI_ACTION_COMPLETED, 'bos'],
    [AUDIT_EVENTS.BOS_ENTITLEMENT_TIER_ASSIGNED, 'bos'],
    [AUDIT_EVENTS.PAYMENT_REFUNDED, 'bos'],
    [AUDIT_EVENTS.USER_LOGIN, 'shared'],
    [AUDIT_EVENTS.ADMIN_ACTION, 'shared'],
    [AUDIT_EVENTS.SUBSCRIPTION_CANCELED, 'shared'],
    [AUDIT_EVENTS.AI_PRICING_ZERO_SET, 'shared'],
    // Borderline tags confirmed by the user, 2026-09-25.
    [AUDIT_EVENTS.PLUGIN_AUTH_FAILED, 'shared'],
    [AUDIT_EVENTS.PLUGIN_TESTER_EXECUTE, 'shared'],
    [AUDIT_EVENTS.USER_ONBOARDING_COMPLETED, 'shared'],
    [AUDIT_EVENTS.BOOST_PACK_CHECKOUT_INITIATED, 'shared'],
    [AUDIT_EVENTS.EFFORT_ESTIMATE_GENERATED, 'agentspilot'],
    [AUDIT_EVENTS.AGENT_CREATED, 'agentspilot'],
    [AUDIT_EVENTS.USER_MEMORY_SAVED, 'agentspilot'],
  ])('%s is %s', (event, audience) => {
    expect(audienceOf(event)).toBe(audience);
  });
});

describe('isVisibleTo', () => {
  it('keeps an untagged (unregistered) event visible', () => {
    expect(audienceOf('ZZZTEST_SOMETHING_HAPPENED')).toBeUndefined();
    expect(isVisibleTo('ZZZTEST_SOMETHING_HAPPENED', OPERATOR_AUDIENCES)).toBe(true);
  });

  it('shows Business OS and shared events to the operator, hides AgentsPilot ones', () => {
    expect(isVisibleTo(AUDIT_EVENTS.BUSINESS_AI_ACTION_FAILED, OPERATOR_AUDIENCES)).toBe(true);
    expect(isVisibleTo(AUDIT_EVENTS.USER_LOGIN, OPERATOR_AUDIENCES)).toBe(true);
    expect(isVisibleTo(AUDIT_EVENTS.AGENT_CREATED, OPERATOR_AUDIENCES)).toBe(false);
  });
});
