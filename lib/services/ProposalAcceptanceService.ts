/**
 * What happens the moment a client accepts.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RISK THIS FILE EXISTS TO CONTAIN
 *
 * Accepting creates a plan, its stages, and an invoice. That button fires twice
 * more often than it looks: a double click, the email link opened on a phone
 * and then a laptop, a slow network the browser silently retries, a refresh
 * mid-request. Twice means the client is billed twice for one agreement, which
 * is a phone call and a lost client rather than a bug report.
 *
 * The guard is a conditional update in ProposalRepository.claimForAcceptance —
 * the database allows sent/viewed → accepted exactly once. Whoever wins does
 * the work here; everyone else is shown the same finished result. Nothing in
 * this file may be called without that claim first.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The three payment shapes settle here, in one place, so a future surface
 * cannot invent a fourth interpretation:
 *
 *   single       one invoice for the whole total
 *   installments a plan whose stages carry due dates
 *   milestones   a plan whose stages carry NAMES and no dates, each billed when
 *                the owner marks that stage complete
 */

import { createLogger } from '@/lib/logger';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { paymentPlanRepository, type PaymentPlanInstallmentInsert } from '@/lib/repositories/PaymentPlanRepository';
import { crmContactRepository } from '@/lib/repositories/CRMContactRepository';
import {
  dueDateFromTerms,
  resolveTermsDays,
  termsValueForDays,
} from '@/lib/payments/paymentTerms';
import { paymentInvoiceRepository } from '@/lib/repositories/PaymentRepository';
import { dueDatesFor } from '@/lib/payments/planSchedule';
import { schedulingBookingRepository } from '@/lib/repositories/SchedulingRepository';
import { userPreferencesRepository } from '@/lib/repositories/UserPreferencesRepository';
import { safeTimezone } from '@/lib/scheduling/businessTime';
import { isSlotTakenError } from '@/lib/business-os/bookingStatus';
import type { Proposal, PaymentShape } from '@/lib/repositories/ProposalRepository';

const logger = createLogger({ service: 'ProposalAcceptanceService' });

export interface AcceptanceResult {
  invoiceId: string | null;
  planId: string | null;
  /** What the client owes right now, if anything. */
  dueNow: number;
  /**
   * A package's meetings, where the quote sold several.
   *
   * `container` is the booking the meetings hang off: a purchase with no time of
   * its own, so every diary path skips it without needing a filter. Null when
   * the quote was not a package.
   *
   * `clashed` is the dates that could not be taken because somebody else got
   * there between the quote being sent and accepted. Never fatal — see
   * `createPackageMeetings`.
   */
  package?: {
    container: string;
    created: number;
    /**
     * The meetings, in the order they were sold.
     *
     * Needed by the per-session money: stage *i* is bound to meeting *i*
     * through `payment_plan_installments.booking_id`, which is what lets
     * marking a meeting as held bill the right stage.
     */
    meetings: string[];
    clashed: string[];
  } | null;
}

/**
 * Split a total into stage amounts whose sum is EXACTLY the total.
 *
 * Percentages are what the owner types; money is what the client pays. 30/40/30
 * of ₪60,000 is exact, but 33/33/34 of ₪1,000 is not — and a split that loses
 * an agora means the invoices never add up to what was accepted, which is the
 * one arithmetic error nobody forgives.
 *
 * The remainder lands on the FINAL stage, the same convention `planPhases()`
 * already uses for Stripe subscription phases.
 */
export function splitTotal(total: number, percents: number[]): number[] {
  const minorTotal = Math.round(total * 100);
  const amounts = percents.map(p => Math.floor((minorTotal * p) / 100));
  const remainder = minorTotal - amounts.reduce((sum, a) => sum + a, 0);
  amounts[amounts.length - 1] += remainder;
  return amounts.map(minor => minor / 100);
}

/** Does this split describe the whole job? */
export function isCompleteSplit(percents: number[]): boolean {
  const sum = percents.reduce((a, b) => a + b, 0);
  // Tolerance for a typed 33.33 × 3; anything looser would let a real mistake
  // through, and anything tighter would reject a legitimate thirds split.
  return Math.abs(sum - 100) < 0.01;
}

