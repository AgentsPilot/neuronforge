/**
 * The dialog that times a session shows a time picker.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BUG
 *
 * Whether this dialog asks for a date is decided by the SERVICE's client
 * journey, and for a package that answer is correctly NO: a course is bought,
 * not booked into an hour, `is_scheduled` is false on it, and no client was
 * ever shown a picker for it. That rule exists because the owner opening the
 * course from the drawer used to be made to choose a date it has no use for.
 *
 * But a package's SESSIONS each have an hour, and this same dialog is how both
 * of them are chosen. Asked of the service alone, it hid the picker in exactly
 * the two places whose only job is to pick a time:
 *
 *   · "change meeting time" opened with no time fields at all — nothing to
 *     change, on a dialog opened to change it;
 *   · "add another meeting" the same, on a flow whose entire purpose is to
 *     name an hour.
 *
 * Neither has to be inferred from the service, because both say so when they
 * open the dialog.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const read = (p: string) =>
  fs.readFileSync(path.join(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n');

const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const modal = code('components/scheduling/SchedulingBookingModal.tsx');

describe('a dialog opened to time something asks for a time', () => {
  it('needs a schedule when a session is being moved', () => {
    expect(modal).toContain('Boolean(rescheduleMeetingId)');
  });

  it('and when the caller wants only an hour', () => {
    /* `onPickSlot` IS the add-a-meeting flow: it returns a slot and writes
       nothing, so a dialog without a picker returns nothing at all. */
    expect(modal).toContain('Boolean(onPickSlot)');
  });

  it('decides it before falling back to the service', () => {
    /*
     * Order is the fix. The service's answer is right about the PURCHASE and
     * wrong about its sessions, so it may only be consulted once neither
     * caller has already said yes.
     */
    const line = modal.slice(modal.indexOf('const needsSchedule ='));
    const expression = line.slice(0, line.indexOf(';'));

    expect(expression).toContain('timingAMeeting');
    const timingAt = expression.indexOf('timingAMeeting');
    const serviceAt = expression.indexOf('journeySteps');
    expect(serviceAt).toBeGreaterThan(timingAt);
  });

  it('still asks nothing of the purchase itself', () => {
    /*
     * The rule this was built on must survive: opening the course from the
     * drawer — no session named, no slot wanted — asks for no date, because
     * its journey has no scheduling step.
     */
    const line = modal.slice(modal.indexOf('const needsSchedule ='));
    const expression = line.slice(0, line.indexOf(';'));

    expect(expression).toContain("journeySteps(selectedService).includes('datetime')");
  });
});

describe('and the hour it collects is the hour that gets written', () => {
  const route = code('app/api/scheduling/meetings/[id]/reschedule/route.ts');

  it('honours an explicit end, which the dialog always sends', () => {
    /*
     * The dialog posts both ends, because an owner moving a session can also
     * lengthen it. Re-deriving the length from the old attempt instead meant a
     * session stretched to 90 minutes moved to the right hour and silently
     * stayed 60.
     */
    expect(route).toContain('input.end_time');
    expect(route).toContain('explicitEnd');
  });

  it('falls back to the length it already had', () => {
    /* The common case: most moves change when an hour starts, not how long it
       runs, and the caller should not have to restate it. */
    expect(route).toContain('previousMinutes');
  });

  it('refuses an end that is not after its start', () => {
    /* A backwards range would be written as a negative interval, which the
       table's own time-order check refuses — better to ignore it here and use
       the length. */
    expect(route).toContain('explicitEnd.getTime() > start.getTime()');
  });
});

