/**
 * Layer 3 step 0, WC-12: the events and entity types registered so strict write
 * validation could be switched on must store exactly what their callers stored
 * before. Each expectation below is the literal severity and flags the caller
 * sent before step 0 (copied from the removed code, not from EVENT_METADATA).
 *
 * ── TWO ROWS DELIBERATELY SUPERSEDE THAT PREMISE (2026-10-01) ─────────────
 * SETTINGS_SECURITY_UPDATED and USER_PASSWORD_CHANGED were both 'critical'
 * because that is what their callers sent. The user decided the ALERTING was
 * wrong, not the recording: 'critical' is the severity the admin Health
 * "Critical audit events" tile counts and /monitoring shows as a security
 * incident, so a customer changing their own password raised an alarm. Both are
 * now registered 'warning', with their compliance flags untouched — the same
 * change as PAYMENT_REFUNDED (#157) and PAYMENT_PLAN_CANCELLED (#160).
 *
 * So for these two rows the expectation below is NOT "what the caller sent"; it
 * is the classification the registration now owns. Everything else in the table
 * still means what the header says.
 *
 * @see lib/audit/__tests__/passwordChangeSeverity.guard.test.ts
 */

import { AUDIT_EVENTS, EVENT_METADATA, getEventMetadata } from '../events';
import { AUDIT_ENTITY_TYPES, COMPLIANCE_FLAGS } from '../types';

const BEFORE_STEP_0: Array<[string, string, string[], string]> = [
  // Stripe routes (server-to-server HTTP calls, now in-process)
  ['SUBSCRIPTION_CHECKOUT_INITIATED', 'info', ['SOC2', 'FINANCIAL'], 'stripe/create-checkout (custom credits)'],
  ['BOOST_PACK_CHECKOUT_INITIATED', 'info', ['SOC2', 'FINANCIAL'], 'stripe/create-checkout (boost pack)'],
  ['SUBSCRIPTION_CANCELED', 'info', ['SOC2', 'FINANCIAL'], 'stripe/cancel-subscription'],
  ['SUBSCRIPTION_REACTIVATED', 'info', ['SOC2', 'FINANCIAL'], 'stripe/reactivate-subscription'],
  ['CUSTOMER_PORTAL_ACCESSED', 'info', ['SOC2'], 'stripe/create-portal'],
  // Browser callers whose severity and flags now come from metadata
  ['USER_LOGOUT', 'info', ['SOC2'], 'LogoutButton, business-os/settings'],
  ['USER_LOGIN', 'info', ['SOC2'], 'auth/callback'],
  ['PLUGIN_DISCONNECTED', 'warning', ['SOC2'], 'settings/PluginsTab'],
  // Superseded rows — see the header. 'warning', not the 'critical' their
  // callers sent, and the provenance corrected twice over:
  //
  //  - the password event: SecurityTabV2 deliberately stopped writing it and
  //    the V1 tab never did, so the only writer is the server route.
  //  - the settings event: the V1 tab holds the only write in the repo, but
  //    its containing function `handleSecuritySettingsSave`
  //    (SecurityTab.tsx:50) is referenced nowhere, so there is no reachable
  //    writer. The provenance below names where the code IS, not a caller
  //    that fires — which is why the severity drop on this row is
  //    write-forward over a path that never runs.
  ['SETTINGS_SECURITY_UPDATED', 'warning', ['SOC2', 'GDPR'], 'settings/SecurityTab (V1), unreachable'],
  ['USER_PASSWORD_CHANGED', 'warning', ['SOC2', 'GDPR'], '/api/user/change-password'],
];

describe('registered events store what their callers stored before step 0 (WC-12)', () => {
  it.each(BEFORE_STEP_0)('%s: %s %j (%s)', (event, severity, flags) => {
    expect(Object.values(AUDIT_EVENTS)).toContain(event);
    expect(EVENT_METADATA[event]).toBeDefined();
    expect(getEventMetadata(event).description).not.toMatch(/^Unknown event/);
    expect(getEventMetadata(event).severity).toBe(severity);
    expect(getEventMetadata(event).complianceFlags).toEqual(flags);
  });

  it("registers USER_DATA_EXPORTED at a severity the table accepts (the caller's 'medium' failed the severity CHECK)", () => {
    const meta = getEventMetadata(AUDIT_EVENTS.USER_DATA_EXPORTED);
    expect(['info', 'warning', 'critical']).toContain(meta.severity);
    expect(meta.complianceFlags).toEqual(['GDPR', 'CCPA']);
  });

  it('registers the Stripe entity types and the FINANCIAL flag', () => {
    expect(AUDIT_ENTITY_TYPES).toEqual(expect.arrayContaining(['subscription', 'boost_pack']));
    expect(COMPLIANCE_FLAGS).toContain('FINANCIAL');
  });

  // Layer 3 step 2 registers them (server-written only; see auditRoutes.test.ts
  // for the browser rejection). Step 0's registrations are unaffected.
  it('registers the AI audit entity type and exactly its two events (Layer 3 step 2)', () => {
    expect(AUDIT_ENTITY_TYPES).toContain('ai_action');
    expect(Object.values(AUDIT_EVENTS).filter((e) => e.startsWith('BUSINESS_AI_ACTION_')).sort()).toEqual([
      'BUSINESS_AI_ACTION_COMPLETED',
      'BUSINESS_AI_ACTION_FAILED',
    ]);
  });

  it('every registered severity is one the table accepts', () => {
    for (const [event, meta] of Object.entries(EVENT_METADATA)) {
      expect([event, ['info', 'warning', 'critical'].includes(meta.severity)]).toEqual([event, true]);
    }
  });
});
