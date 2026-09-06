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
 * If you add a code path that builds a query, it MUST open the table through
 * `scopedFrom`. That is the only function that calls `.from()` on an entity's
 * table, and it produces the select and the tenant filter together — so a new
 * read path cannot be one forgotten line away from returning every tenant's
 * rows. (Two helpers in the foreign-key repair filter inline instead; both
 * refuse outright unless the entities involved are column-scoped.)
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
  type IncludeSpec,
  type Predicate,
  type Query,
  type QueryContext,
  type QueryResult,
  type QueryRow,
  type QueryValue,
  type SemanticValue,
  type UnmatchedFilter,
} from './types';
import { resolveDateExpr } from './dates';
import { relationPredicateProblem } from './predicateRules';
import { parseGroupBy, bucketKey, type GroupSpec } from './groupBy';

const logger = createLogger({ module: 'BizQLCompiler' });

/** Guards the foreign-key repair: only an id-shaped value is worth looking up. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Ceiling on an anti-join's intermediate id set. Above this we refuse rather
 * than truncate, because a silently truncated NOT-IN produces a WRONG answer
 * (contacts would be reported as "no intake" when they have one).
 */
const ANTI_JOIN_CAP = 10_000;

/** Ceiling on rows scanned for a JS-side aggregate. */
const AGGREGATE_SCAN_CAP = 5_000;

/**
 * Rows scanned to deduplicate an entity that records repeats.
 *
 * Matched to AGGREGATE_SCAN_CAP on purpose: a list and a count of the same
 * entity must not disagree because they looked at different amounts of data.
 */
const DEDUPE_SCAN_CAP = 5_000;

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

/**
 * Alias for the ownership join, chosen not to collide with any relation a caller
 * might also be selecting.
 */
const SCOPE_ALIAS = 'owner_scope';

/**
 * The join a relation-scoped entity needs in its SELECT to be scopable at all.
 *
 * Some tables carry no `user_id`: `smart_link_clicks` records a click against a
 * link, and only the link knows whose it is. Ownership is then one hop away, and
 * the hop must be an INNER join.
 *
 * `!inner` is the whole safety property. A plain PostgREST embed is a LEFT join:
 * filtering `link.user_id` on one returns every click row with `link: null`
 * attached, which is not a filtered result — it is the entire table, for every
 * tenant, wearing a filter that did nothing. With `!inner`, a row whose link
 * fails the filter is not returned at all.
 */
function userScopeEmbed(entity: ResolvedEntity): string | null {
  if (entity.userScope.kind !== 'relation') return null;

  const relationKey = entity.userScope.relation;
  const relation = entity.relations?.[relationKey];
  if (!relation) {
    throw new BizQLValidationError([
      `entity '${entity.key}' is scoped through relation '${relationKey}', which it ` +
        `does not declare. Refusing to run an unscoped query.`,
    ]);
  }

  const target = CATALOG.entities[relation.target];
  if (!target || target.userScope.kind !== 'column') {
    // Only one hop. A chain of relation-scoped entities is a scope whose
    // correctness nobody can check by reading one definition.
    throw new BizQLValidationError([
      `entity '${entity.key}' is scoped through '${relation.target}', which is not ` +
        `itself column-scoped. Refusing to run an unscoped query.`,
    ]);
  }

  // Under its OWN alias, never the relation's name.
  //
  // `link_clicks` also displays its link, so the select already embeds
  // `link:smart_links(...)`. Emitting the scope join under the same name made
  // PostgREST join one table twice under one alias — "table name
  // smart_link_clicks_link_1 specified more than once" — and the query failed
  // outright. Aliasing the scope join keeps it independent of whatever the
  // caller happens to be displaying, which is the property it needs: the tenant
  // filter must not depend on the shape of the select around it.
  return (
    `${SCOPE_ALIAS}:${target.table}!${relation.via.column}` +
    `!inner(${target.userScope.column})`
  );
}

function applyUserScope(builder: Builder, entity: ResolvedEntity, userId: string): Builder {
  if (entity.userScope.kind === 'column') {
    return builder.eq(entity.userScope.column, userId);
  }

  const relation = entity.relations![entity.userScope.relation];
  const target = CATALOG.entities[relation.target];

  // Reaches the joined table, and only bites because the embed is `!inner`.
  return builder.eq(
    `${SCOPE_ALIAS}.${(target.userScope as { column: string }).column}`,
    userId
  );
}

/**
 * The ONLY way this compiler opens a table.
 *
 * Scoping used to be a call you made after building a select, which meant a new
 * read path was one forgotten line away from returning every tenant's rows. It
 * is now impossible to obtain a builder without the scope: the select and the
 * filter are produced together, from the same entity definition, here.
 */
function scopedFrom(
  supabase: SupabaseClient,
  entity: ResolvedEntity,
  columns: string[],
  userId: string
): Builder {
  const embed = userScopeEmbed(entity);
  const select = [...(columns.length ? columns : ['id']), ...(embed ? [embed] : [])].join(',');

  const builder = supabase.from(entity.table).select(select) as unknown as Builder;

  return applyUserScope(builder, entity, userId);
}

// =============================================================================
// UNMATCHED FILTERS — telling "nobody by that name" apart from "owes nothing"
// =============================================================================

/**
 * A QueryContext with somewhere to record filters that named nothing.
 *
 * The collector is internal and per-query. It is NOT on the public
 * `QueryContext`, because a caller must not be able to pre-seed it — what was
 * unmatched is a fact the compiler observes, not an input it accepts.
 */
