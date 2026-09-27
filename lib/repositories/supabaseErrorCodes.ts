// lib/repositories/supabaseErrorCodes.ts
// Pure helpers over Supabase / PostgREST error shapes. No imports, so pure
// modules (the admin jobs & queues read) can use them without pulling in a
// database client.

interface SupabaseErrorLike {
  code?: string;
  message?: string;
}

/**
 * True ONLY when the error says a table (or the summary function) is not
 * there, i.e. a migration has not been applied yet:
 *   - Postgres `42P01` (undefined table), message `relation "x" does not exist`;
 *   - PostgREST `PGRST205` ("Could not find the table … in the schema cache")
 *     and `PGRST202` ("Could not find the function … in the schema cache").
 *
 * A MISSING COLUMN is NOT a missing relation (SA-2): Postgres `42703`
 * (`column "x" does not exist`) and PostgREST `PGRST204` ("Could not find the
 * 'x' column of 'y' in the schema cache") mean the table exists but the query
 * is wrong. Treating that as "not installed yet" would hide a real defect
 * behind a calm grey message, so it returns false and surfaces as a failure.
 */
export function isMissingRelationError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as SupabaseErrorLike;
  if (e.code === '42P01' || e.code === 'PGRST205' || e.code === 'PGRST202') return true;
  if (e.code) return false; // any other code (42703, PGRST204, …) is not a missing relation
  const message = e.message ?? '';
  return /\brelation "[^"]*" does not exist\b/i.test(message) || /could not find the (table|function)\b/i.test(message);
}
