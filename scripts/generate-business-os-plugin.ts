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

  return {
    description: `${action.labels.en} — ${label} in the user's own business records`,
    usage_context:
      `${action.labels.en}. This CHANGES the user's real business data.` +
      (action.requiresConfirmation ? ' Requires explicit confirmation before it runs.' : '') +
      (isBulk
        ? ` Can be applied to many ${entity.labels.many?.en ?? label} at once, up to ${action.maxFanout}.`
        : ` Applies to exactly ONE ${label}; there is no bulk form.`),
    idempotent: false,
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

function main() {
  const actions: Record<string, unknown> = {};

  for (const [entityKey, entity] of Object.entries(CATALOG.entities)) {
    actions[`find_${entityKey}`] = findAction(entityKey, entity);

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

  const finds = Object.keys(actions).filter((a) => a.startsWith('find_')).length;
  console.log(`Wrote ${outPath}`);
  console.log(`${Object.keys(actions).length} actions — ${finds} reads, ${Object.keys(actions).length - finds} writes`);
  console.log(`catalog ${CATALOG_VERSION}`);
}

main();
