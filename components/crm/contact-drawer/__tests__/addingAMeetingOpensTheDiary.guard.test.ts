/**
 * Adding a meeting to a package opens the diary, and still writes a MEETING.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG
 *
 * "Add another meeting" was a bare `datetime-local` beside a checkbox. It
 * accepted any value the browser allowed, and the owner learned the hour was
 * already sold, or the day closed, only after pressing Add — as a red sentence
 * under the field. A make-up session is the case where the diary matters most:
 * the whole reason for adding one is that it has to fit around what is there.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND THE TRAP IN FIXING IT
 *
 * The obvious fix — open the booking dialog — writes a STANDALONE booking
 * through `POST /api/scheduling/bookings`. That booking would have no
 * `parent_booking_id`, no occurrence number, no charge, and would not appear in
 * the package's meeting list at all: a worse bug than the one being fixed, and
 * an invisible one, because a booking really would be created.
 *
 * So the dialog chooses the hour and hands it back; the meetings endpoint
 * writes it. These two halves must stay together, which is what this guards.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

const tab = read('components/crm/contact-drawer/BookingsTab.tsx');
const drawer = read('components/crm/contact-drawer/CRMContactDrawerV2.tsx');
const dialog = read('components/scheduling/SchedulingBookingModal.tsx');

describe('the link opens the dialog', () => {
  it('no longer asks for the date with a bare field', () => {
    // The whole defect: a field that cannot say "that hour is taken".
    const component = tab.slice(
      tab.indexOf('function AddPackageMeeting'),
      tab.indexOf('interface BookingsTabProps')
    );

    expect(component).not.toMatch(/datetime-local/);
    expect(component).toMatch(/onOpen\(containerId\)/);
  });

  it('hands the package to the drawer, which owns the dialog', () => {
    expect(tab).toMatch(/onOpen=\{onAddPackageMeeting\}/);
    expect(drawer).toMatch(/setAddMeetingTo\(\{/);
    expect(drawer).toMatch(/setShowBookingModal\(true\)/);
  });

  it('opens on the container\'s own service, not on whichever is first', () => {
    // A package's meeting inherits the container's service, so the hours the
    // dialog offers must be that service's.
    expect(drawer).toMatch(/prefilledServiceId=\{addMeetingTo\?\.serviceId\}/);
    /*
     * Both of the dialog's writers resolve it through `defaultServiceFor`, and
     * that helper answers ONLY where the caller named one — so "whichever is
     * first" is no longer reachable from either. Asserted as a count: a third
     * writer, or one of these two quietly going back to `activeServices[0]`,
     * is the way this property gets lost.
     */
    expect(dialog.match(/defaultServiceFor\(services, prefilledServiceId\)/g)).toHaveLength(2);

    /* Comments stripped for the negative: the code explains what it replaced,
       and naming the old expression must not read as still doing it. */
    const code = dialog.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

    expect(code).toContain('defaultServiceFor');
    expect(code).not.toMatch(/activeServices\[0\]/);
  });
});

describe('the dialog chooses an hour and writes nothing', () => {
  it('returns before the request body when the caller only wants a slot', () => {
    /*
     * Order matters: the early return has to come before the POST is built,
     * or a package meeting is written twice — once as a standalone booking
     * and once as a meeting.
     */
    const submit = dialog.slice(dialog.indexOf('const handleSubmit = async'));
    const pick = submit.indexOf('if (onPickSlot) {');
    /* The URL is now chosen between three — a session's reschedule endpoint,
       a booking, a new booking — so the marker is the choice, not its old
       shape. */
    const post = submit.indexOf('const url = rescheduleMeetingId');

    expect(pick).toBeGreaterThan(-1);
    expect(post).toBeGreaterThan(pick);
  });

  it('locks the service, which the meeting inherits anyway', () => {
    expect(dialog).toMatch(/disabled=\{!!booking \|\| Boolean\(onPickSlot\)\}/);
  });

  it('asks for a time and nothing else', () => {
    /*
     * The ordinary gate needs a first name and an email. A CRM contact can
     * have neither — a lead captured with only a phone number — which would
     * leave the confirm button permanently dead on exactly the contacts a
     * package is most likely to be sold to.
     */
    expect(dialog).toMatch(/onPickSlot\s*\?\s*loading \|\| !formData\.start_time/);
  });

  it('shows the handler\'s own words when it refuses', () => {
    // "That hour is taken" is the reason the dialog was opened at all.
    expect(dialog).toMatch(/onPickSlot && err instanceof Error && err\.message/);
  });
});

