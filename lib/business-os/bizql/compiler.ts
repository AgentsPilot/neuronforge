/**
 * BizQL compiler — the single choke point between a query and the database.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS FILE IS A SECURITY BOUNDARY. READ BEFORE EDITING.
 *
 * Every repository in this codebase is built on `supabaseServer`, the SERVICE
 * ROLE client, which bypasses row-level security. `.eq('user_id', …)` is
 * therefore the ONLY thing separating one business's data from another's.
 *
 * Consequently:
 *   1. `user_id` is injected here, from the QueryContext, on the outer query and
 *      on every relation sub-query. It is NEVER read from the IR, so a caller —
 *      including an LLM — cannot influence it.
 *   2. Every field, relation and entity name is resolved against the catalog.
 *      Unknown names are a hard error; nothing is ever passed through verbatim.
 *   3. `select` is restricted to catalog-readable fields, so columns marked
 *      `readable: false` (internal notes) cannot be exfiltrated by asking.
 *   4. Limits are clamped to the entity's `maxLimit`.
 *
 * If you add a code path that builds a query, it MUST go through applyUserScope.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/business-os/bizql
 */

import type { PostgrestFilterBuilder } from '@supabase/postgrest-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';
import {
  CATALOG,
  type ResolvedEntity,
  type ResolvedField,
} from '@/lib/business-os/catalog';
import {
  BizQLValidationError,
  ResultSetTooLargeError,
  VALUELESS_OPS,
  isAndPredicate,
  isDateExpr,
  isFieldPredicate,
  isNotPredicate,
  isOrPredicate,
  isRelationPredicate,
  isSemanticValue,
  type ComputeQuery,
  type ComputeResult,
  type FindQuery,
  type FindResult,
  type Predicate,
  type Query,
  type QueryContext,
  type QueryResult,
  type QueryRow,
  type QueryValue,
  type SemanticValue,
} from './types';
import { resolveDateExpr } from './dates';

const logger = createLogger({ module: 'BizQLCompiler' });

/**
 * Ceiling on an anti-join's intermediate id set. Above this we refuse rather
 * than truncate, because a silently truncated NOT-IN produces a WRONG answer
 * (contacts would be reported as "no intake" when they have one).
 */
const ANTI_JOIN_CAP = 10_000;

/** Ceiling on rows scanned for a JS-side aggregate. */
const AGGREGATE_SCAN_CAP = 5_000;

type Builder = PostgrestFilterBuilder<any, any, any, any, any>;

/**
 * A builder in a box.
 *
 * PostgREST builders are thenables: `await builder` EXECUTES the query and
 * resolves to `{ data, error }` rather than returning the builder. Since
 * predicate application is async (relation predicates run a sub-query first),
 * every async helper must return the builder wrapped in a plain object, or the
 * await silently fires the query mid-construction and the next `.gt()` call
 * fails with "not a function".
 *
 * Do not "simplify" this away.
 */
interface Boxed {
  b: Builder;
}

const box = (b: Builder): Boxed => ({ b });

// =============================================================================
// SCOPING — the one function that must never be bypassed
// =============================================================================

function applyUserScope(builder: Builder, entity: ResolvedEntity, userId: string): Builder {
  if (entity.userScope.kind !== 'column') {
    // Relation-scoped entities are declared but not yet compilable. Refuse
    // rather than emit an unscoped query.
    throw new BizQLValidationError([
      `entity '${entity.key}' uses relation-based user scoping, which the compiler ` +
        `does not implement yet. Refusing to run an unscoped query.`,
    ]);
  }
  return builder.eq(entity.userScope.column, userId);
}

// =============================================================================
// RESOLUTION HELPERS
// =============================================================================

function requireEntity(entityKey: string): ResolvedEntity {
  const entity = CATALOG.entities[entityKey];
  if (!entity) {
    throw new BizQLValidationError([
      `unknown entity '${entityKey}'. Known entities: ${Object.keys(CATALOG.entities).join(', ')}.`,
    ]);
  }
  return entity;
}