/**
 * Turn an accepted proposal into money owed.
 *
 * Never called except by the winner of `claimForAcceptance`.
 */
export async function applyAcceptance(proposal: Proposal): Promise<AcceptanceResult> {
  const shape = (proposal.payment_shape || { kind: 'single' }) as PaymentShape;

  /*
   * THE MEETINGS A PACKAGE SOLD, created before the money.
   *
   * Which status they take is the whole difference between the two ways a
   * package is sold, and it is read off the money rather than stored twice:
   *
   *   PAID UP FRONT (`single`) → `pending`. The slots are held, so nobody else
   *   can take them, and the client is not yet told the meetings are on —
   *   `settleInvoicePaid` confirms them and sends the one email listing the
   *   dates when the payment lands.
   *
   *   PAY PER SESSION (`milestones` / `installments`) → `confirmed`. There is
   *   nothing to wait for: the client pays as the meetings happen, so leaving
   *   them pending would chase a payment that is not due yet.
   *
   * Before the money on purpose. If an invoice or a plan fails below, the
   * acceptance returns having created nothing further — and a client who has
   * agreed would rather their dates exist and the bill be chased than the
   * reverse.
   */
  const sessions = packagePlanFrom(proposal);
  const pkg = sessions
    ? await createPackageMeetings(proposal, sessions, shape.kind === 'single' ? 'pending' : 'confirmed')
    : null;

  if (shape.kind === 'single') {
    /*
     * A package's single invoice bills the PURCHASE, not the consultation the
     * quote came out of — see `raiseInvoice`. That is what lets the money be
     * refunded, and the purchase's payment status be read, from the one row
     * that represents the block.
     */
    const invoiceId = await raiseInvoice(
      proposal,
      proposal.total,
      proposal.title,
      pkg?.container ?? null
    );
    return { invoiceId, planId: null, dueNow: proposal.total, package: pkg };
  }

  const stages =
    shape.kind === 'milestones'
      ? shape.stages
      : // An instalment plan is an equal split by another name, which is why it
        // shares this path rather than owning a second one.
        Array.from({ length: shape.count }, (_, i) => ({
          label: '',
          percent: 100 / shape.count,
          index: i,
        }));

  const amounts = splitTotal(proposal.total, stages.map(s => s.percent));

  const planId = await createPlan(proposal, stages.length, amounts);
  if (!planId) {
    /*
     * No plan means no stages to bill against. Falling back to one invoice for
     * the whole total would charge a client the entire amount they had agreed
     * to pay in three parts — worse than the failure. The proposal stays
     * accepted with nothing created, which is visible and recoverable.
     */
    logger.error({ proposalId: proposal.id }, 'Accepted but the payment plan could not be created');
    return { invoiceId: null, planId: null, dueNow: 0, package: pkg };
  }

  const isMilestones = shape.kind === 'milestones';

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * A PACKAGE BILLED AFTER EACH MEETING.
   *
   * Nothing is due when the client approves: the stages are the meetings, and a
   * meeting that has not happened is not owed for. So every stage is `manual`
   * — including the FIRST, which is the one difference from an ordinary
   * milestone plan, where stage 1 is the deposit and is billed on acceptance.
   *
   * Each stage is bound to its own meeting through `booking_id`, so marking
   * meeting three as held bills meeting three's stage and nothing else. That
   * column already existed and already carried "the job this stage belongs
   * to"; for a package the job IS one meeting.
   *
   * Requires the meetings to exist, which they do: the package is created at
   * the top of this function, before any money.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const perSession = Boolean(proposal.sessions?.bill_per_session) && Boolean(pkg?.meetings?.length);
  const sessionBookings = perSession ? (pkg?.meetings ?? []) : [];

  /*
   * The first stage is due after the agreed terms, and the cadence steps from
   * there. Terms and cadence answer different questions — "how long to pay"
   * versus "how far apart" — and the first period needs both.
   */
  const firstDue = dueDateFromTerms(await termsDaysFor(proposal));

  const rows = stages.map((stage, index) => ({
    user_id: proposal.user_id,
    payment_plan_id: planId,
    contact_id: proposal.contact_id,
    proposal_id: proposal.id,
    /*
     * The job these stages belong to.
     *
     * Set alongside `contact_id` and `proposal_id`, which were — this one was
     * simply missed. Every query that asks "what does this booking still owe"
     * goes through `booking_id`, so without it the stages were reachable only
     * from the proposal, and the booking they bill knew nothing about them.
     */
    /*
     * For a per-session package this is THE MEETING this stage bills, not the
     * consultation the quote came out of — see the note above. Falls back to the
     * proposal's own booking when the stage has no meeting of its own, which is
     * every ordinary quote and any stage beyond the meetings that exist.
     */
    booking_id: perSession ? (sessionBookings[index] ?? proposal.booking_id) : proposal.booking_id,
    installment_number: index + 1,
    amount: amounts[index],
    currency: proposal.currency,
    label: 'label' in stage && stage.label ? stage.label : null,
    /*
     * The first stage of a milestone plan is billed on acceptance — it is the
     * deposit, and the work it pays for is "agreeing". Every later stage waits
     * for the owner to say the work happened, so it has no date at all.
     */
    trigger: perSession || (isMilestones && index > 0) ? 'manual' : 'date',
    due_date: perSession || (isMilestones && index > 0) ? null : dueDateFor(shape, index, firstDue),
    status: 'pending',
  }));

  const { data: stageRows, error: stageError } =
    // Annotated at the call rather than on `rows`: the object literal infers
    // `trigger` and `status` as plain strings, and the repository's type names
    // the exact unions the column accepts.
    await paymentPlanRepository.createInstallments(rows as PaymentPlanInstallmentInsert[]);
  if (stageError) {
    logger.error({ err: stageError, proposalId: proposal.id, planId }, 'Could not create the stages');
    return { invoiceId: null, planId, dueNow: 0, package: pkg };
  }

  /*
   * Only the first stage is billed now.
   *
   * A MILESTONE stage waits for the owner to say the work happened, through
   * `payment-stages/[id]/complete`. A DATED stage is billed by
   * `PaymentReminderService.billDueDatedStages` when its date arrives.
   *
   * That second half used to be a claim rather than a fact: this comment said
   * "the rest are raised as they fall due" and nothing raised them. The client
   * was chased for a stage that had no invoice, which produced an email with a
   * blank invoice number and no way to pay.
   */
  /*
   * A PER-SESSION PACKAGE RAISES NOTHING HERE.
   *
   * Its first stage is the first MEETING, and that meeting has not happened. An
   * invoice at this point would ask the client to pay for a session before it
   * took place, which is the opposite of what they agreed to — and it would be
   * chased on days 1, 3 and 7 while the session sat in the future.
   *
   * `billSessionOnCompletion` raises each one as its meeting is marked held, so
   * the client is billed for exactly what happened.
   */
  if (perSession) {
    logger.info(
      { proposalId: proposal.id, planId, sessions: stages.length },
      'Accepted a per-session package: nothing is due until the first meeting is held'
    );
    return { invoiceId: null, planId, dueNow: 0, package: pkg };
  }

  const firstLabel =
    'label' in stages[0] && stages[0].label
      ? `${proposal.title} — ${stages[0].label}`
      : `${proposal.title} (1/${stages.length})`;

  const invoiceId = await raiseInvoice(proposal, amounts[0], firstLabel);

  /*
   * Link the invoice to the stage it bills.
   *
   * The two were created and never introduced, so nothing could answer "how
   * much of this job has been collected": the invoice knew it was paid and the
   * stage still said pending. `settleInvoice` moves the stage by this link, so
   * without it a two-stage job read as finished the moment the deposit cleared.
   */
  if (invoiceId && stageRows?.length) {
    const first = [...stageRows].sort(
      (a, b) => (a.installment_number ?? 0) - (b.installment_number ?? 0)
    )[0];

    /*
     * Through the repository, which also scopes the write to the owner.
     *
     * The direct update matched on `id` alone. An id is not a permission — it
     * is a guess away from another business's stage — and this path runs as the
     * service role, so RLS was not going to catch it either. The repository
     * carries `.eq('user_id', …)`, so the scope is no longer optional.
     */
    /*
     * `status: 'billed'` alongside the link, because that is what just happened.
     *
     * ───────────────────────────────────────────────────────────────────────
     * This wrote the invoice id and nothing else, so the deposit stage sat as
     * `pending` with an invoice already raised against it — a state no other
     * path produces. `billStage` writes `billed` when it raises one, and the
     * two paths disagreeing meant the same event left two different rows.
     *
     * It showed up on a stopped quote: stage 1 read `pending` and was closed,
     * stage 2 read `billed` and was not, and the difference looked like a rule
     * about the stages when it was only a difference in who invoiced them.
     *
     * `completed_at` is deliberately NOT written — see `billStage`: a dated
     * stage was never completed by anyone, and the deposit is billed on
     * acceptance rather than on somebody saying the work happened.
     * ───────────────────────────────────────────────────────────────────────
     */
    const { error: linkError } = await paymentPlanRepository.updateInstallment(
      first.id,
      proposal.user_id,
      { invoice_id: invoiceId, status: 'billed' }
    );

    if (linkError) {
      logger.error(
        { err: linkError, proposalId: proposal.id, invoiceId, stageId: first.id },
        'The deposit invoice could not be linked to its stage'
      );
    }
  }

  if (!invoiceId) {
    // Loud, because the acceptance has already been committed and the client
    // has been told they owe a deposit. Silence here is what let a constraint
    // violation look like a quote with nothing to pay.
    logger.error(
      { proposalId: proposal.id, planId, amount: amounts[0] },
      'Accepted with no invoice raised — the client owes money that was never billed'
    );
  }

  return { invoiceId, planId, dueNow: amounts[0], package: pkg };
}

