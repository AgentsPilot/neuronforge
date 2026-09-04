/**
 * Answer rendering: plan + results → the sentence the user reads.
 *
 * There are NO per-operation, per-language response templates here.
 *
 * chat-v3 carried ~120 hand-written strings in ResponseTemplates.ts (one per
 * operation × three languages) plus 35 inline `language === 'he' ? … : …`
 * ternaries, and chat-v2 spent a SECOND `gpt-4o` call writing the final message.
 * Instead the planner emits `answer.text` with `{placeholders}` in the user's own
 * language as part of the plan it already produces, and this module substitutes
 * real values into it. That costs ~15 output tokens, needs no template per
 * operation, works in any language, and is cached along with the plan.
 *
 * The safety property that makes it acceptable: the planner writes the sentence
 * BEFORE seeing any data, and `validatePlan` rejects text containing numbers the
 * user did not supply. The model may phrase; it may not assert facts.
 *
 * @module lib/business-os/bizql/render
 */

import { CATALOG, type ResolvedEntity, type ResolvedField } from '@/lib/business-os/catalog';
import type {
  ComputeResult,
  FindResult,
  QueryResult,
  QueryRow,
  UnmatchedFilter,
} from '../types';

export interface RenderContext {
  language?: string;
  currency?: string;
  timezone?: string;
  /**
   * The business's own words for per-user enum values, keyed by their SOURCE
   * (`crm_pipeline_stages.stage_key`).
   *
   * `contacts.stage` is backed by this business's pipeline, so its labels are
   * data rather than schema and cannot live in the catalog. Without them the
   * answer shows the stored key.
   */
  enumLabels?: Record<string, Record<string, string>>;
}

export interface RenderedRow {
  id: string;
  label: string;
  fields: Array<{ key: string; label: string; value: string }>;
}

export interface RenderedAnswer {
  text: string;
  rows: RenderedRow[];
  entity?: string;
  truncated: boolean;
  /** True when an aggregate ran over a capped scan and may be incomplete. */
  approximate: boolean;
  /**
   * How many repeated rows the entity's dedupe key collapsed, across all steps.
   *
   * Surfaced rather than swallowed: "you have 2 urgent things" is the useful
   * answer, but the owner should still be told that 198 duplicate records sit
   * behind it — that is a symptom worth knowing about, not noise to hide.
   */
  collapsed: number;
  /**
   * Set when the answer had to say "there is no such thing" instead of a number.
   * Callers that log or test answers need to tell that apart from a real result.
   */
  unmatched?: UnmatchedFilter[];
}

// =============================================================================
// VALUE FORMATTING — driven by catalog format hints, not by per-entity switches
// =============================================================================

function formatValue(
  value: unknown,
  format: string | undefined,
  ctx: RenderContext,
  row?: QueryRow,
  /** Carries enumLabels, so a stored token can be shown as a word. */
  field?: ResolvedField
): string {
  if (value === null || value === undefined || value === '') return '—';

  switch (format) {
    case 'money': {
      // Prefer the row's own currency over the profile default: a business can
      // invoice in more than one.
      const currency = (row?.currency as string) || ctx.currency || 'USD';
      const amount = Number(value);
      if (Number.isNaN(amount)) return String(value);
      try {
        return new Intl.NumberFormat(ctx.language || 'en', {
          style: 'currency',
          currency,
        }).format(amount);
      } catch {
        return `${amount} ${currency}`;
      }
    }

    case 'date':
    case 'datetime': {
      const date = new Date(String(value));
      if (Number.isNaN(date.getTime())) return String(value);
      try {
        return new Intl.DateTimeFormat(ctx.language || 'en', {
          dateStyle: 'medium',
          ...(format === 'datetime' ? { timeStyle: 'short' } : {}),
          timeZone: ctx.timezone || 'UTC',
        }).format(date);
      } catch {
        return date.toISOString();
      }
    }

    case 'enum': {
      // The stored token is not the word to show: a Hebrew answer read
      // "סטטוס: overdue", the label translated and the value not. Anything
      // without a label falls back to a readable form of the token rather than
      // the token itself, so a status added later is never raw or blank.
      const stored = String(value);

      /*
       * The BUSINESS's own word wins over the catalog's.
       *
       * A per-user vocabulary is data, not schema: this tutor calls
       * `family_enrolled` "לקוח". The catalog cannot know that, so a stage fell
       * through to the token with its underscores removed and a Hebrew answer
       * ended in "שלב: family enrolled" — a database key shown to someone who
       * had already named it themselves.
       */
      const source = field?.enumSource;
      if (source) {
        const fromBusiness =
          ctx.enumLabels?.[`${source.table}.${source.valueColumn}`]?.[stored];
        if (fromBusiness) return fromBusiness;
      }

      const labelled = field?.enumLabels?.[stored];
      if (labelled) {
        return labelled[(ctx.language as 'he' | 'es') ?? 'en'] ?? labelled.en;
      }
      return stored.replace(/_/g, ' ');
    }

    case 'tags':
      return Array.isArray(value) ? value.join(', ') : String(value);

    case 'boolean':
      return value ? '✓' : '✗';

    default:
      return String(value);
  }
}

