// lib/business-os/entitlements/config/tierMatrix.ts
//
// THE TIER MATRIX — which plan includes what.
//
// ⚠️ THIS SHIPS EMPTY, ON PURPOSE (user decision U-1, requirement B-13).
//
// This delivery builds the entitlement INFRASTRUCTURE. No commercial tier is
// implemented, because the pricing is still being decided: encoding today's
// draft would mean shipping a number that is wrong by the time it is read.
// Existing accounts are champions and new signups are trials — neither has a
// tier — so an empty matrix is not a gap, it is the current commercial reality.
//
// Eyal's draft matrix lives in `__tests__/fixtures/exampleTierMatrix.ts`, where
// it proves the mechanism without pretending to be a price list.
//
// ── ADDING A TIER (the whole procedure) ─────────────────────────────────────
//
//   1. Add its name to TIER_ORDER, cheapest first.
//   2. Add its row to `tiers` — one value per capability.
//   3. `npm run entitlements:snapshot` to refresh the drift snapshot.
//
// Step 2 is not optional and cannot be forgotten: `TierRow` is a mapped type
// over the catalog, so a missing capability is a compile error, and the loader's
// Zod schema rejects it again at runtime. Between them, "a tier with a hole in
// it" is unrepresentable.
//
// ── CHANGING WHAT A TIER INCLUDES ───────────────────────────────────────────
//
// ADDING a capability to a tier is ONE LINE. Every account on that tier has it
// from the release that ships the change (B-10).
//
// REMOVING one is TWO lines — the value, and an entry in `removals` — and that
// asymmetry is deliberate: taking something away from people who are already
// paying for it is a commercial decision, so it cannot be made silently. The
// snapshot test refuses a lowered value that has no matching removal.

import type { MatrixRemoval, TierMatrixShape } from '../types';
import type { TierRow } from './catalog';

/**
 * The configured tiers, cheapest first.
 *
 * The order is not cosmetic: it is how "the lowest tier that includes this"
 * is computed for an upgrade prompt (FR-16), and how the snapshot test knows
 * which direction is a downgrade.
 *
 * Empty today. `TierId` is therefore `never`, and every piece of code that
 * handles tiers has to cope with there being none — which is exactly the
 * condition it will face in production until the first plan is defined.
 */
export const TIER_ORDER = [] as const satisfies readonly string[];

/** A configured tier's name. `never` while TIER_ORDER is empty. */
export type TierId = (typeof TIER_ORDER)[number];

/** The production matrix, typed to the configured tiers. */
export type TierMatrix = TierMatrixShape<TierId, TierRow>;

/**
 * Version 1: the mechanism, with nothing in it.
 *
 * The version is bumped when a capability is REMOVED from a tier, and an account
 * records the version it subscribed at, so grandfathering can tell "this
 * subscriber predates the removal" from "this one signed up after it" (T-11).
 */
export const TIER_MATRIX = {
  version: 1,
  tiers: {},
  removals: [] as readonly MatrixRemoval<TierId>[],
} as const satisfies TierMatrix;