/* ------------------------------------------------------------------ helpers */

/**
 * How many days this proposal's client gets to pay.
 *
 * The quote's own terms win over the business default, because the quote is
 * what the client agreed to — changing the default next month must not shorten
 * terms somebody already signed.
 */
async function termsDaysFor(proposal: Proposal): Promise<number> {
  /*
   * Through the repository, not a direct query.
   *
   * This read the table itself and discarded the error along with it — the
   * destructure took `data` only, so a failed read was indistinguishable from a
   * business that had set no terms, and both quietly produced 30-day invoices.
   * The repository logs the failure; the fallback below is then a decision
   * rather than an accident.
   */
  const { data: businessDays } = await businessProfileRepository.getPaymentTermsDays(
    proposal.user_id
  );

  return resolveTermsDays(proposal.payment_terms_days, businessDays);
}

/**
 * When stage `index` of this plan falls due.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE CALENDAR, NOT A FIXED NUMBER OF DAYS.
 *
 * This stepped `{weekly: 7, biweekly: 14, monthly: 30, quarterly: 91}` from the
 * first due date. Weeks and fortnights are exactly that many days, so those were
 * right — but a month is not 30 days and a quarter is not 91. A twelve-month plan
 * accepted on the 15th billed its last stage on the 10th, five days adrift, and
 * every month in between had slipped a little further.
 *
 * `dueDatesFor` is the arithmetic the regular-service plan already uses, written
 * to match what Stripe does: calendar months, with the day clamped to the end of
 * a short one — "31 January + 1 month is 28 February, not 3 March". Sharing it
 * means a quote billed in instalments and a service billed in instalments now
 * produce the same dates, which is what an owner comparing the two expects.
 *
 * `from` is still the anchor: stage 1 is the acceptance day plus the agreed
 * terms, and the cadence steps from there. Only the step changed.
 * ─────────────────────────────────────────────────────────────────────────────
 */
