/**
 * What does this booking need from its owner, right now?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE QUESTION NOTHING WAS ANSWERING
 *
 * A booking is a container for its layers — the meeting (one, or many in a
 * package), the money, the intake form, and on a quoted service the proposal.
 * Each layer knew its own state. Nothing said which of them the OWNER had to
 * act on, so the drawer showed a record to inspect rather than a job to work,
 * and an owner had to already know that marking the meeting held is what opens
 * the quote step.
 *
 * This answers it once. Four surfaces read it:
 *
 *   · the card's header badge        — what this booking is waiting for
 *   · whether the card opens itself  — only when the ball is in your court
 *   · which stage is lit on the rail — and which are still closed
 *   · where the booking sorts        — your queue, before everything else
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY ONE FUNCTION AND NOT FOUR
 *
 * Every bug this module was written out of is the same disease: one question
 * answered independently in several places, which then drift.
 *
 *   · `jobIsOver` and `quoteGate` both asked "is this job off". One was given
 *     the full answer when cancelling stopped writing `cancelled`; the other
 *     was not, so its `closed` branch became unreachable and the create-quote
 *     button survived a cancellation. Three production rows reproduce it.
 *   · The header badge read `status.confirmed` — "מאושרת", approved — while the
 *     code's own comment and English fallback both said "Upcoming". Nothing had
 *     been approved; a client had asked for a price.
 *
 * Nobody re-derives this. A surface needing a different slice gets a field
 * added here, never its own copy.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EVERY SERVICE SHAPE GOES THROUGH IT
 *
 * One account's catalogue already spans six, and they differ in which layers
 * exist at all:
 *
 *   free + scheduled      a meeting, no money      (פגישת היכרות, price 0)
 *   invoice + scheduled   a meeting, then billing  (ייעוץ אישי)
 *   card + unscheduled    money only, no meeting   (קורס קשב)
 *   instalments           money that arrives over months
 *   quoted + scheduled    meeting → quote → money  (הצעת מחיר לשיפוץ)
 *   package               MANY meetings under one agreement
 *
 * So the money is a STATE, never a `paid` boolean: "nothing to collect" and
 * "waiting for the client to pay the link" and "you have not raised the
 * invoice yet" are three different answers, and only one of them is a task.
 * Collapsing them is how a free intro meeting came to be chased for payment.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT DECIDES NOTHING ABOUT THE MEETING ITSELF
 *
 * `quoteGate` already owns the clock rules, which took two bugs to get right —
 * a meeting is `unmarked` rather than held once its time passes, because owners
 * quote from the van and rarely tick an appointment first. This calls it, and
 * every journey below reuses those states, so no second "has the meeting
 * happened" rule can be written for the direct path.
 *
 * @module lib/business-os/bookingNextStep
 */

import { jobCalledOff, type BookingFacts } from './bookingStatus';
import { quoteGate } from './quoteGate';

/**
 * Who the booking is waiting on.
 *
 * `owner` and `client` are the load-bearing pair: one is a task, the other is
 * permission to stop checking, and today they look identical on the card.
 */
export type WhoseMove = 'owner' | 'client' | 'nobody';

/** The journey stage this concerns. Matches `BookingJourneyStep.key`. */
export type NextStepStage =
  | 'session'
  | 'intake'
  | 'proposal'
  | 'payment'
  /**
   * HANDING OVER a service that has no appointment.
   *
   * A course, a gym block, a training package: the client buys it and there is
   * no hour to attend, so the journey draws a delivery step instead of a
   * meeting. Fourteen of this account's dateless bookings have been ticked
   * that way, so it is a real act the owner performs — but nothing ever asked
   * them to. The money arriving ended the journey, the card said "all done",
   * and the delivery step sat open underneath it with no way to close it.
   */
  | 'fulfillment'
  | 'done';

/**
 * An action the card may offer. Names an INTENT, never a button.
 *
 * Abstract so the banner and the stage row can offer the same action without
 * one of them owning the other's markup.
 */
