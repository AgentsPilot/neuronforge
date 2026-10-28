/**
 * Every attempt at an appointment is on the journey, each with its own date.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS FOR
 *
 * A booking rescheduled after somebody said what happened keeps the earlier
 * appointment as its own row in `scheduling_meetings`, rather than having its
 * time overwritten. So three missed attempts are three dates, read in order,
 * instead of one date that keeps changing and a history nobody can see.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TWO WAYS THIS BREAKS SILENTLY
 *
 * A column the API returns and `toAppointment` does not copy arrives as
 * `undefined`, and every reader behaves as though it never existed — no error,
 * no log. That has already happened once on this exact path, to
 * `meeting_status`, whose own comment now warns about it.
 *
 * And a fetch that stops asking for `include_attempts` empties the rows just as
 * completely, with the UI looking entirely reasonable: one meeting node, the
 * way it looked before any of this existed.
 *
 * Plan: docs/workplans/BOOKING_MEETINGS_TABLE_PLAN.md (Phase 4c)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const read = (p: string) =>
  fs.readFileSync(path.join(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n');

const DRAWER = read('components/crm/contact-drawer/CRMContactDrawerV2.tsx');
const TAB = read('components/crm/contact-drawer/BookingsTab.tsx');
const ROUTE = read('app/api/scheduling/bookings/route.ts');
const REPO = read('lib/repositories/SchedulingRepository.ts');

/** Comments stripped, because several of them quote the code they explain. */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('the whole chain is connected', () => {
  it('the repository reads the attempts, scoped to the owner', () => {
    const fn = REPO.slice(REPO.indexOf('async listAttempts('));
    const body = fn.slice(0, fn.indexOf('\n  }'));

    expect(body).toContain("from('scheduling_meetings')");
    /* CLAUDE.md rule 4 — a journey is one business's, and the booking ids
       having come from an earlier query is not a tenant filter. */
    expect(body).toContain(".eq('user_id', userId)");
    /* In the order they were attempted, or the history reads backwards. */
    expect(body).toContain("order('occurrence_number'");
  });

  it('the route attaches them only when asked', () => {
    const c = code(ROUTE);

    expect(c).toContain('include_attempts');
    expect(c).toContain('listAttempts(');
    /* Opt-in: `list()` is on hot paths that draw no journey. */
    expect(c).toMatch(/if \(validated\.include_attempts/);
  });

  it('both drawer fetches ask for them', () => {
    /*
     * Both. The first load and the silent refresh — if only one asks, the rows
     * appear and then vanish the next time anything reloads, which reads as a
     * rendering bug rather than a missing parameter.
     */
    const asks = DRAWER.match(/\/api\/scheduling\/bookings\?[^`]*include_attempts=true/g) ?? [];
    expect(asks.length).toBeGreaterThanOrEqual(2);

    const fetches = DRAWER.match(/fetch\(`\/api\/scheduling\/bookings\?[^`]*`/g) ?? [];
    expect(fetches.length).toBeGreaterThan(0);
    for (const f of fetches) expect(f).toContain('include_attempts=true');
  });

  it('toAppointment copies them onto the appointment', () => {
    /* The `meeting_status` mistake, which this path has made before. */
    const fn = DRAWER.slice(DRAWER.indexOf('export function toAppointment'));
    expect(fn.slice(0, fn.indexOf('\n}'))).toContain('attempts:');
  });
});

describe('what the rows show', () => {
  const block = TAB.slice(
    TAB.indexOf('booking.attempts?.length'),
    TAB.indexOf('{isIntakeStep && hasIntake && (')
  );

  it('draws nothing unless there is more than one attempt', () => {
    /*
     * One attempt means no history to tell, and that is every booking never
     * rescheduled after an outcome — almost all of them. The journey must look
     * exactly as it did for those.
     */
    expect(block).toContain('> 1');
  });

  it('lists EVERY attempt, marking which one is current', () => {
    /*
     * It used to list only the earlier ones, on the reasoning that the current
     * attempt was already described by the node's own line. That stopped being
     * right once each attempt carries the mail sent about it: the current
     * attempt's mail needs a home too, and hiding the row leaves it nowhere.
     *
     * So all attempts render, and the newest is marked rather than omitted.
     */
    expect(block).not.toContain('.slice(0, -1)');
    expect(block).toContain('isCurrentAttempt');
  });

  it('shows the mail sent about each attempt', () => {
    /* On `meeting_id`, so a confirmation sits under the appointment it
       confirmed rather than stacking on the first attempt. */
    expect(block).toContain('attempt.emails');
    expect(block).toContain('mail.subject');
  });

  it('keys the mail rows by id, not index', () => {
    expect(block).toContain('key={mail.id}');
  });

  it('gives each row its own date', () => {
    /* The whole point: a list of attempts whose rows do not say WHICH day is a
       list that cannot be read. */
    expect(block).toContain('attempt.start_time');
  });

  it('names every outcome, and says something when there is none', () => {
    expect(block).toContain("attempt.meeting_status === 'held'");
    expect(block).toContain("attempt.meeting_status === 'no_show'");
    expect(block).toContain("attempt.meeting_status === 'cancelled'");
    /* An unmarked earlier attempt is possible and must still read as a row. */
    expect(block).toContain('awaiting_outcome');
  });

  it('keys the rows by attempt id', () => {
    /* Not by index: the list grows at the end, and an index key makes React
       reuse the wrong row's state when it does. */
    expect(block).toContain('key={attempt.id}');
  });
});

describe('emails use the recorded link, not the guess', () => {
  /*
   * `email_sends.booking_id` exists since 20261077. Before it, the journey
   * matched an email to a booking by time and subject — which cannot tell two
   * attempts of ONE booking apart, because it is keyed on when the booking was
   * created. Every mail attached to the first attempt.
   */
  it('prefers booking_id over the heuristic', () => {
    expect(DRAWER).toContain('email.booking_id === bookingId');
  });

  it('keeps the heuristic for rows that predate the column', () => {
    /* 704 emails carry no link and never will — nothing recorded which booking
       they were about. Removing the fallback would blank their journeys. */
    expect(DRAWER).toContain('fiveMinutes');
  });

  it('BOTH copies were changed', () => {
    /*
     * `findConfirmationEmail` is declared twice — once for the initial load and
     * once for the silent refresh. Changing one leaves the drawer showing a
     * booking differently before and after a refresh, which reads as a
     * rendering bug rather than two copies of a function.
     */
    const declarations = DRAWER.match(/const findConfirmationEmail = \(/g) ?? [];
    const preferLink = DRAWER.match(/email\.booking_id === bookingId/g) ?? [];

    expect(declarations.length).toBeGreaterThan(0);
    expect(preferLink.length).toBe(declarations.length);
  });

  it('every declaration takes the booking id', () => {
    const declarations = DRAWER.match(/const findConfirmationEmail = \([^)]*\)/g) ?? [];
    for (const d of declarations) expect(d).toContain('bookingId');
  });
});

describe('the send path attributes without eight chances to forget', () => {
  const RECORD = read('lib/notifications/recordEmailSend.ts');

  it('resolves the attempt in one place', () => {
    expect(RECORD).toContain('async function resolveMeetingId');
    expect(RECORD).toContain('listAttempts(');
  });

  it('honours an explicitly supplied meeting', () => {
    /* A sender that genuinely knows which session it is about must win over
       the "latest attempt" default. */
    expect(RECORD).toMatch(/if \(meetingId\) return meetingId;/);
  });

  it('never fails a send over attribution', () => {
    /* An email that WAS sent must not be un-recorded because its attempt could
       not be worked out. Null means the journey falls back to the heuristic,
       which is what it does for every pre-column row anyway. */
    const fn = RECORD.slice(RECORD.indexOf('async function resolveMeetingId'));
    expect(fn.slice(0, fn.indexOf('\n}'))).toContain('return null;');
  });
});

describe('the mail is paired on the recorded link', () => {
  it('matches on meeting_id, never on time or subject', () => {
    /*
     * The pairing helper must use `email_sends.meeting_id`. A booking-level or
     * time-based match cannot tell two attempts of ONE booking apart — which is
     * the whole reason the column was added.
     */
    const fn = DRAWER.slice(DRAWER.indexOf('function attachAttemptEmails'));
    const body = fn.slice(0, fn.indexOf('\n}'));

    expect(body).toContain('email.meeting_id === attempt.id');
    expect(body).not.toContain('fiveMinutes');
  });

  it('is applied on BOTH the first load and the silent refresh', () => {
    /* One without the other means the mail vanishes the next time anything
       reloads, which reads as a rendering bug. */
    const calls = DRAWER.match(/attachAttemptEmails\(bookingData\.attempts/g) ?? [];
    expect(calls.length).toBe(2);
  });
});

describe('the stage says its state once', () => {
  /*
   * `outcomeTitle` IS the status word, and the stage renders a state pill
   * beside its title. Using the former AS the title printed the same word
   * twice, and the meeting node read:
   *
   *     לא הגיע
   *     לא הגיע
   *
   * The title names the stage; the pill says what happened to it.
   */
  const titleBlock = TAB.slice(
    TAB.indexOf('const stageShowsItsOwnState'),
    TAB.indexOf('const isIntakeStep')
  );

  it('a stage with its own state pill keeps its NAME as the title', () => {
    expect(titleBlock).toContain("step.key === 'session'");
    expect(titleBlock).toContain('stageShowsItsOwnState ? null : outcomeTitle');
  });

  it('and the closing stage of a job without a pill still gets its outcome', () => {
    /* `outcomeTitle` was written for a product's fulfilment reading
       "order completed"; removing it entirely would lose that. */
    expect(titleBlock).toContain('outcomeTitle');
  });

  it('does not read meetingStateWord, which is declared far below', () => {
    /*
     * The obvious implementation — "has it a state word?" — is a temporal dead
     * zone here: `meetingStateWord` is declared several hundred lines later.
     * This file has produced that crash twice.
     */
    expect(titleBlock).not.toContain('meetingStateWord');
    expect(TAB.indexOf('const stageShowsItsOwnState'))
      .toBeLessThan(TAB.indexOf('const meetingStateWord'));
  });
});

describe('a mail row says whether it arrived', () => {
  const block = TAB.slice(
    TAB.indexOf('booking.attempts?.length'),
    TAB.indexOf('{isIntakeStep && hasIntake && (')
  );

  it('renders the delivery status', () => {
    /* "A mail was sent" is not the same as "a mail arrived". An owner reading a
       journey that only says it went out has no way to know it bounced. */
    expect(block).toContain('crm.email.status.${mail.status}');
  });

  it('treats bounced, complained and failed as a problem', () => {
    /*
     * `complained` must be in this set. Its label was once missing from all
     * three locales, which rendered a raw key on a card, and `buildJourneySteps`
     * fell through to a default that painted a spam complaint as a green tick.
     */
    expect(block).toContain("mail.status === 'bounced'");
    expect(block).toContain("mail.status === 'complained'");
    expect(block).toContain("mail.status === 'failed'");
  });

  it('does not treat pending as a failure', () => {
    /* Not yet tried is not the same as did not arrive. */
    const flag = block.slice(block.indexOf('const mailFailed'), block.indexOf('return ('));
    expect(flag).not.toContain("'pending'");
  });

  it('every status it can render has a label in all three locales', () => {
    /* `t()` returns the KEY on a miss, and the usual `t(…) || fallback` idiom
       cannot catch it because a key is a truthy string. */
    const statuses = ['pending', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'complained', 'failed'];
    for (const locale of ['he', 'en', 'es']) {
      const dict = read(`lib/business-os/translations/${locale}.ts`);
      for (const status of statuses) {
        expect(dict).toContain(`'crm.email.status.${status}'`);
      }
    }
  });
});

describe('the chain reads as sentences, not fragments', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * WHAT THIS REPLACED
   *
   * A row said "· לא הגיע 01:45 👤": a state, a loose number and an icon, which
   * the reader had to assemble. The owner reported it twice as unreadable and
   * asked, plainly, "what does it mean? who updated, when?"
   *
   * Every line now has a verb and a subject. The ACTOR chooses the verb —
   * "you marked", "the client cancelled", "recorded automatically" — so who
   * did it needs no icon to decode, and the time belongs to an action rather
   * than floating beside a word.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const rail = TAB.slice(TAB.indexOf("── THE MEETING'S HISTORY, AS SENTENCES ──"));
  const block = rail.slice(0, rail.indexOf('{isIntakeStep && hasIntake && ('));

  it('the actor chooses the verb', () => {
    expect(block).toContain('crm.journey.you_marked_no_show');
    expect(block).toContain('crm.journey.you_marked_held');
    expect(block).toContain('crm.journey.client_cancelled_meeting');
    expect(block).toContain('crm.journey.auto_marked');
  });

  it('falls back to the plain state where nobody recorded who', () => {
    /* Not an invented actor. The state alone is the honest answer for every
       row written before `outcome_by` existed. */
    expect(block).toContain('return word;');
  });

  it('mail says whose doing it was, in its opening words', () => {
    /* "Sent to the client" is the system; "you sent again" is the owner. The
       two rows were indistinguishable when both ended in "נשלח". */
    expect(TAB).toContain('crm.journey.mail_to_client');
    expect(TAB).toContain('crm.journey.mail_resent_by_you');
  });

  it('every sentence has a label in all three locales', () => {
    const keys = [
      'you_marked_held', 'you_marked_no_show', 'you_cancelled_meeting',
      'client_cancelled_meeting', 'auto_marked', 'you_moved',
      'mail_to_client', 'mail_resent_by_you',
      'attempt_current', 'show_history', 'hide_history',
      'changes_count', 'mails_count',
    ];
    for (const locale of ['he', 'en', 'es']) {
      const dict = read(`lib/business-os/translations/${locale}.ts`);
      for (const key of keys) expect(dict).toContain(`'crm.journey.${key}'`);
    }
  });
});

describe('the history is closed until asked for', () => {
  /*
   * Drawn always, a booking moved twice put nine lines between the owner and
   * the buttons they opened the card for — reported as "very overwhelming".
   */
  const rail = TAB.slice(TAB.indexOf("── THE MEETING'S HISTORY, AS SENTENCES ──"));
  const block = rail.slice(0, rail.indexOf('{isIntakeStep && hasIntake && ('));

  it('renders the chain only when open', () => {
    expect(block).toContain('{historyOpen && (');
  });

  it('the summary says HOW MUCH, never what', () => {
    /* The point of the collapse: it must not make the owner read the chain to
       find out whether there is one. */
    expect(TAB).toContain('crm.journey.changes_count');
    expect(TAB).toContain('crm.journey.mails_count');
  });

  it('the buttons are NOT inside it', () => {
    /*
     * They are why the card is open on most visits. A history of nine events
     * must never push them off the screen, so the action group sits outside
     * the collapsed region entirely.
     */
    const historyEnd = TAB.indexOf('{isIntakeStep && hasIntake && (');
    expect(TAB.indexOf('crm.booking.action.mark_held')).toBeGreaterThan(historyEnd);
    expect(TAB.indexOf('crm.booking.action.cancel_meeting')).toBeGreaterThan(historyEnd);
  });

  it('each attempt is a named milestone', () => {
    /* "First time / Second time / Current time" is what tells the reader where
       in the chain they are. */
    expect(block).toContain('crm.journey.attempt_current');
    expect(block).toContain('crm.journey.attempt_ordinal.');
  });

  it('and the MOVE between them is stated', () => {
    /*
     * The step the flat list never showed. Without it the chain listed times
     * but never the act of changing them, which is what made two emails under
     * one attempt look like a duplicate.
     */
    expect(block).toContain('movedSentence(');
    expect(TAB).toContain('crm.journey.you_moved');
  });
});

describe('the actor is recorded, never assumed', () => {
  const REPO = read('lib/repositories/SchedulingRepository.ts');

  it('complete and markNoShow take an actor', () => {
    expect(REPO).toContain("by: MeetingOutcomeActor = 'owner'");
    expect(REPO).toContain("meeting_status: 'held', outcome_by: by");
    expect(REPO).toContain("meeting_status: 'no_show', outcome_by: by");
  });

  it('cancel records who called it off', () => {
    /* Asserted on the write itself. Bounding the slice by a nearby identifier
       fails here: `cancellation_reason` appears in this method's doc comment
       long before its code, so the window closed before the body began. */
    expect(REPO).toContain('outcome_by: (structured?.cancelledBy');
  });

  it('the automated writers say system, not owner', () => {
    /*
     * `LeadResponseDispatchService` completes a booking when a lead replies and
     * the plugin executor marks outcomes for an agent. Neither is a person, and
     * recording the owner would attribute a decision they never made.
     */
    expect(read('lib/services/LeadResponseDispatchService.ts')).toContain("'system'");
    const plugin = read('lib/server/scheduling-plugin-executor.ts');
    expect(plugin).toContain("complete(params.id, userId, 'system')");
    expect(plugin).toContain("markNoShow(params.id, userId, 'system')");
  });

  it('a new attempt has no actor, because it has no outcome', () => {
    /*
     * The insert moved into `move_meeting` (20261087) — it had to, because the
     * attempt being left behind still holds its hour while the new one is
     * written, so a 60-minute appointment moved 30 minutes collided with
     * itself and was refused.
     *
     * The property is unchanged and now enforced by omission: the function's
     * INSERT never names `outcome_by` or `outcome_at`, so they take the
     * column default of NULL. A row claiming somebody recorded an outcome at
     * an appointment that has not happened is the thing being prevented.
     */
    const fn = read('supabase/migrations/20261087_moving_a_meeting_is_one_step.sql')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*--.*$/gm, '');
    const insert = fn.slice(fn.indexOf('INSERT INTO public.scheduling_meetings'));
    const columns = insert.slice(0, insert.indexOf(') VALUES'));

    expect(columns).not.toContain('outcome_by');
    expect(columns).not.toContain('outcome_at');
  });
});

describe('the confirmation node shows a CONFIRMATION, not any linked mail', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * WHAT WENT WRONG ON A REAL BOOKING
   *
   * The node titled "אישור הזמנה נשלח" rendered the RESCHEDULE notice. Two
   * causes compounded:
   *
   *   1. Every booking subject carries the service name —
   *        confirmation  "הפגישה שלך אושרה - {service}"
   *        reschedule    "הפגישה נקבעה מחדש - {service}"
   *      so a subject test that accepts the service name accepts both.
   *
   *   2. The picker fell back to `linked[0]` on the reasoning that a booking's
   *      first mail IS its confirmation. That only holds if the confirmation is
   *      linked, and on any booking predating 20261077 it is not — so the
   *      fallback returned whatever happened to be linked.
   *
   * The owner was left unable to tell whether the confirmation was ever sent.
   * ───────────────────────────────────────────────────────────────────────────
   */
  it('matches on confirmation WORDS, never the service name', () => {
    const strict = DRAWER.slice(DRAWER.indexOf('const saysConfirmed'));
    const body = strict.slice(0, strict.indexOf('};'));

    expect(body).toContain("includes('confirm')");
    /* The Hebrew confirmation says `אושרה`, never `אישור` — before the exact
       link existed it was found ONLY by the service-name clause, so dropping
       that clause without this word breaks Hebrew entirely. */
    expect(body).toContain('אושרה');
    expect(body).not.toContain('serviceName');
  });

  it('never falls back to the first linked mail', () => {
    /* Comments stripped: the note explaining this fallback's removal QUOTES
       it, so matching the raw source fails on the explanation. Which is the
       hazard this file's `code()` helper was written for. */
    expect(code(DRAWER)).not.toContain('?? linked[0]');
    expect(code(DRAWER)).toContain('linked.find(saysConfirmed)');
  });

  it('applies the strict test in BOTH copies', () => {
    /* `findConfirmationEmail` is declared twice — initial load and silent
       refresh. One fixed and one not shows a different mail after a refresh. */
    const declarations = DRAWER.match(/const findConfirmationEmail = \(/g) ?? [];
    const strictUses = DRAWER.match(/linked\.find\(saysConfirmed\)/g) ?? [];
    expect(strictUses.length).toBe(declarations.length);
  });

  it('the real subjects are told apart by that rule', () => {
    /* Fixtures lifted from `lib/email/templates/translations.ts`, so this fails
       if either subject is reworded into ambiguity. */
    const templates = read('lib/email/templates/translations.ts');
    expect(templates).toContain('הפגישה שלך אושרה - ${serviceName}');
    expect(templates).toContain('הפגישה נקבעה מחדש - ${serviceName}');

    const saysConfirmed = (subject: string) => {
      const s = subject.toLowerCase();
      return s.includes('confirm') || s.includes('אושרה') || s.includes('אישור');
    };

    const service = 'הצעת מחיר לשיפוץ';
    expect(saysConfirmed(`הפגישה שלך אושרה - ${service}`)).toBe(true);
    expect(saysConfirmed(`הפגישה נקבעה מחדש - ${service}`)).toBe(false);
    expect(saysConfirmed(`Your appointment is confirmed - ${service}`)).toBe(true);
    expect(saysConfirmed(`Appointment rescheduled - ${service}`)).toBe(false);
    expect(saysConfirmed(`Tu cita está confirmada - ${service}`)).toBe(true);
    expect(saysConfirmed(`Cita reprogramada - ${service}`)).toBe(false);
  });
});

describe('resending the confirmation sends the CURRENT time', () => {
  it('regenerates from the booking rather than replaying a stored body', () => {
    /*
     * The owner's question: the meeting moved, so what does "send again" send?
     *
     * `sendBookingConfirmation` reads the booking with `findById` and formats
     * `booking.start_time`, so the mail carries the time the appointment has
     * NOW. Replaying `email_sends.body_html` would send the superseded time to
     * a client who is already confused about which one is real.
     */
    const route = read('app/api/scheduling/bookings/[id]/confirmation/route.ts');
    expect(route).toContain('BookingEmailService.sendBookingConfirmation');
    expect(route).not.toContain('body_html');

    const service = read('lib/services/BookingEmailService.ts');
    const fn = service.slice(service.indexOf('static async sendBookingConfirmation'));
    const body = fn.slice(0, fn.indexOf('\n  static '));
    expect(body).toContain('schedulingBookingRepository.findById');
    expect(body).toContain('new Date(booking.start_time)');
  });
});

describe('cancelling the MEETING is not cancelling the job', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * The third thing that can happen to an appointment, and it had no control:
   * the owner and the client agree to proceed WITHOUT meeting. The site visit
   * is off, the quote still gets written.
   *
   * The only cancel on the card ended the whole job, so an owner in that
   * position either killed live work or left an appointment nobody would attend
   * sitting on the journey as an unanswered question.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const REPO = read('lib/repositories/SchedulingRepository.ts');
  const ROUTE = read('app/api/scheduling/bookings/[id]/meeting-cancel/route.ts');
  const GATE = read('lib/business-os/quoteGate.ts');

  it('writes the outcome and nothing else', () => {
    const fn = REPO.slice(REPO.indexOf('async cancelMeeting('));
    const body = code(fn.slice(0, fn.indexOf('\n  }')));

    expect(body).toContain("meeting_status: 'cancelled'");
    expect(body).toContain('outcome_by: by');
    /*
     * The job's own state must be untouched, or this becomes the action it
     * exists to be distinct from.
     *
     * Matched with a boundary: `meeting_status: 'cancelled'` CONTAINS
     * `status: 'cancelled'` as a substring, so a plain `not.toContain` fails
     * against the very line it is meant to approve.
     */
    expect(body).not.toMatch(/[^_\w]status: 'cancelled'/);
    expect(body).not.toContain('cancel_reason');
  });

  it('the route tells the client, in the wording for a meeting only', () => {
    /*
     * This asserted the OPPOSITE: no email, because "the client was party to
     * the decision". That holds when the two of them agreed to skip the
     * meeting, and not at all when the owner drops it alone — the client is
     * then left with an appointment in their calendar that nobody will
     * attend, and nothing ever told them.
     *
     * `meetingOnly` is the part that must not be lost. Without it the client
     * receives the ordinary cancellation: a subject reading "Appointment
     * cancelled - <service>", which is what arrives when the whole job stops,
     * and a money notice about a sum that did not move.
     */
    expect(ROUTE).toContain('cancelMeeting(');
    expect(code(ROUTE)).toContain('BookingEmailService.sendCancellationEmail');
    /* The owner's ANSWER, not a flag. `meetingOnly: true` used to be enough;
       it now carries whether the quote is still coming, because the email says
       opposite things in the two cases and the data cannot tell them apart. */
    expect(code(ROUTE)).toContain('meetingOnly: { proposalContinues }');
    expect(code(ROUTE)).toContain('proposalContinues: z.boolean().optional()');

    /*
     * The appointment IS cancelled, and a mail server having a bad minute must
     * not fail a request the owner saw succeed. That is the rule, and it still
     * holds.
     *
     * This asserted `.catch(` on a DETACHED call, which was the mechanism
     * rather than the rule — and the mechanism was wrong in a way that cost
     * something real: detached, the result was unreachable, so the route
     * answered `success` whether or not any mail went out. Two of five
     * owner-cancelled meetings on a live account produced no client email and
     * no `email_sends` row, and the owner was told the client had been told.
     *
     * The send is awaited now, inside a try/catch that swallows and logs. Same
     * guarantee — a failure cannot fail the request — and the route can
     * finally report whether the client heard, which is asserted below.
     */
    const send = code(ROUTE).slice(code(ROUTE).indexOf('sendCancellationEmail'));
    expect(send.slice(0, 900)).toContain('catch');
    expect(code(ROUTE)).toContain('clientNotified');
  });

  it('but not once the owner has said no quote is coming', () => {
    /*
     * `proposal_continues === false` is the owner answering, in the cancel
     * dialog, that the quote is not going ahead — and the client has been
     * emailed exactly that. Leaving "send a quote" on the step invites the one
     * action that contradicts the message already sent.
     *
     * `!== false` and not a truthiness check: NULL is nobody having been
     * asked, which is every booking whose meeting was never cancelled, and it
     * must change nothing.
     */
    expect(TAB).toContain('booking.proposal_continues !== false');
    expect(TAB).toContain("booking.proposal_continues === false");
    expect(TAB).toContain('crm.proposal.not_continuing');
  });

  it('the resend link sends the message it is attached to', () => {
    /*
     * ── WHAT THIS REPLACED ────────────────────────────────────────────────
     * The link always called the CONFIRMATION route, whatever row it sat on.
     * On a booking whose last mail was a cancellation it would have sent
     * "your appointment is confirmed" one line under "you cancelled the
     * meeting" — which is why it had to be hidden after any outcome, not
     * because resending was wrong but because it sent the wrong thing.
     */
    expect(TAB).toContain('onResendMail?.(booking.id');
    expect(TAB).toContain('onResendMail(booking.id, mail.kind as string)');
    /* And the gate that hid it after an outcome is gone: what limits it now is
       whether that KIND can be truthfully rebuilt. */
    expect(TAB).toContain("RESENDABLE_KINDS.has(mail.kind ?? '')");
  });

  it('and the card and the route agree on which kinds those are', () => {
    /*
     * Two lists, and they are only correct together. A kind in the route but
     * not the card hides a link the API would have honoured; a kind in the
     * card but not the route hands the owner a button that returns an error.
     */
    const list = (src: string, marker: string) => {
      const from = src.slice(src.indexOf(marker));
      return [...from.slice(0, from.indexOf(']')).matchAll(/'([a-z_]+)'/g)]
        .map(m => m[1])
        .sort();
    };

    const card = list(TAB, 'const RESENDABLE_KINDS = new Set([');
    const route = list(
      read('app/api/scheduling/bookings/[id]/resend/route.ts'),
      'const RESENDABLE = ['
    );

    expect(card.length).toBeGreaterThanOrEqual(5);
    expect(card).toEqual(route);
  });

  it('the ending node survives every path out of the builder', () => {
    /*
     * ── WHAT THIS CAUGHT ────────────────────────────────────────────────
     *
     * The node was PUSHED at the end of `buildJourneySteps`. That function has
     * three exits: the quoted-booking reorder returns early twice, to put the
     * quote after the meeting. So on a quoted job — the shape most likely to
     * be cancelled, and the one in front of the owner when they reported it —
     * the node silently did not exist, and a cancelled booking had no resend
     * anywhere on the card.
     *
     * Nothing failed. The journey rendered, one node short.
     *
     * So it is built once and appended at EVERY return, which is what
     * `withEnding` is for.
     */
    const DRAWER = read('components/crm/contact-drawer/CRMContactDrawerV2.tsx');

    const body = DRAWER.slice(
      DRAWER.indexOf('export function buildJourneySteps'),
      DRAWER.indexOf('function bookingLevelEmails(') > -1
        ? DRAWER.indexOf('function bookingLevelEmails(')
        : DRAWER.indexOf('function findCancellationEmail(')
    );

    /* Every `return` of a step list goes through the helper. */
    const returns = [...body.matchAll(/^\s*(?:if \([^)]*\) )?return (\[|steps|withEnding)/gm)].map(
      m => m[1]
    );
    expect(returns.length).toBeGreaterThanOrEqual(3);
    for (const r of returns) {
      expect({ returned: r }).toEqual({ returned: 'withEnding' });
    }

    /* And it is built from the JOB being off, never the meeting's own
       outcome — a cancelled meeting leaves the work running. */
    expect(body).toContain("booking.status === 'cancelled'");
    expect(body).toContain('Boolean(booking.cancel_reason)');
    expect(body).not.toMatch(/jobIsOff[\s\S]{0,120}meeting_status/);
  });

  it('and the rail says WHICH cancellation it was', () => {
    /* Two cancellations look identical on that row and mean opposite things:
       one drops the appointment and keeps the job, the other ends the quote
       with it. The client got one of two opposite emails. */
    expect(TAB).toContain('crm.journey.you_cancelled_meeting_and_quote');
    /* Only on the current attempt — the answer lives on the BOOKING and
       describes where the job stands now, not what was true for a superseded
       appointment.

       Matched as a pair rather than by slicing a window backwards: the
       explanatory comment sits between the two, so any fixed lookback is a
       guess about how long that comment is. */
    expect(TAB).toMatch(/isCurrentAttempt &&\s*booking\.proposal_continues === false/);
  });

  it('the quote stays the owner\'s move afterwards', () => {
    /* The whole purpose. Asking "what happened at this meeting?" about an
       appointment both parties called off has no answer, and it blocked the
       only move left. */
    expect(GATE).toContain("if (meetingStatus === 'cancelled') return 'open';");
  });

  it('the button names its own subject, and is not the red one', () => {
    /*
     * Two cancels on one card is only safe if each says what it cancels — the
     * owner's own correction on the earlier pair was "בוטלה need to be בטל
     * הזמנה". The red is reserved for ending the work.
     */
    /* Anchored on the call's OPENING, not its full argument list. The list
       gained `{ isQuoted }` and the old anchor stopped matching — `indexOf`
       then returned -1 and the slice silently became a window at the end of
       the file, which contains neither of the things asserted below. */
    const at = TAB.indexOf('onCancelMeeting(booking.id');
    expect(at).toBeGreaterThan(-1);
    const block = TAB.slice(at - 1600, at + 600);
    expect(block).toContain('crm.booking.action.cancel_meeting');
    expect(block).not.toContain('text-red-600');
  });

  it('has a label and a hint in all three locales', () => {
    for (const locale of ['he', 'en', 'es']) {
      const dict = read(`lib/business-os/translations/${locale}.ts`);
      expect(dict).toContain("'crm.booking.action.cancel_meeting'");
      expect(dict).toContain("'crm.booking.action.cancel_meeting_hint'");
    }
  });
});

describe('an email is tied to the attempt that was current when it was sent', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * WHY THIS NEEDED A ONE-OFF REPAIR
   *
   * `resolveMeetingId` takes the LATEST attempt, which is right: a mail going
   * out now is about the appointment as it stands now.
   *
   * It mis-filed anyway, because while `syncMeeting` moved an unmarked
   * appointment IN PLACE, one row held several times in succession — so every
   * mail sent across those moves pointed at the same row, and that row ended up
   * showing the final time. On ab48357a all three emails landed on the 15:00
   * attempt, including the notice announcing the move to 14:00.
   *
   * Every move now creates its own attempt, so "the latest attempt" and "the
   * appointment this mail is about" can no longer come apart.
   * `scripts/fix-email-attempt-attribution.sql` repaired the rows written
   * before that.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const RECORD = read('lib/notifications/recordEmailSend.ts');

  it('resolves to the LAST attempt, which is the current one', () => {
    const fn = RECORD.slice(RECORD.indexOf('async function resolveMeetingId'));
    const body = code(fn.slice(0, fn.indexOf('\n}')));

    /* `listAttempts` orders ascending, so the current attempt is the last. */
    expect(body).toContain('forBooking[forBooking.length - 1].id');
  });

  it('and every move records an attempt, so the latest is never stale', () => {
    /*
     * The other half. If a move could update in place, "the latest attempt"
     * would again be a row that goes on to hold a different time — which is
     * exactly the bug the repair had to clean up.
     */
    const REPO = read('lib/repositories/SchedulingRepository.ts');
    const sync = REPO.slice(REPO.indexOf('private async syncMeeting'));
    const body = code(sync.slice(0, sync.indexOf('catch (err)')));

    expect(body).toContain('if (movedInTime) {');
    /* The old rule required an outcome as well; it must not come back. */
    expect(body).not.toContain('outcomeRecorded && movedInTime');
  });
});