function requireReadableField(entity: ResolvedEntity, fieldKey: string): ResolvedField {
  const field = entity.fields[fieldKey];
  if (!field) {
    throw new BizQLValidationError([
      `unknown field '${entity.key}.${fieldKey}'. ` +
        `Known: ${Object.keys(entity.fields).join(', ')}.`,
    ]);
  }
  if (field.readable === false) {
    throw new BizQLValidationError([`field '${entity.key}.${fieldKey}' is not readable.`]);
  }
  return field;
}

/**
 * Resolve a semantic term to storage values via the catalog.
 *
 * An undeclared term is an ERROR, not a pass-through. Silently treating
 * `{$semantic:'banana'}` as the literal string 'banana' would return zero rows
 * and look like a legitimate empty answer — the worst possible failure mode.
 */
function resolveSemantic(
  entity: ResolvedEntity,
  field: ResolvedField,
  value: SemanticValue,
  ctx: QueryContext
): string[] {
  const term = value.$semantic.toLowerCase();
  const resolved = field.semanticTerms?.[term];

  if (!resolved) {
    const known = Object.keys(field.semanticTerms ?? {});
    throw new BizQLValidationError([
      `'${value.$semantic}' is not a declared semantic term for ` +
        `'${entity.key}.${field.key}'.` +
        (known.length ? ` Known terms: ${known.join(', ')}.` : ''),
    ]);
  }

  // For a data-driven field the catalog's values are CLASSIFIERS (stage_type),
  // not storage values. Translate them into this user's own values, resolved by
  // the pre-pass in prefetchEnumSources().
  if (field.enumSource?.semanticColumn) {
    const cacheKey = `${entity.key}.${field.key}`;
    const mapping = ctx._enumCache?.get(cacheKey);

    // The classifier column may not exist on this database (an unapplied
    // migration), in which case there is no trustworthy mapping from a term to
    // this user's values. Refuse, and name the real values — the planner's
    // repair pass then picks one directly. Guessing here is how a query silently
    // returns nobody's leads.
    if (!mapping) {
      const available = ctx._enumValues?.get(cacheKey) ?? [];
      throw new BizQLValidationError([
        `'${entity.key}.${field.key}' is configured per user and cannot be resolved from ` +
          `the term '${value.$semantic}'.` +
          (available.length
            ? ` Use one of this user's actual values: ${available.join(', ')}.`
            : ''),
      ]);
    }

    // No matching stage configured is a legitimate empty answer, not an error:
    // a business with no "past client" stage genuinely has no past clients.
    return resolved.flatMap((classifier) => mapping.get(classifier) ?? []);
  }

  return resolved;
}

/**
 * Resolve data-driven enums for this user, once, before predicates are applied.
 *
 * Kept as a pre-pass so the predicate path stays synchronous — turning value
 * resolution async would ripple through every call site for one field type.
 */
