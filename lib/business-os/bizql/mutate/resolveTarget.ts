/**
 * Resolve "the invoice INV-00002" into the one row a write will touch.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * A write must name its row by literal id — that rule is what keeps a generic
 * `UPDATE … WHERE` inexpressible, and it is not negotiable. But it left the chat
 * unable to do the one thing a worker does: act on the thing you just named.
 * "mark invoice INV-00002 as paid" was refused, because a person will never type
 * a uuid and the planner is not allowed to invent one.
 *
 * This module supplies the missing half. The planner may describe the row with a
 * filter; this resolves that filter to exactly ONE row, server-side, through the
 * same user-scoped compiler that serves reads, and hands back a concrete id. The
 * write itself still receives a literal id and still cannot express a set.
 *
 * The safety properties, stated plainly because they are the whole point:
 *
 *   - resolution is a READ, so nothing is written while figuring out the target;
 *   - more than one match is a QUESTION, never a guess and never a bulk write;
 *   - the resolved id is what gets parked for confirmation, so the user approves
 *     a specific row and the row cannot change between preview and yes;
 *   - zero matches is an answer ("no invoice matches that"), not a silent no-op.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/business-os/bizql/mutate
 */

import { createLogger } from '@/lib/logger';
import { CATALOG } from '@/lib/business-os/catalog';
import { supabaseServer } from '@/lib/supabaseServer';
import { compileAndRunFind } from '../compiler';
import { labelForRow } from '../render/AnswerRenderer';
import { BizQLValidationError, type MutateQuery, type QueryContext, type QueryRow } from '../types';

const logger = createLogger({ module: 'BizQLResolveTarget' });

/**
 * How many candidates to show when a description matches several rows.
 *
 * The list exists so the user can pick, so it has to be readable. Beyond this we
 * say how many there were and ask them to narrow it, which is more useful than
 * twenty rows they have to scroll.
 */
const MAX_CANDIDATES = 5;

export type TargetResolution =
  | { status: 'resolved'; id: string; row: QueryRow }
  | { status: 'none' }
  | { status: 'ambiguous'; rows: QueryRow[]; total: number };

/** Does this step need resolving before it can run? */
export function needsTargetResolution(query: MutateQuery): boolean {
  const target = query.target as { id?: string; find?: unknown } | undefined;
  return Boolean(target?.find && !target.id);
}

/**
 * Resolve a described target to a single row.
 *
 * Deliberately fetches one more than it will show, so "5 matches" and "more than
 * 5 matches" are distinguishable — telling someone there are exactly five when
 * there are forty would send them looking for a row that is not on screen.
 */
export async function resolveMutateTarget(
  query: MutateQuery,
  ctx: QueryContext
): Promise<TargetResolution> {
  const target = query.target as { id?: string; find?: { where?: unknown[] } } | undefined;

  if (!target?.find) {
    throw new BizQLValidationError([
      `'${query.entity}.${query.action}' has no target to resolve.`,
    ]);
  }

  const entity = CATALOG.entities[query.entity];
  if (!entity) {
    throw new BizQLValidationError([`unknown entity '${query.entity}'.`]);
  }

  const where = target.find.where ?? [];
  if (where.length === 0) {
    // An unfiltered target would resolve to "whichever row came back first",
    // which is how a write lands on an arbitrary row and looks like it worked.
    throw new BizQLValidationError([
      `'${query.entity}.${query.action}' describes its target with no filter, which ` +
        `would match every ${query.entity}. Say which one — by name, number, or ` +
        `another field the user gave.`,
    ]);
  }

  const found = await compileAndRunFind(
    supabaseServer,
    {
      op: 'find',
      entity: query.entity,
      where: where as never,
      limit: MAX_CANDIDATES + 1,
    },
    ctx
  );

  logger.debug(
    { entity: query.entity, action: query.action, matches: found.rows.length },
    'Resolved write target'
  );

  if (found.rows.length === 0) return { status: 'none' };

  if (found.rows.length > 1) {
    return {
      status: 'ambiguous',
      rows: found.rows.slice(0, MAX_CANDIDATES),
      total: found.rows.length,
    };
  }

  const row = found.rows[0];
  const id = row[entity.fields.id?.column ?? 'id'];

  if (typeof id !== 'string' || !id) {
    throw new BizQLValidationError([
      `resolved a ${query.entity} row with no usable id.`,
    ]);
  }

  return { status: 'resolved', id, row };
}

/**
 * Run a lookup, and if an exact match finds nothing, retry it loosely.
 *
 * Matching a person by `first_name eq "…"` is brittle in a way that has nothing
 * to do with the model: "לאופיר" carries a prefix, someone types a surname when
 * the record holds a given name, someone types half of it. All of those are the
 * user correctly naming a person the query then fails to find, and the write
 * fails with "no such contact" while the contact is sitting right there.
 *
 * So an empty exact result is retried with `contains` on the same fields. This
 * only ever WIDENS, never narrows, and widening is safe here precisely because
 * several matches is already a question rather than a guess — the worst case is
 * being asked to choose.
 *
 * Not a fuzzy search: no transliteration, no edit distance, no synonyms. Those
 * would start guessing at identity, and identity is the one thing worth asking
 * about.
 *
 * DELIBERATELY NOT CROSS-SCRIPT. Asking in English for a contact stored as
 * "משה" finds nothing, and that is correct, not a gap: a business's records are
 * in the language the business works in, so a Hebrew conversation is about
 * Hebrew-named people. Bridging scripts would require transliteration — deciding
 * that "Moshe" and "משה" are the same person — which is exactly the guess at
 * identity this function refuses to make everywhere else.
 */
