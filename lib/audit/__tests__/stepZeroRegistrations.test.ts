/**
 * Layer 3 step 0, WC-12: the events and entity types registered so strict write
 * validation could be switched on must store exactly what their callers stored
 * before. Each expectation below is the literal severity and flags the caller
 * sent before step 0 (copied from the removed code, not from EVENT_METADATA).
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
  ['SETTINGS_SECURITY_UPDATED', 'critical', ['SOC2', 'GDPR'], 'settings/SecurityTab'],
  ['USER_PASSWORD_CHANGED', 'critical', ['SOC2', 'GDPR'], 'SecurityTab, SecurityTabV2'],
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

  it('does not register the AI audit entity type or events yet (step 2)', () => {
    expect(AUDIT_ENTITY_TYPES).not.toContain('ai_action' as never);
    expect(Object.values(AUDIT_EVENTS).some((e) => e.startsWith('BUSINESS_AI_ACTION_'))).toBe(false);
  });

  it('every registered severity is one the table accepts', () => {
    for (const [event, meta] of Object.entries(EVENT_METADATA)) {
      expect([event, ['info', 'warning', 'critical'].includes(meta.severity)]).toEqual([event, true]);
    }
  });
});
