/**
 * A password change — and a change to your own security settings — is RECORDED,
 * not ALERTED. Sibling of paymentRefundSeverity.guard.test.ts and
 * paymentPlanCancelledSeverity.guard.test.ts, and the same defect shape.
 *
 * Both events were registered 'critical'. 'critical' is not a description of
 * what happened: it is the severity the admin Health "Critical audit events"
 * tile counts action-blind, and the severity the owner's own /monitoring page
 * reports as "N critical security event(s) detected. Immediate review
 * recommended." So a customer following security advice — change your password —
 * produced a platform alert about themselves.
 *
 * Three things have to hold together, and this guard pins all three, because any
 * one alone is defeated by the others:
 *
 *  1. Both events are registered 'warning', with their compliance flags intact.
 *     Fully auditable, fully flagged, simply not an incident.
 *  2. NO WRITER PASSES A SEVERITY OR FLAGS OF ITS OWN. AuditTrailService's
 *     buildLogEntry resolves `input.severity || metadata.severity`, so a
 *     caller's value wins. /api/user/change-password used to pass BOTH
 *     `severity: 'warning'` and `complianceFlags: ['SOC2']` — the second of
 *     which would have kept the route the owner of the classification and
 *     silently withheld the GDPR flag the registration grants.
 *  3. USER_PASSWORD_CHANGED is no longer browser-writable, so the registration
 *     cannot be bypassed by a signed-in customer POSTing the event at
 *     /api/audit/log. (The channel is the reason the severity mattered at all:
 *     the client write path takes severity from the registration, so any
 *     customer could mint `critical` rows in their own compliance log.)
 *
 * @see docs/workplans/security-audit-events-workplan.md
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { AUDIT_EVENTS, EVENT_METADATA, getEventMetadata } from '../events';
import { CLIENT_WRITABLE_EVENTS } from '../requestSchemas';

/**
 * The three values the audit_trail severity CHECK accepts, written out as
 * stepZeroRegistrations.test.ts and the plan-cancelled guard do. Deliberately
 * not imported: lib/audit/types.ts exports `AuditSeverity` as a type only.
 */
const ACCEPTED_SEVERITIES = ['info', 'warning', 'critical'];

const CHANGE_PASSWORD_ROUTE = join(process.cwd(), 'app', 'api', 'user', 'change-password', 'route.ts');
const SECURITY_TAB = join(process.cwd(), 'components', 'settings', 'SecurityTab.tsx');

/** Source with comments removed, so the explanation of this rule cannot satisfy it. */
function codeOf(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

/**
 * The individual `auditLog({ … })` calls in a file.
 *
 * Scoped per call rather than per file ON PURPOSE. The change-password route
 * also writes USER_PASSWORD_CHANGE_FAILED twice, and those two calls DO pass
 * their own `severity` and `complianceFlags` — because that action is a bare
 * string literal with no entry in AUDIT_EVENTS or EVENT_METADATA at all, so the
 * route is the only thing classifying it (its rows read "Unknown event:
 * USER_PASSWORD_CHANGE_FAILED"). That is a separate, unregistered-event defect,
 * recorded in the workplan and deliberately out of this slice. A file-wide
 * `not.toMatch(/severity:/)` would either fail on it or force it into scope.
 */
function auditCalls(code: string): string[] {
  return code
    .split('auditLog(')
    .slice(1)
    .map((chunk) => {
      const end = chunk.indexOf('}).catch');
      return end === -1 ? chunk : chunk.slice(0, end);
    });
}

const LOWERED = [
  ['USER_PASSWORD_CHANGED', AUDIT_EVENTS.USER_PASSWORD_CHANGED, ['SOC2', 'GDPR']],
  ['SETTINGS_SECURITY_UPDATED', AUDIT_EVENTS.SETTINGS_SECURITY_UPDATED, ['SOC2', 'GDPR']],
] as const;

describe('a password change is recorded, not alerted', () => {
  it.each(LOWERED)('%s is registered at warning', (_name, event) => {
    const meta = getEventMetadata(event);
    expect(meta.severity).toBe('warning');
    // The registration must actually exist rather than fall through
    // getEventMetadata's 'info' / "Unknown event" default.
    expect(EVENT_METADATA[event]).toBeDefined();
    expect(meta.description).not.toMatch(/^Unknown event/);
  });

  it.each(LOWERED)('%s keeps its compliance flags — the recording is not weakened', (_name, event, flags) => {
    expect(getEventMetadata(event).complianceFlags).toEqual([...flags]);
  });

  it.each(LOWERED)('%s is not the severity the admin health tile counts', (_name, event) => {
    expect(getEventMetadata(event).severity).not.toBe('critical');
  });

  it.each(LOWERED)('%s is registered at a severity the audit_trail CHECK accepts', (_name, event) => {
    expect(ACCEPTED_SEVERITIES).toContain(getEventMetadata(event).severity);
  });

  it.each(LOWERED)('%s is in the event catalogue, so it can be filtered and classified', (name) => {
    expect(Object.values(AUDIT_EVENTS)).toContain(name);
  });

  it('both carry the same severity as the refund they are now consistent with', () => {
    const refund = getEventMetadata(AUDIT_EVENTS.PAYMENT_REFUNDED);
    for (const [, event] of LOWERED) {
      expect(getEventMetadata(event).severity).toBe(refund.severity);
    }
  });
});

describe('the registration is the single owner of the classification', () => {
  it('the change-password route writes the event and overrides neither severity nor flags', () => {
    const code = codeOf(CHANGE_PASSWORD_ROUTE);
    // The route audits the success exactly once: there is a single success path.
    expect(code.match(/action:\s*AUDIT_EVENTS\.USER_PASSWORD_CHANGED/g)).toHaveLength(1);

    const written = auditCalls(code).filter((call) => /AUDIT_EVENTS\.USER_PASSWORD_CHANGED/.test(call));
    expect(written).toHaveLength(1);
    expect(written[0]).not.toMatch(/severity\s*:/);
    expect(written[0]).not.toMatch(/complianceFlags\s*:/);
  });

  it('the V1 security tab sends neither key either (both were silently dropped)', () => {
    const code = codeOf(SECURITY_TAB);
    expect(code).toMatch(/action:\s*'SETTINGS_SECURITY_UPDATED'/);
    expect(code).not.toMatch(/severity\s*:/);
    expect(code).not.toMatch(/complianceFlags\s*:/);
  });
});

describe('the browser cannot write a password change at all (D-3)', () => {
  it('USER_PASSWORD_CHANGED is off the browser allow-list', () => {
    // Without this, a signed-in customer could POST the event to /api/audit/log
    // and write into their own compliance log at will — and the severity would
    // come from the registration, so the only reason it was not a critical-row
    // generator is this file's first assertion.
    expect(CLIENT_WRITABLE_EVENTS).not.toContain(AUDIT_EVENTS.USER_PASSWORD_CHANGED);
  });

  it('SETTINGS_SECURITY_UPDATED stays on it — unreachable writer, decision not taken', () => {
    // Deliberately NOT justified as "the V1 tab still writes it". The write
    // exists (SecurityTab.tsx:93) but its containing function
    // `handleSecuritySettingsSave` (:50) is referenced nowhere, so nothing can
    // reach it. The event keeps its place because removing an event from an
    // accepted-input list is its own decision, and this slice did not take it.
    expect(CLIENT_WRITABLE_EVENTS).toContain(AUDIT_EVENTS.SETTINGS_SECURITY_UPDATED);
  });
});
