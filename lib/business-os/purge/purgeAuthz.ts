// lib/business-os/purge/purgeAuthz.ts
//
// T30 / C-15 — server-side authorisation for the Business OS purge routes.
//
// WHY THIS EXISTS
// ---------------
// The internal `/test-business-os` surface was described in the requirement as
// "internal, unflagged", on the assumption that "internal" meant
// access-restricted. It does not. `middleware.ts:117-118` places
// `/test-business-os` on the skip-onboarding-check list, and the page itself is
// a `'use client'` component gating on `useAuth()` alone — its own header says
// it "acts as whoever you are currently logged in as". Shipping an unflagged
// Reset/Purge button there would have put a destructive operation in production
// reachable by any signed-in customer, while the *customer* surface sat behind a
// flag that is off by default — making D9's staged rollout a fiction.
//
// A `NEXT_PUBLIC_*` flag is a rendering hint. It is never an authorisation
// boundary: it is compiled into the client bundle, and the routes are callable
// directly regardless of what the UI chooses to draw. So the control lives
// here, on the server, and the UI asks it rather than guessing.
//
// MEMBERSHIP: platform admins only, resolved from the `admin_users` table via
// AdminAccessService. Never `profiles.role` — that column is user-writable
// (self-promotion) and overloaded with onboarding personas. See
// docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md.

import { createLogger } from '@/lib/logger';
import { adminAccessService } from '@/lib/services/AdminAccessService';
import { parseBooleanFlag } from '@/lib/utils/parseBooleanFlag';
import type { PurgeLevel } from './types';

const logger = createLogger({ module: 'PurgeAuthz' });

/** Which surface asked. Decides *what* is permitted, never *whether* the gate runs. */
export type PurgeSurface = 'internal' | 'customer';

export interface PurgeActor {
  id: string;
  /**
   * Required whenever available (it always is, from `getUser()`).
   *
   * Deliberately NOT optional in practice: `AdminAccessService.isAdmin()` needs
   * the email for two of its three resolution paths — the DB row seeded by
   * email (which it then self-heals by binding the user_id) and the
   * `ADMIN_EMAILS` env fallback. The `isAdminById()` convenience method checks
   * only already-bound user_ids, so using it here would deny a legitimately
   * seeded admin whose row has not been bound yet. That is a silent false
   * negative, and on a fail-closed path a silent false negative looks exactly
   * like correct behaviour.
   */
  email: string | null;
}

export type PurgeAuthzDecision =
  | { allowed: true }
  | { allowed: false; status: 401 | 403; reason: string };

/** The documented name of the flag. Kept as a constant for docs and tests to reference. */
export const BUSINESS_DELETE_FLAG = 'NEXT_PUBLIC_ENABLE_BUSINESS_DELETE';

/**
 * Whether the customer-surface Purge is PERMITTED. This is the authorization
 * reader, and it is server-side.
 *
 * Its client-side counterpart is `isBusinessDeleteSurfaceVisible()` in
 * `lib/utils/featureFlags.ts`. Same env var, different question: that one
 * decides what the UI *draws*, this one decides what the server *allows*. They
 * are deliberately duplicated rather than shared — this module imports
 * `AdminAccessService`, so a client module importing it would pull an admin
 * lookup into the browser bundle, and calling the client one from here would
 * hand a destructive-capability decision to a value compiled into that bundle
 * (the hole T30 closed). Do not consolidate them.
 */
export function isBusinessDeleteSurfaceEnabled(): boolean {
  // Read the LITERAL `process.env.NEXT_PUBLIC_...`, never `process.env[CONST]`.
  //
  // Next.js substitutes `NEXT_PUBLIC_*` at build time by STATIC ANALYSIS of
  // literal member accesses. A computed access — `process.env[SOME_CONST]` —
  // is invisible to that substitution: it happens to work in the Node runtime
  // where the real `process.env` exists, and returns `undefined` on Edge where
  // it does not. The failure direction is "gated", so it is safe rather than
  // dangerous — but it presents as "we set the flag, redeployed, and nothing
  // happened", with no signal saying why. That is a bad afternoon for whoever
  // un-gates D9.
  //
  // Parsing is delegated to the shared zero-import parser so `=1` and `=TRUE`
  // behave the same here as they do for every other flag in the project. A
  // strict `=== 'true'` would silently leave the surface gated (C-33).
  return parseBooleanFlag(process.env.NEXT_PUBLIC_ENABLE_BUSINESS_DELETE);
}

/**
 * Decide whether `actor` may run `level` from `surface`.
 *
 * Rules, in order:
 *   1. No authenticated actor                    → 401.
 *   2. Reset, from any surface                   → platform admins only.
 *   3. The internal surface, any level           → platform admins only.
 *   4. Customer-surface Purge, D9 flag OFF       → platform admins only (C-22).
 *   5. Customer-surface Purge, D9 flag ON        → any authenticated user, on
 *                                                  their own business (FR-2
 *                                                  guarantees the target is the
 *                                                  session user; there is no
 *                                                  caller-supplied id to check).
 *
 * Rule 2 is deliberately broader than rule 3: Reset keeps `business_profiles`,
 * Stripe Connect and the OAuth connections while deleting every transaction,
 * invoice and booking — a state that is coherent for a test business and
 * actively dangerous for a real one, because the business keeps trading while
 * its local financial mirror is gone. It is an operator tool on either surface.
 *
 * Rule 4 is what makes D9 real rather than cosmetic. Note it restricts rather
 * than forbids: admins must still be able to exercise the customer path before
 * the flag is flipped, or T28 could never demonstrate the un-gating criteria
 * that justify flipping it.
 *
 * Fails closed everywhere: any unexpected condition denies.
 */
export async function authorizePurge(
  actor: PurgeActor | null,
  level: PurgeLevel,
  surface: PurgeSurface
): Promise<PurgeAuthzDecision> {
  if (!actor?.id) {
    return { allowed: false, status: 401, reason: 'Unauthorized' };
  }

  const surfaceGated = surface === 'customer' && !isBusinessDeleteSurfaceEnabled();
  const needsAdmin = level === 'reset' || surface === 'internal' || surfaceGated;
  if (!needsAdmin) {
    return { allowed: true };
  }

  // AdminCheckUser.email is `string | null | undefined`, so the null passes
  // through unchanged — no need to normalise it away.
  const isAdmin = await adminAccessService.isAdmin({ id: actor.id, email: actor.email });

  if (!isAdmin) {
    // Logged at warn: a non-admin reaching a destructive route is worth seeing,
    // whether it is a probe or a UI that rendered something it should not have.
    logger.warn(
      { userId: actor.id, level, surface, surfaceGated },
      'Purge authorization denied — not a platform admin'
    );

    let reason: string;
    if (surface === 'internal') {
      reason = 'The internal purge surface is restricted to platform administrators.';
    } else if (surfaceGated) {
      reason = 'Business deletion is not yet available on this account.';
    } else {
      reason = 'Reset is restricted to platform administrators.';
    }

    return { allowed: false, status: 403, reason };
  }

  return { allowed: true };
}

/**
 * Read-only variant for the UI: may this actor see the internal Danger Zone?
 *
 * The `/test-business-os` tab calls this through an endpoint rather than
 * deciding client-side. Hiding the tab is cosmetic — `authorizePurge` on the
 * routes is what actually stops the operation — but a tab that renders and then
 * 403s on use is a worse experience than one that does not render.
 */
export async function canUseInternalPurgeSurface(
  actor: PurgeActor | null
): Promise<boolean> {
  if (!actor?.id) return false;
  return adminAccessService.isAdmin({ id: actor.id, email: actor.email });
}
