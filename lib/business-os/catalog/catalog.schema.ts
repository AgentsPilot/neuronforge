/**
 * Business Catalog — type contract
 *
 * The catalog is the SINGLE source of truth for what the AI worker can see and do.
 * It replaces the three drifted capability registries that preceded it.
 *
 * It has two layers, deliberately kept apart:
 *
 *   1. PHYSICAL  (`catalog.generated.ts`) — introspected from the live database.
 *      Nobody edits this by hand. It is the answer to "what columns actually exist".
 *
 *   2. SEMANTIC  (`catalog.ts`) — hand-authored. Which fields are exposed, what they
 *      are called in each language, which semantic terms map to which values, and
 *      which derived fields exist. It is the answer to "what may the worker do".
 *
 * `index.ts` merges the two and fails loudly if the semantic layer references a
 * column the database does not have. That merge is what makes registry drift —
 * the `status` vs `stage` class of bug — a build failure instead of a runtime lie.
 *
 * @module lib/business-os/catalog
 */

// =============================================================================
// PHYSICAL LAYER (generated — do not hand-edit the values, only these types)
// =============================================================================

/** Postgres type as reported by PostgREST's OpenAPI `format`. */
export type PgFormat = string;

export interface PhysicalColumn {
  /** Column name exactly as it exists in Postgres. */
  name: string;
  /** Raw Postgres type, e.g. 'uuid' | 'text' | 'numeric' | 'timestamp with time zone'. */
  format: PgFormat;
  /** JSON-schema-level type reported by PostgREST ('string' | 'number' | ...). */
  jsonType: string;
  /** True when the column is in the table's `required` set (NOT NULL, no default). */
  required: boolean;
  /** Whether this column is the primary key. */
  isPrimaryKey: boolean;
  /** Set when the column is a foreign key. */
  foreignKey?: { table: string; column: string };
  /** Postgres column comment, if any. */
  description?: string;
}

export interface PhysicalTable {
  name: string;
  columns: PhysicalColumn[];
}

export interface PhysicalCatalog {
  /** ISO timestamp of the introspection run. */
  generatedAt: string;
  /** Supabase project ref the schema was read from (host label only, never a key). */
  source: string;
  tables: Record<string, PhysicalTable>;
}

// =============================================================================
// SEMANTIC LAYER (hand-authored)
// =============================================================================

export type Language = 'en' | 'he' | 'es';

/** Human-facing labels. `en` is mandatory; others fall back to it. */
export type Labels = { en: string } & Partial<Record<Language, string>>;

/** Singular/plural entity naming, used by the generic renderer. */
export interface EntityLabels {
  one: Labels;
  many: Labels;
}

/**
 * How a value should be rendered. Drives the generic renderer so that response
 * text never needs a per-operation template.
 */
export type FormatHint =
  | 'plain'
  | 'money'
  | 'date'
  | 'datetime'
  | 'email'
  | 'phone'
  | 'enum'
  | 'tags'
  | 'url'
  | 'boolean';

/**
 * The logical type the query IR reasons about. Narrower than Postgres types on
 * purpose — the planner should not care about `numeric` vs `int8`.
 */
export type FieldType =
  | 'string'
  | 'number'
  | 'money'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'uuid'
  | 'enum'
  | 'string[]'
  | 'json';

export interface FieldDef {
  /** Physical column name. MUST exist in the physical catalog. */
  column: string;
  type: FieldType;
  labels: Labels;
  /** Readable by the worker. Default true. Set false to hide (e.g. internal notes). */
  readable?: boolean;
  /** Writable by the worker. Default false — writing is opt-in, never inferred. */
  writable?: boolean;
  format?: FormatHint;
  /**
   * Allowed values, when this repo's convention is a CHECK constraint rather than a
   * PG enum type. NOTE: PostgREST does not expose CHECK values, so these CANNOT be
   * verified automatically — see `enumSource` when the values are data-driven.
   */
  enumValues?: string[];
  /**
   * Set when the allowed values live in a table rather than a constraint, e.g.
   * `crm_contacts.stage` references `crm_pipeline_stages.stage_key` and is
   * configured per user during onboarding. The compiler resolves these at runtime
   * and MUST NOT assume a fixed list.
   *
   * `semanticColumn` names a column on the source table that classifies each row
   * into a stable vocabulary — `crm_pipeline_stages.stage_type` is one of
   * lead/prospect/client/past_client/lost/archived. When present, a semantic term
   * is matched against THAT column and expanded to whatever `valueColumn` values
   * this particular user happens to have.
   *
   * This is what makes "list my leads" correct for a therapist whose stages are
   * inquiry/family_enrolled and for a consultant whose stages are
   * closed_won/active_project, with no per-vertical code and no guessing.
   */
  enumSource?: {
    table: string;
    valueColumn: string;
    scopedToUser: boolean;
    semanticColumn?: string;
    /**
     * Column holding the human label the user themselves sees, in their own
     * language. This is usually the richest signal available: a tutor's
     * `family_enrolled` stage is labelled "לקוח" — literally "client" — so a
     * planner shown the label can map "my clients" onto it with no synonym table
     * and no translation step.
     */
    labelColumn?: string;
    /**
     * Column defining order through the funnel. Ordering is what lets "leads"
     * mean the earliest stage and "finished" the last, for any business, without
     * anyone classifying the stages by hand.
     */
    orderColumn?: string;
  };
  /**
   * Intent-level vocabulary → concrete values. The planner emits the semantic term
   * (`open`), never the storage value (`['sent','overdue']`). This is what removes
   * the need for per-language phrasing examples.
   */
  semanticTerms?: Record<string, string[]>;
}