describe('and nothing else on the dialog pretends to be editable', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * Every step carries a "change" link, which is right when the dialog is
   * editing a booking. It is wrong when it is timing a SESSION: the service
   * and the client belong to the purchase and are shared by all six, and the
   * move endpoint reads a start and an end and nothing else.
   *
   * So the link was not merely untidy, it WORKED — reopen the client step,
   * change it, press save, and the new time is written while the rest is
   * discarded without a word.
   * ───────────────────────────────────────────────────────────────────────────
   */
  for (const step of ['service', 'client', 'details']) {
    it(`withholds the change link on the ${step} step`, () => {
      expect(modal).toContain(`onEdit={timingAMeeting ? undefined : reopen('${step}')}`);
    });
  }

  it('keeps it on the time step, which is the one thing a move changes', () => {
    expect(modal).toContain("onEdit={reopen('when')}");
  });

  it('and the link is hidden by absence, not by styling', () => {
    /* `BookingStep` renders the control only when it is given a handler, so an
       undefined `onEdit` is genuinely unreachable rather than invisible and
       still clickable — the mistake that left a tap target over nothing. */
    const step = read('components/scheduling/BookingStep.tsx');
    expect(step).toContain('{onEdit && (');
  });
});

describe('and the picker has a length to search with', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * The picker opened and said "אין שעות פנויות בשבוע הזה" — no free hours this
   * week — about a week with nothing in it at all.
   *
   * Every slot is built from a duration, and a package SERVICE keeps none: it
   * is bought rather than booked into an hour, so `duration_minutes` is null
   * and `is_scheduled` is false. The strip asked for slots of zero minutes,
   * the route refused at its own guard, and the dialog reported a full diary.
   *
   * The length lives on the quote that sold the sessions, and the session
   * being moved already carries it in its own hours.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const step = read('components/scheduling/BookingTimeStep.tsx');
  const route = read('app/api/scheduling/free-slots/route.ts');

  it('the strip sends a duration when it is given one', () => {
    expect(step).toContain("params.set('duration_minutes', String(durationMinutes))");
  });

  it('and refetches when it changes', () => {
    /* The length decides which slots exist, so a different one is a different
       answer. */
    const deps = step.slice(step.indexOf('/api/scheduling/free-slots?')).match(/\}, \[([^\]]*)\]\);/)?.[1];
    expect(deps).toContain('durationMinutes');
  });

  it('the route accepts it, bounded', () => {
    expect(route).toContain('duration_minutes: z.coerce.number().int().min(5).max(1440).optional()');
  });

  it('but prefers the service, so an ordinary booking cannot be shortened', () => {
    /* A caller must not be able to ask for a 15-minute slot on an hour-long
       service and be shown times that service does not sell. */
    expect(route).toContain('service.duration_minutes ?? query.duration_minutes ?? 0');
  });

  it('a move takes the length from the hour it is moving', () => {
    expect(modal).toContain('const sessionLengthMinutes =');
    expect(modal).toContain('new Date(booking.end_time).getTime() - new Date(booking.start_time).getTime()');
  });

  it('and an added session is told it by the quote that sold them', () => {
    const drawerSrc = read('components/crm/contact-drawer/CRMContactDrawerV2.tsx');
    expect(drawerSrc).toContain('sessionMinutes: Number(sold?.sessions?.duration_minutes) || null');
    expect(drawerSrc).toContain('sessionMinutes={addMeetingTo?.sessionMinutes}');
  });
});

