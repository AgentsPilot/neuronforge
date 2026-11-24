/**
 * Two questions, asked of Stripe every night:
 *
 *     did it TAKE money we never recorded?
 *     is it HOLDING a bill we cannot see?
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
 * THE SECOND QUESTION, AND WHY IT IS NOT THE SAME ONE
 *
 * A payment plan's later periods are invoiced by STRIPE, on the subscription's
 * own cycle, not by us. We never raise a row for them, so a lost
 * `invoice.finalized` delivery leaves the bill existing only at Stripe:
 * invisible to the owner's money page, to the client portal, and to the
 * invoice chaser, which has nothing but our own tables to read. Nothing is
 * stolen and nothing is corrupt; the money is simply never asked for, and the
 * plan closes on its `cancel_at` with the owner none the wiser.
 *
 * Measured 2026-11-23: five such bills, 2,000 ILS, on one connected account.
 *
 * So the payment question is narrowed to a WINDOW, because a payment happened
 * at a moment. The debt question has no window: a debt is a STATE, and the
 * oldest unseen one is the worst, not the stalest.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT WRITES NOW, AND STILL IS NOT A QUEUE DRAIN
 *
 * This was read-only, and that was the defect. It ran thirty nights answering
 * `gapsFound: 0` while Stripe held 4,565.82 it had collected across ten plan
 * renewals the platform had no record of: zero was true of its 48-hour window
 * and useless about the account. A gap that is only logged is a gap that stays.
 *
 * Both writes go through the single writers in `lib/payments/` that the webhook
 * also calls — `recordPlanPeriodPaid` and `mirrorPlanBill` — never a copy of
 * them, so a row written at 05:17 by a sweep is the row the webhook would have
 * written. Both are injected and OPTIONAL: without them this module behaves
 * exactly as it did, which is what a dry run wants.
 *
 * The `durable-queue-drain` skill still does not apply. Nothing is claimed,
 * both writers check for an existing row before touching anything, and unique
 * indexes enforce it underneath — so two overlapping runs remain harmless and
 * a second pass over the same invoice writes nothing twice.
 *
 * NEVER THROWS, and that contract now covers the writes too: a repair or a
 * mirror that fails is counted and logged, and the sweep moves to the next
 * account, which may be holding money of its own that nobody has recorded.
 *
 * The durable trace is the run record plus one log per finding. The caller
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
  /*
   * ── 48 HOURS WAS THE BLIND SPOT, NOT THE BUDGET ───────────────────────────
   *
   * A gap only ever got two chances to be noticed, and after that it aged out
   * of every run for ever. Measured: ten plan renewals worth 4,565.82 collected
   * between 22 Oct and 2 Nov, each one invisible to this check from 4 Nov
   * onward, while it reported `gapsFound: 0` every night.
   *
   * Fourteen days, because the check now REPAIRS what it finds: a gap inside
   * the window is fixed on the first run that sees it, so the window no longer
   * has to be the last line of defence — it only has to be longer than a
   * plausible outage. The work does not grow with it either, since Stripe is
   * asked for invoices and the repair is skipped for everything already
   * recorded.
   */
  WINDOW_MS: 14 * 24 * 60 * 60_000,
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
 * The window a run examines: payments completed between roughly fourteen days
 * and roughly 1 hour ago, with both edges on an hour boundary.
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

/**
 * What this check needs to know about a bill Stripe is still waiting on.
 *
 * Deliberately NOT a `PaidInvoiceFact` with the fields renamed: nothing has
 * been collected, so there is no `paidAt` and no `amountPaid`, and giving this
 * the same shape would invite the window and the settlement test to be applied
 * to it, neither of which means anything here.
 */
export interface OpenBillFact {
  stripeInvoiceId: string;
  amountDueMinor: number;
  currency: string;
  /** ISO. Only for the report; nothing is filtered on it. */
  createdAt: string | null;
}

