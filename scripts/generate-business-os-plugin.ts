/**
 * Generate the Business OS plugin definition from the Business Catalog.
 *
 *   npx tsx --import ./scripts/env-preload.ts scripts/generate-business-os-plugin.ts
 *
 * Writes lib/plugins/definitions/business-os-plugin-v2.json.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS GENERATED AND THE OTHER 23 PLUGINS ARE NOT
 *
 * Every other plugin definition is hand-authored because each one wraps somebody
 * else's API, and only a human can say what Notion's endpoints look like. This
 * one wraps a catalog we already own — so hand-writing it would mean maintaining
 * a second description of our own data, which would drift from the first.
 *
 * That drift is not hypothetical. The insight kernel's TriggerableProcesses.ts is
 * a hand-written registry of 4 processes, and ~24 detectors already reference
 * paired processes nobody remembered to add to it, so their action buttons fail
 * with "Process not found". A generated definition cannot develop that gap:
 * adding an entity to the catalog adds its plugin actions here for free.
 *
 * WHAT THE AGENT SEES
 *
 * Field names arrive as JSON-Schema enums, per entity, so a generated workflow is
 * grounded in real columns rather than guessing them — the same reason the chat
 * planner is given the catalog instead of examples. Semantic terms and allowed
 * values are carried into the descriptions, so "unpaid" resolves the same way it
 * does in chat.
 *
 * WHAT THE AGENT CANNOT DO
 *
 * The generated surface never exposes a field the catalog marks unreadable, never
 * exposes an action the catalog does not declare, and never offers a bulk action
 * that has not opted in. Those decisions stay in the catalog, which is also what
 * enforces them at execution time — this file only advertises them.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { CATALOG, CATALOG_VERSION, type ResolvedEntity } from '@/lib/business-os/catalog';

/** Operators the compiler implements. Mirrors ComparisonOp in bizql/types.ts. */
const OPERATORS = [
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'not_in',
  'contains', 'starts_with', 'is_null', 'is_not_null',
];

function readableFields(entity: ResolvedEntity): string[] {
  return Object.keys(entity.fields).filter((k) => entity.fields[k].readable !== false);
}

function writableFields(entity: ResolvedEntity): string[] {
  return Object.keys(entity.fields).filter((k) => entity.fields[k].writable === true);
}

/** A one-line description of a field, including what values it accepts. */
function describeField(entity: ResolvedEntity, key: string): string {
  const field = entity.fields[key];
  const parts = [field.labels.en, `(${field.type})`];

  if (field.enumValues?.length) parts.push(`one of: ${field.enumValues.join(', ')}`);
  if (field.enumSource) parts.push('values are configured per business — read them first');

  const terms = Object.keys(field.semanticTerms ?? {});
  if (terms.length) {
    parts.push(`business terms: ${terms.map((t) => `{"$semantic":"${t}"}`).join(', ')}`);
  }

  return parts.join(' · ');
}

/** The `filters` parameter: an array of BizQL field predicates, field-enumerated. */
function filtersParameter(entity: ResolvedEntity) {
  const fields = [...readableFields(entity), ...Object.keys(entity.derived ?? {})];

  return {
    type: 'array',
    description:
      `Conditions, ANDed together. Each is {field, op, value}. ` +
      `Fields: ${fields
        .map((f) => `${f} — ${entity.fields[f] ? describeField(entity, f) : entity.derived?.[f]?.labels.en ?? f}`)
        .join(' | ')}`,
    items: {
      type: 'object',
      properties: {
        field: { type: 'string', enum: fields },
        op: { type: 'string', enum: OPERATORS },
        value: {
          description:
            'A literal, an array of literals, {"$semantic":"term"} for a business term, ' +
            'or {"$date":"today|tomorrow|start_of_week|…"} for a relative date. ' +
            'Omit entirely for is_null / is_not_null.',
        },
      },
      required: ['field', 'op'],
    },
  };
}

/** Catalog field type → JSON Schema type. */
function schemaType(type: string): string {
  if (type === 'money' || type === 'number') return 'number';
  if (type === 'boolean') return 'boolean';
  return 'string';
}