describe('the no-show email moves THIS appointment', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * The toggle in the no-show dialog offers to let the client pick a new time.
   * Its button pointed at `resolveBookingUrl` — the business's own booking
   * page, which is where a smart link goes — so a client who missed their slot
   * landed on a blank page to choose a service and re-enter their details,
   * while the appointment they had booked stayed exactly where it was. The
   * owner ended up with two records of one job, or none.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const SERVICE = read('lib/services/BookingEmailService.ts');
  const fn = SERVICE.slice(SERVICE.indexOf('sendMissedAppointmentEmail'));
  const body = fn.slice(0, fn.indexOf('\n  static '));

  it('signs a manage link for this booking', () => {
    expect(body).toContain('manageUrlFor(bookingId, booking.client_email');
  });

  it('and that link is the reschedule panel', () => {
    /* The same destination the reschedule email's own button uses. */
    const minter = SERVICE.slice(SERVICE.indexOf('function manageUrlFor'));
    expect(minter.slice(0, minter.indexOf('\n}'))).toContain('/reschedule');
  });

  it('keeps the booking page only as a fallback', () => {
    /*
     * `manageUrlFor` returns null with no APP_URL or no signing secret. A
     * client who can only rebook from scratch is better served than one who
     * gets no email at all — but it must not be the first choice.
     */
    expect(body).toContain('rescheduleUrl ?? (await resolveBookingUrl(');

    /* Comments stripped: the note above the change explains what it USED to
       point at, naming `resolveBookingUrl` in prose before the code reaches
       it — so an index comparison on the raw source measures the explanation,
       not the order of execution. */
    const onlyCode = code(body);
    expect(onlyCode.indexOf('manageUrlFor')).toBeLessThan(onlyCode.indexOf('resolveBookingUrl'));
  });
});

