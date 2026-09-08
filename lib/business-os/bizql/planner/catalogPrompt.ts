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

import { createHash } from 'crypto';
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

  /*
   * A net figure says what it is net OF, and what it is called.
   *
   * `amount:money net_amount:money` gave the model no way to tell them apart,
   * so it summed the gross one and reported money that had been refunded as
   * money earned. Naming the deduction is the whole signal — the same lesson as
   * derived fields, which were unfindable until their labels were shown.
   *
   * Driven by the declaration, so any future net field explains itself.
   */
  /*
   * The GROSS side of a net pair says so too.
   *
   * Annotating only the net field left `amount:money` looking like the ordinary
   * choice and `net_amount` like a variant, and the model took the familiar
   * name every time. A pair is only legible as a pair when both halves are
   * labelled, so the base of someone else's `minus` is marked here.
   */
  const netCounterpart = Object.entries(entity.fields).find(
    ([, f]) => f.minus && f.column === field.column && f.minus !== field.column
  );

  if (netCounterpart && !field.minus) {
    parts.push(`(GROSS — before ${netCounterpart[1].minus}; for revenue use ${netCounterpart[0]})`);
  }

  if (field.minus) {
    const words = [...new Set(Object.values(field.labels).filter(
      (v): v is string => typeof v === 'string' && v.length > 0
    ))];
    parts.push(`(net of ${field.minus}${words.length ? ` — ${words.join(', ')}` : ''})`);
  }

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

    /*
     * A non-queryable entity does not advertise fields it cannot be asked about.
     *
     * Listing `f: id company_name vertical` under something that only answers
     * through actions is an invitation to `find` it — and that find compiles,
     * returns two useless columns, and reads like an answer. The validator
     * refuses it, but the cheaper fix is not to offer it: a repair round costs a
     * whole extra model call.
     */
    if (entity.queryable === false) {
      lines.push('  f: (not queryable — one configuration row; use the actions below)');
    } else {
      const fields = Object.keys(entity.fields)
        .map((f) => renderField(f, entity))
        .filter((f): f is string => f !== null);

      lines.push(`  f: ${fields.join(' ')}`);
    }

    /*
     * Derived fields are advertised exactly like real ones. The planner does not
     * need to know one is backed by an anti-join — that is the compiler's job.
     *
     * WITH THEIR LABELS, which is what makes them findable. A derived field is
     * chosen only if the model connects the question to it, and `owes_money:bool`
     * offers nothing to connect to: asked "מי חייב לי כסף", the model rebuilt the
     * filter by hand from the invoices relation — a plan that is valid, passes
     * every check, and quietly misses every client who owes money on a payment
     * plan rather than an invoice.
     *
     * The labels already exist and say `חייב כסף` / `debe dinero`. Entities have
     * shown their aliases on the header line for exactly this reason; derived
     * fields were the one place the vocabulary was withheld.
     */
    const derived = Object.entries(entity.derived ?? {});
    if (derived.length) {
      const rendered = derived.map(([key, def]) => {
        const words = [...new Set(Object.values(def.labels).filter((v): v is string => typeof v === 'string' && v.length > 0))];
        const tag = TYPE_TAG[def.type] ?? def.type;
        return words.length ? `${key}:${tag} (${words.join(', ')})` : `${key}:${tag}`;
      });
      lines.push(`  d: ${rendered.join(' ')}`);
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
 * The words a business uses for its own enum values.
 *
 * Keyed by the SOURCE the values come from (`crm_pipeline_stages.stage_key`)
 * rather than by the field that uses them, so any field pointing at the same
 * vocabulary resolves from one entry — and the renderer can find it knowing
 * only the field's own `enumSource`.
 *
 * Some vocabularies are per-user: `contacts.stage` is backed by that business's
 * own pipeline, so `family_enrolled` is "לקוח" for one tutor and something else
 * for the next. The catalog cannot hold those labels — they are data, not
 * schema — which is why `enumSource` names where to read them.
 *
 * The PLANNER already loaded this to build its prompt. The RENDERER did not, so
 * an answer showed the stored token with the underscores prettified away —
 * "שלב: family enrolled" — a Hebrew sentence ending in an English database key
 * that the business had already given a Hebrew name.
 *
 * Returns an empty map on any failure. A missing label is a worse-looking
 * answer; a thrown error is no answer at all.
 */
export async function loadUserEnumLabels(
  userId: string,
  client: SupabaseClient,
  entityKeys?: string[]
): Promise<Record<string, Record<string, string>>> {
  const keys = entityKeys?.length
    ? entityKeys.filter((k) => CATALOG.entities[k])
    : Object.keys(CATALOG.entities);

  const labels: Record<string, Record<string, string>> = {};

  for (const key of keys) {
    const entity = CATALOG.entities[key];

    for (const [fieldKey, field] of Object.entries(entity.fields)) {
      const source = field.enumSource;
      if (!source?.labelColumn) continue;

      try {
        let query = client
          .from(source.table)
          .select(`${source.valueColumn},${source.labelColumn}`);
        if (source.scopedToUser) query = query.eq('user_id', userId);

        const { data, error } = await query;
        if (error || !data) continue;

        const map: Record<string, string> = {};
        for (const row of data as unknown as Array<Record<string, unknown>>) {
          const value = row[source.valueColumn];
          const label = row[source.labelColumn];
          if (value != null && label != null) map[String(value)] = String(label);
        }

        if (Object.keys(map).length > 0) labels[`${source.table}.${source.valueColumn}`] = map;
      } catch {
        // Same reason as above: never let a label lookup break an answer.
      }
    }
  }

  return labels;
}


/**
 * A fingerprint of how the catalog is PRESENTED to the planner.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The plan cache keyed on two things: `CATALOG_VERSION` — which hashes the
 * catalog's structure and explicitly IGNORES `labels` — and `plannerVersion()`,
 * which hashes the system prompt and the tool schema. Neither covers this file.
 *
 * So a change to how entities and fields are rendered changed every plan the
 * model produces while leaving the key untouched, and cached plans built from
 * the old presentation kept being served. Showing derived fields with their
 * labels took one question from wrong-on-every-attempt to right-on-every-
 * attempt — and would have been invisible to the cache. It only invalidated
 * because an unrelated prompt edit happened to move the key first.
 *
 * Hashing the full, unscoped rendering: it is a superset of every per-request
 * scoping, so any change to the presentation moves it, and no change to the
 * question does.
 *
 * Memoised because the render is deterministic within a process and this is
 * consulted on every cache lookup.
 * ─────────────────────────────────────────────────────────────────────────────
 */
let cachedPromptVersion: string | undefined;

export function catalogPromptVersion(): string {
  if (!cachedPromptVersion) {
    cachedPromptVersion = createHash('sha256')
      .update(renderCatalogForPrompt({ includeActions: true }))
      .digest('hex')
      .slice(0, 12);
  }

  return cachedPromptVersion;
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

    /*
     * Aliases count as names, because that is what an alias IS.
     *
     * They were declared and then never consulted here, so scoping recognised
     * an entity only by its formal label. Nobody says "business profile" when
     * they mean their working hours, so "how many hours are open on Wednesday"
     * scoped to tasks — `open` is a task status — and the availability action
     * was not in the prompt at all. The planner could not pick a capability it
     * had never been shown.
     */
    for (const alias of entity.aliases ?? []) {
      if (alias.length >= 3) needles.push(alias.toLowerCase());
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
