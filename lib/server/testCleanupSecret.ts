/**
 * The ONE reader of `TEST_CLEANUP_SECRET`: the second secret that unlocks the
 * test-account cleanup database function (OX-1r, SA re-ruling R-3, R-5).
 *
 * The database holds only its sha256 (operator_private.secrets), so the
 * service-role key alone cannot call the function. Set in Vercel for
 * PRODUCTION only, never Preview: preview builds run branch code from a public
 * repo against the same database. Unset means the tool is off and the routes
 * answer 503 "not configured" (the off switch, SA-11).
 *
 * Never log it, return it, or put it in an audit row. A Jest guard
 * (`lib/server/__tests__/testCleanupSecret.test.ts`) fails if any other file
 * under app/, lib/, components/ or hooks/ names the variable.
 *
 * @module lib/server/testCleanupSecret
 */

import 'server-only';

const ENV_NAME = 'TEST_CLEANUP_SECRET';

/** The secret, or null when unset or blank. */
export function readTestCleanupSecret(): string | null {
  const value = process.env[ENV_NAME];
  return value && value.trim() !== '' ? value.trim() : null;
}

/** True when the secret is present. Says nothing about whether the database accepts it. */
export function isTestCleanupConfigured(): boolean {
  return readTestCleanupSecret() !== null;
}
