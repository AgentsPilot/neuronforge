/**
 * What a client has actually done, counted from facts the product already has.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * The insight system has 49 detectors and thirteen of them name a contact —
 * and almost every one measures what the BUSINESS failed to do: an enquiry
 * left unanswered, a reply that was slow, a lead gone cold. Nothing answered
 * the question an owner asks before agreeing to the next booking: what is this
 * person like to deal with.
 *
 * ── THE ONE RULE THAT SHAPES EVERYTHING HERE ────────────────────────────────
 *
 * A fact is counted against a client only when it is UNAMBIGUOUSLY theirs.
 *
 * Measured on production, 2026-11-15: of 78 cancelled meetings, `cancelled_by`
 * says 'client' exactly ZERO times — the column is null on 244 of 249 rows,
 * and `moved_by` on 234 of them. A cancellation therefore cannot be attributed
 * at the meeting level today, and the obvious shortcut — "cancelled, so the
 * client cancelled" — would hand an owner a badge calling someone unreliable
 * because the OWNER called their sessions off.
 *
 * So an unattributed cancellation is counted as exactly that: `cancelledUnknown`.
 * It is reported, it is never held against anyone, and the day the write paths
 * start recording who acted it moves into `cancelledByClient` with no change
 * here.
 *
 * What IS unambiguous: a no-show (nobody else can fail to turn up), an
 * instalment paid after its due date, an instalment still overdue, and a
 * booking the client themselves cancelled (`scheduling_bookings.cancelled_by`
 * does carry 'client' — 13 rows today).
 *
 * Pure: rows in, counts out. No Supabase, no React, no clock of its own — the
 * caller passes `now`, so a test is a table of rows rather than a mocked date.
 *
 * @module lib/business-os/clients/clientProfile
 */

/** A session row, reduced to what the count reads. */
export interface ProfileMeetingRow {
  booking_id: string | null;
  meeting_status: string | null;
  start_time: string | null;
  /**
   * WHO RECORDED THE OUTCOME, and the authoritative answer to "who called this
   * off". `setMeetingOutcome` writes it with every outcome; on production it
   * names an actor for 69 of 78 cancelled sessions, while `cancelled_by` — the
   * column that looks like it should hold this — is null on 73 of them.
   */
  outcome_by?: string | null;
  cancelled_by?: string | null;
}

/** A booking, for the contact it belongs to and who called it off. */
export interface ProfileBookingRow {
  id: string;
  contact_id: string | null;
  status?: string | null;
  meeting_status?: string | null;
  cancelled_by?: string | null;
  start_time?: string | null;
}

export interface ProfileInstalmentRow {
  contact_id: string | null;
  status: string | null;
  due_date: string | null;
  paid_at: string | null;
}

export interface ProfileTransactionRow {
  contact_id: string | null;
  refund_status: string | null;
  created_at: string | null;
}

export interface ProfileProposalRow {
  contact_id: string | null;
  status: string | null;
  updated_at?: string | null;
}

/**
 * One client's record over the window.
 *
 * Counts only. No rate, no grade, no sentence: those belong to
 * `clientStanding`, which is the one place a judgement is made, and keeping
 * them apart is what lets the badge show its workings.
 */
export interface ClientProfile {
  contactId: string;
  /** Sessions with an outcome: held, missed, or called off. `moved` is not one. */
  sessionsSettled: number;
  sessionsHeld: number;
  sessionsMissed: number;
  /** Called off, and the client is recorded as having done it. */
  sessionsCancelledByClient: number;
  /**
   * Called off by the BUSINESS. Not a mark against the client, and not noise
   * either: on the reporting account all seven of one client's cancellations
   * are the owner's, which is a fact about the business worth being able to
   * read back.
   */
  sessionsCancelledByOwner: number;
  /** Called off by nobody we can name. Reported, never held against them. */
  sessionsCancelledUnknown: number;
  /** Instalments whose moment to pay has arrived. */
  instalmentsDue: number;
  instalmentsPaidOnTime: number;
  instalmentsPaidLate: number;
  instalmentsOverdue: number;
  refunds: number;
  proposalsDeclined: number;

  /**
   * ── THE SAME COUNTS, SPLIT IN TWO ─────────────────────────────────────────
   *
   * The window's older half and its recent half, so a client can be compared
   * against THEMSELVES. A level says what they are like; a change says what is
   * happening — and the client who hurts a business is usually the one who was
   * fine and stopped being fine, which no comparison against other people can
   * see.
   *
   * Split at the midpoint of the window rather than by a fixed date, so it
   * follows whatever window the caller asked for.
   */
  recent: PeriodCounts;
  earlier: PeriodCounts;
}

/** One half of the window, in the two counts that can drift. */
export interface PeriodCounts {
  sessionsSettled: number;
  sessionsMissed: number;
  instalmentsDue: number;
  instalmentsPaidLate: number;
}

const SETTLED = new Set(['held', 'no_show', 'cancelled']);

const emptyProfile = (contactId: string): ClientProfile => ({
  contactId,
  sessionsSettled: 0,
  sessionsHeld: 0,
  sessionsMissed: 0,
  sessionsCancelledByClient: 0,
  sessionsCancelledByOwner: 0,
  sessionsCancelledUnknown: 0,
  instalmentsDue: 0,
  instalmentsPaidOnTime: 0,
  instalmentsPaidLate: 0,
  instalmentsOverdue: 0,
  refunds: 0,
  proposalsDeclined: 0,
  recent: { sessionsSettled: 0, sessionsMissed: 0, instalmentsDue: 0, instalmentsPaidLate: 0 },
  earlier: { sessionsSettled: 0, sessionsMissed: 0, instalmentsDue: 0, instalmentsPaidLate: 0 },
});