type CompileContext = QueryContext & {
  /** Definitely unmatched: the sub-query itself found nothing. */
  _unmatched?: UnmatchedFilter[];
  /**
   * Unmatched ONLY IF the result comes back empty.
   *
   * A filter on this entity's own name cannot be judged when it is applied —
   * `description contains 'pottery workshop'` is a perfectly good filter, and
   * whether anything answers to that name is not known until the rows come
   * back. So it is held here and promoted at the end, when emptiness is a fact
   * rather than a guess.
   */
  _candidates?: UnmatchedFilter[];
};

/**
 * The literal the user actually named, from inside a relation predicate.
 *
 * Only text matched by equality or containment counts. A date range or a number
 * comparison matching nothing is a genuine empty result — "no invoices over
 * $10,000" is a true and useful answer — whereas a NAME matching nothing means
 * the thing itself was never found, which is a different sentence entirely.
 */
function namedLiteral(where: Predicate[] | undefined): string | null {
  for (const predicate of where ?? []) {
    if (isFieldPredicate(predicate)) {
      const { op, value } = predicate;
      if ((op === 'eq' || op === 'contains' || op === 'starts_with') && typeof value === 'string') {
        // A uuid is an id the planner carried, not a name a person said. The
        // foreign-key repair already handles those.
        if (!UUID_PATTERN.test(value) && value.trim().length > 1) return value;
      }
    }
    if (isAndPredicate(predicate)) {
      const nested = namedLiteral(predicate.and);
      if (nested) return nested;
    }
    if (isOrPredicate(predicate)) {
      const nested = namedLiteral(predicate.or);
      if (nested) return nested;
    }
  }
  return null;
}


/**
 * Note a filter that asks for something BY NAME.
 *
 * Only the fields by which a row is identified count — the label the entity is
 * known by, and whatever free-text search covers. That distinction is the whole
 * of the judgement here:
 *
 *   description contains "pottery workshop"  → a NAME. Nothing matching it means
 *                                              no such thing exists.
 *   amount > 10000                           → a CONDITION. Nothing matching it
 *                                              is a true and useful answer.
 *
 * Getting this wrong in the cautious direction would be its own bug: answering
 * "no invoices found matching 10000" to "any invoices over $10,000?" would turn
 * a correct no into a non-answer.
 */
function recordIdentifyingFilter(
  entity: ResolvedEntity,
  field: ResolvedField,
  op: string,
  rawValue: QueryValue | undefined,
  ctx: QueryContext
): void {
  const candidates = (ctx as CompileContext)._candidates;
  if (!candidates) return;

  if (op !== 'eq' && op !== 'contains' && op !== 'starts_with') return;
  if (typeof rawValue !== 'string' || rawValue.trim().length < 2) return;
  // An id is not a name; the foreign-key repair covers those.
  if (UUID_PATTERN.test(rawValue)) return;

  const labelKeys = Array.isArray(entity.labelField) ? entity.labelField : [entity.labelField];
  const identifying = new Set([...labelKeys, ...(entity.searchableFields ?? [])]);

  if (identifying.has(field.key)) {
    candidates.push({ entity: entity.key, value: rawValue });
  }
}


/**
 * Decide what to report as unmatched, now that emptiness is known.
 *
 * Definite entries stand on their own — the sub-query behind them found nothing,
 * whatever the outer result turned out to be. Candidates are promoted only when
 * the result really is empty, because a name filter that matched something is
 * not unmatched, however it was phrased.
 */
