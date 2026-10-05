/**
 * Admin give / take back credits (credit deduction slice 11b).
 *
 * Two admin operations on ONE account's credit lots, composed into the
 * entitlement admin op union by the entitlements module's `adminOps.ts` and
 * dispatched from its `executeAdminOp` (SA S11-SQ-5):
 *
 *   grant_credits      record a new `admin_grant` lot (whole credits, an expiry
 *                      instant or an explicit null, a reason, a request id)
 *   reduce_credit_lot  take credits back out of one lot of the account
 *                      (a whole number or `'rest'`)
 *
 * Workplan: docs/workplans/BUSINESS_OS_CREDIT_DEDUCTION_SLICE_11_WORKPLAN.md,
 * section "11b — Admin give / take back credits (API)" and SA's 11b review
 * (W11b-1 to W11b-11).
 *
 * ── THE ORDER OF CHECKS (SA S11-C-6) ────────────────────────────────────────
 * `adminOps.ts` runs the shared ones first: body (Zod) → own account 403 (all
 * nine ops) → platform account 409 (credit ops only, through
 * `refuseCreditOpForPlatformAccount` below) → tenant 404 → plan row 409. Then
 * `executeCreditAdminOp` runs:
 *   grant:   payment hold (fail closed) → expiry in the past → read the lots →
 *            `recordLot`
 *   reduce:  read the lots → the lot within the account (404) → paid credits
 *            (409 unless confirmed) → `reverseLot`
 * A reduction skips the hold and the expiry (OP-12): taking credits back never
 * benefits the account, and the reversal function refuses an expired lot itself.
 *
 * ── WHAT THIS FILE MAY IMPORT (SA W11b-4) ───────────────────────────────────
 * `zod`, `paymentHold.ts`, `isPlatformAccount` from `callCatalog.ts`,
 * `creditLots.ts`, and the lot repository's TYPES. Nothing from the
 * entitlements module, type-only imports included: the dependency points one
 * way, entitlements → credits (S11-SQ-15). That is why `creditValueVersion` is
 * a plain `number` here, passed in by `adminOps.ts` (OP-9). A source guard in
 * `__tests__/creditAdminOps.test.ts` pins it.
 *
 * ── NO WRITE BUT THE TWO LOT FUNCTIONS (G11b-2) ─────────────────────────────
 * Every write goes through the injected repository's `recordLot` /
 * `reverseLot`, which call the 11a functions. No plan row, override or charge
 * ledger write, and no database client in this file.
 *
 * ── REPLAYS (S11-CR-2, CR11a-4, SA W11b-5) ──────────────────────────────────
 * The same request id twice records one lot or draw. A replay answers
 * `replayed: true` with the STORED figures (a grant re-reads the lot it found;
 * a reduction reports the credits the function returned), never the requested
 * ones, and writes no audit entry. A replay re-runs every pre-check, so it can
 * be refused when a fact changed since the first attempt (the expiry has since
 * passed, the account has since become held); the first write stands and is
 * visible in the admin credit view. The window "write committed, then the
 * instance died before the audit flush" is covered by the lot or draw row
 * itself: append-only and undeletable, carrying the admin, the reason, the
 * idempotency key and its time.
 *
 * Takes no logger and logs nothing: it returns codes, and the repository logs
 * its own failures with ids and SQLSTATE only (CR11a-1).
 *
 * @module lib/business-os/credits/creditAdminOps
 */

import { z } from 'zod';
import { readPaymentHold, type PaymentHold, type PaymentHoldReaders } from '@/lib/business-os/invites/paymentHold';
import { isPlatformAccount } from '@/lib/business-os/llm/callCatalog';
import { creditLotRemaining, extraCreditsAt } from '@/lib/business-os/credits/creditLots';
import type {
  BusinessOsCreditLotRepository,
  BusinessOsCreditLotRow,
} from '@/lib/repositories/BusinessOsCreditLotRepository';

/** S11-D-5 B, S11-SQ-13: the most whole credits one op may give or take back. */
export const ADMIN_CREDIT_GRANT_CEILING = 100_000;

