/**
 * Say what the query DID, in the reader's own language.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * Every wrong answer this chat has ever given was a VALID plan. `cancelled`
 * became `upcoming`; "how much does he owe" became money received; a question
 * about no-shows was answered about cancellations. Nothing was broken, nothing
 * threw, and the reply looked exactly like a right one — which is the whole
 * problem: a confident wrong number is worse than an error, because the user
 * acts on it.
 *
 * Base44 and Lovable get this feedback loop for free — their user SEES the
 * generated app and can tell at a glance whether it is what they asked for.
 * Ours cannot see the query. This gives them the same glance.
 *
 * WHAT IT IS AND IS NOT
 *
 * It is a description of the QUERY, rendered from the plan structure, so it
 * cannot lie about what ran: if it says "count bookings where status is
 * cancelled" then that is exactly what was counted. It makes no claim about
 * what the user WANTED — only they know that. It puts the two side by side at
 * the moment the answer appears.
 *
 * It is deterministic and free: no model call, no tokens, catalog labels and
 * the user's own enum words. That is the point — the sustainable version of
 * "understand the user better" is not a longer prompt.
 *
 * THE HONEST LIMIT
 *
 * It catches misreadings a person can RECOGNISE from one line. A plan that is
 * wrong in a way this sentence does not surface stays invisible, which is why
 * coverage is measured separately rather than trusting this to be sufficient.
 *
 * @module lib/business-os/bizql/render
 */

import { CATALOG, resolveSemanticTerm, type EntityDef, type FieldDef } from '@/lib/business-os/catalog';
import { isFieldPredicate, type Predicate, type Query } from '../types';
import { defaultScopeFor } from '../defaultScope';
// One table, both directions: this module turns an anchor into words, and the
// pending-fill path turns words back into an anchor. Two copies would drift.
import { ANCHOR_WORDS } from '../dates';

/** How many sibling values to offer. More than a few is a menu, not a correction. */
const MAX_ALTERNATIVES = 3;

/**
 * A one-tap correction.
 *
 * The plan calls for offering these ALONGSIDE the sentence, because seeing that
 * the system read "cancelled" is only useful if putting it right is one tap
 * rather than a rephrase — a user who has to guess which word to change usually
 * gives up instead.
 */
/**
 * Every kind of chip that can be offered, as VALUES rather than a type.
 *
 * The union used to live only in the type below, and the route's Zod schema
 * re-listed it by hand — so `previous_filters` was declared here, implemented in
 * `applyAlternative`, built by the route, and then rejected by the route's own
 * input schema. The chip returned "Invalid request" to every user who tapped it.
 *
 * Exported as a const so the wire schema is DERIVED from this list. A fourth
 * kind cannot now be added in one place and forgotten in the other.
 */
export const ALTERNATIVE_KINDS = ['enum', 'aggregate_field', 'previous_filters'] as const;

export type AlternativeKind = (typeof ALTERNATIVE_KINDS)[number];

export interface Alternative {
  /** What the chip says: the sibling value in the user's language. */
  label: string;
  /** Which step to change. */
  stepId: string;
  /** Catalog field key on that step's entity. */
  field: string;
  /** The value to substitute — an enum value, or a field name for an aggregate. */
  value: string;
  /**
   * `previous_filters` re-runs this question against the rows the turn BEFORE
   * it was about — the answer to "the total of the quotes" when the four
   * accepted ones were just listed.
   */
  kind: AlternativeKind;
}

export interface Understanding {
  /** One line: "Understood: count bookings where status is cancelled, this month". */
  text: string;
  alternatives: Alternative[];
  /**
   * Why the answer looks the way it does, when the figure alone would mislead.
   *
   * Set by the caller, not by this module: it takes a query to establish (see
   * explainEmptyTotal) and this file is deliberately data-free.
   */
  note?: string;
}

type Lang = string;

