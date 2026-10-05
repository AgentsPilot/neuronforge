/**
 * A refund is a normal business operation, and must not raise an operational alert.
 *
 * Two things have to hold together, and this guard pins both, because either one
 * alone is defeated by the other:
 *
 *  1. PAYMENT_REFUNDED is registered 'warning' with the SOC2 flag, so it is fully
 *     auditable and compliance-flagged but is not counted by the admin health
 *     tile (app/api/admin/health-summary/route.ts counts `severity = 'critical'`
 *     rows action-blind) or shown as a security event on the owner's own
 *     /monitoring page.
 *  2. The refund route passes NO severity of its own. AuditTrailService's
 *     buildLogEntry resolves `input.severity || metadata.severity`, so a caller's
 *     value wins — which is exactly how the route and the registration came to
 *     disagree, both saying 'critical' for a while and neither being the one
 *     place to look. Registration is now the single source of truth.
 *
 * @see docs/workplans/audit-severity-normal-operations-workplan.md
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { AUDIT_EVENTS, EVENT_METADATA, getEventMetadata } from '../events';

/**
 * The three values the audit_trail severity CHECK accepts, written out as
 * stepZeroRegistrations.test.ts does. Deliberately not imported: lib/audit/types.ts
 * exports `AuditSeverity` as a type only, and adding a runtime array for one
 * assertion would be a new export for the test's convenience.
 */
const ACCEPTED_SEVERITIES = ['info', 'warning', 'critical'];

const REFUND_ROUTE = join(process.cwd(), 'app', 'api', 'payments', 'refunds', 'route.ts');

/** The route source with comments removed, so the explanation of this rule cannot satisfy it. */
function refundRouteCode(): string {
  return readFileSync(REFUND_ROUTE, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

describe('a refund is recorded, not alerted (PAYMENT_REFUNDED severity)', () => {
  it('is registered at warning with the SOC2 flag', () => {
    const meta = getEventMetadata(AUDIT_EVENTS.PAYMENT_REFUNDED);
    expect(meta.severity).toBe('warning');
    expect(meta.complianceFlags).toContain('SOC2');
    // The registration is what decides, so it must actually exist rather than
    // fall through getEventMetadata's 'info' / "Unknown event" default.
    expect(EVENT_METADATA[AUDIT_EVENTS.PAYMENT_REFUNDED]).toBeDefined();
    expect(meta.description).not.toMatch(/^Unknown event/);
  });

  it('is not the severity the admin health tile counts', () => {
    expect(getEventMetadata(AUDIT_EVENTS.PAYMENT_REFUNDED).severity).not.toBe('critical');
  });

  it('is registered at a severity the audit_trail CHECK accepts', () => {
    expect(ACCEPTED_SEVERITIES).toContain(getEventMetadata(AUDIT_EVENTS.PAYMENT_REFUNDED).severity);
  });

  it('the refund route writes both refund paths and overrides the severity on neither', () => {
    const code = refundRouteCode();
    // Both paths still audit: the single payment and the whole-booking group.
    expect(code.match(/action:\s*'PAYMENT_REFUNDED'/g)).toHaveLength(2);
    // And neither passes a severity. The file has no other use of the key, so
    // any `severity:` reaching this route is a caller override to review.
    expect(code).not.toMatch(/severity\s*:/);
  });
});