/** Label an embedded parent row, e.g. the contact attached to an invoice. */
function embeddedLabel(
  entity: ResolvedEntity,
  row: QueryRow,
  ctx: RenderContext
): string | undefined {
  for (const [relationKey, relation] of Object.entries(entity.relations ?? {})) {
    if (relation.via.side !== 'local') continue;

    const embedded = row[relationKey];
    if (!embedded || typeof embedded !== 'object') continue;

    const target = CATALOG.entities[relation.target];
    if (!target) continue;

    const label = pickLabel(target, embedded as QueryRow, ctx, false);
    if (label && label !== '—') return label;
  }
  return undefined;
}

/**
 * Name a row the way a person would.
 *
 * When a related parent was pulled in, lead with it: asked "which clients have an
 * unpaid invoice over $100", a list reading "INV-00001, INV-00002" answers a
 * different question than the one asked. "אופיר עמר (INV-00002)" answers both
 * framings, and it is derived from the catalog's relations rather than special-
 * cased per entity.
 */
function pickLabel(
  entity: ResolvedEntity,
  row: QueryRow,
  ctx: RenderContext,
  includeEmbedded = true
): string {
  const keys = Array.isArray(entity.labelField) ? entity.labelField : [entity.labelField];

  const own = keys
    .map((key) => {
      const field = entity.fields[key];
      if (!field) return undefined;
      const raw = row[field.column];
      if (raw === null || raw === undefined || raw === '') return undefined;
      // Respect the field's format hint, so a booking labelled by start_time
      // reads "Aug 26, 2026, 1:00 PM" rather than a raw ISO timestamp.
      return formatValue(raw, field.format, ctx, row);
    })
    .filter((v): v is string => Boolean(v))
    .join(' ');

  const related = includeEmbedded ? embeddedLabel(entity, row, ctx) : undefined;

  if (related && own) return `${related} (${own})`;
  if (related) return related;
  if (own) return own;

  return String(row.id ?? '—').slice(0, 8);
}

function renderRow(entity: ResolvedEntity, row: QueryRow, ctx: RenderContext): RenderedRow {
  const displayKeys = entity.displayFields ?? Object.keys(entity.fields);

  const fields = displayKeys
    .map((key) => {
      const field = entity.fields[key];
      if (!field || field.readable === false) return null;
      if (!(field.column in row)) return null;

      return {
        key,
        label: field.labels[(ctx.language as 'en') ?? 'en'] ?? field.labels.en,
        value: formatValue(row[field.column], field.format, ctx, row, field),
      };
    })
    .filter((f): f is RenderedRow['fields'][number] => f !== null);

  // Show embedded relations as fields of their own, so a booking reads
  // "client: Ofir · service: Consultation" rather than two bare timestamps.
  for (const relationKey of entity.displayRelations ?? []) {
    const relation = entity.relations?.[relationKey];
    const embedded = row[relationKey];
    if (!relation || !embedded || typeof embedded !== 'object') continue;

    const target = CATALOG.entities[relation.target];
    if (!target) continue;

    const value = pickLabel(target, embedded as QueryRow, ctx, false);
    if (!value || value === '—') continue;

    fields.unshift({
      key: relationKey,
      label: relation.labels[(ctx.language as 'en') ?? 'en'] ?? relation.labels.en,
      value,
    });
  }

  return { id: String(row.id ?? ''), label: pickLabel(entity, row, ctx), fields };
}

// =============================================================================
// PLACEHOLDER SUBSTITUTION
// =============================================================================


/**
 * The one number a step produced, whichever kind of step it was.
 *
 * A rate is routinely a count over a count ("12 of 40 bookings converted") or an
 * aggregate over an aggregate, and the planner should not have to know which
 * shape it picked in order to divide them.
 */
function numericValue(result: QueryResult | undefined): number | null {
  if (!result) return null;
  if (result.op === 'find') return (result as FindResult).rows.length;
  if (result.op === 'compute') return (result as ComputeResult).value;
  return null;
}

