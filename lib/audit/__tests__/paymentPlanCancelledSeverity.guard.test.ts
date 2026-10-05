/**
 * Stopping a client's payment plan is a normal business operation, and must not
 * raise an operational alert. Sibling of paymentRefundSeverity.guard.test.ts.
 *
 * This event existed only at its call site: it had no entry in EVENT_METADATA, so
 * every row it wrote carried the description "Unknown event: …" and no compliance
 * flags, while its severity came from the route. Two things now have to hold
 * together, and this guard pins both, because either one alone is defeated by the
 * other:
 *
 *  1. PAYMENT_PLAN_CANCELLED is registered 'warning' with the SOC2 flag, so it is
 *     fully auditable and compliance-flagged but is not counted by the admin
 *     health tile (app/api/admin/health-summary/route.ts counts `severity =
 *     'critical'` rows action-blind) or shown as a security event on the owner's
 *     own /monitoring page.
 *  2. The cancel route passes NO severity of its own. AuditTrailService's
 *     buildLogEntry resolves `input.severity || metadata.severity`, so a caller's
 *     value wins. The route used to pass 'critical' explicitly, with a comment
 *     saying it was matched to the refund on purpose — which is exactly how it
 *     came to contradict the refund once that moved to 'warning'. Registration is
 *     now the single source of truth.
 *
 * @see docs/workplans/payment-plan-cancelled-severity-workplan.md
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

const CANCEL_ROUTE = join(
  process.cwd(),
  'app',
  'api',
  'payments',
  'plans',
  '[id]',
  'cancel',
  'route.ts'
);

/** The route source with comments removed, so the explanation of this rule cannot satisfy it. */
function cancelRouteCode(): string {
  return readFileSync(CANCEL_ROUTE, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

describe("a cancelled plan is recorded, not alerted (PAYMENT_PLAN_CANCELLED severity)", () => {
  it('is registered at warning with the SOC2 flag', () => {
    const meta = getEventMetadata(AUDIT_EVENTS.PAYMENT_PLAN_CANCELLED);
    expect(meta.severity).toBe('warning');
    expect(meta.complianceFlags).toContain('SOC2');
    // The registration is what decides, so it must actually exist rather than
    // fall through getEventMetadata's 'info' / "Unknown event" default — which is
    // what this event did before this change.
    expect(EVENT_METADATA[AUDIT_EVENTS.PAYMENT_PLAN_CANCELLED]).toBeDefined();
    expect(meta.description).not.toMatch(/^Unknown event/);
  });

  it('is in the event catalogue, so it can be filtered and classified', () => {
    expect(Object.values(AUDIT_EVENTS)).toContain('PAYMENT_PLAN_CANCELLED');
  });

  it('is not the severity the admin health tile counts', () => {
    expect(getEventMetadata(AUDIT_EVENTS.PAYMENT_PLAN_CANCELLED).severity).not.toBe('critical');
  });

  it('is registered at a severity the audit_trail CHECK accepts', () => {
    expect(ACCEPTED_SEVERITIES).toContain(
      getEventMetadata(AUDIT_EVENTS.PAYMENT_PLAN_CANCELLED).severity
    );
  });

  it('carries the same severity and flags as the refund it was matched to', () => {
    const plan = getEventMetadata(AUDIT_EVENTS.PAYMENT_PLAN_CANCELLED);
    const refund = getEventMetadata(AUDIT_EVENTS.PAYMENT_REFUNDED);
    // The defect this fixes was the two disagreeing. Pinning them equal means a
    // future change to one that forgets the other fails here.
    expect(plan.severity).toBe(refund.severity);
    expect(plan.complianceFlags).toEqual(refund.complianceFlags);
  });

  it('the cancel route still writes the event and overrides the severity on nothing', () => {
    const code = cancelRouteCode();
    // The route audits exactly once: there is a single cancellation path.
    expect(code.match(/action:\s*'PAYMENT_PLAN_CANCELLED'/g)).toHaveLength(1);
    // And it passes no severity. The file has no other use of the key, so any
    // `severity:` reaching this route is a caller override to review.
    expect(code).not.toMatch(/severity\s*:/);
  });
});
