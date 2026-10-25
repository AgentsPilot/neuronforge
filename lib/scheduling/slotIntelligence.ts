/**
 * What an hour costs you, not just whether it is free.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * The owner's booking dialog picks a time with a bare `datetime-local` input,
 * beside a banner reading "שעות פנויות: 09:00–17:00". It receives
 * `WeeklyAvailability` — the opening-hours TEMPLATE — so it cannot see existing
 * bookings, closed days or the owner's calendar. A client booking on the public
 * site gets real slots and cannot pick a taken hour; the owner, in their own
 * app, types an hour and learns it clashes when the save fails.
 *
 * Free slots fix that much. This module answers the question after it: of the
 * hours that ARE free, which one should you take.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PURE, AND DELIBERATELY SO
 *
 * No I/O, no Supabase, no clock of its own — `now` is passed in. Everything
 * here is arithmetic over intervals the caller already fetched to render the
 * day. That is what makes it testable without a database, and what keeps the
 * rules in one place rather than inlined into a 3,000-line component.
 *
 * @module lib/scheduling/slotIntelligence
 */

/** A free slot, as the availability endpoint already returns it. */
export interface Slot {
  start: string;
  end: string;
  available: boolean;
}

/** A span of the day that is already spoken for. */
export interface Busy {
  start: string;
  end: string;
}

/**
 * What taking this slot does to the day around it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The distinction that matters to a business is not free/taken — the grid
 * already shows that — it is whether an hour leaves the day whole or in pieces.
 *
 *   `closes_window`  the gap is used up exactly. Nothing left over.
 *   `strands`        a remainder too short to sell to anybody else.
 *   `closes_day`     the last free slot. Nothing dangling after it.
 *
 * `opens_day` was a fifth kind and is gone: it is a fact about the DAY, not
 * about an hour, and stamping it on every hour of an empty day drowned out the
 * four above. It is said once beside the day now, in words that explain it.
 *
 * `strands` is the one with money in it. A 90-minute gap and a 60-minute
 * service leaves 30 minutes that can never be booked — the owner has sold an
 * hour and lost half of one.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export type Consequence =
  /** The gap it uses up, carried so the row can say WHICH gap it closed. */
  | { kind: 'closes_window'; gapStart: string; gapEnd: string }
  | { kind: 'strands'; minutes: number }
  | { kind: 'closes_day' }
  | null;

export interface AnalysedSlot extends Slot {
  consequence: Consequence;
}

const MINUTE = 60_000;

const ms = (iso: string) => new Date(iso).getTime();

/** Minutes between two instants, rounded to the nearest whole minute. */
const minutesBetween = (a: number, b: number) => Math.round((b - a) / MINUTE);

/**
 * An instant as the day the BUSINESS reckons it to be, `YYYY-MM-DD`.
 *
 * Not `iso.slice(0, 10)`, which is the UTC day: for a business west of
 * Greenwich every evening hour already belongs to tomorrow in UTC, so an
 * 18:00 and a 20:00 on one working day would read as two different days.
 */
const businessDate = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone,
  }).format(new Date(iso));

/**
 * The free gaps in a day, derived from what is busy inside the bookable window.
 *
 * Built from the SLOTS rather than from opening hours: a slot exists only where
 * the business is open and not closed for the day, so the slots already carry
 * every rule about when work can happen. Reconstructing the window from
 * availability settings here would be a second opinion about the same thing.
 */
function freeGaps(slots: Slot[], busy: Busy[]): Array<{ start: number; end: number }> {
  const free = slots.filter(s => s.available);
  if (free.length === 0) return [];

  const sorted = [...free].sort((a, b) => ms(a.start) - ms(b.start));
  const busySorted = [...busy].sort((a, b) => ms(a.start) - ms(b.start));

  const gaps: Array<{ start: number; end: number }> = [];
  let runStart = ms(sorted[0].start);
  let runEnd = ms(sorted[0].end);

  for (const slot of sorted.slice(1)) {
    const start = ms(slot.start);

    /*
     * A new gap begins when the slots stop being contiguous, OR when something
     * busy sits between them. Slots step every 30 minutes and may overlap each
     * other, so adjacency alone is not enough: two slots either side of a
     * booking can still touch.
     */
    const interrupted = busySorted.some(b => ms(b.start) < start && ms(b.end) > runEnd - 1);

    if (start > runEnd || interrupted) {
      gaps.push({ start: runStart, end: runEnd });
      runStart = start;
      runEnd = ms(slot.end);
    } else {
      runEnd = Math.max(runEnd, ms(slot.end));
    }
  }

  gaps.push({ start: runStart, end: runEnd });

  return gaps;
}

