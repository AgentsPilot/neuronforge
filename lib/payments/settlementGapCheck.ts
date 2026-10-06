/**
 * Does Stripe think it took money we never recorded?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * Between 2026-09-26 and 2026-10-05, fourteen payments were collected by Stripe
 * and recorded nowhere. Vercel held a `stripe listen` signing secret, the one
 * the CLI mints for a laptop, so production refused every real delivery with
 * `400 Invalid signature`. Nothing was wrong with the handler and nothing was
 * logged, because an endpoint that is never successfully reached cannot report
 * that it was not reached.
 *
 * Everything that looked like it worked had been recorded by a DEVELOPER's
 * machine: `stripe listen` forwards to localhost, and localhost writes to the
 * same database production reads. One-off payments are taken while someone is
 * at the keyboard, so they mostly landed. A payment plan's instalment is taken
 * by Stripe days later with no browser and no laptop, so plans failed every
 * time.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY AN OUTCOME CHECK, AND NOT AN ERROR ALARM
 *
 * The obvious alarm, "tell me about webhook signature failures", would have
 * stayed silent through the whole outage: for most of it no destination existed
 * at all, so production received nothing. Zero errors, maximum damage.
 *
 * This asks the only question that cannot be answered by an absence:
 *
 *     every invoice Stripe reports as paid must have a local row that is
 *     settled.
 *
 * That holds no matter WHY delivery failed — wrong secret, no destination, a
 * destination Stripe disabled after repeated failures, an unsubscribed event
 * type, a handler that throws, an outage that outlasts the retry window. All of
 * them produce one symptom, and this is it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * READ-ONLY, AND NOT A QUEUE DRAIN
 *
 * Nothing is claimed and nothing is written, so the `durable-queue-drain` skill
 * does not apply and two overlapping runs are harmless. A gap is reported, not
 * repaired. `settleInvoicePaid` is idempotent, so healing from here is
 * possible later, but a cron that writes money rows deserves a week of being
 * watched agreeing with reality first. Detection is what was missing.
 *
 * The durable trace is the run record plus one `error` log per gap. The caller
 * keeps counts only; no money and no customer data leaves this module.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/payments/settlementGapCheck
 */

import type { Logger } from 'pino';

type Result<T> = { data: T | null; error: Error | null };

/**
 * Run a dependency and turn a THROWN failure into the same refusal a returned
 * error is.
 *
 * The dependencies reach Stripe and the database. A repository singleton that
 * is absent, an SDK that throws on a revoked key, a network error inside a
 * client that does not wrap it: all of those arrive as an exception, not as
 * `{ error }`. Without this, one of them would escape `runSettlementGapCheck`,
 * whose entire contract is that it never throws, and the nightly monitor would
 * become an outage of its own. Every refusal, however it arrives, has to end up
 * on the same flags.
 */
async function attempt<T>(call: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await call();
  } catch (error) {
    return { data: null, error: error instanceof Error ? error : new Error(String(error)) };
  }
}

export const GAP_CHECK_LIMITS = {
  /** Connected accounts fetched per keyset page. */
  ACCOUNT_PAGE_SIZE: 100,
  /** Invoices fetched per Stripe page. */
  STRIPE_PAGE_SIZE: 100,
  /** At most this many Stripe pages per account, so one busy account cannot eat the run. */
  STRIPE_PAGE_CEILING: 10,
  /** Stop STARTING accounts after this long, mirroring the credit leak check. */
  RUN_DEADLINE_MS: 45_000,
  /**
   * How long a paid invoice is allowed to be unsettled before it counts.
   *
   * Webhooks are asynchronous and retried, so an invoice paid thirty seconds
   * ago being unrecorded is normal rather than a fault. Without this the check
   * would cry wolf on every run and be ignored inside a week, which is a worse
   * failure than the one it is here to catch.
   */
  RETRY_GRACE_MS: 60 * 60_000,
  /** How far back each run looks for payments. */
  WINDOW_MS: 48 * 60 * 60_000,
  /**
   * How far back to ask Stripe for invoices, which is NOT the same as the
   * window.
   *
   * Stripe can filter invoices by creation but not by the moment of payment. A
   * payment plan's instalment invoice is created when the booking is made and
   * paid a week or a month later, so filtering on creation at the window's edge
   * would systematically miss the exact case this check exists for. So: ask
   * wide, then narrow on `paid_at` here.
   */
  CREATED_LOOKBACK_MS: 90 * 24 * 60 * 60_000,
} as const;

