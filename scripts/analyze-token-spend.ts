// scripts/analyze-token-spend.ts
//
// Where the LLM money goes: which features burn tokens, and which single calls
// are outliers.
//
// ─────────────────────────────────────────────────────────────────────────────
// `token_usage` already records every call with enough dimensions to answer
// this — category, feature, component, model, input/output split and cost — but
// nothing aggregates it, so the question "what is expensive?" has never had an
// answer.
//
// The INPUT/OUTPUT SPLIT is the part worth reading closely. A call with huge
// input and small output is a bloated prompt: context assembled and sent on
// every call, whether or not the model needed it. That is the cheapest kind of
// waste to fix, because nothing about the product has to change.
//
// Read-only. Run:
//   npx tsx scripts/analyze-token-spend.ts                  # all time, everyone
//   npx tsx scripts/analyze-token-spend.ts --days 30        # recent only
//   npx tsx scripts/analyze-token-spend.ts --today          # since local midnight
//   npx tsx scripts/analyze-token-spend.ts --user <id|email> # one account
// ─────────────────────────────────────────────────────────────────────────────

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const PAGE = 1000;

interface Row {
  created_at: string;
  model_name: string | null;
  provider: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  cost_usd: number | null;
  category: string | null;
  feature: string | null;
  component: string | null;
  workflow_step: string | null;
  request_type: string | null;
  user_id: string | null;
  success: boolean | null;
}

interface Bucket {
  calls: number;
  input: number;
  output: number;
  cost: number;
  failed: number;
}

const empty = (): Bucket => ({ calls: 0, input: 0, output: 0, cost: 0, failed: 0 });

function add(map: Map<string, Bucket>, key: string, row: Row) {
  const bucket = map.get(key) ?? empty();
  bucket.calls += 1;
  bucket.input += row.input_tokens ?? 0;
  bucket.output += row.output_tokens ?? 0;
  bucket.cost += row.cost_usd ?? 0;
  if (row.success === false) bucket.failed += 1;
  map.set(key, bucket);
}

/** Cents matter on a whole-history total; fractions of a cent matter on a day. */
const money = (n: number) => (n > 0 && n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);
const thousands = (n: number) => n.toLocaleString('en-US');

/**
 * Token counts at whatever scale they actually are.
 *
 * Provider pricing is quoted per million, so millions is the right unit for a
 * whole-history report — and exactly the wrong one for a single day, where
 * every row rounds to `0.00M` and the table says nothing.
 */
const tokens = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString('en-US');
};

function table(
  title: string,
  map: Map<string, Bucket>,
  totalCost: number,
  limit = 12
) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
  console.log(
    `  ${'key'.padEnd(38)} ${'calls'.padStart(7)} ${'in'.padStart(9)} ${'out'.padStart(9)}` +
      ` ${'in/call'.padStart(8)} ${'cost'.padStart(9)} ${'share'.padStart(6)}`
  );

  const rows = [...map.entries()].sort((a, b) => b[1].cost - a[1].cost).slice(0, limit);

  for (const [key, b] of rows) {
    const share = totalCost > 0 ? (b.cost / totalCost) * 100 : 0;
    const perCall = b.calls > 0 ? Math.round(b.input / b.calls) : 0;

    // Flag the shape that means a bloated prompt rather than a big answer.
    const bloated = perCall > 10_000 ? ' \x1b[33m← big prompt\x1b[0m' : '';

    console.log(
      `  ${key.slice(0, 38).padEnd(38)} ${thousands(b.calls).padStart(7)}` +
        ` ${tokens(b.input).padStart(9)} ${tokens(b.output).padStart(9)}` +
        ` ${thousands(perCall).padStart(8)} ${money(b.cost).padStart(9)}` +
        ` ${share.toFixed(1).padStart(5)}%${bloated}`
    );
  }
}

