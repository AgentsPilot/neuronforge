// scripts/business-fixture.ts
//
// Snapshot a real business, then rebuild it as a disposable account — over and
// over — so a full purge can be tested against realistic data instead of a
// seven-table toy.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY
//
// Deleting an account is irreversible and one-shot, and the earlier fixture
// populated 7 of 55 business tables. "The cascade works" was therefore proven
// for 7 tables and extrapolated for the other 48.
//
// This takes a snapshot of an account that has actually been used — every table
// it touches, with the real shape of its data — and restores it into a FRESH
// throwaway account as many times as you like. Each restore is a new account
// with new ids, so the original is never at risk and never changes.
//
//   npx tsx scripts/business-fixture.ts snapshot "David KPMG"
//   npx tsx scripts/business-fixture.ts restore                 # → login printed
//   # log in, delete the account through the UI
//   npx tsx scripts/test-account-deletion.ts verify <user id>
//   npx tsx scripts/business-fixture.ts restore                 # go again
//
// ─────────────────────────────────────────────────────────────────────────────
// THE TWO THINGS THAT MAKE THIS SAFE
//
// 1. EVERY EMAIL ADDRESS IS REWRITTEN on restore, without exception.
//
//    This is not tidiness. Deleting an account CANCELS EVERY FUTURE BOOKING AND
//    EMAILS THE CLIENT to say the business has ceased operating. Restore a real
//    business with its real client addresses, press delete, and those emails go
//    to real people about a business that is still trading. Every address is
//    replaced with one under a reserved, undeliverable domain before a single
//    row is written.
//
// 2. SNAPSHOT IS READ-ONLY and RESTORE only ever writes to an account it just
//    created. Neither command can touch the business it copied.
//
// ─────────────────────────────────────────────────────────────────────────────
// HOW THE REBUILD WORKS
//
// Every primary key in this schema is a uuid, so restore maps each old id to a
// fresh one and rewrites every occurrence of it anywhere in the data — columns
// and nested JSON alike. Foreign keys therefore follow without this script
// needing to know a single relationship.
//
// Rows go in in FOREIGN-KEY ORDER, read from the database itself. PostgREST
// publishes every FK in its OpenAPI document, so `scripts/lib/pgSchema.ts`
// topologically sorts the tables and parents are written before their children.
// Nothing here guesses an order, and nothing hardcodes one that would rot.
//
// Each row is also checked against the table's NOT NULL columns BEFORE the
// insert, so a rejection names the missing column instead of surfacing as an
// opaque failure three tables later.
//
// Unique collisions (slugs, invoice numbers, short codes) are resolved from
// Postgres's own error — it names the offending column in `Key (col)=(val)` —
// so that list is never hand-maintained either.
// ─────────────────────────────────────────────────────────────────────────────

import { config } from 'dotenv';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { BUSINESS_OWNED_TABLES } from '../lib/business-os/businessOwnedTables';
import {
  CASCADE_ROOT_TABLE,
  accountTablesToProcess,
  keyColumnFor,
} from '../lib/business-os/account/accountDeletionPolicy';
import { loadSchema, insertOrder, missingRequired } from './lib/pgSchema';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const FIXTURE_DIR = join(__dirname, '..', '.fixtures');
const DEFAULT_FILE = join(FIXTURE_DIR, 'business-snapshot.json');

/** Reserved TLD: guaranteed not to resolve, so nothing can be delivered. */
const SAFE_DOMAIN = 'deletion-test.invalid';
const SAFE_PASSWORD = 'deletion-test-password-1234';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;

interface Snapshot {
  source: { userId: string; companyName: string | null; takenAt: string };
  tables: Record<string, Record<string, unknown>[]>;
}

/**
 * Every table a purge is responsible for.
 *
 * The union of both deletion lists plus the tables the coverage audit found in
 * neither — because a fixture that only populates what deletion already knows
 * about can never demonstrate a gap.
 */
function allTables(): string[] {
  return [
    ...new Set([
      ...BUSINESS_OWNED_TABLES,
      CASCADE_ROOT_TABLE,
      ...accountTablesToProcess(),
      // Found by scripts/audit-deletion-coverage.ts: per-user rows in neither
      // list. Captured so a restored fixture shows whether they survive.
      'advisor_reports',
      'agent_memories',
      'agent_prompt_threads',
      'boost_pack_purchases',
      'data_decision_requests',
      'metric_baselines',
      'onboarding_prompt_ideas',
      'processed_webhook_events',
      'shadow_failure_snapshots',
      'storage_usage',
      'subscription_invoices',
      'user_rewards',
      'workflow_executions',
    ]),
  ].sort();
}

