/**
 * Read-only dry run of the account deletion sweep.
 *
 * For every table `accountDeletionPolicy` will touch, this runs the SELECT
 * equivalent of the DELETE or UPDATE the route would run, scoped to a uuid
 * nobody owns. Nothing is written.
 *
 * It exists because the sweep in `app/api/user/delete-account/route.ts` logs
 * and continues rather than stopping — deliberately, so one bad table cannot
 * strand a half-deleted account. That makes two failures silent in production:
 * a table that no longer exists, and a key column that does not exist on it.
 * Either would report a successful deletion having deleted nothing.
 *
 * Run it after changing the policy, the ownership lists, or any of these
 * tables' schemas:
 *
 *   npx tsx scripts/verify-deletion-policy-tables.ts
 *
 * Exit code 1 means at least one table would have failed silently.
 */
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env.local') });

import { createClient } from '@supabase/supabase-js';
import {
  CASCADE_ROOT_TABLE,
  accountTablesToProcess,
  keyColumnFor,
  policyFor,
} from '../lib/business-os/account/accountDeletionPolicy';

/** A valid uuid that cannot match a real row, so every probe returns zero. */
const NOBODY = '00000000-0000-4000-8000-000000000000';

async function main() {
  // Built here rather than imported: `lib/supabaseServer` reads the env at
  // module load, and an import would be hoisted above `dotenv.config`.
  const supabaseServer = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const tables = [...accountTablesToProcess(), CASCADE_ROOT_TABLE];
  const problems: string[] = [];

  console.log(`Probing ${tables.length} tables (read-only)\n`);

  for (const table of tables) {
    const verdict = table === CASCADE_ROOT_TABLE ? 'cascade' : policyFor(table).verdict;

    // `keep` runs no query at all, so there is nothing that could fail.
    if (verdict === 'keep') {
      console.log(`  keep      ${table}`);
      continue;
    }

    const key = keyColumnFor(table);
    const { error } = await supabaseServer
      .from(table)
      .select(key, { count: 'exact', head: true })
      .eq(key, NOBODY);

    if (error) {
      problems.push(`${table}.${key} → ${error.code ?? '?'} ${error.message}`);
      console.log(`  BROKEN    ${table}.${key}  ${error.message}`);
      continue;
    }

    console.log(`  ${verdict.padEnd(9)} ${table}.${key}`);
  }

  console.log(`\n${tables.length} tables, ${problems.length} broken`);
  problems.forEach(p => console.log(`  x ${p}`));

  process.exit(problems.length === 0 ? 0 : 1);
}

main();
