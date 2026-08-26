/**
 * BizQL — the typed query IR for AgentsPilot's Business OS.
 *
 * A closed, serialisable, NON-Turing-complete description of a question about a
 * user's business. There is deliberately no raw-SQL escape hatch: every query
 * must be expressible in this structure, and everything in this structure is
 * validated against the Business Catalog before it touches the database. That
 * constraint is the entire safety argument, so resist adding `raw`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SHARED BY THREE CONSUMERS
 *
 *   Chat AI worker  — an LLM emits BizQL; nothing else. It never sees SQL, never
 *                     names a table it wasn't given, and needs no phrasing examples.
 *   Insight detectors — hand-authored BizQL replaces ~29 bespoke Supabase queries,
 *                     each of which currently re-implements `.eq('user_id', …)`.
 *   Automation kernel — a standing automation is a STORED BizQL query plus an
 *                     action. Because BizQL is plain JSON, it persists in a
 *                     jsonb column and survives restarts and redeploys.
 *
 * Because it is shared, an improvement to the compiler (a new operator, a better
 * date resolver) reaches all three at once.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/business-os/bizql
 */

// =============================================================================
// VALUES
// =============================================================================

/**
 * A relative date the caller can express without knowing today's date.
 *
 * Resolved server-side against the user's timezone, which is what removes the
 * need for separate `today` / `tomorrow` / `this week` handling per phrasing.
 */
export interface DateExpr {
  $date:
    | 'now'
    | 'today'
    | 'tomorrow'
    | 'yesterday'
    | 'start_of_week'
    | 'end_of_week'
    | 'start_of_month'
    | 'end_of_month';
  offset?: { days?: number; weeks?: number; months?: number };
}

/**
 * An intent-level term resolved via the catalog, e.g. `{ $semantic: 'open' }` on
 * `invoices.status` becomes `['sent','overdue']`.
 *
 * The planner emits vocabulary, never storage values. This is what makes Hebrew,
 * Spanish and unseen English phrasings work with no per-language mapping table.
 */
export interface SemanticValue {
  $semantic: string;
}

/** A reference to an earlier step's output, e.g. `{ $: 's1.rows[].email' }`. */
export interface StepRef {
  $: string;
}

export type ScalarValue = string | number | boolean | null;

/**
 * Array members may themselves be semantic or date expressions — a planner
 * legitimately writes `status in [{$semantic:'unpaid'},{$semantic:'overdue'}]`.
 * The compiler expands and flattens them.
 */
export type ArrayMember = ScalarValue | DateExpr | SemanticValue;

export type QueryValue = ScalarValue | ArrayMember[] | DateExpr | SemanticValue | StepRef;

export function isDateExpr(v: unknown): v is DateExpr {
  return typeof v === 'object' && v !== null && '$date' in v;
}

export function isSemanticValue(v: unknown): v is SemanticValue {
  return typeof v === 'object' && v !== null && '$semantic' in v;
}

export function isStepRef(v: unknown): v is StepRef {
  return typeof v === 'object' && v !== null && '$' in v;
}

// =============================================================================
// PREDICATES
// =============================================================================

export type ComparisonOp =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'not_in'
  | 'contains'
  | 'starts_with'
  | 'is_null'
  | 'is_not_null'
  | 'overlaps';

/** Operators that take no `value`. Validated, so a malformed plan fails loudly. */
export const VALUELESS_OPS: ReadonlySet<string> = new Set(['is_null', 'is_not_null']);

export interface FieldPredicate {
  /** A catalog field key, or a declared derived-field key. */
  field: string;
  op: ComparisonOp;
  value?: QueryValue;
}

/**
 * A predicate over a relation — "has no bookings with a completed intake".
 *
 * `none` is why the compiler exists at all: PostgREST cannot express NOT EXISTS,
 * so the compiler lowers this to a two-pass anti-join. Callers never see that.
 */
export interface RelationPredicate {
  relation: string;
  quantifier: 'any' | 'none';
  where?: Predicate[];
}

export interface AndPredicate {
  and: Predicate[];
}
export interface OrPredicate {
  or: Predicate[];
}
export interface NotPredicate {
  not: Predicate;
}

export type Predicate =
  | FieldPredicate
  | RelationPredicate
  | AndPredicate
  | OrPredicate
  | NotPredicate;

export function isFieldPredicate(p: Predicate): p is FieldPredicate {
  return 'field' in p;
}
export function isRelationPredicate(p: Predicate): p is RelationPredicate {
  return 'relation' in p;
}
export function isAndPredicate(p: Predicate): p is AndPredicate {
  return 'and' in p;
}
export function isOrPredicate(p: Predicate): p is OrPredicate {
  return 'or' in p;
}
export function isNotPredicate(p: Predicate): p is NotPredicate {
  return 'not' in p;
}

// =============================================================================
// QUERIES
// =============================================================================

export interface SortSpec {
  field: string;
  dir: 'asc' | 'desc';
}

/** Pull fields from a related entity alongside the main rows. */
export interface IncludeSpec {
  relation: string;
  select?: string[];
}

/** A read. The only step type Phase 1 implements. */
export interface FindQuery {
  /** Step id within a plan ('s1'). Referenced by answer placeholders. */
  id?: string;
  op: 'find';
  entity: string;
  where?: Predicate[];
  select?: string[];
  include?: IncludeSpec[];
  order_by?: SortSpec[];
  limit?: number;
  offset?: number;
}

export type AggregateFn = 'count' | 'sum' | 'avg' | 'min' | 'max';

/** An aggregate. Computed in JS over a capped row set — see the compiler. */
export interface ComputeQuery {
  /** Step id within a plan ('s1'). Referenced by answer placeholders. */
  id?: string;
  op: 'compute';
  entity: string;
  where?: Predicate[];
  agg: { fn: AggregateFn; field?: string };
  group_by?: string;
}