/*
 * Exported for its test, not for callers.
 *
 * It is pure, it is the arithmetic that decides when a client is asked for money,
 * and it had no coverage at all while it was stepping a flat 30 days for a month.
 * `applyAcceptance` around it needs four mocked collaborators to reach, so testing
 * the schedule through it would test the mocks.
 */
export function dueDateFor(shape: PaymentShape, index: number, from: string): string {
  if (index === 0 || shape.kind !== 'installments') return from;

  // Noon UTC, so a date-only string cannot land on the previous day west of UTC.
  const start = new Date(`${from}T12:00:00Z`);
  const dates = dueDatesFor(start, shape.frequency, index + 1);
  return dates[index].toISOString().slice(0, 10);
}

async function createPlan(
  proposal: Proposal,
  count: number,
  amounts: number[]
): Promise<string | null> {
  try {
    const { data, error } = await paymentPlanRepository.create({
        user_id: proposal.user_id,
        service_id: proposal.service_id,
        name: proposal.title,
        total_amount: proposal.total,
        currency: proposal.currency,
        installment_count: count,
        // The first stage's amount. The column is a single number and the
        // stages carry their own; this is the headline, not the source of truth.
        installment_amount: amounts[0],
        installment_frequency: 'monthly',
    });

    if (error) throw error;
    // The repository returns `data: null` alongside an error, so reaching here
    // means it is set; TypeScript cannot see that through the result shape.
    if (!data) throw new Error('Payment plan was created but returned no row');
    return data.id;
  } catch (error) {
    logger.error({ err: error, proposalId: proposal.id }, 'Failed to create the payment plan');
    return null;
  }
}

