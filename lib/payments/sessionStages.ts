/**
 * A pay-as-you-go session and its payment stage, kept in step.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE INVARIANT, WHICH THE PRODUCT STATES AND NOTHING ENFORCED
 *
 * `packageSessionPayment` says it plainly: a `bill_per_session` package writes
 * "one row per meeting, written once when the quote is accepted". Every path
 * that adds a session LATER — a make-up, a replacement, a session added by
 * hand — then decides for itself whether to write a stage, and one of them
 * does not.
 *
 * Measured on a live package, 25 November 2026: twelve sessions, seven stages,
 * and the session on 29 December upcoming and scheduled with no stage at all.
 * $111.02 of agreed money was invisible to every figure the product shows —
 * the contact drawer, the money page and the reports all read stages, so all
 * three under-reported by the same amount and agreed with each other while
 * doing it.
 *
 * That is the hard kind of wrong: nothing contradicts anything, the owner has
 * no reason to doubt the number, and the money simply is not there.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT COUNTS AS LIVE, AND WHY `no_show` IS AMONG THEM
 *
 * A session is live while its money is still in question:
 *
 *   upcoming   it has not happened yet
 *   held       it happened and is billable
 *   no_show    the client missed it, and the owner may still charge for the
 *              hour they held — `setMeetingOutcome` leaves that open, and a
 *              stage voided here would decide it for them
 *
 * A `cancelled` session was called off and a `moved` one was superseded by a
 * later attempt which carries the money instead. Neither should hold a pending
 * stage, and a stage already paid is left alone whatever its session says: the
 * money arrived, and no reconciliation may unsay that.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS MODULE DECIDES AND DOES NOT WRITE
 *
 * The amount a new stage carries is `replacementStageOutlook`'s answer, and the
 * row is built by the route that has the plan, the label and the numbering. A
 * second place deciding what a session costs is the defect class that produced
 * two charges for one delivered hour.
 *
 * So this answers one question — which sessions are missing a stage, and which
 * stages outlived their session — and leaves every write to its owner.
 *
 * @module lib/payments/sessionStages
 */

/** The outcome a session carries. `null` is an hour still to come. */
export type SessionOutcome = string | null | undefined;

export interface SessionFact {
  id: string;
  meetingStatus: SessionOutcome;
  /**
   * The hour this session stands in for, when it is a make-up. Optional so a
   * caller that does not know it gets the old reading; `stageDrift` then
   * cannot see that an hour up the chain already carries the money.
   */
  replacesMeetingId?: string | null;
  /**
   * The owner's charge decision for this session (`scheduling_meetings.billable`).
   * `false` — given free, so no stage is owed whatever else is true. `true` —
   * charged, so a stage is owed and the inferences below do not apply. Null or
   * absent — never asked, and those inferences decide.
   */
  billable?: boolean | null;
}

/** How far up a chain of make-ups to walk — the same bound, for the same
    reason, as `replacementCharge.MAX_CHAIN`: a cycle must not spin for ever. */
const MAX_CHAIN = 10;

export interface StageFact {
  id: string;
  /** The session this stage bills, or null for a stage not tied to one. */
  meetingId: string | null;
  status: string;
  /** Set once the stage has been billed; such a stage is never touched. */
  invoiceId?: string | null;
}

/**
 * Is this session's money still an open question?
 *
 * See the note above on `no_show`: it is deliberately live. A missed hour the
 * owner is entitled to charge for must keep its stage until they say otherwise.
 */
export function isLiveSession(status: SessionOutcome): boolean {
  /*
   * Stated as what is SETTLED, not as a list of what is live.
   *
   * The first version enumerated the live ones — null, `held`, `no_show` — and
   * an outcome nobody had thought of therefore counted as settled. That is the
   * wrong default in both directions at once: a session in some new state
   * would be dropped from `missing`, so its money would go uncounted exactly
   * as the bug this module exists for, AND it would make any stage against it
   * look orphaned, inviting a void of live money.
   *
   * Only two outcomes end a session's claim on money: it was called off, or a
   * later attempt superseded it. Everything else is still open, including
   * whatever gets added next.
   */
  return status !== 'cancelled' && status !== 'moved';
}

/** A stage that still represents money, as opposed to one called off. */
export function stageStillStands(stage: StageFact): boolean {
  return stage.status !== 'cancelled';
}

export interface StageDrift {
  /** Live sessions carrying no stage — agreed money nothing is counting. */
  missing: SessionFact[];
  /**
   * Stages still standing against a session that was called off or superseded.
   *
   * Reported but NOT acted on by the caller without thought: a stage that has
   * been paid is money that arrived, and voiding it would erase a payment
   * rather than correct a schedule.
   */
  orphaned: StageFact[];
}

/**
 * Where the sessions and the stages have come apart.
 *
 * Both directions, because they fail differently and only one of them is
 * visible: a missing stage UNDER-reports and nothing on screen disagrees, while
 * an orphaned stage over-reports and tends to be noticed by the client.
 */