export type NextStepAction =
  | 'mark_held'
  | 'mark_no_show'
  | 'reschedule'
  | 'send_intake'
  | 'create_quote'
  | 'remind_quote'
  | 'send_invoice'
  | 'bill_next_stage'
  | 'remind_payment'
  /**
   * Arrange ANOTHER appointment, as opposed to moving the one that failed.
   *
   * `reschedule` edits the booking's own time, which is the right move while
   * an appointment is still live and the wrong one once it is settled: a
   * missed or called-off row is a record of what happened, and dragging it to
   * a new date rewrites that instead of arranging anything. The meeting step
   * has always drawn this distinction; the banner did not, and offered to
   * move a dead appointment from two inches above the control that refuses
   * to.
   */
  | 'new_meeting'
  /**
   * The service has been handed over.
   *
   * Deliberately not `mark_held`, which is about an appointment somebody
   * attended. Nobody attends a course; it is given, and the word on the button
   * has to match what the owner actually did or they will hesitate over it.
   */
  | 'mark_delivered'
  /* Close the whole job. The only action here that ENDS something, and it is
     offered in exactly one state: the owner has said no quote is coming, so
     the booking is open work nobody will ever bill for. */
  | 'cancel_booking';

/**
 * Where the money stands. Not a boolean, and the distinctions are load-bearing.
 *
 *   · `nothing_to_collect` — free, or a price of zero. A task list that chases
 *     these is a task list an owner stops reading.
 *   · `needs_invoice` — the work is done and nobody has asked for the money.
 *     The single most recoverable thing on the dashboard, and the owner's move.
 *   · `with_client` — a link or an invoice is out. Not a task.
 *   · `plan_auto` — instalments collect themselves. Not a task either.
 *   · `plan_needs_billing` — the next stage of a plan is manual and due.
 */
export type MoneyState =
  | 'nothing_to_collect'
  | 'paid'
  | 'needs_invoice'
  | 'with_client'
  | 'plan_auto'
  | 'plan_needs_billing';

/**
 * The intake form, which is a real PRE-meeting task and the only one.
 *
 * `not_used` covers every service without a form, which is most of them.
 */
export type IntakeState = 'not_used' | 'not_sent' | 'sent_unanswered' | 'answered';

/** A package's meetings, counted. Absent for an ordinary booking. */
export interface PackageProgress {
  total: number;
  /** Held, missed or called off: an outcome is recorded. */
  settled: number;
}

export interface NextStep {
  stage: NextStepStage;
  whoseMove: WhoseMove;
  /** Translation key for the one line the owner reads. */
  labelKey: string;
  /** What to offer, in the order to offer it. Empty when there is nothing to do. */
  actions: NextStepAction[];
  /**
   * Something true worth knowing here, which is NOT the state and NOT a task.
   *
   * Kept apart from `labelKey` because that key is read twice — as the banner's
   * sentence and as the header's badge through `crm.next.badge.<state>` — so
   * anything folded into it becomes a status whether or not it is one. The card
   * renders this separately and lets the owner dismiss it.
   */
  notice?: string;
}