/**
 * Raise one invoice.
 *
 * Deliberately does NOT send it or touch Stripe. Sending is a separate step
 * with its own failure handling in `InvoiceDeliveryService`, which already
 * decides between a Stripe hosted page and a branded PDF by email — and
 * already falls back to email when Stripe is unavailable. Re-deciding that here
 * would give a proposal-raised invoice different behaviour from every other one.
 */
/* ─────────────────────────────────────────────────────────────────────────────
 * A PACKAGE'S MEETINGS
 *
 * One purchase owning several meetings is the whole feature; until now an
 * accepted quote could own at most one. The agreement names the dates
 * explicitly (`proposals.sessions`), never a cadence rule, so there is nothing
 * to compute here — only rows to write.
 *
 * THE CONTAINER HAS NO TIME. It is a purchase, not an hour, which is the same
 * shape a course or a product already has: every availability path, the overlap
 * check, calendar sync and the exclusion constraint all skip a booking with no
 * `start_time`, so nothing needs excluding anywhere and `purchases →
 * parent_booking_id IS NULL` stays true for every reader the audit classified.
 *
 * MONEY DOES NOT MOVE. The invoice and the stages are already raised against
 * `proposal.booking_id` — the consultation the quote came out of, or nothing for
 * a quote sent cold — and a package changes how many MEETINGS a purchase owns,
 * not where its money lives.
 *
 * `schedulingBookingRepository.create` rather than `createBooking`: the lifecycle
 * verb raises an invoice, syncs a calendar event and emails the client, which for
 * six meetings would be six invoices and six emails. The one email listing all
 * the dates belongs at payment, which is also the only point at which there is
 * anything to tell the client.
 * ───────────────────────────────────────────────────────────────────────────── */

interface PackagePlan {
  dates: string[];
  durationMinutes: number;
}

/**
 * What the agreement says was sold, or null if it was not a package.
 *
 * Validated rather than trusted, even though the column is typed: these rows
 * are JSONB written by an earlier version of the builder, by the chat, or by a
 * hand-run fix — and a bad date here would create a meeting at the epoch that
 * the owner then has to find and delete.
 */
function packagePlanFrom(proposal: Proposal): PackagePlan | null {
  const raw: unknown = proposal.sessions;
  if (!raw || typeof raw !== 'object') return null;

  const sessions = raw as { dates?: unknown; duration_minutes?: unknown };
  if (!Array.isArray(sessions.dates) || sessions.dates.length === 0) return null;

  const dates = sessions.dates
    .filter((value): value is string => typeof value === 'string')
    .filter(value => !Number.isNaN(Date.parse(value)));

  if (dates.length === 0) return null;

  const duration = Number(sessions.duration_minutes);
  return {
    dates,
    /*
     * A length is required to give each meeting an end. Falling back to an hour
     * would invent a commitment nobody agreed to, so an unusable one is read as
     * "not a package" above rather than guessed at here — except that the write
     * side validates it, which is why this is a floor and not a branch.
     */
    durationMinutes: Number.isFinite(duration) && duration > 0 ? duration : 60,
  };
}