export interface AnalyseInput {
  slots: Slot[];
  busy: Busy[];
  /** This service's length, which is what "sellable" means for the remainder. */
  durationMinutes: number;
  /**
   * Whether nothing at all is booked on this day.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * ACCEPTED AND NO LONGER USED HERE, deliberately: it is a fact about the DAY
   * and this function labels HOURS.
   *
   * It used to be checked first and to outrank everything else, so on an empty
   * day every hour came back "opens a day" — the same words sixteen times, on
   * exactly the day where the owner has the most freedom to choose well and
   * most needs the hours told apart. The grid could not say that 16:00 strands
   * half an hour while 13:00 wastes nothing, because the day had already
   * answered for all of them.
   *
   * The fact itself is not lost: it is said ONCE, on the day strip and above
   * the grid, in a sentence that explains what it costs. See
   * `scheduling.slots.day.untouched`.
   * ───────────────────────────────────────────────────────────────────────────
   */
  dayIsEmpty?: boolean;
}

/**
 * Label each free slot with what it would do to the day.
 *
 * A slot that is not available gets no consequence: the grid strikes it
 * through, and there is nothing to weigh.
 */
export function analyseSlots(input: AnalyseInput): AnalysedSlot[] {
  const { slots, busy, durationMinutes } = input;
  const gaps = freeGaps(slots, busy);

  const lastFree = [...slots].filter(s => s.available).sort((a, b) => ms(a.start) - ms(b.start)).pop();

  return slots.map(slot => {
    if (!slot.available) return { ...slot, consequence: null };

    const start = ms(slot.start);
    const end = ms(slot.end);

    const gap = gaps.find(g => g.start <= start && g.end >= end);

    if (gap) {
      const before = minutesBetween(gap.start, start);
      const after = minutesBetween(end, gap.end);

      /* Nothing left over: the gap is used up exactly. */
      if (before === 0 && after === 0) {
        return {
          ...slot,
          consequence: {
            kind: 'closes_window',
            gapStart: new Date(gap.start).toISOString(),
            gapEnd: new Date(gap.end).toISOString(),
          },
        };
      }

      /*
       * EACH SIDE IS JUDGED ON ITS OWN, AND ONLY THEN SUMMED.
       *
       * ───────────────────────────────────────────────────────────────────────
       * A side shorter than the service cannot be sold to anybody. Testing the
       * TOTAL instead gets the middle of a long gap exactly wrong: a two-hour
       * window with a one-hour booking taken from the middle leaves 30 minutes
       * before and 30 after — a total of 60, which passes a test against a
       * 60-minute service, while neither half can ever be booked.
       *
       * That is the expensive case, and it is the one an owner creates by
       * typing a convenient round hour into a free-text field. Summed only for
       * the figure shown, never for the decision.
       * ───────────────────────────────────────────────────────────────────────
       */
      const wasted =
        (before > 0 && before < durationMinutes ? before : 0) +
        (after > 0 && after < durationMinutes ? after : 0);

      if (wasted > 0) {
        return { ...slot, consequence: { kind: 'strands', minutes: wasted } };
      }
    }

    if (lastFree && slot.start === lastFree.start) {
      return { ...slot, consequence: { kind: 'closes_day' } };
    }

    return { ...slot, consequence: null };
  });
}

/* ─────────────────────────────────────────────────────────────────────────── */

/**
 * Why an hour is being put forward. Each row says a DIFFERENT thing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *   `soonest`                    the first hour that actually works for this
 *                                service — its length and the gap between
 *                                appointments both allowed for.
 *   `closes_window`              it uses a gap up exactly, naming the gap.
 *   `client_usual_hour`          the hour this client keeps choosing.
 *   `client_usual_hour_nearest`  their hour has gone; the closest to it.
 *   `next_day`                   the first free hour on the following day —
 *                                "not today, then" as a real alternative.
 *
 * "It opens an empty day" is NOT among them, and that was a real mistake while
 * it was: it is a reason NOT to book an hour, so it cannot be the reason an
 * hour is offered — the row's whole justification was its own drawback. It
 * rides on a row offered for a real reason instead, as `opensDay`.
 *
 * THREE ROWS THAT SAY THREE DIFFERENT THINGS, and they may fall on three
 * different days — the hour that wastes nothing can be today while the client's
 * own hour is on Thursday, and an owner would never find that by clicking
 * through days one at a time.
 *
 * The LEAD is the exception: it is drawn from the soonest day with anything
 * free, so the top row — the one read as the recommendation — never answers
 * "when can I see this person" with a day further out than necessary.
 *
 * There is no filler. A row appears because something is true of that hour and
 * of no other; when only one is true, one row is the answer.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export type SuggestionReason =
  | 'soonest'
  | 'closes_window'
  | 'client_usual_hour'
  | 'client_usual_hour_nearest'
  | 'next_day';

export interface Suggestion {
  slot: AnalysedSlot;
  reason: SuggestionReason;
  /**
   * How many past meetings the habit was read from.
   *
   * The sentence says "the hour David chose in the previous three meetings",
   * and three is the evidence — without it the row is an assertion.
   */
  meetingCount?: number;
  /**
   * This hour falls on a day with nothing else in it.
   *
   * A CAVEAT, never a reason: one booking turns a clear day into a working
   * one, which is an argument against the hour and so cannot be what puts it
   * forward. It qualifies a row that earned its place some other way — "the
   * soonest opportunity, BUT it opens a new day".
   */
  opensDay?: boolean;
}

