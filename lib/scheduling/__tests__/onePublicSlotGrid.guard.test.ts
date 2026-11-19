/**
 * Every public door into one diary offers the same times.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WENT WRONG, AND WHY A GUARD RATHER THAN A UNIT TEST
 *
 * A client reaches the same business three ways — the subdomain booking page, a
 * smart link or landing page, and the portal where they move an existing
 * appointment — and each one built its own grid of start times:
 *
 *   · `availableSlots.ts`        `slotStartMins += 30`
 *   · the conversion route       `const slotInterval = 30`
 *   · the chat's own suggestions a third copy, still there, for the OWNER
 *
 * They agreed only because two literals happened to say thirty, and they
 * agreed about nothing else: the website widened what counts as taken by the
 * service's `buffer_minutes` and the smart link did not, so the same service
 * offered an hour flush against an existing appointment through one door and
 * withheld it through the other.
 *
 * Thirty was also wrong on its own terms. The grid had nothing to do with the
 * service: a 50-minute appointment was offered at 09:00 AND 09:30, two times
 * that cannot both be taken, and a 20-minute one got two starts an hour instead
 * of three.
 *
 * Asserted at SOURCE as well as by behaviour, because the failure is a literal
 * being retyped in a fourth route, which no amount of testing the first three
 * would catch.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { generateTimeSlots } from '@/lib/scheduling/availableSlots';
import { slotStepMinutes, FALLBACK_SLOT_MINUTES } from '@/lib/scheduling/slotInterval';

const read = (relative: string) => readFileSync(join(process.cwd(), relative), 'utf8');

/** Source with comments removed, so the notes ABOUT the old literal do not fail it. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const WEBSITE_SLOTS = 'lib/scheduling/availableSlots.ts';
const SMART_LINK = 'app/api/conversion/[userCode]/availability/route.ts';
const SUBDOMAIN = 'app/api/website/scheduling/availability/route.ts';
const PORTAL = 'app/api/book/manage/[token]/reschedule/route.ts';
const REPOSITORY = 'lib/repositories/SchedulingRepository.ts';

describe('one rule decides how far apart the times are', () => {
  it('neither generator carries a step of its own any more', () => {
    expect(code(read(WEBSITE_SLOTS))).not.toMatch(/\+=\s*30\b/);
    expect(code(read(SMART_LINK))).not.toMatch(/slotInterval\s*=\s*30\b/);
  });

  it.each([
    ['the website generator', WEBSITE_SLOTS],
    ['the smart link', SMART_LINK],
  ])('%s asks the shared rule', (_label, source) => {
    const body = code(read(source));

    expect(body).toContain("from '@/lib/scheduling/slotInterval'");
    expect(body).toMatch(/slotStepMinutes\(durationMinutes, bufferMinutes\)/);
    /* Both reach the shared placer too: the step decides the rhythm, this
       decides that no free stretch goes unoffered. */
    expect(body).toContain('offeredStarts');
  });
});

describe('what the shared rule answers', () => {
  it('is the length when there is no gap, so an hour is offered on the hour', () => {
    expect(slotStepMinutes(60, 0)).toBe(60);
    expect(slotStepMinutes(30, null)).toBe(30);
    expect(slotStepMinutes(20, undefined)).toBe(20);
  });

  it('and the length PLUS the gap when there is one, so the day tiles', () => {
    /*
     * Stepping by the length alone strands the gap: a 60-minute service with
     * 15 minutes after it, booked at 09:00, holds the room to 10:15 while the
     * next aligned start is 10:00 — so 10:15 to 11:00 can be sold to nobody.
     *
     * The owner's free-slots route passes this same step, so one diary is not
     * described two ways.
     */
    expect(slotStepMinutes(60, 15)).toBe(75);
    expect(slotStepMinutes(45, 15)).toBe(60);
  });

  it('falls back rather than inventing an hour when the service has no length', () => {
    /* A product, or a fee per client. Treating it as 60 is what made every
       service implicitly an appointment. */
    expect(slotStepMinutes(null)).toBe(FALLBACK_SLOT_MINUTES);
    expect(slotStepMinutes(undefined)).toBe(FALLBACK_SLOT_MINUTES);
    expect(slotStepMinutes(0)).toBe(FALLBACK_SLOT_MINUTES);
    expect(slotStepMinutes(-30)).toBe(FALLBACK_SLOT_MINUTES);
    expect(slotStepMinutes(Number.NaN)).toBe(FALLBACK_SLOT_MINUTES);
  });

  it('the owner’s own grid takes the same step', () => {
    /* Requirement: solid on both ends. The free-slots route used the default,
       which is the duration alone. */
    const owner = code(read('app/api/scheduling/free-slots/route.ts'));

    expect(owner).toMatch(/stepMinutes: slotStepMinutes\(durationMinutes, bufferMinutes\)/);
  });

  it('never returns something that would loop for ever', () => {
    /* The whole generator is `while (start + duration <= end) start += step`.
       A step of zero is an infinite loop serving a booking page. */
    expect(slotStepMinutes(1)).toBeGreaterThan(0);
    expect(slotStepMinutes(0.4)).toBeGreaterThan(0);
  });
});