/** A date that is really one, or null. A malformed stamp counts as nothing. */
function at(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * A due date with no time of day is due at the END of that day.
 *
 * `payment_plan_installments.due_date` is a date, and comparing a payment made
 * at 14:00 against midnight would call that day's payment late.
 */
function dueMoment(value: string | null): Date | null {
  if (!value) return null;
  return at(value.includes('T') ? value : `${value}T23:59:59.999Z`);
}

export interface BuildProfilesInput {
  meetings: ProfileMeetingRow[];
  bookings: ProfileBookingRow[];
  instalments: ProfileInstalmentRow[];
  transactions: ProfileTransactionRow[];
  proposals: ProfileProposalRow[];
  now: Date;
  /** How far back to count. The caller shortens it for a young account. */
  windowDays: number;
}

/**
 * Every contact's record, keyed by contact id.
 *
 * One pass per table rather than one query per contact — the same batching
 * `CashRefundPatternDetector` uses for its contact names, and the reason this
 * can run for a whole account at once.
 */
export function buildClientProfiles(input: BuildProfilesInput): Map<string, ClientProfile> {
  const { meetings, bookings, instalments, transactions, proposals, now, windowDays } = input;
  const since = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const within = (value: string | null | undefined) => {
    const date = at(value);
    return date !== null && date >= since;
  };

  /* The midpoint: everything after it is "recent", everything before "earlier". */
  const midpoint = new Date(now.getTime() - (windowDays / 2) * 24 * 60 * 60 * 1000);
  const isRecent = (value: string | null | undefined) => {
    const date = at(value);
    return date !== null && date >= midpoint;
  };
  const half = (profile: ClientProfile, value: string | null | undefined) =>
    isRecent(value) ? profile.recent : profile.earlier;

  const profiles = new Map<string, ClientProfile>();
  const of = (contactId: string) => {
    const existing = profiles.get(contactId);
    if (existing) return existing;
    const fresh = emptyProfile(contactId);
    profiles.set(contactId, fresh);
    return fresh;
  };

  const bookingById = new Map(bookings.map(row => [row.id, row]));

  for (const meeting of meetings) {
    const status = meeting.meeting_status ?? '';
    if (!SETTLED.has(status)) continue;
    if (!within(meeting.start_time)) continue;

    const booking = meeting.booking_id ? bookingById.get(meeting.booking_id) : undefined;
    const contactId = booking?.contact_id;
    if (!contactId) continue;

    const profile = of(contactId);
    profile.sessionsSettled += 1;
    half(profile, meeting.start_time).sessionsSettled += 1;

    if (status === 'held') {
      profile.sessionsHeld += 1;
      continue;
    }

    if (status === 'no_show') {
      /*
       * Unambiguously the client's, and `outcome_by` must NOT soften it: a
       * no-show is recorded BY the owner ABOUT the client, so its actor is
       * always the business and means nothing about whose fault the absence
       * was. Nobody else can fail to turn up.
       */
      profile.sessionsMissed += 1;
      half(profile, meeting.start_time).sessionsMissed += 1;
      continue;
    }

    /*
     * Cancelled. The meeting's own attribution first, then the booking's — a
     * client who calls off the whole job called off each of its sessions.
     * Anything else is unknown, and unknown is not theirs.
     */
    /*
     * The outcome's own actor first — the one field that is actually written.
     * Then the two `cancelled_by` columns: the meeting's, and the booking's for
     * a job called off whole, which cancels each of its sessions with it.
     */
    const by = meeting.outcome_by ?? meeting.cancelled_by ?? booking?.cancelled_by ?? null;
    if (by === 'client') profile.sessionsCancelledByClient += 1;
    else if (by === 'owner') profile.sessionsCancelledByOwner += 1;
    else profile.sessionsCancelledUnknown += 1;
  }

  for (const instalment of instalments) {
    const contactId = instalment.contact_id;
    if (!contactId) continue;

    const due = dueMoment(instalment.due_date);
    const paid = at(instalment.paid_at);
    const status = instalment.status ?? '';

    /* Counted from the moment it mattered: when it was paid, else when it was
       due. An instalment due next month is not yet a fact about anybody. */
    const stamp = instalment.paid_at ?? instalment.due_date;
    if (!within(stamp)) continue;
    if (status === 'cancelled') continue;

    if (paid) {
      const profile = of(contactId);
      profile.instalmentsDue += 1;
      half(profile, instalment.paid_at).instalmentsDue += 1;
      if (due && paid > due) {
        profile.instalmentsPaidLate += 1;
        half(profile, instalment.paid_at).instalmentsPaidLate += 1;
      } else {
        profile.instalmentsPaidOnTime += 1;
      }
      continue;
    }

    if (status === 'overdue' || (due !== null && due < now && status !== 'paid')) {
      const profile = of(contactId);
      profile.instalmentsDue += 1;
      profile.instalmentsOverdue += 1;
    }
  }

  for (const transaction of transactions) {
    const contactId = transaction.contact_id;
    if (!contactId) continue;
    if (transaction.refund_status !== 'full' && transaction.refund_status !== 'partial') continue;
    if (!within(transaction.created_at)) continue;
    of(contactId).refunds += 1;
  }

  for (const proposal of proposals) {
    const contactId = proposal.contact_id;
    if (!contactId) continue;
    if (proposal.status !== 'declined') continue;
    if (!within(proposal.updated_at)) continue;
    of(contactId).proposalsDeclined += 1;
  }

  return profiles;
}
