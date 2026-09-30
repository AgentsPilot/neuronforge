/**
 * The signup code and claim policy (invite-only signup, Slice 1b; requirement
 * T-5, workplan §2.2, §10, SA D-4).
 *
 * One place for every number the signup flow counts against, so the complete
 * route, the code route, the revoke path and the admin list read the SAME
 * values:
 *
 * - The code: 6 digits, valid 10 minutes, at most 5 attempts (T-5).
 * - The per-invite send limit (SA's rate-limit decision, option A): no sooner
 *   than 60 s after the last code, at most 5 codes in a rolling 24 h window.
 *   Together that bounds code guessing at about 25 tries a day against 10^6,
 *   with no shared store (§10).
 * - The claim lease (D-4): 120 s. It must exceed the complete route's
 *   `maxDuration`, so a live request can never see its own claim lapse. A test
 *   pins that. It is read by the claim compare-and-swap, the revoke
 *   compare-and-swap (I-2) and the "stopped halfway" derivation (D-3).
 *
 * Pure data: no I/O.
 */

export const INVITE_SIGNUP_CODE_POLICY = {
  digits: 6,
  ttlMinutes: 10,
  maxAttempts: 5,
  minResendSeconds: 60,
  maxSendsPerWindow: 5,
  windowHours: 24,
} as const;

/** The claim lease, in seconds (SA D-4). Longer than `COMPLETE_ROUTE_MAX_DURATION_SECONDS`. */
export const INVITE_CLAIM_LEASE_SECONDS = 120;

/**
 * The `maxDuration` of every route that claims an invite: `complete` and, from
 * Slice 3b, `google`. Each route file exports the literal `60` (Next.js reads
 * route segment config statically, so it cannot import this); a test asserts
 * they agree.
 */
export const COMPLETE_ROUTE_MAX_DURATION_SECONDS = 60;

/** The earliest `claimed_at` that still counts as a LIVE claim at `now`. */
export function claimLeaseCutoff(now: Date): Date {
  return new Date(now.getTime() - INVITE_CLAIM_LEASE_SECONDS * 1000);
}

/** Is a claim made at `claimedAt` still live at `now`? An unreadable time is not live. */
export function isClaimLive(claimedAt: string | null, now: Date): boolean {
  if (!claimedAt) return false;
  const at = Date.parse(claimedAt);
  return Number.isFinite(at) && at > claimLeaseCutoff(now).getTime();
}

/**
 * The steps a stopped redemption can record (SA D-2). A TypeScript vocabulary,
 * never a value list in SQL.
 */
export const REDEMPTION_FAILURE_STEPS = ['find_user', 'create_user', 'create_user_id_mismatch', 'finalise'] as const;
export type RedemptionFailureStep = (typeof REDEMPTION_FAILURE_STEPS)[number];
