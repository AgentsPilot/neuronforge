import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Mail sent ABOUT an appointment has to say which one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS CAUGHT
 *
 * The contact drawer's journey matches mail to an attempt on
 * `email_sends.meeting_id` — a recorded link, deliberately not a guess from
 * time and subject, because a booking rescheduled twice has three attempts that
 * no time-based heuristic can tell apart.
 *
 * `recordEmailSend` fills that column itself: give it `bookingId` and
 * `resolveMeetingId` resolves the attempt. Give it neither and the row is
 * written with both columns NULL, which matches no attempt and renders as
 * nothing at all. The mail goes out, the client reads it, and the card is
 * silent — a failure with no error anywhere.
 *
 * Both of `sendMeetingReminder`'s sends had exactly that shape.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT IS A SOURCE GUARD
 *
 * The defect is an omitted optional field. Every unit test still passes, the
 * types are satisfied, and the call succeeds — there is no behaviour to assert
 * on. What is wrong is visible only in the call's shape.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('mail about an appointment is linked to it', () => {
  const SERVICE = readFileSync(
    join(__dirname, '..', 'BookingEmailService.ts'),
    'utf-8'
  );

  /**
   * Each `recordEmailSend({ … })` call with the argument object that follows it.
   * Brace-matched rather than line-counted: a fixed window silently stops
   * covering a call as soon as a comment is added inside it.
   */
  function callSites(source: string): string[] {
    const sites: string[] = [];
    const OPEN = 'recordEmailSend({';
    let from = 0;
    for (;;) {
      const start = source.indexOf(OPEN, from);
      if (start === -1) return sites;
      let depth = 0;
      let i = start + OPEN.length - 1;
      for (; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}' && --depth === 0) break;
      }
      sites.push(source.slice(start, i + 1));
      from = i + 1;
    }
  }

  it('every send that has a booking in hand passes its id', () => {
    const offenders = callSites(SERVICE)
      .filter(site => /\bbooking\.\w+/.test(site))
      .filter(site => !site.includes('bookingId'));

    /*
     * Reads `booking.something` but records no `bookingId`. If a send genuinely
     * is not about the appointment, it should not be reaching for the booking's
     * fields either.
     */
    expect(offenders).toEqual([]);
  });

  it('the reminders in particular, which is where it was missing', () => {
    const reminder = SERVICE.slice(
      SERVICE.indexOf('sendMeetingReminder'),
      SERVICE.indexOf('sendIntakeFormRequest')
    );
    expect(reminder).not.toHaveLength(0);

    const sends = callSites(reminder);
    /* One to the client, one to the owner. */
    expect(sends).toHaveLength(2);
    for (const send of sends) expect(send).toContain('bookingId: booking.id');
  });

  it('only mail ABOUT an appointment is filed under one', () => {
    /*
     * ── WHAT THIS CAUGHT ────────────────────────────────────────────────
     *
     * `resolveMeetingId` files a mail under the booking's CURRENT attempt
     * whenever it is handed a booking and no meeting. Right for a confirmation
     * or a reschedule notice; wrong for everything else, because the journey
     * draws its rail from exactly that link.
     *
     * So a booking cancellation — a fact about the whole job — appeared inside
     * the meeting's history, directly under "you cancelled the meeting". Two
     * different events reading as one, reported from the card. The payment
     * receipt and the refund notice had the same shape.
     */
    const RECORDER = readFileSync(
      join(__dirname, '..', '..', 'notifications', 'recordEmailSend.ts'),
      'utf-8'
    );

    const from = RECORDER.slice(RECORDER.indexOf('const ABOUT_ONE_APPOINTMENT'));
    const listed = [...from.slice(0, from.indexOf(']')).matchAll(/'([a-z_]+)'/g)].map(m => m[1]);

    /* The six that genuinely describe one hour. */
    expect(listed.sort()).toEqual(
      [
        'booking_confirmed',
        'booking_rescheduled',
        'meeting_cancelled',
        'meeting_reminder',
        'meeting_reminder_owner',
        'missed_appointment',
      ].sort()
    );

    /* And the job-level ones are deliberately absent, which is the half that
       was wrong. */
    for (const jobLevel of ['booking_cancelled', 'payment_receipt', 'refund_confirmed']) {
      expect({ jobLevel, listed: listed.includes(jobLevel) }).toEqual({ jobLevel, listed: false });
    }

    expect(RECORDER).toContain('if (kind && !ABOUT_ONE_APPOINTMENT.has(kind)) return null;');
  });

  it('and the two cancellations do not share a subject line', () => {
    /*
     * One ends the appointment and keeps the work; the other ends the booking.
     * While both read "Appointment cancelled" a client could take either for
     * the other — and the meeting-only variant exists precisely to say the
     * quote is still coming.
     */
    const COPY = readFileSync(
      join(__dirname, '..', '..', 'email', 'templates', 'translations.ts'),
      'utf-8'
    );
    const cancellation = COPY.slice(COPY.indexOf('bookingCancellation: {'));

    expect(cancellation.slice(0, 3000)).toContain('`Booking cancelled - ${serviceName}`');
    /* The meeting-only subject names the DATE, so the two cannot be confused. */
    expect(cancellation).toContain('meetingOnlySubject');
  });

  it('every kind a sender declares has a label in every language', () => {
    /*
     * An unlabelled kind degrades to the subject rather than showing
     * `booking_confirmed` to an owner, so this is not a crash waiting to
     * happen — it is a row quietly reverting to the noisy rendering the kind
     * was added to replace, in one language only. That is the kind of gap
     * nobody reports and nobody notices.
     */
    const RECORDER = readFileSync(
      join(__dirname, '..', '..', 'notifications', 'recordEmailSend.ts'),
      'utf-8'
    );
    /*
     * Bounded by the blank line that ends the declaration, not by the first
     * `;`. A doc comment between two members contained one ("called off; the
     * job continues") and silently cut the union to three entries — the guard
     * went green over a list it was no longer reading.
     */
    const from = RECORDER.slice(RECORDER.indexOf('export type EmailKind'));
    const union = from.slice(0, from.indexOf('\n\n'));
    const kinds = [...union.matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
    expect(kinds.length).toBeGreaterThanOrEqual(13);

    /* Read as text, not imported: these files are large, and the point is that
       the key is PRESENT, which the module shape cannot show. */
    for (const lang of ['he', 'en', 'es']) {
      const file = readFileSync(
        join(__dirname, '..', '..', 'business-os', 'translations', `${lang}.ts`),
        'utf-8'
      );
      const missing = kinds.filter(
        k => !file.includes(`'crm.journey.mail_kind.${k}'`)
      );
      expect({ lang, missing }).toEqual({ lang, missing: [] });
    }
  });

  it('and no label carries a dash between clauses', () => {
    /* The owner reads these. An em dash is not ours to put in front of one,
       and this is 39 hand-written strings at once. */
    for (const lang of ['he', 'en', 'es']) {
      const file = readFileSync(
        join(__dirname, '..', '..', 'business-os', 'translations', `${lang}.ts`),
        'utf-8'
      );
      /*
       * The journey's own copy, and the proposal strip directly beneath it —
       * one card, so one rule. Ten of these shipped with a dash before anyone
       * read the card as a whole.
       */
      const offenders = file
        .split('\n')
        .filter(
          l =>
            l.includes('crm.journey.mail_kind.') ||
            l.includes("'crm.proposal.") ||
            /* Every line the owner reads as a toast after an action. One of
               them shipped with a dash and was only found by reading them all
               out loud. */
            /'crm\.(booking|stage|intake|invoice|refund)\.[a-z_]*(sent|done|marked|invoiced|cancelled)/.test(l)
        )
        .filter(l => l.includes('\u2014') || l.includes('\u2013'));
      expect({ lang, offenders }).toEqual({ lang, offenders: [] });
    }
  });

  it('no translation key is defined twice', () => {
    /*
     * A duplicate key is legal JavaScript — the last one wins — so nothing
     * fails and no test notices. What it does do is make the module a
     * re-declaration error for the dev compiler, which can leave the OLD
     * translations cached while the component that needed the NEW ones
     * reloads: the string renders in English, in an otherwise Hebrew card,
     * and the key looks missing when it is right there in the file.
     *
     * That is exactly how it was found, and it cost a reload to understand.
     * It also hides a real mistake: adding a key that already exists means
     * two places now claim to own one piece of copy.
     */
    for (const lang of ['he', 'en', 'es']) {
      const file = readFileSync(
        join(__dirname, '..', '..', 'business-os', 'translations', `${lang}.ts`),
        'utf-8'
      );
      const keys = [...file.matchAll(/^ *'([^']+)':/gm)].map(m => m[1]);
      const seen = new Set<string>();
      const duplicates = [...new Set(keys.filter(k => seen.size === seen.add(k).size))];
      expect({ lang, duplicates }).toEqual({ lang, duplicates: [] });
    }
  });

  it('and the contact-form mail deliberately does NOT claim a booking', () => {
    /*
     * `sendWelcomeEmail` and `sendReturningContactEmail` answer a contact form.
     * There is no appointment to file them under, and inventing one would put a
     * message on a journey it has nothing to do with. Their absence from the
     * rail is correct, so this records the distinction rather than leaving the
     * rule above looking under-applied.
     */
    for (const fn of ['sendWelcomeEmail', 'sendReturningContactEmail']) {
      const start = SERVICE.indexOf(`${fn}(`);
      expect(start).toBeGreaterThan(-1);
      const sends = callSites(SERVICE.slice(start, start + 9000));
      expect(sends[0]).not.toContain('bookingId');
    }
  });
});