/**
 * A shape-only sample for `output_guidance`.
 *
 * Field NAMES are real; values are obvious placeholders. A sample containing a
 * plausible-looking name or amount would be a small lie in a file the generation
 * pipeline reads as ground truth, and this is a product where invented data has
 * already caused real bugs.
 */
function sampleRow(entity: ResolvedEntity): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const key of (entity.displayFields ?? readableFields(entity)).slice(0, 5)) {
    const field = entity.fields[key];
    if (!field) continue;
    row[key] = schemaType(field.type) === 'number' ? 0 : `<${key}>`;
  }
  return row;
}

function findAction(key: string, entity: ResolvedEntity) {
  const label = entity.labels.many?.en ?? entity.labels.one.en;

  return {
    description: `Find ${label} in the user's own business records`,
    usage_context:
      `Read the business's own ${label}. This is the user's private data — no external ` +
      `service is involved and nothing needs connecting. Use it to answer questions about ` +
      `their business, or to select rows for a later action.`,
    idempotent: true,
    domain: 'business',
    capability: 'search',
    input_entity: null,
    output_entity: entity.key,
    input_cardinality: null,
    output_cardinality: 'collection',
    output_fields: readableFields(entity),
    required_params: [],
    optional_params: ['filters', 'limit', 'order_by'],
    must_support: ['field_filtering', 'user_scoped'],
    output_schema: {
      type: 'object',
      properties: {
        rows: {
          type: 'array',
          description: `The matching ${label}.`,
          'x-guaranteed': true,
          items: {
            type: 'object',
            properties: Object.fromEntries(
              readableFields(entity).map((f) => [
                f,
                { type: schemaType(entity.fields[f].type), description: describeField(entity, f) },
              ])
            ),
          },
        },
        count: { type: 'integer', description: 'How many rows were returned.', 'x-guaranteed': true },
        truncated: {
          type: 'boolean',
          description: 'True when the limit was reached and more rows exist.',
          'x-guaranteed': true,
        },
      },
    },
    output_guidance: {
      success_description: `Found ${label}`,
      sample_output: {
        rows: [sampleRow(entity)],
        count: 1,
        truncated: false,
      },
    },
    parameters: {
      type: 'object',
      properties: {
        filters: filtersParameter(entity),
        order_by: {
          type: 'array',
          description: 'Sort order.',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string', enum: readableFields(entity) },
              dir: { type: 'string', enum: ['asc', 'desc'] },
            },
            required: ['field'],
          },
        },
        limit: {
          type: 'number',
          description: `How many to return. Capped at ${entity.maxLimit ?? 200}.`,
          minimum: 1,
          maximum: entity.maxLimit ?? 200,
          default: entity.defaultLimit ?? 25,
        },
      },
      required: [],
    },
  };
}