export interface NextStepInput {
  booking: BookingFacts;
  /** The consultation's start, or null where the service books no time. */
  startTime: Date | null;
  /** A service bought rather than booked has no meeting to wait for. */
  isUnscheduled: boolean;
  /** `scheduling_services.sale_mode === 'proposal'`. */
  isQuoted: boolean;
  /** The live proposal's status, or null when none stands. */
  proposalStatus?: string | null;
  money: MoneyState;
  /**
   * Money arrived and has not gone back.
   *
   * Separate from `money` because that reports the state of the SCHEDULE and
   * this reports the balance: after a stop, "every stage is settled" is equally
   * true of a quote whose deposit was banked and one where every stage was
   * cancelled uncollected. Only used to decide whether a stopped job's line
   * mentions a refund, so leaving it out keeps the line it always had.
   */
  moneyInHand?: boolean;
  /** Defaults to `not_used`: most services have no form. */
  intake?: IntakeState;
  /**
   * The plan was stopped part-way: at least one period was CANCELLED rather
   * than paid.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * `money` cannot carry this. A cancelled period counts as settled on purpose
   * — nothing more will be collected from it — so a plan stopped half way and
   * a plan paid in full both arrive here as `'paid'`. That is right for the
   * money and wrong for the next move: one is a finished sale, the other is an
   * arrangement somebody ended.
   *
   * It only ever matters where the service has not been handed over. A stopped
   * plan on a delivered job is simply done.
   * ───────────────────────────────────────────────────────────────────────────
   */
  planStopped?: boolean;
  /** A package's meetings. Absent for an ordinary booking. */
  packageProgress?: PackageProgress | null;
  /**
   * Who moved the appointment to the time it now has (`moved_by`, 20261082).
   *
   * Only ever changes the line that would otherwise read "the meeting is still
   * ahead" — a line with nothing in it. A client moving the meeting themselves
   * is the one thing about a booking an owner can miss entirely: the status
   * does not change, the date silently becomes a different date, and the card
   * went on saying the same sentence as before.
   *
   * Null or `'owner'` leaves every answer exactly as it was.
   */
  lastMoveBy?: 'owner' | 'client' | 'system' | null;
  /**
   * Who recorded the meeting's outcome (`outcome_by`, 20261078).
   *
   * Read only to tell a cancellation the CLIENT made from one the owner made.
   * The two are the same row and the same status, and they mean opposite
   * things to the person reading the card.
   */
  outcomeBy?: 'owner' | 'client' | 'system' | null;
  /**
   * The owner's answer when the meeting was called off (`proposal_continues`,
   * 20261083): is the quote still coming?
   *
   * NULL is "nobody was asked", which is not the same as yes and must not be
   * treated as one. Only `false` changes anything here.
   */
  proposalContinues?: boolean | null;
  /** Injected so the states are testable without faking the clock. */
  now?: Date;
}

const DONE: NextStep = { stage: 'done', whoseMove: 'nobody', labelKey: 'next.done', actions: [] };

/**
 * Still to hand over, when there is no appointment to attend.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Sits between the money and DONE, and only for a dateless service. The money
 * being in says the client has paid; it does not say they have been given what
 * they paid for, and for a course or a block of sessions those are different
 * days.
 *
 * The journey has always DRAWN this step — `fulfillment` where a scheduled
 * service gets `session` — and the owner has ticked it fourteen times. What was
 * missing is that nothing asked. `moneyStep` returned DONE the moment the money
 * landed, so the badge read "הכול הושלם" directly above a step that was still
 * open, and the controls that could close it were wired to the meeting step,
 * which a product never has.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const DELIVER: NextStep = {
  stage: 'fulfillment',
  whoseMove: 'owner',
  labelKey: 'next.deliver',
  actions: ['mark_delivered'],
};

/**
 * The plan was stopped and the service was never handed over.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO ENDINGS, AND THE PRODUCT CANNOT KNOW WHICH
 *
 * Stopping the billing does not say what happens to the work. An owner who
 * collected ₪400 of ₪800, returned ₪200 and cancelled the rest may still mean
 * to deliver for what they kept, or may have ended the engagement. Both are
 * ordinary, and nothing in the data distinguishes them.
 *
 * So this ASKS. It is the same judgement `close_the_booking` makes a few
 * branches down: closing a job cascades through the meeting, the quote and the
 * money, and that is the owner's decision to take deliberately — the card's
 * job is only to make sure they know they have one.
 *
 * What it replaces was worse than silence. `DELIVER` presumed the work was
 * still coming and offered one button, "mark as provided", so the only move the
 * card offered on an abandoned job was to record a delivery that never
 * happened — which then counts as fulfilled revenue in every report that reads
 * it.
 *
 * `mark_delivered` stays FIRST: a plan is usually stopped because the client
 * stopped paying, not because the work was abandoned, and the owner who kept
 * money for work they did should not have to hunt for the button.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const PLAN_STOPPED_UNDELIVERED: NextStep = {
  stage: 'fulfillment',
  whoseMove: 'owner',
  labelKey: 'next.plan_stopped_undelivered',
  actions: ['mark_delivered', 'cancel_booking'],
};

/**
 * The money, once every other layer is settled. Shared by all four journeys.
 *
 * `delivered` says whether the handover still has to be recorded. It is false
 * for every scheduled service — those end at their meeting, not at a delivery —
 * so only a dateless one can reach `DELIVER`.
 */