/** The op names this file owns. `adminOps.ts` uses it to route the platform check and the dispatch. */
export const CREDIT_ADMIN_OP_NAMES = ['grant_credits', 'reduce_credit_lot'] as const;
export type CreditAdminOpName = (typeof CREDIT_ADMIN_OP_NAMES)[number];

/** The basis of the account-level figures in the audit and in `exceeds_remaining` (OP-11, OP-22). */
export const READ_BEFORE_WRITE = 'read_before_write' as const;

/**
 * The reason bounds, trimmed (slice 11c, SA W11c-6). Exported so the admin
 * credit view sends the numbers to the form instead of a copy of them; they
 * must still match the table CHECKs (a test pins 3 and 500).
 */
export const CREDIT_REASON_MIN = 3;
export const CREDIT_REASON_MAX = 500;

// The bounds match the table CHECKs (reason 3–500 trimmed, whole positive
// credits), so a CHECK is never how an admin learns of a mistake (M-3).
const creditReason = z
  .string()
  .trim()
  .min(CREDIT_REASON_MIN, 'a reason of at least 3 characters is required')
  .max(CREDIT_REASON_MAX);
const creditAmount = z.number().int().positive().max(ADMIN_CREDIT_GRANT_CEILING);
// OP-17 / S11-SQ-14: an instant with an explicit offset (`Z` counts), so a bare
// date can never be read in an unintended zone.
const offsetInstant = z.string().datetime({ offset: true });
// W11b-2: Postgres compares uuids case-insensitively; JS string equality does
// not. Lower-cased here so the lookup in the account's list and the reversal
// both see the canonical form.
const lowerUuid = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());

/**
 * Give extra credits. `.strict()`: no account id, user id, source or bonus can
 * be smuggled in; the account comes only from the URL path (tenant-isolation-guard).
 */
export const grantCreditsSchema = z
  .object({
    op: z.literal('grant_credits'),
    amount: creditAmount,
    // A REQUIRED key (S11-D-2 C): an instant, or an explicit null meaning the
    // lot never expires. Silence is never read as "forever".
    expiresAt: offsetInstant.nullable(),
    // Minted by the form once per opening (S11-SQ-1 e).
    requestId: z.string().uuid(),
    reason: creditReason,
  })
  .strict();

/** Take credits back out of one lot. `'rest'` ends the lot; there is no third op. */
export const reduceCreditLotSchema = z
  .object({
    op: z.literal('reduce_credit_lot'),
    lotId: lowerUuid,
    amount: z.union([creditAmount, z.literal('rest')]),
    requestId: z.string().uuid(),
    // S11-D-7 A: a paid (boost) lot is taken back only with this explicit flag.
    confirmPaidCredits: z.literal(true).optional(),
    reason: creditReason,
  })
  .strict();

export type GrantCreditsOp = z.infer<typeof grantCreditsSchema>;
export type ReduceCreditLotOp = z.infer<typeof reduceCreditLotSchema>;
export type CreditAdminOp = GrantCreditsOp | ReduceCreditLotOp;

/** The repository methods the ops use. Injected, so every branch is testable without a database. */
export type CreditLotRepositoryPort = Pick<
  BusinessOsCreditLotRepository,
  'recordLot' | 'reverseLot' | 'listLotsWithDraws' | 'findLotForAccount'
>;

/** What the route wires in (the service-role lot repository and the hold readers). */
export interface CreditAdminDependencies {
  lotRepository: CreditLotRepositoryPort;
  holdReaders: PaymentHoldReaders;
}

export interface CreditAdminOpContext extends CreditAdminDependencies {
  /** From the URL path, after the tenant check. Never from the body. */
  accountId: string;
  adminId: string;
  now: Date;
  /** `currentCreditValue().version`, read by `adminOps.ts` (OP-9). A plain number on purpose: W11b-4. */
  creditValueVersion: number;
}

/** Replaces the plan-row defaults in the route's audit entry (S11-SQ-5, S11-SQ-11). */
export interface CreditLotAudit {
  entityType: 'business_os_credit_lot';
  entityId: string;
  changes: Record<string, unknown>;
  details: Record<string, unknown>;
}