describe('a recorded answer can still be changed', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * All four meeting actions were gated on `!meetingSettled`, so recording any
   * outcome removed every one of them. An owner who marked a no-show by
   * mistake — or whose client turned up after all — had no way back from the
   * card. The journey treated a record as final when the thing it records is a
   * judgement made in a hurry.
   *
   * The stage now offers the OTHER answers and drops only the one already
   * given. The JOB being called off still hides them all: there is no
   * appointment left to judge.
   * ───────────────────────────────────────────────────────────────────────────
   */
  /* Anchored on `jobFinished`, which is declared BEFORE `meetingAnswerable` —
     a window starting at the latter missed the rule it depends on. */
  /* From `jobFinished` (the first rule) through the last flag that reads it.
     A fixed character count went stale the moment `meetingHappened` was added
     between them, so the end is anchored on the final declaration instead —
     `canCancelMeeting`, plus enough to cover its own body. */
  const gates = TAB.slice(
    TAB.indexOf('const jobFinished'),
    TAB.indexOf('const canCancelMeeting') + 400
  );

  it('the gate is the JOB, not whether an answer exists', () => {
    expect(gates).toContain('isScheduleStep && !jobCalledOff');
    expect(code(gates)).not.toContain('meetingSettled');
  });

  it('but a FINISHED job closes them too', () => {
    /*
     * `!jobCalledOff` alone was too wide. Booking 64834a57 — held, completed
     * and REFUNDED — was still offering "mark as no-show". Editing the
     * attendance of work that is done and whose money has gone back is not a
     * correction, it is rewriting a closed record.
     *
     * `status === 'completed'` is usable here only BECAUSE of the split:
     * `complete()` stopped writing it, so a meeting marked held today keeps
     * `confirmed` and stays correctable, while a legacy row carrying
     * `completed` is a job its owner closed. Before the split the same test
     * would have closed the buttons the moment anyone marked a meeting.
     */
    expect(gates).toContain('const jobFinished');
    expect(gates).toContain("booking.status === 'completed'");
    expect(gates).toContain('moneyReturned');
    expect(gates).toContain('!jobCalledOff && !jobFinished');
  });

  it('a meeting that HAPPENED stops being asked about', () => {
    /*
     * The outcomes are not interchangeable, and treating them as one rule was
     * the bug. After marking held the card still offered "change the time",
     * "cancel the meeting" and "mark as no-show" for an appointment that had
     * already taken place — reported as: if the owner said completed, how come
     * it is offering no-show?
     *
     * Held answers the question, so every control goes. A no-show does not —
     * that appointment is unresolved, and its controls stay.
     */
    expect(gates).toContain('const meetingHappened');

    /* All three of the outcome controls close on it. `canMarkHeld` needs no
       such gate: `!== 'held'` already is one. */
    for (const flag of ['const canMarkNoShow', 'const canCancelMeeting']) {
      const decl = gates.slice(gates.indexOf(flag), gates.indexOf(flag) + 220);
      expect(decl).toContain('!meetingHappened');
    }
    /* And the reschedule button, which is gated inline in the JSX. */
    expect(TAB).toContain(
      'meetingAnswerable && !meetingHappened && !meetingCancelled && onEditSession'
    );
  });

  it('a meeting CALLED OFF keeps only the way to a new time', () => {
    /*
     * Reported from the card: after cancelling the meeting it still offered
     * "mark as held" and "mark as no-show". Neither is a correction — they are
     * rival accounts of an hour that was called off, and one of them says the
     * client failed to turn up to an appointment nobody expected them at.
     *
     * Rescheduling stays, and is the difference from `held`: a cancellation
     * leaves the job wanting an appointment.
     */
    expect(gates).toContain('const meetingCancelled');
    for (const flag of ['const canMarkHeld', 'const canMarkNoShow']) {
      const decl = gates.slice(gates.indexOf(flag), gates.indexOf(flag) + 260);
      expect(decl).toContain('!meetingCancelled');
    }
    /* And moving it is not a move either: the next step after a cancellation
       is a NEW appointment, which is the rule the card already applies to a
       no-show. Gated inline in the JSX. */
    expect(TAB).toContain(
      'meetingAnswerable && !meetingHappened && !meetingCancelled && onEditSession'
    );
  });

  it('and "send again" is limited by the KIND, not by the outcome', () => {
    /*
     * This used to assert the opposite, and the reasoning was sound at the
     * time: the link always regenerated the CONFIRMATION, so after a meeting
     * was held or called off there was nothing to confirm and it had to be
     * hidden — it sat on the newest mail, which after a no-show is "we missed
     * you", one line above "you marked it as held".
     *
     * It now sends the kind it is attached to, so the outcome is no longer
     * what limits it. What does is whether that message can be truthfully
     * rebuilt from where the booking stands now.
     */
    const resend = TAB.slice(TAB.indexOf('isLatest &&'));
    expect(resend.slice(0, 400)).toContain("RESENDABLE_KINDS.has(mail.kind ?? '')");
    expect(resend.slice(0, 400)).not.toContain("booking.meeting_status !== 'held'");

    /*
     * ── AND WHERE IT GOES ONCE THE JOB IS OFF ───────────────────────────
     *
     * The resend must survive a cancellation: a client who cannot find the
     * message is exactly who needs it again. But the message they need is the
     * CANCELLATION, and this rail holds mail about the APPOINTMENT — every one
     * of which is superseded the moment the work stops.
     *
     * Observed with the gate removed: "send again" on the last rail row
     * re-sent "the meeting is off, your quote is still coming" twenty minutes
     * after the whole booking had been cancelled.
     *
     * So the rail yields and the cancellation node takes it over, offering
     * `booking_cancelled` — the one message still true.
     */
    expect(resend.slice(0, 700)).toContain('!jobCalledOff');
    expect(TAB).toContain("onResendMail(booking.id, 'booking_cancelled')");
    expect(TAB).toContain("const isCancelledStep = step.key === 'cancelled'");

    /* The node's link is NOT gated on the job being live — that would leave a
       cancelled booking with no resend anywhere, which is the complaint this
       whole pair exists to answer. */
    const node = TAB.slice(TAB.indexOf('{isCancelledStep && ('));
    expect(node.slice(0, 1800)).not.toContain('jobCalledOff');
  });

  it('each action drops only its own answer', () => {
    expect(gates).toContain("booking.meeting_status !== 'held'");
    expect(gates).toContain("booking.meeting_status !== 'no_show'");
    expect(gates).toContain("booking.meeting_status !== 'cancelled'");
  });

  it('no meeting action is gated on meetingSettled any more', () => {
    /* The whole bug in one line: four gates sharing a condition that went true
       the moment any of them was used. */
    const onlyCode = code(TAB);
    expect(onlyCode).not.toContain('isScheduleStep && !meetingSettled');
  });

  it('and the step still earns a body, or the buttons render into a collapsed card', () => {
    /*
     * `hasCardBody` listed the same `!meetingSettled` condition. Left behind,
     * the buttons would exist and the card would draw no body to put them in —
     * which looks exactly like the bug being reported, one layer further in.
     */
    expect(code(TAB)).toContain('(isScheduleStep && !jobCalledOff) ||');
  });

  it('`jobCalledOff` is declared before the gate reads it', () => {
    /* TDZ: this file has produced that crash twice. */
    expect(TAB.indexOf('const jobCalledOff =')).toBeLessThan(TAB.indexOf('const meetingAnswerable'));
  });
});

