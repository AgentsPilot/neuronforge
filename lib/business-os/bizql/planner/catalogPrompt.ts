/**
 * Compressed catalog rendering for the planner prompt.
 *
 * The whole token argument lives here.
 *
 * chat-v3 serialised all 33 capabilities as full OpenAI tool schemas on EVERY
 * turn — roughly 2,300 tokens of JSON before the user's message was even
 * considered. chat-v2 was far worse: a ~285-line system prompt rebuilt and
 * re-sent on each of up to 11 loop iterations.
 *
 * Instead we render the catalog as dense, line-oriented text — about 35 tokens
 * per entity — and let ONE tool (`emit_plan`) carry the structure. Everything
 * here is generated from the catalog, so a new field or semantic term reaches
 * the planner automatically. Nothing in this file is hand-maintained per entity,
 * which is precisely what stops the "add another example" cycle.
 *
 * Optionally scope to a subset of entities, so a question that is obviously
 * about invoices does not pay for the bookings vocabulary.
 *
 * @module lib/business-os/bizql/planner
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { CATALOG, type ResolvedEntity } from '@/lib/business-os/catalog';

/** Compact type tags. Shorter than the catalog's own names, on purpose. */
const TYPE_TAG: Record<string, string> = {
  string: 'str',
  number: 'num',
  money: 'money',
  boolean: 'bool',
  date: 'date',
  datetime: 'datetime',
  uuid: 'id',
  enum: 'enum',
  'string[]': 'str[]',
  json: 'json',
};

function renderField(key: string, entity: ResolvedEntity): string | null {
  const field = entity.fields[key];
  if (!field || field.readable === false) return null;

  const parts = [`${key}:${TYPE_TAG[field.type] ?? field.type}`];

  // Enum values matter — without them the planner guesses storage values.
  if (field.enumValues?.length) {
    parts.push(`[${field.enumValues.join('|')}]`);
  } else if (field.enumSource) {
    // Values are configured by this business, so they are listed separately by
    // renderUserVocabulary() and filtered with the exact literal value.
    parts.push('[per-user]');
  }

  // Only genuine business rules appear here — groupings a model could not read
  // off the enum, such as "unpaid" meaning sent OR overdue. Plain synonyms are
  // deliberately absent; the model maps wording onto published values itself.
  //
  // Render them in the EXACT syntax the planner must emit. A terser notation
  // (`status:enum[draft|sent|...]{unpaid}`) sat the term right beside the literal
  // values and read as just another one of them, so the model wrote "unpaid" as
  // a plain string — which matches nothing. That single ambiguity accounted for
  // half of all repair passes in the golden set.
  if (field.semanticTerms) {
    const terms = Object.keys(field.semanticTerms)
      .map((term) => `{"$semantic":"${term}"}`)
      .join(' ');
    parts.push(` or ${terms}`);
  }

  if (field.writable) parts.push('*');

  return parts.join('');
}

export interface CatalogPromptOptions {
  /** Restrict to these entity keys. Omit for the whole catalog. */
  entities?: string[];
  /** Include write actions. Phase 1 is read-only, so this defaults to false. */
  includeActions?: boolean;
}

/**
 * Render the catalog as compact text for the planner's system prompt.
 *
 * Example output for one entity:
 *
 *   invoices (invoice/invoices)
 *     f: amount:money* status:enum[draft|sent|paid|overdue|cancelled]{open,unpaid,…}* …
 *     r: contact->contacts
 */
export function renderCatalogForPrompt(options: CatalogPromptOptions = {}): string {
  const keys = options.entities?.length
    ? options.entities.filter((k) => CATALOG.entities[k])
    : Object.keys(CATALOG.entities);

  const blocks: string[] = [];

  for (const key of keys) {
    const entity = CATALOG.entities[key];
    // Aliases on the header line, where the entity is chosen. This is the first
    // decision every plan makes, and "how many לקוחות" pointed at `invoices`
    // because nothing said that `contacts` is what a business calls its clients.
    const alsoKnownAs = entity.aliases?.length ? `, ${entity.aliases.join(', ')}` : '';
    const lines: string[] = [
      `${key} (${entity.labels.one.en}/${entity.labels.many.en}${alsoKnownAs})`,
    ];

    // Before the fields, because it decides whether this entity is the right
    // one at all — and that choice is made before any field is considered.
    if (entity.meaning) {
      lines.push(`  m: ${entity.meaning}`);
    }

    const fields = Object.keys(entity.fields)
      .map((f) => renderField(f, entity))
      .filter((f): f is string => f !== null);

    lines.push(`  f: ${fields.join(' ')}`);

    // Derived fields are advertised exactly like real ones. The planner does not
    // need to know one is backed by an anti-join — that is the compiler's job.
    const derived = Object.entries(entity.derived ?? {});
    if (derived.length) {
      lines.push(`  d: ${derived.map(([k, d]) => `${k}:${TYPE_TAG[d.type] ?? d.type}`).join(' ')}`);
    }

    const relations = Object.entries(entity.relations ?? {});
    if (relations.length) {
      lines.push(
        // Stated once in the system prompt rather than repeated per entity:
        // the same parenthetical on every line is noise, and a noisier prompt
        // measurably destabilised generation.
        `  r: ${relations
          .map(([k, r]) => `${k}->${r.target}${r.cardinality === 'many' ? '[]' : ''}`)
          .join(' ')}`
      );
    }

    if (options.includeActions) {
      const actions = Object.entries(entity.actions ?? {});
      if (actions.length) {
        lines.push(
          // Required fields are shown because their absence is what made the
          // planner invent them: not knowing that services.create needs a name
          // and a duration, it emitted {service_name:"", duration_minutes:0} —
          // every key present, every value a placeholder. A model cannot ask for
          // what it does not know is missing.
          `  a: ${actions
            .map(([k, a]) => {
              const flags = [a.risk, ...(a.requiresConfirmation ? ['confirm'] : [])];
              const required = a.requiredFields?.length
                ? `,req=${a.requiredFields.join('+')}`
                : '';
              // Optional fields are shown for the same reason required ones are:
              // a model cannot fill a field it does not know the action accepts.
              // "הוסף משימה לאופיר להתקשר מחר" was folding "מחר" INTO the title
              // instead of setting due_date, so the task arrived with no date.
              const optional = a.optionalFields?.length
                ? `,opt=${a.optionalFields.join('+')}`
                : '';
              return `${k}(${flags.join(',')}${required}${optional})`;
            })
            .join(' ')}`
        );
      }
    }

    blocks.push(lines.join('\n'));
  }

  return blocks.join('\n');
}