function reportUnmatched(
  definite: UnmatchedFilter[],
  candidates: UnmatchedFilter[],
  isEmpty: boolean
): { unmatched?: UnmatchedFilter[] } {
  const all = [...definite, ...(isEmpty ? candidates : [])];
  if (all.length === 0) return {};

  // The same name can be filtered in more than one place in one query.
  const seen = new Set<string>();
  const unique = all.filter((u) => {
    const key = `${u.entity}::${u.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { unmatched: unique };
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

    /*
     * Values in USE that the configuration does not account for.
     *
     * The mapping above says what each configured option means. It says nothing
     * about rows holding a value that was configured once and later renamed or
     * removed — those match no classifier, so every semantic filter skips them
     * silently and the row becomes invisible rather than miscategorised.
     *
     * One extra scoped read, only on a field a semantic actually asked for.
     */
    const owner = CATALOG.entities[entityKey];
    const ownerField = owner?.fields[fieldKey];

    // Only a user-scoped table can be read this way; a relation-scoped entity
    // would need the join, and guessing the column would read someone else's
    // rows. Skipping is correct: no report is better than a wrong one.
    if (owner && ownerField && owner.userScope.kind === 'column') {
      const configured = new Set([...mapping.values()].flat());

      const { data: inUse } = await supabase
        .from(owner.table)
        .select(ownerField.column)
        .eq(owner.userScope.column, ctx.userId)
        .not(ownerField.column, 'is', null)
        .limit(1000);

      const orphans = [
        ...new Set(
          ((inUse ?? []) as QueryRow[])
            .map((row) => String(row[ownerField.column]))
            .filter((value) => value && !configured.has(value))
        ),
      ];

      if (orphans.length > 0) {
        logger.warn(
          { entity: entityKey, field: fieldKey, orphans, configured: [...configured] },
          'Rows hold a value the configuration does not account for'
        );
        ctx._enumOrphans = ctx._enumOrphans ?? [];
        ctx._enumOrphans.push({ field: fieldKey, values: orphans });
      }
    }
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

  // Anything else object-shaped is an invention, and must not reach PostgREST.
  //
  // Asked "how much does Gregory Fenwick owe me", the planner emitted
  //   {"field":"contact_id","op":"eq","value":{"$find":{"where":[…]}}}
  // — a sub-query construct BizQL does not have. `value` accepts a literal, an
  // array, {"$semantic":…} or {"$date":…}; an unrecognised object fell through
  // this return and was handed to the database, which answered
  //   invalid input syntax for type uuid: "[object Object]"
  // and took the whole request down.
  //
  // The write path has refused unknown objects since `resolveWriteValue`, for
  // the same reason and with the same reasoning. Reads did not, so an invented
  // filter shape crashed instead of being repaired. The message names the forms
  // that DO exist, because it is what the repair pass reads.
  if (value !== null && typeof value === 'object') {
    throw new BizQLValidationError([
      `'${entity.key}.${field.key}' was given a value the compiler cannot use ` +
        `(${JSON.stringify(value).slice(0, 80)}). A filter value must be a literal, ` +
        `an array of literals, {"$semantic":"…"} or {"$date":"…"} — a filter cannot ` +
        `contain another query. Find the rows you want in an earlier step, or filter ` +
        `this entity's own fields directly.`,
    ]);
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

  recordIdentifyingFilter(entity, field, op, rawValue, ctx);

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
  // The same rule the validator applies, from the same definition. A plan that
  // reaches the compiler unvalidated (a cached plan, a direct API caller) must
  // not get a different answer than one that went through validatePlan.
  const shape = relationPredicateProblem(entity, predicate.relation, predicate.where);
  if (shape) throw new BizQLValidationError([shape]);

  const target = requireEntity(relation.target);

  // A relation filter works in BOTH directions, with the same two passes:
  //
  //   one-to-many ('remote') — "contacts with an unpaid invoice". Collect the
  //     PARENT ids the matching children point at, then filter parents by id.
  //
  //   many-to-one ('local')  — "invoices belonging to Ofir". Collect the matching
  //     PARENT ids, then filter by this table's foreign key.
  //
  // Rejecting the second was wrong: "which invoices belong to X" is an ordinary
  // question, and refusing it forced the planner into shapes that then failed.
  const toOne = relation.via.side === 'local';

  // What to select from the target: the FK back to us, or the target's own id.
  const targetIdColumn = toOne
    ? (target.fields.id?.column ?? 'id')
    : relation.via.column;

  let sub = scopedFrom(supabase, target, [targetIdColumn], ctx.userId);

  if (!toOne) {
    // A child with a null FK points at no parent, so it can never match.
    sub = sub.not(relation.via.column, 'is', null);
  }

  for (const inner of predicate.where ?? []) {
    sub = (await applyPredicate(supabase, sub, target, inner, ctx)).b;
  }

  const { data, error } = await sub.limit(ANTI_JOIN_CAP + 1);
  if (error) throw error;

  const ids: string[] = Array.from(
    new Set(
      (data ?? [])
        .map((r: QueryRow): unknown => r[targetIdColumn])
        .filter((v: unknown): v is string => typeof v === 'string' && v.length > 0)
    )
  );

  if (ids.length > ANTI_JOIN_CAP) {
    throw new ResultSetTooLargeError(target.key, ids.length, ANTI_JOIN_CAP);
  }

  // Nothing matched, and the predicate named something. The filter that follows
  // will empty the result — but for a reason the user needs to hear, because
  // "you have no invoices for the pottery workshop" and "there is no pottery
  // workshop" are answers to different questions.
  //
  // `none` is deliberately excluded: an anti-join over an empty set is not a
  // failed lookup, it is the trivially-true case, and every row correctly
  // matches.
  if (ids.length === 0 && predicate.quantifier === 'any') {
    const named = namedLiteral(predicate.where);
    if (named) {
      (ctx as CompileContext)._unmatched?.push({ entity: target.key, value: named });
    }
  }

  return {
    // Filter this table by its own id (one-to-many) or by the FK pointing at the
    // matched parents (many-to-one).
    column: toOne
      ? relation.via.column
      : (CATALOG.entities[entity.key].fields.id?.column ?? 'id'),
    ids,
    exclude: predicate.quantifier === 'none',
  };
}

/**
 * Repairs a foreign-key filter that was handed an id from the wrong table.
 *
 * After a list of invoices, the conversation remembers each row as
 * `{ id, label }` — and the label carries the CLIENT'S NAME, e.g.
 * "אופיר עמר (INV-00003)". Asked "how much does אופיר owe me in total", the
 * planner matches that name against the remembered rows and reuses that row's
 * id, which is the INVOICE's id, as `contact_id`.
 *
 * Nothing matches, so `sum` over an empty set answered "אופיר owes you 0" —
 * a confident, wrong financial figure, indistinguishable from a real zero.
 * Writes have been guarded against this since assertReferencesOwned; reads
 * were not.
 *
 * The id is not garbage, it is just the wrong end of the relationship: the row
 * it identifies knows the contact. So dereference it — read the row and use the
 * value it holds in the very column being filtered — and the user gets the
 * answer they asked for instead of a zero.
 *
 * @returns the corrected value, or the original when there is nothing to fix.
 */