const WORDS: Record<string, Record<string, string>> = {
  understood: { en: 'Understood', he: 'כך הבנתי', es: 'Entendí' },
  count: { en: 'count', he: 'ספירת', es: 'contar' },
  sum: { en: 'total', he: 'סך', es: 'total de' },
  avg: { en: 'average', he: 'ממוצע', es: 'promedio de' },
  min: { en: 'smallest', he: 'הנמוך ביותר מבין', es: 'el menor de' },
  max: { en: 'largest', he: 'הגבוה ביותר מבין', es: 'el mayor de' },
  list: { en: 'list', he: 'רשימת', es: 'listar' },
  of: { en: 'of', he: 'של', es: 'de' },
  where: { en: 'where', he: 'כאשר', es: 'donde' },
  groupedBy: { en: 'grouped by', he: 'מקובץ לפי', es: 'agrupado por' },
  top: { en: 'top', he: 'הראשונים', es: 'los primeros' },
  is: { en: 'is', he: 'הוא', es: 'es' },
  isNot: { en: 'is not', he: 'אינו', es: 'no es' },
  isOneOf: { en: 'is one of', he: 'הוא אחד מ', es: 'es uno de' },
  atLeast: { en: 'is at least', he: 'לפחות', es: 'es al menos' },
  atMost: { en: 'is at most', he: 'לכל היותר', es: 'es como máximo' },
  after: { en: 'after', he: 'אחרי', es: 'después de' },
  before: { en: 'before', he: 'לפני', es: 'antes de' },
  from: { en: 'from', he: 'מ־', es: 'desde' },
  to: { en: 'to', he: 'עד', es: 'hasta' },
  contains: { en: 'contains', he: 'מכיל', es: 'contiene' },
  isEmpty: { en: 'is empty', he: 'ריק', es: 'está vacío' },
  isSet: { en: 'has a value', he: 'קיים', es: 'tiene valor' },
  has: { en: 'has', he: 'יש לו', es: 'tiene' },
  hasNo: { en: 'has no', he: 'אין לו', es: 'no tiene' },
  and: { en: 'and', he: 'וגם', es: 'y' },
  or: { en: 'or', he: 'או', es: 'o' },
};

function word(key: string, language: Lang): string {
  return WORDS[key]?.[language] ?? WORDS[key]?.en ?? key;
}

function labelOf(labels: Record<string, string> | undefined, language: Lang): string | undefined {
  if (!labels) return undefined;
  return labels[language] ?? labels.en;
}

/**
 * The user's own word for an enum value, then the catalog's, then the raw
 * token.
 *
 * `enumLabels` carries what the BUSINESS calls its statuses — a studio that
 * renamed "lead" to "enquiry" should see "enquiry" here, or the sentence is
 * describing a system they do not recognise.
 */
function valueLabel(
  entityKey: string,
  fieldKey: string,
  field: FieldDef | undefined,
  raw: unknown,
  language: Lang,
  enumLabels?: Record<string, Record<string, string>>
): string {
  if (raw === null || raw === undefined) return '';

  if (typeof raw === 'object' && '$semantic' in (raw as object)) {
    const term = String((raw as { $semantic: string }).$semantic);

    /*
     * Say what the term STANDS FOR, in the reader's language.
     *
     * The term key is ours and it is English: a Hebrew reader was shown
     * "סטטוס הוא אחד מ unpaid", which is the one word in the sentence they
     * cannot check. Resolved, it reads "ממתין או באיחור" — the actual values,
     * with the actual labels, which is exactly what the query filtered on.
     */
    const values = resolveSemanticTerm(entityKey, fieldKey, term);

    if (values?.length) {
      return values
        .map((value) => labelOf(field?.enumLabels?.[value], language) ?? value)
        .join(` ${word('or', language)} `);
    }

    return term.replace(/_/g, ' ');
  }

  if (typeof raw === 'object' && '$date' in (raw as object)) {
    const expr = raw as { $date: string; offset?: Record<string, number> };
    const named = ANCHOR_WORDS[expr.$date]?.[language] ?? ANCHOR_WORDS[expr.$date]?.en;
    return named ?? expr.$date;
  }

  if (Array.isArray(raw)) {
    return raw
      .map((v) => valueLabel(entityKey, fieldKey, field, v, language, enumLabels))
      .join(', ');
  }

  const key = String(raw);

  /*
   * The business's own word, keyed the way `loadUserEnumLabels` keys it —
   * by SOURCE TABLE and column, not by entity and field. A user-defined enum
   * (services, pipeline stages) lives in a table of the user's own rows, and
   * the catalog field points at it through `enumSource`.
   */
  const source = field?.enumSource;
  const userWord = source
    ? enumLabels?.[`${source.table}.${source.valueColumn}`]?.[key]
    : undefined;
  if (userWord) return userWord;

  return labelOf(field?.enumLabels?.[key], language) ?? key;
}