export type CreditAdminOpOutcome =
  | {
      ok: true;
      action: 'BOS_CREDIT_LOT_GRANTED' | 'BOS_CREDIT_LOT_REDUCED';
      data: Record<string, unknown>;
      /** Absent on a replay: a replay writes no audit entry (S11-CR-2). */
      audit?: CreditLotAudit;
      replayed?: true;
      /** Lots are not an `EntitlementService` input, so the cache is left alone. */
      invalidatesEntitlements: false;
    }
  | { ok: false; status: 400 | 404 | 409 | 500; error: string; details?: Record<string, unknown> };

/** A refusal, on its own: what the shared platform check can return. */
export type CreditAdminOpRefusal = Extract<CreditAdminOpOutcome, { ok: false }>;

/** True for the two credit ops. */
export function isCreditAdminOp(op: { op: string }): op is CreditAdminOp {
  return (CREDIT_ADMIN_OP_NAMES as readonly string[]).includes(op.op);
}

/**
 * S11-CR-1: a credit op on the platform account is refused before the tenant
 * check, with the same code as every admin credit route. `isPlatformAccount`
 * is case-insensitive and reads `SYSTEM_ADMIN_USER_ID` at call time.
 */
export function refuseCreditOpForPlatformAccount(accountId: string): CreditAdminOpRefusal | null {
  return isPlatformAccount(accountId) ? { ok: false, status: 409, error: 'platform_account' } : null;
}

const MICRO = 1e6;

/** Integer micro-credits, so the before / after arithmetic does not drift (the 6 dp of the ledger). */
function addCredits(a: number, b: number): number {
  return (Math.round(a * MICRO) + Math.round(b * MICRO)) / MICRO;
}

/** The account's lots and its extra credits now, or a refusal: no write ever lacks its audit figures (OP-14). */
async function readLots(
  ctx: CreditAdminOpContext
): Promise<{ ok: true; lots: BusinessOsCreditLotRow[]; extraCredits: number } | { ok: false; outcome: CreditAdminOpOutcome }> {
  const unreadable = { ok: false as const, outcome: { ok: false as const, status: 500 as const, error: 'credit_lots_unreadable' } };
  const listed = await ctx.lotRepository.listLotsWithDraws(ctx.accountId);
  if (listed.error || !listed.data) return unreadable;
  // QA11a-3: the repository's rows go straight in, so the type check proves
  // `BusinessOsCreditLotRow` fits `CreditLotForBalance`.
  const position = extraCreditsAt(listed.data, ctx.now);
  if (!position) return unreadable;
  return { ok: true, lots: listed.data, extraCredits: position.extraCredits };
}

/**
 * Execute one credit op, after `adminOps.ts` has run the shared checks.
 * Never throws for an expected refusal.
 */
export async function executeCreditAdminOp(op: CreditAdminOp, ctx: CreditAdminOpContext): Promise<CreditAdminOpOutcome> {
  return op.op === 'grant_credits' ? grantCredits(op, ctx) : reduceCreditLot(op, ctx);
}

