/**
 * Business Catalog — merge, validate, version.
 *
 * Joins the introspected physical schema (`catalog.generated.ts`) to the
 * hand-authored semantic layer (`catalog.ts`) and refuses to produce a catalog
 * if the two disagree.
 *
 * Validation runs ONCE at module load and THROWS on failure. That is deliberate:
 * a catalog that lies about the database is worse than no catalog, because every
 * consumer — chat worker, insight detectors, automation kernel — trusts it to
 * build queries. Failing at import turns a whole class of production bug into a
 * failed build.
 *
 * @module lib/business-os/catalog
 */

import { createHash } from 'crypto';
import { PHYSICAL_CATALOG } from './catalog.generated';
import { SEMANTIC_CATALOG } from './catalog';
import {
  CatalogDriftError,
  type FieldType,
  type PhysicalColumn,
  type ResolvedCatalog,
  type ResolvedEntity,
  type ResolvedField,
} from './catalog.schema';

export * from './catalog.schema';
export { SEMANTIC_CATALOG } from './catalog';

// =============================================================================
// TYPE COMPATIBILITY
// =============================================================================

/**
 * Which Postgres types may back each logical field type.
 *
 * This is what catches the "declared a string field over a jsonb column" class
 * of mistake at build time rather than at query time.
 */
const TYPE_COMPATIBILITY: Record<FieldType, readonly string[]> = {
  string: ['text', 'character varying', 'character', 'citext'],
  number: ['integer', 'bigint', 'smallint', 'numeric', 'real', 'double precision'],
  money: ['numeric', 'integer', 'bigint', 'real', 'double precision'],
  boolean: ['boolean'],
  date: ['date'],
  datetime: ['timestamp with time zone', 'timestamp without time zone'],
  uuid: ['uuid'],
  // Two shapes in this schema: CHECK-constrained text (invoices.status) and
  // genuine PG enum types (crm_tasks.priority reports as 'public.task_priority').
  // The latter is matched by prefix in isCompatible().
  enum: ['text', 'character varying', 'USER-DEFINED'],
  'string[]': ['text[]', 'ARRAY', 'character varying[]'],
  json: ['jsonb', 'json'],
};

function isCompatible(fieldType: FieldType, pgFormat: string): boolean {
  if ((TYPE_COMPATIBILITY[fieldType] ?? []).includes(pgFormat)) return true;

  // A real Postgres enum type is reported by PostgREST as 'public.<type_name>'
  // rather than a builtin. Accept any schema-qualified type for an enum field:
  // the values themselves are declared in the semantic layer and pinned by a
  // test, since PostgREST does not expose pg_enum members.
  if (fieldType === 'enum' && /^[a-z_]+\.[a-z_]+$/i.test(pgFormat)) return true;

  return false;
}

// =============================================================================
// MERGE + VALIDATE
// =============================================================================

