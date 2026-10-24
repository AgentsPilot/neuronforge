/**
 * The owner's free slots come from the same rules as the client's.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS
 *
 * `SchedulingBookingModal` receives `availability` — the weekly opening-hours
 * TEMPLATE — and prints it as a banner beside a free-text `datetime-local`
 * field. It cannot see existing meetings, closed days or the owner's calendar,
 * so the owner types an hour and learns it clashes when the save fails. The
 * client booking on the public site has had real slots all along.
 *
 * This route closes that gap, and the way it closes it is the thing worth
 * protecting: it COMPOSES the shared pieces and adds no rule of its own. A
 * second opinion about when a business is open is exactly how the two surfaces
 * came to disagree, and re-deriving any of this locally would recreate that by
 * hand.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY SOURCE, NOT BEHAVIOUR
 *
 * The rules themselves ARE behaviour-tested, thoroughly, one layer down:
 * `slotIntelligence.test.ts` (23) and `slotsInWindows.test.ts` (12). What is
 * left here is wiring — auth, tenant scoping, which table holds the clock, and
 * which helper each answer comes from — and reaching it needs a session, a
 * service, a profile, preferences, time off and the meetings table.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const SOURCE = readFileSync(
  join(process.cwd(), 'app/api/scheduling/free-slots/route.ts'),
  'utf8'
);

/** Comments name the very things being forbidden; assertions must not read them. */
const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

describe('this guard reads the code, not its own explanation', () => {
  it('strips the comments that quote the old behaviour', () => {
    /* Without the leading article: the comment wraps after "A". */
    expect(SOURCE).toContain('second opinion about when a business is open');
    expect(code).not.toContain('second opinion about when a business is open');
  });

  it('and keeps the code', () => {
    expect(code).toContain('export async function GET');
  });
});

describe('it is the owner asking', () => {
  it('authenticates before anything else', () => {
    expect(code).toContain('const user = await getUser();');
    expect(code.indexOf('await getUser()')).toBeLessThan(code.indexOf('QuerySchema.safeParse'));
  });

  it('refuses without a session', () => {
    const guard = code.slice(code.indexOf('if (!user)'), code.indexOf('if (!user)') + 140);

    expect(guard).toContain('401');
  });

  it('scopes every read to that owner — CLAUDE.md rule 4', () => {
    /*
     * The id comes from the SESSION, never from the query string. A route that
     * accepted an owner id would publish one business's diary to another.
     */
    expect(code).toContain('const ownerId = user.id;');
    expect(code).not.toMatch(/owner_id:\s*z\./);
    expect(code).not.toMatch(/user_id:\s*z\./);
  });

  it('passes the owner to every source that takes one', () => {
    for (const call of [
      'findById(query.service_id, ownerId)',
      'findTimezone(ownerId)',
      'findByUserId(ownerId)',
      'list(ownerId,',
    ]) {
      expect(code).toContain(call);
    }

    /* `busyMeetings` wraps across lines since it took the edited booking as a
       fifth argument, so its two leading arguments are asserted on the call
       with the whitespace collapsed rather than on the source as typed. */
    expect(code.replace(/\s+/g, ' ')).toContain('busyMeetings( supabaseServer, ownerId,');
  });

  it('and the booking it may exclude comes from the query, not from a default', () => {
    /*
     * `exclude_booking_id` is the ONE thing that makes an hour stop counting as
     * busy, so it must be the caller's explicit, validated uuid — never a
     * fallback that could widen to "ignore these" and hide a real clash.
     */
    expect(code).toContain('exclude_booking_id: z.string().uuid().optional()');
    expect(code).toContain('query.exclude_booking_id ?? null');
  });
});

