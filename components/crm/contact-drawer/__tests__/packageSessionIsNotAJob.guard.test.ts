/**
 * A package's meeting is not a job waiting for a quote.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE OWNER SAW
 *
 * A client accepted a six-session package. The drawer then drew SIX client
 * journeys, one per meeting, each with a quote step reading "the quote will be
 * sent after the meeting" — about meetings that quote had already created, sold
 * and billed. Six jobs where there was one.
 *
 * THE CAUSE is that `sale_mode: 'proposal'` is a fact about the SERVICE, and a
 * package is sold through exactly such a service. Every reader that asked the
 * service "is this quoted?" got yes for each session.
 *
 * The right question is about the BOOKING: a session has a parent, and what a
 * quote produced is not something a quote is still owed for. `isQuotedJob`
 * asks it in one place, and this reads the source to keep it that way — the
 * drawer builds its cards twice, in two code paths, and the first version of
 * this fix only corrected one of them.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const drawer = readFileSync(
  join(process.cwd(), 'components', 'crm', 'contact-drawer', 'CRMContactDrawerV2.tsx'),
  'utf8'
);

describe('the predicate', () => {
  it('asks the booking, not only the service', () => {
    expect(drawer).toContain('function isQuotedJob');
    expect(drawer).toContain("booking.service?.sale_mode === 'proposal' && !booking.parent_booking_id");
  });

  it('is what the journey builder uses', () => {
    expect(drawer).toContain('const isQuotedBooking = isQuotedJob(booking);');
  });
});

describe('every place a quote is attached to a booking', () => {
  /*
   * The bare service test, which is the bug. One remaining occurrence is the
   * predicate's own body; anything beyond that is a reader that will hand a
   * package session a quote step again.
   */
  it('goes through the predicate', () => {
    const bare = drawer.split("service?.sale_mode === 'proposal'").length - 1;
    expect(bare).toBe(1);
  });

  it('covers both of the drawer’s card-building paths', () => {
    // `proposalsList` is the first pass, `freshProposals` the refetch. The fix
    // landed on one of them first, which is exactly how half a bug survives.
    expect(drawer).toContain('isQuotedJob(bookingWithService)');
    expect(drawer).toContain('isQuotedJob(booking as BookingWithService)');
  });
});