async function createPackageMeetings(
  proposal: Proposal,
  plan: PackagePlan,
  /** `pending` holds the slots without claiming payment; see the call site. */
  status: 'pending' | 'confirmed'
): Promise<AcceptanceResult['package']> {
  /*
   * A package needs a service, because `scheduling_bookings.service_id` is NOT
   * NULL and the service is also what names each meeting in the diary. The
   * write side requires it; this refuses rather than inventing one, and leaves
   * the money in place — visible and recoverable, the same answer the failed-plan
   * path gives.
   */
  if (!proposal.service_id) {
    logger.error(
      { proposalId: proposal.id },
      'Accepted a package with no service; its meetings were not created'
    );
    return null;
  }

  /*
   * THE BUSINESS'S CLOCK, read here because nothing else can supply it.
   *
   * Acceptance runs on the CLIENT's click, so there is no owner browser to
   * infer a zone from — and the column the booking stores is what the
   * confirmation email formats against. Left to the repository's `'UTC'`
   * default, a package's meetings would print an hour nobody chose, which is
   * the bug the owner-side booking route documents at length.
   *
   * An unreadable zone falls back the same way every other caller does, via
   * `safeTimezone`: a wrong label on a right instant is recoverable, and
   * refusing to create the meetings over it would not be.
   */
  const { data: storedZone } = await userPreferencesRepository.findTimezone(proposal.user_id);
  const timezone = safeTimezone(storedZone);

  const container = await schedulingBookingRepository.create({
    user_id: proposal.user_id,
    service_id: proposal.service_id,
    contact_id: proposal.contact_id,
    // No time: this row is the purchase, not a meeting. See the note above.
    start_time: null,
    end_time: null,
    timezone,
    status,
    booking_source: 'proposal',
    notes: proposal.title,
  });

  if (container.error || !container.data) {
    logger.error(
      { err: container.error, proposalId: proposal.id },
      'Accepted a package but its container could not be created'
    );
    return null;
  }

  const containerId = container.data.id;
  const clashed: string[] = [];
  /** The ids, in the order sold — `occurrence_number` order by construction. */
  const meetings: string[] = [];

  for (const [index, date] of plan.dates.entries()) {
    const start = new Date(date);
    const end = new Date(start.getTime() + plan.durationMinutes * 60 * 1000);

    const child = await schedulingBookingRepository.create({
      user_id: proposal.user_id,
      service_id: proposal.service_id,
      contact_id: proposal.contact_id,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      timezone,
      status,
      booking_source: 'proposal',
      parent_booking_id: containerId,
      occurrence_number: index + 1,
    });

    /*
     * One date lost does not lose the package.
     *
     * Between the quote being sent and accepted, somebody can take one of its
     * slots — and the exclusion constraint refuses the write, which is the
     * point of it. Refusing the whole acceptance would leave the client having
     * agreed and paid for nothing; creating five of six and naming the sixth is
     * the answer the owner can act on.
     */
    if (isSlotTakenError(child.error)) {
      clashed.push(date);
      logger.warn(
        { proposalId: proposal.id, date },
        'A package date was taken between sending the quote and accepting it'
      );
      continue;
    }

    if (child.error || !child.data) {
      clashed.push(date);
      logger.error({ err: child.error, proposalId: proposal.id, date }, 'A package meeting failed');
      continue;
    }

    meetings.push(child.data.id);
  }

  logger.info(
    { proposalId: proposal.id, containerId, created: meetings.length, clashed: clashed.length },
    'Package meetings created'
  );

  return { container: containerId, created: meetings.length, meetings, clashed };
}

