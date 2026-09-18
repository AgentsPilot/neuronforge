/**
 * The platform account: where an AI call's usage lands when it has no valid
 * business account.
 *
 * ONE place for one rule. It used to be written out as
 * `process.env.SYSTEM_ADMIN_USER_ID || '00000000-…'` in four files, which could
 * drift apart. Read at call time, not module scope, so a late-loading
 * environment still applies.
 *
 * IMPORTS NOTHING, ON PURPOSE. `scripts/typecheck-bos-llm.ts` puts every file
 * that imports the call catalog, AND every file that imports one of those, into
 * its gate. The catalog imports this module and never the reverse, so the
 * tracker, EmbeddingService and IntentClassifier can use it without being
 * dragged — with all their importers — into that gate.
 *
 * Two notions of "platform account" exist, deliberately:
 *   - `platformAccountId()` here: the raw env value, or the all-zero id. This is
 *     what the tracker writes, verbatim, when a call has no valid account.
 *   - `platformAccountIds()` / `isPlatformAccountEnvIgnored()` in
 *     lib/business-os/llm/callCatalog.ts: the ids to QUERY for, which include
 *     the env value only when it is a UUID (a non-UUID in an `in(...)` filter
 *     would make every such query fail).
 * The difference is pinned by a test (lib/__tests__/platformAccount.test.ts).
 *
 * NOT the rule in lib/services/AuditTrailService.ts, which falls back to
 * `null`, not to the all-zero id. Converting that one would change behaviour.
 *
 * @module lib/platformAccount
 */

/** The account used when `SYSTEM_ADMIN_USER_ID` is not set. */
export const ALL_ZERO_UUID = '00000000-0000-0000-0000-000000000000';

/** The platform account id: `SYSTEM_ADMIN_USER_ID`, or the all-zero id when unset. */
export function platformAccountId(): string {
  return process.env.SYSTEM_ADMIN_USER_ID || ALL_ZERO_UUID;
}