async function prefetchEnumSources(
  supabase: SupabaseClient,
  entity: ResolvedEntity,
  predicates: Predicate[],
  ctx: QueryContext
): Promise<void> {
  const needed = new Set<string>();

  const walk = (list: Predicate[], current: ResolvedEntity) => {
    for (const predicate of list) {
      const p = predicate as unknown as Record<string, unknown>;

      if (typeof p.relation === 'string') {
        const relation = current.relations?.[p.relation];
        const target = relation ? CATALOG.entities[relation.target] : undefined;
        if (target && Array.isArray(p.where)) walk(p.where as Predicate[], target);
        continue;
      }
      for (const key of ['and', 'or'] as const) {
        if (Array.isArray(p[key])) walk(p[key] as Predicate[], current);
      }
      if (p.not) walk([p.not as Predicate], current);

      if (typeof p.field === 'string') {
        // Any reference to a per-user field needs its real values loaded, whether
        // the planner wrote a semantic term or a literal.
        if (current.fields[p.field]?.enumSource) needed.add(`${current.key}.${p.field}`);
      }
    }
  };

  walk(predicates, entity);
  if (needed.size === 0) return;

  ctx._enumCache = ctx._enumCache ?? new Map();

  for (const key of needed) {
    if (ctx._enumCache.has(key)) continue;

    const [entityKey, fieldKey] = key.split('.');
    const source = CATALOG.entities[entityKey]?.fields[fieldKey]?.enumSource;
    // Load values for EVERY per-user field, not only those with a classifier —
    // the values and labels are what let a literal be verified and a label
    // accepted. Gating this on `semanticColumn` silently disabled both.
    if (!source) continue;

    const run = async (columns: string) => {
      let query = supabase.from(source.table).select(columns) as unknown as Builder;
      if (source.scopedToUser) query = query.eq('user_id', ctx.userId);
      return query;
    };

    // Always load the user's real values, and their labels when configured, so a
    // literal can be checked and a label accepted in place of a key.
    const valueColumns = [source.valueColumn, source.labelColumn].filter(Boolean).join(',');
    const plainResult = await run(valueColumns);

    if (!plainResult.error) {
      const values: string[] = [];
      const labelMap = new Map<string, string>();

      for (const row of (plainResult.data ?? []) as QueryRow[]) {
        const value = String(row[source.valueColumn]);
        values.push(value);
        labelMap.set(value.toLowerCase(), value);

        if (source.labelColumn && row[source.labelColumn] != null) {
          // A tutor's stage `family_enrolled` is labelled "לקוח". Accepting the
          // label means the planner may answer in the user's own words.
          labelMap.set(String(row[source.labelColumn]).toLowerCase(), value);
        }
      }

      ctx._enumValues = ctx._enumValues ?? new Map();
      ctx._enumValues.set(key, [...new Set(values)]);
      ctx._enumLabels = ctx._enumLabels ?? new Map();
      ctx._enumLabels.set(key, labelMap);
    }

    if (!source.semanticColumn) continue;

    const withClassifier = await run(`${source.valueColumn},${source.semanticColumn}`);

    if (withClassifier.error) {
      // Classifier column absent (unapplied migration). Real values are already
      // recorded above, so leave the mapping unset and let resolveSemantic refuse
      // rather than guess.
      logger.warn(
        { field: key, column: source.semanticColumn },
        'Classifier column unavailable; semantic terms cannot be resolved for this field'
      );
      continue;
    }

    const mapping = new Map<string, string[]>();
    for (const row of (withClassifier.data ?? []) as QueryRow[]) {
      const classifier = String(row[source.semanticColumn]);
      const value = String(row[source.valueColumn]);
      if (!mapping.has(classifier)) mapping.set(classifier, []);
      mapping.get(classifier)!.push(value);
    }

    logger.debug(
      { field: key, classifiers: [...mapping.keys()] },
      'Resolved data-driven enum for user'
    );

    ctx._enumCache.set(key, mapping);
  }
}

function resolveValue(
  entity: ResolvedEntity,
  field: ResolvedField,
  value: QueryValue,
  ctx: QueryContext
): unknown {
  if (isSemanticValue(value)) return resolveSemantic(entity, field, value, ctx);
  if (isDateExpr(value)) return resolveDateExpr(value, ctx.timezone, field.type);

  if (Array.isArray(value)) {
    // Semantic values may appear INSIDE an array, e.g.
    //   status in [{$semantic:'unpaid'}, {$semantic:'overdue'}]
    // Each expands to a list of stored values, so the result is flattened and
    // de-duplicated. Missing this meant the objects were passed straight to
    // PostgREST, matching nothing and reporting "you have no unpaid invoices".
    const expanded = value.flatMap((v) => {
      if (isSemanticValue(v)) return resolveSemantic(entity, field, v, ctx);
      if (isDateExpr(v)) return [resolveDateExpr(v, ctx.timezone, field.type)];
      return [v];
    });
    return Array.from(new Set(expanded));
  }

  return value;
}

// =============================================================================
// PREDICATES
// =============================================================================

