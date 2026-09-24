// lib/business-os/entitlements/resolver.ts
//
// WHAT DOES THIS ACCOUNT ACTUALLY HAVE?
//
// Workplan §4.8 (FR-9, FR-10, FR-13, T-4, T-11, RC-2, RC-11, A-1). Pure: config,
// account, overrides, add-ons and `now` in; a snapshot out. No clock, no
// environment, no database, no logging.
//
// ── THE LAYERS, AND WHY THEY ARE IN THIS ORDER ──────────────────────────────
//   1  basis          the tier row, or the cohort's base
//   1a grandfathered  what a subscriber keeps after a removal (B-10)
//   2  add-ons        bought on top (Slice 4 data; the merge ships now)
//   3  cohort values  quantities a `{ all: true }` base cannot derive
//   4  overrides      one admin, one account, one capability (FR-11)
//   5  state overlay  NOT HERE — it is per surface, so it lives in decide.ts
//
// Each layer can only be understood against the one before it, so every change
// is recorded in a trace and `explain()` hands it back verbatim (FR-10). The
// trace is the difference between "you do not have this" and "you do not have
// this because the Growth row says false and nobody overrode it".
//
// ── WHAT THIS FILE REFUSES TO DO ────────────────────────────────────────────
// It never decides whether an ACTION is allowed. It answers "what does the
// account have", and `decide.ts` answers "may this call go ahead", because the
// second question needs a surface, a request and a balance. Keeping them apart
// is what lets the shadow report resolve ten thousand accounts without inventing
// a surface for each.

import type { CapabilityDef } from './types';
import type { CapabilityValue, LifecycleState, MeteredValue, QuantityValue } from './types';
import type { EntitlementAccount, EntitlementOverride } from './account';
import type { EntitlementConfig } from './source';
import type { CatalogLike } from './schema';
import { rankValue } from './snapshot';
import { deriveLifecycle } from './lifecycle';
import type { EntitlementAnomaly, EntitlementBasis, LifecycleResult } from './lifecycle';

/** An add-on an account has bought. Slice 4 fills these in; Slice 1 passes `[]`. */
export interface EntitlementAddon {
  capability: string;
  /** Quantity/metered add-ons add to the base; boolean and add-on shapes just switch it on. */
  amount?: number;
}

/** One step of how a value came to be what it is. */
export interface TraceEntry {
  layer: 'basis' | 'lifecycle_gate' | 'grandfather' | 'addon' | 'cohort_values' | 'override';
  from: CapabilityValue | null;
  to: CapabilityValue;
  note: string;
}

export interface ResolvedCapability {
  value: CapabilityValue;
  /** The layer that last changed it. */
  decidedBy: TraceEntry['layer'];
  trace: TraceEntry[];
}

export interface EntitlementResolution {
  accountId: string | null;
  state: LifecycleState;
  basis: EntitlementBasis;
  lifecycle: LifecycleResult;
  /** Every capability in the catalog. Never a subset: "absent" must not be ambiguous. */
  values: Readonly<Record<string, ResolvedCapability>>;
  anomaly?: EntitlementAnomaly;
  /** The matrix version the values were resolved against. */
  matrixVersion: number;
  /** Ignored overrides, and why — never silently dropped. */
  ignoredOverrides: Array<{ id: string; capability: string; reason: 'ended' | 'expired' | 'unknown_capability' | 'not_built' }>;
}

export interface ResolveInput {
  config: EntitlementConfig;
  account: EntitlementAccount | null;
  overrides: readonly EntitlementOverride[];
  /** Always `[]` in Slice 1 (S-3). The merge is implemented and fixture-tested. */
  addons?: readonly EntitlementAddon[];
  now: Date;
}

/** The value that means "withheld", per shape. The resolver's floor. */
export function withheldValue(definition: CapabilityDef): CapabilityValue {
  const shape = definition.shape;
  switch (shape.kind) {
    case 'boolean':
    case 'group':
      return false;
    case 'variant':
      return shape.variants[0];
    case 'addon':
      return 'unavailable';
    case 'metered':
      return { perMonth: 0 };
    case 'quantity':
      return { included: 0 };
    case 'fair_use':
      return { ceilingPerMonth: 0 };
  }
}