describe('the card itself', () => {
  const tab = readFileSync(
    join(process.cwd(), 'components', 'crm', 'contact-drawer', 'BookingsTab.tsx'),
    'utf8'
  );

  it('does not label a package session with the quoting vocabulary', () => {
    // The drawer's fix did not reach here: this component asks the same
    // question again for the status badge and the action strip's wording.
    expect(tab).toContain("booking.service?.sale_mode === 'proposal' && !booking.parent_booking_id");
  });

  it('renders the meetings as a STEP of the journey', () => {
    /*
     * Not a panel beside it: every booking with a parent belongs to the quote
     * that sold it, so its meetings are a stage on that client's journey. A
     * card of their own is what made one package look like two jobs, the
     * second asking for a quote the first had already agreed.
     */
    expect(tab).toContain("step.key === 'package' && session.meetings");
  });

  it('gives each meeting its own actions, against its own id', () => {
    /*
     * One journey, but six real appointments: each can be held, missed, moved
     * or called off alone, and for a per-session package marking one held is
     * what invoices it.
     *
     * The three outcomes used to be three literal calls here. They now go
     * through `MeetingRowActions`, which decides WHICH are possible from the
     * status and the clock — a meeting still ahead cannot have been held or
     * missed. What this guard still has to hold is the part that moving them
     * could have broken: every call carries `row.id`, the meeting's own, and
     * never the container's.
     */
    expect(tab).toMatch(/onSetBookingStatus\(\s*row\.id,\s*next,/);
    expect(tab).toContain('onEditSession(row.id)');

    /*
     * AND the meeting it is, which is new and load-bearing.
     *
     * A package is now ONE booking with N meetings, so `row.id` is a MEETING
     * id for a session and there is no booking to complete. The handler sends
     * it to `/api/scheduling/meetings/[id]/outcome` only if the row says which
     * meeting it is — without this, marking session four held would fall
     * through to the booking route and bill session one.
     */
    expect(tab).toContain('row.meeting_id ?? null');

    // Nothing in the list acts on the parent booking by mistake.
    const start = tab.indexOf('ONE LIST, NOT A STACK OF CARDS');
    const list = tab.slice(start, tab.indexOf('AddPackageMeeting', start));

    expect(start).toBeGreaterThan(-1);
    expect(list).not.toMatch(/onSetBookingStatus\(booking\.id/);
    expect(list).not.toMatch(/onEditSession\(booking\.id\)/);
  });
});

describe('the folding itself', () => {
  it('keeps a meeting whose purchase is not in the list', () => {
    // Mid-refetch the container can be absent, and a meeting that vanished
    // would be worse than one shown on its own.
    expect(drawer).toContain('!byId.has(card.booking.parent_booking_id)');
  });

  it('moves the meetings to the booking the QUOTE came out of', () => {
    /*
     * The container carries no quote of its own, so left as a card it drew a
     * second journey asking for one — "waiting for a quote", on the thing a
     * quote had just created. The journey that sold the block is the one the
     * meetings belong on.
     */
    expect(drawer).toContain('proposal.package_booking_id === containerId');
    expect(drawer).toContain('sold?.booking_id && byId.has(sold.booking_id)');
  });

  it('leaves a cold-sold package as its own card, having nowhere else to go', () => {
    // The fallback half of the same line: nowhere better to put it.
    expect(drawer).toContain('? sold.booking_id : containerId');
  });

  it('inserts that step straight after the quote', () => {
    expect(drawer).toContain("steps.findIndex(step => step.key === 'proposal')");
  });

  it('orders them as they were sold', () => {
    expect(drawer).toContain('(a.booking.occurrence_number ?? 0) - (b.booking.occurrence_number ?? 0)');
  });

  it('is applied on both the first load and the refetch', () => {
    // Each path with its OWN proposals list: the fold needs the same quotes the
    // cards were built from.
    expect(drawer).toContain('foldPackageMeetings(sessionCards, proposalsList)');
    expect(drawer).toContain('foldPackageMeetings(sessionCards, freshProposals)');
  });
});

describe('the parent reaches the journey at all', () => {
  it('is copied onto the appointment the journey reads', () => {
    // `toAppointment` copies field by field on purpose, so a column that is not
    // named here does not exist for any of this.
    expect(drawer).toContain('parent_booking_id: booking.parent_booking_id ?? null');
    expect(drawer).toContain('occurrence_number: booking.occurrence_number ?? null');
  });
});

/* ───────────────────────────────────────────────────────────────────────────
 * ACTIONS AGAINST A MEETING THAT IS NOT A CARD.
 *
 * Once a package's meetings became a step inside their quote's journey they
 * left the CARD list — and every lookup by booking id quietly found nothing.
 * Reschedule on a meeting row did nothing at all; the cancel dialog could not
 * tell whether the thing being cancelled had an hour; the drawer's count of
 * upcoming appointments dropped by six.
 *
 * Nothing about that fails loudly, which is why it is pinned here.
 * ─────────────────────────────────────────────────────────────────────────── */

describe('looking a booking up by id', () => {
  it('searches the meetings as well as the cards', () => {
    expect(drawer).toContain('sessions.flatMap(card => [card, ...(card.meetings ?? [])])');
  });

  it('is what reschedule uses', () => {
    expect(drawer).toContain('const session = findSession(bookingId);');
  });

  it('is what the cancel dialog uses to tell an appointment from a purchase', () => {
    expect(drawer).toContain("findSession(pendingCancelBookingId ?? '')");
  });

  it('is what the upcoming count counts', () => {
    // Six meetings that no longer appear in the count is a number the owner
    // reads as bookings disappearing.
    expect(drawer).toContain('everyBooking().filter(s =>');
  });
});

describe('a package whose sessions are MEETINGS, not child bookings', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * The shape this moved to: one booking, N rows in `scheduling_meetings`.
   *
   * The fold used to have only one job — group the child cards. There are no
   * child cards now, so without this branch an accepted package draws as a
   * purchase with nothing under it: no dates, no sessions, no package step.
   * That is the shape of every "the client booked it and I cannot see it" bug
   * this drawer has had.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const code = drawer
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  const fold = code.slice(code.indexOf('function sessionCardsFromMeetings'));
  const upToFold = fold.slice(0, fold.indexOf('function foldPackageMeetings'));

  it('reads the sessions off the booking that holds them', () => {
    expect(upToFold).toContain('card.booking.attempts');
  });

  it('tells a session apart from an attempt at one appointment', () => {
    /*
     * Both are rows on one booking. On an ordinary booking the list is tries
     * at a single hour; here each numbered session is a different hour. Read
     * the wrong way, a package of six draws as six attempts at one date.
     */
    expect(upToFold).toContain('session_number');
  });

  it('shows the hour the client actually holds, not one that was given back', () => {
    /*
     * A moved session leaves its old attempt behind, stamped `moved`. Listing
     * it would show a date nobody holds; ranking it as current would
     * contradict the attempt that replaced it.
     */
    expect(upToFold).toContain("meeting_status === 'moved'");
    expect(upToFold).toContain('occurrence_number');
  });

  it('marks each row with the meeting its actions must target', () => {
    /* Without this the outcome goes to a booking route that has no such
       booking, and the money keys on the wrong session. */
    expect(upToFold).toContain('meeting_id: attempt.id');
  });

  it('carries parent_booking_id, so every existing session check still holds', () => {
    /*
     * `isQuotedJob`, `sessionNextStep` and the card grouping all ask "is this a
     * session rather than a purchase" by looking for a parent. Setting it on
     * the view model keeps all of them right without editing one of them.
     */
    expect(upToFold).toContain('parent_booking_id: card.booking.id');
  });

  it('gives a session its own money, which is its stage', () => {
    /*
     * An invoice for session three now carries the CONTAINER's `booking_id`,
     * so the booking-keyed payment on the card describes the purchase. The
     * stage is the only thing that knows which hour was billed.
     */
    expect(upToFold).toContain('stage.meeting_id');
  });

  it('still folds child bookings, because packages sold earlier are that shape', () => {
    /* A package accepted last month is child bookings, and a client can pay
       for it today. Both shapes are read; neither replaced the other. */
    const both = code.slice(code.indexOf('function foldPackageMeetings'));
    expect(both).toContain('card.booking.parent_booking_id');
    expect(both).toContain('sessionCardsFromMeetings');
  });
});

describe('calling off one session is not cancelling the order', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * WHAT THE OWNER SAW
   *
   * Pressing Cancel on one session of a running package opened the BOOKING
   * cancellation dialog: "לבטל את ההזמנה?" — cancel the order? — with the
   * reasons a JOB ends for. The client will not pay. The service is
   * discontinued. The money was refunded and it is being closed out.
   *
   * None of those is a thing that happens to one hour of a package that is
   * still running, and the client would have been told their order was
   * cancelled when five of their six sessions were untouched.
   *
   * `CancelMeetingDialog` is the one that calls off an appointment and leaves
   * the work alone — it exists, and the session row was simply not reaching it.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const drawerCode = drawer
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('opens the MEETING dialog for a session', () => {
    expect(drawerCode).toContain('setPendingMeetingCancel({ bookingId, isQuoted: false, meetingId })');
  });

  it('and the ORDER dialog only when there is no session', () => {
    /* An ordinary booking keeps the dialog it always had — cancelling it does
       end the job, and the reasons are the right ones for that. */
    const branch = drawerCode.slice(drawerCode.indexOf("if (status === 'cancelled') {"));
    const body = branch.slice(0, branch.indexOf('return;'));

    expect(body).toContain('if (meetingId)');
    expect(body).toContain('setPendingCancelBookingId(bookingId)');
  });

  it('asks no quote question of a package', () => {
    /*
     * The toggle exists for a consultation whose quote may still be coming. A
     * package's quote was accepted already — that is what created the
     * sessions — so there is nothing left to decide.
     */
    expect(drawerCode).toContain('isQuoted: false, meetingId');
  });

  it('writes the outcome against the meeting, not the purchase', () => {
    /*
     * `meeting-cancel` takes a BOOKING and stamps its mirror, which for a
     * package would read as the whole thing being off. The session's own
     * endpoint stamps that hour, frees it, and leaves the other five.
     */
    /*
     * Anchored on the parameter, not the whole destructuring: the dialog has
     * since gained `addReplacement`, and pinning the exact argument list made
     * this find nothing and assert against an empty string — which fails
     * loudly, but for the wrong reason.
     */
    const confirm = drawerCode.slice(drawerCode.indexOf('onConfirm={async ({ proposalContinues'));
    const body = confirm.slice(0, confirm.indexOf('const data ='));

    expect(body).toContain('/outcome');
    expect(body).toContain('meeting-cancel');

    /*
     * The two facts the body must carry, asserted separately.
     *
     * This pinned the whole literal `{ status: 'cancelled', notifyClient: true }`,
     * which stopped matching the moment the body gained a third field
     * (`replacementStart`, for the hour booked in the cancelled one's place).
     * What has to hold is that the session is called off and the client is
     * told — not the shape of the object those two travel in.
     */
    expect(body).toMatch(/status: 'cancelled'/);
    expect(body).toMatch(/notifyClient: true/);
  });
});