export interface SettlementWindow {
  /** ISO, inclusive. */
  start: string;
  /** ISO, inclusive. Already short of `now` by the retry grace. */
  end: string;
}

/**
 * The window a run examines: payments completed between roughly 48 hours and
 * roughly 1 hour ago, with both edges on an hour boundary.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ALIGNED TO THE HOUR, ON PURPOSE.
 *
 * Millisecond edges would be spurious precision — the grace period is a guess
 * about Stripe's retry backoff, not a measurement — and they make a run's
 * reported window differ from the same run started a moment later, which is
 * indistinguishable from the window having MOVED for a reason. Rounding down
 * means two runs in the same hour audit exactly the same window and can be
 * compared.
 *
 * The cost is that the grace is "at least one hour, at most two", which is a
 * strictly safer direction: a longer grace cannot invent a finding, it can only
 * defer one to the next run.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function settlementWindow(now: Date): SettlementWindow {
  const HOUR_MS = 60 * 60_000;
  const end = new Date(Math.floor((now.getTime() - GAP_CHECK_LIMITS.RETRY_GRACE_MS) / HOUR_MS) * HOUR_MS);
  const start = new Date(end.getTime() - GAP_CHECK_LIMITS.WINDOW_MS);
  return { start: start.toISOString(), end: end.toISOString() };
}

/** A Stripe account to ask. `accountId: null` is the platform's own account. */
export interface SweepTarget {
  accountId: string | null;
  userId: string | null;
}

/** What this check needs to know about an invoice Stripe considers paid. */
export interface PaidInvoiceFact {
  stripeInvoiceId: string;
  amountPaidMinor: number;
  currency: string;
  /** From `status_transitions.paid_at`; null when Stripe did not record one. */
  paidAt: string | null;
}

/** What our own tables say about that invoice. */
export interface LocalSettlement {
  found: boolean;
  settled: boolean;
  invoiceId: string | null;
  status: string | null;
}

export type GapReason = 'no_local_invoice' | 'local_invoice_unsettled';

export interface SettlementGap {
  accountId: string | null;
  userId: string | null;
  stripeInvoiceId: string;
  amountPaidMinor: number;
  currency: string;
  paidAt: string | null;
  reason: GapReason;
  localInvoiceId: string | null;
  localStatus: string | null;
}

export interface SettlementGapCheckDeps {
  /** One keyset page of connected accounts. */
  pageConnectAccounts(
    afterUserId: string | null,
    limit: number
  ): Promise<Result<Array<{ user_id: string; stripe_account_id: string }>>>;
  /** One page of paid invoices for a target. */
  listPaidInvoices(
    target: SweepTarget,
    createdSince: Date,
    startingAfter: string | null,
    pageSize: number
  ): Promise<Result<{ invoices: PaidInvoiceFact[]; hasMore: boolean }>>;
  /** What our tables say about one Stripe invoice id. */
  findLocalSettlement(stripeInvoiceId: string): Promise<Result<LocalSettlement>>;
  now(): Date;
}

export interface SettlementGapCheckInput {
  /** Omit for the standard window ending one grace period ago. */
  window?: SettlementWindow;
  /** Wall-clock moment after which no further account is STARTED. */
  deadlineAt: number;
  trigger: 'nightly' | 'manual';
  /** Check one connected account only. Null sweeps the platform and all of them. */
  accountId?: string | null;
}

