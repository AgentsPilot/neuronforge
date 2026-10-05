/**
 * The one parser for the `ADMIN_EMAILS` environment setting in app code.
 *
 * Moved verbatim out of the admin access service (ADMIN_BOS_CLEANUP slice 1,
 * condition C-2), because the new admin list route needs the same split. Two
 * parsers would drift, and a drift here means the page and the gate disagree
 * about who is an admin.
 *
 * The value is read at CALL time, never at module load. The access service
 * calls `readEnvAdminEmails()` in its constructor, and its test suite sets
 * `process.env.ADMIN_EMAILS` just before constructing an instance; a
 * module-level constant would freeze whatever value existed at import.
 *
 * Server-only by nature: the variable has no `NEXT_PUBLIC_` prefix, so it is
 * undefined in a browser bundle. No client file imports this module.
 *
 * Known debt: `scripts/seed-admin-users.ts` keeps its own copy of the same
 * regex (a CLI script, deliberately left alone; tracked in the access doc's
 * Open Items).
 *
 * @module lib/admin/adminEmailsEnv
 */

/**
 * Parse an `ADMIN_EMAILS` value (comma, semicolon or whitespace separated)
 * into a set of trimmed, lowercased addresses. Empty input gives an empty set.
 */
export function parseAdminEmails(raw: string | undefined | null): Set<string> {
  return new Set(
    (raw || '')
      .split(/[,;\s]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
}

/** Read and parse `process.env.ADMIN_EMAILS` now (at call time, not at import). */
export function readEnvAdminEmails(): Set<string> {
  return parseAdminEmails(process.env.ADMIN_EMAILS);
}