describe('a called-off session says so, and only held stops a move', () => {
  const drawerSrc = drawer
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('takes its status from the session, not the purchase', () => {
    /*
     * A session the owner had just called off read "מאושרת" — confirmed —
     * beside its own struck-through date, because the row borrowed the
     * container's status and a running package stays confirmed throughout.
     * Two parts of one row saying opposite things about the same hour.
     */
    const fold = drawerSrc.slice(drawerSrc.indexOf('function sessionCardsFromMeetings'));
    const body = fold.slice(0, fold.indexOf('function foldPackageMeetings'));

    expect(body).toContain("attempt.meeting_status === 'cancelled'");
    expect(body).toContain("? 'cancelled'");
    expect(body).toContain("? 'completed'");
  });

  it('falls back to the job only while nothing has happened', () => {
    /* An unmarked session is as confirmed as the package that sold it. */
    const fold = drawerSrc.slice(drawerSrc.indexOf('function sessionCardsFromMeetings'));
    const body = fold.slice(0, fold.indexOf('function foldPackageMeetings'));

    expect(body).toContain('card.booking.status');
  });
});

describe('the move endpoint agrees with the menu that offers it', () => {
  const route = readFileSync(
    join(process.cwd(), 'app', 'api', 'scheduling', 'meetings', '[id]', 'reschedule', 'route.ts'),
    'utf8'
  )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('refuses a session that already happened', () => {
    /* On a package billed per session, held is what raised the invoice — so
       moving the date would leave it and the appointment on two days. */
    expect(route).toContain("meeting.meeting_status === 'held'");
    expect(route).toContain("code: 'already_held'");
  });

  it('and one the owner called off', () => {
    /*
     * Moving it would undo a decision through a control that says something
     * else, and the client has already been told the hour is not happening.
     */
    expect(route).toContain("meeting.meeting_status === 'cancelled'");
    expect(route).toContain("code: 'called_off'");
  });

  it('but NOT one that was missed', () => {
    /*
     * Nobody decided anything — the client did not turn up — and another
     * attempt at that session is the ordinary next move. Refusing every marked
     * session is what this replaced.
     */
    expect(route).not.toContain('meeting.meeting_status !== null');
    expect(route).not.toContain("meeting.meeting_status === 'no_show'");
  });

  it('which is the same rule the menu applies', () => {
    const actions = readFileSync(
      join(process.cwd(), 'components', 'crm', 'contact-drawer', 'MeetingRowActions.tsx'),
      'utf8'
    );

    expect(actions).toContain("const held = status === 'completed' || meetingStatus === 'held'");
    /* Wrapped and three-termed since the package cascade (`|| bookingCancelled`):
       a meeting on a cancelled booking is called off too. */
    expect(actions).toMatch(
      /const calledOff =\s*\n?\s*status === 'cancelled' \|\| meetingStatus === 'cancelled'/
    );
    expect(actions).toContain('if (onReschedule && !held && !calledOff)');
  });
});