/** What our own tables say about that invoice. */
export interface LocalSettlement {
  found: boolean;
  settled: boolean;
  invoiceId: string | null;
  status: string | null;
}

export type GapReason = 'no_local_invoice' | 'local_invoice_unsettled';

/** A debt Stripe is holding that no local row describes. */
export interface InvisibleBill {
  accountId: string | null;
  userId: string | null;
  stripeInvoiceId: string;
  amountDueMinor: number;
  currency: string;
  createdAt: string | null;
  /** True when this run wrote the local row, so the owner can now see it. */
  mirrored: boolean;
}

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
  /**
   * Write the money this gap describes, if it can be written.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * REPORTING WAS NEVER ENOUGH, AND THE DATA SAYS SO.
   *
   * This check ran nightly for thirty nights and answered `gapsFound: 0` while
   * Stripe held 4,565.82 it had collected across ten plan renewals that this
   * platform had no record of. Zero was true of its 48-hour window and useless
   * about the account: a gap that is only logged is a gap that stays.
   *
   * OPTIONAL on purpose. Without it this module behaves exactly as it did —
   * which is what the existing tests assert, and what a dry run wants.
   *
   * @returns `true` when the money was written, `false` when this gap is not
   *   something it knows how to repair (an ordinary invoice rather than a plan
   *   period). Throwing is reserved for "it should have worked and did not",
   *   which is counted separately and leaves the gap reported.
   */
  repairGap?(gap: SettlementGap): Promise<boolean>;
  /**
   * One page of invoices a target has finalized and not been paid for.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * OPTIONAL, like `repairGap`, and for the same reason: without it this module
   * behaves exactly as it did, which is what the existing tests assert and what
   * a dry run of the settlement half wants.
   */
  listOpenInvoices?(
    target: SweepTarget,
    createdSince: Date,
    startingAfter: string | null,
    pageSize: number
  ): Promise<Result<{ invoices: OpenBillFact[]; hasMore: boolean }>>;
  /**
   * Write a local row for a bill only Stripe can see.
   *
   * @returns `true` when a row now exists, `false` when this bill is not one we
   *   can describe (it belongs to no plan of ours — an owner's own subscription
   *   set up in the Stripe dashboard, which is none of our business). Throwing
   *   is reserved for "it should have worked and did not".
   */
  mirrorBill?(bill: InvisibleBill): Promise<boolean>;
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
  /** Gaps whose money this run wrote. Zero when no repairer was supplied. */
  gapsRepaired: number;
  /** Gaps a repairer declined — not a plan period, so still only reported. */
  gapsUnrepairable: number;
  /** Gaps a repairer threw on. These are the ones worth waking up for. */
  repairFailed: number;
  gaps: SettlementGap[];
  /** Open invoices examined. Zero when no open listing was supplied. */
  billsChecked: number;
  /** Debts Stripe holds that no local row described when this run began. */
  invisibleBills: InvisibleBill[];
  /** How many of those this run made visible. */
  billsMirrored: number;
  /** A mirror threw. The bill stays reported and unseen. */
  billMirrorFailed: number;
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
    gapsRepaired: 0,
    gapsUnrepairable: 0,
    repairFailed: 0,
    gaps: [],
    billsChecked: 0,
    invisibleBills: [],
    billsMirrored: 0,
    billMirrorFailed: 0,
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
    /* The second question, asked of the same account while we have it: not
       "was money taken and unrecorded" but "is a debt being held that nothing
       of ours can see". Skipped entirely when no open listing was supplied. */
    await checkOpenBills(target, createdSince, input.deadlineAt, deps, result, logger);
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
      gapsRepaired: result.gapsRepaired,
      repairFailed: result.repairFailed,
      billsChecked: result.billsChecked,
      invisibleBills: result.invisibleBills.length,
      billsMirrored: result.billsMirrored,
      billMirrorFailed: result.billMirrorFailed,
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

