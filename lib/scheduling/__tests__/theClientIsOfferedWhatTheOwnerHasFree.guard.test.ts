/**
 * The client is offered what the owner actually has free.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG
 *
 * Four public surfaces answer "when can I come?" — the subdomain booking page,
 * the smart link, the portal's reschedule, and the two routes that write the
 * booking. They are the same product to a client and they did not agree:
 *
 *   · the SMART LINK never read the owner's synced calendar, so an hour the
 *     owner was out for was withheld at `/site/{subdomain}/book` and sold at
 *     `/c/{userCode}/book` — one React page, two endpoints, two answers;
 *   · both routes that WRITE the booking read only our own table, so the last
 *     gate before an appointment exists was the one that could not see the
 *     owner's diary. No list, however correct, can compensate for that: a
 *     stale page or two clients a second apart both arrive there;
 *   · `min_notice_hours` was honoured when a client MOVED an appointment and
 *     ignored when one BOOKED it, because the column never reached the list of
 *     columns the public may see;
 *   · the subdomain page applied no time test at all — not notice, not the
 *     advance limit, not even "has this hour already passed";
 *   · the smart link quoted every hour in UTC while the owner's windows mean
 *     local time, so a business in Jerusalem published its 09:00 as 11:00;
 *   · and the subdomain page read `windows[0]`, so a business with a split day
 *     lost its afternoon on one of its two booking pages.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE GUARD
 *
 * Reaching any of it needs an OAuth round trip to Google, a synced week of
 * someone's diary, and a client walking a booking journey to its end. What
 * broke is decidable without any of that: a read that one route made and its
 * sibling did not, a column missing from a shared list, a gate applied on one
 * surface and not the next. Those are visible in the source, and divergence
 * between parallel surfaces is exactly what creeps back — it did here, four
 * times over, each time silently.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8');
/** Comments stripped: the prose above and in those files quotes the very code
    it forbids. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const SMART_LINK = 'app/api/conversion/[userCode]/availability/route.ts';
const SUBDOMAIN = 'app/api/website/booking/availability/route.ts';
const CREATE = 'app/api/website/booking/create/route.ts';
const CONFIRM = 'app/api/website/booking/confirm/route.ts';
const RESCHEDULE = 'app/api/book/manage/[token]/reschedule/route.ts';
const REPOSITORY = 'lib/repositories/SchedulingRepository.ts';

const smartLink = code(read(SMART_LINK));
const subdomain = code(read(SUBDOMAIN));
const create = code(read(CREATE));
const confirm = code(read(CONFIRM));
const reschedule = code(read(RESCHEDULE));

describe('a synced calendar blocks a client booking', () => {
  it.each([
    ['the smart link', SMART_LINK, smartLink],
    ['the subdomain page', SUBDOMAIN, subdomain],
    ['the booking write', CREATE, create],
    ['the booking confirm', CONFIRM, confirm],
    ['the portal reschedule', RESCHEDULE, reschedule],
  ])('%s reads the owner external calendar', (_label, _file, source) => {
    /*
     * The owner's requirement, in one line: "if the user sync calendar the
     * client can't book a user time if he has something else outside of this
     * platform". Every surface, including the ones that write.
     */
    expect(source).toContain("from '@/lib/scheduling/externalBusy'");
    expect(source).toMatch(/externalBusy\(/);
  });

  it.each([
    ['create', create],
    ['confirm', confirm],
  ])('%s refuses the slot rather than logging it', (_label, source) => {
    /* A read that does not change the verdict is worse than no read: it looks
       handled. The 409 is the whole point. */
    const gate = source.slice(source.indexOf('externalBusy('));

    expect(gate).toMatch(/externalConflicts\.length > 0/);
    expect(gate).toMatch(/externalConflicts\.length > 0[\s\S]{0,260}status: 409/);
  });

  it('nobody keeps a private copy of the read', () => {
    /*
     * There were four hand-written copies of this query and they had already
     * drifted — which is how two of the five surfaces came to lack it. One
     * definition, or the next surface added will be the fifth copy.
     */
    for (const source of [smartLink, subdomain, create, confirm, reschedule]) {
      expect(source).not.toContain('getBusySlots(');
    }
  });

  it('an unreadable calendar does not take the booking page down', () => {
    /* Fails soft, deliberately, and only in the one place that decides it. */
    const helper = read('lib/scheduling/externalBusy.ts');

    expect(helper).toMatch(/catch[\s\S]{0,200}return \[\]/);
  });
});

describe("the business's own settings reach its booking pages", () => {
  it('the public column list carries both booking limits', () => {
    /*
     * `min_notice_hours` was configured, stored, and invisible to every public
     * surface: absent here, so the services those pages read had no notice to
     * apply. Testing the list rather than a route, because the list is what
     * made the setting unavailable to all of them at once.
     */
    const repo = read(REPOSITORY);
    const columns = repo.slice(
      repo.indexOf('static readonly PUBLIC_COLUMNS'),
      repo.indexOf('async listBookable')
    );

    expect(columns).toContain('advance_booking_days');
    expect(columns).toContain('min_notice_hours');
  });

  it.each([
    ['the smart link', smartLink],
    ['the subdomain page', subdomain],
  ])('%s applies the notice and the advance limit', (_label, source) => {
    expect(source).toMatch(/min_notice_hours \?\? 24/);
    expect(source).toMatch(/60 \* 60 \* 1000/);
    expect(source).toMatch(/24 \* 60 \* 60 \* 1000/);

    /*
     * The advance window comes from `bookingWindow`, not from a number typed
     * here. That module exists because this value had drifted across the
     * surfaces that read it — 30 in one place, 90 in another — and a fresh
     * literal in a new gate would have been the next copy.
     */
    expect(source).toContain('bookableDaysFor(');
    expect(source).not.toMatch(/advance_booking_days \?\? \d+/);
  });

  it('the subdomain page does not offer an hour that has gone', () => {
    /*
     * Every slot left its generator `available: true` and was narrowed only by
     * what overlapped it, so at two in the afternoon a client was still offered
     * nine that morning.
     */
    expect(subdomain).toMatch(/startsAt >= earliest && startsAt <= latest/);
    expect(subdomain).toMatch(/available: slot\.available && withinWindow/);
  });
});

describe('both booking pages mean the same hour by "09:00"', () => {
  it('the smart link reads the real timezone', () => {
    /*
     * It read the literal `'UTC'`. `business_profiles.timezone` genuinely does
     * not exist — naming it makes PostgREST reject the whole select — and
     * `user_preferences` is where the zone lives.
     */
    expect(smartLink).not.toMatch(/const timezone = 'UTC'/);
    expect(smartLink).toContain("from('user_preferences')");
    expect(smartLink).toMatch(/safeTimezone\(ownerPrefs\?\.timezone\)/);
  });

  it('a wall clock becomes an instant through the business zone', () => {
    /* `setHours` on a Date means the hour where the SERVER is, which on Vercel
       is UTC — the owner's whole offset, applied to every published slot. */
    expect(smartLink).toContain('businessInstant(dateKey, window.start, timezone)');
    expect(smartLink).not.toMatch(/setHours\(startHour/);
  });

  it('a split day keeps its afternoon on both', () => {
    /*
     * The subdomain page took `windows[0]` and said so in a comment. A business
     * open 09:00–13:00 and 16:00–19:00 published its morning there and its
     * whole day on the sibling page.
     */
    expect(subdomain).toContain('for (const daySettings of windows)');
    expect(subdomain).not.toMatch(/const daySettings = windows\[0\]/);
    expect(smartLink).toContain('for (const window of windowsForDate(');
  });
});