/**
 * A write.
 *
 * `target` is deliberately restricted to an explicit id or a `find` spec — there
 * is no free-form "UPDATE ... WHERE" the planner can author. A selector-based
 * mutate is the most dangerous surface in the system, so it is opt-in per action
 * via the catalog's `allowBulk`, and every path through it is previewed and
 * confirmed before anything is written.
 */
export interface MutateQuery {
  /** Step id within a plan ('s1'). */
  id?: string;
  op: 'mutate';
  entity: string;
  /** Catalog action key: 'create' | 'update' | 'delete' | 'mark_paid' | … */
  action: string;
  /** Which row. Omitted for `create`. */
  target?: { id: string };
  /** Field values, keyed by catalog field name (not column name). */
  data?: Record<string, ScalarValue>;
}

/**
 * Apply one action to every row a previous step returned.
 *
 * This is the step that completes "find everyone without an intake form AND
 * SEND IT TO THEM" — the half that no previous version of this chat could
 * express at all.
 *
 * Deliberately constrained:
 *   - depth 1 only, and `body` is a single action, not a nested plan. Arbitrary
 *     nesting is where previewability and determinism break down.
 *   - the action must be declared `allowBulk` in the catalog, which defaults to
 *     false, so fan-out is opt-in per action rather than a general capability.
 *   - `max` is clamped to the catalog's `maxFanout`. Uncapped fan-out is never
 *     acceptable.
 */
export interface ForEachQuery {
  id?: string;
  op: 'for_each';
  /** Step id whose rows to iterate. */
  over: string;
  /** The action to apply to each row. */
  action: string;
  /** Entity the action belongs to. */
  entity: string;
  /**
   * Parameters. `{"$item":"email"}` reads a field from the current row — the
   * only form of interpolation allowed, so a body cannot reach outside its item.
   */
  params?: Record<string, unknown>;
  max?: number;
}

export type Query = FindQuery | ComputeQuery | MutateQuery | ForEachQuery;

/** `{"$item":"email"}` — a field of the row currently being processed. */
export interface ItemRef {
  $item: string;
}

export function isItemRef(v: unknown): v is ItemRef {
  return typeof v === 'object' && v !== null && '$item' in v;
}

/** Queries that only read. Used to decide whether a plan needs confirmation. */
export function isReadOnly(query: Query): boolean {
  return query.op === 'find' || query.op === 'compute';
}

// =============================================================================
// RESULTS
// =============================================================================

export interface QueryRow {
  [key: string]: unknown;
}

export interface FindResult {
  op: 'find';
  entity: string;
  rows: QueryRow[];
  /** True when `limit` truncated the result — never hidden from the caller. */
  truncated: boolean;
  limit: number;
}

export interface ComputeResult {
  op: 'compute';
  entity: string;
  value: number | null;
  groups?: Array<{ key: string; value: number }>;
  /**
   * True when the aggregate ran over a capped scan and may therefore be
   * incomplete. Callers MUST surface this rather than presenting a wrong total.
   */
  approximate: boolean;
}

export interface MutateResult {
  op: 'mutate';
  entity: string;
  action: string;
  /** False when this was a dry run: nothing was written. */
  applied: boolean;
  /** The affected row, after the write (or as it would be, when previewing). */
  row?: QueryRow;
  /** Human-readable summary of the effect, for the confirmation card. */
  preview?: string;
}

export interface ForEachResult {
  op: 'for_each';
  entity: string;
  action: string;
  applied: boolean;
  attempted: number;
  succeeded: number;
  failed: number;
  skipped: number;
  /** Per-item outcomes. Partial failure must be reportable, never averaged away. */
  items: Array<{ id: string; target?: string; ok: boolean; error?: string }>;
  /** Set when the caller asked for more than the catalog permits. */
  cappedAt?: number;
}

export type QueryResult = FindResult | ComputeResult | MutateResult | ForEachResult;

// =============================================================================
// ERRORS
// =============================================================================

/** A plan that does not typecheck against the catalog. Never reaches the DB. */
export class BizQLValidationError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid BizQL query:\n  - ${problems.join('\n  - ')}`);
    this.name = 'BizQLValidationError';
  }
}

/** A query whose intermediate result set is too large to answer honestly. */
export class ResultSetTooLargeError extends Error {
  constructor(
    public readonly entity: string,
    public readonly count: number,
    public readonly cap: number
  ) {
    super(
      `Query over '${entity}' matched ${count} intermediate rows, above the ${cap} cap. ` +
        `Narrow the filter, or run this as a scheduled automation instead.`
    );
    this.name = 'ResultSetTooLargeError';
  }
}

/** Execution context. `userId` is mandatory and is never taken from the IR. */
export interface QueryContext {
  userId: string;
  /** IANA timezone used to resolve DateExpr. Defaults to UTC. */
  timezone?: string;
  /** Identifies the caller for logging: which of the three consumers ran this. */
  consumer?: 'chat' | 'detector' | 'kernel' | 'test';

  /**
   * Internal, populated by the compiler's pre-pass. Maps
   * '<entity>.<field>' → classifier → this user's stored values, for fields
   * whose allowed values live in another table.
   */
  _enumCache?: Map<string, Map<string, string[]>>;

  /**
   * Internal. This user's raw values for a data-driven field, used to build a
   * helpful error when the classifier column is unavailable.
   */
  _enumValues?: Map<string, string[]>;

  /**
   * Internal. '<entity>.<field>' → lowercased value OR label → stored value.
   * Lets a caller filter by the label a business actually uses ("לקוח") rather
   * than the internal key ("family_enrolled").
   */
  _enumLabels?: Map<string, Map<string, string>>;
}