async function grantCredits(op: GrantCreditsOp, ctx: CreditAdminOpContext): Promise<CreditAdminOpOutcome> {
  // ── 6. Payment hold: fail closed (boost R-1, OP-13, SA W11b-9) ────────────
  // Unlike the page gate, which fails open, a grant to an account whose hold
  // cannot be read is refused: the admin can retry, and credits given to a
  // held account would be free use before payment.
  let hold: PaymentHold;
  try {
    hold = await readPaymentHold(ctx.accountId, ctx.holdReaders);
  } catch {
    return { ok: false, status: 500, error: 'payment_hold_check_failed' };
  }
  if (!hold.ok) return { ok: false, status: 500, error: 'payment_hold_check_failed' };
  if (hold.held) return { ok: false, status: 409, error: 'awaiting_payment' };

  // ── 7. An expiry at or before now would record a lot that is already spent ─
  // The same `<=` as `isCreditLotExpired` and the reversal function.
  const expiresAt = op.expiresAt === null ? null : new Date(op.expiresAt).toISOString();
  if (expiresAt !== null && Date.parse(expiresAt) <= ctx.now.getTime()) {
    return { ok: false, status: 400, error: 'expires_at_in_past' };
  }

  // ── 8. The audit's "before" ───────────────────────────────────────────────
  const read = await readLots(ctx);
  if (!read.ok) return read.outcome;

  // ── 11. The write. Every field named, nothing spread from the body ────────
  const idempotencyKey = `admin_grant:${op.requestId.toLowerCase()}`;
  const recorded = await ctx.lotRepository.recordLot({
    accountId: ctx.accountId,
    source: 'admin_grant',
    creditsBase: op.amount,
    creditsBonus: 0,
    creditValueVersion: ctx.creditValueVersion,
    expiresAt,
    idempotencyKey,
    sourceRef: null,
    actorKind: 'admin',
    actorAdminId: ctx.adminId,
    reason: op.reason,
  });

  if (recorded.error || !recorded.data) return { ok: false, status: 500, error: 'lot_write_failed' };
  const result = recorded.data;
  if (result.outcome === 'idempotency_key_conflict') {
    return { ok: false, status: 409, error: 'idempotency_key_conflict' };
  }

  if (result.outcome === 'replayed') {
    // CR11a-4: report the lot that exists, not the one asked for. A replay
    // with a different expiry or reason returns the original lot unchanged.
    const stored = await ctx.lotRepository.findLotForAccount(result.lotId, ctx.accountId);
    if (stored.error || !stored.data) return { ok: false, status: 500, error: 'lot_read_failed' };
    return {
      ok: true,
      action: 'BOS_CREDIT_LOT_GRANTED',
      data: { lotId: stored.data.id, credits: stored.data.creditsGranted, expiresAt: stored.data.expiresAt, replayed: true },
      replayed: true,
      invalidatesEntitlements: false,
    };
  }

  // Whole credits are stored as themselves, and the expiry is the normalised
  // instant, so the input figures ARE the stored ones. The lot cannot be
  // expired at `now` (step 7), so it adds in full.
  const extraCreditsAfter = addCredits(read.extraCredits, op.amount);
  return {
    ok: true,
    action: 'BOS_CREDIT_LOT_GRANTED',
    data: { lotId: result.lotId, credits: op.amount, expiresAt, replayed: false },
    audit: {
      entityType: 'business_os_credit_lot',
      entityId: result.lotId,
      changes: { extraCreditsBefore: read.extraCredits, extraCreditsAfter },
      details: {
        lotId: result.lotId,
        source: 'admin_grant',
        credits: op.amount,
        expiresAt,
        idempotencyKey,
        extraCreditsBasis: READ_BEFORE_WRITE,
      },
    },
    invalidatesEntitlements: false,
  };
}

/**
 * The account's extra credits after a recorded reduction (CR11b-2, slice 11c,
 * SA OP-35, W11c-9): `extraCreditsAt` over the SAME list, with the returned
 * draw appended to its lot. No second read. Exact even for a lot that
 * `extraCreditsAt` clamps to 0, where "before − credits" would be wrong.
 *
 * One `now` for both: the synthetic draw is stamped `now`, and the figure is
 * read at that same `now`, so the draw is never dropped as "after `at`".
 * Falls back to today's subtraction only if the figure cannot be read, which
 * cannot happen for a list `readLots` just read at the same `now` (defensive).
 */
function extraCreditsAfterReduction(
  lots: readonly BusinessOsCreditLotRow[],
  lotId: string,
  credits: number,
  now: Date,
  extraCreditsBefore: number
): number {
  const drawnAt = now.toISOString();
  const withDraw = lots.map((row) =>
    row.id.toLowerCase() === lotId
      ? { ...row, draws: [...row.draws, { kind: 'reversal' as const, credits, createdAt: drawnAt }] }
      : row
  );
  const after = extraCreditsAt(withDraw, now);
  return after ? after.extraCredits : addCredits(extraCreditsBefore, -credits);
}