function opPhrase(op: string, language: Lang, isDate: boolean): string {
  switch (op) {
    case 'eq': return word('is', language);
    case 'neq': return word('isNot', language);
    case 'in': return word('isOneOf', language);
    case 'not_in': return `${word('isNot', language)} ${word('isOneOf', language)}`;
    /*
     * A date bound reads as before/after, not from/to.
     *
     * "valid until to today" is not a sentence anyone parses. Each predicate is
     * described on its own here, so each one has to stand on its own — a range
     * then reads "after the start of this month and before tomorrow", which is
     * exactly what it means.
     */
    case 'gt':
    case 'gte': return isDate ? word('after', language) : word('atLeast', language);
    case 'lt':
    case 'lte': return isDate ? word('before', language) : word('atMost', language);
    case 'contains':
    case 'starts_with': return word('contains', language);
    case 'is_null': return word('isEmpty', language);
    case 'is_not_null': return word('isSet', language);
    default: return op;
  }
}

function describePredicate(
  predicate: Predicate,
  entity: EntityDef,
  entityKey: string,
  language: Lang,
  enumLabels?: Record<string, Record<string, string>>
): string | null {
  if ('and' in predicate) {
    return predicate.and
      .map((p) => describePredicate(p, entity, entityKey, language, enumLabels))
      .filter(Boolean)
      .join(` ${word('and', language)} `);
  }
  if ('or' in predicate) {
    return predicate.or
      .map((p) => describePredicate(p, entity, entityKey, language, enumLabels))
      .filter(Boolean)
      .join(` ${word('or', language)} `);
  }
  if ('not' in predicate) {
    const inner = describePredicate(predicate.not, entity, entityKey, language, enumLabels);
    return inner ? `${word('isNot', language)} (${inner})` : null;
  }

  if ('relation' in predicate) {
    const relation = entity.relations?.[predicate.relation];
    const name =
      labelOf(relation?.labels, language) ??
      labelOf(CATALOG.entities[relation?.target ?? '']?.labels.many, language) ??
      predicate.relation;

    /*
     * The nested condition is the whole content of the predicate.
     *
     * Without it, "count plan payments where it HAS a contact" is what the line
     * said for a question about one named client — true of every row, and so a
     * check that cannot fail. What the reader needs to see is which contact.
     * The inner predicates run against the TARGET entity, so they are described
     * against it.
     */
    const target = CATALOG.entities[relation?.target ?? ''];
    const inner = (predicate.where ?? [])
      .map((p) =>
        target ? describePredicate(p, target, relation!.target, language, enumLabels) : null
      )
      .filter((v): v is string => Boolean(v))
      .join(` ${word('and', language)} `);

    if (inner) {
      return predicate.quantifier === 'none'
        ? `${word('hasNo', language)} ${name} ${word('where', language)} ${inner}`
        : `${name}: ${inner}`;
    }

    return `${predicate.quantifier === 'none' ? word('hasNo', language) : word('has', language)} ${name}`;
  }

  if (!isFieldPredicate(predicate)) return null;

  /*
   * A DERIVED field is a fact, and it reads as one.
   *
   * These are looked up separately because they are not columns — and being
   * missed here is how the line came out as "is_current_version הוא true": an
   * English snake_case key and a raw boolean, in the middle of a Hebrew
   * sentence, describing the one part of the query the reader most needs to
   * check. A boolean fact has no operator worth saying: it either holds or it
   * is negated.
   */
  const derived = entity.derived?.[predicate.field];

  if (derived && derived.type === 'boolean') {
    const fact = labelOf(derived.labels, language) ?? predicate.field;
    const negated = predicate.value === false;

    return negated ? `${word('isNot', language)} ${fact}` : fact;
  }

  const field = entity.fields[predicate.field];
  const name = labelOf(field?.labels, language) ?? labelOf(derived?.labels, language) ?? predicate.field;
  const isDate = field?.type === 'datetime' || field?.format === 'date';
  const phrase = opPhrase(predicate.op, language, isDate);

  if (predicate.op === 'is_null' || predicate.op === 'is_not_null') {
    return `${name} ${phrase}`;
  }

  const value = valueLabel(entityKey, predicate.field, field, predicate.value, language, enumLabels);
  return `${name} ${phrase} ${value}`.trim();
}

