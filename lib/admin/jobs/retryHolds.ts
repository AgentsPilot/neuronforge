/**
 * Switches that hold an admin retry on one queue (ADMIN_BOS_CLEANUP slice 7c;
 * SA fallback (b) for BL-7a, W7C-1, W7C-3).
 *
 * WHY THIS EXISTS. On the lead-replies queue a retry can re-arm a dead-lettered
 * row whose runner is still alive: `PATCH /api/business-os/leads/[id]` ("send
 * now") drains fire-and-forget with no `maxDuration`, so its runner is not
 * provably dead when the 90 s lease expires. A retry would then let the cron
 * send the row while that frozen runner sends it again. P2 (BL-7a part 2:
 * `maxDuration = 60` and an awaited drain on that route) closes the gap. Until
 * P2 is live, slice 7c does not merge (CI enforces this:
 * `lib/admin/jobs/__tests__/leadRetry.p2Gate.test.ts` is red while this is
 * `false` and the lead route is not yet the P2 shape). If the business
 * declines P2's trade-off (Q-SA7C-1), the hold is set to `true` and lead-reply
 * retry is refused with `retry_held` everywhere it is decided:
 *   - the shared eligibility function (so the list marks every lead reply
 *     "no: paused on this queue for now", including `processing` and `sent`
 *     rows that otherwise read `not_retryable_state`),
 *   - the action route (before any read),
 *   - the write repository (the last line).
 * Cancel is never held. The other three queues are not affected.
 *
 * HOW TO FLIP IT (measured by SA, CR7C-4). It is NOT a one-line change:
 *   1. change the one source line below to `true as boolean` (keep the shape;
 *      E-13 and the P2 gate both pin it);
 *   2. update the 10 expectations in 3 suites that assume lead retry is
 *      offered:
 *        - `buildQueueItemsView.test.ts`: W7A-7(a);
 *        - `queueItemEligibility.test.ts`: E-1 lead ×3, E-5, E-11 lead,
 *          CR7A-1 ×2, W7A-7(a) lead;
 *        - `queueItemEligibility.retry.test.ts`: the "ships with the hold
 *          OFF" pin;
 *   3. get SA's re-check of that delta.
 * The P2 gate then turns green on its own (it does not apply while held).
 *
 * A plain module constant, not an env flag: holding a send path is a code
 * decision reviewed by SA, not an operator toggle.
 *
 * @module lib/admin/jobs/retryHolds
 */

/** `true` = an admin may NOT retry a lead reply (422 `retry_held`). Ships `false`. */
export const LEAD_RETRY_HELD = false as boolean;
