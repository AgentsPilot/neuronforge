/**
 * What the business chat can and cannot be asked.
 *
 *   npx tsx --import ./scripts/env-preload.ts scripts/bizql-coverage.ts
 *
 * Read-only. Compares the semantic catalog — the only thing the planner can
 * see — against the physical schema it sits on, and reports three kinds of gap:
 *
 *   entities   a user-scoped table holding data that the catalog never mentions,
 *              so no question about it can be asked at all
 *   relations  a foreign key that exists in the database but is not declared, so
 *              questions that need to travel that edge have no path
 *   fields     a column of a declared entity that is not exposed, so it cannot
 *              be filtered, summed or shown
 *
 * This is the number that says when the coverage work is done. An opinion about
 * whether the chat "feels complete" is not.
 */

import { CATALOG } from '@/lib/business-os/catalog';
import { PHYSICAL_CATALOG } from '@/lib/business-os/catalog/catalog.generated';
import { supabaseServer } from '@/lib/supabaseServer';

/**
 * Tables that exist for the platform, not for the business owner.
 *
 * A judgement, not a schema fact, which is why it is written out here where it
 * can be argued with rather than buried in a heuristic. Audit trails, token
 * ledgers, workflow machinery and calibration snapshots all carry a `user_id`
 * and would otherwise dominate the report — but "how many rows are in my audit
 * trail" is not a question a business owner asks.
 *
 * Anything NOT matched here is treated as business domain and counted as a gap.
 * When in doubt a table stays in the domain list: a false gap costs a moment's
 * triage, a wrongly-hidden one is a question nobody can ask and nobody notices.
 */
const PLATFORM_INTERNAL = [
  /^audit_/,
  /^workflow_/,
  /^agent_/,
  /^execution_/,
  /^shadow_/,
  /^calibration_/,
  /^run_memories$/,
  /^processed_webhook/,
  /token_usage$/,
  /^derived_metrics$/,
  /^business_events$/,
  /^user_memory$/,
  /^credit_/,
  /_with_details$/,
];

const isInternal = (table: string) => PLATFORM_INTERNAL.some((p) => p.test(table));

/** Columns that are plumbing rather than something a user would ask about. */
const UNINTERESTING = new Set([
  'id',
  'user_id',
  'created_at',
  'updated_at',
  'metadata',
  'raw',
]);

/**
 * Every table PostgREST exposes, so the report is not bounded by the same
 * allowlist it is auditing.
 *
 * `scripts/generate-business-catalog.ts` introspects a deliberate list of 14
 * tables. That list is the outer limit of what the chat can EVER be taught —
 * a table outside it cannot even be declared — so a coverage report that only
 * looks inside it cannot see the largest gaps.
 */
async function liveTables(): Promise<Map<string, Set<string>>> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const response = await fetch(`${url}/rest/v1/`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!response.ok) throw new Error(`introspection failed: HTTP ${response.status}`);

  const doc = (await response.json()) as {
    definitions?: Record<string, { properties?: Record<string, unknown> }>;
  };

  const out = new Map<string, Set<string>>();
  for (const [table, def] of Object.entries(doc.definitions ?? {})) {
    if (def.properties) out.set(table, new Set(Object.keys(def.properties)));
  }
  return out;
}

async function rowCount(table: string): Promise<number | null> {
  const { count, error } = await supabaseServer
    .from(table)
    .select('*', { count: 'exact', head: true });
  return error ? null : (count ?? 0);
}

/**
 * What can actually be ASKED of each entity, derived from the catalog.
 *
 * This is the answer to "check every capability a user can read or write"
 * without enumerating questions. A question is answerable only if the catalog
 * carries the machinery behind it, so the machinery is what gets audited:
 *
 *   list      the entity exists at all
 *   filter    fields that can appear in a where clause
 *   measure   numeric/money fields that can be summed or averaged — no numeric
 *             field means no "how much" question of any phrasing
 *   segment   low-cardinality fields worth grouping by ("... by status")
 *   when      a date field, without which no time-bounded question works
 *   traverse  relations, which decide every cross-entity question
 *   write     declared actions, with their confirmation and bulk policy
 *
 * An empty cell is a whole CLASS of questions that cannot be asked, in any
 * language and any phrasing. That is the number worth moving, not the count of
 * example sentences in the eval.
 */