export interface SettlementGapCheckResult {
  window: SettlementWindow;
  targetsChecked: number;
  /** Accounts the deadline stopped us from starting. */
  targetsNotChecked: number;
  /** Accounts whose invoices did not all fit under the page ceiling. */
  targetsIncomplete: number;
  invoicesChecked: number;
  gaps: SettlementGap[];
  /** A Stripe listing refused, so this run cannot claim to have looked everywhere. */
  listingFailed: boolean;
  /** A local lookup refused, so a paid invoice's state is unknown rather than fine. */
  lookupFailed: boolean;
  /** The account listing itself refused. */
  accountListingFailed: boolean;
}

/**
 * Sweep the platform account and every connected account for paid invoices with
 * no settled local row.
 *
 * NEVER THROWS. Every failure becomes a flag on the result, because a run that
 * half-looked must not be reported as a clean bill of health, and an exception
 * here would turn a monitoring job into an outage of its own.
 */
export async function runSettlementGapCheck(
  input: SettlementGapCheckInput,
  deps: SettlementGapCheckDeps,
  logger: Logger
): Promise<SettlementGapCheckResult> {
  const now = deps.now();
  const window = input.window ?? settlementWindow(now);
  const createdSince = new Date(Date.parse(window.start) - GAP_CHECK_LIMITS.CREATED_LOOKBACK_MS);

  const result: SettlementGapCheckResult = {
    window,
    targetsChecked: 0,
    targetsNotChecked: 0,
    targetsIncomplete: 0,
    invoicesChecked: 0,
    gaps: [],
    listingFailed: false,
    lookupFailed: false,
    accountListingFailed: false,
  };

  const targets = await resolveTargets(input, deps, result, logger);

  for (const target of targets) {
    if (deps.now().getTime() > input.deadlineAt) {
      // Out of time. Say how many were left rather than implying they were fine.
      result.targetsNotChecked += 1;
      continue;
    }
    await checkTarget(target, createdSince, window, deps, result, logger);
    result.targetsChecked += 1;
  }

  logger.info(
    {
      trigger: input.trigger,
      windowStart: window.start,
      windowEnd: window.end,
      targetsChecked: result.targetsChecked,
      targetsNotChecked: result.targetsNotChecked,
      invoicesChecked: result.invoicesChecked,
      gaps: result.gaps.length,
      listingFailed: result.listingFailed,
      lookupFailed: result.lookupFailed,
    },
    'Stripe settlement gap check finished'
  );

  return result;
}

/**
 * Which accounts to ask.
 *
 * The platform's own account goes first and is always included: package and
 * credit purchases are charged there, and it is a separate destination from the
 * connected-account one, so it can be broken on its own.
 */
async function resolveTargets(
  input: SettlementGapCheckInput,
  deps: SettlementGapCheckDeps,
  result: SettlementGapCheckResult,
  logger: Logger
): Promise<SweepTarget[]> {
  if (input.accountId) {
    return [{ accountId: input.accountId, userId: null }];
  }

  const targets: SweepTarget[] = [{ accountId: null, userId: null }];

  let afterUserId: string | null = null;
  for (;;) {
    const { data, error }: Result<Array<{ user_id: string; stripe_account_id: string }>> = await attempt(() =>
      deps.pageConnectAccounts(afterUserId, GAP_CHECK_LIMITS.ACCOUNT_PAGE_SIZE)
    );
    if (error || !data) {
      result.accountListingFailed = true;
      logger.error({ err: error, afterUserId }, 'Could not list connected accounts for the settlement gap check');
      break;
    }
    for (const row of data) {
      targets.push({ accountId: row.stripe_account_id, userId: row.user_id });
    }
    if (data.length < GAP_CHECK_LIMITS.ACCOUNT_PAGE_SIZE) break;
    afterUserId = data[data.length - 1].user_id;
  }

  return targets;
}