/**
 * Resolve one `{sN.something}` placeholder against a step's result.
 *
 * An unknown placeholder resolves to an empty string rather than being left as
 * literal `{s1.count}` in the user's face — a stray token is better than
 * exposing the internals of a plan.
 */
function resolvePlaceholder(
  expression: string,
  results: Map<string, QueryResult>,
  ctx: RenderContext
): string {
  const [stepId, ...rest] = expression.split('.');
  const path = rest.join('.');
  const result = results.get(stepId);
  if (!result) return '';

  // `{s1.percent_of.s2}` — the one piece of arithmetic the language has.
  //
  // Multi-step plans could already cite two numbers in one sentence ("12 of
  // 40"), but nothing divided them, so a conversion rate could not be STATED as
  // a rate. This is deliberately a named path rather than an expression syntax:
  // an arithmetic mini-language in a placeholder is a parser, and a parser here
  // is a source of wrong numbers dressed as a feature.
  //
  // Division by zero resolves to empty rather than Infinity or NaN, which sends
  // the caller to the plain fallback line — no rate is better than "NaN%".
  const percentMatch = /^percent_of\.(\w+)$/.exec(path);
  if (percentMatch) {
    const whole = numericValue(results.get(percentMatch[1]));
    const part = numericValue(result);

    if (part === null || whole === null || whole === 0) return '';

    const percent = (part / whole) * 100;
    try {
      return new Intl.NumberFormat(ctx.language || 'en', {
        style: 'percent',
        maximumFractionDigits: percent < 10 ? 1 : 0,
      }).format(part / whole);
    } catch {
      return `${percent.toFixed(1)}%`;
    }
  }

  if (result.op === 'find') {
    const find = result as FindResult;
    switch (path) {
      case 'count':
        return String(find.rows.length);
      case 'rows': {
        const entity = CATALOG.entities[find.entity];
        if (!entity) return String(find.rows.length);

        // DEDUPLICATED, and deliberately.
        //
        // Asked "איזה לקוחות חייבים לי כסף", the plan finds unpaid INVOICES and
        // an invoice's label leads with its client — so one client with two
        // invoices was listed twice, as though two people owed money. The rows
        // are correct; naming the same thing twice in a sentence is not.
        //
        // Order is preserved rather than sorted: the first mention is where the
        // reader expects it, and the rows below appear in the same order.
        const seen = new Set<string>();
        const labels: string[] = [];

        for (const row of find.rows) {
          const label = pickLabel(entity, row, ctx);
          if (seen.has(label)) continue;
          seen.add(label);
          labels.push(label);
          // Keep an inline list short; the full set is rendered as cards.
          if (labels.length === 5) break;
        }

        return labels.join(', ');
      }
      case 'first': {
        const entity = CATALOG.entities[find.entity];
        const first = find.rows[0];
        return entity && first ? pickLabel(entity, first, ctx) : '';
      }
      default: {
        // `first.<field>` — one named field of the first row, formatted the same
        // way the result cards format it, so a price reads "₪400.00" in the
        // sentence and beside it rather than as a bare number in one and a
        // formatted one in the other.
        const fieldMatch = /^first\.(\w+)$/.exec(path);
        if (fieldMatch) {
          const entity = CATALOG.entities[find.entity];
          const field = entity?.fields[fieldMatch[1]];
          const first = find.rows[0];

          // No row means no value. Returning empty is what triggers the plain
          // fallback sentence, which is better than a sentence with a hole.
          if (!field || field.readable === false || !first) return '';

          return formatValue(first[field.column], field.format, ctx, first, field);
        }
      }
      // falls through
        // An unrecognised path used to fall through to the row count, so
        // "{s1.first_name} {s1.last_name}" rendered as "1 1" — confident
        // nonsense. Returning empty triggers the fallback line instead, which
        // is plain but true.
        return '';
    }
  }

  const compute = result as ComputeResult;

  if (path === 'groups' && compute.groups) {
    return compute.groups.map((g) => `${g.key}: ${g.value}`).join(', ');
  }

  /*
   * The TOP group, named — "your most profitable service is X".
   *
   * A grouped compute could only be rendered as the whole list ("X: 333.33,
   * Y: 200"), so a superlative question had no way to say its answer. Asked for
   * the most profitable service the planner produced the right query and then
   * had nowhere to put the result, so it reached for `{s1.first.<key>}` — which
   * is the natural shape, and was rejected.
   *
   * `first.key` is the label the rows were grouped under and `first.value` is
   * that group's total. Both are read from the computed result at render time,
   * so neither can be fabricated — the same property that makes `{sN.value}`
   * safe. Ordering is the plan's business: the model asks for `order_by` and
   * `limit`, and "first" means whatever it put first.
   */
  if (compute.groups?.length) {
    if (path === 'first.key') return String(compute.groups[0].key);
    if (path === 'first.value') {
      return formatValue(compute.groups[0].value, 'money', ctx);
    }
  }

  if (compute.value === null) return '0';

  // An aggregate takes its unit from the FIELD it reduced, not from the entity.
  //
  // Asking "does this entity have any money field?" produced "You have $4.00
  // services" and "You have $1,000.00 insights": services have a price and
  // insights an estimated impact, so counting either rendered as currency. A
  // count is dimensionless whatever else the entity stores, and a sum is only
  // money when the summed column is.
  const entity = CATALOG.entities[compute.entity];
  const aggregatedField = compute.agg?.field
    ? entity?.fields[compute.agg.field]
    : undefined;
  const isMoney = compute.agg?.fn !== 'count' && aggregatedField?.format === 'money';

  return isMoney
    ? formatValue(compute.value, 'money', ctx)
    : String(Math.round(compute.value * 100) / 100);
}