function capabilityMatrix() {
  console.log('\n' + '='.repeat(72));
  console.log('CAPABILITY MATRIX — what each entity can be asked');
  console.log('='.repeat(72));

  const holes: string[] = [];

  for (const [key, entity] of Object.entries(CATALOG.entities)) {
    const fields = Object.values(entity.fields);

    const measurable = fields.filter(
      (f) => f.format === 'money' || f.type === 'number' || f.physical?.format === 'numeric'
    );
    // Everything `group_by` accepts, not just enums.
    //
    // This counted enum fields only, which was true when a grouping WAS one
    // low-cardinality column. The grammar has since grown two more forms, so the
    // old count reported "nothing to group by" for entities that group perfectly
    // well by the thing they belong to, or by month. A matrix that understates
    // the system is worse than no matrix: it sends people to fix what already
    // works.
    const segmentable = [
      ...fields.filter((f) => f.type === 'enum' || !!f.enumSource).map((f) => f.key),
      // A to-one relation groups by what the related thing is called.
      ...Object.entries(entity.relations ?? {})
        .filter(([, r]) => r.cardinality === 'one' && r.via.side === 'local')
        .map(([relationKey]) => relationKey),
      // A date groups into calendar buckets.
      ...fields
        .filter((f) => f.type === 'date' || f.type === 'datetime')
        .map((f) => `${f.key}:month`),
    ];
    const temporal = fields.filter((f) => f.format === 'date' || f.format === 'datetime');
    // Both directions: a relation declared on `pages` as `views` makes
    // page_views reachable too. Counting only outbound edges reported entities
    // as isolated when they were perfectly joinable, which is the kind of false
    // alarm that gets a report ignored.
    const outbound = Object.values(entity.relations ?? {}).map((r) => r.target);
    const inbound = Object.entries(CATALOG.entities)
      .filter(([, other]) => Object.values(other.relations ?? {}).some((r) => r.target === key))
      .map(([otherKey]) => otherKey);
    const relations = [...new Set([...outbound, ...inbound])];
    const actions = Object.entries(entity.actions ?? {});

    console.log(`\n  ${key}`);
    console.log(`     filter   ${fields.length} fields`);
    console.log(
      `     measure  ${measurable.length ? measurable.map((f) => f.key).join(', ') : '— none'}`
    );
    console.log(
      `     segment  ${segmentable.length ? segmentable.join(', ') : '— none'}`
    );
    console.log(`     when     ${temporal.length ? temporal.map((f) => f.key).join(', ') : '— none'}`);
    console.log(`     traverse ${relations.length ? relations.join(', ') : '— none'}`);
    console.log(
      `     write    ${
        actions.length
          ? actions
              .map(([name, a]) => `${name}${a.requiresConfirmation ? '' : '!'}${a.allowBulk ? '*' : ''}`)
              .join(', ')
          : '— read only'
      }`
    );

    // Only a hole where money or quantity plausibly exists. A task has no
    // amount and never will; a booking has payment_amount sitting unexposed.
    const looksNumeric = (c: { name: string; format: string }) =>
      c.format === 'numeric' || /amount|price|total|count|value/.test(c.name);
    // Never suggest exposing a credential.
    //
    // This report is read as a to-do list, and adding channel_connections made
    // it print "though account_token exists" — advice to publish an OAuth token
    // to an LLM-driven query surface. A capability report that recommends a
    // security hole is worse than no report.
    const SECRET = /token|secret|password|credential|api_key|access_key|refresh/i;

    const candidates = (PHYSICAL_CATALOG.tables[entity.table]?.columns ?? [])
      .filter((c) => looksNumeric(c) && !SECRET.test(c.name))
      .map((c) => c.name);
    if (!measurable.length && candidates.length) {
      holes.push(
        `${key}: no numeric field exposed — no "how much" question works, though ${candidates.join('/')} exist${candidates.length === 1 ? 's' : ''}`
      );
    }
    if (!temporal.length) holes.push(`${key}: no date field — no time-bounded question works`);
    if (!segmentable.length) holes.push(`${key}: nothing to group by — no "... by X" breakdown`);
    if (!relations.length) holes.push(`${key}: no relations — cannot be joined to anything`);
  }

  console.log('\n  legend: write "update!" = no confirmation required, "x*" = bulk allowed');

  if (holes.length) {
    console.log('\n  ' + '-'.repeat(68));
    console.log(`  ${holes.length} capability holes — each is a class of question nobody can ask:`);
    for (const h of holes) console.log(`  ✗ ${h}`);
  }
  return holes.length;
}