async function reduceCreditLot(op: ReduceCreditLotOp, ctx: CreditAdminOpContext): Promise<CreditAdminOpOutcome> {
  // ── 8. The audit's "before", and the account-scoped list the lot must be in ─
  const read = await readLots(ctx);
  if (!read.ok) return read.outcome;

  // ── 9r. The lot within the account (tenant-isolation-guard) ───────────────
  // The list was read with `.eq('user_id', accountId)`: a lot of another
  // account is simply absent, and the reversal function is never called for it.
  const lotId = op.lotId.toLowerCase();
  const lot = read.lots.find((row) => row.id.toLowerCase() === lotId);
  if (!lot) return { ok: false, status: 404, error: 'lot_not_found' };

  // ── 10r. Paid credits (S11-D-7 A) ─────────────────────────────────────────
  if (lot.source === 'boost_purchase' && op.confirmPaidCredits !== true) {
    return { ok: false, status: 409, error: 'paid_credits_locked' };
  }

  // ── 11. The write ─────────────────────────────────────────────────────────
  const idempotencyKey = `admin_reversal:${op.requestId.toLowerCase()}`;
  const reversed = await ctx.lotRepository.reverseLot({
    accountId: ctx.accountId,
    lotId,
    credits: op.amount,
    idempotencyKey,
    actorAdminId: ctx.adminId,
    reason: op.reason,
  });

  if (reversed.error || !reversed.data) return { ok: false, status: 500, error: 'lot_write_failed' };
  const result = reversed.data;

  switch (result.status) {
    case 'recorded': {
      // The lot figures are the function's, under its lock (S11-SQ-11); the
      // account figures are context, read before the write (OP-11).
      const credits = result.credits as number;
      const extraCreditsAfter = extraCreditsAfterReduction(read.lots, lotId, credits, ctx.now, read.extraCredits);
      return {
        ok: true,
        action: 'BOS_CREDIT_LOT_REDUCED',
        data: { lotId, drawId: result.drawId, credits, lotRemainingAfter: result.remainingAfter, replayed: false },
        audit: {
          entityType: 'business_os_credit_lot',
          entityId: lotId,
          changes: {
            extraCreditsBefore: read.extraCredits,
            extraCreditsAfter,
            lotRemainingBefore: result.remainingBefore,
            lotRemainingAfter: result.remainingAfter,
          },
          details: {
            lotId,
            source: lot.source,
            credits,
            drawId: result.drawId,
            idempotencyKey,
            extraCreditsBasis: READ_BEFORE_WRITE,
          },
        },
        invalidatesEntitlements: false,
      };
    }
    case 'already_recorded':
      // QA11a-2: the original draw's credits, never the requested amount; the
      // remaining is the lot's now (11a OP-3).
      return {
        ok: true,
        action: 'BOS_CREDIT_LOT_REDUCED',
        data: { lotId, drawId: result.drawId, credits: result.credits, lotRemainingAfter: result.remainingAfter, replayed: true },
        replayed: true,
        invalidatesEntitlements: false,
      };
    case 'lot_not_found':
      // Reachable only if the lot left the account between the read and the lock.
      return { ok: false, status: 404, error: 'lot_not_found' };
    case 'lot_expired':
      return { ok: false, status: 409, error: 'lot_expired' };
    case 'nothing_left':
      return { ok: false, status: 409, error: 'nothing_left' };
    case 'exceeds_remaining':
      // OP-22 / W11b-10: the account's own figure, so the admin screen can say
      // "only N left"; read before the attempt, and labelled so.
      return {
        ok: false,
        status: 409,
        error: 'exceeds_remaining',
        details: { remaining: creditLotRemaining(lot, ctx.now), remainingBasis: READ_BEFORE_WRITE },
      };
    case 'idempotency_key_conflict':
      return { ok: false, status: 409, error: 'idempotency_key_conflict' };
    default:
      return { ok: false, status: 500, error: 'lot_write_failed' };
  }
}