async function repairForeignKeyValue(
  supabase: SupabaseClient,
  entity: ResolvedEntity,
  field: ResolvedField,
  value: QueryValue,
  ctx: QueryContext
): Promise<QueryValue> {
  const targetKey = field.references;
  if (!targetKey || typeof value !== 'string' || !UUID_PATTERN.test(value)) return value;
  if (entity.userScope.kind !== 'column') return value;

  const target = CATALOG.entities[targetKey];
  if (!target || target.userScope.kind !== 'column') return value;

  // Does the id name a row in the table this column points at? Almost always
  // yes, and then there is nothing to do.
  const { data: referenced } = await supabase
    .from(target.table)
    .select('id')
    .eq('id', value)
    .eq(target.userScope.column, ctx.userId)
    .maybeSingle();
  if (referenced) return value;

  // It does not. If it names a row of the entity being queried, that row holds
  // the foreign key we actually wanted.
  const { data: own } = await supabase
    .from(entity.table)
    .select(field.column)
    .eq('id', value)
    .eq(entity.userScope.column, ctx.userId)
    .maybeSingle();

  const dereferenced = (own as Record<string, unknown> | null)?.[field.column];
  if (typeof dereferenced === 'string' && dereferenced) {
    logger.warn(
      {
        entity: entity.key,
        field: field.column,
        suppliedId: value,
        resolvedId: dereferenced,
      },
      'Foreign-key filter carried an id from the queried table; dereferenced it'
    );
    return dereferenced;
  }

  // Neither a valid reference nor a row we can dereference. Left alone: the
  // filter will match nothing, which is the honest outcome for an id that
  // names nothing this user owns.
  return value;
}