function describeStep(
  step: Query,
  language: Lang,
  enumLabels?: Record<string, Record<string, string>>
): string | null {
  if (step.op === 'analyse' || step.op === 'for_each') return null;

  const entity = CATALOG.entities[step.entity];
  if (!entity) return null;

  const parts: string[] = [];

  if (step.op === 'compute') {
    const fn = step.agg?.fn ?? 'count';
    const many = labelOf(entity.labels.many, language) ?? step.entity;

    if (fn === 'count') {
      parts.push(`${word('count', language)} ${many}`);
    } else {
      const field = step.agg?.field ? entity.fields[step.agg.field] : undefined;
      const fieldName = labelOf(field?.labels, language) ?? step.agg?.field ?? '';
      const verb = word(fn, language);

      /*
       * "total total of quotes" — which is what `proposals.total` produced,
       * because the column a business calls its total is summed by a function
       * this sentence also calls "total". Say the word once.
       *
       * Otherwise the field name carries real information: "total amount of
       * payments" is checkable in a way that "total of payments" is not.
       */
      const namesItself = fieldName.toLowerCase() === verb.toLowerCase();

      parts.push(
        namesItself
          ? `${verb} ${word('of', language)} ${many}`
          : `${verb} ${fieldName} ${word('of', language)} ${many}`.trim()
      );
    }

    if (step.group_by) {
      const relation = entity.relations?.[step.group_by];
      const groupName =
        labelOf(relation?.labels, language) ??
        labelOf(entity.fields[step.group_by]?.labels, language) ??
        step.group_by;
      parts.push(`${word('groupedBy', language)} ${groupName}`);
    }
  } else if (step.op === 'mutate') {
    // A write describes itself on its confirmation card, in more detail than a
    // one-liner could. Nothing to add here.
    return null;
  } else {
    const many = labelOf(entity.labels.many, language) ?? step.entity;
    const limited = typeof step.limit === 'number' && step.limit > 0 && step.limit <= 20;
    parts.push(
      limited
        ? `${word('list', language)} ${word('top', language)} ${step.limit} ${many}`
        : `${word('list', language)} ${many}`
    );
  }

  const conditions = (step.where ?? [])
    .map((p) => describePredicate(p, entity, step.entity, language, enumLabels))
    .filter((s): s is string => Boolean(s));

  /*
   * The exclusion the user did NOT ask for, said out loud.
   *
   * This is the condition on which a default scope is defensible at all: the
   * compiler drops superseded quote versions from a question that did not
   * mention them, and a filter nobody is told about is indistinguishable from a
   * bug. Read from the same function the compiler uses, so the sentence cannot
   * describe a rule that did not run.
   */
  const applied = defaultScopeFor(entity as never, step.where);
  if (applied) conditions.push(labelOf(applied.labels, language) ?? '');

  const stated = conditions.filter(Boolean);

  if (stated.length > 0) {
    parts.push(`${word('where', language)} ${stated.join(` ${word('and', language)} `)}`);
  }

  return parts.join(' ');
}

/**
 * The corrections this plan can offer without asking anyone anything.
 *
 * Both kinds come straight from the catalog, which is what keeps this generic:
 * no scenario knows it exists, and a new enum value or a new `aggregateInstead`
 * declaration produces new chips for free.
 */