/**
 * Name a row the way a person would — shared with the write path.
 *
 * Exported so a confirmation card can say "mark INV-00002 as paid" rather than
 * naming a uuid. Reusing this rather than writing a second labelling rule is the
 * point: two ways to name a row would drift, and the one on the approval card is
 * the one that matters most.
 */
export function labelForRow(
  entityKey: string,
  row: QueryRow,
  ctx: RenderContext
): string | undefined {
  const entity = CATALOG.entities[entityKey];
  if (!entity) return undefined;

  const label = pickLabel(entity, row, ctx);
  return label && label !== '—' ? label : undefined;
}

// =============================================================================
// PUBLIC API
// =============================================================================

export function renderAnswer(
  answerText: string | undefined,
  steps: Array<{ id?: string }>,
  results: QueryResult[],
  ctx: RenderContext = {}
): RenderedAnswer {
  const byId = new Map<string, QueryResult>();
  steps.forEach((step, index) => {
    if (step.id && results[index]) byId.set(step.id, results[index]);
  });

  // Display the largest find result: with one step that is simply it, and with
  // several it is the one the user most likely meant.
  const findResults = results.filter((r): r is FindResult => r.op === 'find');
  const primary = findResults.sort((a, b) => b.rows.length - a.rows.length)[0];

  const entity = primary ? CATALOG.entities[primary.entity] : undefined;
  const rows = primary && entity ? primary.rows.map((row) => renderRow(entity, row, ctx)) : [];

  // Track whether any placeholder resolved to nothing. A sentence built around a
  // list — "Your clients are {s1.rows}" — collapses to "Your clients are ." when
  // the result is empty, which is worse than saying plainly that there are none.
  let emptySubstitution = false;

  const text = (answerText ?? '').replace(/\{([^}]+)\}/g, (_match, expression: string) => {
    const resolved = resolvePlaceholder(expression.trim(), byId, ctx);
    if (resolved === '') emptySubstitution = true;
    return resolved;
  });

  // Any unresolved placeholder means the sentence has a hole in it — "יש לך
  // חשבוניות" with a gap where the number should be. That reads as a bug to the
  // user, so prefer the plain generic line over a broken sentence, whether the
  // result was empty or not.
  const useFallback = !text.trim() || emptySubstitution;

  // A filter that named something non-existent OVERRIDES the sentence, even a
  // perfectly formed one.
  //
  // This is the whole point. The planner writes "Gregory Fenwick owes you
  // {s1.value}" before any data is fetched; the sum comes back 0 because there
  // is no Gregory Fenwick; and the sentence substitutes cleanly into a confident,
  // false statement about someone's money. Falling back would not help either —
  // "invoices: 0" is the same lie in fewer words. The only correct answer is to
  // say the name matched nothing.
  const unmatched = results.flatMap(
    (r) => (r as { unmatched?: UnmatchedFilter[] }).unmatched ?? []
  );

  return {
    text: unmatched.length
      ? unmatchedText(unmatched, ctx)
      : useFallback
        ? fallbackText(primary, entity, results, ctx)
        : text.trim(),
    rows,
    entity: primary?.entity,
    truncated: findResults.some((r) => r.truncated),
    approximate: results.some((r) => r.op === 'compute' && r.approximate),
    collapsed: results.reduce(
      (sum, r) =>
        sum + ((r as { collapsed?: number }).collapsed ?? 0),
      0
    ),
    ...(unmatched.length > 0 ? { unmatched } : {}),
  };
}