/**
 * Fetch the values a user's data-driven enums actually hold, for the prompt.
 *
 * This is the alternative to a hand-written synonym table, and the reason one is
 * not needed. Rather than declaring that "leads" means stage `inquiry` for a
 * therapist and `closed_won` for a consultant — an endless per-vertical,
 * per-language list — we show the planner THIS user's own pipeline, in their own
 * language, in funnel order:
 *
 *   contacts.stage — filter using one of these exact values ... funnel order:
 *     inquiry "פנייה" #0
 *     initial_consultation "ייעוץ ראשוני" #1
 *     family_enrolled "לקוח" #2
 *
 * The label is decisive: `family_enrolled` is labelled "לקוח" (client), so "my
 * clients" resolves with no translation step. The model maps wording onto real
 * values itself, which is the one thing LLMs are reliably excellent at, and
 * nothing here is hardcoded — it is read from the user's configuration.
 */
export async function renderUserVocabulary(
  userId: string,
  client: SupabaseClient,
  entityKeys?: string[]
): Promise<string> {
  const keys = entityKeys?.length
    ? entityKeys.filter((k) => CATALOG.entities[k])
    : Object.keys(CATALOG.entities);

  const lines: string[] = [];

  for (const key of keys) {
    const entity = CATALOG.entities[key];

    for (const [fieldKey, field] of Object.entries(entity.fields)) {
      const source = field.enumSource;
      if (!source) continue;

      // Ask for every configured column, then fall back progressively. Optional
      // columns really are optional: on this database crm_pipeline_stages has no
      // stage_type, and a missing nice-to-have must never break planning.
      const optional = [source.semanticColumn, source.labelColumn, source.orderColumn].filter(
        (c): c is string => Boolean(c)
      );

      const fetchColumns = async (columns: string[]) => {
        let query = client.from(source.table).select(columns.join(','));
        if (source.scopedToUser) query = query.eq('user_id', userId);
        if (source.orderColumn && columns.includes(source.orderColumn)) {
          query = query.order(source.orderColumn, { ascending: true });
        }
        return query;
      };

      let rows: Array<Record<string, unknown>> = [];
      let available: string[] = [];

      for (const attempt of [[source.valueColumn, ...optional], [source.valueColumn]]) {
        const result = await fetchColumns(attempt);
        if (!result.error) {
          rows = (result.data ?? []) as unknown as Array<Record<string, unknown>>;
          available = attempt;
          break;
        }
      }

      if (rows.length === 0) continue;

      const has = (column?: string) => Boolean(column && available.includes(column));

      const rendered = rows.map((row) => {
        const value = String(row[source.valueColumn]);
        const parts = [value];

        // The label is the user's own word for this stage, in their language.
        if (has(source.labelColumn)) parts.push(`"${String(row[source.labelColumn!])}"`);
        if (has(source.semanticColumn)) parts.push(`[${String(row[source.semanticColumn!])}]`);
        if (has(source.orderColumn)) parts.push(`#${String(row[source.orderColumn!])}`);

        return parts.join(' ');
      });

      const ordered = has(source.orderColumn)
        ? ' They are listed in funnel order, earliest first.'
        : '';

      lines.push(
        `${key}.${fieldKey} — filter using one of these exact values ` +
          `(shown with the label this business uses for it):${ordered}\n` +
          rendered.map((r) => `  ${r}`).join('\n')
      );
    }
  }

  return lines.join('\n');
}

/**
 * Guess which entities a message concerns, to shrink the prompt further.
 *
 * Matching is derived from catalog labels and semantic terms — NOT from a
 * hand-written keyword table — so it extends automatically and works in every
 * language the labels are translated into. It is a pure optimisation: on no
 * match we fall back to the full catalog, so a miss costs tokens, never
 * correctness.
 */
export function guessRelevantEntities(message: string): string[] {
  const haystack = message.toLowerCase();
  const hits = new Set<string>();

  for (const entity of Object.values(CATALOG.entities)) {
    const needles: string[] = [];

    for (const label of [entity.labels.one, entity.labels.many]) {
      for (const value of Object.values(label)) {
        if (typeof value === 'string' && value.length >= 3) needles.push(value.toLowerCase());
      }
    }

    for (const field of Object.values(entity.fields)) {
      for (const term of Object.keys(field.semanticTerms ?? {})) {
        if (term.length >= 4) needles.push(term.toLowerCase());
      }
    }

    if (needles.some((n) => haystack.includes(n))) hits.add(entity.key);
  }

  // Pull in entities reachable by relation, so "contacts who owe me" still has
  // invoices available.
  for (const key of [...hits]) {
    for (const relation of Object.values(CATALOG.entities[key]?.relations ?? {})) {
      hits.add(relation.target);
    }
  }

  return [...hits];
}
