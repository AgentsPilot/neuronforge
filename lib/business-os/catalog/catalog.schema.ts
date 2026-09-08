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
  /** True when the column is in PostgREST's `required` set. */
  required: boolean;
  /**
   * True when the column has a database default.
   *
   * `required` alone does not mean "must be supplied" — `id` is required and
   * defaults to gen_random_uuid(). Required AND defaultless is the set an insert
   * genuinely fails without, and that is what the create-coverage check uses.
   */
  hasDefault?: boolean;
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
  /**
   * Another column subtracted from `column` when this field is aggregated.
   *
   * Some money is not what was kept. `payment_transactions.amount` is the
   * ORIGINAL charge and stays at its full value after a refund, so summing it
   * reports gross takings as revenue: four payments totalling 731.33 with 523
   * refunded read as 731.33 earned, and two fully refunded payments counted at
   * face value. Every "how much did I earn" answer was overstated by exactly
   * what had been given back.
   *
   * Declared rather than computed in SQL because there is no generated column
   * to lean on, and declared here rather than special-cased in the compiler
   * because nothing about it is specific to payments: any entity with a gross
   * figure and a deduction can say so.
   *
   * Both columns must exist — the drift check enforces it.
   */
  minus?: string;
  /**
   * Aggregating THIS field is ambiguous; use one of these instead.
   *
   * `payment_transactions.amount` is a per-payment charge — the right thing to
   * show on a row and to filter on, and a trap to sum: the total means either
   * what was billed or what was kept, and those differ by every refund. Naming
   * one of them `amount` made the same word mean gross in a listing and net in
   * a total, which is the confusion this catalog exists to prevent.
   *
   * So the field stays honest for display and refuses to be summed, and the
   * two totals have their own unambiguous names. The planner is told which,
   * and repairs.
   */
  aggregateInstead?: string[];
  type: FieldType;
  labels: Labels;
  /** Readable by the worker. Default true. Set false to hide (e.g. internal notes). */
  readable?: boolean;
  /** Writable by the worker. Default false — writing is opt-in, never inferred. */
  writable?: boolean;
  /**
   * The entity this field is a foreign key to, when it is one AND it is writable.
   *
   * Declaring it is what makes a writable FK safe. `user_id` scoping protects the
   * row being written, but says nothing about the row it POINTS AT: without this,
   * a plan could set `contact_id` to another tenant's contact. The executor
   * refuses to write a reference whose target the caller does not own, so a
   * writable FK must declare where it points.
   */
  references?: string;
  format?: FormatHint;
  /**
   * Allowed values, when this repo's convention is a CHECK constraint rather than a
   * PG enum type. NOTE: PostgREST does not expose CHECK values, so these CANNOT be
   * verified automatically — see `enumSource` when the values are data-driven.
   */
  enumValues?: string[];
  /**
   * What each stored value is CALLED, per language.
   *
   * Display only. Without it the renderer printed the stored token, so a
   * Hebrew answer read "סטטוס: overdue" — the label translated, the
   * value not. Distinct from `semanticTerms`, which is about understanding
   * what the user typed; this is about what we show back.
   *
   * Optional: a value with no entry falls back to a readable form of the token
   * itself, so a new status is never a blank.
   */
  enumLabels?: Record<string, { en: string; he?: string; es?: string }>;
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
export interface DerivedExpansion {
  relation: string;
  /** 'any' → EXISTS, 'none' → NOT EXISTS, 'count' → aggregate. */
  quantifier: 'any' | 'none' | 'count';
  where?: Array<{ field: string; op: string; value?: unknown }>;
}

export interface DerivedFieldDef {
  type: 'boolean' | 'number' | 'datetime';
  labels: Labels;
  /**
   * One expansion, or SEVERAL that are OR'd together.
   *
   * A single relation could not express a fact that reaches a row by more than
   * one route, and "owes me money" is exactly that: an unpaid invoice OR an
   * uncollected payment-plan period. The plan grammar has no OR — `where` is a
   * conjunction — so a question spanning two routes was inexpressible at every
   * layer, and the planner answered it from whichever route it thought of
   * first. Invoices, in that case, which for a business selling in instalments
   * is always the empty one.
   *
   * The array form resolves each expansion and unions the matching ids, so the
   * planner still emits one ordinary boolean and never learns there are two
   * tables behind it.
   */
  expand: DerivedExpansion | DerivedExpansion[];
}

/** Risk tier. Drives confirmation, and whether bulk fan-out is permitted at all. */
export type RiskLevel = 'read' | 'create' | 'update' | 'delete' | 'send';

