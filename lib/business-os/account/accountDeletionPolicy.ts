/**
 * What happens to each ACCOUNT-level table when someone deletes their account.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The business side needs no policy: deleting the `business_profiles` row
 * cascades all 55 tables in `BUSINESS_OWNED_TABLES`. This file is about the
 * other half — the rows that belong to the PERSON and survive that cascade by
 * design.
 *
 * THREE VERDICTS, AND THE BURDEN IS ON KEEPING
 *
 *   delete    No reason to retain it. The default, and most of the list.
 *   minimise  A reason to retain the RECORD but not the person: financial and
 *             audit history. The link to the individual is broken.
 *   keep      Leave the row exactly as it is. Two things qualify: it names
 *             someone on purpose (a suppression list), or it never named
 *             anyone (an anonymous corpus with no owner column).
 *
 * Storage limitation says retention must be justified, not deletion. So
 * anything absent from the exceptions below is deleted, and every exception
 * carries its reason in the table.
 *
 * WHY "MINIMISE" NULLS THE USER ID
 *
 * Because anything short of that is not anonymisation. The route this replaces
 * wrote `DELETED_USER_${user.id.substring(0, 8)}` over the name and called the
 * result anonymised — but the row stayed keyed by `user_id`, and the substitute
 * name was DERIVED from the id. The link was intact, so the data was still
 * personal data. That is pseudonymisation wearing the word anonymisation, and
 * it is the reason the response could claim Article 17 while satisfying none of
 * it.
 *
 * Nulling the id does a second job worth naming: a row with no `user_id` cannot
 * be taken by a cascade from `auth.users`. Whether a given table cascades is not
 * knowable from this repo — several of these tables have no CREATE TABLE in the
 * migrations at all — so detaching first is what makes retention actually
 * happen rather than depending on a constraint nobody can see.
 *
 * ORDER IS PART OF THE CONTRACT. Minimise and keep run BEFORE the business
 * cascade and before the auth user is deleted. Afterwards there is nothing left
 * to detach.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { USER_OWNED_TABLES } from '@/lib/business-os/businessOwnedTables';

export type AccountDataVerdict = 'delete' | 'minimise' | 'keep';

export interface AccountTablePolicy {
  verdict: AccountDataVerdict;
  reason: string;
  /**
   * Columns overwritten when minimising, beyond detaching `user_id`.
   *
   * Only ever used to REMOVE identity — never to write a substitute derived
   * from it, which is the mistake this file exists to correct.
   */
  strip?: Record<string, null>;
}

/**
 * The parent row. Deleted by the caller to fire the cascade, so it is neither
 * an exception nor part of the default sweep.
 */
export const CASCADE_ROOT_TABLE = 'business_profiles';

/**
 * Everything that is NOT simply deleted, with the reason it is not.
 *
 * Kept deliberately short. A long list here would mean the default had stopped
 * being deletion.
 */
export const ACCOUNT_POLICY_EXCEPTIONS: Record<string, AccountTablePolicy> = {
  email_unsubscribes: {
    verdict: 'keep',
    reason:
      'A suppression list is only useful because it names someone. Stripping it would ' +
      'resume mailing people who asked not to be mailed — the opposite of respecting them.',
  },

  intent_examples: {
    verdict: 'keep',
    reason:
      'Has no owner column. The corpus stores a hash and a PII-stripped input, never the ' +
      'person, so there is nothing here to delete or detach — it is already anonymous. ' +
      'Listed explicitly because a sweep that assumed `user_id` would fail silently.',
  },

  token_usage: {
    verdict: 'minimise',
    reason: 'Usage accounting. The totals are real; whose they were is not needed to keep them.',
  },

  credit_transactions: {
    verdict: 'minimise',
    reason: 'Financial record. Retained for accounting, detached from the person.',
  },

  billing_events: {
    verdict: 'minimise',
    reason: 'Financial record. Retained for accounting, detached from the person.',
  },

  user_subscriptions: {
    verdict: 'minimise',
    reason: 'Financial record. Retained for accounting, detached from the person.',
  },

  audit_trail: {
    verdict: 'minimise',
    reason:
      'Security history, retained on legitimate-interest grounds. Its own column is already ' +
      'declared ON DELETE SET NULL, so detaching here simply makes that explicit and ordered.',
  },
};

/**
 * Account-level tables that `USER_OWNED_TABLES` does not name.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * That list answers "does this survive the business cascade?", which is a
 * different question from "is this personal data?". Several tables are neither
 * business-owned nor listed there — they simply were never classified — and a
 * sweep driven only by that list silently skips every one of them.
 *
 * The four below are not a theoretical gap. The route this policy replaced
 * deleted all four BY NAME, and the policy-driven rewrite quietly stopped:
 * `user_memory` alone held 332 rows. `scripts/audit-deletion-coverage.ts`
 * found them by building the table universe from the migrations and the source
 * rather than from these lists — run it after any schema change, because
 * nothing else can see this class of gap.
 *
 * Verdicts still come from `policyFor`, so anything here is deleted unless it
 * also appears in the exceptions above.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const UNCLASSIFIED_ACCOUNT_TABLES = [
  // Per-user learning. No value to anyone once the person is gone.
  'user_memory',
  // The person's own settings.
  'notification_settings',
  'security_settings',
  // Credentials. Retaining these is a security problem, not a retention policy.
  'user_api_keys',
] as const;

/**
 * Tables whose owning column is not `user_id`.
 *
 * `profiles` is keyed by `id`, because the row IS the auth user — every caller
 * in the codebase reads it with `.eq('id', user.id)`. Getting this wrong would
 * be silent: a delete scoped to a column that does not exist errors rather than
 * deleting, and a sweep that logs and continues would report success having
 * left the profile behind.
 */
export const ACCOUNT_TABLE_KEY_COLUMNS: Record<string, string> = {
  profiles: 'id',
};

/** The column that ties this table's rows to the account. */
export function keyColumnFor(table: string): string {
  return ACCOUNT_TABLE_KEY_COLUMNS[table] ?? 'user_id';
}

/**
 * The verdict for a table. Anything unlisted is deleted, which is the point.
 */
export function policyFor(table: string): AccountTablePolicy {
  return (
    ACCOUNT_POLICY_EXCEPTIONS[table] ?? {
      verdict: 'delete',
      reason: 'No stated reason to retain it.',
    }
  );
}

/**
 * Account-level tables this deletion is responsible for.
 *
 * Read from `USER_OWNED_TABLES` — the list that already survives the business
 * cascade and already has a test stopping it drifting from the constraints —
 * plus the exceptions above, some of which are billing tables that list does
 * not classify.
 *
 * `business_profiles` is excluded: deleting it is the cascade, not a sweep.
 */
export function accountTablesToProcess(): string[] {
  const fromOwnership = Object.keys(USER_OWNED_TABLES).filter(
    table => table !== CASCADE_ROOT_TABLE
  );

  return [
    ...new Set([
      ...fromOwnership,
      ...UNCLASSIFIED_ACCOUNT_TABLES,
      ...Object.keys(ACCOUNT_POLICY_EXCEPTIONS),
    ]),
  ].sort();
}