describe('a resend is not shown as an original', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * Under the 14:00 attempt the rail showed a reschedule notice and a
   * confirmation, both reading "נשלח". The confirmation was the owner pressing
   * "send again", so the card said a confirmation went out during that attempt
   * when nothing new had been agreed.
   *
   * RECORDED, NEVER DERIVED. The obvious derivation — "this subject appeared
   * earlier, so it is a repeat" — is wrong in a way that would have shipped
   * looking right: every reschedule notice carries the SAME subject, one per
   * move, so the second genuine notice would be labelled a resend of the first.
   * Narrowing to one attempt does not save it either, because the original
   * confirmation predates `booking_id` and carries no link at all.
   * ───────────────────────────────────────────────────────────────────────────
   */
  it('the route that resends says so', () => {
    const route = read('app/api/scheduling/bookings/[id]/confirmation/route.ts');
    expect(route).toContain('isResend: true');
  });

  it('the flag reaches the stored row', () => {
    const RECORD = read('lib/notifications/recordEmailSend.ts');
    expect(RECORD).toContain('is_resend: isResend ?? false');
  });

  it('the rail labels it as a repeat', () => {
    const block = TAB.slice(
      TAB.indexOf('booking.attempts?.length'),
      TAB.indexOf('{isIntakeStep && hasIntake && (')
    );
    expect(block).toContain('crm.journey.mail_resent');
    expect(block).toContain('mail.isResend');
  });

  it('but a failure still wins the row', () => {
    /*
     * That it bounced matters more than that it was a repeat, so a failed mail
     * keeps the envelope and shows its delivery status.
     *
     * The verb now carries "resend", so the old `mailFailed || !mail.isResend`
     * ternary around the status word is gone: the status renders only when the
     * mail FAILED, and the opening words say whose doing it was either way.
     */
    const row = TAB.slice(TAB.indexOf('const renderMailRow'));
    const body = row.slice(0, row.indexOf('\n                                  };'));

    expect(body).toContain("mail.status === 'bounced'");
    expect(body).toContain('{failed && (');
    expect(body).toContain('crm.email.status.${mail.status}');
    /* And a resend that failed is drawn as a failure, not as a resend. */
    expect(body).toContain('mail.isResend && !failed');
  });

  it('is read from the column, never derived', () => {
    /*
     * The derivation that looks right and is not: "this subject appeared
     * earlier, so it is a repeat" mislabels the second genuine reschedule
     * notice, since they all share one subject.
     *
     * Asserted as "the value comes from the stored column". A regex hunting for
     * `isResend` near `subject` was tried and is NOT the test: the rail renders
     * the flag and the subject in one expression, so it matched the correct
     * code and failed on it.
     */
    expect(code(read('components/crm/contact-drawer/CRMContactDrawerV2.tsx')))
      .toContain('isResend: email.is_resend ?? false');
  });

  it('has a label in all three locales', () => {
    for (const locale of ['he', 'en', 'es']) {
      expect(read(`lib/business-os/translations/${locale}.ts`))
        .toContain("'crm.journey.mail_resent'");
    }
  });
});