/**
 * "There is no such thing", rather than a number that would be a lie.
 *
 * The one piece of hand-written prose in this file, and it earns the exception:
 * every other message here is a localized noun beside a number, which works
 * because the number is TRUE. Here the number would be false — a sum over rows
 * that do not exist renders as a perfectly ordinary 0 — so there is nothing to
 * put beside the noun except a sentence saying why.
 *
 * Both non-English forms are chosen to sidestep grammatical gender, because the
 * noun is interpolated from the catalog and no phrase here can know its gender:
 * Hebrew "אין" does not inflect, and Spanish "no se encontró" is impersonal. A
 * construction needing agreement would be wrong for half the entities.
 */
function unmatchedText(all: UnmatchedFilter[], ctx: RenderContext): string {
  // One sentence per entity, not per filter.
  //
  // "how much does Gregory Fenwick owe me" filters first_name AND last_name, and
  // a two-step plan applies both twice — so the naive rendering said "No contact
  // found matching Gregory. No contact found matching Fenwick." four times over.
  // The parts belong to one name the user typed as one name, so they are joined
  // back into one. Deduplicated first, since the same part arrives from every
  // step that filtered on it.
  const byEntity = new Map<string, string[]>();
  for (const { entity, value } of all) {
    const values = byEntity.get(entity) ?? [];
    if (!values.includes(value)) values.push(value);
    byEntity.set(entity, values);
  }

  const unmatched = [...byEntity.entries()].map(([entity, values]) => ({
    entity,
    value: values.join(' '),
  }));

  // Widened deliberately: the rest of this file casts to 'en' because it only
  // ever indexes a label map, where an unknown key falls back. Here the value is
  // switched on, so narrowing it to 'en' would make the other two branches
  // unreachable — and the compiler said so.
  const language = (ctx.language ?? 'en') as 'en' | 'he' | 'es';

  return unmatched
    .map(({ entity, value }) => {
      const target = CATALOG.entities[entity];
      const noun = target
        ? (target.labels.one[language] ?? target.labels.one.en)
        : entity;

      switch (language) {
        case 'he':
          return `אין ${noun} בשם "${value}".`;
        case 'es':
          return `No se encontró ${noun}: "${value}".`;
        default:
          return `No ${noun} found matching "${value}".`;
      }
    })
    .join(' ');
}

/**
 * Used only when the planner omitted answer text, or built a sentence around a
 * list that turned out to be empty.
 *
 * Deliberately NOT an English sentence. Hand-written prose here would need
 * translating for every language, which is the pattern this system exists to
 * avoid — and "No אנשי קשר found." is worse than useless for a Hebrew speaker.
 * A localized noun plus a count reads correctly in any language and needs no
 * translation table:  "contacts: 0"  ·  "אנשי קשר: 0"  ·  "contactos: 0"
 */
function fallbackText(
  primary: FindResult | undefined,
  entity: ResolvedEntity | undefined,
  results: QueryResult[],
  ctx: RenderContext
): string {
  const language = (ctx.language as 'en') ?? 'en';

  const line = (entityKey: string, count: number): string => {
    const target = CATALOG.entities[entityKey];
    if (!target) return '';
    const labels = count === 1 ? target.labels.one : target.labels.many;
    return `${labels[language] ?? labels.en}: ${count}`;
  };

  if (primary && entity) return line(primary.entity, primary.rows.length);

  // A plan can be aggregate-only, and the planner does sometimes omit
  // `answer.text` altogether. That combination previously fell through to '' —
  // "how many invoices do I have?" answered with a blank message while the
  // compiler had the number in hand. An empty reply reads as a broken product,
  // and it is the one outcome worse than a terse one.
  const compute = results.find((r): r is ComputeResult => r.op === 'compute');
  if (compute && compute.value !== null) {
    // Only a COUNT is a number of entities. Labelling a sum with the entity noun
    // would read as "invoices: 5066.61" — a total presented as a tally. A
    // non-count aggregate is named by the field it reduced instead.
    if (compute.agg?.fn === 'count') return line(compute.entity, compute.value);

    const target = CATALOG.entities[compute.entity];
    const field = compute.agg?.field ? target?.fields[compute.agg.field] : undefined;
    if (!field) return String(compute.value);

    return `${field.labels[language] ?? field.labels.en}: ${formatValue(
      compute.value,
      field.format,
      ctx
    )}`;
  }

  return '';
}