async function applyPredicate(
  supabase: SupabaseClient,
  builder: Builder,
  entity: ResolvedEntity,
  predicate: Predicate,
  ctx: QueryContext
): Promise<Boxed> {
  // Relation is checked BEFORE field, matching validatePlan's precedence.
  // These two disagreed once — the validator accepted a predicate carrying both
  // and the compiler threw on it — so the ordering is deliberate, not incidental.
  if (isRelationPredicate(predicate)) {
    const { column, ids, exclude } = await resolveRelationPredicate(
      supabase,
      entity,
      predicate,
      ctx
    );

    if (exclude) {
      if (ids.length === 0) return box(builder);
      return box(builder.not(column, 'in', `(${ids.join(',')})`));
    }

    if (ids.length === 0) {
      return box(builder.in(column, ['00000000-0000-0000-0000-000000000000']));
    }
    return box(builder.in(column, ids));
  }

  // --- derived fields lower to relation predicates before anything else -----
  if (isFieldPredicate(predicate)) {
    const derived = entity.derived?.[predicate.field];

    if (derived) {
      // `has_completed_intake eq false` → the NONE quantifier; `eq true` → ANY.
      const wantsTrue = predicate.value !== false;
      const expansions = Array.isArray(derived.expand) ? derived.expand : [derived.expand];

      /*
       * Several expansions are OR'd, by unioning the ids each one matches.
       *
       * A row satisfies "owes me money" if it is owed on an invoice OR on a
       * plan period. Applying the relation predicates in sequence would AND
       * them — demanding both — which is not what any reader means, and would
       * return nobody.
       *
       * `eq false` then means NONE of them: the complement of the same union,
       * which is why the exclusion is decided once here rather than per route.
       */
      const matchedIds = new Set<string>();
      let column = '';

      for (const expansion of expansions) {
        const resolved = await resolveRelationPredicate(
          supabase,
          entity,
          {
            relation: expansion.relation,
            quantifier: 'any',
            where: (expansion.where ?? []) as Predicate[],
          },
          ctx
        );

        column = resolved.column;
        for (const id of resolved.ids) matchedIds.add(id);
      }

      const anyMeansPresent = expansions[0].quantifier !== 'none';
      const include = wantsTrue ? anyMeansPresent : !anyMeansPresent;
      const ids = [...matchedIds];

      if (!include) {
        // Nothing matched, so nothing is excluded — every row qualifies.
        if (ids.length === 0) return box(builder);
        return box(builder.not(column, 'in', `(${ids.join(',')})`));
      }

      if (ids.length === 0) {
        return box(builder.in(column, ['00000000-0000-0000-0000-000000000000']));
      }
      return box(builder.in(column, ids));
    }

    // A foreign key filtered with an id from the wrong table is repaired here
    // rather than silently matching nothing — see repairForeignKeyValue.
    const fieldMeta = entity.fields[predicate.field];
    const value =
      fieldMeta?.references && (predicate.op === 'eq' || predicate.op === 'neq')
        ? await repairForeignKeyValue(supabase, entity, fieldMeta, predicate.value as QueryValue, ctx)
        : predicate.value;

    return box(
      applyFieldPredicate(builder, entity, predicate.field, predicate.op, value, ctx)
    );
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

  // Always fetch what a row cannot be presented or processed without:
  // the primary key, the label field(s), everything the card displays, and the
  // dedupe key.
  //
  // Twice now a planner-chosen `select` has silently broken a downstream layer:
  // omitting the label field made rows render as truncated uuids, and omitting
  // the dedupe key made deduplication a no-op — the same finding appeared
  // twenty times because every key read as empty. These columns are not the
  // caller's to omit.
  const labelKeys = Array.isArray(entity.labelField)
    ? entity.labelField
    : [entity.labelField];

  const keys = new Set<string>([
    'id',
    ...labelKeys,
    ...(entity.displayFields ?? []),
    ...(entity.dedupeBy ? [entity.dedupeBy] : []),
    ...requested,
  ]);
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

  // Merge the caller's includes with the relations the catalog says a row needs
  // in order to be meaningful, without duplicating one the caller already asked for.
  const requestedRelations = new Set((query.include ?? []).map((i) => i.relation));
  const includes: IncludeSpec[] = [
    ...(query.include ?? []),
    ...(entity.displayRelations ?? [])
      .filter((r) => !requestedRelations.has(r) && entity.relations?.[r])
      .map((r): IncludeSpec => ({ relation: r })),
  ];

  for (const include of includes) {
    const relation = entity.relations?.[include.relation];
    if (!relation) {
      throw new BizQLValidationError([
        `unknown relation '${entity.key}.${include.relation}' in include.`,
      ]);
    }
    const target = requireEntity(relation.target);

    /*
     * Always fetch what the embedded row is CALLED.
     *
     * The columns come from the target's `displayFields`, which need not
     * include its `labelField` — and `transactions` is exactly that case: it
     * displays amount, currency, status and paid_at, and is named by its
     * `description`. So an embedded payment arrived with no description, the
     * renderer had nothing to label it with, and fell back to the first eight
     * characters of its uuid. A refunds report read "56a24794" where it should
     * have read the payment.
     *
     * Added rather than substituted: the display fields are still what the
     * reader asked to see. This only guarantees the row can say its own name.
     */
    const labelKeys = Array.isArray(target.labelField)
      ? target.labelField
      : [target.labelField].filter(Boolean);

    const requestedKeys = include.select?.length
      ? include.select
      : (target.displayFields ?? Object.keys(target.fields));

    const targetColumns = [
      ...new Set(
        [...requestedKeys, ...(labelKeys as string[])]
          .filter((key) => target.fields[key] && target.fields[key].readable !== false)
          .map((key) => requireReadableField(target, key).column)
      ),
    ];

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

  // Per query, and created here rather than accepted from the caller.
  const unmatched: UnmatchedFilter[] = [];
  const candidates: UnmatchedFilter[] = [];
  ctx = { ...ctx, _unmatched: unmatched, _candidates: candidates } as CompileContext;

  let builder = scopedFrom(supabase, entity, [buildSelect(entity, query)], ctx.userId);

  // Scope embedded child rows explicitly as well.
  //
  // A child reached through its parent's FK already belongs to the same tenant,
  // so this is redundant today — which is exactly why it is worth having. The
  // whole product's isolation rests on user_id filters, and "it is implied by
  // the join" is the kind of reasoning that stops being true after a schema
  // change nobody re-examined.
  const embedded = new Set<string>([
    ...((query as unknown as FindQuery).include ?? []).map((i) => i.relation),
    ...(entity.displayRelations ?? []),
  ]);

  for (const relationKey of embedded) {
    const relation = entity.relations?.[relationKey];
    if (!relation) continue;
    const target = CATALOG.entities[relation.target];
    if (target?.userScope.kind === 'column') {
      builder = builder.eq(`${relationKey}.${target.userScope.column}`, ctx.userId);
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
    // With a dedupe key, the window has to be wide enough to reach PAST the
    // repeats, not merely wider than the limit.
    //
    // A multiple of the limit is the intuitive choice and it is wrong: the
    // duplication factor is a property of the DATA, not of how many rows were
    // asked for. `insights` holds ~500 copies of one detection, so a 20x window
    // (200 rows) landed entirely inside the first detector — "show me my
    // insights" answered with ONE finding while "how many insights" said two,
    // and neither number was reachable from the other. A fixed scan cap keeps
    // the two consistent; the rows are narrow and this runs once.
    const fetchSize = entity.dedupeBy
      ? Math.max(limit + 1, DEDUPE_SCAN_CAP)
      : limit + 1;
    builder = builder.limit(fetchSize);
  }

  const { data, error } = await builder;
  if (error) throw error;

  let rows = (data ?? []) as QueryRow[];
  let collapsed = 0;

  // Collapse repeated rows before the limit is applied, so a page of results is
  // a page of DISTINCT results rather than one finding twenty times.
  const dedupeField = entity.dedupeBy ? entity.fields[entity.dedupeBy] : undefined;
  if (dedupeField) {
    const seen = new Set<string>();
    const unique: QueryRow[] = [];

    for (const row of rows) {
      const key = String(row[dedupeField.column] ?? '');
      if (key && seen.has(key)) {
        collapsed++;
        continue;
      }
      if (key) seen.add(key);
      unique.push(row);
    }
    rows = unique;
  }

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
    ...(collapsed > 0 ? { collapsed } : {}),
    ...(reportUnmatched(unmatched, candidates, rows.length === 0)),
    ...(ctx._enumOrphans?.length ? { unclassified: ctx._enumOrphans } : {}),
  };
}

/**
 * Turn the foreign keys a grouping produced into the labels they stand for.
 *
 * One query, `id in (…)`, through the same `applyUserScope` as every other read
 * — a label lookup is still a read of someone's data, and skipping the scope
 * here would let a group key confirm the existence of another account's row.
 *
 * An id that resolves to nothing keeps its own key rather than becoming '—': it
 * means the referenced row is gone or not this user's, and collapsing several
 * such ids into one bucket would merge unrelated groups.
 */
async function resolveGroupLabels(
  supabase: SupabaseClient,
  group: Extract<GroupSpec, { kind: 'relation' }>,
  keys: string[],
  ctx: QueryContext
): Promise<Map<string, string>> {
  const labels = new Map<string, string>();

  const ids = keys.filter((key) => key !== '—');
  if (ids.length === 0) return labels;

  const target = CATALOG.entities[group.targetEntity];

  try {
    const builder = scopedFrom(
      supabase,
      target,
      ['id', ...group.targetColumns],
      ctx.userId
    ).in('id', ids);

    const { data, error } = await builder.limit(ids.length);
    if (error) throw error;

    for (const row of (data ?? []) as QueryRow[]) {
      // A label can span columns — a contact is first name plus last name.
      const label = group.targetColumns
        .map((column) => row[column])
        .filter((part) => part !== null && part !== undefined && String(part) !== '')
        .join(' ')
        .trim();

      if (label) labels.set(String(row.id), label);
    }
  } catch (error) {
    // Ids are a poor answer but a truthful one; failing the whole aggregate
    // because the names could not be fetched would be worse.
    logger.warn(
      { err: error, entity: group.targetEntity },
      'Could not resolve group labels; showing ids'
    );
  }

  return labels;
}

/**
 * Aggregate the rows on the far side of a relation, one group per row here.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT `group_by`
 *
 * Grouping payments by service ranks only the services that HAVE payments. A
 * service that never sold produces no rows, so it is missing from the result
 * rather than sitting at zero — and "which service sells least" comes back
 * naming the lowest non-zero seller. The answer is the one that is absent.
 *
 * So this starts from the PARENT: every service is a group before any payment
 * is counted, and the ones with nothing stay at 0. It also disposes of the
 * orphan bucket — a payment with no service has no parent to be filed under,
 * instead of appearing as a service called "—".
 *
 * Two scans, both capped and both user-scoped: the parents, then their related
 * rows. `approximate` is set if either hits its cap, because a truncated parent
 * scan means groups are missing entirely and a truncated child scan means the
 * totals are short — the caller cannot tell which from the number alone.
 * ─────────────────────────────────────────────────────────────────────────────
 */
async function computeOverRelation(
  supabase: SupabaseClient,
  query: ComputeQuery,
  entity: ResolvedEntity,
  ctx: QueryContext
): Promise<ComputeResult> {
  const relationKey = query.over!;
  const relation = entity.relations?.[relationKey];

  if (!relation) {
    throw new BizQLValidationError([
      `'${entity.key}' has no relation called '${relationKey}'. ` +
        `Available: ${Object.keys(entity.relations ?? {}).join(', ') || 'none'}.`,
    ]);
  }

  if (relation.cardinality !== 'many' || relation.via.side !== 'remote') {
    throw new BizQLValidationError([
      `'${entity.key}.${relationKey}' points at a single row, so there is nothing ` +
        `to aggregate. Use a relation that holds many, or group_by instead.`,
    ]);
  }

  const target = CATALOG.entities[relation.target];
  if (!target) {
    throw new BizQLValidationError([`'${relationKey}' points at an unknown entity.`]);
  }

  const fn = query.agg.fn;
  const aggFieldKey = query.agg.field;
  const aggField = aggFieldKey ? target.fields[aggFieldKey] : undefined;

  if (fn !== 'count' && !aggField) {
    throw new BizQLValidationError([
      `'${fn}' needs a field on '${target.key}' to aggregate` +
        (aggFieldKey ? `; '${aggFieldKey}' is not one.` : '.'),
    ]);
  }

  // The parents — every one of them is a group, whether or not it has children.
  const labelKeys = Array.isArray(entity.labelField)
    ? entity.labelField
    : [entity.labelField].filter(Boolean);
  const labelColumns = (labelKeys as string[])
    .map((key) => entity.fields[key]?.column)
    .filter((column): column is string => Boolean(column));

  const { data: parentData, error: parentError } = await scopedFrom(
    supabase,
    entity,
    ['id', ...labelColumns],
    ctx.userId
  ).limit(AGGREGATE_SCAN_CAP + 1);

  if (parentError) throw parentError;

  const parentRows = (parentData ?? []) as QueryRow[];
  const parentsTruncated = parentRows.length > AGGREGATE_SCAN_CAP;
  const parents = parentsTruncated ? parentRows.slice(0, AGGREGATE_SCAN_CAP) : parentRows;

  // The children, filtered by `where` — which describes the RELATED rows.
  const fkColumn = relation.via.column;
  const childColumns = [
    fkColumn,
    ...(aggField ? [aggField.column] : []),
    ...(aggField?.minus ? [aggField.minus] : []),
  ];

  let childBuilder = scopedFrom(supabase, target, childColumns, ctx.userId);
  await prefetchEnumSources(supabase, target, query.where ?? [], ctx);
  for (const predicate of query.where ?? []) {
    childBuilder = (await applyPredicate(supabase, childBuilder, target, predicate, ctx)).b;
  }

  const { data: childData, error: childError } = await childBuilder.limit(AGGREGATE_SCAN_CAP + 1);
  if (childError) throw childError;

  const childRows = (childData ?? []) as QueryRow[];
  const childrenTruncated = childRows.length > AGGREGATE_SCAN_CAP;
  const children = childrenTruncated ? childRows.slice(0, AGGREGATE_SCAN_CAP) : childRows;

  const buckets = new Map<string, number[]>();
  for (const row of children) {
    const parentId = row[fkColumn];
    // A child with no parent belongs to no group. Dropped rather than bucketed
    // under "—": this ranking is of PARENTS, and an orphan is not one of them.
    if (parentId === null || parentId === undefined) continue;

    const key = String(parentId);
    if (!buckets.has(key)) buckets.set(key, []);
    if (aggField) {
      buckets
        .get(key)!
        .push(
          (Number(row[aggField.column]) || 0) -
            (aggField.minus ? Number(row[aggField.minus]) || 0 : 0)
        );
    }
    else buckets.get(key)!.push(1);
  }

  const reduce = (values: number[]): number => {
    if (fn === 'count') return values.length;
    if (values.length === 0) return 0;
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
        return 0;
    }
  };

  const groups = parents.map((parent) => {
    const id = String(parent.id);
    const label = labelColumns
      .map((column) => parent[column])
      .filter((part) => part !== null && part !== undefined && String(part) !== '')
      .join(' ')
      .trim();

    return { key: label || id, value: reduce(buckets.get(id) ?? []) };
  });

  const kept = query.having
    ? groups.filter((g) => {
        const { op, value } = query.having!;
        if (op === 'gt') return g.value > value;
        if (op === 'gte') return g.value >= value;
        if (op === 'lt') return g.value < value;
        if (op === 'lte') return g.value <= value;
        if (op === 'neq') return g.value !== value;
        return g.value === value;
      })
    : groups;

  // Biggest first, like every other grouped aggregate — the least is the last,
  // and a caller after "the worst" reads from the end rather than re-sorting.
  kept.sort((a, b) => b.value - a.value);

  return {
    op: 'compute',
    entity: entity.key,
    agg: { fn, field: aggFieldKey },
    value: null,
    groups: kept,
    approximate: parentsTruncated || childrenTruncated,
    ...(ctx._enumOrphans?.length ? { unclassified: ctx._enumOrphans } : {}),
  };
}

export async function compileAndRunCompute(
  supabase: SupabaseClient,
  query: ComputeQuery,
  ctx: QueryContext
): Promise<ComputeResult> {
  const entity = requireEntity(query.entity);

  // Starting from the parent is a different query, not a variation of this one.
  if (query.over) return computeOverRelation(supabase, query, entity, ctx);

  const { fn, field: aggFieldKey } = query.agg;

  const unmatched: UnmatchedFilter[] = [];
  const candidates: UnmatchedFilter[] = [];
  ctx = { ...ctx, _unmatched: unmatched, _candidates: candidates } as CompileContext;

  if (fn !== 'count' && !aggFieldKey) {
    throw new BizQLValidationError([`aggregate '${fn}' requires a field.`]);
  }

  const aggField = aggFieldKey ? requireReadableField(entity, aggFieldKey) : undefined;

  // `group_by` is a small grammar, not a field key — see lib/business-os/bizql/groupBy.
  let group: GroupSpec | undefined;
  if (query.group_by) {
    const parsed = parseGroupBy(entity, query.group_by);
    if (parsed.problem) {
      throw new BizQLValidationError([`group_by: ${parsed.problem}`]);
    }
    group = parsed.spec;
  }

  // Whatever form the grouping takes, it reduces to one column on this table:
  // the field itself, the date being bucketed, or the foreign key whose labels
  // are resolved after the scan.
  const groupColumn = group
    ? group.kind === 'relation'
      ? group.fkColumn
      : group.column
    : undefined;

  const columns = [
    ...(aggField ? [aggField.column] : []),
    // The deduction travels with the figure it reduces, or the net is the gross.
    ...(aggField?.minus ? [aggField.minus] : []),
    ...(groupColumn ? [groupColumn] : []),
    // Same lesson as buildSelect: a dedupe key that is not fetched reads as
    // undefined for every row, and the distinct count silently equals the raw one.
    ...(fn === 'count' && entity.dedupeBy
      ? [entity.fields[entity.dedupeBy]?.column ?? entity.dedupeBy]
      : []),
  ];

  // An aggregate reads only the columns it reduces over — it never embeds a
  // related resource, because nothing renders a card from an aggregate.
  //
  // This list and the select below MUST be built from the same value. They were
  // not: the select carried only the aggregate column while the scoping loop
  // below iterated `entity.displayRelations`, emitting `.eq('contact.user_id',…)`
  // against a query with no `contact` embed. PostgREST rejects that outright, so
  // EVERY aggregate over an entity with a display relation failed —
  // "how many invoices do I have?" among them. The golden set did not catch it
  // because it asserts on the plan without executing it.
  //
  // Keeping the loop (rather than deleting it as dead) is deliberate: if compute
  // ever does embed a relation, isolation must not depend on someone remembering
  // to add it back. The whole product's tenant boundary is `user_id` filters, and
  // "the join implies it" is the reasoning that stops being true after a schema
  // change nobody re-examined.
  const embeddedRelations = ((query as unknown as FindQuery).include ?? [])
    .map((i) => i.relation)
    .filter((relationKey) => Boolean(entity.relations?.[relationKey]));

  const embeds = embeddedRelations.map((relationKey) => {
    const target = CATALOG.entities[entity.relations![relationKey].target];
    return `${relationKey}:${target.table}(id)`;
  });

  const selectParts = [...(columns.length ? columns : ['id']), ...embeds];

  let builder = scopedFrom(supabase, entity, selectParts, ctx.userId);

  for (const relationKey of embeddedRelations) {
    const target = CATALOG.entities[entity.relations![relationKey].target];
    if (target?.userScope.kind === 'column') {
      builder = builder.eq(`${relationKey}.${target.userScope.column}`, ctx.userId);
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

  /*
   * The value being aggregated, net of any declared deduction.
   *
   * A field with `minus` is a gross figure and a giveback held in two columns:
   * summing the first alone reports money that was returned as money earned.
   */
  const numeric = (row: QueryRow): number =>
    aggField
      ? Number(row[aggField.column] ?? 0) -
        (aggField.minus ? Number(row[aggField.minus] ?? 0) : 0)
      : 0;

  if (group) {
    const column = groupColumn!;
    const buckets = new Map<string, number[]>();

    for (const row of scanned) {
      const raw = row[column];

      // A bucketed row whose date is null has no place on a timeline, and
      // inventing one ("—" beside real months) would put a bar on a trend chart
      // that answers nothing. Rows without the date are left out and the group
      // list says so by their absence.
      const missing = raw === null || raw === undefined || raw === '';

      /*
       * A row with no relation is not one of the things being grouped.
       *
       * Grouping by a relation used to invent a "—" bucket for them, and that
       * bucket competed as though it were a real member. Asked for the most
       * profitable SERVICE, the answer came back "— with $398": payments that
       * belong to no service at all, out-earning every service that exists.
       *
       * The date path already refuses to do this, for the same reason and in
       * the comment just above — a "—" bar beside real months answers nothing.
       * A relation is no different: money attached to no service cannot be your
       * best service, and their absence from the list says so more honestly
       * than a nameless group at the top of it.
       *
       * A plain FIELD grouping keeps its "—": "how many contacts have no
       * source" is a real question about a real value, and the empty value IS
       * the answer there rather than a stand-in for a missing thing.
       */
      if (missing && group.kind === 'relation') continue;

      const key =
        group.kind === 'bucket'
          ? bucketKey(raw, group.bucket, ctx.timezone ?? 'UTC')
          : missing
            ? '—'
            : String(raw);

      if (key === null) continue;

      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(numeric(row));
    }

    // Ids are meaningless to a reader, so a relation grouping resolves them to
    // the target's own label before anything is shown. One extra query, scoped
    // to this user like every other read.
    const labels =
      group.kind === 'relation'
        ? await resolveGroupLabels(supabase, group, [...buckets.keys()], ctx)
        : undefined;

    const allGroups = Array.from(buckets.entries()).map(([key, values]) => ({
      key: labels?.get(key) ?? key,
      value: reduce(values) ?? 0,
      // The raw grouping value, kept only when it is a relation id — that is
      // the one case where the key shown is a label standing in for a row, and
      // the only case where a follow-up needs the row itself.
      ...(group.kind === 'relation' && labels?.has(key) ? { id: key } : {}),
    }));

    /*
     * `having` — the threshold, applied to the aggregate rather than to a row.
     *
     * In JS because the aggregate itself is: the scan is capped and reduced
     * here, so there is no SQL GROUP BY to hang a HAVING clause off. That also
     * means a threshold interacts with `approximate` — a group can fall below
     * the line only because the scan stopped early — which is why the flag is
     * carried through unchanged rather than being cleared by filtering.
     */
    const groups = query.having
      ? allGroups.filter((g) => {
          const { op, value } = query.having!;
          if (op === 'gt') return g.value > value;
          if (op === 'gte') return g.value >= value;
          if (op === 'lt') return g.value < value;
          if (op === 'lte') return g.value <= value;
          if (op === 'neq') return g.value !== value;
          return g.value === value;
        })
      : allGroups;

    // A trend reads in time order; everything else reads biggest-first. Sorting
    // months by amount would answer "which month was best" — a different
    // question from the one that asked for a series.
    groups.sort((a, b) => (group.kind === 'bucket' ? a.key.localeCompare(b.key) : b.value - a.value));

    return {
      op: 'compute',
      entity: query.entity,
      agg: { fn, field: aggFieldKey },
      value: null,
      groups,
      approximate,
      ...(reportUnmatched(unmatched, candidates, groups.length === 0)),
      ...(ctx._enumOrphans?.length ? { unclassified: ctx._enumOrphans } : {}),
    };
  }

  // "How many CLIENTS have unpaid invoices" — count the different values of a
  // field, not the rows carrying them.
  //
  // The rows here are invoices; the question is about clients. One client with
  // two invoices is one client, and the row count answers a different question
  // with a bigger number. Blank values are excluded: a row with no client is not
  // an anonymous client, it is a row with nothing to count.
  if (fn === 'count' && query.agg.distinct && aggField) {
    const distinct = new Set(
      scanned
        .map((row) => row[aggField.column])
        .filter((value) => value !== null && value !== undefined && value !== '')
        .map(String)
    );

    return {
      op: 'compute',
      entity: query.entity,
      agg: { fn, field: aggFieldKey, distinct: true },
      value: distinct.size,
      approximate,
      ...(reportUnmatched(unmatched, candidates, distinct.size === 0)),
    };
  }

  // Counting an entity that records repeats must count the DISTINCT things, or
  // the aggregate contradicts the list beside it: `insights` answered "you have
  // 1,000" while the very same catalog rule collapsed those rows to 2 findings.
  // Only `count` is affected — summing an amount over duplicate rows is a
  // different question, and one the dedupe key cannot answer.
  if (fn === 'count' && entity.dedupeBy) {
    const keyColumn = entity.fields[entity.dedupeBy]?.column ?? entity.dedupeBy;
    const distinct = new Set(scanned.map((row) => String(row[keyColumn] ?? '')));

    return {
      op: 'compute',
      entity: query.entity,
      agg: { fn, field: aggFieldKey },
      value: distinct.size,
      approximate,
      collapsed: scanned.length - distinct.size,
      ...(reportUnmatched(unmatched, candidates, distinct.size === 0)),
    };
  }

  return {
    op: 'compute',
    entity: query.entity,
    agg: { fn, field: aggFieldKey },
    value: reduce(scanned.map(numeric)),
    approximate,
    // `scanned.length`, never the aggregate's value: a sum of genuine zeroes is
    // 0 over real rows, and calling that "no such thing" would be the mirror of
    // the bug being fixed.
    ...(reportUnmatched(unmatched, candidates, scanned.length === 0)),
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
