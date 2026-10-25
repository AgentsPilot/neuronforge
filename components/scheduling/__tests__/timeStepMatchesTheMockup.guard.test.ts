/**
 * The time step is the mockup, block for block.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The redesign was approved from a mockup, and a mockup is easy to approve and
 * easy to quietly drop half of. Every block it showed is asserted here by the
 * key it renders, so a piece cannot go missing without a name attached:
 *
 *   suggestions · day strip with shape and counts · the day as a timeline ·
 *   slot grid banded by part of day · a cost on every hour · the legend ·
 *   the two warnings · "another time"
 *
 * The RULES behind these are behaviour-tested a layer down — `slotIntelligence`
 * (23 tests) and `slotsInWindows` (12). What this protects is that the owner is
 * actually shown them.
 *
 * Labels are checked in all three languages because a key that exists in one is
 * a blank box in the other two, and Hebrew is the primary interface here.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

const SOURCE = read('components/scheduling/BookingTimeStep.tsx');
const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const LANGS = ['he', 'en', 'es'] as const;

/** Every key the step renders. The mockup's content, as the code names it. */
const KEYS = [
  'scheduling.slots.suggestions',
  'scheduling.slots.reason.soonest',
  'scheduling.slots.reason.client_usual_hour',
  'scheduling.slots.reason.client_usual_hour_nearest',
  'scheduling.slots.reason.closes_window',
  'scheduling.slots.mark.no_waste',
  'scheduling.slots.mark.habit',
  'scheduling.slots.mark.opens_day',
  'scheduling.slots.mark.soonest',
  'scheduling.slots.mark.next_day',
  'scheduling.slots.day.untouched',
  'scheduling.slots.day.untouched_hint',
  'scheduling.slots.week_previous',
  'scheduling.slots.week_next',
  'scheduling.slots.cost.closes_window',
  'scheduling.slots.cost.closes_day',
  'scheduling.slots.cost.strands',
  'scheduling.slots.cost.taken',
  'scheduling.slots.cost.selected',
  'scheduling.slots.band.morning',
  'scheduling.slots.band.afternoon',
  'scheduling.slots.band.evening',
  'scheduling.slots.day.free',
  'scheduling.slots.day.full',
  'scheduling.slots.day.closed',
  'scheduling.slots.day.empty',
  'scheduling.slots.selected_day',
  'scheduling.slots.no_hours_configured',
  'scheduling.slots.none_this_week',
  'scheduling.slots.next_free',
  'scheduling.slots.warn.no_24h_reminder',
  'scheduling.slots.warn.intake_lead_time',
  'scheduling.slots.warn.intake_lead_time_soon',
  'scheduling.slots.legend.open',
  'scheduling.slots.legend.pick',
  'scheduling.slots.legend.booked',
  'scheduling.slots.legend.gone',
  'scheduling.slots.loading',
];

describe('this guard reads the code, not its own explanation', () => {
  it('strips the comments', () => {
    /* Contiguous on one line: the comment wraps after "A second". */
    expect(SOURCE).toContain('opinion here about which hours exist');
    expect(code).not.toContain('opinion here about which hours exist');
  });
});