function writeActionDefinition(entityKey: string, entity: ResolvedEntity, actionKey: string) {
  const action = entity.actions![actionKey];
  const writable = writableFields(entity);
  const label = entity.labels.one.en;

  const dataProperties: Record<string, unknown> = {};
  for (const key of [...(action.requiredFields ?? []), ...(action.optionalFields ?? [])]) {
    if (!entity.fields[key]) continue;
    dataProperties[key] = {
      type: entity.fields[key].type === 'money' ? 'number' : 'string',
      description: describeField(entity, key),
    };
  }

  const isBulk = action.allowBulk === true;

  /*
   * Not every declared action is a write.
   *
   * `risk: 'read'` actions — the ledger export is the first — produce a report
   * and change nothing. Stamping them "This CHANGES the user's real business
   * data" tells the kernel the opposite of the truth about the one property it
   * uses to decide whether something needs confirming, can be retried, or is
   * safe to run on a schedule. A read is also idempotent, which is what makes
   * "email me this every quarter" safe to retry.
   */
  const isRead = action.risk === 'read';

  return {
    description: `${action.labels.en} — ${label} in the user's own business records`,
    usage_context:
      `${action.labels.en}. ` +
      (isRead
        ? 'This READS the user\'s business data and changes nothing.'
        : "This CHANGES the user's real business data.") +
      (action.requiresConfirmation ? ' Requires explicit confirmation before it runs.' : '') +
      (isBulk
        ? ` Can be applied to many ${entity.labels.many?.en ?? label} at once, up to ${action.maxFanout}.`
        : ` Applies to exactly ONE ${label}; there is no bulk form.`),
    idempotent: isRead,
    domain: 'business',
    capability: actionKey,
    input_entity: entity.key,
    output_entity: entity.key,
    input_cardinality: isBulk ? 'collection' : 'single',
    output_cardinality: 'single',
    output_fields: readableFields(entity),
    required_params: actionKey === 'create' ? ['data'] : ['target_id'],
    optional_params: actionKey === 'create' ? [] : ['data'],
    side_effect: action.risk,
    must_support: ['user_scoped', ...(action.requiresConfirmation ? ['confirmation'] : [])],
    // Caps live in `rules.limits`, the same place every other plugin declares
    // them, so the existing runtime guard enforces them rather than something
    // bespoke. The catalog is still the source: this only publishes it.
    ...(isBulk && action.maxFanout
      ? {
          rules: {
            limits: {
              max_fanout: {
                condition: `targets > ${action.maxFanout}`,
                action: 'block',
                message:
                  `Refusing to ${action.labels.en.toLowerCase()} more than ${action.maxFanout} ` +
                  `${entity.labels.many?.en ?? label} in one run. Narrow it down.`,
              },
            },
          },
        }
      : {}),
    output_schema: {
      type: 'object',
      properties: {
        applied: {
          type: 'boolean',
          description: 'True when the change was actually written.',
          'x-guaranteed': true,
        },
        summary: {
          type: 'string',
          description: 'What was done, in the user\'s language.',
          'x-guaranteed': true,
        },
        row: { type: 'object', description: `The ${label} after the change.` },
      },
    },
    output_guidance: {
      success_description: action.labels.en,
      sample_output: { applied: true, summary: action.labels.en, row: sampleRow(entity) },
    },
    parameters: {
      type: 'object',
      properties: {
        ...(actionKey === 'create'
          ? {}
          : {
              target_id: {
                type: 'string',
                description:
                  `The id of the ${label} to act on. Must come from a find_${entityKey} result — ` +
                  `never invented.`,
              },
            }),
        ...(Object.keys(dataProperties).length
          ? {
              data: {
                type: 'object',
                description:
                  `Values to write. Writable fields: ${writable.join(', ') || 'none'}.` +
                  (action.requiredFields?.length
                    ? ` Required: ${action.requiredFields.join(', ')}.`
                    : ''),
                properties: dataProperties,
              },
            }
          : {}),
      },
      required: actionKey === 'create' ? ['data'] : ['target_id'],
    },
  };
}

/**
 * The aggregate, as a capability.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * The plugin offered 21 ways to fetch ROWS and no way to ask a QUESTION about
 * them. So an automation that wanted "revenue last month, by service" had two
 * options, and both were bad: pull every transaction and sum them in the
 * workflow — which puts financial arithmetic in generated code and silently
 * truncates at the row limit — or ask a model to add up a list, which is worse.
 *
 * BizQL has computed aggregates all along; nothing had exposed them. This does.
 *
 * `approximate` is promoted to a guaranteed output field rather than being left
 * implicit. An aggregate that ran over a capped scan produces a number that
 * LOOKS exactly like a correct one — an under-count of revenue reads as a bad
 * month, not as a bug — so the caller is told, and cannot help but see it.
 * ───────────────────────────────────────────────────────────────────────────
 */
/**
 * Everything `group_by` legitimately accepts, so the caller can discover it.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * The engine has supported three forms since `groupBy.ts` was written — a
 * column, a relation name, and a date bucket — but this schema advertised only
 * the first. A caller reading it would group revenue by `service_id` and get a
 * column of UUIDs, with no way to learn that `service` returns the service's
 * NAME and `created_at:month` returns a monthly trend.
 *
 * That is the difference between "revenue by service" being answerable and
 * being answerable only by someone who has read the compiler.
 * ───────────────────────────────────────────────────────────────────────────
 */