async function main() {
  const daysFlag = process.argv.indexOf('--days');
  const days = daysFlag > -1 ? Number(process.argv[daysFlag + 1]) : null;

  /*
   * `--today` means the calendar day THIS MACHINE is in, not the last 24
   * hours. A rolling window answers a different question and would fold in
   * yesterday evening's work.
   */
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);

  const since = process.argv.includes('--today')
    ? midnight.toISOString()
    : days
      ? new Date(Date.now() - days * 86400000).toISOString()
      : null;

  const userFlag = process.argv.indexOf('--user');
  let onlyUser: string | null = userFlag > -1 ? process.argv[userFlag + 1] : null;

  // An email is friendlier to type than a uuid, so accept either.
  if (onlyUser && onlyUser.includes('@')) {
    const { data } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
    const hit = data?.users.find(u => u.email?.toLowerCase() === onlyUser!.toLowerCase());
    if (!hit) {
      console.error(`\nNo account for ${onlyUser}\n`);
      process.exit(1);
    }
    onlyUser = hit.id;
  }

  const rows: Row[] = [];
  for (let offset = 0; ; offset += PAGE) {
    let query = db
      .from('token_usage')
      .select(
        'created_at, model_name, provider, input_tokens, output_tokens, total_tokens, ' +
          'cost_usd, category, feature, component, workflow_step, request_type, user_id, success'
      )
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE - 1);

    if (since) query = query.gte('created_at', since);
    if (onlyUser) query = query.eq('user_id', onlyUser);

    const { data, error } = await query;
    if (error) throw new Error(`token_usage read failed: ${error.message}`);
    if (!data?.length) break;

    rows.push(...(data as Row[]));
    if (data.length < PAGE) break;
  }

  if (!rows.length) {
    console.log(
      `\nNo token_usage rows${since ? ' in that window' : ''}${onlyUser ? ' for that user' : ''}.\n`
    );
    return;
  }

  const totalCost = rows.reduce((sum, r) => sum + (r.cost_usd ?? 0), 0);
  const totalIn = rows.reduce((sum, r) => sum + (r.input_tokens ?? 0), 0);
  const totalOut = rows.reduce((sum, r) => sum + (r.output_tokens ?? 0), 0);
  const first = rows[rows.length - 1].created_at.slice(0, 10);
  const last = rows[0].created_at.slice(0, 10);

  const scope = onlyUser ? `  user ${onlyUser}` : '';
  console.log(`\n\x1b[1mLLM spend — ${first} to ${last}\x1b[0m${scope}`);
  console.log(
    `  ${thousands(rows.length)} calls · ${tokens(totalIn)} in · ${tokens(totalOut)} out · ${money(totalCost)}`
  );
  console.log(
    `  ${(totalIn / Math.max(totalOut, 1)).toFixed(1)}:1 input-to-output — ` +
      'the higher this runs, the more is being spent on context rather than answers.'
  );

  const byCategory = new Map<string, Bucket>();
  const byFeature = new Map<string, Bucket>();
  const byComponent = new Map<string, Bucket>();
  const byModel = new Map<string, Bucket>();
  const byUser = new Map<string, Bucket>();

  for (const row of rows) {
    add(byCategory, row.category ?? row.request_type ?? '(unlabelled)', row);
    add(byFeature, row.feature ?? '(unlabelled)', row);
    add(
      byComponent,
      `${row.component ?? '(none)'}${row.workflow_step ? ` · ${row.workflow_step}` : ''}`,
      row
    );
    add(byModel, `${row.provider ?? '?'}/${row.model_name ?? '?'}`, row);
    add(byUser, row.user_id ?? '(none)', row);
  }

  table('By category', byCategory, totalCost);
  table('By feature', byFeature, totalCost);
  table('By component · step — the actual call sites', byComponent, totalCost, 15);
  table('By model', byModel, totalCost);
  // Pointless when the whole report is already one account.
  if (!onlyUser) table('By user', byUser, totalCost, 8);

  // ── outliers ──────────────────────────────────────────────────────────────
  console.log(`\n\x1b[1mSingle most expensive calls\x1b[0m`);
  const worst = [...rows].sort((a, b) => (b.cost_usd ?? 0) - (a.cost_usd ?? 0)).slice(0, 10);
  for (const row of worst) {
    console.log(
      `  ${row.created_at.slice(0, 16).replace('T', ' ')}  ${money(row.cost_usd ?? 0).padStart(8)}` +
        `  ${thousands(row.input_tokens ?? 0).padStart(8)} in /${thousands(row.output_tokens ?? 0).padStart(7)} out` +
        `  ${row.component ?? row.feature ?? row.category ?? '?'}`
    );
  }

  // ── wasted spend ──────────────────────────────────────────────────────────
  const failed = rows.filter(r => r.success === false);
  const failedCost = failed.reduce((sum, r) => sum + (r.cost_usd ?? 0), 0);
  if (failed.length) {
    console.log(
      `\n\x1b[33m${thousands(failed.length)} failed call(s) still cost ${money(failedCost)} ` +
        `(${((failedCost / totalCost) * 100).toFixed(1)}% of spend)\x1b[0m — ` +
        'tokens are charged whether or not the answer was usable.'
    );
  }

  console.log('');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