describe('a called-off session is not owed for', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * A per-session stage bills when its session is marked HELD, so one called
   * off never bills. The stage nonetheless went on reading `pending` against
   * it: the row showed "133.33 ₪ · ממתין" directly beside the word בוטלה, and
   * the plan still totalled six sessions when only five could ever bill.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const repo = readFileSync(
    join(process.cwd(), 'lib', 'repositories', 'SchedulingRepository.ts'),
    'utf8'
  )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  const outcome = repo.slice(repo.indexOf('async setMeetingOutcome('));
  const body = outcome.slice(0, outcome.indexOf('private async mirrorSessionOutcome('));

  it('voids the stage when the session is called off', () => {
    /* `|| options?.releaseStage` joined it: a WAIVED no-show releases the stage
       too. The closing paren is not pinned; what matters is that a cancelled
       session still reaches this branch. */
    expect(body).toContain("if (status === 'cancelled'");
    expect(body).toContain("from('payment_plan_installments')");
    expect(body).toContain("status: 'cancelled'");
  });

  it('never one that has already been invoiced', () => {
    /* That amount is on a document the client is holding; refunding is the
       deliberate action, not a silent void. */
    expect(body).toContain(".eq('status', 'pending')");
    expect(body).toContain(".is('invoice_id', null)");
  });

  it('keyed on the session, so the other five are untouched', () => {
    expect(body).toContain(".eq('meeting_id', meetingId)");
    expect(body).toContain(".eq('user_id', userId)");
  });

  it("drops the plan's total by what was voided", () => {
    /* Adding a session raises it; calling one off has to lower it, or the plan
       claims money no invoice will ever ask for. */
    /* The write MOVED to `lib/payments/planFollowsItsStages.ts`, shared by the
       three stage-closing paths, and gained a guard the repository never had:
       a plan used by more than one booking is a shared template, left alone. */
    const plans = readFileSync(
      join(process.cwd(), 'lib', 'payments', 'planFollowsItsStages.ts'),
      'utf8'
    );
    expect(plans).toContain("from('payment_plans')");
    expect(plans).toContain('total_amount');
  });

  it('and the row stops showing money for it', () => {
    const drawerCode = drawer.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(drawerCode).toContain("stage && stage.status !== 'cancelled'");
  });
});