/** Ask one account, then check each paid invoice it reports against our tables. */
async function checkTarget(
  target: SweepTarget,
  createdSince: Date,
  window: SettlementWindow,
  deps: SettlementGapCheckDeps,
  result: SettlementGapCheckResult,
  logger: Logger
): Promise<void> {
  let startingAfter: string | null = null;

  for (let page = 0; page < GAP_CHECK_LIMITS.STRIPE_PAGE_CEILING; page += 1) {
    const { data, error }: Result<{ invoices: PaidInvoiceFact[]; hasMore: boolean }> = await attempt(() =>
      deps.listPaidInvoices(target, createdSince, startingAfter, GAP_CHECK_LIMITS.STRIPE_PAGE_SIZE)
    );

    if (error || !data) {
      result.listingFailed = true;
      logger.error(
        { err: error, accountId: target.accountId, userId: target.userId },
        'Could not list paid invoices for an account'
      );
      return;
    }

    for (const invoice of data.invoices) {
      // Stripe was asked for a wide creation range on purpose; the window is
      // applied to the moment of payment, which is the thing being audited.
      if (!invoice.paidAt) continue;
      if (invoice.paidAt < window.start || invoice.paidAt > window.end) continue;

      result.invoicesChecked += 1;
      await checkInvoice(target, invoice, deps, result, logger);
    }

    if (!data.hasMore) return;
    startingAfter = data.invoices.length ? data.invoices[data.invoices.length - 1].stripeInvoiceId : null;
    if (!startingAfter) return;
  }

  // Still more to read when the ceiling was reached: looked, but not everywhere.
  result.targetsIncomplete += 1;
  logger.warn(
    { accountId: target.accountId, userId: target.userId, pageCeiling: GAP_CHECK_LIMITS.STRIPE_PAGE_CEILING },
    'Stopped paging an account at the ceiling; its later invoices were not checked'
  );
}

/** One invoice Stripe says is paid. Is it recorded? */
async function checkInvoice(
  target: SweepTarget,
  invoice: PaidInvoiceFact,
  deps: SettlementGapCheckDeps,
  result: SettlementGapCheckResult,
  logger: Logger
): Promise<void> {
  const { data: local, error }: Result<LocalSettlement> = await attempt(() =>
    deps.findLocalSettlement(invoice.stripeInvoiceId)
  );

  if (error || !local) {
    // Unknown is not fine. Flag the run rather than counting this as settled.
    result.lookupFailed = true;
    logger.error(
      { err: error, stripeInvoiceId: invoice.stripeInvoiceId, accountId: target.accountId },
      'Could not look up an invoice locally during the settlement gap check'
    );
    return;
  }

  if (local.found && local.settled) return;

  const gap: SettlementGap = {
    accountId: target.accountId,
    userId: target.userId,
    stripeInvoiceId: invoice.stripeInvoiceId,
    amountPaidMinor: invoice.amountPaidMinor,
    currency: invoice.currency,
    paidAt: invoice.paidAt,
    reason: local.found ? 'local_invoice_unsettled' : 'no_local_invoice',
    localInvoiceId: local.invoiceId,
    localStatus: local.status,
  };

  result.gaps.push(gap);

  // One error per gap: this IS the alert, as the credit leak check decided for
  // its own findings. A gap is a finding about the data, not a fault in the job.
  logger.error(
    {
      event: 'stripe_settlement_gap_found',
      accountId: gap.accountId,
      userId: gap.userId,
      stripeInvoiceId: gap.stripeInvoiceId,
      amountPaidMinor: gap.amountPaidMinor,
      currency: gap.currency,
      paidAt: gap.paidAt,
      reason: gap.reason,
      localInvoiceId: gap.localInvoiceId,
      localStatus: gap.localStatus,
    },
    'Stripe took money that is not recorded as settled'
  );
}
