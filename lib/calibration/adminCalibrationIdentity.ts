// lib/calibration/adminCalibrationIdentity.ts
// Pure decision logic for the admin calibration trigger's "impersonate the
// owner at the boundary" model. Kept as a standalone pure function so the risky
// identity split is unit-testable in isolation from the 4,600-line batch route.
//
// See docs/workplans/ADMIN_CALIBRATION_TRIGGER_WORKPLAN.md.

export interface CalibrationIdentityInput {
  /** Whether the CALLER is a platform admin (resolved via AdminAccessService). */
  isAdmin: boolean;
  /** The authenticated caller's id (the actor). */
  callerId: string;
  /** The authenticated caller's email (kept as the notify recipient — decision 3). */
  callerEmail: string | null;
  /** The agent owner's id (`agent.user_id`). */
  ownerId: string;
  /** Admin-only `force` flag from the request body. */
  force?: boolean;
}

export interface CalibrationIdentityDecision {
  /** Non-admin trying to calibrate someone else's agent → the route must 403. */
  forbidden: boolean;
  /** Admin calibrating an agent they don't own → run on behalf of the owner. */
  adminInitiated: boolean;
  /** Execution identity: the owner for admin runs, else the caller. */
  userId: string;
  /** Notify recipient: ALWAYS the caller (admin on admin runs) — decision 3. */
  userEmail: string | null;
  /** The admin actor id for audit + IMP-2 tagging (null on normal runs). */
  adminActorId: string | null;
  /** Whether to bypass the production-ready / already-calibrated guards. */
  forceCalibrate: boolean;
  /**
   * Whether the run's DB client should be the service-role client (admin runs
   * act as the owner, bypassing RLS by design). Non-admin runs stay on the RLS
   * client — byte-for-byte unchanged.
   */
  useServiceRole: boolean;
}

/**
 * Resolve the identity split for a calibration run. Pure — no I/O.
 *
 * - Same-user run (caller owns the agent): normal path, nothing special.
 * - Non-admin cross-user: forbidden (route returns 403).
 * - Admin cross-user: `adminInitiated` — execution identity becomes the owner
 *   (so plugin connections + history/gate rows are the owner's) on a service-role
 *   client, while the caller's email stays the notify recipient and the caller id
 *   is recorded as the actor.
 */
export function resolveCalibrationIdentity(input: CalibrationIdentityInput): CalibrationIdentityDecision {
  const crossUser = input.ownerId !== input.callerId;
  const adminInitiated = input.isAdmin && crossUser;
  const forbidden = crossUser && !adminInitiated;

  return {
    forbidden,
    adminInitiated,
    userId: adminInitiated ? input.ownerId : input.callerId,
    userEmail: input.callerEmail ?? null,
    adminActorId: adminInitiated ? input.callerId : null,
    forceCalibrate: adminInitiated && input.force === true,
    useServiceRole: adminInitiated,
  };
}