describe('the times a client is actually offered', () => {
  /* Far enough ahead that "is this slot in the past" never enters into it. */
  const DAY = '2099-03-12';
  const TZ = 'UTC';
  const startsFor = (window: { start: string; end: string }, duration: number) =>
    generateTimeSlots(DAY, [window], duration, [], [], TZ).map(slot => slot.start_time);

  it('spaces an hour-long service by the hour', () => {
    expect(startsFor({ start: '09:00', end: '12:00' }, 60)).toEqual([
      `${DAY}T09:00:00`,
      `${DAY}T10:00:00`,
      `${DAY}T11:00:00`,
    ]);
  });

  it('LEAVES NOTHING STRANDED once the day is broken up', () => {
    /*
     * ─────────────────────────────────────────────────────────────────────────
     * THE REQUIREMENT THIS SUITE EXISTS FOR: "it must not leave the user with
     * gaps".
     *
     * Two live services are 45 minutes with a 15-minute gap. Booked at 09:00
     * and 11:00, the stretch from 09:45 to 11:00 holds the appointment — and a
     * grid tiled from the day's opening lands on 09:45 and 10:30, both
     * clashing, so the hour was offered to nobody while the owner could see it
     * free in their diary.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const booked = [
      { start_time: `${DAY}T09:00:00.000Z`, end_time: `${DAY}T09:45:00.000Z` },
      { start_time: `${DAY}T11:00:00.000Z`, end_time: `${DAY}T11:45:00.000Z` },
    ];
    const starts = generateTimeSlots(DAY, [{ start: '09:00', end: '13:00' }], 45, booked, [], TZ, 15)
      .map(slot => slot.start_time.slice(11, 16));

    expect(starts).toContain('10:00');
  });

  it('fills a window that opens off the hour, to its end', () => {
    /* An afternoon window resuming at 13:20 on an hourly grid offered 14:00
       and left 15:00 to 16:00 free with nothing under it. */
    const starts = generateTimeSlots(
      DAY,
      [{ start: '13:20', end: '16:00' }],
      60,
      [],
      [],
      TZ,
      15
    ).map(slot => slot.start_time.slice(11, 16));

    expect(starts).toEqual(['13:20', '14:35']);
  });

  it('gives a cancelled hour straight back', () => {
    /* The reported regression class: a freed time that never reappears. */
    const window = { start: '09:00', end: '13:00' };
    const taken = generateTimeSlots(DAY, [window], 60, [
      { start_time: `${DAY}T09:00:00.000Z`, end_time: `${DAY}T10:00:00.000Z` },
    ], [], TZ, 15).map(s => s.start_time.slice(11, 16));
    const freed = generateTimeSlots(DAY, [window], 60, [], [], TZ, 15)
      .map(s => s.start_time.slice(11, 16));

    expect(taken).not.toContain('09:00');
    expect(freed).toContain('09:00');
  });

  it('gives a 20-minute service three starts an hour, not two', () => {
    /* The third twenty minutes of every hour used to be unsellable. */
    expect(startsFor({ start: '09:00', end: '10:00' }, 20)).toEqual([
      `${DAY}T09:00:00`,
      `${DAY}T09:20:00`,
      `${DAY}T09:40:00`,
    ]);
  });

  it('stops offering two times that cannot both be taken', () => {
    /*
     * A 50-minute service was offered at 09:00 and 09:30; whichever the first
     * client picked decided how much of the morning died with it.
     */
    const starts = startsFor({ start: '09:00', end: '11:00' }, 50);

    expect(starts).toEqual([`${DAY}T09:00:00`, `${DAY}T09:50:00`]);
    expect(starts).not.toContain(`${DAY}T09:30:00`);
  });

  it('still refuses a start the service cannot finish before closing', () => {
    expect(startsFor({ start: '09:00', end: '09:45' }, 60)).toEqual([]);
  });
});

describe('the gap between appointments reaches every public surface', () => {
  /*
   * The buffer is not in the step — it is applied by widening what counts as
   * taken, and each surface has to do that for itself. The smart link did not,
   * which is how one door offered an hour the other withheld.
   */
  it('the subdomain page passes the service’s buffer', () => {
    expect(code(read(SUBDOMAIN))).toMatch(/buffer_minutes \?\? 0/);
  });

  it('and the portal’s reschedule deliberately does NOT', () => {
    /*
     * ───────────────────────────────────────────────────────────────────────
     * THE ONE SURFACE THAT MUST NOT APPLY IT, AND WHY.
     *
     * Passing the buffer here looks like consistency and is a trap. The busy
     * list this screen is built from INCLUDES the appointment the client is
     * moving — `busyMeetings` is asked for the whole day and nothing excludes
     * their own row — so the gap gets applied around a booking that is about
     * to disappear.
     *
     * Measured on a 60-minute service with a 15-minute gap, one appointment at
     * 10:00: passing the buffer took 09:00 and 11:00 off the client's screen,
     * the two times a person moving a 10:00 appointment is most likely to
     * want, because their own booking blocked the slots either side of itself.
     *
     * Leaving it off restores the behaviour this screen has always had. The
     * proper fix is to drop their own booking from the busy list, which is a
     * change to what the screen may OFFER and wants deciding on its own.
     * ───────────────────────────────────────────────────────────────────────
     */
    const call = code(read(PORTAL));

    expect(call).not.toContain('bookedBuffer()');
  });

  it('and the smart link widens what it tests against', () => {
    const body = code(read(SMART_LINK));

    expect(body).toContain('bufferMinutes');
    expect(body).toMatch(/overlapsBusy\(guardedStart, guardedEnd/);
    expect(body).toMatch(/overlapsExternal\(guardedStart, guardedEnd\)/);
  });

  it('which it can only do because the column is public', () => {
    /* `PUBLIC_COLUMNS` is what the smart link's services come back with. The
       buffer was absent from it, so that route could not have applied the gap
       even if it had tried. */
    const repo = read(REPOSITORY);
    const columns = repo.slice(
      repo.indexOf('static readonly PUBLIC_COLUMNS'),
      repo.indexOf('async listBookable')
    );

    expect(columns).toContain('buffer_minutes');
  });
});