export interface ActionDef {
  labels: Labels;
  risk: RiskLevel;
  requiresConfirmation: boolean;
  /**
   * Do this action's declared fields name COLUMNS, or parameters?
   *
   * Almost every action writes to the row it names, so its `requiredFields` and
   * `optionalFields` must be real writable columns — the check that caught
   * `invoices.create` offering a `contact_id` nobody had marked writable.
   *
   * Some actions take instructions instead. `contacts.send` needs a subject and
   * a body; `business_profile.set_availability` needs a day and a pair of times.
   * None of those is a column of anything, and forcing them to be would mean
   * inventing nonsense columns purely to satisfy a validator.
   *
   * Setting this false says so explicitly, and turns off BOTH the column check
   * in the catalog build and the writable-field mapping in the executor. It
   * stays safe because such an action writes nothing to the row directly: it
   * hands its parameters to a reviewed handler, exactly like a repository call.
   */
  writesRow?: boolean;
  /**
   * Does this action need a row to be pointed at?
   *
   * Almost always yes: "cancel WHICH booking" is the whole question, and a
   * mutate without a target is a write nobody was shown. `create` is the
   * standing exception — it is making the row.
   *
   * Some entities are a SINGLETON per user, though. There is exactly one
   * business profile, so "change Tuesday to 9-2" has nothing to identify: the
   * row is whoever is asking. Without this, the planner dutifully invents a
   * lookup step and then points the mutate at it, which validation refuses —
   * and a perfectly clear request fails for want of a target that could only
   * ever have one value.
   */
  needsTarget?: boolean;
  /**
   * NOT NULL columns this action's HANDLER fills in, so the user never supplies
   * them — `user_id` from the context, a generated invoice number, a default
   * status.
   *
   * Declared so the create-coverage check can tell "the handler takes care of
   * it" apart from "nobody takes care of it". Getting that wrong is not a
   * cosmetic error: `invoices.create` and `activities.create` were both declared,
   * both planned correctly, and both failed at the insert on every call, because
   * a dry run validates a plan and never reaches the handler.
   */
  handlerSupplies?: string[];
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
  /**
   * The OTHER words this thing is called, in any language.
   *
   * `labels` is what we show. This is what people say, and the two are not the
   * same: `contacts` is labelled "אנשי קשר", and every user in this product
   * calls them "לקוחות". A tutor says "תלמידים", a clinic says "מטופלים".
   *
   * Not a synonym table for fields — that is deliberately absent, and stays
   * absent, because field vocabulary is open-ended and the model maps it from
   * the values themselves. Entity names are a CLOSED set of about twenty, they
   * are the first choice every plan makes, and getting one wrong makes every
   * subsequent step answer a different question.
   *
   * Used twice: shown to the planner so it picks the right entity, and matched
   * against the answer sentence so a count of one thing cannot be described as
   * a count of another.
   */
  aliases?: string[];
  /**
   * Whether this entity can be READ with find/compute. Default true.
   *
   * False for a configuration singleton: one row, a couple of columns, and
   * nothing anyone would query. Its purpose in the catalog is its ACTIONS.
   *
   * `business_profile` is the case that needed it. Asked "how many hours are
   * still open on Wednesday" the planner reliably emitted `find
   * business_profile` — which returns company_name and vertical, cannot answer
   * the question, and looks like an answer. Wording the action's label more
   * invitingly moved the rate around and never fixed it, because a plausible
   * wrong option stays available however the right one is described.
   *
   * So the wrong option is removed. A flag on the entity is the honest place
   * for it: "this is not a queryable collection" is a fact about the entity,
   * not a rule about one question, and the validator can state it generically.
   */
  queryable?: boolean;
  /** Column used when naming a row in prose or a card title. */
  labelField: string | string[];
  /** Columns shown by default in a result card. */
  displayFields?: string[];
  /**
   * Relations always fetched for display, whatever the caller selected.
   *
   * An invoice without its client answers "what is unpaid", not "who owes me
   * money"; a booking without its contact and service is a bare timestamp. These
   * are the relations that make a row mean something to a person, so the
   * compiler embeds them automatically rather than trusting the planner to
   * remember.
   */
  displayRelations?: string[];
  /** Columns free-text search should cover. */
  searchableFields?: string[];
  /**
   * What this table RECORDS, when the column names do not say.
   *
   * For entities that plainly describe themselves, leave it out — a line per
   * entity restating the obvious is prompt weight that buys nothing.
   *
   * It earns its place where several entities could answer the same question and
   * mean different things by it. "How much revenue did each service bring in?"
   * can be summed from invoices (what was billed), transactions (what arrived),
   * or bookings (what was booked and may never be paid). All three compile; only
   * one is what the person asking meant, and no column name distinguishes them.
   *
   * State the MEANING, never the query. "money actually received" is a fact
   * about the data and stays true as the catalog grows; "use this for revenue
   * questions" is an instruction that goes stale the moment another entity
   * qualifies, and is the hardcoding this catalog exists to avoid.
   */
  meaning?: string;
  fields: Record<string, FieldDef>;
  relations?: Record<string, RelationDef>;
  derived?: Record<string, DerivedFieldDef>;
  actions?: Record<string, ActionDef>;
  /**
   * Collapse rows sharing this field, keeping the first by the query's ordering.
   *
   * Some tables record every detection rather than the current state: `insights`
   * holds 994 rows for one `ops_utilization_low` finding. Asking "what's urgent?"
   * and getting the same item twenty times is useless, and the repetition says
   * nothing about the business — only about how often the detector ran.
   *
   * The count of collapsed rows is reported, never silently dropped.
   */
  dedupeBy?: string;

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