function buildCatalog(): ResolvedCatalog {
  const problems: string[] = [];
  const entities: Record<string, ResolvedEntity> = {};

  for (const [entityKey, entity] of Object.entries(SEMANTIC_CATALOG)) {
    const physicalTable = PHYSICAL_CATALOG.tables[entity.table];

    if (!physicalTable) {
      problems.push(
        `entity '${entityKey}' declares table '${entity.table}', which was not introspected. ` +
          `Add it to TABLES in scripts/generate-business-catalog.ts and re-run the generator.`
      );
      continue;
    }

    const columnsByName = new Map<string, PhysicalColumn>(
      physicalTable.columns.map((c) => [c.name, c])
    );

    // --- user scoping: the only tenant boundary this product has ------------
    // Every repository uses the service-role client, so RLS does NOT protect
    // these tables. If we cannot resolve a scope, we must not expose the entity.
    if (entity.userScope.kind === 'column') {
      const scopeColumn = columnsByName.get(entity.userScope.column);
      if (!scopeColumn) {
        problems.push(
          `entity '${entityKey}' is scoped by column '${entity.userScope.column}', ` +
            `which does not exist on '${entity.table}'. Refusing to expose an unscopable entity.`
        );
      } else if (scopeColumn.format !== 'uuid') {
        problems.push(
          `entity '${entityKey}' scope column '${entity.userScope.column}' is ` +
            `'${scopeColumn.format}', expected 'uuid'.`
        );
      }
    } else {
      const relation = entity.relations?.[entity.userScope.relation];
      if (!relation) {
        problems.push(
          `entity '${entityKey}' is scoped via relation '${entity.userScope.relation}', ` +
            `which is not declared on the entity.`
        );
      }
    }

    // --- fields -------------------------------------------------------------
    const fields: Record<string, ResolvedField> = {};

    for (const [fieldKey, field] of Object.entries(entity.fields)) {
      const physical = columnsByName.get(field.column);

      if (!physical) {
        problems.push(
          `${entityKey}.${fieldKey} maps to column '${entity.table}.${field.column}', ` +
            `which does not exist in the database.`
        );
        continue;
      }

      if (!isCompatible(field.type, physical.format)) {
        problems.push(
          `${entityKey}.${fieldKey} is declared '${field.type}' but ` +
            `'${entity.table}.${field.column}' is '${physical.format}'.`
        );
        continue;
      }

      fields[fieldKey] = { ...field, key: fieldKey, physical };
    }

    // --- label / display / searchable fields must be real fields -----------
    const labelFields = Array.isArray(entity.labelField)
      ? entity.labelField
      : [entity.labelField];

    for (const name of labelFields) {
      if (!fields[name]) {
        problems.push(`${entityKey}.labelField references unknown field '${name}'.`);
      }
    }
    for (const name of entity.displayFields ?? []) {
      if (!fields[name]) {
        problems.push(`${entityKey}.displayFields references unknown field '${name}'.`);
      }
    }
    for (const name of entity.searchableFields ?? []) {
      if (!fields[name]) {
        problems.push(`${entityKey}.searchableFields references unknown field '${name}'.`);
      }
    }

    // --- relations ----------------------------------------------------------
    for (const [relationKey, relation] of Object.entries(entity.relations ?? {})) {
      const target = SEMANTIC_CATALOG[relation.target];
      if (!target) {
        problems.push(
          `${entityKey}.relations.${relationKey} targets unknown entity '${relation.target}'.`
        );
        continue;
      }

      // The FK column lives on whichever side the relation says it does.
      const ownerTable =
        relation.via.side === 'local' ? physicalTable : PHYSICAL_CATALOG.tables[target.table];

      if (!ownerTable) {
        problems.push(
          `${entityKey}.relations.${relationKey} needs table '${target.table}', ` +
            `which was not introspected.`
        );
        continue;
      }

      if (!ownerTable.columns.some((c) => c.name === relation.via.column)) {
        problems.push(
          `${entityKey}.relations.${relationKey} uses FK column ` +
            `'${ownerTable.name}.${relation.via.column}', which does not exist.`
        );
      }
    }

    // --- derived fields -----------------------------------------------------
    for (const [derivedKey, derived] of Object.entries(entity.derived ?? {})) {
      if (fields[derivedKey]) {
        problems.push(
          `${entityKey}.derived.${derivedKey} collides with a real field of the same name.`
        );
      }

      const relation = entity.relations?.[derived.expand.relation];
      if (!relation) {
        problems.push(
          `${entityKey}.derived.${derivedKey} expands relation ` +
            `'${derived.expand.relation}', which is not declared on the entity.`
        );
        continue;
      }

      // Predicates inside a derived field run against the TARGET entity.
      const target = SEMANTIC_CATALOG[relation.target];
      for (const predicate of derived.expand.where ?? []) {
        if (target && !target.fields[predicate.field]) {
          problems.push(
            `${entityKey}.derived.${derivedKey} filters on ` +
              `'${relation.target}.${predicate.field}', which is not a declared field.`
          );
        }
      }
    }

    // --- writable foreign keys ----------------------------------------------
    //
    // A writable FK is the one write that can reach outside the caller's own
    // rows: `user_id` scoping guards the row being written, not the row it points
    // at. The executor refuses a reference the caller does not own, but it can
    // only do that if it knows what the field points to — so declaring it is
    // mandatory, and a `references` naming an unknown entity is a build failure.
    for (const [fieldKey, field] of Object.entries(fields)) {
      if (field.references && !SEMANTIC_CATALOG[field.references]) {
        problems.push(
          `${entityKey}.fields.${fieldKey}.references names unknown entity ` +
            `'${field.references}'.`
        );
      }

      const looksLikeForeignKey = field.type === 'uuid' && fieldKey.endsWith('_id');
      if (field.writable === true && looksLikeForeignKey && !field.references) {
        problems.push(
          `${entityKey}.fields.${fieldKey} is a writable foreign key but declares no ` +
            `'references'. Without it the executor cannot verify the caller owns the ` +
            `row being pointed at, so the write could reference another tenant.`
        );
      }
    }

    // --- actions ------------------------------------------------------------
    for (const [actionKey, action] of Object.entries(entity.actions ?? {})) {
      // An action can declare PARAMETERS rather than columns — a message to
      // send, a day and a pair of times. It says so with `writesRow: false`,
      // and then there is nothing here to check against the table.
      //
      // Keyed off the explicit flag rather than the risk level: "is this a
      // send?" happened to be true of the first such action and is not the
      // question being asked.
      if (action.writesRow === false) continue;

      for (const name of [...(action.requiredFields ?? []), ...(action.optionalFields ?? [])]) {
        if (!fields[name]) {
          problems.push(
            `${entityKey}.actions.${actionKey} references unknown field '${name}'.`
          );
          continue;
        }

        // An action that offers a field the compiler will then refuse to write is
        // a contradiction the catalog was happy to hold: `invoices.create` listed
        // `contact_id` as optional while the field was never marked writable, so
        // "create an invoice for Ofir" planned correctly and was rejected at
        // validation. The two halves are authored in different parts of the file,
        // which is exactly why this needs to fail the build rather than rely on
        // whoever edits one remembering the other.
        if (fields[name].writable !== true) {
          problems.push(
            `${entityKey}.actions.${actionKey} offers field '${name}', but ` +
              `${entityKey}.fields.${name} is not marked writable. Either mark the ` +
              `field writable or remove it from the action.`
          );
        }
      }
      // --- can this create actually insert a row? ---------------------------
      //
      // `invoices.create` and `activities.create` were both declared, both
      // planned correctly, and both failed at the insert on EVERY call — one on
      // a missing invoice_number, the other on a contact_id the catalog called
      // optional while the column is NOT NULL. Neither was caught by anything:
      // the drift test checks that declared fields EXIST, and the dry run that
      // produces the confirmation card never reaches the handler.
      //
      // So this closes the class rather than the two instances. A column an
      // insert genuinely fails without must be covered by something: a required
      // field the user supplies, or an explicit declaration that the handler
      // fills it in. `optionalFields` deliberately does not count — optional
      // means it may be absent, which is precisely the activities bug.
      // Defaulted rather than compared: the literal catalog narrows `writesRow`
      // to `true | undefined`, so `!== false` is a comparison TypeScript can
      // prove is always true — and a guard that cannot fail is not a guard.
      const writesRow = action.writesRow ?? true;

      if (action.risk === 'create' && writesRow) {
        const mustSupply = physicalTable.columns
          .filter((c) => c.required && !c.hasDefault && !c.isPrimaryKey)
          .map((c) => c.name);

        const columnOf = (fieldKey: string) => entity.fields[fieldKey]?.column ?? fieldKey;
        const covered = new Set([
          // Always from the caller's identity, never from a plan.
          'user_id',
          ...(action.requiredFields ?? []).map(columnOf),
          ...(action.handlerSupplies ?? []),
        ]);

        const uncovered = mustSupply.filter((column) => !covered.has(column));

        if (uncovered.length > 0) {
          problems.push(
            `${entityKey}.actions.${actionKey} cannot insert a row: ` +
              `${uncovered.map((c) => `'${c}'`).join(', ')} ` +
              `${uncovered.length === 1 ? 'is' : 'are'} NOT NULL with no default, and ` +
              `neither requiredFields nor handlerSupplies covers ` +
              `${uncovered.length === 1 ? 'it' : 'them'}. Either ask the user for ` +
              `${uncovered.length === 1 ? 'it' : 'them'}, or declare what the handler fills in.`
          );
        }
      }

      if (action.allowBulk && !action.maxFanout) {
        problems.push(
          `${entityKey}.actions.${actionKey} sets allowBulk without maxFanout. ` +
            `Uncapped fan-out is never acceptable.`
        );
      }
    }

    entities[entityKey] = { ...entity, key: entityKey, fields };
  }

  if (problems.length > 0) {
    throw new CatalogDriftError(problems);
  }

  return { entities, version: computeVersion(entities) };
}

