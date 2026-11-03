/**
 * An inert stand-in for `@/lib/services/AuditTrailService`.
 *
 * WHY THIS EXISTS
 *
 * The audit write is mandated non-blocking (CLAUDE.md § Audit Trail): callers
 * chain `.catch(...)` and never look at the result. So in a route test the real
 * service's write LEFT THE MACHINE and nobody could tell — 16 suites were
 * posting to `audit_trail` at the placeholder Supabase URL, failing, and
 * passing. `tests/jest-no-network.ts` now refuses the socket, but the call is
 * still made, which is why those suites must stub the seam instead.
 *
 * `AuditTrailService` builds its own client with `createClient`, NOT through
 * `@/lib/supabaseServer`, so `jest.mock('@/lib/supabaseServer', ...)` does not
 * stop it. One suite here had that mock already and still reached the network.
 *
 * Every export of the real module is reproduced, so a suite does not have to
 * know which entry point the code under test uses — `AuditTrailService`,
 * the `AuditTrail` singleton, or the `auditLog` / `auditQuery` / `auditFlush`
 * helpers all resolve to the same inert recorder.
 *
 * A suite that ASSERTS on audit behaviour should not use this: mock the module
 * with its own `jest.fn()`s and assert on those. This is for the suites that
 * never meant to touch audit at all.
 *
 * Usage, at the top level of a suite:
 *
 *     jest.mock('@/lib/services/AuditTrailService', () =>
 *       require('@/tests/helpers/silentAuditTrail'));
 *
 * Lives outside `__tests__` so Jest does not collect it as a suite.
 */

/** Kept so `instanceof` and imports of the name still resolve. */
export class ErasureIncompleteError extends Error {}

const inert = {
  log: async () => undefined,
  writeNow: async () => ({ written: true }),
  flush: async () => undefined,
  query: async () => ({ entries: [], total: 0, hasMore: false }),
  exportUserData: async () => ({}),
  anonymizeUserData: async () => undefined,
  shutdown: async () => undefined,
};

export const AuditTrail = inert;
export const AuditTrailService = { getInstance: () => inert };
export const auditLog = inert.log;
export const auditQuery = inert.query;
export const auditFlush = inert.flush;
