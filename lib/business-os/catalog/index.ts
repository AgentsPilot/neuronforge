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
  // Enums in this repo are CHECK-constrained text columns, not PG enum types.
  enum: ['text', 'character varying', 'USER-DEFINED'],
  'string[]': ['text[]', 'ARRAY', 'character varying[]'],
  json: ['jsonb', 'json'],
};

function isCompatible(fieldType: FieldType, pgFormat: string): boolean {
  return (TYPE_COMPATIBILITY[fieldType] ?? []).includes(pgFormat);
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

    // --- actions ------------------------------------------------------------
    for (const [actionKey, action] of Object.entries(entity.actions ?? {})) {
      for (const name of [...(action.requiredFields ?? []), ...(action.optionalFields ?? [])]) {
        if (!fields[name]) {
          problems.push(
            `${entityKey}.actions.${actionKey} references unknown field '${name}'.`
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
 * invalidates every cached plan at once. Deliberately excludes labels and the
 * generator's timestamp: re-running the generator or fixing a typo in a Hebrew
 * label must not throw away the whole cache, but adding a field or changing an
 * enum must.
 */
function computeVersion(entities: Record<string, ResolvedEntity>): string {
  const shape = Object.entries(entities)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entity]) => ({
      key,
      table: entity.table,
      scope: entity.userScope,
      fields: Object.entries(entity.fields)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([fieldKey, field]) => [
          fieldKey,
          field.column,
          field.type,
          field.readable !== false,
          field.writable === true,
          field.enumValues ?? null,
          field.semanticTerms ? Object.keys(field.semanticTerms).sort() : null,
        ]),
      relations: Object.entries(entity.relations ?? {}).sort(([a], [b]) => a.localeCompare(b)),
      derived: Object.entries(entity.derived ?? {})
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, d]) => [k, d.type, d.expand]),
      actions: Object.entries(entity.actions ?? {})
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, a]) => [k, a.risk, a.requiresConfirmation, a.allowBulk ?? false]),
    }));

  return createHash('sha256').update(JSON.stringify(shape)).digest('hex').slice(0, 16);
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