// ── snapshot ────────────────────────────────────────────────────────────────

async function resolveBusiness(needle: string) {
  const { data, error } = await db
    .from('business_profiles')
    .select('user_id, company_name');

  if (error) throw new Error(`Could not read business_profiles: ${error.message}`);

  const hit = (data ?? []).find(
    b =>
      b.user_id === needle ||
      (b.company_name ?? '').toLowerCase() === needle.toLowerCase()
  );

  if (!hit) {
    console.error(`\nNo business matching "${needle}". Known businesses:`);
    (data ?? []).forEach(b => console.error(`  ${b.user_id}  ${b.company_name}`));
    process.exit(1);
  }
  return hit;
}

async function snapshot(needle: string, outFile: string) {
  const business = await resolveBusiness(needle);
  console.log(`\nSnapshotting "${business.company_name}"  (${business.user_id})`);
  console.log('Read-only. The source business is not modified.\n');

  const tables: Snapshot['tables'] = {};
  const empty: string[] = [];
  const unreadable: string[] = [];
  let total = 0;

  for (const table of allTables()) {
    const key = keyColumnFor(table);
    const { data, error } = await db.from(table).select('*').eq(key, business.user_id);

    if (error) {
      unreadable.push(`${table} (${error.code ?? '?'}${error.message ? `: ${error.message}` : ''})`);
      continue;
    }
    if (!data?.length) {
      empty.push(table);
      continue;
    }

    tables[table] = data;
    total += data.length;
    console.log(`  ${table.padEnd(34)} ${data.length}`);
  }

  const snap: Snapshot = {
    source: {
      userId: business.user_id,
      companyName: business.company_name,
      takenAt: new Date().toISOString(),
    },
    tables,
  };

  if (!existsSync(FIXTURE_DIR)) mkdirSync(FIXTURE_DIR, { recursive: true });
  writeFileSync(outFile, JSON.stringify(snap, null, 2));

  const populated = Object.keys(tables).length;
  console.log(`\n  ${total} rows across ${populated} table(s) → ${outFile}`);

  /*
   * Coverage is the point, so say plainly what this fixture will NOT exercise.
   * An empty table restores as nothing, and a purge that deletes nothing from
   * it proves nothing about it.
   */
  console.log(`\n  ${empty.length} of ${allTables().length} tables are empty on this business.`);
  console.log('  A restore cannot demonstrate a purge for those — there is nothing to purge.');
  if (unreadable.length) {
    console.log(`\n  \x1b[33m${unreadable.length} unreadable (absent here, or no ${'user_id'}):\x1b[0m`);
    unreadable.forEach(u => console.log(`    ${u}`));
  }
  console.log('');
}

// ── restore ─────────────────────────────────────────────────────────────────

/** Walk any value, rewriting ids, emails and (optionally) shifting dates. */
function rewrite(
  value: unknown,
  ids: Map<string, string>,
  emails: Map<string, string>,
  shiftDays: number
): unknown {
  if (typeof value === 'string') {
    if (UUID.test(value) && ids.has(value.toLowerCase())) return ids.get(value.toLowerCase());
    if (EMAIL.test(value)) {
      if (!emails.has(value.toLowerCase())) {
        // Stable per address, so two rows naming the same client still agree.
        emails.set(value.toLowerCase(), `client-${emails.size + 1}-${Date.now()}@${SAFE_DOMAIN}`);
      }
      return emails.get(value.toLowerCase());
    }
    if (shiftDays !== 0 && ISO_DATE.test(value)) {
      return new Date(new Date(value).getTime() + shiftDays * 86400000).toISOString();
    }
    return value;
  }

  if (Array.isArray(value)) return value.map(v => rewrite(v, ids, emails, shiftDays));

  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = rewrite(v, ids, emails, shiftDays);
    }
    return out;
  }

  return value;
}

/** The column Postgres says collided, from `Key (slug)=(x) already exists`. */
function collidingColumn(details: string | undefined): string | null {
  const match = /Key \(([^)]+)\)=/.exec(details ?? '');
  if (!match) return null;
  // Composite keys name several columns; the first is enough to break the tie.
  return match[1].split(',')[0].trim();
}

/** The column Postgres refuses to be given a value: a GENERATED column. */
function generatedColumn(message: string | undefined): string | null {
  const match = /column "([^"]+)"/.exec(message ?? '');
  return match ? match[1] : null;
}

