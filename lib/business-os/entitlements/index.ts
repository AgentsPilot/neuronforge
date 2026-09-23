// lib/business-os/entitlements/index.ts
//
// The module's public surface.
//
// ── WHY A BARREL, WHEN THE REPO MOSTLY DOES NOT USE THEM ────────────────────
// Two reasons, both specific to this module:
//
//   1. `shadow.ts` must import the module LAZILY, inside a try, so that a bad
//      config cannot take chat down at cold start with entitlements switched
//      off (RC-7). `await import('./index')` is one statement; importing six
//      files individually inside a try is six chances to forget one.
//   2. Everything a call site needs is `check()` and its types. Exporting the
//      internals from here would invite a surface to reach past the service into
//      the resolver, cache the result itself, and reinvent the failure policy —
//      which is the thing §4.9 exists to prevent.
//
// So this exports the service, the decision vocabulary and the seams. The layer
// internals stay importable by path for tests and for the report, which really
// does need the resolver directly.

export { EntitlementService, getEntitlementService, resetEntitlementService } from './EntitlementService';
export { CACHE_TTL_SECONDS, CACHE_MAX_ENTRIES, STALE_TOLERANCE_SECONDS } from './EntitlementService';
export type { EntitlementServiceOptions, SnapshotResult } from './EntitlementService';

export { decide, isRefusal, overlayFor, failurePolicyFor } from './decide';
export type { EntitlementDecision, EntitlementOutcome, EntitlementRequest } from './decide';

export { ALWAYS_SUFFICIENT } from './balance';
export type { AiActionBalanceQuery, AiActionBalanceResult, AiActionBalanceSource } from './balance';

export { resolveAccountId, fromPlanRow, fromOverrideRow } from './account';
export type { AccountId, EntitlementAccount, EntitlementOverride } from './account';

export { getEntitlementMode, isEntitlementResolutionEnabled, MODE_ENV_VAR } from './mode';
export type { EntitlementMode } from './mode';

export { resolveEntitlements, lowestTierFor, satisfies, withheldValue } from './resolver';
export type { EntitlementResolution, ResolvedCapability, TraceEntry } from './resolver';

export { deriveLifecycle, historyAt } from './lifecycle';
export type { EntitlementAnomaly, EntitlementBasis, LifecycleResult } from './lifecycle';

export { getEntitlementConfig, validateEntitlementConfig, EntitlementConfigError } from './source';
export type { EntitlementConfig, TierMatrixSource } from './source';

export { CAPABILITIES, CAPABILITY_IDS } from './config/catalog';
export type { CapabilityId, TierRow } from './config/catalog';
export { TIER_ORDER } from './config/tierMatrix';
export { surfaceKindForSend } from './config/lifecycle';