async function main() {
  const declaredTables = new Map<string, string>(); // table -> entity key
  for (const [key, entity] of Object.entries(CATALOG.entities)) {
    declaredTables.set(entity.table, key);
  }

  // ---- entities ------------------------------------------------------------
  //
  // Three distinct gaps, because they cost different amounts to close:
  //
  //   introspected but not declared  — one catalog entry away
  //   outside the allowlist          — needs TABLES extended, then declared
  //   deliberately not an entity     — e.g. crm_pipeline_stages, which backs
  //                                    contacts.stage and is read for its values
  const live = await liveTables();
  const introspected = new Set(Object.keys(PHYSICAL_CATALOG.tables));

  /** Read for its values by a declared field rather than asked about directly. */
  const supporting = new Set(
    Object.values(CATALOG.entities).flatMap((entity) =>
      Object.values(entity.fields)
        .map((f) => f.enumSource?.table)
        .filter((t): t is string => !!t)
    )
  );

  const undeclared: Array<{ table: string; rows: number; where: string }> = [];
  const internal: Array<{ table: string; rows: number; where: string }> = [];

  for (const [table, columns] of live) {
    if (declaredTables.has(table) || supporting.has(table)) continue;
    // Per-user data, either directly or through a parent it belongs to.
    const scoped = columns.has('user_id') || [...columns].some((c) => c.endsWith('_id'));
    if (!scoped) continue;

    const rows = await rowCount(table);
    if (!rows) continue; // never written to — not yet a gap worth reporting

    (isInternal(table) ? internal : undeclared).push({
      table,
      rows,
      where: introspected.has(table) ? 'introspected, not declared' : 'outside the allowlist',
    });
  }
  undeclared.sort((a, b) => b.rows - a.rows);
  internal.sort((a, b) => b.rows - a.rows);

  console.log('='.repeat(72));
  console.log(`ENTITIES — ${declaredTables.size} declared`);
  console.log('='.repeat(72));
  for (const [table, key] of declaredTables) {
    console.log(`  ✓ ${key.padEnd(16)} ${table}`);
  }
  if (supporting.size) {
    console.log(`\n  read for their values, deliberately not entities:`);
    for (const t of supporting) console.log(`    · ${t}`);
  }
  if (undeclared.length) {
    console.log(`\n  ${undeclared.length} business tables hold data no question can reach:`);
    for (const u of undeclared) {
      console.log(`  ✗ ${String(u.rows).padStart(6)} rows  ${u.table.padEnd(26)} ${u.where}`);
    }
  }
  console.log(`\n  (${internal.length} platform-internal tables excluded — see PLATFORM_INTERNAL)`);

  // ---- relations -----------------------------------------------------------
  let declaredEdges = 0;
  const unreachable: string[] = [];

  for (const [key, entity] of Object.entries(CATALOG.entities)) {
    declaredEdges += Object.keys(entity.relations ?? {}).length;

    const columns = PHYSICAL_CATALOG.tables[entity.table]?.columns ?? [];
    for (const column of columns) {
      const fk = column.foreignKey;
      if (!fk || column.name === 'user_id') continue;

      // Is the table this column points at something the chat knows about?
      const targetEntity = declaredTables.get(fk.table);
      if (!targetEntity) continue;

      // Already declared, in either direction?
      const covered =
        Object.values(entity.relations ?? {}).some((r) => r.target === targetEntity) ||
        Object.values(CATALOG.entities[targetEntity]?.relations ?? {}).some(
          (r) => r.target === key
        );

      if (!covered) {
        unreachable.push(`${key}.${column.name} → ${targetEntity} (${fk.table})`);
      }
    }
  }

  console.log('\n' + '='.repeat(72));
  console.log(`RELATIONS — ${declaredEdges} declared`);
  console.log('='.repeat(72));
  if (unreachable.length === 0) {
    console.log('  every foreign key between declared entities is reachable');
  } else {
    console.log(`  ${unreachable.length} foreign keys exist but cannot be travelled:`);
    for (const u of unreachable) console.log(`  ✗ ${u}`);
  }

  // ---- fields --------------------------------------------------------------
  console.log('\n' + '='.repeat(72));
  console.log('FIELDS — exposed vs available, per entity');
  console.log('='.repeat(72));

  let totalExposed = 0;
  let totalAvailable = 0;

  for (const [key, entity] of Object.entries(CATALOG.entities)) {
    const columns = (PHYSICAL_CATALOG.tables[entity.table]?.columns ?? [])
      .map((c) => c.name)
      .filter((c) => !UNINTERESTING.has(c));
    const exposed = new Set(Object.values(entity.fields).map((f) => f.column));
    const hidden = columns.filter((c) => !exposed.has(c));

    totalExposed += columns.length - hidden.length;
    totalAvailable += columns.length;

    const ratio = `${columns.length - hidden.length}/${columns.length}`;
    console.log(`\n  ${key} (${ratio})`);
    if (hidden.length) console.log(`     hidden: ${hidden.join(', ')}`);
  }

  console.log('\n' + '='.repeat(72));
  console.log('SUMMARY');
  console.log('='.repeat(72));
  console.log(`  entities   ${declaredTables.size} declared, ${undeclared.length} tables with data unreachable`);
  console.log(`  relations  ${declaredEdges} declared, ${unreachable.length} foreign keys unreachable`);
  console.log(`  fields     ${totalExposed}/${totalAvailable} columns exposed`);

  const holes = capabilityMatrix();
  console.log('\n  capability holes: ' + holes);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