function findAlternatives(steps: Query[], language: Lang, enumLabels?: Record<string, Record<string, string>>): Alternative[] {
  const out: Alternative[] = [];

  steps.forEach((step, index) => {
    if (step.op !== 'find' && step.op !== 'compute') return;

    const entity = CATALOG.entities[step.entity];
    if (!entity) return;

    const stepId = step.id ?? `s${index + 1}`;

    /*
     * The gross/net question, which is the one that has actually bitten.
     *
     * `transactions.amount` declares `aggregateInstead: [charged_amount,
     * net_amount]` — the same question answered 56% on one run and 128% on the
     * next. The plan must now name one of them, so the useful offer is the
     * OTHER one: two numbers exist and only the user knows which they meant.
     */
    if (step.op === 'compute' && step.agg?.field) {
      for (const candidate of Object.values(entity.fields)) {
        if (!candidate.aggregateInstead?.includes(step.agg.field)) continue;

        for (const sibling of candidate.aggregateInstead) {
          if (sibling === step.agg.field) continue;
          const field = entity.fields[sibling];
          if (!field) continue;

          out.push({
            label: labelOf(field.labels, language) ?? sibling,
            stepId,
            field: 'agg.field',
            value: sibling,
            kind: 'aggregate_field',
          });
        }
      }
    }

    for (const predicate of step.where ?? []) {
      if (!isFieldPredicate(predicate) || predicate.op !== 'eq') continue;

      const field = entity.fields[predicate.field];
      if (!field?.enumValues?.length || typeof predicate.value !== 'string') continue;

      const siblings = field.enumValues
        .filter((v) => v !== predicate.value)
        .slice(0, MAX_ALTERNATIVES);

      for (const sibling of siblings) {
        out.push({
          label: valueLabel(step.entity, predicate.field, field, sibling, language, enumLabels),
          stepId,
          field: predicate.field,
          value: sibling,
          kind: 'enum',
        });
      }
    }
  });

  /*
   * One chip per correction.
   *
   * Two steps filtering the same field produced the same alternative twice —
   * the user was shown "אושרה" as two separate chips, which reads as two
   * different options and is really one. Keyed by what the tap would DO.
   */
  const seen = new Set<string>();

  return out
    .filter((alternative) => {
      const key = `${alternative.field}=${alternative.value}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 6);
}

/**
 * Just the conditions of one step, with no verb in front.
 *
 * For a chip that means "the ones we were talking about", the aggregate is
 * noise: "ספירת הצעות מחיר כאשר סטטוס הוא אושרה" describes the previous QUERY,
 * where the choice on offer is only its filter. This renders "סטטוס הוא אושרה"
 * and the caller frames it.
 */
export function describeFilters(
  step: Query,
  options: { language?: Lang; enumLabels?: Record<string, Record<string, string>> } = {}
): string | null {
  const language = options.language ?? 'en';
  const read = step as unknown as { entity: string; where?: Predicate[] };
  const entity = CATALOG.entities[read.entity];

  if (!entity || !read.where?.length) return null;

  const conditions = read.where
    .map((p) => describePredicate(p, entity, read.entity, language, options.enumLabels))
    .filter((c): c is string => Boolean(c));

  return conditions.length > 0 ? conditions.join(` ${word('and', language)} `) : null;
}

/**
 * Does this step produce a figure someone will act on?
 *
 * A money total is the answer people quote back at you, forward to a client, or
 * decide against — and it is the one this system has got wrong most often, in
 * the quietest way. Worth saying what was counted, every time.
 */
export function isMoneyStep(step: Query): boolean {
  if (step.op !== 'compute' || !step.agg?.field || step.agg.fn === 'count') return false;

  return CATALOG.entities[step.entity]?.fields[step.agg.field]?.format === 'money';
}

/**
 * Render a plan back into one sentence, with the corrections it can offer.
 *
 * Returns null when there is nothing worth saying — a write-only plan, or a
 * plan whose entities are not in the catalog.
 */
export function describePlan(
  steps: Query[],
  options: {
    language?: Lang;
    /** The business's own words for its enum values, keyed `entity.field`. */
    enumLabels?: Record<string, Record<string, string>>;
  } = {}
): Understanding | null {
  const language = options.language ?? 'en';

  const described = steps
    .map((step) => describeStep(step, language, options.enumLabels))
    .filter((s): s is string => Boolean(s));

  if (described.length === 0) return null;

  return {
    text: `${word('understood', language)}: ${described.join('; ')}`,
    alternatives: findAlternatives(steps, language, options.enumLabels),
  };
}