describe('adding a session knows which package it is joining', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * The dialog opened on NO service: step one blank, and the time step blank
   * beneath it because the slot strip had nothing to ask about.
   *
   * Both from one missing id. The container was looked up in `allBookings` —
   * the diary — and a package's purchase carries no clock, so it need not be
   * there at all. And the service step is deliberately locked while adding a
   * meeting ("it inherits the package's service"), so the owner could neither
   * be given a service nor pick one.
   *
   * The same block read the existing dates through `parent_booking_id`, which
   * now matches nothing: the series read as having no rhythm, and a course
   * running every Wednesday at 10:00 was offered "tomorrow".
   * ───────────────────────────────────────────────────────────────────────────
   */
  const drawerSrc = read('components/crm/contact-drawer/CRMContactDrawerV2.tsx')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  const handler = drawerSrc.slice(drawerSrc.indexOf('onAddPackageMeeting={containerId =>'));
  const body = handler.slice(0, handler.indexOf('setShowBookingModal(true)'));

  it('takes the package from the card the button sits on', () => {
    expect(body).toContain('findSession(containerId)');
    expect(body).toContain('packageCard?.booking ??');
  });

  it('finds the HOST card when the package was absorbed into it', () => {
    /*
     * ─────────────────────────────────────────────────────────────────────
     * `foldPackageMeetings` absorbs a package into the booking its quote came
     * out of, when that booking is on screen — one journey, with the sessions
     * under the quote that sold them. So the container is not a card at all
     * for any package sold from a consultation, and looking it up by id
     * returns nothing.
     *
     * Both blank steps came from here: no service to inherit, and no sessions
     * to read the rhythm from, so the dialog could neither name the service
     * nor open on the next date in the series.
     * ─────────────────────────────────────────────────────────────────────
     */
    expect(body).toContain("step.key === 'package'");
    expect(body).toContain('containerId');
  });

  it('and asks the QUOTE when neither the card nor the diary answers', () => {
    /*
     * The quote is the thing that defines what a package sells, and the one
     * source that cannot be missing for a package that exists. An empty id is
     * not a blank field here, it is a dead end: the service step is locked
     * while adding a meeting, so the owner can neither be given a service nor
     * choose one — and the slot strip below is fed `formData.service_id`, so
     * it has nothing to ask about and renders an empty step.
     */
    expect(body).toContain("container?.service_id || sold?.service_id || ''");
  });

  it('still falls back to the diary, for a package of child bookings', () => {
    expect(body).toContain('allBookings.find(item => item.id === containerId)');
  });

  it('reads the series from the sessions the card holds', () => {
    /* `parent_booking_id` matches nothing now; without this the rhythm is
       invisible and the dialog guesses. */
    expect(body).toContain('packageCard?.meetings ?? []');
  });

  it('and keeps the old shape beneath it', () => {
    expect(body).toContain("item.parent_booking_id === containerId");
  });

  it('carries the session length, so the strip can find hours', () => {
    expect(body).toContain('sessionMinutes:');
  });
});

describe('the dialog opens in one shape', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * "בחירה מהירה" offered the series' remaining dates as a row of cards. They
   * made sense before the dialog could open ON the series date — it can now,
   * so they repeated a choice already made.
   *
   * And they rendered before the slots had loaded, so the dialog appeared in
   * one shape and rearranged itself into another a second later.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const drawerSrc = read('components/crm/contact-drawer/CRMContactDrawerV2.tsx')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('does not hand the dialog quick-pick chips', () => {
    expect(drawerSrc).not.toContain('seriesSlots=');
  });

  it('but still opens on the next date in the series', () => {
    /* The chips are gone, not the behaviour they stood for. */
    expect(drawerSrc).toContain('prefilledStartLocal={addMeetingTo?.nextLocal');
  });
});

describe('the button says what pressing it creates', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * "צור הזמנה" — create an order — is right when this dialog SELLS something:
   * a booking is an order and the client is agreeing to it.
   *
   * A seventh session of a package is neither. The order was placed when the
   * quote was accepted and paid for by stage; this adds an hour to it. The
   * dialog's own title already said "פגישה חדשה" while its button said order,
   * which is two names for one action on one screen.
   * ───────────────────────────────────────────────────────────────────────────
   */
  it('creates a MEETING when the caller only wants an hour', () => {
    expect(modal).toContain("onPickSlot\n                            ? t('scheduling.booking.create_meeting')");
  });

  it('and still creates a BOOKING everywhere else', () => {
    expect(modal).toContain("t('scheduling.booking.create_booking')");
  });

  it('named in every language', () => {
    for (const file of ['en', 'he', 'es']) {
      expect(read(`lib/business-os/translations/${file}.ts`)).toContain(
        "'scheduling.booking.create_meeting':"
      );
    }
  });
});

