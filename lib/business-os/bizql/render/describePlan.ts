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

import { CATALOG, type EntityDef, type FieldDef } from '@/lib/business-os/catalog';
import { isFieldPredicate, type Predicate, type Query } from '../types';
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
export interface Alternative {
  /** What the chip says: the sibling value in the user's language. */
  label: string;
  /** Which step to change. */
  stepId: string;
  /** Catalog field key on that step's entity. */
  field: string;
  /** The value to substitute — an enum value, or a field name for an aggregate. */
  value: string;
  kind: 'enum' | 'aggregate_field';
}

export interface Understanding {
  /** One line: "Understood: count bookings where status is cancelled, this month". */
  text: string;
  alternatives: Alternative[];
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
    // A semantic term is already a business word — "upcoming", "overdue".
    return String((raw as { $semantic: string }).$semantic);
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
    case 'gt':
    case 'gte': return isDate ? word('from', language) : word('atLeast', language);
    case 'lt':
    case 'lte': return isDate ? word('to', language) : word('atMost', language);
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

    return `${predicate.quantifier === 'none' ? word('hasNo', language) : word('has', language)} ${name}`;
  }

  if (!isFieldPredicate(predicate)) return null;

  const field = entity.fields[predicate.field];
  const name = labelOf(field?.labels, language) ?? predicate.field;
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
      // "total of amount of payments" is nobody's sentence; "total amount of
      // payments" is. The `of` between figure and entity carries the meaning.
      parts.push(`${word(fn, language)} ${fieldName} ${word('of', language)} ${many}`.trim());
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

  if (conditions.length > 0) {
    parts.push(`${word('where', language)} ${conditions.join(` ${word('and', language)} `)}`);
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

  return out.slice(0, 6);
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