function applyFieldPredicate(
  builder: Builder,
  entity: ResolvedEntity,
  fieldKey: string,
  op: string,
  rawValue: QueryValue | undefined,
  ctx: QueryContext
): Builder {
  const field = requireReadableField(entity, fieldKey);
  const column = field.column;

  if (VALUELESS_OPS.has(op)) {
    return op === 'is_null' ? builder.is(column, null) : builder.not(column, 'is', null);
  }

  if (rawValue === undefined) {
    throw new BizQLValidationError([
      `operator '${op}' on '${entity.key}.${fieldKey}' requires a value.`,
    ]);
  }

  let value = resolveValue(entity, field, rawValue, ctx);

  // For a per-user field, translate a label into its stored value and verify the
  // literal actually exists. Filtering on a stage this business does not have
  // would return zero rows and read as a truthful "you have none".
  if (field.enumSource) {
    const cacheKey = `${entity.key}.${field.key}`;
    const labels = ctx._enumLabels?.get(cacheKey);

    if (labels) {
      const translate = (v: unknown): unknown => {
        if (typeof v !== 'string') return v;
        const mapped = labels.get(v.toLowerCase());
        if (mapped) return mapped;

        throw new BizQLValidationError([
          `"${v}" is not one of this business's ${entity.key}.${field.key} values. ` +
            `Valid values: ${(ctx._enumValues?.get(cacheKey) ?? []).join(', ')}.`,
        ]);
      };

      value = Array.isArray(value) ? value.map(translate) : translate(value);
    }
  }

  // A semantic term expands to a value SET, so `eq` becomes `in` automatically.
  // This is why the planner can write `status eq {$semantic:'open'}` naturally.
  if (Array.isArray(value) && (op === 'eq' || op === 'in')) {
    return builder.in(column, value as string[]);
  }
  if (Array.isArray(value) && (op === 'neq' || op === 'not_in')) {
    return builder.not(column, 'in', `(${(value as string[]).join(',')})`);
  }

  switch (op) {
    case 'eq':
      return builder.eq(column, value as never);
    case 'neq':
      return builder.neq(column, value as never);
    case 'gt':
      return builder.gt(column, value as never);
    case 'gte':
      return builder.gte(column, value as never);
    case 'lt':
      return builder.lt(column, value as never);
    case 'lte':
      return builder.lte(column, value as never);
    case 'contains':
      // Array columns use containment; text columns use case-insensitive LIKE.
      return field.type === 'string[]'
        ? builder.contains(column, [value] as never)
        : builder.ilike(column, `%${String(value)}%`);
    case 'starts_with':
      return builder.ilike(column, `${String(value)}%`);
    case 'overlaps':
      return builder.overlaps(column, value as never);
    default:
      throw new BizQLValidationError([`unsupported operator '${op}'.`]);
  }
}

/**
 * Compile a relation predicate — including the `none` case that PostgREST
 * cannot express.
 *
 * Returns the id set to include or exclude. Both passes are user-scoped.
 */
async function resolveRelationPredicate(
  supabase: SupabaseClient,
  entity: ResolvedEntity,
  predicate: { relation: string; quantifier: 'any' | 'none'; where?: Predicate[] },
  ctx: QueryContext
): Promise<{ column: string; ids: string[]; exclude: boolean }> {
  const relation = entity.relations?.[predicate.relation];
  if (!relation) {
    throw new BizQLValidationError([
      `unknown relation '${entity.key}.${predicate.relation}'.`,
    ]);
  }
  if (relation.via.side !== 'remote') {
    throw new BizQLValidationError([
      `relation '${entity.key}.${predicate.relation}' is not a one-to-many relation; ` +
        `quantifiers apply only to collections.`,
    ]);
  }

  const target = requireEntity(relation.target);

  // Pass 1: which target rows match, and which parent ids do they point at?
  let sub = supabase.from(target.table).select(relation.via.column) as unknown as Builder;
  sub = applyUserScope(sub, target, ctx.userId);
  sub = sub.not(relation.via.column, 'is', null);

  for (const inner of predicate.where ?? []) {
    sub = (await applyPredicate(supabase, sub, target, inner, ctx)).b;
  }

  const { data, error } = await sub.limit(ANTI_JOIN_CAP + 1);
  if (error) throw error;

  const ids: string[] = Array.from(
    new Set(
      (data ?? [])
        .map((r: QueryRow): unknown => r[relation.via.column])
        .filter((v: unknown): v is string => typeof v === 'string' && v.length > 0)
    )
  );

  if (ids.length > ANTI_JOIN_CAP) {
    throw new ResultSetTooLargeError(target.key, ids.length, ANTI_JOIN_CAP);
  }

  return {
    column: CATALOG.entities[entity.key].fields.id?.column ?? 'id',
    ids,
    exclude: predicate.quantifier === 'none',
  };
}