function moneyStep(money: MoneyState, awaitingDelivery = false, planStopped = false): NextStep {
  switch (money) {
    case 'nothing_to_collect':
    case 'paid':
      if (!awaitingDelivery) return DONE;
      /* Settled because it was stopped is not settled because it was paid. */
      return planStopped ? PLAN_STOPPED_UNDELIVERED : DELIVER;

    case 'needs_invoice':
      return {
        stage: 'payment',
        whoseMove: 'owner',
        labelKey: 'next.send_invoice',
        actions: ['send_invoice'],
      };

    case 'plan_needs_billing':
      return {
        stage: 'payment',
        whoseMove: 'owner',
        labelKey: 'next.bill_next_stage',
        actions: ['bill_next_stage'],
      };

    /*
     * Out with the client, by link, invoice or standing instalment. A reminder
     * is offered because chasing is legitimate; it is not a task the card
     * should put in front of the owner unasked.
     */
    case 'with_client':
      return {
        stage: 'payment',
        whoseMove: 'client',
        labelKey: 'next.awaiting_payment',
        actions: ['remind_payment'],
      };

    case 'plan_auto':
      return {
        stage: 'payment',
        whoseMove: 'client',
        labelKey: 'next.plan_running',
        actions: [],
      };
  }
}

export function bookingNextStep(input: NextStepInput): NextStep {
  const {
    booking,
    startTime,
    isUnscheduled,
    isQuoted,
    proposalStatus,
    money,
    packageProgress,
  } = input;
  const intake = input.intake ?? 'not_used';
  const now = input.now ?? new Date();
  const planStopped = input.planStopped ?? false;

  /*
   * Called off beats everything, including money outstanding. A stopped job
   * does not ask the owner for anything; what it needs is a refund decision,
   * which is a different screen's business.
   */
  if (jobCalledOff(booking)) {
    return { stage: 'done', whoseMove: 'nobody', labelKey: 'next.called_off', actions: [] };
  }

  /*
   * ── THE CLIENT CALLED THE MEETING OFF ───────────────────────────────────
   *
   * `quoteGate` answers `'open'` for a cancelled meeting, which is right — the
   * quote can go out without one — but it means the card moved straight on to
   * "write a quote" and never said the appointment had gone. The owner could
   * have a cleared hour and a client who has withdrawn, and read neither.
   *
   * Only for the CLIENT's cancellation. The owner cancelling it already knows,
   * and an alert telling somebody what they just did is noise.
   *
   * `reschedule` rather than nothing, so the banner carries a way out: the
   * usual answer to a client calling off is to offer another time.
   */
  /*
   * ── NO QUOTE IS COMING, AND THE JOB IS STILL OPEN ───────────────────────
   *
   * The owner answered "the quote is not going ahead" when they cancelled the
   * meeting. The appointment was recorded as off and nothing else moved, so
   * the booking sits in the list as live work that will never be quoted for,
   * never billed, and never closed.
   *
   * Above the client-cancellation notice and above the gate, because it
   * outranks both: a booking that should not exist does not need a reminder
   * about who moved its meeting, and the quote states below are all about a
   * quote the owner has just said is not coming.
   *
   * It asks rather than acting. Closing a job cascades through the meeting,
   * the quote and the money, and that is the owner's decision to take
   * deliberately — this only makes sure they are not left unaware they have
   * one to take.
   */
  if (booking.meeting_status === 'cancelled' && input.proposalContinues === false) {
    return {
      stage: 'session',
      whoseMove: 'owner',
      labelKey: 'next.close_the_booking',
      actions: ['cancel_booking'],
    };
  }

  if (
    booking.meeting_status === 'cancelled' &&
    input.outcomeBy === 'client' &&
    /*
     * ── AND ONLY WHILE NOTHING HAS MOVED PAST IT ────────────────────────────
     * Without this the notice is permanent: `meeting_status` stays
     * `'cancelled'` for good, so the card would still be announcing the
     * cancellation after the owner had written, sent and been paid for the
     * quote — and the quote's own states could never be reached, because this
     * sits in front of the gate that produces them.
     *
     * A quote existing IS the owner having moved on. There is still no "seen"
     * flag, so the notice stands until something happens; what this fixes is
     * it standing after something has.
     */
    !proposalStatus
  ) {
    return {
      stage: 'session',
      whoseMove: 'owner',
      labelKey: 'next.client_cancelled_meeting',
      /* Another appointment, not a move of the one they called off — the
         same rule the meeting step applies to a cancelled row. */
      actions: ['new_meeting'],
    };
  }

  const gate = quoteGate({
    bookingStatus: booking.status,
    calledOff: false, // answered above
    meetingStatus: booking.meeting_status,
    startTime,
    isUnscheduled,
    proposalStatus: proposalStatus ?? null,
    now,
  });

  if (gate === 'closed') {
    /*
     * ── STOPPED IS AN ENDING, NOT A COMPLETION ────────────────────────────
     *
     * `quoteGate` answers `'closed'` for two different things: the job was
     * called off, or the quote was stopped. Both mean "nothing more to send",
     * which is what that gate is for — and returning DONE for either made the
     * card say "הכול הושלם", everything completed, over work the owner had
     * just abandoned halfway.
     *
     * Seen on a 9,500 quote: deposit collected, the completion stage
     * cancelled, the quote stopped, and the header reporting success.
     *
     * A called-off JOB never reaches here — `jobCalledOff` answers it at the
     * top — so the only reason to be here other than a genuine finish is a
     * stopped quote, and it says so.
     */
    if (proposalStatus === 'stopped') {
      return {
        stage: 'proposal',
        /*
         * And it leaves something to do. Stopping the quote deliberately
         * touches no booking — that separation is the point — so the booking
         * stays `confirmed` and sits in the list as live work that will never
         * proceed. The same shape as an owner answering that no quote is
         * coming, and the same answer: offer to close it.
         *
         * Money already collected is NOT settled by closing it. A deposit
         * taken for work that stopped is a refund decision, and
         * `CashCancelledUnrefundedDetector` is what raises that — this only
         * stops the booking pretending to be live.
         */
        whoseMove: 'owner',
        labelKey: 'next.quote_stopped',
        actions: ['cancel_booking'],
        /*
         * AND A SEPARATE WORD ABOUT THE MONEY, WHICH IS NOT A STATUS.
         *
         * The note above is still true — closing the booking settles nothing
         * financial, and `CashCancelledUnrefundedDetector` is what chases an
         * unrefunded balance. But the detector raises an insight somewhere
         * else, later, and the owner deciding to stop this job is holding the
         * client's deposit at this exact moment, on this card.
         *
         * It is a `notice` rather than part of `labelKey` because the two are
         * read in different places. `labelKey` is ALSO the header's badge, via
         * `crm.next.badge.<state>`, so putting the money in it printed a full
         * sentence where a one-word state belongs and then printed it again in
         * the banner underneath. The owner's own words: "what you added is not
         * a status".
         *
         * A reminder, not an action, and dismissible. Whether a refund is owed
         * depends on what was agreed and how much work was done, and the card
         * knows neither — so it names the fact, leaves the judgement, and lets
         * the owner close it once they have made it.
         */
        notice: input.moneyInHand ? 'next.notice.money_in_hand' : undefined,
      };
    }
    return DONE;
  }

  /* ── THE MEETING, AND THE ONE TASK THAT COMES BEFORE IT ───────────────── */

  if (gate === 'ahead') {
    /*
     * The form has to be answered BEFORE the meeting to be worth anything, so
     * it is the only thing that can be owed while the meeting is still ahead.
     * Without this the card says "nothing to do" at the one moment sending it
     * still helps.
     */
    /*
     * ── THE CLIENT MOVED IT, AND NOTHING SAID SO ────────────────────────────
     *
     * Above the intake form deliberately, and it is the only branch here that
     * outranks a task. A client rebooking themselves changes WHEN THE OWNER
     * HAS TO BE SOMEWHERE: the status does not move, the hour silently becomes
     * a different hour, and the card went on saying "the meeting is still
     * ahead" exactly as before. An unsent intake form can wait a day; a clash
     * in the owner's calendar cannot.
     *
     * `reschedule` so the banner is not a dead end. The usual answer is to
     * accept the new time, which costs nothing and needs no button — the
     * button is for the case where it does not suit.
     */
    if (input.lastMoveBy === 'client') {
      return {
        stage: 'session',
        whoseMove: 'owner',
        labelKey: 'next.client_moved_meeting',
        actions: ['reschedule'],
      };
    }
    if (intake === 'not_sent') {
      return {
        stage: 'intake',
        whoseMove: 'owner',
        labelKey: 'next.send_intake',
        actions: ['send_intake'],
      };
    }
    if (intake === 'sent_unanswered') {
      return { stage: 'intake', whoseMove: 'client', labelKey: 'next.intake_sent', actions: [] };
    }
    return { stage: 'session', whoseMove: 'nobody', labelKey: 'next.meeting_ahead', actions: [] };
  }

  if (gate === 'unmarked') {
    /*
     * Its time has passed and nobody has said what happened. The one moment the
     * card genuinely has to interrupt: every stage below waits on an answer
     * only the owner has.
     */
    /*
     * RESCHEDULE IS A THIRD ANSWER, NOT AN AFTERTHOUGHT.
     *
     * It was left out on the reasoning that the banner asks "what happened?"
     * and moving the date is not an answer to that — it is what you do once
     * you have said no-show.
     *
     * That is wrong about the common case. A meeting that did not happen
     * BECAUSE IT MOVED is ordinary, and without this the owner has to first
     * record something untrue — a no-show against a client who did nothing
     * wrong, on that client's own timeline — before being offered the thing
     * they actually wanted. The stage below already offers all three, so
     * leaving it out here also made one moment ask two different questions.
     */
    return {
      stage: 'session',
      whoseMove: 'owner',
      labelKey: 'next.mark_meeting',
      actions: ['mark_held', 'mark_no_show', 'reschedule'],
    };
  }

  if (gate === 'missed') {
    /*
     * ─────────────────────────────────────────────────────────────────────
     * MISSED IS NOT OVER, AND THE PRICE MAY STILL BE WANTED.
     *
     * Offering only "another time" assumed the quote depends on the meeting
     * having happened. It often does not: the owner may have spoken to the
     * client by phone, or seen the job already, and a missed site visit does
     * not stop them pricing it. Reported as "the meeting maybe wasn't held
     * but the user might want to proceed with the proposal".
     *
     * The proposal STAGE already allowed this — `quoteWaitingOn('missed')`
     * returns `noshow`, which the drawer treats as a state where Send a quote
     * stays reachable. Only this banner was narrower, so one moment offered
     * two different sets of choices depending on where the owner looked.
     *
     * A new time still comes first: it is the common answer, and it is the
     * one that costs nothing if it turns out to be wrong.
     *
     * `gate === 'missed'` already implies no quote exists — `quoteGate`
     * returns `open` the moment one does — so this cannot offer to write a
     * second one over a live offer.
     * ─────────────────────────────────────────────────────────────────────
     */
    /*
     * ─────────────────────────────────────────────────────────────────────
     * AND IT MAY BE OVER, WHICH NOTHING HERE COULD SAY.
     *
     * Both answers above continue the job. A client who did not turn up and
     * does not answer is the other ending, and the banner offered no way to
     * reach it — the owner had to know the red control was further down the
     * card, under a booking the banner was still describing as live.
     *
     * Deliberately NOT inferred from the no-show itself. Missing one meeting
     * is not withdrawal, which is the whole reason the quote stays on offer
     * beside it; this only makes the ending reachable from the same place as
     * the alternatives.
     *
     * Order is the recommendation: another time first because it costs
     * nothing if wrong, the quote second because a missed site visit often
     * does not stop a price being given, and ending it last.
     * ─────────────────────────────────────────────────────────────────────
     */
    return {
      stage: 'session',
      whoseMove: 'owner',
      labelKey: 'next.missed',
      actions: isQuoted
        ? ['new_meeting', 'create_quote', 'cancel_booking']
        : ['new_meeting', 'cancel_booking'],
    };
  }

  /* ── gate === 'open': the meeting is behind us, or there never was one ── */

  /*
   * A PACKAGE IS NOT FINISHED BECAUSE ITS FIRST MEETING WAS.
   *
   * The container's remaining meetings are the work itself, and each child row
   * carries its own actions. Reported as a package reading like two jobs; this
   * keeps the parent describing the block rather than the session just held.
   *
   * Checked before the quote: a package only exists once its quote was
   * accepted, so asking about the proposal again here would be asking about a
   * question already answered.
   */
  if (packageProgress && packageProgress.settled < packageProgress.total) {
    return {
      stage: 'session',
      whoseMove: 'nobody',
      labelKey: 'next.package_running',
      actions: [],
    };
  }

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * A dateless service nobody has marked handed over yet.
   *
   * THE TEST IS `meeting_status`, NOT `status`. Marking a booking complete
   * writes `meeting_status: 'held'` and deliberately leaves `status` alone —
   * that separation is the whole point of the outcome column, and `status`
   * stays `confirmed` for ever on a booking that was completed today.
   *
   * Testing `status === 'completed'` therefore never went false: the owner
   * pressed "סמן שסופק", the step turned green off `meeting_status`, and the
   * banner went on asking for the same thing directly above it.
   *
   * This is the same pair the journey step reads, in the same order, so the
   * two cannot disagree: `held` closes it, and a row predating the split
   * closes on `status` only while `meeting_status` is still null.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const delivered =
    booking.meeting_status === 'held' ||
    (booking.meeting_status == null && booking.status === 'completed');

  const awaitingDelivery = Boolean(isUnscheduled) && !delivered;

  if (!isQuoted) {
    // A direct sale has no quote to write; what is left is the money.
    return moneyStep(money, awaitingDelivery, planStopped);
  }

  switch (proposalStatus ?? 'none') {
    case 'none':
      return {
        stage: 'proposal',
        whoseMove: 'owner',
        labelKey: 'next.create_quote',
        actions: ['create_quote'],
      };

    /*
     * With the client, and saying so is the point. An owner who cannot tell
     * "they have not answered" from "you have not sent it" checks the same
     * booking every day.
     */
    case 'sent':
    case 'viewed':
      return {
        stage: 'proposal',
        whoseMove: 'client',
        labelKey: 'next.quote_with_client',
        actions: ['remind_quote'],
      };

    /*
     * A refused price is the start of a negotiation, not the end of the job —
     * the same reading `quoteWaitingOn` already takes.
     */
    case 'declined':
    case 'expired':
      return {
        stage: 'proposal',
        whoseMove: 'owner',
        labelKey: 'next.quote_refused',
        actions: ['create_quote'],
      };

    case 'accepted':
      return moneyStep(money, awaitingDelivery, planStopped);

    /*
     * `stopped` is handled by `quoteGate` as `closed` above and cannot reach
     * here. `draft` and `superseded` are dropped upstream. Anything else is a
     * status nobody has decided the meaning of, and the honest answer is to
     * claim nothing: inventing a next step for an unknown state is how
     * `stopped` once told an owner to quote a job they had just stopped.
     */
    default:
      return { stage: 'proposal', whoseMove: 'nobody', labelKey: 'next.unknown', actions: [] };
  }
}

/** Does the card open itself? Only when something is actually being asked of the owner. */
export function opensItself(step: NextStep): boolean {
  return step.whoseMove === 'owner';
}