/** The highest value a shape admits, where "highest" is derivable (RC-2). */
function derivedMaximum(definition: CapabilityDef): CapabilityValue | null {
  const shape = definition.shape;
  switch (shape.kind) {
    case 'boolean':
    case 'group':
      return true;
    case 'variant':
      return shape.variants[shape.variants.length - 1];
    case 'addon':
      return 'included';
    // A quantity, an allowance and a ceiling have no maximum. The cohort states
    // them, and the type system insists it does (CohortExplicitValues).
    case 'metered':
    case 'quantity':
    case 'fair_use':
      return null;
  }
}

/**
 * Is this capability reachable at all, for this basis?
 *
 * `not_built` is never reachable, whatever any layer says (FR-13) — it is not a
 * pricing decision, it is a statement that the code does not exist.
 *
 * `beta` is reachable only through a cohort that opts in, or an override. A tier
 * cannot sell it: the catalog defines `beta` as "exists, but only reached
 * through a cohort or an override", and selling something on those terms is how
 * a customer ends up paying for a feature we are still willing to change.
 */
function lifecycleGate(
  definition: CapabilityDef,
  basis: EntitlementBasis,
  config: EntitlementConfig
): { reachable: boolean; note: string } {
  if (definition.lifecycle === 'not_built') {
    return { reachable: false, note: 'not_built: the feature does not exist, so nothing can grant it (FR-13)' };
  }

  if (definition.lifecycle === 'beta') {
    if (basis.kind === 'cohort') {
      const cohort = config.cohorts[basis.cohort as keyof typeof config.cohorts];
      const opted = cohort?.includeLifecycle.includes('beta') ?? false;
      return opted
        ? { reachable: true, note: `beta: included because the ${basis.cohort} cohort opts in` }
        : { reachable: false, note: `beta: the ${basis.cohort} cohort does not opt in` };
    }
    return { reachable: false, note: 'beta: reachable through a cohort or an override, not through a tier' };
  }

  return { reachable: true, note: '' };
}

/** Add two values of the same shape, for add-ons and `op: 'add'` overrides. */
function addTo(definition: CapabilityDef, current: CapabilityValue, amount: number): CapabilityValue {
  switch (definition.shape.kind) {
    case 'metered': {
      const value = current as MeteredValue;
      return 'total' in value ? { total: value.total + amount } : { perMonth: value.perMonth + amount };
    }
    case 'quantity': {
      const value = current as QuantityValue;
      return { ...value, included: value.included + amount };
    }
    case 'fair_use':
      return { ceilingPerMonth: (current as { ceilingPerMonth: number }).ceilingPerMonth + amount };
    default:
      // Nothing to add to: an add-on on a boolean or a variant switches it on,
      // which layer 2 does directly.
      return current;
  }
}

/** True when `candidate` is strictly better than `current` for this capability. */
function isHigher(definition: CapabilityDef, candidate: CapabilityValue, current: CapabilityValue): boolean {
  const a = rankValue(candidate, definition);
  const b = rankValue(current, definition);
  if (a === null || b === null) return false;
  return a > b;
}

/**
 * Resolve every capability for one account.
 *
 * Returns a value for EVERY capability in the catalog, including the ones the
 * account does not have. A caller can then ask about anything without having to
 * know whether the key exists, and "missing" never has to mean two things.
 */