/**
 * Content hash of the catalog's query-relevant structure.
 *
 * Forms part of every plan-cache key, so any schema or semantic change
 * invalidates every cached plan at once. Deliberately excludes display labels
 * and the generator's introspection metadata: re-running the generator or fixing
 * a typo in a Hebrew label must not throw away the whole cache, but adding a
 * field or changing an enum must.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A DENY-LIST AND NOT AN ALLOW-LIST
 *
 * It used to name the properties that count — table, scope, fields, relations,
 * derived, actions — and by omission everything else did not. That is a hash
 * which must be updated by hand every time the catalog schema grows, and it had
 * already fallen behind: an action's `requiredFields` and `optionalFields` reach
 * the planner's prompt, and changing them changed no version. Adding `meaning`
 * repeated the failure immediately — a property added SPECIFICALLY to change how
 * the planner chooses would have been served from a cache built without it.
 *
 * So the default flipped. Everything counts unless it is named here, and the two
 * things named are the two that genuinely must not: `labels`/`enumLabels`, which
 * are what a human is shown rather than what a plan is built from, and
 * `physical`, which is introspection detail already proven compatible by the
 * drift check. A new property is now covered the day it is added, by nobody
 * remembering anything.
 *
 * Over-invalidating costs one round of re-planning. Under-invalidating serves a
 * plan built from a catalog that no longer exists.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function computeVersion(entities: Record<string, ResolvedEntity>): string {
  /** What a human reads, not what a plan is built from. */
  const IGNORED = new Set(['labels', 'enumLabels', 'physical']);

  // Key order in an object literal is not meaningful, so it must not reach the
  // hash — otherwise moving a property up a file changes the version.
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable);

    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .filter(([key]) => !IGNORED.has(key))
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, nested]) => [key, stable(nested)])
      );
    }

    return value;
  };

  return createHash('sha256')
    .update(JSON.stringify(stable(entities)))
    .digest('hex')
    .slice(0, 16);
}