function groupByOptions(entity: ResolvedEntity): string[] {
  const options = [...readableFields(entity)];

  // A relation on its own groups by the target's label — its name, not its id.
  // Only to-one relations: grouping by a collection has no single value.
  for (const [key, relation] of Object.entries(entity.relations ?? {})) {
    if ((relation as { cardinality?: string }).cardinality === 'one') options.push(key);
  }

  // Dates are grouped by bucket, never by instant: grouping a timestamp puts
  // every row in its own group and answers a trend question with noise.
  for (const key of readableFields(entity)) {
    const type = entity.fields[key]?.type;
    if (type === 'date' || type === 'timestamp' || type === 'datetime') {
      for (const bucket of ['day', 'week', 'month', 'year']) {
        options.push(`${key}:${bucket}`);
      }
    }
  }

  return options;
}

/** Relations that hold MANY rows — the only ones there is anything to aggregate over. */
function manyRelations(entity: ResolvedEntity): string[] {
  return Object.entries(entity.relations ?? {})
    .filter(([, r]) => (r as { cardinality?: string }).cardinality === 'many')
    .map(([key]) => key);
}

function aggregateAction(entity: ResolvedEntity) {
  const label = entity.labels.many?.en ?? entity.labels.one.en;

  // Only fields worth summing or averaging. `count` needs none of them, which
  // is why the field itself stays optional.
  const numericFields = readableFields(entity).filter(
    (f) => schemaType(entity.fields[f].type) === 'number'
  );

  return {
    description: `Aggregate ${label} — totals, counts and averages, optionally grouped`,
    usage_context:
      `Answer a QUANTITATIVE question about the business's own ${label} — "how much", ` +
      `"how many", "what is the average", and the same broken down by a field. ` +
      `Prefer this over fetching rows and adding them up: the arithmetic runs against ` +
      `the data rather than in the workflow, and the result reports whether it was complete. ` +
      `This reads private data and changes nothing.`,
    idempotent: true,
    domain: 'business',
    capability: 'aggregate',
    input_entity: null,
    output_entity: entity.key,
    input_cardinality: null,
    output_cardinality: 'single',
    output_fields: [],
    required_params: ['fn'],
    optional_params: ['field', 'group_by', 'filters', 'distinct'],
    must_support: ['field_filtering', 'user_scoped'],
    output_schema: {
      type: 'object',
      properties: {
        value: {
          type: ['number', 'null'],
          description: 'The aggregate over everything matched. Null when nothing matched.',
          'x-guaranteed': true,
        },
        groups: {
          type: 'array',
          description: 'Present when group_by was supplied: one entry per distinct value.',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              value: { type: 'number' },
            },
          },
        },
        approximate: {
          type: 'boolean',
          description:
            'True when the aggregate ran over a capped scan and may be incomplete. ' +
            'MUST be surfaced rather than presenting the number as a final total.',
          'x-guaranteed': true,
        },
      },
    },
    output_guidance: {
      success_description: `Aggregated ${label}`,
      sample_output: { value: 0, groups: [{ key: '<group>', value: 0 }], approximate: false },
    },
    parameters: {
      type: 'object',
      properties: {
        fn: {
          type: 'string',
          description: 'Which aggregate to compute.',
          enum: ['count', 'sum', 'avg', 'min', 'max'],
        },
        field: {
          type: 'string',
          description:
            'The field to aggregate. Required for sum, avg, min and max; ignored by count.',
          enum: numericFields,
        },
        group_by: {
          type: 'string',
          description:
            'Break the result down, one entry per distinct value. Three forms: a field ' +
            "on this record; a RELATION NAME on its own ('service', 'contact') to group by " +
            'what the related thing is CALLED rather than by its id; or a date field with a ' +
            "bucket ('created_at:month') to group a trend by calendar period.",
          enum: groupByOptions(entity),
        },
        distinct: {
          type: 'boolean',
          description:
            'Count how many DIFFERENT values the field has rather than how many rows. ' +
            'Only meaningful for count.',
        },
        over: {
          type: 'string',
          description:
            'Aggregate the records on the far side of a relation, one group per record HERE — ' +
            "'services' with over='transactions' ranks every service by revenue, including the " +
            'ones that earned nothing. Use this for "which X is doing least": grouping the other ' +
            'way round omits any record with no related rows, so the lowest group returned is ' +
            'the lowest NON-ZERO one. Filters apply to the related records.',
          enum: manyRelations(entity),
        },
        having: {
          type: 'object',
          description:
            'Keep only the groups whose aggregate passes this test — "clients who spent ' +
            'over 5000". Applied after the aggregate, so it needs group_by to mean anything.',
          properties: {
            op: { type: 'string', enum: ['gt', 'gte', 'lt', 'lte', 'eq', 'neq'] },
            value: { type: 'number' },
          },
          required: ['op', 'value'],
        },
        filters: filtersParameter(entity),
      },
      required: ['fn'],
    },
  };
}