describe('the meeting is still written as a meeting', () => {
  it('posts to the package\'s meetings endpoint', () => {
    expect(drawer).toMatch(/bookings\/\$\{addMeetingTo\.containerId\}\/meetings/);
  });

  it('carries the money answer, which only a package can ask', () => {
    expect(drawer).toMatch(/charge: chargeNewMeeting && addMeetingTo\.billsPerMeeting/);
    expect(drawer).toMatch(/extraToggle=\{/);
  });

  it('refuses loudly rather than silently dropping the meeting', () => {
    const handler = drawer.slice(
      drawer.indexOf('onPickSlot={'),
      drawer.indexOf('/* Document Upload Modal */')
    );

    expect(handler).toMatch(/throw new Error\(data\.error/);
  });

  it('forgets the package once the dialog closes', () => {
    // Left set, the next ordinary "new booking" from this drawer would be
    // silently added to the package instead.
    expect(drawer).toMatch(/setAddMeetingTo\(null\)/);
  });
});

describe('it opens where the series says, not on the next free hour', () => {
  it('reads the rhythm off the meetings themselves', () => {
    /*
     * A course that runs every second Thursday at 09:30 runs every second
     * Thursday at 09:30. Opening on tomorrow asked the owner to work out a
     * date the agreement had already decided.
     */
    expect(drawer).toMatch(/let running = meetings;/);
    expect(drawer).toMatch(/item\.parent_booking_id === containerId/);
  });

  it('falls back to the dates the quote sold when the diary has drifted', () => {
    /*
     * One rescheduled session puts the real gaps off the pattern — 15, 13,
     * 14, 14 on the reporting account — and the series then names no rhythm
     * at all. The agreement does not move.
     */
    expect(drawer).toMatch(/const soldLocals = \(sold\?\.sessions\?\.dates \?\? \[\]\)/);
  });

  it('hands it over as an exact hour, not a calendar cell', () => {
    // `prefilledDateTime` carries a whole hour, because a grid click means
    // one. 09:30 rounded to 09:00 is an hour the series does not use.
    expect(drawer).toMatch(/prefilledStartLocal=\{addMeetingTo\?\.nextLocal \?\? undefined\}/);
    expect(dialog).toMatch(/if \(prefilledStartLocal\) \{/);
  });

  it('falls back to the dialog\'s own default when there is no rhythm', () => {
    // `nextInSeries` returns null for a hand-adjusted series; undefined here
    // is what makes the dialog choose for itself rather than be handed a guess.
    expect(drawer).toMatch(/nextLocal \?\? undefined/);
  });
});

describe('the money question', () => {
  /*
   * ── IT WAS A SWITCH IN THE FOOTER. IT IS TWO ANSWERS IN THE BODY ────────
   *
   * The switch said "bill it like the others" with no amount on it, beside
   * Cancel and Save. A footer holds what you do to a dialog; this describes
   * the session being made, and down there it read as a setting and was
   * missed — which on a per-session package means giving an hour away.
   *
   * So what is pinned is the INVARIANT, not the widget: both answers are
   * present, neither is reachable by omission, and the waiver is the one
   * drawn in amber because it is the one that costs money.
   */
  it('offers both answers explicitly, so neither is taken by omission', () => {
    expect(dialog).toMatch(/\(\[true, false\] as const\)\.map\(charge =>/);
    expect(dialog).toMatch(/onClick=\{\(\) => extraToggle\.onChange\(charge\)\}/);
  });

  it('says what it costs, on the answer that charges', () => {
    /* "Bill it like the others" never named a figure, so waiving it was a
       decision whose price the owner had to go and look up. */
    expect(dialog).toContain('crm.booking.package.charge_yes');
    expect(dialog).toContain('crm.booking.package.charge_no');
  });

  it('colours the WAIVER amber, not the charge', () => {
    /* Amber is the card's word for money wanting an answer. On the charge it
       would warn about the ordinary case; on the waiver it marks the one that
       gives an hour away. */
    expect(dialog).toMatch(/charge \? '#2DD4BF' : '#D97706'/);
  });

  /*
   * The question group, which now sits in the BODY beside the date rather
   * than in the footer. The two placement tests that lived here pinned
   * `me-auto` and the absence of a `dir="ltr"` wrapper — both were about
   * keeping a switch off the buttons in the footer, and neither describes
   * anything that still exists.
   *
   * What replaced them is the placement itself: the block is rendered inside
   * the scrolling body, above the sticky footer, so it is read as part of
   * making the session.
   */
  it('is asked in the body, not in the footer beside the buttons', () => {
    const body = dialog.indexOf('{(extraToggle || makeUpFor) && (');
    const footer = dialog.indexOf('Sticky Footer');

    expect(body).toBeGreaterThan(-1);
    expect(footer).toBeGreaterThan(-1);
    expect(body).toBeLessThan(footer);
  });
});

describe('the make-up question', () => {
  it('is asked only when the caller passes it', () => {
    expect(dialog).toMatch(/\{makeUpFor && \(/);
  });

  it('treats "makes up for nothing" as the default, and shows it as an answer', () => {
    /*
     * The honest default: a claim nobody made must not be recorded for them,
     * so the absence is a selected answer rather than an empty box.
     *
     * It was a `SelectItem` behind a sentinel value, because Radix throws on
     * an empty one. The control is a pair of answers now — `null` IS the
     * no-make-up state, with no sentinel to leak — and the missed hours are
     * rows underneath rather than options inside a menu.
     */
    expect(dialog).toMatch(/Boolean\(makeUpFor\.value\) === isMakeUp/);
    expect(dialog).toContain('makeUpFor.noneLabel');
  });

  it('lists the missed hours as rows, not inside a select', () => {
    /* Two or three of them is a list: visible without opening anything, and
       clear of `SelectTrigger`, which hand-rolls its own RTL on top of the
       `dir` its container already applies. */
    expect(dialog).toMatch(/makeUpFor\.options\.map\(option =>/);
    expect(dialog).not.toMatch(/<SelectItem value=\{option\.value\}>/);
  });

  it('hands back null for "makes up for nothing"', () => {
    /*
     * The RULE is unchanged and the mechanism is not. A sentinel existed only
     * because Radix refuses an empty `SelectItem` value, and the select is
     * gone — the control is two buttons now, so the absence can simply BE
     * `null` with nothing to translate back.
     *
     * This asserted `next === MAKES_UP_FOR_NOTHING ? null : next`, which
     * contradicted its own sibling above ("no sentinel to leak") and pinned
     * the design the refactor deliberately replaced. What matters to a caller
     * is unchanged: choosing "no" hands back null, choosing "yes" hands back a
     * real candidate rather than an empty state.
     */
    expect(dialog).toMatch(
      /isMakeUp \? \(makeUpFor\.options\[0\]\?\.value \?\? null\) : null/
    );
    /* And no sentinel survives anywhere, which is the half worth guarding. */
    expect(dialog).not.toContain('MAKES_UP_FOR_NOTHING');
  });

  it('is only offered when something is actually waiting to be made up', () => {
    expect(drawer).toMatch(/addMeetingTo\?\.makeUpCandidates\.length/);
  });

  it('leaves the ordinary add posting exactly what it posted before', () => {
    /*
     * Spread in only when the owner answered. The body of a plain add is
     * unchanged, which is the whole safety argument for the change.
     */
    expect(drawer).toMatch(/\.\.\.\(makeUpForId \? \{ replaces: makeUpForId \} : \{\}\)/);
  });

  it('only counts a session nothing has replaced yet', () => {
    /* `was_replaced` is the recorded fact. A count cannot tell a gap that has
       been made up from one still waiting on the client. */
    expect(drawer).toMatch(/!row\.was_replaced/);
  });
});

describe('the date field is readable in the dark', () => {
  it('does not invert an icon the engine already drew light', () => {
    /*
     * `color-scheme: dark` is what makes the browser paint its own calendar
     * button in light ink. The rule here used to invert it as well, which put
     * it back to near-black on a near-black field: the button looked absent.
     * The same pair cancelled in the quote dialog — see
     * `components/ui/__tests__/dateFieldInDarkMode.guard.test.ts`.
     */
    /* Comments stripped first: the rule block carries a note explaining why
       the inversion is gone, and it necessarily names the thing it forbids. */
    const rules = dialog
      .slice(dialog.indexOf('.datetime-input-scheduling {'))
      .replace(/\/\*[\s\S]*?\*\//g, '');

    expect(rules).toMatch(/color-scheme: dark/);
    expect(rules).not.toMatch(/filter:\s*invert/);
  });

  it('still makes the button findable and clickable', () => {
    const rules = dialog.slice(dialog.indexOf('.datetime-input-scheduling {'));

    expect(rules).toMatch(/cursor: pointer/);
    expect(rules).toMatch(/opacity: 0\.8/);
  });
});

describe('the suggestions follow the series too', () => {
  it('opens on the series\' own next date, not today and tomorrow', () => {
    /*
     * ───────────────────────────────────────────────────────────────────────
     * The guarantee is unchanged; where it is delivered is not.
     *
     * It used to be a row of "בחירה מהירה" chips carrying the series' own
     * remaining dates, because the dialog could not open on one. It can now —
     * `prefilledStartLocal` lands the picker on the next date at the same
     * hour — so the chips repeated a choice already made, and rendered before
     * the slots had loaded, which made the dialog appear in one shape and
     * rearrange itself into another a second later.
     *
     * So the drawer passes none, and the date it opens on is the series'.
     * ───────────────────────────────────────────────────────────────────────
     */
    expect(drawer).not.toMatch(/seriesSlots=/);
    expect(drawer).toMatch(/prefilledStartLocal=\{addMeetingTo\?\.nextLocal/);
  });

  it('and the chips, if ever handed over again, are still the series\'', () => {
    /*
     * The block is left intact rather than torn out: it is a real feature for
     * a caller holding dates the slot endpoint cannot know. What must not come
     * back is the generic "next six free slots from today", which is right for
     * an appointment and wrong for a seventh session of a fortnightly course.
     */
    expect(dialog).toMatch(/seriesSlots\?\.length\s*\?\s*seriesPicks/);
  });

  it('builds them with the same reader as the field', () => {
    // A second derivation here would eventually disagree with the date in the
    // field about what the rhythm is.
    expect(drawer).toMatch(/const next = nextInSeries\(running, soldLocals\)/);
    expect(drawer).toMatch(/nextLocal: upcoming\[0\] \?\? null/);
  });

  it('drops a suggested date that is already sold', () => {
    // A chip is an offer. Offering an hour that cannot be taken is worse than
    // offering one fewer.
    expect(dialog).toMatch(/\.filter\(slot => !isSlotBooked\(slot\.start, slot\.end, existingBookings, booking\?\.id\)\)/);
  });

  it('leaves the ordinary slots exactly as they were', () => {
    // Everything here is gated on the prop; without it the generic generator
    // runs with the same arguments it always did.
    expect(dialog).toMatch(
      /getNextAvailableSlots\(availability, serviceDuration, zone, 6, existingBookings, externalBusySlots, timeOff\)/
    );
  });
});