export function stageDrift(sessions: SessionFact[], stages: StageFact[]): StageDrift {
  const standingBySession = new Map<string, StageFact>();
  for (const stage of stages) {
    if (!stage.meetingId) continue;
    if (!stageStillStands(stage)) continue;
    standingBySession.set(stage.meetingId, stage);
  }

  const sessionById = new Map(sessions.map(session => [session.id, session]));

  /* Sessions with a VOIDED stage — read below only for a missed hour. */
  const voidedSessions = new Set<string>();
  for (const stage of stages) {
    if (stage.meetingId && !stageStillStands(stage)) voidedSessions.add(stage.meetingId);
  }

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * TWO LIVE SESSIONS THAT ARE NOT OWED A STAGE.
   *
   * Measured on a live package, 27 November 2026 (8b74f5c0): the owner marked
   * session 2 a no-show and WAIVED it — its stage went to `cancelled` exactly
   * as `setMeetingOutcome` intends — and let the client book the replacement.
   * The make-up path billed the replacement, correctly, and then ran this
   * reconciler, which saw a live `no_show` with no standing stage and wrote it
   * a fresh $111.02. The waiver was undone thirty-four seconds after it was
   * given, and the drawer went on showing the missed hour as owed.
   *
   * Session 1 of the same package showed the mirror image: missed and CHARGED,
   * its make-up deliberately given no stage by `chargeIfSoldPerSession` — and
   * this reconciler gave it one. Two charges, one delivered hour: the defect
   * `replacementCharge` was written to stop, reintroduced one call later.
   *
   *   WAIVED       a `no_show` whose stage was voided. Voiding it IS the
   *                owner's answer to the one open question about a missed
   *                hour. Only a no-show: on an hour still to come a voided
   *                stage proves nothing (it may have been rebooked), which is
   *                the case the existing test pins.
   *
   *   PAID UP THE CHAIN   a make-up whose replaced hour, or any hour above
   *                it, holds a standing stage. That money already covers this
   *                hour — the same ancestor rule `replacedHourAlreadyPaid`
   *                applies when the make-up is booked, so the two cannot
   *                disagree.
   *
   * Both only stop a stage being CREATED. Nothing here voids anything.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const waived = (session: SessionFact) =>
    session.meetingStatus === 'no_show' && voidedSessions.has(session.id);

  const paidUpTheChain = (session: SessionFact): boolean => {
    const seen = new Set<string>([session.id]);
    let ancestorId = session.replacesMeetingId ?? null;

    for (let hops = 0; ancestorId && hops < MAX_CHAIN; hops += 1) {
      /* A cycle: the safe answer is "covered", because creating money on a
         guess is the direction that reaches the client. */
      if (seen.has(ancestorId)) return true;
      seen.add(ancestorId);

      if (standingBySession.has(ancestorId)) return true;
      ancestorId = sessionById.get(ancestorId)?.replacesMeetingId ?? null;
    }

    /* Ran out of chain without finding money, or hit the bound. The bound is
       treated as covered for the same reason as the cycle. */
    return Boolean(ancestorId);
  };

  /*
   * ── AND THE OWNER'S OWN ANSWER OUTRANKS BOTH ────────────────────────────────
   *
   * The two rules above are inferences, made because nobody recorded what the
   * owner chose. Where they did choose (`billable`), that is the answer: a
   * session added "free of charge" was being billed by this very function the
   * moment its route finished, and a make-up the owner chose to charge after a
   * charged no-show would read as "paid up the chain" and never be billed.
   */
  const owed = (session: SessionFact): boolean => {
    if (session.billable === false) return false;
    if (session.billable === true) return true;
    return !waived(session) && !paidUpTheChain(session);
  };

  const missing = sessions.filter(
    session =>
      isLiveSession(session.meetingStatus) &&
      !standingBySession.has(session.id) &&
      owed(session)
  );

  const orphaned = [...standingBySession.values()].filter(stage => {
    /* Billed already: the invoice is the debt now, and this stage is its
       schedule. Out of scope either way. */
    if (stage.invoiceId) return false;

    const session = stage.meetingId ? sessionById.get(stage.meetingId) : undefined;
    /* A stage whose session is not in the set at all is left alone: the caller
       may simply have loaded a window of sessions, and guessing would void a
       live one. */
    if (!session) return false;

    return !isLiveSession(session.meetingStatus);
  });

  return { missing, orphaned };
}

/**
 * Does this package's money account for every session it has?
 *
 * The one-line form, for a caller that wants to log or assert rather than
 * repair. True means every live session is represented and no called-off one
 * is still being charged for.
 */
export function stagesMatchSessions(sessions: SessionFact[], stages: StageFact[]): boolean {
  const drift = stageDrift(sessions, stages);

  return drift.missing.length === 0 && drift.orphaned.length === 0;
}

/**
 * What to call the stage that bills session `sessionNumber`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * It lived in TWO files — `makeUpSession` and the package-meetings route — with
 * the same signature and the same regex, and the copies had already drifted:
 * one carried the note explaining why the trailing group matters and the other
 * did not. That note is the whole subtlety, so the copy without it was one edit
 * away from being "simplified" into a bug.
 *
 * Brought here beside the invariant it serves, because the reconciler below
 * needs it too and a THIRD copy is how a rule stops being a rule.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function nextStageLabel(
  previousLabel: string | null,
  sessionNumber: number,
  quoteTitle: string
): string {
  if (!previousLabel) return `${quoteTitle} (${sessionNumber})`;

  /*
   * The last number in the label is the part that moves; whatever sits either
   * side of it is the name the owner chose and is kept exactly.
   *
   * The suffix group is not cosmetic. Labels written as "Package (13)" end in a
   * bracket, so a pattern anchored on the digits alone matches nothing — and
   * this function would hand back the previous label verbatim, putting the same
   * name on two stages, which is worse than the mismatch it set out to fix.
   */
  const trailing = previousLabel.match(/^(.*?)(\d+)(\D*)$/);
  if (trailing) return `${trailing[1]}${sessionNumber}${trailing[3]}`;

  /* Named without a number — "On completion" — so numbering it would invent a
     sequence that is not there. */
  return previousLabel;
}