async function widenIfEmpty(
  entityKey: string,
  where: unknown[],
  ctx: QueryContext
): Promise<{ rows: QueryRow[] }> {
  const run = (filters: unknown[]) =>
    compileAndRunFind(
      supabaseServer,
      { op: 'find', entity: entityKey, where: filters as never, limit: MAX_CANDIDATES + 1 },
      ctx
    );

  const exact = await run(where);
  if (exact.rows.length > 0) return exact;

  const entity = CATALOG.entities[entityKey];

  const widened = where.map((predicate) => {
    const p = predicate as { field?: string; op?: string; value?: unknown };
    const isTextEquality =
      p.op === 'eq' &&
      typeof p.value === 'string' &&
      typeof p.field === 'string' &&
      entity?.fields[p.field]?.type === 'string';

    return isTextEquality ? { ...p, op: 'contains' } : predicate;
  });

  // Nothing was widened, so re-running would repeat the same query.
  if (widened.every((p, i) => p === where[i])) return exact;

  const loose = await run(widened);

  logger.debug(
    { entity: entityKey, matches: loose.rows.length },
    'Exact lookup found nothing; retried with contains'
  );

  return loose;
}

/**
 * A field value that describes a row instead of naming its id.
 *
 * `{"contact_id": {"$find": {"where": [{"field":"first_name","op":"eq","value":"Ofir"}]}}}`
 */
export interface DescribedRef {
  $find: { where?: unknown[] };
}

export function isDescribedRef(value: unknown): value is DescribedRef {
  return typeof value === 'object' && value !== null && '$find' in value;
}

/** Does any field of this write describe a row rather than name it? */
export function hasDescribedReferences(query: MutateQuery): boolean {
  return Object.values(query.data ?? {}).some(isDescribedRef);
}

export type ReferenceResolution =
  | {
      status: 'resolved';
      data: Record<string, unknown>;
      /**
       * Field key → the human name of the row it resolved to.
       *
       * Carried so the confirmation card can read "contact: אופיר עמר" instead of
       * a uuid. A card the user cannot read is a card they cannot check.
       */
      labels: Record<string, string>;
    }
  | { status: 'none'; field: string; entity: string }
  | { status: 'ambiguous'; field: string; entity: string; rows: QueryRow[]; total: number };

/**
 * Resolve described foreign keys in a write's data.
 *
 * "create an invoice for Ofir for 300 shekels" needs `contact_id` set to Ofir's
 * row. The planner cannot supply that id — it has never seen one, and inventing
 * one is precisely what every other guard here exists to prevent. Before this,
 * the model reached for the nearest expressible thing and put a `target.find` on
 * a create, which is meaningless: the invoice would have been created with no
 * contact and nothing would have objected.
 *
 * So a foreign key may be DESCRIBED, and is resolved exactly like a target: one
 * match proceeds, several ask, none reports. The catalog's `references` decides
 * which entity is searched, so a field cannot be pointed at an arbitrary table,
 * and the resolving read is user-scoped by the same compiler as everything else —
 * which is also why the ownership check downstream cannot be bypassed this way.
 */
export async function resolveDescribedReferences(
  query: MutateQuery,
  ctx: QueryContext,
  language = 'en'
): Promise<ReferenceResolution> {
  const entity = CATALOG.entities[query.entity];
  if (!entity) throw new BizQLValidationError([`unknown entity '${query.entity}'.`]);

  const data: Record<string, unknown> = { ...(query.data ?? {}) };
  const labels: Record<string, string> = {};

  for (const [key, value] of Object.entries(data)) {
    if (!isDescribedRef(value)) continue;

    const field = entity.fields[key];
    if (!field?.references) {
      throw new BizQLValidationError([
        `'${query.entity}.${key}' cannot be described — it is not a reference to ` +
          `another record. Give it a literal value.`,
      ]);
    }

    const where = value.$find.where ?? [];
    if (where.length === 0) {
      throw new BizQLValidationError([
        `'${query.entity}.${key}' describes a ${field.references} with no filter, which ` +
          `would match every one of them. Say which.`,
      ]);
    }

    const found = await widenIfEmpty(field.references, where, ctx);

    if (found.rows.length === 0) {
      return { status: 'none', field: key, entity: field.references };
    }

    if (found.rows.length > 1) {
      return {
        status: 'ambiguous',
        field: key,
        entity: field.references,
        rows: found.rows.slice(0, MAX_CANDIDATES),
        total: found.rows.length,
      };
    }

    const target = CATALOG.entities[field.references];
    const id = found.rows[0][target.fields.id?.column ?? 'id'];

    if (typeof id !== 'string' || !id) {
      throw new BizQLValidationError([
        `resolved a ${field.references} row with no usable id for '${key}'.`,
      ]);
    }

    data[key] = id;

    const name = labelForRow(field.references, found.rows[0], { language });
    if (name) labels[key] = name;
  }

  return { status: 'resolved', data, labels };
}

/**
 * Return the step with its target pinned to a literal id.
 *
 * A NEW object rather than a mutation of the original: the un-resolved plan is
 * still cached and logged, and rewriting it in place would make the cached plan
 * carry one user's row id — precisely what the cache's parameterisation rules
 * exist to prevent.
 */
export function withResolvedTarget(query: MutateQuery, id: string): MutateQuery {
  return { ...query, target: { id } };
}
