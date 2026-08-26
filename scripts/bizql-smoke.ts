/**
 * BizQL smoke test — proves the two questions that were previously
 * inexpressible at any layer now work, against real data.
 *
 *   npx tsx scripts/bizql-smoke.ts [userId]
 *
 * With no userId it picks the user with the most contacts, so it is safe to run
 * on a dev database without knowing account ids. Read-only throughout.
 */

import { config } from 'dotenv';
import type { FindQuery, ComputeQuery } from '../lib/business-os/bizql';

// Load env BEFORE the Supabase client module is evaluated. Static imports are
// hoisted above this call, so the modules below are imported dynamically.
config({ path: '.env.local', quiet: true });

type Deps = {
  supabaseServer: import('@supabase/supabase-js').SupabaseClient;
  runBusinessQuery: typeof import('../lib/business-os/bizql').runBusinessQuery;
  CATALOG_VERSION: string;
};

async function loadDeps(): Promise<Deps> {
  const [{ supabaseServer }, bizql, catalog] = await Promise.all([
    import('../lib/supabaseServer'),
    import('../lib/business-os/bizql'),
    import('../lib/business-os/catalog'),
  ]);
  return {
    supabaseServer,
    runBusinessQuery: bizql.runBusinessQuery,
    CATALOG_VERSION: catalog.CATALOG_VERSION,
  };
}

let deps: Deps;

async function pickUser(explicit?: string): Promise<string> {
  if (explicit) return explicit;

  const { data, error } = await deps.supabaseServer
    .from('crm_contacts')
    .select('user_id')
    .limit(1000);

  if (error) throw error;

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const id = (row as { user_id: string }).user_id;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) throw new Error('No contacts in the database to test against.');

  console.log(`Using user ${ranked[0][0]} (${ranked[0][1]} contacts)\n`);
  return ranked[0][0];
}

async function show(title: string, query: FindQuery | ComputeQuery, userId: string) {
  console.log('─'.repeat(78));
  console.log(title);
  console.log('─'.repeat(78));
  console.log(JSON.stringify(query));

  const started = Date.now();
  try {
    const result = await deps.runBusinessQuery(query, {
      userId,
      consumer: 'test',
      timezone: 'Asia/Jerusalem',
    });
    const ms = Date.now() - started;

    if (result.op === 'find') {
      console.log(`\n→ ${result.rows.length} rows in ${ms}ms${result.truncated ? ' (truncated)' : ''}`);
      for (const row of result.rows.slice(0, 5)) {
        console.log('   ', JSON.stringify(row));
      }
    } else {
      console.log(`\n→ value=${result.value} in ${ms}ms${result.approximate ? ' (approximate)' : ''}`);
      for (const g of result.groups?.slice(0, 8) ?? []) {
        console.log(`    ${g.key}: ${g.value}`);
      }
    }
  } catch (err) {
    console.log(`\n→ FAILED: ${(err as Error).message}`);
  }
  console.log();
}

async function main() {
  deps = await loadDeps();
  const userId = await pickUser(process.argv[2]);
  console.log(`Catalog version: ${deps.CATALOG_VERSION}\n`);

  // ── The question that had no numeric operator anywhere in the old stack ────
  await show(
    'Q1  "which clients have an unpaid invoice over $100?"',
    {
      op: 'find',
      entity: 'invoices',
      where: [
        { field: 'status', op: 'eq', value: { $semantic: 'unpaid' } },
        { field: 'amount', op: 'gt', value: 100 },
      ],
      select: ['invoice_number', 'amount', 'currency', 'status', 'due_date'],
      include: [{ relation: 'contact', select: ['first_name', 'last_name', 'email'] }],
      order_by: [{ field: 'amount', dir: 'desc' }],
      limit: 20,
    },
    userId
  );

  // ── The question that needed a relation-absence predicate ─────────────────
  await show(
    'Q2  "all contacts without an intake form"  (derived field → anti-join)',
    {
      op: 'find',
      entity: 'contacts',
      where: [
        { field: 'email', op: 'is_not_null' },
        { field: 'has_completed_intake', op: 'eq', value: false },
      ],
      select: ['first_name', 'last_name', 'email', 'stage'],
      limit: 20,
    },
    userId
  );

  // ── The inverse, to prove the quantifier flips correctly ──────────────────
  await show(
    'Q3  contacts WITH a completed intake (same derived field, inverted)',
    {
      op: 'find',
      entity: 'contacts',
      where: [{ field: 'has_completed_intake', op: 'eq', value: true }],
      select: ['first_name', 'last_name', 'email'],
      limit: 20,
    },
    userId
  );

  // ── Exactly what CashArAgingDetector hand-writes today ────────────────────
  await show(
    'Q4  detector-equivalent: overdue unpaid invoices (replaces bespoke Supabase code)',
    {
      op: 'find',
      entity: 'invoices',
      where: [
        { field: 'status', op: 'eq', value: { $semantic: 'unpaid' } },
        { field: 'due_date', op: 'lt', value: { $date: 'today' } },
        { field: 'amount', op: 'gt', value: 0 },
      ],
      select: ['invoice_number', 'amount', 'due_date', 'contact_id'],
      limit: 20,
    },
    userId
  );

  // ── Relative dates, in place of three separate regexes ────────────────────
  await show(
    'Q5  bookings from start of this week onward ({ $date } instead of regexes)',
    {
      op: 'find',
      entity: 'bookings',
      where: [
        // 'confirmed' is a published enum value, so no semantic term is needed.
        { field: 'status', op: 'eq', value: 'confirmed' },
        { field: 'start_time', op: 'gte', value: { $date: 'start_of_week' } },
      ],
      select: ['start_time', 'end_time', 'status'],
      order_by: [{ field: 'start_time', dir: 'asc' }],
      limit: 10,
    },
    userId
  );

  // ── Aggregate ─────────────────────────────────────────────────────────────
  await show(
    'Q6  total outstanding, grouped by status',
    {
      op: 'compute',
      entity: 'invoices',
      where: [{ field: 'status', op: 'eq', value: { $semantic: 'unpaid' } }],
      agg: { fn: 'sum', field: 'amount' },
      group_by: 'status',
    },
    userId
  );

  // ── Safety: these MUST be refused ─────────────────────────────────────────
  console.log('═'.repeat(78));
  console.log('SAFETY — the following must all be REFUSED');
  console.log('═'.repeat(78));

  await show(
    'S1  reading a field marked readable:false (internal_notes)',
    {
      op: 'find',
      entity: 'invoices',
      select: ['internal_notes'],
      limit: 1,
    },
    userId
  );

  await show(
    'S2  an undeclared semantic term (must not silently return zero rows)',
    {
      op: 'find',
      entity: 'invoices',
      where: [{ field: 'status', op: 'eq', value: { $semantic: 'banana' } }],
      limit: 1,
    },
    userId
  );

  await show(
    'S3  a column that exists in the DB but is not in the catalog',
    {
      op: 'find',
      entity: 'invoices',
      where: [{ field: 'stripe_invoice_id', op: 'is_not_null' }],
      limit: 1,
    },
    userId
  );

  await show(
    'S4  an unknown entity',
    { op: 'find', entity: 'auth_users', limit: 1 } as FindQuery,
    userId
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