describe('an added session opens on the series date, not on the picker', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * The hour step was forced open for every slot pick, on the reasoning that
   * the dialog "defaults a start time" — so the one question being asked would
   * otherwise open collapsed.
   *
   * That default is no longer a default: the dialog opens on the hour the
   * SERIES says comes next, at the same time as the others. An answer the
   * owner usually accepts, so a week of slots in front of it is a decision
   * already made being asked again.
   * ───────────────────────────────────────────────────────────────────────────
   */
  it('collapses the hour when the series named one', () => {
    expect(modal).toContain("openedStep ?? (onPickSlot && !prefilledStartLocal ? 'when' : null)");
  });

  it('and still opens it when nothing could', () => {
    /* A package with no rhythm to read suggests no date, and then the hour is
       genuinely the open question. */
    expect(modal).toContain('!prefilledStartLocal');
  });

  it('the collapsed step keeps its change link', () => {
    /* It is the one thing a move or an addition can change, so withholding it
       would leave the owner with a date and no way to alter it. */
    expect(modal).toContain("onEdit={reopen('when')}");
  });
});

describe('the dialog closes when the work is done, not when the screen catches up', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * The dialog closes when the slot handler's promise resolves, and that
   * promise used to await three refreshes first. So it sat open through all of
   * them — seconds on a loaded machine — over a session the server had already
   * created. And if any one threw, it never closed at all: an error on screen
   * about a meeting that exists, which the owner would then add a second time.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const drawerSrc = read('components/crm/contact-drawer/CRMContactDrawerV2.tsx')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  const handler = drawerSrc.slice(drawerSrc.indexOf('onPickSlot={'));
  const body = handler.slice(0, handler.indexOf(': undefined'));

  it('closes as soon as the server confirms', () => {
    expect(body).toContain('setShowBookingModal(false)');
  });

  it('and does not wait on the refreshes to do it', () => {
    /* `void`, not `await`: nothing about them is the dialog's business. */
    expect(body).toContain('void fetchSessions');
    expect(body).toContain('void fetchAllBookings');
    expect(body).not.toContain('await fetchSessions');
  });

  it('while a refused hour still keeps it open to say so', () => {
    /* The throw comes first, so "that hour is taken" reaches the dialog that
       asked for it. */
    const refusal = body.indexOf('throw new Error');
    const close = body.indexOf('setShowBookingModal(false)');
    expect(refusal).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(refusal);
  });
});

describe('the charge question is hard to miss', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * On a package billed per session every other session is charged, so leaving
   * this off gives one away — a decision, not a default. It was missed, and
   * the only way back is cancelling the session and adding it again, which the
   * client sees as two emails about one hour.
   * ───────────────────────────────────────────────────────────────────────────
   */
  it('pulses and colours the label while the answer is still off', () => {
    expect(modal).toContain('booking-toggle-attention');
    expect(modal).toContain("{ color: '#D97706' }");
  });

  it('both switched by one condition, so they cannot drift apart', () => {
    const uses = modal.match(/extraToggle\.attention && !extraToggle\.checked/g);
    expect(uses?.length).toBe(2);
  });

  it('settles the moment it is turned on', () => {
    /* An attention cue that keeps going after it has been read stops being a
       cue and becomes something to ignore. */
    expect(modal).toContain('!extraToggle.checked');
  });

  it('keeps pulsing until the question is answered', () => {
    /*
     * Three cycles first, on the reasoning that a cue which never stops
     * becomes something to ignore. Changed on the owner's instruction: the
     * question is worth money and this dialog is saved in a hurry, so it runs
     * until the switch is touched rather than until a timer runs out.
     */
    expect(modal).toContain('animation: bookingTogglePulse 1.1s ease-in-out infinite;');
  });

  it('and respects a reader who cannot take movement', () => {
    /* The emphasis without the motion — for some people movement is the one
       thing that makes a screen unusable. */
    expect(modal).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('is only asked where the package bills per session', () => {
    const drawerSrc = read('components/crm/contact-drawer/CRMContactDrawerV2.tsx');
    expect(drawerSrc).toContain('addMeetingTo?.billsPerMeeting');
    expect(drawerSrc).toContain('attention: true');
  });
});
