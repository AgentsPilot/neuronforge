/**
 * The guard that keeps business ownership from drifting.
 *
 * Three things have to stay true, and none of them fails loudly on its own:
 *
 *   1. The TypeScript registry and the SQL migration name the same tables. They
 *      are two statements of one fact, and two statements of one fact drift.
 *   2. Every table carrying a `user_id` is classified as owned by a business or
 *      owned by the person. A NEW table that nobody classified is the failure
 *      this whole file exists for — it is how the previous list fell 38 tables
 *      behind without anyone noticing.
 *   3. Nothing is claimed by both lists.
 *
 * Read from the migration text rather than the database: this has to fail in CI
 * on a laptop with no credentials, at the moment someone adds a table, not
 * later against an environment where the migration may not even be applied.
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { BUSINESS_OWNED_TABLES, USER_OWNED_TABLES, isBusinessOwned } from '../businessOwnedTables';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');
const OWNERSHIP_MIGRATION = '20260916_business_data_ownership.sql';

/** The table names inside the migration's `business_owned` array. */
function tablesInMigration(): string[] {
  const sql = readFileSync(join(MIGRATIONS_DIR, OWNERSHIP_MIGRATION), 'utf8');

  const start = sql.indexOf('business_owned text[] := ARRAY[');
  expect(start).toBeGreaterThan(-1);
  const end = sql.indexOf('];', start);
  expect(end).toBeGreaterThan(start);

  const body = sql.slice(start, end);
  return [...body.matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
}

/**
 * Every table any migration creates with a `user_id` column.
 *
 * Deliberately crude: it reads the CREATE TABLE body as far as the statement
 * terminator and asks whether the word appears. A false positive costs someone
 * one line in a registry; a false negative is the bug this file is here to
 * prevent, so the bias runs that way on purpose.
 */
function tablesWithUserIdInMigrations(): Set<string> {
  const found = new Set<string>();

  for (const file of readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql'))) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    const pattern = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?["`]?([a-z_]+)["`]?\s*\(/gi;

    for (const match of sql.matchAll(pattern)) {
      const table = match[1].toLowerCase();
      const body = sql.slice(match.index ?? 0, (match.index ?? 0) + 4000);
      const statement = body.slice(0, body.indexOf(');') + 2 || body.length);
      if (/\buser_id\b/i.test(statement)) found.add(table);
    }
  }

  return found;
}

describe('business data ownership', () => {
  it('registers a non-trivial number of tables', () => {
    // A guard on the guard: an empty registry would make everything below pass
    // while protecting nothing.
    expect(BUSINESS_OWNED_TABLES.length).toBeGreaterThan(40);
  });

  it('names the same tables in TypeScript and in SQL', () => {
    const sql: string[] = [...tablesInMigration()].sort();
    // Annotated, because the registry is `as const`: spreading it keeps the
    // union-of-literals element type, and `.includes` then refuses a plain
    // string. Comparing table NAMES is the whole point here.
    const ts: string[] = [...BUSINESS_OWNED_TABLES].sort();

    // Diffed both ways so the failure says WHICH side is missing what, rather
    // than printing two long lists and leaving the reader to compare them.
    expect(sql.filter(t => !ts.includes(t))).toEqual([]);
    expect(ts.filter(t => !sql.includes(t))).toEqual([]);
  });

  it('never claims a table for both the business and the person', () => {
    // Widened deliberately: BUSINESS_OWNED_TABLES is `as const`, so its element
    // type is a union of literals that `in` will not accept against a plain
    // Record. The names are the same strings either way.
    const owned: readonly string[] = BUSINESS_OWNED_TABLES;
    const both = owned.filter(t => t in USER_OWNED_TABLES);
    expect(both).toEqual([]);
  });

  it('gives every user-owned table a reason it survives', () => {
    /*
     * "Not business-owned" is a claim about someone's data outliving the thing
     * that collected it. The two entries that actually matter — the unsubscribe
     * list and the onboarding transcript — are both cases where the obvious
     * answer is wrong, which is why a reason is required rather than suggested.
     */
    const unexplained = Object.entries(USER_OWNED_TABLES)
      .filter(([, reason]) => !reason || reason.trim().length < 10)
      .map(([table]) => table);

    expect(unexplained).toEqual([]);
  });

  it('classifies every table that carries a user_id', () => {
    /*
     * The one that catches table #56.
     *
     * A new table with a user_id is business data until someone says otherwise.
     * Left unclassified it gets no foreign key, so it survives the deletion of
     * the business that created it and is inherited by the next one — silently,
     * which is exactly how the pipeline stages and the capabilities leaked.
     *
     * To fix a failure here: add the table to BUSINESS_OWNED_TABLES *and* the
     * migration array, or to USER_OWNED_TABLES with the reason it outlives a
     * business.
     */
    const unclassified = [...tablesWithUserIdInMigrations()]
      .filter(table => !isBusinessOwned(table) && !(table in USER_OWNED_TABLES))
      .sort();

    expect(unclassified).toEqual([]);
  });

  it('points every constraint at business_profiles with a cascade', () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, OWNERSHIP_MIGRATION), 'utf8');

    // The three properties that make the migration do anything at all. A
    // constraint without the cascade would reject the delete instead of
    // completing it, which is a worse failure than the one being fixed.
    expect(sql).toContain('REFERENCES public.business_profiles(user_id)');
    expect(sql).toContain('ON DELETE CASCADE');
    // NOT VALID is what lets this ship while orphans still exist.
    expect(sql).toContain('NOT VALID');
  });
});
