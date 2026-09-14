/**
 * A zero that says which value would not have been zero.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS THE PHRASING-PROOF SAFETY NET
 *
 * Asked "כמה כסף בהצעות שממתינות להחלטה", the planner filtered `status = sent`
 * and answered 0 — while three drafts and four accepted quotes sat in the same
 * table. It had understood the Hebrew perfectly and narrowed a three-value
 * concept to one value. No label fixes that, and no list of phrasings reaches
 * the next way of asking it.
 *
 * But the failure is visible WITHOUT reading the question at all: a filter
 * matched nothing while a sibling value of the same field would have matched
 * plenty. That is a fact about the data, so it holds for every phrasing, in
 * every language, including ones nobody has thought of.
 *
 * So a confident zero becomes an offer: "0 waiting — but 3 are drafts and 4
 * were accepted", with the counts on the chips the user can already tap.
 *
 * Costs one grouped count, and only on a turn that came back empty — which is
 * a turn that has told the user nothing anyway.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/business-os/bizql/render
 */

import { createLogger } from '@/lib/logger';
import { CATALOG } from '@/lib/business-os/catalog';
import { runBusinessQuery } from '..';
import { isFieldPredicate, type ComputeQuery, type Predicate, type Query } from '../types';
import type { Alternative } from './describePlan';

const logger = createLogger({ module: 'BizQLSiblingCounts' });

/** Enough to point somewhere; not a menu. */
const MAX_SIBLINGS = 3;

interface EnumFilter {
  /** Narrowed to a read: `Query` is a union and an analyse step has no entity. */
  step: { id?: string; op: string; entity: string; where?: Predicate[] };
  field: string;
  /** The values the query asked for, which are the ones NOT to offer back. */
  asked: string[];
}

/** The enum predicate that most plausibly emptied this step. */
function enumFilterOf(query: Query): EnumFilter | null {
  if (query.op !== 'find' && query.op !== 'compute') return null;

  const step = query as unknown as EnumFilter['step'];
  const entity = CATALOG.entities[step.entity];
  if (!entity) return null;

  for (const predicate of step.where ?? []) {
    if (!isFieldPredicate(predicate)) continue;
    if (predicate.op !== 'eq' && predicate.op !== 'in') continue;

    const field = entity.fields[predicate.field];
    if (!field?.enumValues?.length) continue;

    const value = predicate.value;
    const asked = (Array.isArray(value) ? value : [value])
      .filter((v): v is string => typeof v === 'string');

    // A semantic term resolves to values the user never typed; offering its
    // members back would be answering the question they asked.
    if (asked.length === 0) continue;

    return { step, field: predicate.field, asked };
  }

  return null;
}

/**
 * Where the rows actually are, for a filter that found none.
 *
 * @returns alternatives ready for the same chips a correction uses, labelled
 *   with their counts, or an empty list when there is nothing useful to say.
 */
export async function siblingCounts(
  steps: Query[],
  ctx: { userId: string; timezone?: string },
  language = 'en'
): Promise<Alternative[]> {
  const candidate = steps.map(enumFilterOf).find(Boolean);
  if (!candidate) return [];

  const { step, field, asked } = candidate;
  const stepId = step.id ?? 's1';

  /*
   * The same question with that one predicate removed, grouped by the field.
   *
   * Everything else is kept: a date range, a client, another status — because
   * "3 are drafts" is only useful if those three are inside the rest of what
   * was asked for. Widening further would offer rows the user never asked
   * about.
   */
  const rest = (step.where ?? []).filter(
    (p) => !(isFieldPredicate(p) && p.field === field)
  );

  const probe: ComputeQuery = {
    id: 'probe',
    op: 'compute',
    entity: step.entity,
    agg: { fn: 'count' },
    group_by: field,
    ...(rest.length > 0 ? { where: rest } : {}),
  };

  try {
    const result = await runBusinessQuery(probe as Query, {
      userId: ctx.userId,
      timezone: ctx.timezone,
      consumer: 'chat',
    });

    const groups = (result as { groups?: Array<{ key: string; value: number; id?: string }> }).groups ?? [];

    return groups
      // `key` is the rendered label; the raw value rides on `id` where the
      // compiler could supply one, and falls back to the label otherwise.
      .map((group) => ({ ...group, raw: group.id ?? group.key }))
      .filter((group) => group.value > 0 && !asked.includes(group.raw))
      .sort((a, b) => b.value - a.value)
      .slice(0, MAX_SIBLINGS)
      .map((group) => ({
        /*
         * The BUSINESS's word for the value, not the stored token.
         *
         * A grouped count keys static enums by their raw value, so the chips
         * read "accepted (4)" in the middle of a Hebrew conversation — the one
         * word in the sentence the reader cannot check. The catalog has carried
         * the label all along.
         */
        label: `${
          CATALOG.entities[step.entity]?.fields[field]?.enumLabels?.[group.raw]?.[
            language as 'en'
          ] ?? group.key
        } (${group.value})`,
        stepId,
        field,
        value: group.raw,
        kind: 'enum' as const,
      }));
  } catch (err) {
    logger.debug({ err, entity: step.entity, field }, 'Could not count the siblings of an empty filter');
    return [];
  }
}