function main() {
  const actions: Record<string, unknown> = {};

  for (const [entityKey, entity] of Object.entries(CATALOG.entities)) {
    actions[`find_${entityKey}`] = findAction(entityKey, entity);
    actions[`aggregate_${entityKey}`] = aggregateAction(entity);

    for (const actionKey of Object.keys(entity.actions ?? {})) {
      actions[`${actionKey}_${entityKey}`] = writeActionDefinition(entityKey, entity, actionKey);
    }
  }

  const definition = {
    plugin: {
      name: 'business-os',
      version: '1.0.0',
      description:
        "Read and update the user's own business records — contacts, invoices, bookings, tasks and services",
      context:
        "The user's own Business OS data, held in this product rather than an external service. " +
        'Use it to answer questions about their business and to act on their own records. ' +
        'Nothing needs connecting: this is their data, already here. ' +
        'Combine it with other plugins to move information between their business and outside services.',
      icon: "<Building2 className='w-5 h-5 text-indigo-600'/>",
      category: 'business',
      isPopular: true,
      // Set on exactly the plugins that need no connection — the same marker
      // the two other platform_key plugins carry.
      isSystem: true,
      // No OAuth: the credential is the user's own identity, which the executor
      // already has. `platform_key` is the existing auth type for a plugin that
      // needs no connection — see user-plugin-connections.ts.
      auth_config: {
        auth_type: 'platform_key',
        client_id: 'platform',
        client_secret: 'platform',
        redirect_uri: '',
        auth_url: '',
        token_url: '',
        refresh_url: '',
        profile_url: '',
        required_scopes: [],
      },
      provider_family: 'business-os',
    },
    actions,
  };

  // The file matches the V2 shape exactly — `plugin` and `actions`, nothing
  // else — so the manager, the validator and anything reading these definitions
  // treat it identically to the hand-written 23. The fact that it is generated
  // is recorded in the plugin `version`, not in extra keys no other plugin has.
  const outPath = resolve(process.cwd(), 'lib/plugins/definitions/business-os-plugin-v2.json');
  writeFileSync(outPath, JSON.stringify(definition, null, 2), 'utf8');

  /*
   * Counted by what they DO, not by what they are called.
   *
   * A prefix count reported `statement_contacts` and `export_ledger_business_profile`
   * as writes — both are `risk: 'read'` and change nothing — which overstates
   * what this plugin can alter in the one line anyone reads after generating it.
   */
  const total = Object.keys(actions).length;
  const finds = Object.keys(actions).filter((a) => a.startsWith('find_')).length;
  const aggregates = Object.keys(actions).filter((a) => a.startsWith('aggregate_')).length;
  const declaredReads = Object.values(actions).filter(
    (a) => (a as { side_effect?: string }).side_effect === 'read'
  ).length;
  const reads = finds + aggregates + declaredReads;

  console.log(`Wrote ${outPath}`);
  console.log(
    `${total} actions — ${reads} reads (${finds} find, ${aggregates} aggregate, ` +
      `${declaredReads} report), ${total - reads} writes`
  );
  console.log(`catalog ${CATALOG_VERSION}`);
}

main();