async function applyPredicate(
  supabase: SupabaseClient,
  builder: Builder,
  entity: ResolvedEntity,
  predicate: Predicate,
  ctx: QueryContext
): Promise<Boxed> {
  // --- derived fields lower to relation predicates before anything else -----
  if (isFieldPredicate(predicate)) {
    const derived = entity.derived?.[predicate.field];

    if (derived) {
      // `has_completed_intake eq false` → the NONE quantifier; `eq true` → ANY.
      const wantsTrue = predicate.value !== false;
      const baseQuantifier = derived.expand.quantifier === 'none' ? 'none' : 'any';
      const quantifier: 'any' | 'none' = wantsTrue
        ? baseQuantifier
        : baseQuantifier === 'any'
          ? 'none'
          : 'any';

      return applyPredicate(
        supabase,
        builder,
        entity,
        {
          relation: derived.expand.relation,
          quantifier,
          where: (derived.expand.where ?? []) as Predicate[],
        },
        ctx
      );
    }

    return box(
      applyFieldPredicate(builder, entity, predicate.field, predicate.op, predicate.value, ctx)
    );
  }

  if (isRelationPredicate(predicate)) {
    const { column, ids, exclude } = await resolveRelationPredicate(
      supabase,
      entity,
      predicate,
      ctx
    );

    if (exclude) {
      // NOT EXISTS. With an empty set every row qualifies, and PostgREST cannot
      // parse `not.in.()`, so skip the filter entirely.
      if (ids.length === 0) return box(builder);
      return box(builder.not(column, 'in', `(${ids.join(',')})`));
    }

    // EXISTS. An empty set means nothing qualifies; force an empty result
    // rather than silently dropping the filter.
    if (ids.length === 0) {
      return box(builder.in(column, ['00000000-0000-0000-0000-000000000000']));
    }
    return box(builder.in(column, ids));
  }

  if (isAndPredicate(predicate)) {
    let next = builder;
    for (const inner of predicate.and) {
      next = (await applyPredicate(supabase, next, entity, inner, ctx)).b;
    }
    return box(next);
  }

  if (isOrPredicate(predicate)) {
    // PostgREST `.or()` takes a filter string and cannot host sub-queries, so
    // only simple field predicates are supported inside OR for now.
    const clauses = predicate.or.map((inner) => {
      if (!isFieldPredicate(inner)) {
        throw new BizQLValidationError([
          `OR currently supports only simple field predicates; ` +
            `received ${JSON.stringify(inner).slice(0, 80)}.`,
        ]);
      }
      const field = requireReadableField(entity, inner.field);
      if (inner.op === 'is_null') return `${field.column}.is.null`;
      if (inner.op === 'is_not_null') return `${field.column}.not.is.null`;

      const value = resolveValue(entity, field, inner.value as QueryValue, ctx);
      if (Array.isArray(value)) return `${field.column}.in.(${value.join(',')})`;
      return `${field.column}.${inner.op}.${String(value)}`;
    });
    return box(builder.or(clauses.join(',')));
  }

  if (isNotPredicate(predicate)) {
    const inner = predicate.not;
    if (isRelationPredicate(inner)) {
      return applyPredicate(
        supabase,
        builder,
        entity,
        { ...inner, quantifier: inner.quantifier === 'any' ? 'none' : 'any' },
        ctx
      );
    }
    throw new BizQLValidationError([
      `NOT currently supports only relation predicates; invert the operator instead.`,
    ]);
  }

  throw new BizQLValidationError([
    `unrecognised predicate: ${JSON.stringify(predicate).slice(0, 120)}.`,
  ]);
}

// =============================================================================
// SELECT
// =============================================================================