describe('the owner\'s own calendar', () => {
  it('is read, and merged into the same busy list the hours are cut from', () => {
    /*
     * A synced Google or Outlook event holds the owner's time as surely as a
     * meeting booked here. The client's page has always read these and so did
     * the dialog this grid replaced; this endpoint did not, so an hour the
     * owner was already busy for was blocked for the client and offered to
     * the owner — and the database's overlap constraint knows only about
     * `scheduling_meetings`, so nothing downstream would have refused it.
     */
    expect(code).toContain("from '@/lib/repositories/ExternalCalendarEventRepository'");
    expect(code).toContain('externalCalendarEventRepository.getBusySlots(');

    /* ONE list, so the free windows, the day counts, the slot labels and the
       suggestions cannot disagree about what is taken. */
    expect(code).toMatch(/const busyAsIntervals = \[[\s\S]*external\.data[\s\S]*\];/);
  });

  it('and a calendar that cannot be read does not blank the diary', () => {
    /* Fails soft, like `busyMeetings`: the owner keeps their own bookings and
       keeps working. */
    expect(code).toContain('if (external.error)');
    expect(code).toContain('(external.data ?? [])');
  });
});

describe('the gap between appointments', () => {
  it('is read from the service and handed to the slot engine', () => {
    /*
     * `buffer_minutes` has been on the row since the first scheduling
     * migration, defaults to 15, is editable in the service modal — and no
     * booking path had ever consulted it, so every hour offered was back to
     * back against the last meeting.
     */
    expect(code).toContain('const bufferMinutes = service.buffer_minutes ?? 0;');
    expect(code).toContain('bufferMinutes,');
  });

  it('and counts capacity with it, since the gaps go between meetings', () => {
    expect(code).toContain('meetingsThatFit(daySlots, durationMinutes, bufferMinutes)');
  });
});

describe('one clock, and the whole window', () => {
  it('reads "now" once and hands the same instant to every rule', () => {
    /*
     * `suggestSlots` dropped past hours and the grid did not, so the dialog
     * offered 09:00 at twenty past eleven while suggesting 11:30 above it.
     * Two readings of the clock in one response is how that happens.
     */
    expect(code).toContain('const now = new Date();');
    expect(code).toContain('notBefore: now,');
    expect(code).toContain('now,');
    /* And nowhere else: a second `new Date()` is a second opinion. */
    expect(code.match(/new Date\(\)/g)).toHaveLength(1);
  });

  it('returns every day\'s hours, not only the selected day\'s', () => {
    /*
     * The dialog filters these by the day the owner is looking at, and the
     * strip lets them look at any day in the window. One day's slots meant
     * clicking any other emptied the grid: "no free hours this week" beside a
     * strip saying that day had eight.
     */
    /* Read from the RESPONSE body: `suggestSlots({ slots: allAnalysed, ... })`
       says the same words higher up and would satisfy a loose match while the
       payload itself carried one day. */
    const body = code.slice(code.indexOf('return NextResponse.json({\n      success: true,\n      timezone,'));

    expect(body).toContain('slots: allAnalysed,');
    expect(body).not.toMatch(/slots:\s*allAnalysed\./);
    expect(body).not.toMatch(/slots:\s*analysed,/);
  });

  it('while the day counts come from the same filtered hours', () => {
    /* `freeSlots` is what the strip prints. Counted before the past was
       removed, it said "6 free" for a day with two hours left. */
    const loop = code.slice(code.indexOf('const daySlots = slotsInWindows'));

    expect(loop.slice(0, 400)).toContain('notBefore: now');

    /*
     * And the count is MEETINGS, not start times. `daySlots.length` counts
     * candidate starts at a half-hour step — fifteen on an empty nine-to-five
     * day where eight one-hour meetings fit. They are alternatives to each
     * other, and the strip exists to compare days.
     */
    expect(loop).toContain('freeSlots: meetingsThatFit(daySlots, durationMinutes, bufferMinutes)');
    expect(code).not.toContain('freeSlots: daySlots.length');
  });
});

describe('it composes the shared rules and writes none', () => {
  it('open hours come from computeOpenTime', () => {
    expect(code).toContain("from '@/lib/scheduling/openTime'");
    expect(code).toContain('computeOpenTime({');
  });

  it('the starts come from slotsInWindows', () => {
    expect(code).toContain('slotsInWindows({');
  });

  it('what each hour costs comes from slotIntelligence', () => {
    expect(code).toContain("from '@/lib/scheduling/slotIntelligence'");
    expect(code).toContain('analyseSlots({');
    expect(code).toContain('suggestSlots({');
  });

  it('and it steps through no hours of its own', () => {
    /*
     * The public availability route has its own stepping loop, and a second
     * copy here is how the two surfaces would drift again. Every candidate
     * start comes from `slotsInWindows`.
     */
    expect(code).not.toMatch(/currentHour|currentMin|\+=\s*30\b/);
  });
});