/**
 * A fresh value for a column that collided, WITHIN its length limit.
 *
 * Appending a timestamp is the obvious move and it is wrong: `user_code` and
 * `smart_links.code` are both varchar(10), so the suffix turned a unique
 * violation into `22001 value too long` — and because business_profiles is the
 * parent of everything, that failure alone took the other 22 tables with it.
 */
function uniqueValue(current: unknown, limit: number | undefined): string {
  const suffix = randomUUID().replace(/-/g, '').slice(0, 8);
  if (typeof current !== 'string') return suffix;

  if (limit === undefined) return `${current}-${suffix}`;
  if (limit <= suffix.length) return suffix.slice(0, limit);

  // Keep as much of the original as the limit allows, so the value still reads
  // like the thing it replaced.
  return `${current.slice(0, limit - suffix.length - 1)}-${suffix}`;
}

async function restore(file: string, shiftDays: number) {
  if (!existsSync(file)) {
    console.error(`\nNo snapshot at ${file}. Run \`snapshot <business>\` first.\n`);
    process.exit(1);
  }

  const snap: Snapshot = JSON.parse(readFileSync(file, 'utf-8'));
  const stamp = Date.now();
  const email = `fixture-${stamp}@${SAFE_DOMAIN}`;

  console.log(`\nRestoring "${snap.source.companyName}" as a throwaway account`);
  console.log(`  snapshot taken ${snap.source.takenAt}`);
  if (shiftDays) console.log(`  shifting every timestamp by ${shiftDays} day(s)`);

  const { data: created, error: createError } = await db.auth.admin.createUser({
    email,
    password: SAFE_PASSWORD,
    email_confirm: true,
  });
  if (createError || !created.user) {
    console.error(`Could not create the auth user: ${createError?.message}`);
    process.exit(1);
  }
  const newUserId = created.user.id;

  /*
   * Build the id map BEFORE rewriting anything, so a foreign key pointing at a
   * row in another table resolves no matter which order the tables are walked.
   */
  const ids = new Map<string, string>([[snap.source.userId.toLowerCase(), newUserId]]);
  for (const rows of Object.values(snap.tables)) {
    for (const row of rows) {
      const id = row.id;
      if (typeof id !== 'string' || !UUID.test(id)) continue;

      /*
       * Never overwrite a mapping, and the one that matters is the user's.
       *
       * `profiles.id` IS the auth user id, so a blanket "every row.id gets a
       * fresh uuid" replaced the user mapping with a random value — and every
       * foreign key to auth.users then pointed at a user that does not exist.
       * That one line rejected 22 of 24 tables with 23503.
       */
      if (!ids.has(id.toLowerCase())) ids.set(id.toLowerCase(), randomUUID());
    }
  }

  const emails = new Map<string, string>();
  const prepared: Record<string, Record<string, unknown>[]> = {};
  for (const [table, rows] of Object.entries(snap.tables)) {
    prepared[table] = rows.map(
      row => rewrite(row, ids, emails, shiftDays) as Record<string, unknown>
    );
  }

  console.log(`  ${ids.size - 1} id(s) remapped, ${emails.size} email address(es) neutralised\n`);

  /*
   * ── insert, in the order the database's own foreign keys imply ────────────
   *
   * Not a retry loop. `insertOrder` topologically sorts the tables so every
   * parent is written before the rows that point at it, which means a failure
   * here is a real problem rather than an ordering accident to be retried away.
   */
  const schema = await loadSchema();
  const { order, cycles } = insertOrder(Object.keys(prepared), schema);

  if (cycles.length) {
    console.log(`  \x1b[33mforeign-key cycle among: ${cycles.join(', ')}\x1b[0m`);
    console.log('  Inserted last, together — one of them may fail on the first pass.\n');
  }

  const inserted: Record<string, number> = {};
  const failures: Array<[string, string]> = [];

  for (const table of order) {
    const rows = prepared[table];

    /*
     * Check NOT NULL before the round trip, so a rejection names the column
     * instead of arriving as an opaque 400. A snapshot taken before a column
     * became required is the realistic way this happens.
     */
    const incomplete = rows
      .map((row, index) => ({ index, missing: missingRequired(table, row, schema) }))
      .filter(r => r.missing.length > 0);

    if (incomplete.length) {
      const columns = [...new Set(incomplete.flatMap(r => r.missing))].join(', ');
      failures.push([table, `${incomplete.length} row(s) missing required: ${columns}`]);
      continue;
    }

    const { error } = await db.from(table).insert(rows);

    if (!error) {
      inserted[table] = rows.length;
      continue;
    }

    /*
     * Two failures are the snapshot's shape rather than a real problem, and
     * both name their own column in the error. Fixed here and retried, up to a
     * few times, because one table can hit several of each.
     *
     *   23505  a unique value already taken by the source business
     *   428C9  a GENERATED column, which may not be given a value at all
     */
    let current = error;
    let fixed = false;

    for (let attempt = 0; attempt < 6; attempt++) {
      if (current.code === '23505') {
        const column = collidingColumn(current.details ?? undefined);
        if (!column) break;

        const spec = schema.get(table);
        const isIdentity =
          spec?.formats[column] === 'uuid' || (spec?.primaryKey ?? []).includes(column);

        /*
         * A collision on an IDENTITY column means the row already exists — a
         * signup trigger creates `profiles`, `user_preferences`,
         * `notification_settings` and `security_settings` the moment the auth
         * user is made. The snapshot's values belong ON that row, so this is an
         * upsert, not a new row.
         *
         * Mutating instead produced `<uuid>-a1b2c3d4`, which is not a uuid, and
         * the insert failed with 22P02 — a worse error than the one it replaced.
         */
        if (isIdentity) {
          const merged = await db.from(table).upsert(rows, { onConflict: column });
          if (!merged.error) {
            inserted[table] = rows.length;
            fixed = true;
            break;
          }
          current = merged.error;
          continue;
        }

        const limit = spec?.maxLengths[column];
        for (const row of rows) row[column] = uniqueValue(row[column], limit);
      } else if (current.code === '428C9') {
        const column = generatedColumn(current.message);
        if (!column) break;
        // Computed by the database from the other columns; it comes back on read.
        for (const row of rows) delete row[column];
      } else {
        break;
      }

      const retry = await db.from(table).insert(rows);
      if (!retry.error) {
        inserted[table] = rows.length;
        fixed = true;
        break;
      }
      current = retry.error;
    }

    if (!fixed) failures.push([table, `${current.code}: ${current.message}`]);
  }

  // ── report ────────────────────────────────────────────────────────────────
  const rows = Object.values(inserted).reduce((a, b) => a + b, 0);
  console.log(`\x1b[1mRestored\x1b[0m`);
  Object.entries(inserted)
    .sort()
    .forEach(([table, n]) => console.log(`  ${table.padEnd(34)} ${n}`));
  console.log(`\n  ${rows} row(s) across ${Object.keys(inserted).length} table(s)`);

  if (failures.length) {
    console.log(`\n  \x1b[31m${failures.length} table(s) could not be restored:\x1b[0m`);
    failures.forEach(([table, message]) => console.log(`    ${table.padEnd(30)} ${message}`));
    console.log('  The fixture is incomplete — a purge test will not cover those.');
  }

  console.log(`\n\x1b[1mLogin\x1b[0m`);
  console.log(`  user id   ${newUserId}`);
  console.log(`  email     ${email}`);
  console.log(`  password  ${SAFE_PASSWORD}`);
  console.log(`\n\x1b[1mNext\x1b[0m`);
  console.log(`  npx tsx scripts/test-account-deletion.ts plan ${email}`);
  console.log('  log in as that address and delete the account from Settings');
  console.log(`  npx tsx scripts/test-account-deletion.ts verify ${newUserId}\n`);
}

// ── entry ───────────────────────────────────────────────────────────────────

async function main() {
  const [command, argument] = process.argv.slice(2);
  const fileFlag = process.argv.indexOf('--file');
  const file = fileFlag > -1 ? process.argv[fileFlag + 1] : DEFAULT_FILE;
  const shiftFlag = process.argv.indexOf('--shift');
  const shiftDays = shiftFlag > -1 ? Number(process.argv[shiftFlag + 1]) : 0;

  if (command === 'snapshot') {
    if (!argument) return usage('snapshot needs a business name or user id');
    return snapshot(argument, file);
  }

  if (command === 'restore') return restore(file, shiftDays);

  return usage(command ? `unknown command: ${command}` : '');

  function usage(problem: string) {
    if (problem) console.error(`\n${problem}`);
    console.error(`
Usage:
  business-fixture.ts snapshot <name|user-id> [--file f]   read-only copy of a real business
  business-fixture.ts restore [--file f] [--shift <days>]  rebuild it as a throwaway account

  --shift moves every timestamp, so bookings that have since passed are ahead
  again and the cancel-and-notify path actually runs.
`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
