/**
 * The audit event audience map (admin reorganisation slice 2c, SA C-11).
 *
 * The load-bearing assertions:
 *   - every registered event has exactly one audience, and no entry names an
 *     event that is not registered — so a new event cannot be hidden or shown
 *     without somebody deciding;
 *   - the 15 / 58 / 84 split is pinned, so any reclassification is a visible diff;
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

  it('pins the split: 15 Business OS, 58 shared, 84 AgentsPilot', () => {
    expect(registered).toHaveLength(157);
    expect(eventsTagged('bos')).toHaveLength(15);
    expect(eventsTagged('shared')).toHaveLength(58);
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