export interface SuggestInput {
  /** Already analysed, across however many days are on screen. */
  slots: AnalysedSlot[];
  /**
   * When this client has booked before, as ISO instants.
   *
   * Returning clients repeat themselves, and their past bookings are already on
   * the contact. Surfacing the hour saves the owner remembering it.
   */
  clientHistory?: string[];
  now: Date;
  /**
   * The days in the window with nothing booked at all, as business dates.
   *
   * A fact about a DAY, so it is handed in rather than inferred from an hour.
   * It used to be stamped on every slot by `analyseSlots`, which drowned out
   * what each hour did to its own day.
   */
  emptyDays?: string[];
  /** How many to return. Three fits the dialog without becoming a second grid. */
  limit?: number;
}

/** The hour this client has chosen most often, or null below two bookings. */
function usualHour(history: string[] | undefined, timeZone: string): number | null {
  if (!history || history.length < 2) return null;

  const counts = new Map<number, number>();

  for (const iso of history) {
    /*
     * The hour as the business reads it.
     *
     * The MATCH below is zone-invariant — both the history and the candidate
     * slots are converted the same way, so a wrong zone shifts both sides
     * equally and still lands on the same slot. The zone is here for the day
     * this hour is ever displayed or compared against anything else, where a
     * 16:00 Jerusalem booking read as 13:00 UTC would be nonsense to the owner.
     * Stated because a reader will otherwise assume the match depends on it.
     */
    const hour = Number(
      new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone }).format(
        new Date(iso)
      )
    );
    if (Number.isFinite(hour)) counts.set(hour, (counts.get(hour) ?? 0) + 1);
  }

  let best: number | null = null;
  let bestCount = 1; /* one booking is not a habit */

  for (const [hour, count] of counts) {
    if (count > bestCount) {
      best = hour;
      bestCount = count;
    }
  }

  return best;
}

/**
 * The two or three hours worth putting in front of the owner.
 *
 * Ranked by what they SAVE rather than by when they are. The soonest slot is
 * offered last and labelled, because "earliest" and "best" are different
 * questions and the dialog used to answer only the first by accident — the
 * default time was simply the next opening.
 */