function buildSelect(entity: ResolvedEntity, query: FindQuery): string {
  const requested = query.select?.length
    ? query.select
    : (entity.displayFields ?? Object.keys(entity.fields));

  // The primary key is always fetched: actions and fan-out need a target id.
  const keys = new Set<string>(['id', ...requested]);
  const columns: string[] = [];

  for (const key of keys) {
    const field = entity.fields[key];
    if (!field) {
      throw new BizQLValidationError([`unknown field '${entity.key}.${key}' in select.`]);
    }
    if (field.readable === false) {
      throw new BizQLValidationError([`field '${entity.key}.${key}' is not readable.`]);
    }
    columns.push(field.column);
  }

  for (const include of query.include ?? []) {
    const relation = entity.relations?.[include.relation];
    if (!relation) {
      throw new BizQLValidationError([
        `unknown relation '${entity.key}.${include.relation}' in include.`,
      ]);
    }
    const target = requireEntity(relation.target);
    const targetColumns = (include.select?.length
      ? include.select
      : (target.displayFields ?? Object.keys(target.fields))
    ).map((key) => requireReadableField(target, key).column);

    // PostgREST embedded resource, in BOTH directions.
    //
    //   many-to-one ('local')  — the FK is on this table, so the embed is the
    //                            single parent row: an invoice's contact.
    //   one-to-many ('remote') — the FK is on the target, so the embed is an
    //                            array: a contact's invoices.
    //
    // The one-to-many case is what makes "which clients have an unpaid invoice"
    // expressible the way a person actually phrases it — entity contacts, with
    // their invoices attached — rather than forcing the inverse query.
    //
    // The FK column is named explicitly (`!contact_id`). Two tables can be
    // related by more than one FK — scheduling_bookings references both
    // crm_contacts and payment_invoices — and without the hint PostgREST cannot
    // tell which relationship is meant, and errors at query time.
    const embed =
      `${include.relation}:${target.table}!${relation.via.column}` +
      `(${['id', ...targetColumns].join(',')})`;

    columns.push(embed);
  }

  return columns.join(',');
}

// =============================================================================
// PUBLIC ENTRY POINTS
// =============================================================================

export async function compileAndRunFind(
  supabase: SupabaseClient,
  query: FindQuery,
  ctx: QueryContext
): Promise<FindResult> {
  const entity = requireEntity(query.entity);

  const maxLimit = entity.maxLimit ?? 500;
  const limit = Math.min(query.limit ?? entity.defaultLimit ?? 50, maxLimit);

  let builder = supabase
    .from(entity.table)
    .select(buildSelect(entity, query)) as unknown as Builder;

  builder = applyUserScope(builder, entity, ctx.userId);

  // Scope embedded child rows explicitly as well.
  //
  // A child reached through its parent's FK already belongs to the same tenant,
  // so this is redundant today — which is exactly why it is worth having. The
  // whole product's isolation rests on user_id filters, and "it is implied by
  // the join" is the kind of reasoning that stops being true after a schema
  // change nobody re-examined.
  for (const include of (query as unknown as FindQuery).include ?? []) {
    const relation = entity.relations?.[include.relation];
    if (!relation) continue;
    const target = CATALOG.entities[relation.target];
    if (target?.userScope.kind === 'column') {
      builder = builder.eq(`${include.relation}.${target.userScope.column}`, ctx.userId);
    }
  }

  await prefetchEnumSources(supabase, entity, query.where ?? [], ctx);

  for (const predicate of query.where ?? []) {
    builder = (await applyPredicate(supabase, builder, entity, predicate, ctx)).b;
  }

  for (const sort of query.order_by ?? []) {
    const field = requireReadableField(entity, sort.field);
    builder = builder.order(field.column, { ascending: sort.dir === 'asc' });
  }

  if (query.offset) {
    builder = builder.range(query.offset, query.offset + limit); // inclusive; +1 row probe
  } else {
    builder = builder.limit(limit + 1); // one extra row detects truncation
  }

  const { data, error } = await builder;
  if (error) throw error;

  const rows = (data ?? []) as QueryRow[];
  const truncated = rows.length > limit;

  logger.debug(
    {
      entity: query.entity,
      consumer: ctx.consumer ?? 'unknown',
      rows: Math.min(rows.length, limit),
      truncated,
    },
    'BizQL find executed'
  );

  return {
    op: 'find',
    entity: query.entity,
    rows: truncated ? rows.slice(0, limit) : rows,
    truncated,
    limit,
  };
}