describe('every block the mockup showed', () => {
  it('the suggestions, each with its reason', () => {
    expect(code).toContain('data.suggestions.map(');
    expect(code).toContain('`scheduling.slots.reason.${s.reason}`');
  });

  it('and a mark on every row, none of them a default', () => {
    /*
     * The mockup puts a short category beside each sentence, and it is what
     * makes a column of three scannable. Two earlier versions were wrong in
     * opposite directions: "no waste" as the DEFAULT, so rows claimed it
     * without being checked; then no badge at all on those rows, and the
     * column lost its spine.
     *
     * Every branch names a key, so a new reason cannot fall through to a
     * flattering one.
     */
    for (const kind of ['no_waste', 'habit', 'opens_day', 'soonest', 'next_day']) {
      expect(code).toContain(`scheduling.slots.mark.${kind}`);
    }

    /* A cost outranks a find, which outranks the kind of row it is. */
    const branch = code.slice(code.indexOf('const mark ='), code.indexOf('const why ='));

    expect(branch.indexOf('mark.opens_day')).toBeLessThan(branch.indexOf('mark.no_waste'));
    expect(branch.indexOf('cost.strands')).toBeLessThan(branch.indexOf('mark.no_waste'));
  });

  it('and the suggestion rows stay one line each', () => {
    /*
     * The warnings were briefly repeated inside every suggestion — the same
     * two sentences three times, directly above the single copy that already
     * sits under the grid. The panel became a wall of text for one fact.
     *
     * `bookingWarnings` is still called once, for the chosen hour.
     */
    expect(code.match(/bookingWarnings\(\{/g)).toHaveLength(1);
  });

  it('and a way out of the week it opened on', () => {
    /*
     * `setFrom` had one caller — the "next free" link, which only appeared
     * when the day on screen had nothing at all — so a week with any
     * availability was a week you could not leave.
     */
    expect(code).toContain("setFrom(shiftDays(windowStart, 7))");
    expect(code).toContain("setFrom(shiftDays(windowStart, -7))");
    /* Back stops at this week: there is nothing to book in the past. */
    expect(code).toContain('disabled={!canGoBack}');
  });

  it('and says what an empty day will cost, in a sentence', () => {
    /*
     * "Opens a day" was a three-word badge on every hour, which assumes the
     * reader already knows the idea it points at. Said once, about the day on
     * screen, with the cost spelled out.
     */
    expect(code).toContain('scheduling.slots.day.untouched_hint');
    /* Today is excluded: it is already under way, so "you would start working
       a free day" says nothing about it. */
    expect(code).toContain('isToday(shown.date)');
  });

  it('the first suggestion leads, in the accent', () => {
    /* Ranked by what they save, so the one that wastes nothing reads first. */
    /*
     * `&& !value` is the part that matters now. The mockup washes the first
     * row to mark the recommendation, and it never draws a CHOSEN row — so
     * copied literally, two rows wore nearly the same colour and the panel
     * showed two selections at once. The recommendation steps back the moment
     * something is picked.
     */
    expect(code).toContain('const lead = index === 0 && !value;');
  });

  it('the day strip, with each day\'s shape and what is left', () => {
    expect(code).toContain('data.days.map(');
    expect(code).toContain('d.bookedMinutes / total');
    expect(code).toContain('dayLabel(d)');
  });

  it('a full or closed day is dead before it is clicked', () => {
    expect(code).toContain('const dead = !d.isWorkingDay || d.freeSlots === 0;');
    expect(code).toContain('disabled={dead}');
  });

  it('the day as a timeline, so an hour has context', () => {
    /*
     * The block that turns a slot from a number into a decision: the gap being
     * filled, or the one about to be split.
     */
    expect(code).toContain('scheduling.slots.selected_day');
    /* The timeline is one block per bookable hour now, so the day's booked
       time is asked per block rather than mapped into positioned bars. */
    expect(code).toContain('chosenDay.busy.some(');
    /* The chosen hour is one of the blocks, marked `pick`, rather than a bar
       positioned over them — so there is no `chosenSlot` to look up. */
    expect(code).toContain("value === slot.start");
    expect(code).toContain("'pick'");
  });

  it('the grid, banded by part of the day', () => {
    expect(code).toContain("(['morning', 'afternoon', 'evening'] as const)");
    expect(code).toContain('`scheduling.slots.band.${band}`');
  });

  it('every hour carries what it costs', () => {
    expect(code).toContain('const costLabel');
    expect(code).toContain('costLabel(slot)');

    for (const kind of ['closes_window', 'closes_day', 'strands']) {
      expect(code).toContain(`scheduling.slots.cost.${kind}`);
    }

    /* `opens_day` is gone from here: a fact about the DAY, said once beside
       the day rather than stamped on every hour in it. */
    expect(code).not.toContain('scheduling.slots.cost.opens_day');
  });

  it('the legend, because a colour nobody can read is decoration', () => {
    /* Five states, named under the bar that draws them rather than a screen
       below it. */
    expect(code).toContain("(['open', 'pick', 'booked', 'gone'] as const).map");
    expect(code).toContain('`scheduling.slots.legend.${tone}`');
  });

  it('the warnings, from the shared rule rather than a local guess', () => {
    expect(code).toContain("from '@/lib/scheduling/slotIntelligence'");
    expect(code).toContain('bookingWarnings({');
    expect(code).toContain('`scheduling.slots.warn.${w.kind}`');
  });

  it('and a meeting under an hour away says so in words, not as "0 hours"', () => {
    /* "The client will have 0 hours to return it" reads as a bug rather than
       as urgency. The short wording carries no number at all. */
    expect(code).toContain("w.hoursAhead < 1");
    expect(code).toContain("'scheduling.slots.warn.intake_lead_time_soon'");
  });

  it('and no escape hatch back to a typed date', () => {
    /*
     * REMOVED ON REQUEST, and the grid is what makes it safe to remove: every
     * hour it offers is one `windowsForDate` allows and nothing already holds,
     * so the warnings the typed fields needed — this day is closed, that hour
     * is taken — are now unreachable rather than unsaid.
     *
     * What goes with it is the deliberate off-hours booking. If that comes
     * back, it comes back as something the GRID offers, not as a second way to
     * answer the same question.
     */
    expect(code).not.toContain('onPickOtherTime');
    expect(code).not.toContain('scheduling.slots.other_time');
  });

  it('and says so plainly when no hours are configured at all', () => {
    /* Rather than offering a field to type into: a booking typed into that gap
       is one the client could never have made. */
    expect(code).toContain('scheduling.slots.no_hours_configured');
  });
});

describe('the lead-time warning is driven by a form that will actually be sent', () => {
  const dialog = read('components/scheduling/SchedulingBookingModal.tsx').
    replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  it('by the business setting, not by the dialog\'s own send toggle', () => {
    /*
     * `sendIntakeForm` starts OFF and is switched on in the step BELOW the
     * hour — so driven by it, this warning was absent at the only moment it
     * could change the decision, and present only once the hour step had
     * collapsed over it. `intakeConfigured` is the business-level fact: a
     * published, enabled form, emailed when the booking is confirmed.
     */
    expect(dialog).toContain('requiresIntake={intakeConfigured === true || sendIntakeForm}');
  });
});

describe('it decides nothing itself', () => {
  it('the hours come from the endpoint', () => {
    expect(code).toContain('/api/scheduling/free-slots?');
  });

  it('and it never computes a consequence of its own', () => {
    /*
     * `costLabel` READS `slot.consequence`; it must not work one out. Every
     * rule lives in `slotIntelligence`, and a second opinion here is how the
     * owner's dialog and the client's page drifted apart.
     */
    expect(code).not.toMatch(/strands:\s*\w+\s*[-+]/);
    expect(code).not.toContain('durationMinutes -');
  });

  it('moving between days is a render, not a fetch', () => {
    /*
     * The response carries the whole window. Refetching per click would make
     * the strip feel like a page load and re-rank the suggestions under the
     * owner's cursor.
     *
     * `day` and `value` are the two that must stay OUT: the first is which day
     * of the window is shown, the second changes on every pick.
     */
    /* The FETCH effect's own array — read from after the request, so a second
       memo elsewhere with different deps cannot satisfy or break this. */
    const fetchDeps = (code
      .slice(code.indexOf('/api/scheduling/free-slots?'))
      .match(/\}, \[([^\]]*)\]\);/)?.[1] ?? '')
      .split(',')
      .map(dep => dep.trim())
      .filter(Boolean);

    /*
     * Stated as what must be in and what must be out, rather than as the exact
     * list. The guarantee is about `day` and `value`; pinning the whole array
     * failed the moment a dep was added for a real reason — `durationMinutes`,
     * which decides which slots exist at all for a package session — and a
     * guard that fails on correct changes gets edited without being read.
     */
    expect(fetchDeps).toEqual(
      expect.arrayContaining(['serviceId', 'contactId', 'from', 'editingBookingId'])
    );
    expect(fetchDeps).not.toContain('day');
    expect(fetchDeps).not.toContain('value');
  });

  it('and the edited booking is both excluded and opened on', () => {
    /*
     * Rescheduling, which is the case the collapsing redesign could most
     * easily have lost: without the first the appointment's own hour reads as
     * taken by itself, and without the second the week shown is this one while
     * the appointment is next month.
     */
    expect(code).toContain("params.set('exclude_booking_id', editingBookingId)");
    expect(code).toContain("params.set('around', value)");
    /* First load only — else paging the strip snaps back to its week. Not
       gated on `editingBookingId`: this panel is unmounted when its step
       collapses, so on the mount after "change" the chosen hour is all it
       knows, and without it the owner is shown a different day. */
    expect(code).toContain('if (!from && value) params.set(\'around\', value);');
  });
});

describe('every label exists in every language', () => {
  const files = Object.fromEntries(
    LANGS.map(lang => [lang, read(`lib/business-os/translations/${lang}.ts`)])
  );

  for (const key of KEYS) {
    it(`${key}`, () => {
      for (const lang of LANGS) {
        /* Exactly once: a duplicate key silently shadows the first. */
        const hits = files[lang].match(new RegExp(`'${key.replace(/\./g, '\\.')}':`, 'g')) ?? [];

        expect(hits).toHaveLength(1);
      }
    });
  }

  it('the placeholders the code substitutes are present in each', () => {
    /* A missing `{minutes}` leaves the owner reading "Strands  min". */
    for (const lang of LANGS) {
      expect(files[lang]).toMatch(/'scheduling\.slots\.cost\.strands': '[^']*\{minutes\}/);
      expect(files[lang]).toMatch(/'scheduling\.slots\.day\.free': '[^']*\{count\}/);
      expect(files[lang]).toMatch(/'scheduling\.slots\.warn\.intake_lead_time': '[^']*\{hours\}/);
      expect(files[lang]).toMatch(/'scheduling\.slots\.next_free': '[^']*\{date\}/);
    }
  });
});