export function suggestSlots(input: SuggestInput & { timeZone: string }): Suggestion[] {
  const { slots, clientHistory, now, timeZone, emptyDays = [], limit = 3 } = input;

  const ahead = slots
    .filter(s => s.available && ms(s.start) > now.getTime())
    .sort((a, b) => ms(a.start) - ms(b.start));

  if (ahead.length === 0) return [];

  const out: Suggestion[] = [];
  const taken = new Set<string>();

  const add = (slot: AnalysedSlot | undefined, reason: SuggestionReason, meetingCount?: number) => {
    if (!slot || taken.has(slot.start) || out.length >= limit) return;
    taken.add(slot.start);
    out.push({ slot, reason, ...(meetingCount ? { meetingCount } : {}) });
  };

  const hourOf = (slot: AnalysedSlot) =>
    Number(
      new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone }).format(
        new Date(slot.start)
      )
    );

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * 1. THE LEAD, DRAWN FROM THE SOONEST DAY THAT HAS ANYTHING.
   *
   * The top row is read as the recommendation, so it must not answer "when can
   * I see this person" with a day further out than necessary — this used to
   * range over the whole week and put TOMORROW first while today still had
   * eight hours free.
   *
   * Within that day it prefers the hour that uses a gap up exactly, because
   * that is the one piece of advice the owner cannot reach by looking at a
   * list of hours. Failing that, the soonest.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const soonestDay = businessDate(ahead[0].start, timeZone);
  const onSoonestDay = ahead.filter(s => businessDate(s.start, timeZone) === soonestDay);
  const tidy = onSoonestDay.find(s => s.consequence?.kind === 'closes_window');

  /*
   * No tidy hour on that day means the soonest leads instead — rule 3 would
   * otherwise supply it, but as the THIRD row, which would put the client's
   * habit and a day further out above the earliest hour available.
   */
  if (tidy) add(tidy, 'closes_window');
  else add(onSoonestDay[0], 'soonest');

  /*
   * 2. THE HOUR THIS CLIENT KEEPS CHOOSING — anywhere in the window.
   *
   * Deliberately NOT restricted to the soonest day: a client who always comes
   * at four is worth offering four, and the day that has four may be Thursday.
   * Matched on the hour alone, so 16:00 and 16:30 both answer "around four".
   *
   * When their hour is nowhere in the window, the nearest to it is offered and
   * says so — the row used to vanish, taking with it the one suggestion that is
   * about this client rather than about the diary.
   */
  const hour = usualHour(clientHistory, timeZone);

  if (hour !== null) {
    const repeats = (clientHistory ?? []).filter(iso => {
      const h = Number(
        new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone }).format(
          new Date(iso)
        )
      );
      return h === hour;
    }).length;

    const exact = ahead.find(s => hourOf(s) === hour);

    if (exact) {
      add(exact, 'client_usual_hour', repeats);
    } else {
      const nearest = [...ahead].sort(
        (a, b) => Math.abs(hourOf(a) - hour) - Math.abs(hourOf(b) - hour)
      )[0];

      add(nearest, 'client_usual_hour_nearest', repeats);
    }
  }

  /*
   * 3. THE FIRST FREE HOUR ON THE NEXT DAY.
   *
   * "Not today, then" — the answer to a client who cannot make the hours above,
   * and the one the owner would otherwise reach by clicking the strip along one
   * day at a time.
   *
   * `ahead` is in time order, so the first entry on any other day IS the
   * earliest hour of the next day that has anything free; days in between that
   * are closed or full fall out on their own.
   */
  add(ahead.find(s => businessDate(s.start, timeZone) !== soonestDay), 'next_day');

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * AND THE CAVEAT, ON WHICHEVER ROWS IT IS TRUE OF.
   *
   * "It opens an empty day" was briefly a reason of its own, which put a row
   * in the panel whose only argument was a drawback — and, cut loose from
   * "soonest", it reached for the first empty day in the window, six days out.
   * Nobody opens this dialog wanting to be shown a clear day they could spoil.
   *
   * Today is excluded by the caller rather than here: today is already under
   * way, so "you would start working a free day" says nothing about it.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const emptied = new Set(emptyDays);

  return out
    .slice(0, limit)
    .map(s =>
      emptied.has(businessDate(s.slot.start, timeZone)) ? { ...s, opensDay: true } : s
    );
}

/* ─────────────────────────────────────────────────────────────────────────── */

export type WarningKind = 'no_24h_reminder' | 'intake_lead_time';

export interface Warning {
  kind: WarningKind;
  /** Hours between now and the meeting, for the sentence the UI writes. */
  hoursAhead: number;
}

export interface WarningInput {
  start: string;
  now: Date;
  /** This service asks the client to return a form first. */
  requiresIntake: boolean;
}

/**
 * What booking this particular hour will quietly cost.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Both of these are real machinery, not advice.
 *
 * `no_24h_reminder` — the reminder cron stamps `reminder_24hr_sent`. A meeting
 * booked less than 24 hours out passes that point before the row exists, so
 * that reminder never goes. The client gets the two-hour one and nothing else,
 * and the no-show risk is higher for a reason the owner never sees.
 *
 * `intake_lead_time` — a service whose form has to come back first gives the
 * client only the hours between now and the meeting to return it. Worth saying
 * before the booking is made rather than when the form arrives empty.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function bookingWarnings(input: WarningInput): Warning[] {
  const hoursAhead = Math.floor((ms(input.start) - input.now.getTime()) / (60 * MINUTE));
  const out: Warning[] = [];

  if (hoursAhead >= 0 && hoursAhead < 24) {
    out.push({ kind: 'no_24h_reminder', hoursAhead });
  }

  if (input.requiresIntake && hoursAhead >= 0 && hoursAhead < 48) {
    out.push({ kind: 'intake_lead_time', hoursAhead });
  }

  return out;
}