/**
 * Ask one account what it is still owed, and check we can see each of those
 * debts.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NO WINDOW, AND THAT IS THE POINT.
 *
 * The paid sweep narrows to a window because a payment is an event: it happened
 * at a moment, and auditing the same moment for ever is waste. A debt is a
 * STATE. An open invoice from two months ago that we still cannot see is not a
 * stale finding, it is the worst one — nobody has chased it and nobody can. So
 * every open invoice Stripe reports inside its creation lookback is examined on
 * every run, and keeps being examined until it is paid, voided, or visible.
 *
 * That costs nothing extra in practice: an account's open invoices are few by
 * definition — a business with hundreds is a business in trouble for other
 * reasons — and the mirror is skipped for every bill already recorded.
 * ─────────────────────────────────────────────────────────────────────────────
 */
async function checkOpenBills(
  target: SweepTarget,
  createdSince: Date,
  deadlineAt: number,
  deps: SettlementGapCheckDeps,
  result: SettlementGapCheckResult,
  logger: Logger
): Promise<void> {
  const list = deps.listOpenInvoices;
  if (!list) return;

  /*
   * The deadline, checked again HERE and not only before the target.
   *
   * The loop tests it once per target and then ran one sweep. This is a second
   * sweep of comparable size, so a target started just inside the deadline now
   * does roughly twice the work it used to — enough, with the page ceiling at
   * ten, to carry a run past `maxDuration` and have Vercel kill it. A killed
   * run writes no record at all, which is strictly worse than a run that says
   * what it did not reach.
   *
   * Skipped silently rather than counted as a missed target: the payment half
   * of this target DID complete, so counting it in `targetsNotChecked` would
   * misreport the thing that matters most.
   */
  if (deps.now().getTime() > deadlineAt) return;

  let startingAfter: string | null = null;

  for (let page = 0; page < GAP_CHECK_LIMITS.STRIPE_PAGE_CEILING; page += 1) {
    const { data, error }: Result<{ invoices: OpenBillFact[]; hasMore: boolean }> = await attempt(() =>
      list(target, createdSince, startingAfter, GAP_CHECK_LIMITS.STRIPE_PAGE_SIZE)
    );

    if (error || !data) {
      // Same rule as the paid listing: a refusal is a flag, never an empty page.
      // An empty page here reads as "this account is owed nothing".
      result.listingFailed = true;
      logger.error(
        { err: error, accountId: target.accountId, userId: target.userId },
        'Could not list open invoices for an account'
      );
      return;
    }

    for (const bill of data.invoices) {
      result.billsChecked += 1;
      await checkBill(target, bill, deps, result, logger);
    }

    if (!data.hasMore) return;
    startingAfter = data.invoices.length ? data.invoices[data.invoices.length - 1].stripeInvoiceId : null;
    if (!startingAfter) return;
  }

  result.targetsIncomplete += 1;
  logger.warn(
    { accountId: target.accountId, userId: target.userId, pageCeiling: GAP_CHECK_LIMITS.STRIPE_PAGE_CEILING },
    'Stopped paging an account open invoices at the ceiling; its later bills were not checked'
  );
}

