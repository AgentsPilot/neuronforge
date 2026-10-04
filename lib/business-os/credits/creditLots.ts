/**
 * What an account's credit lots are worth at a moment (credit deduction slice
 * 11a, SA ruling S11-SQ-4).
 *
 * THE ONE DEFINITION of "extra credits at `at`", so the admin view (11c), the
 * owner card (11d) and enforcement (slice 9) all read the same number:
 *
 *   extra credits at `at` = Σ max(0, granted − Σ draws) over the lots that
 *                           exist at `at` and are not expired at `at`
 *
 * - A lot counts from its own `createdAt`, so a lot added mid-period counts at
 *   once, not from the next period.
 * - A lot is expired when `expiresAt <= at`: the SAME `<=` as the reversal
 *   function in `20261017_business_os_credit_lots.sql` (`expires_at <= now()`).
 *   A test pins both comparisons.
 * - A lot or a draw created after `at` is ignored, so the answer is right for
 *   any `at`, not only "now" (SA OP-2). At `at = now` this is exactly S11-SQ-4.
 * - Draws today are reversals only (an admin taking credits back). Slice 9 adds
 *   consumption draws; it widens `CreditLotDrawForBalance['kind']` on purpose,
 *   and the subtraction below already treats every draw the same way.
 *
 * Arithmetic is in integer micro-credits (the ledger's 6 decimal places), so
 * fractional amounts do not drift. Any non-finite figure or unreadable date
 * gives `null` for the whole answer: no answer rather than a wrong one (the
 * `computeCreditBalance` rule). A negative remaining — impossible while the
 * reversal function is the only writer, and checked by L7 (a) — is clamped to
 * 0 and reported through `hasInconsistentLot`, so a caller can show it.
 *
 * Pure: no I/O, no repository, nothing from the entitlements module.
 * Called by the slice 11b admin credit ops (`creditAdminOps.ts`) for the
 * audit's before / after figures, the slice 11c admin per-account credit view
 * route, and the slice 11d owner card's payload builder (`ownerCreditUsage.ts`,
 * the "Extra credits" figure). The G3 guard in `__tests__/creditLots.test.ts`
 * holds the exact list.
 *
 * @module lib/business-os/credits/creditLots
 */

/** One movement out of a lot, as far as the balance needs it. */
export interface CreditLotDrawForBalance {
  kind: 'reversal';
  credits: number;
  createdAt: string;
}

/** One lot with its draws, as far as the balance needs it. */
export interface CreditLotForBalance {
  id: string;
  creditsGranted: number;
  /** Null means the lot never expires. */
  expiresAt: string | null;
  createdAt: string;
  draws: readonly CreditLotDrawForBalance[];
}

/** One lot's position at `at`. */
export interface CreditLotPosition {
  id: string;
  /** Never negative (see `hasInconsistentLot`). Counted in `extraCredits` only when not expired. */
  remaining: number;
  expired: boolean;
}

export interface ExtraCreditsAt {
  /** Σ remaining over the lots not expired at `at`, at 6 decimal places. */
  extraCredits: number;
  /** Every lot that exists at `at`, expired or fully used ones included, in input order. */
  lots: CreditLotPosition[];
  /** True when some lot had drawn more than it granted (clamped to 0 above). */
  hasInconsistentLot: boolean;
}

// Exact to 6 dp up to about 9 x 10^9 credits (2^53 micro-credits), unreachable
// behind the 100,000-credit admin ceiling (CR11a-5).
const MICRO = 1e6;

function toMicro(value: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.round(value * MICRO);
}

function toMs(value: string): number | null {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * True when the lot is expired at `at`: `expiresAt <= at`. A lot with no
 * expiry never expires. An unreadable expiry counts as expired, so a bad date
 * can never add credits.
 */
export function isCreditLotExpired(lot: Pick<CreditLotForBalance, 'expiresAt'>, at: Date): boolean {
  if (lot.expiresAt === null) return false;
  const expiresMs = toMs(lot.expiresAt);
  const atMs = at.getTime();
  if (expiresMs === null || Number.isNaN(atMs)) return true;
  return expiresMs <= atMs;
}

/** Remaining in micro-credits, unclamped, from the draws made at or before `atMs`; null when unreadable. */
function remainingMicro(lot: CreditLotForBalance, atMs: number): number | null {
  const granted = toMicro(lot.creditsGranted);
  if (granted === null || !Array.isArray(lot.draws)) return null;
  let drawn = 0;
  for (const draw of lot.draws) {
    const credits = toMicro(draw.credits);
    const drawnAt = toMs(draw.createdAt);
    if (credits === null || drawnAt === null) return null;
    if (drawnAt > atMs) continue;
    drawn += credits;
  }
  return granted - drawn;
}

/**
 * What is left of one lot at `at`: granted minus the draws made at or before
 * `at`, at 6 decimal places. Unclamped (a negative value means the lot is
 * inconsistent) and blind to expiry and to whether the lot existed at `at` —
 * `extraCreditsAt` applies both. Null when a figure or date is unreadable.
 */
export function creditLotRemaining(lot: CreditLotForBalance, at: Date): number | null {
  const atMs = at.getTime();
  if (Number.isNaN(atMs)) return null;
  const micro = remainingMicro(lot, atMs);
  return micro === null ? null : micro / MICRO;
}

/** The account's extra credits at `at` (S11-SQ-4). Null when any figure or date is unreadable. */
export function extraCreditsAt(lots: readonly CreditLotForBalance[], at: Date): ExtraCreditsAt | null {
  const atMs = at.getTime();
  if (Number.isNaN(atMs) || !Array.isArray(lots)) return null;

  let totalMicro = 0;
  let hasInconsistentLot = false;
  const positions: CreditLotPosition[] = [];

  for (const lot of lots) {
    const createdMs = toMs(lot.createdAt);
    if (createdMs === null) return null;
    if (lot.expiresAt !== null && toMs(lot.expiresAt) === null) return null;
    const micro = remainingMicro(lot, atMs);
    if (micro === null) return null;
    // A lot created after `at` did not exist yet.
    if (createdMs > atMs) continue;

    if (micro < 0) hasInconsistentLot = true;
    const clamped = Math.max(0, micro);
    const expired = isCreditLotExpired(lot, at);
    if (!expired) totalMicro += clamped;
    positions.push({ id: lot.id, remaining: clamped / MICRO, expired });
  }

  return { extraCredits: totalMicro / MICRO, lots: positions, hasInconsistentLot };
}
