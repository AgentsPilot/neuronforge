// lib/business-os/purge/types.ts
//
// T5 — shared types for the Business OS purge engine.
//
// The two descriptor types below are the load-bearing part of this feature.
// Requirement §10.9 requires that the executor iterate *only* a declarative
// descriptor structure, and that no table or bucket name appear anywhere else
// in the code. The structural-invariant suite (T6 / AC-45) enforces that
// mechanically, so these shapes are the contract that test checks against.

/** Reset keeps configuration and identity; Purge removes everything but the login. */
export type PurgeLevel = 'reset' | 'purge';

/** The three opt-in extras (§10.3), all off by default. */
export type PurgeOptInKey = 'integrations' | 'agents' | 'activityHistory';

export interface PurgeOptions {
  integrations: boolean;
  agents: boolean;
  activityHistory: boolean;
}

/**
 * When a descriptor's rows are removed.
 *
 * - `reset`             — removed by both levels (the `D` column in §3).
 * - `purge`             — kept by Reset, removed by Purge (the `K` column).
 * - `never`             — removed by neither. Covers BOTH the §8 exclusion set
 *                         AND the two `K*` retentions (`email_unsubscribes`,
 *                         `user_preferences`).
 * - `optional:<key>`    — removed only when the matching checkbox is ticked.
 *
 * `never` carrying two different meanings is deliberate: the executor does not
 * need to distinguish "excluded because it belongs to another tenant's world"
 * from "retained because we promised to retain it", and collapsing them keeps
 * the delete-emitting code path incapable of touching either. The *reason* is
 * carried in `notes`, which is what a human reads.
 */
export type PurgeDescriptorLevel =
  | 'reset'
  | 'purge'
  | 'never'
  | `optional:${PurgeOptInKey}`;

/**
 * How a table's rows are tied to a tenant.
 *
 * `global` exists only so §8's exclusions can be enumerated as descriptors —
 * FR-1 route (a) cannot otherwise tell an unknown table from a deliberately
 * excluded one, and would fail closed on every run. A `global` descriptor must
 * never emit a delete; T6 asserts it.
 */
export type PurgeScope =
  | { kind: 'user_id' }
  | { kind: 'via'; parent: string; fk: string }
  | { kind: 'global' };

/**
 * What the pre-purge snapshot records for a table.
 *
 * `ids` exists for `website_page_views` and `smart_link_clicks` only: both are
 * unbounded, publicly writable (`WITH CHECK (true)`) and append-only, and both
 * are forensically worthless row by row. Applying the global row ceiling to
 * them instead would make a high-traffic business permanently undeletable,
 * which is a broken product rather than a safety property. Ids-only still
 * satisfies AC-5, which needs the child *ids*, not their rows.
 */
export type PurgeSnapshotMode = 'rows' | 'ids';

export interface PurgeDescriptor {
  table: string;
  level: PurgeDescriptorLevel;
  scope: PurgeScope;
  /** Delete order, derived from the live `pg_constraint` dump (T3), not migrations. */
  order: number;
  snapshot: PurgeSnapshotMode;
  /** Why this row is classified as it is. Comment the *why*, per CLAUDE.md. */
  notes?: string;
}

/**
 * Storage buckets (C-16).
 *
 * Buckets get descriptors for the same reason tables do: a bucket added later
 * and missed is the exact failure the descriptor set exists to prevent — and
 * unlike tables, storage has no `information_schema` to fail closed against, so
 * the descriptor list is the *only* inventory that exists.
 */
export interface StorageDescriptor {
  bucket: string;
  level: 'reset' | 'purge' | 'never';
  /** Always `{user_id}/` today; explicit so a future layout change is visible. */
  pathPrefix: string;
  purpose: string;
}

// ── Pre-flight gate ─────────────────────────────────────────────────────────

/** The four blocking conditions of §10.5.1. C2 is split so messages can differ. */
export type GateConditionId = 'C1' | 'C2_CHARGES' | 'C2_REFUNDS' | 'C3';

export interface GateBlock {
  condition: GateConditionId;
  count: number;
  /**
   * Stripe-side identifiers the owner can search for (AC-16, a D9 un-gating
   * condition). Never a bare "resolve your outstanding items".
   */
  identifiers: string[];
  message: string;
}

/**
 * Why a gate run produced no verdict.
 *
 * `skipped` is NOT a failure — a business with no Stripe connected passes
 * cleanly with no warning surfaced (FR-8, AC-11). Every other non-pass value
 * is a refusal.
 */
export type GateOutcome = 'passed' | 'blocked' | 'skipped' | 'refused';

export type GateRefusalReason =
  | 'provider_error'
  | 'provider_timeout'
  | 'rate_limited'
  | 'budget_exceeded'
  | 'page_cap_exceeded';

export interface GateResult {
  outcome: GateOutcome;
  /** Present when `outcome === 'blocked'`. */
  blocks: GateBlock[];
  /** Present when `outcome === 'refused'`. Distinct message per AC-17. */
  refusalReason?: GateRefusalReason;
  /** Connected-account candidates actually queried (deduped upstream). */
  accountIds: string[];
  /** Non-blocking provider state reported to the user (§7). */
  nonBlocking: Array<{ kind: string; count: number; detail?: string }>;
  evaluatedAt: string;
  durationMs: number;
}

// ── Result ──────────────────────────────────────────────────────────────────

export interface StorageRemovalResult {
  bucket: string;
  deleted: number;
  /** Per-object failures. Surfaced as residue; never fails the run (FR-22, AC-47). */
  failed: Array<{ path: string; reason: string }>;
}

export interface PurgeReport {
  level: PurgeLevel;
  options: PurgeOptions;
  correlationId: string;
  /** Rows deleted per table, as returned by the phase-2 RPC. */
  rowsByTable: Record<string, number>;
  /** Tables the engine knowingly did not touch, and why. */
  skipped: Array<{ table: string; reason: string }>;
  storage: StorageRemovalResult[];
  snapshotPath: string;
  /** Both gate evaluations are recorded so the TOCTOU window is measurable (FR-19). */
  gateAtPreview: GateResult;
  gateAtCommit: GateResult;
  committedAt: string;
  durationMs: number;
}