export function resolveEntitlements(input: ResolveInput): EntitlementResolution {
  const { config, account, overrides, now } = input;
  const addons = input.addons ?? [];
  const catalog = config.catalog as CatalogLike;

  const lifecycle = deriveLifecycle(account, {
    cohorts: config.cohorts,
    tierOrder: config.tierOrder,
    subscriptionGraceHistory: config.lifecycle.subscriptionGraceHistory,
  }, now);

  const values: Record<string, ResolvedCapability> = {};
  const ignoredOverrides: EntitlementResolution['ignoredOverrides'] = [];

  const effectiveVersion =
    account && account.planVersion > 0 ? account.planVersion : config.matrix.version;

  for (const [capability, definition] of Object.entries(catalog)) {
    const trace: TraceEntry[] = [];
    let value = withheldValue(definition);
    let decidedBy: TraceEntry['layer'] = 'basis';

    const gate = lifecycleGate(definition, lifecycle.basis, config);

    // ── Layer 1: the basis ────────────────────────────────────────────────
    if (lifecycle.basis.kind === 'none') {
      trace.push({ layer: 'basis', from: null, to: value, note: `no basis: ${lifecycle.reason}` });
    } else if (!gate.reachable) {
      trace.push({ layer: 'lifecycle_gate', from: null, to: value, note: gate.note });
      decidedBy = 'lifecycle_gate';
    } else {
      const base = basisValue(capability, definition, lifecycle.basis, config);
      value = base.value;
      trace.push({ layer: 'basis', from: null, to: value, note: base.note });
    }

    // ── Layer 1a: grandfathering (tier accounts only, B-10/T-11) ──────────
    if (gate.reachable && lifecycle.basis.kind === 'tier' && account) {
      for (const removal of config.matrix.removals) {
        if (removal.capability !== capability) continue;
        if (removal.tier !== lifecycle.basis.tier) continue;
        // Only a removal made AFTER the version this account was sold at can
        // take something away from them.
        if (removal.version <= effectiveVersion) continue;
        if (removal.grandfatherUntil !== 'renewal' && !(now.getTime() < new Date(removal.grandfatherUntil).getTime())) {
          continue;
        }
        if (!isHigher(definition, removal.previousValue, value)) continue;

        trace.push({
          layer: 'grandfather',
          from: value,
          to: removal.previousValue,
          note: `kept from matrix v${effectiveVersion}; removed in v${removal.version} until ${removal.grandfatherUntil}`,
        });
        value = removal.previousValue;
        decidedBy = 'grandfather';
      }
    }

    // ── Layer 2: add-ons ──────────────────────────────────────────────────
    if (gate.reachable) {
      for (const addon of addons) {
        if (addon.capability !== capability) continue;
        const before = value;
        const kind = definition.shape.kind;
        value =
          kind === 'addon'
            ? 'included'
            : kind === 'boolean' || kind === 'group' || kind === 'variant'
              ? (derivedMaximum(definition) as CapabilityValue)
              : addTo(definition, value, addon.amount ?? 0);
        if (JSON.stringify(before) !== JSON.stringify(value)) {
          trace.push({ layer: 'addon', from: before, to: value, note: 'bought as an add-on' });
          decidedBy = 'addon';
        }
      }
    }

    // ── Layer 3: cohort values over a tier base ───────────────────────────
    // `{ all: true }` already used the cohort's numbers in layer 1, so this only
    // bites for a cohort whose base is a TIER: the cohort's explicit quantities
    // replace that tier's.
    if (gate.reachable && lifecycle.basis.kind === 'cohort') {
      const cohort = config.cohorts[lifecycle.basis.cohort as keyof typeof config.cohorts];
      const explicit = (cohort?.values as Record<string, CapabilityValue> | undefined)?.[capability];
      if (explicit !== undefined && 'tier' in (cohort?.base ?? {})) {
        if (JSON.stringify(explicit) !== JSON.stringify(value)) {
          trace.push({ layer: 'cohort_values', from: value, to: explicit, note: `the ${lifecycle.basis.cohort} cohort states this one` });
          value = explicit;
          decidedBy = 'cohort_values';
        }
      }
    }

    // ── Layer 4: overrides ────────────────────────────────────────────────
    const applicable = overrides
      .filter((o) => o.capability === capability)
      .slice()
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    for (const override of applicable) {
      if (override.endedAt) {
        ignoredOverrides.push({ id: override.id, capability, reason: 'ended' });
        continue;
      }
      if (override.expiresAt && !(now.getTime() < new Date(override.expiresAt).getTime())) {
        ignoredOverrides.push({ id: override.id, capability, reason: 'expired' });
        continue;
      }
      if (definition.lifecycle === 'not_built') {
        // An override is an admin's decision about pricing, not about whether
        // the code exists. This is the one layer that could plausibly be used to
        // "just turn it on for this customer", so it is refused explicitly.
        ignoredOverrides.push({ id: override.id, capability, reason: 'not_built' });
        continue;
      }

      const before = value;
      if (override.op === 'revoke') {
        value = withheldValue(definition);
      } else if (override.op === 'add') {
        value = addTo(definition, value, Number(override.value ?? 0));
      } else {
        value = override.value as CapabilityValue;
      }

      trace.push({ layer: 'override', from: before, to: value, note: `override ${override.id} (${override.op})` });
      decidedBy = 'override';
    }

    values[capability] = { value, decidedBy, trace };
  }

  for (const override of overrides) {
    if (!catalog[override.capability]) {
      ignoredOverrides.push({ id: override.id, capability: override.capability, reason: 'unknown_capability' });
    }
  }

  return {
    accountId: account?.accountId ?? null,
    state: lifecycle.state,
    basis: lifecycle.basis,
    lifecycle,
    values,
    anomaly: lifecycle.anomaly,
    matrixVersion: effectiveVersion,
    ignoredOverrides,
  };
}

