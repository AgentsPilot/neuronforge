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
    expect(dialog).toMatch(/activeServices\.find\(item => item\.id === prefilledServiceId\)/);
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
    const post = submit.indexOf("const url = booking ?");

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
  it('is a switch, not a checkbox', () => {
    expect(dialog).toMatch(/<Switch\n?\s+id="booking-extra-toggle"/);
    expect(dialog).toMatch(/onCheckedChange=\{extraToggle\.onChange\}/);
  });

  it('sits on the inline start, which is the right in Hebrew', () => {
    /*
     * The footer is `justify-between` and the group beside it is empty on a
     * new booking, so without this the question floated near the middle. A
     * margin on the inline END pins it to the START in either script.
     */
    const block = dialog.slice(dialog.indexOf('{extraToggle && ('), dialog.indexOf('Right side - Cancel and Save'));
    expect(block).toMatch(/className="me-auto flex items-center/);
  });

  it('does not wrap the switch in a direction of its own', () => {
    // `Switch` already carries a `:dir(rtl)` rule for its thumb. A `dir="ltr"`
    // wrapper here would neutralise it — the same correct-it-twice fault as
    // the inverted calendar icon.
    const block = dialog.slice(dialog.indexOf('{extraToggle && ('), dialog.indexOf('Right side - Cancel and Save'));
    expect(block).not.toMatch(/dir="ltr"/);
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
  it('offers the series\' own next dates, not today and tomorrow', () => {
    /*
     * The quick-pick chips are the next six free slots from today, which is
     * right for an appointment and wrong for a seventh session of a
     * fortnightly course: today is not a candidate, and clicking it breaks
     * the rhythm the client is planning around.
     */
    expect(drawer).toMatch(/seriesSlots=\{addMeetingTo\?\.upcoming\}/);
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