async function raiseInvoice(
  proposal: Proposal,
  amount: number,
  description: string,
  /**
   * The booking this money belongs to, where it is not the quote's own.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * A PACKAGE PAID UP FRONT bills the PURCHASE, so the invoice points at the
   * container. Everything that handles money afterwards works by `booking_id`:
   * `findSettledForBooking` is how a refund finds the payment, the webhook
   * syncs the booking's payment status by it, and the drawer groups by it. Left
   * pointing at the consultation the quote came out of — or at nothing, for a
   * quote sent cold — a package's payment could be taken and then not refunded
   * from anywhere the owner looks.
   * ───────────────────────────────────────────────────────────────────────────
   */
  bookingId?: string | null
): Promise<string | null> {
  try {
    // The terms this client agreed to, falling back to the business's default.
    const termsDays = await termsDaysFor(proposal);
    const { data: contact } = await crmContactRepository.findById(
      proposal.contact_id,
      proposal.user_id
    );

    const numberResult = await paymentInvoiceRepository.getNextInvoiceNumber(proposal.user_id);

    const { data, error } = await paymentInvoiceRepository.create({
      user_id: proposal.user_id,
      contact_id: proposal.contact_id,
      invoice_number: numberResult.data || `INV-${Date.now()}`,
      amount,
      currency: proposal.currency,
      /*
       * 'draft', not 'pending'.
       *
       * `payment_invoices_status_check` admits draft | sent | paid | overdue |
       * cancelled | refunded | partially_refunded, and 'pending' is not among
       * them — so EVERY invoice raised on acceptance was rejected by Postgres.
       * The client accepted, a payment plan was written, and no invoice ever
       * existed: nothing to pay, nothing to email, and no payment step in the
       * drawer. `sendInvoice` moves it to 'sent' when the mail goes out.
       */
      status: 'draft',
      line_items: [{ description, quantity: 1, unit_price: amount, amount }],
      /*
       * From the agreed terms, not a hardcoded fortnight.
       *
       * `due_date` decides when this turns overdue and when the reminder
       * service starts chasing — so a wrong one has the business dunning a
       * client who is paying exactly as agreed.
       */
      due_date: dueDateFromTerms(termsDays),
      payment_terms: termsValueForDays(termsDays),
      notes: null,
      internal_notes: null,
      sent_at: null,
      paid_at: null,
      client_name: contact
        ? [contact.first_name, contact.last_name].filter(Boolean).join(' ') || null
        : null,
      client_email: contact?.email || null,
      service_id: proposal.service_id,
      /*
       * The booking this money belongs to.
       *
       * Left null, the invoice floated free of the job: the refund flow looks
       * a transaction up by `booking_id`, the webhook updates the booking's
       * payment status by it, and the payments section groups by it. A quoted
       * job's deposit was invisible to all three — the money was real and none
       * of the machinery that handles money could see it.
       */
      booking_id: bookingId ?? proposal.booking_id,
      /*
       * This cast is why the failure was silent for so long.
       *
       * `as never` tells the compiler to stop checking the payload entirely, so
       * a status the database rejects looked fine at build time and failed only
       * at runtime — inside a try/catch that logged and returned null, which
       * the caller treated as "no invoice was needed".
       */
    } as never);

    if (error) throw error;
    const invoiceId = (data as { id: string }).id;

    /*
     * The reminders this invoice never had.
     *
     * Nothing on the acceptance path scheduled any, so the deposit a client
     * agreed to could pass its due date in silence and only be picked up once it
     * was already late — by the overdue scan, days later. `scheduleInvoiceReminders`
     * is what the booking path has always called for its own invoices; it writes
     * the `upcoming_due` and `due_today` rows the owner's `payment_reminder_days_before`
     * setting describes, and which had no effect on a quote until now.
     *
     * Here rather than at the two call sites: this function is the only place
     * that knows the invoice's due date, and both the single-payment quote and a
     * plan's first stage come through it.
     *
     * Non-blocking and swallowed. The acceptance is already committed and the
     * client already owes the deposit; a reminder that could not be scheduled is
     * not a reason to fail any of that.
     */
    if (proposal.contact_id) {
      /*
       * Imported here rather than at the top: the reminder service reaches the
       * PDF renderer, an ES-module package Jest cannot transform, and a static
       * import made this module unloadable in tests that only want `splitTotal`.
       */
      const { paymentReminderService } = await import('@/lib/services/PaymentReminderService');

      void paymentReminderService
        .scheduleInvoiceReminders(
          proposal.user_id,
          invoiceId,
          proposal.contact_id,
          dueDateFromTerms(termsDays)
        )
        .catch(err =>
          logger.warn(
            { err, proposalId: proposal.id, invoiceId },
            'Invoice raised but its reminders could not be scheduled'
          )
        );
    }

    return invoiceId;
  } catch (error) {
    logger.error({ err: error, proposalId: proposal.id }, 'Failed to raise the invoice');
    return null;
  }
}