/** Cardinality of a relation from the owning entity's point of view. */
export type RelationCardinality = 'one' | 'many';

export interface RelationDef {
  /** Entity key this relation points at. */
  target: string;
  cardinality: RelationCardinality;
  /**
   * The FK column and which side holds it.
   * - 'local'  : this entity's table holds the FK (many-to-one)
   * - 'remote' : the target table holds the FK (one-to-many)
   */
  via: { column: string; side: 'local' | 'remote' };
  labels: Labels;
}

/**
 * A field that does not exist as a column but is computed from a relation.
 *
 * This is the key generalisation device: rather than teaching the planner to
 * invent a relation-absence predicate for "contacts without an intake form", the
 * catalog declares `has_completed_intake` and the compiler expands it. Every
 * operator then composes with it for free.
 */
export interface DerivedFieldDef {
  type: 'boolean' | 'number' | 'datetime';
  labels: Labels;
  expand: {
    relation: string;
    /** 'any' → EXISTS, 'none' → NOT EXISTS, 'count' → aggregate. */
    quantifier: 'any' | 'none' | 'count';
    where?: Array<{ field: string; op: string; value?: unknown }>;
  };
}

/** Risk tier. Drives confirmation, and whether bulk fan-out is permitted at all. */
export type RiskLevel = 'read' | 'create' | 'update' | 'delete' | 'send';

export interface ActionDef {
  labels: Labels;
  risk: RiskLevel;
  requiresConfirmation: boolean;
  /** Fields the caller must supply. Feeds slot-filling. */
  requiredFields?: string[];
  optionalFields?: string[];
  /**
   * Whether this action may be applied to a set (a `for_each` fan-out).
   * Defaults to FALSE. Bulk is opt-in, never inferred — an LLM-authored
   * "UPDATE ... WHERE" is the most dangerous surface in the system.
   */
  allowBulk?: boolean;
  /** Hard cap on fan-out size when allowBulk is true. */
  maxFanout?: number;
}

/**
 * How rows of this entity are constrained to the calling user.
 *
 * This is the single most important field in the catalog. Every repository in
 * this codebase uses the service-role Supabase client, which BYPASSES RLS, so
 * `.eq('user_id', …)` is the only tenant boundary that exists. `index.ts` throws
 * at module load if any exposed entity lacks a resolvable scope.
 */
export type UserScope =
  | { kind: 'column'; column: string }
  | { kind: 'relation'; relation: string };

export interface EntityDef {
  /** Physical table name. MUST exist in the physical catalog. */
  table: string;
  labels: EntityLabels;
  userScope: UserScope;
  /** Column used when naming a row in prose or a card title. */
  labelField: string | string[];
  /** Columns shown by default in a result card. */
  displayFields?: string[];
  /** Columns free-text search should cover. */
  searchableFields?: string[];
  fields: Record<string, FieldDef>;
  relations?: Record<string, RelationDef>;
  derived?: Record<string, DerivedFieldDef>;
  actions?: Record<string, ActionDef>;
  /** Default and maximum page size for queries against this entity. */
  defaultLimit?: number;
  maxLimit?: number;
}

/** The hand-authored semantic catalog, keyed by logical entity name. */
export type SemanticCatalog = Record<string, EntityDef>;

// =============================================================================
// MERGED CATALOG (what the rest of the system consumes)
// =============================================================================

export interface ResolvedField extends FieldDef {
  /** Logical field name. */
  key: string;
  /** Physical column metadata, proven to exist. */
  physical: PhysicalColumn;
}

export interface ResolvedEntity extends Omit<EntityDef, 'fields'> {
  key: string;
  fields: Record<string, ResolvedField>;
}

export interface ResolvedCatalog {
  entities: Record<string, ResolvedEntity>;
  /**
   * Content hash of the merged catalog. Forms part of every plan-cache key, so a
   * schema change invalidates every cached plan automatically. Do not attempt
   * selective invalidation — it will be wrong.
   */
  version: string;
}

/** Raised when the semantic layer disagrees with the database. */
export class CatalogDriftError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Business catalog does not match the database:\n  - ${problems.join('\n  - ')}`);
    this.name = 'CatalogDriftError';
  }
}
