// lib/audit/auditTimeouts.ts
//
// The audit write budget, in a ZERO-IMPORT module (admin delete AD-2a).
//
// `boundedAuditFlush.ts` imports `AuditTrailService`, and
// `AuditTrailService.writeNow` reuses the same budget (SA AC2-3). Defining the
// constant here, rather than importing it from `boundedAuditFlush.ts`, keeps
// the two modules from importing each other. `boundedAuditFlush.ts` re-exports
// it, so every existing import keeps working.

/**
 * How long a request waits for an audit write. Bounded, so a slow database
 * delays a response but can never hold one open.
 */
export const AUDIT_FLUSH_TIMEOUT_MS = 2000;