describe('closing the meeting is absorbed, never demanded', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE DECISION THIS PROTECTS
   *
   * The quote stage is reachable while the meeting is still unanswered, and it
   * must stay that way. `bookingStatus` records why: an unmarked past meeting
   * is "the ordinary state, not an error — owners quote from the van and rarely
   * tick an appointment first". Gating the quote on the tick would block the
   * commonest sequence, standing between an owner and the price they just
   * promised a client.
   *
   * The failure modes are not comparable. A quote stopped by bookkeeping can
   * cost the job; a meeting marked an hour late costs a slightly stale figure —
   * and `meeting_unmarked` already chases it after two hours.
   *
   * So closing the meeting rides along with sending the quote: one press, both
   * facts. Visible and ticked, never silent.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const MODAL = read('components/crm/contact-drawer/ProposalBuilderModal.tsx');

  it('the quote is never gated on the meeting being marked', () => {
    /*
     * The regression this exists to catch: a future edit making `canSend`
     * depend on the meeting's state. Sending must depend on the QUOTE being
     * complete and nothing else.
     */
    const send = MODAL.slice(MODAL.indexOf('const handleSend = async () => {'));
    const body = code(send.slice(0, send.indexOf('\n  };')));

    expect(body).not.toMatch(/if \([^)]*offerMarkHeld[^)]*\)\s*(return|\{[\s\S]{0,40}return)/);
    expect(code(MODAL)).not.toMatch(/canSend[^;]*meeting_status/);
  });

  it('it is a visible control, ticked by default', () => {
    /* Ticked because quoting usually means you met. Visible because "usually"
       is not "always" — a job agreed without meeting is exactly what the
       cancel-meeting action is for. */
    expect(MODAL).toContain('useState(true)');
    expect(MODAL).toContain('type="checkbox"');
    expect(MODAL).toContain('proposal.also_mark_held');
  });

  it('marks only AFTER the send succeeded', () => {
    /*
     * Order matters. The quote going out is what the owner asked for; marking
     * is the convenience riding along. Marked first, a failed send would leave
     * a meeting recorded as held for a quote that never left.
     */
    const send = MODAL.slice(MODAL.indexOf('const handleSend = async () => {'));
    const body = send.slice(0, send.indexOf('\n  };'));

    expect(body.indexOf('onMarkHeld()')).toBeGreaterThan(body.indexOf('sendRes'));
    /* And a marking failure must not report the send as failed. */
    expect(body).toContain('Quote sent, but the meeting could not be marked held');
  });

  it('is offered only where there is something to close', () => {
    const DRAWER_SRC = read('components/crm/contact-drawer/CRMContactDrawerV2.tsx');
    const offer = DRAWER_SRC.slice(DRAWER_SRC.indexOf('offerMarkHeld={(() => {'));
    const body = offer.slice(0, offer.indexOf('})()}'));

    /* Already answered: nothing to record. */
    expect(body).toContain('if (b.meeting_status) return false;');
    /* Still ahead: nothing has happened yet. */
    expect(body).toContain('<= Date.now()');
    /* Bought rather than booked: no appointment at all. */
    expect(body).toContain('if (!b?.start_time) return false;');
  });

  it('records it through the same endpoint as the button', () => {
    /* One way to record attendance. It writes `meeting_status` only, which is
       what lets the job stay open and be quoted afterwards. */
    const DRAWER_SRC = read('components/crm/contact-drawer/CRMContactDrawerV2.tsx');
    expect(DRAWER_SRC).toMatch(/onMarkHeld=\{async[\s\S]{0,900}\/complete`/);
  });
});