/**
 * Why a money total is zero when the rows exist.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * "מה הסך הכולל שלהם" over three bookings answered "‏0.00 ‏₪ על פני 3 הזמנות".
 * Arithmetically perfect and badly misleading: `payment_amount` is NULL on all
 * three, so the zero says "nobody recorded a value", and the owner reads "these
 * appointments are worth nothing".
 *
 * A sum over a column no row has filled is not a business fact, and it is
 * detectable without reading the question: count the rows, count the ones
 * carrying a value, and if the second is zero while the first is not, say so.
 * Phrasing-free, language-free, and true for any money field on any entity.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @returns a sentence for the reader, or null when zero is a real zero.
 */
export async function explainEmptyTotal(
  steps: Query[],
  ctx: { userId: string; timezone?: string },
  language = 'en'
): Promise<string | null> {
  const aggregate = steps.find((step) => {
    const read = step as unknown as { op: string; agg?: { fn?: string; field?: string } };
    return read.op === 'compute' && read.agg?.field && read.agg.fn !== 'count';
  }) as unknown as { entity: string; where?: Predicate[]; agg: { field: string } } | undefined;

  if (!aggregate) return null;

  const entity = CATALOG.entities[aggregate.entity];
  const field = entity?.fields[aggregate.agg.field];
  if (!entity || !field) return null;

  try {
    // The same rows, counted twice: all of them, and the ones with a value.
    const [total, populated] = await Promise.all([
      runBusinessQuery(
        { id: 'all', op: 'compute', entity: aggregate.entity, agg: { fn: 'count' }, where: aggregate.where } as Query,
        { userId: ctx.userId, timezone: ctx.timezone, consumer: 'chat' }
      ),
      runBusinessQuery(
        {
          id: 'filled',
          op: 'compute',
          entity: aggregate.entity,
          agg: { fn: 'count' },
          where: [...(aggregate.where ?? []), { field: aggregate.agg.field, op: 'is_not_null' }],
        } as Query,
        { userId: ctx.userId, timezone: ctx.timezone, consumer: 'chat' }
      ),
    ]);

    const rows = (total as { value?: number }).value ?? 0;
    const withValue = (populated as { value?: number }).value ?? 0;

    if (rows === 0 || withValue > 0) return null;

    const fieldLabel = field.labels[language as 'en'] ?? field.labels.en;
    const many = entity.labels.many[language as 'en'] ?? entity.labels.many.en;

    return (
      NOT_RECORDED[language]?.(rows, fieldLabel, many) ??
      NOT_RECORDED.en(rows, fieldLabel, many)
    );
  } catch (err) {
    logger.debug({ err }, 'Could not explain an empty total');
    return null;
  }
}

/**
 * Said in the reader's language, because it is the only part of the reply that
 * explains the number beside it.
 */
const NOT_RECORDED: Record<string, (rows: number, field: string, entity: string) => string> = {
  en: (rows, field, entity) =>
    `That is 0 because none of the ${rows} ${entity} has a ${field} recorded — not because they are worth nothing.`,
  he: (rows, field, entity) =>
    `זה 0 כי באף אחת מ-${rows} ה${entity} לא נרשם ${field} — לא כי הן לא שוות כלום.`,
  es: (rows, field, entity) =>
    `Es 0 porque ninguna de las ${rows} ${entity} tiene ${field} registrado — no porque no valgan nada.`,
};