// =============================================================================
// PUBLIC API — consumed by the chat worker, the detectors, and the kernel
// =============================================================================

/** The merged, validated catalog. Throws at import if the schema has drifted. */
export const CATALOG: ResolvedCatalog = buildCatalog();

/** Short content hash; part of every plan-cache key. */
export const CATALOG_VERSION = CATALOG.version;

export function getEntity(key: string): ResolvedEntity | undefined {
  return CATALOG.entities[key];
}

export function listEntities(): ResolvedEntity[] {
  return Object.values(CATALOG.entities);
}

/** Resolve a field, whether it is a real column or a declared derived field. */
export function resolveField(
  entityKey: string,
  fieldKey: string
): { kind: 'field'; field: ResolvedField } | { kind: 'derived'; entityKey: string } | undefined {
  const entity = CATALOG.entities[entityKey];
  if (!entity) return undefined;

  const field = entity.fields[fieldKey];
  if (field) return { kind: 'field', field };

  if (entity.derived?.[fieldKey]) return { kind: 'derived', entityKey };

  return undefined;
}

/**
 * Expand a semantic term to its storage values, e.g. ('invoices','status','open')
 * → ['sent','overdue'].
 *
 * This is the single definition consumed by the chat planner, the detectors and
 * the kernel alike. Returns undefined when the term is not declared, so callers
 * can fall back to treating the value literally.
 */
export function resolveSemanticTerm(
  entityKey: string,
  fieldKey: string,
  term: string
): string[] | undefined {
  const field = CATALOG.entities[entityKey]?.fields[fieldKey];
  return field?.semanticTerms?.[term.toLowerCase()];
}

/** Fields the planner and renderer are allowed to read. */
export function readableFields(entityKey: string): ResolvedField[] {
  const entity = CATALOG.entities[entityKey];
  if (!entity) return [];
  return Object.values(entity.fields).filter((f) => f.readable !== false);
}