/** One debt Stripe is holding. Can anything of ours see it? */
async function checkBill(
  target: SweepTarget,
  bill: OpenBillFact,
  deps: SettlementGapCheckDeps,
  result: SettlementGapCheckResult,
  logger: Logger
): Promise<void> {
  const { data: local, error }: Result<LocalSettlement> = await attempt(() =>
    deps.findLocalSettlement(bill.stripeInvoiceId)
  );

  if (error || !local) {
    result.lookupFailed = true;
    logger.error(
      { err: error, stripeInvoiceId: bill.stripeInvoiceId, accountId: target.accountId },
      'Could not look up an open invoice locally during the settlement gap check'
    );
    return;
  }

  /* A row exists, so the owner can see the debt and the chaser can chase it.
     Whether that row says `sent` or `overdue` is the overdue sweep's business,
     not this one's: this asks only whether the bill is visible at all. */
  if (local.found) return;

  const invisible: InvisibleBill = {
    accountId: target.accountId,
    userId: target.userId,
    stripeInvoiceId: bill.stripeInvoiceId,
    amountDueMinor: bill.amountDueMinor,
    currency: bill.currency,
    createdAt: bill.createdAt,
    mirrored: false,
  };

  if (deps.mirrorBill) {
    try {
      invisible.mirrored = await deps.mirrorBill(invisible);
      if (invisible.mirrored) result.billsMirrored += 1;
    } catch (err) {
      /* Does not fail the run, for the same reason a failed repair does not:
         the remaining accounts may hold debts of their own that nobody can
         see, and abandoning them to re-raise one error trades the many for the
         one. */
      result.billMirrorFailed += 1;
      logger.error(
        { err, event: 'stripe_invisible_bill_mirror_failed', stripeInvoiceId: bill.stripeInvoiceId },
        'Could not record a debt Stripe is holding'
      );
    }
  }

  result.invisibleBills.push(invisible);

  if (invisible.mirrored) {
    logger.info(
      {
        event: 'stripe_invisible_bill_mirrored',
        accountId: invisible.accountId,
        stripeInvoiceId: invisible.stripeInvoiceId,
        amountDueMinor: invisible.amountDueMinor,
        currency: invisible.currency,
      },
      'Recorded a debt Stripe was holding that this platform could not see'
    );
    return;
  }

  /*
   * WARN, not ERROR, and the distinction is deliberate.
   *
   * An unrecorded PAYMENT is money already taken whose absence corrupts the
   * books, so it is an error. An unseen DEBT is money not yet collected — bad,
   * chaseable, and in the ordinary case not ours at all: an owner's own Stripe
   * subscription, which `mirrorBill` correctly declines and which would
   * otherwise page somebody nightly for ever.
   */
  logger.warn(
    {
      event: 'stripe_invisible_bill_found',
      accountId: invisible.accountId,
      userId: invisible.userId,
      stripeInvoiceId: invisible.stripeInvoiceId,
      amountDueMinor: invisible.amountDueMinor,
      currency: invisible.currency,
      createdAt: invisible.createdAt,
    },
    'Stripe is holding a bill this platform cannot see'
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

  /*
   * ── REPAIR FIRST, THEN SAY WHAT HAPPENED ──────────────────────────────────
   *
   * The gap is recorded above whatever the outcome, so the finding is never
   * lost. What changes is the sentence: money that has just been written is not
   * the same alert as money still missing, and an owner reading one of these at
   * 05:17 needs to know which.
   *
   * A repairer that throws does NOT fail the run. The remaining targets still
   * hold money nobody has recorded, and abandoning them to re-raise one error
   * would trade the many for the one.
   */
  let repaired = false;

  if (deps.repairGap) {
    try {
      repaired = await deps.repairGap(gap);
      if (repaired) result.gapsRepaired += 1;
      else result.gapsUnrepairable += 1;
    } catch (err) {
      result.repairFailed += 1;
      logger.error(
        { err, event: 'stripe_settlement_repair_failed', stripeInvoiceId: gap.stripeInvoiceId },
        'Could not record money Stripe has already taken'
      );
    }
  }

  if (repaired) {
    /* INFO, not error: the platform found money it had missed and wrote it.
       That is the system working, and paging someone for it teaches them to
       stop reading these. */
    logger.info(
      {
        event: 'stripe_settlement_gap_repaired',
        accountId: gap.accountId,
        userId: gap.userId,
        stripeInvoiceId: gap.stripeInvoiceId,
        amountPaidMinor: gap.amountPaidMinor,
        currency: gap.currency,
        reason: gap.reason,
      },
      'Recorded money Stripe had taken and this platform had missed'
    );
    return;
  }

  // One error per unrepaired gap: this IS the alert, as the credit leak check
  // decided for its own findings. A gap is a finding about the data, not a
  // fault in the job.
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