export async function compileAndRunCompute(
  supabase: SupabaseClient,
  query: ComputeQuery,
  ctx: QueryContext
): Promise<ComputeResult> {
  const entity = requireEntity(query.entity);
  const { fn, field: aggFieldKey } = query.agg;

  if (fn !== 'count' && !aggFieldKey) {
    throw new BizQLValidationError([`aggregate '${fn}' requires a field.`]);
  }

  const aggField = aggFieldKey ? requireReadableField(entity, aggFieldKey) : undefined;
  const groupField = query.group_by ? requireReadableField(entity, query.group_by) : undefined;

  const columns = [
    ...(aggField ? [aggField.column] : []),
    ...(groupField ? [groupField.column] : []),
  ];

  let builder = supabase
    .from(entity.table)
    .select(columns.length ? columns.join(',') : 'id') as unknown as Builder;

  builder = applyUserScope(builder, entity, ctx.userId);

  // Scope embedded child rows explicitly as well.
  //
  // A child reached through its parent's FK already belongs to the same tenant,
  // so this is redundant today — which is exactly why it is worth having. The
  // whole product's isolation rests on user_id filters, and "it is implied by
  // the join" is the kind of reasoning that stops being true after a schema
  // change nobody re-examined.
  for (const include of (query as unknown as FindQuery).include ?? []) {
    const relation = entity.relations?.[include.relation];
    if (!relation) continue;
    const target = CATALOG.entities[relation.target];
    if (target?.userScope.kind === 'column') {
      builder = builder.eq(`${include.relation}.${target.userScope.column}`, ctx.userId);
    }
  }

  await prefetchEnumSources(supabase, entity, query.where ?? [], ctx);

  for (const predicate of query.where ?? []) {
    builder = (await applyPredicate(supabase, builder, entity, predicate, ctx)).b;
  }

  const { data, error } = await builder.limit(AGGREGATE_SCAN_CAP + 1);
  if (error) throw error;

  const rows = (data ?? []) as QueryRow[];
  const approximate = rows.length > AGGREGATE_SCAN_CAP;
  const scanned = approximate ? rows.slice(0, AGGREGATE_SCAN_CAP) : rows;

  const reduce = (values: number[]): number | null => {
    if (fn === 'count') return values.length;
    if (values.length === 0) return null;
    switch (fn) {
      case 'sum':
        return values.reduce((a, b) => a + b, 0);
      case 'avg':
        return values.reduce((a, b) => a + b, 0) / values.length;
      case 'min':
        return Math.min(...values);
      case 'max':
        return Math.max(...values);
      default:
        return null;
    }
  };

  const numeric = (row: QueryRow): number =>
    aggField ? Number(row[aggField.column] ?? 0) : 0;

  if (groupField) {
    const buckets = new Map<string, number[]>();
    for (const row of scanned) {
      const key = String(row[groupField.column] ?? '—');
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(numeric(row));
    }
    const groups = Array.from(buckets.entries())
      .map(([key, values]) => ({ key, value: reduce(values) ?? 0 }))
      .sort((a, b) => b.value - a.value);

    return { op: 'compute', entity: query.entity, value: null, groups, approximate };
  }

  return {
    op: 'compute',
    entity: query.entity,
    value: reduce(scanned.map(numeric)),
    approximate,
  };
}

/** Run any BizQL query. The entry point all three consumers should call. */
export async function runQuery(
  supabase: SupabaseClient,
  query: Query,
  ctx: QueryContext
): Promise<QueryResult> {
  if (!ctx.userId) {
    throw new BizQLValidationError(['QueryContext.userId is required.']);
  }
  if (query.op === 'compute') return compileAndRunCompute(supabase, query, ctx);

  if (query.op === 'mutate' || query.op === 'for_each') {
    // Writes deliberately do not go through this compiler — see MutateExecutor
    // and ForEachExecutor for why. Routing one here would bypass every write
    // guard: bulk opt-in, fan-out caps, idempotency and the daily quota.
    throw new BizQLValidationError([
      `'${query.op}' steps must be executed via their own executor, not the query compiler.`,
    ]);
  }

  return compileAndRunFind(supabase, query, ctx);
}
