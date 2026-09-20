/**
 * Neutralise privileged values left in `profiles.role`
 *
 * ALREADY RUN ON PRODUCTION — 2026-09-20. This file is the trace, not a pending
 * task. It is idempotent: re-running it today matches nothing.
 *
 * WHY
 * ---
 * `profiles.role` is a persona/display label, never an authorization signal —
 * admin identity is the `admin_users` allow-list via `AdminAccessService`
 * (docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md). But the `profiles` UPDATE
 * policy was `USING (auth.uid() = id)` with no WITH CHECK and no column
 * restriction, and the settings UI offered "Administrator" as a choice, so any
 * signed-in user could write `role = 'admin'` on their own row from the browser.
 * `supabase/migrations/20261002_profiles_role_privilege_guard.sql` closes that
 * at the database.
 *
 * The census run on production 2026-09-20, before the cleanup:
 *
 *   role    | row_count | also_in_admin_users
 *   --------+-----------+--------------------
 *   admin   |         3 |                   2
 *
 * Two of the three were genuine platform admins — and their real privilege comes
 * from `admin_users`, so clearing the label costs them nothing. **One was not**,
 * which is the self-promotion path showing up in the data. After the cleanup the
 * same census returned zero rows.
 *
 * The migration deliberately does NOT do this. Applying it rewrites no rows: a
 * schema migration that silently edits user rows is harder to reason about than
 * one that does not. (Precisely: that is a statement about applying the
 * migration. Once the guard is live, a client upsert of a row holding a
 * privileged value clears it to NULL — see the trigger's INSERT branch.) Hence
 * a separate, explicit, re-runnable script, which is what actually cleared the
 * three rows recorded above.
 *
 * WHAT IT DOES
 * ------------
 * Sets `role = 'user'` on every profile whose role normalises to a privileged
 * value. `'user'` rather than NULL: these rows already had a label, the settings
 * tab shows 'user' for anything it does not offer, and it keeps the column's
 * meaning ("some persona") intact.
 *
 * Normalisation mirrors the trigger exactly — `lower()` with every
 * non-alphanumeric character stripped — so a tab-, NBSP- or separator-padded
 * `admin` is caught too, not just the bare spelling the operator's ad-hoc SQL
 * matched. Comparison is exact equality against the normalised denylist, never a
 * substring test: `business_owner` normalises to `businessowner`, which
 * *contains* `owner`, and that persona must not be touched.
 *
 * Runs with `supabaseServer` (service role). That is required and intentional:
 * the table is RLS-protected per user, and the new trigger exempts
 * `service_role`, so this is the only client that can perform the rewrite at all.
 *
 * Dry run by default:
 *   npx tsx -r dotenv/config scripts/cleanup-profiles-role-admin.ts dotenv_config_path=.env.local
 *   npx tsx -r dotenv/config scripts/cleanup-profiles-role-admin.ts dotenv_config_path=.env.local --apply
 */

import { supabaseServer } from '../lib/supabaseServer';
import { createLogger } from '../lib/logger';

const logger = createLogger({ module: 'CleanupProfilesRoleAdmin' });

const APPLY = process.argv.includes('--apply');
const PAGE_SIZE = 1000;
const REPLACEMENT_ROLE = 'user';

/**
 * Kept in step with `privileged_values` in
 * supabase/migrations/20261002_profiles_role_privilege_guard.sql — and with the
 * copy in components/v2/settings/__tests__/profileRoleOptions.test.ts. Already
 * in normalised form (lower case, no separators).
 */
const PRIVILEGED_VALUES = [
  'admin',
  'administrator',
  'superadmin',
  'platformadmin',
  'supabaseadmin',
  'superuser',
  'sysadmin',
  'systemadmin',
  'root',
  'owner',
  'servicerole',
];

/**
 * Mirrors the trigger's
 * `lower(regexp_replace(normalize(v, NFKC), '[^a-zA-Z0-9]', '', 'g'))`
 * — NFKC, then strip, then lower, IN THAT ORDER.
 *
 * The order is not cosmetic (QA D5). Lowercasing first diverges on a dotted
 * capital I: `'ADMİN'.toLowerCase()` is `i` + U+0307, whose combining mark the
 * strip then discards, giving `admin` — where the SQL gives `admn`. A script
 * that clamps a value the database would not is a script that rewrites rows the
 * guard considers legitimate.
 */
const normalise = (value: string): string =>
  value.normalize('NFKC').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

const isPrivileged = (value: string | null): boolean =>
  value !== null && PRIVILEGED_VALUES.includes(normalise(value));

type ProfileRow = {
  id: string;
  role: string | null;
};

async function fetchProfilesWithARole(): Promise<ProfileRow[]> {
  const rows: ProfileRow[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabaseServer
      .from('profiles')
      .select('id, role')
      .not('role', 'is', null)
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;

    rows.push(...(data as ProfileRow[]));
    if (data.length < PAGE_SIZE) break;
  }

  return rows;
}

async function main(): Promise<void> {
  const rows = await fetchProfilesWithARole();
  // Filtered here rather than in the query: PostgREST cannot express the
  // trigger's normalisation, and an approximation would be the very drift this
  // whole change is about.
  const offenders = rows.filter(row => isPrivileged(row.role));

  logger.info(
    { profilesWithARole: rows.length, privilegedRows: offenders.length, apply: APPLY },
    'Scanned profiles.role'
  );

  if (offenders.length === 0) {
    // The expected outcome from 2026-09-20 onwards.
    logger.info({}, 'No privileged values in profiles.role — nothing to do');
    return;
  }

  // Values only. Never log the profile ids — they are user identifiers, and the
  // count plus the distribution is all this needs to report.
  const distribution = offenders.reduce<Record<string, number>>((acc, row) => {
    const key = row.role ?? '(null)';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  logger.warn({ distribution }, 'Privileged values found in profiles.role');

  if (!APPLY) {
    logger.info({ wouldUpdate: offenders.length }, 'Dry run — re-run with --apply to write');
    return;
  }

  let updated = 0;
  for (const row of offenders) {
    const { error } = await supabaseServer
      .from('profiles')
      .update({ role: REPLACEMENT_ROLE })
      .eq('id', row.id);

    if (error) {
      // Loud, and keep going: one bad row must not leave the rest privileged.
      logger.error({ err: error }, 'Failed to clear a privileged role');
      continue;
    }
    updated += 1;
  }

  logger.info({ updated, attempted: offenders.length }, 'Cleared privileged values from profiles.role');
}

main().catch(error => {
  logger.error({ err: error }, 'cleanup-profiles-role-admin failed');
  process.exit(1);
});
