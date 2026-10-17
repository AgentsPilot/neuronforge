/**
 * Data export audit severities (DE-8a, SA Q-9 / C-6, business call B-2).
 *
 * Critical feeds the Health "Critical audit events" tile and the 7-year
 * retention class. An owner's ordinary self-export must not raise that alarm,
 * so READY is info. An admin downloading a customer's data is the one rare,
 * high-impact act and is critical. The names are registered in DE-8a; the
 * emitters arrive in DE-8b, DE-9 and DE-10a, and must not pass a severity of
 * their own.
 */

import { AUDIT_EVENTS, EVENT_METADATA } from '../events';
import { AUDIT_EVENT_AUDIENCE } from '../eventAudience';

const EXPECTED = [
  ['DATA_EXPORT_REQUESTED', 'info', ['GDPR', 'SOC2']],
  ['DATA_EXPORT_READY', 'info', ['GDPR', 'SOC2']],
  ['DATA_EXPORT_FAILED', 'warning', ['GDPR']],
  ['DATA_EXPORT_DOWNLOADED', 'info', ['GDPR']],
  ['DATA_EXPORT_EXPIRED', 'info', ['GDPR']],
  ['DATA_EXPORT_DOWNLOADED_BY_ADMIN', 'critical', ['GDPR', 'SOC2']],
] as const;

describe('data export audit events (SA Q-9)', () => {
  it.each(EXPECTED)('%s is %s with %j, audience shared', (name, severity, flags) => {
    const event = AUDIT_EVENTS[name as keyof typeof AUDIT_EVENTS];
    expect(event).toBe(name);
    expect(EVENT_METADATA[event]?.severity).toBe(severity);
    expect([...(EVENT_METADATA[event]?.complianceFlags ?? [])]).toEqual([...flags]);
    expect(AUDIT_EVENT_AUDIENCE[event]).toBe('shared');
  });

  it('only the admin download is critical among the six', () => {
    const critical = EXPECTED.filter(([name]) => EVENT_METADATA[AUDIT_EVENTS[name as keyof typeof AUDIT_EVENTS]]?.severity === 'critical');
    expect(critical.map(([name]) => name)).toEqual(['DATA_EXPORT_DOWNLOADED_BY_ADMIN']);
  });

  it('there are exactly six DATA_EXPORT_ events', () => {
    expect(Object.keys(AUDIT_EVENTS).filter((key) => key.startsWith('DATA_EXPORT_')).sort()).toEqual(EXPECTED.map(([name]) => name).sort());
  });
});