/** Layer 1 for one capability. */
function basisValue(
  capability: string,
  definition: CapabilityDef,
  basis: EntitlementBasis,
  config: EntitlementConfig
): { value: CapabilityValue; note: string } {
  if (basis.kind === 'tier') {
    const row = (config.matrix.tiers as Record<string, Record<string, CapabilityValue>>)[basis.tier];
    const value = row?.[capability];
    return value === undefined
      ? { value: withheldValue(definition), note: `tier ${basis.tier} has no value for this capability` }
      : { value, note: `tier ${basis.tier}` };
  }

  if (basis.kind === 'cohort') {
    const cohort = config.cohorts[basis.cohort as keyof typeof config.cohorts];
    const base = cohort.base;

    if ('tier' in base) {
      const row = (config.matrix.tiers as Record<string, Record<string, CapabilityValue>>)[base.tier];
      const value = row?.[capability];
      return value === undefined
        ? { value: withheldValue(definition), note: `${basis.cohort} → tier ${base.tier} has no value for this capability` }
        : { value, note: `${basis.cohort} cohort, based on tier ${base.tier}` };
    }

    // `{ all: true }`: derive what can be derived, take the rest from the
    // cohort's stated values. A missing stated value is withheld rather than
    // guessed — and the config schema makes it a load error long before here.
    const derived = derivedMaximum(definition);
    if (derived !== null) return { value: derived, note: `${basis.cohort} cohort: everything` };

    const explicit = (cohort.values as Record<string, CapabilityValue>)[capability];
    return explicit === undefined
      ? { value: withheldValue(definition), note: `${basis.cohort} cohort states no value for this capability` }
      : { value: explicit, note: `${basis.cohort} cohort's stated value` };
  }

  return { value: withheldValue(definition), note: 'no basis' };
}

/**
 * The lowest configured tier that satisfies a request (RC-1).
 *
 * `null` when no tier does — which is every capability today, because production
 * ships no tiers (U-1). That `null` is what stops an upgrade prompt naming a
 * plan that does not exist.
 */
export function lowestTierFor(
  config: EntitlementConfig,
  capability: string,
  requested?: CapabilityValue
): string | null {
  const definition = (config.catalog as CatalogLike)[capability];
  if (!definition) return null;
  if (definition.lifecycle === 'not_built') return null;

  for (const tier of config.tierOrder) {
    const row = (config.matrix.tiers as Record<string, Record<string, CapabilityValue>>)[tier];
    const value = row?.[capability];
    if (value === undefined) continue;
    if (satisfies(definition, value, requested)) return tier;
  }

  return null;
}

/**
 * Does `held` cover `requested`?
 *
 * With no `requested`, the question is "is it granted at all", which is the same
 * question the not_built rule asks — deliberately the same helper, so the two
 * can never drift apart.
 */
export function satisfies(definition: CapabilityDef, held: CapabilityValue, requested?: CapabilityValue): boolean {
  const heldRank = rankValue(held, definition);

  if (requested === undefined) {
    return heldRank === null ? true : heldRank > 0;
  }

  const wantedRank = rankValue(requested, definition);
  if (heldRank === null || wantedRank === null) {
    // Not comparable: fall back to equality rather than guessing an order.
    return JSON.stringify(held) === JSON.stringify(requested);
  }

  return heldRank >= wantedRank;
}