describe('the clock lives on the meeting now', () => {
  it('busy time is read through busyMeetings', () => {
    /*
     * `scheduling_meetings` holds the time since the meeting was separated from
     * the booking, and `busyMeetings` is the one reader of it. A booking with
     * no meeting holds no slot.
     */
    expect(code).toContain("from '@/lib/scheduling/busyMeetings'");
    expect(code).toContain('await busyMeetings(');
  });

  it('and nothing here reads scheduling_bookings for a time', () => {
    const bookingReads = code.match(/from\('scheduling_bookings'\)/g) ?? [];

    expect(bookingReads).toHaveLength(0);
  });

  it('the client history joins through the booking for the contact', () => {
    /*
     * The one query that needs both halves: the contact is on the booking, the
     * time is on the meeting.
     */
    const history = code.slice(
      code.indexOf("from('scheduling_meetings')"),
      code.indexOf("from('scheduling_meetings')") + 420
    );

    expect(history).toContain('scheduling_bookings!inner(contact_id)');
    expect(history).toContain("eq('user_id', ownerId)");
  });
});

describe('the service is loaded whole', () => {
  it('through the repository, never a hand-typed select', () => {
    /*
     * The public booking route named eight of thirty columns and produced three
     * silent bugs that way — `collection`, then `sale_mode` "one bug later",
     * then the payment-plan columns. The duration is what every slot is built
     * from.
     */
    expect(code).toContain('schedulingServiceRepository.findById(');
    expect(code).not.toMatch(/from\('scheduling_services'\)/);
  });
});

describe('the dead ends are refused before the loop', () => {
  it('a business with no hours configured', () => {
    expect(code).toContain('hasAnyAvailability(availability)');
  });

  it('and a service with no duration, which would never finish stepping', () => {
    /*
     * A zero step loops for ever. `slotsInWindows` guards itself too, but the
     * day loop around it would still run, so the refusal belongs here as well.
     */
    expect(code).toContain('durationMinutes <= 0');
  });
});

describe('the suggestions look past the day on screen', () => {
  it('they are analysed across the whole window', () => {
    /*
     * The hour that wastes nothing may be on Thursday while the owner is
     * looking at Monday — which is exactly what they would never find by
     * clicking through days one at a time.
     */
    expect(code).toContain('const allAnalysed');
    expect(code).toContain('days.flatMap(');

    const call = code.slice(code.indexOf('suggestSlots({'), code.indexOf('suggestSlots({') + 220);

    expect(call).toContain('slots: allAnalysed');
  });
});

describe('reads that fail do not take the dialog with them', () => {
  it('unreadable time off falls back to the ordinary weekly hours', () => {
    /* A closed-day read that fails must not blank the owner's week. */
    expect(code).toContain('if (offResult.error)');
    expect(code).toContain('requestLogger.warn(');
  });

  it('an unreadable client history costs only the habit suggestion', () => {
    const block = code.slice(
      code.indexOf('if (historyError)'),
      code.indexOf('if (historyError)') + 260
    );

    expect(block).toContain('requestLogger.warn(');
    expect(block).not.toContain('return NextResponse.json');
  });
});

describe('it does not collide with the settings route', () => {
  it('lives at free-slots, and the weekly hours keep their own path', () => {
    /*
     * `/api/scheduling/availability` is the business's weekly working-hours
     * SETTINGS, read and written by the configuration dialog. This answers a
     * different question — which hours are actually free — and was briefly
     * written over the top of that one.
     */
    const settings = readFileSync(
      join(process.cwd(), 'app/api/scheduling/availability/route.ts'),
      'utf8'
    );

    expect(settings).toContain('Business-level availability settings');
    expect(settings).toContain('export async function POST');
    expect(settings).not.toContain('slotIntelligence');
  });
});
