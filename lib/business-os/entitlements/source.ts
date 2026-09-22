// lib/business-os/entitlements/source.ts
//
// THE LOADER SEAM — the one place the entitlement configuration is read from.
//
// Requirement T-1 / FR-34, workplan §4.7.
//
// ── WHY A SEAM AT ALL ───────────────────────────────────────────────────────
// Today the configuration is TypeScript in this repository, and changing what a
// plan includes ships through a normal release (B-2). That is the right trade
// while pricing is still moving in reviewed batches: git history is a free audit
// trail and a Vercel redeploy takes minutes.
//
// It will not be the right trade forever. When the matrix stabilises, the
// business will want to move a capability between plans without a deploy. This
// interface is what makes that a later decision instead of a rewrite: a
// database-backed source implements the same `load()`, goes through the same Zod
// validation, and neither the resolver nor any enforcement point changes.
//
// ── WHY IT IS LAZY ──────────────────────────────────────────────────────────
// Nothing is read or validated until someone asks. That is not an optimisation:
// `shadow.ts` is imported by the chat route, and if loading config happened at
// module scope, a bad config would take chat down at cold start EVEN WITH
// ENTITLEMENTS SWITCHED OFF (workplan RC-7). Validation happens inside the
// caller's try, when the flag has already said yes.

import { CAPABILITIES } from './config/catalog';
import { TIER_MATRIX, TIER_ORDER } from './config/tierMatrix';
import { COHORTS } from './config/cohorts';
import type { CohortConfig, CohortId } from './config/cohorts';
import { LIFECYCLE_CONFIG } from './config/lifecycle';
import { ACTION_OVERRIDES, ENTITY_DOMAIN, PLAN_OP_CAPABILITY, READ_RULE } from './config/chatActionMap';
import { LAUNCH } from './config/launch';
import {
  catalogSchema,
  chatActionMapSchema,
  cohortsSchema,
  launchSchema,
  lifecycleSchema,
  tierMatrixSchema,
} from './schema';

/** Everything the resolver and the enforcement points read. */
export interface EntitlementConfig {
  catalog: typeof CAPABILITIES;
  tierOrder: readonly string[];
  matrix: typeof TIER_MATRIX;
  // Widened to the declared shape rather than the literal: a consumer asks
  // "does this cohort have a duration?", and on the literal type that question
  // is answered by which cohort you happened to name, not by the type.
  cohorts: Readonly<Record<CohortId, CohortConfig>>;
  lifecycle: typeof LIFECYCLE_CONFIG;
  chatActionMap: {
    entityDomain: typeof ENTITY_DOMAIN;
    actionOverrides: typeof ACTION_OVERRIDES;
    readRule: typeof READ_RULE;
    planOps: typeof PLAN_OP_CAPABILITY;
  };
  launch: typeof LAUNCH;
}

/**
 * Where configuration comes from.
 *
 * One method, deliberately: a source that could be asked for "just the tiers"
 * would let a future caller read half a configuration, and half a configuration
 * is how a capability ends up unvalidated.
 */
export interface TierMatrixSource {
  load(): EntitlementConfig;
}

/** Thrown when configuration does not validate. Never caught inside this module. */
export class EntitlementConfigError extends Error {
  constructor(
    message: string,
    /** The part that failed, so the message names it before the Zod detail. */
    readonly section: string,
    readonly issues: unknown
  ) {
    super(`entitlement config: ${section} is invalid — ${message}`);
    this.name = 'EntitlementConfigError';
  }
}

function parseOrThrow(section: string, schema: { safeParse: (value: unknown) => { success: boolean; error?: unknown } }, value: unknown): void {
  const result = schema.safeParse(value);
  if (!result.success) {
    const error = result.error as { issues?: Array<{ path: Array<string | number>; message: string }> };
    const first = error.issues?.[0];
    const where = first && first.path.length > 0 ? ` at ${first.path.join('.')}` : '';
    throw new EntitlementConfigError(`${first?.message ?? 'validation failed'}${where}`, section, error.issues);
  }
}

/**
 * Validate a configuration. Exported so tests can run the real rules over a
 * fixture without going through a source.
 *
 * @param allowRenewalGrandfather Slice 4 flips this on when renewals exist.
 */
export function validateEntitlementConfig(config: EntitlementConfig, allowRenewalGrandfather = false): void {
  // Every schema is built from THIS config's catalog, not from the one compiled
  // into schema.ts — so a config that adds a capability has the rules applied to
  // that capability too.
  const catalog = config.catalog;

  parseOrThrow('catalog', catalogSchema(), catalog);
  parseOrThrow('tier matrix', tierMatrixSchema(config.tierOrder, catalog, allowRenewalGrandfather), config.matrix);
  parseOrThrow('cohorts', cohortsSchema(config.tierOrder, catalog), config.cohorts);
  parseOrThrow('lifecycle', lifecycleSchema(catalog), config.lifecycle);
  parseOrThrow('chat action map', chatActionMapSchema(catalog), config.chatActionMap);
  parseOrThrow('launch', launchSchema(), config.launch);
}

/** Assemble the in-repo configuration without validating it. */
export function readCodeConfig(): EntitlementConfig {
  return {
    catalog: CAPABILITIES,
    tierOrder: TIER_ORDER,
    matrix: TIER_MATRIX,
    cohorts: COHORTS,
    lifecycle: LIFECYCLE_CONFIG,
    chatActionMap: {
      entityDomain: ENTITY_DOMAIN,
      actionOverrides: ACTION_OVERRIDES,
      readRule: READ_RULE,
      planOps: PLAN_OP_CAPABILITY,
    },
    launch: LAUNCH,
  };
}

/**
 * The shipped source: configuration from this repository, validated on first
 * use and then remembered.
 *
 * Memoised per instance rather than per module so a test can hold its own.
 */
export class CodeTierMatrixSource implements TierMatrixSource {
  private cached: EntitlementConfig | null = null;

  load(): EntitlementConfig {
    if (this.cached) return this.cached;

    const config = readCodeConfig();
    validateEntitlementConfig(config);
    this.cached = config;
    return config;
  }

  /** Forget the memoised config. Tests only. */
  reset(): void {
    this.cached = null;
  }
}

let defaultSource: TierMatrixSource = new CodeTierMatrixSource();

/**
 * The configuration, validated.
 *
 * Callers pass a source only in tests. Everything else takes the default, which
 * is how there comes to be exactly one answer to "what does the config say?".
 */
export function getEntitlementConfig(source: TierMatrixSource = defaultSource): EntitlementConfig {
  return source.load();
}

/**
 * Replace the default source. Tests only — and the reason it exists is the
 * fixture matrix: the tier SEMANTICS (every capability assigned, one-line
 * changes, grandfathering) can only be exercised against a config that has
 * tiers, and production has none.
 */
export function setDefaultEntitlementSource(source: TierMatrixSource): void {
  defaultSource = source;
}

/** Restore the shipped source. */
export function resetDefaultEntitlementSource(): void {
  defaultSource = new CodeTierMatrixSource();
}
