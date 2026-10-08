/**
 * Every booking badge that can read "Upcoming" can also say the meeting passed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE GUARD AS WELL AS THE UNIT TESTS
 *
 * `meetingPastDue.test.ts` proves the RULE is right. It cannot prove anybody
 * calls it, and that was the whole defect: the clock-aware resolver already
 * existed in `BookingsTab` for quoted jobs (`getQuotedStatusLabel`, which takes
 * a `meetingState`), while the general badge beside it was a flat status → label
 * map. One of the two was fixed and the other was not, in the same file.
 *
 * So what has to hold is a property of the call sites: no surface renders a
 * booking status without offering it the start time.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND THAT THE NOTE REPLACES THE STATUS WORD
 *
 * It was appended at first — "Awaiting payment" keeping its word and gaining
 * the clock beside it. Rendered, that produced "קרובה (ממתין לעדכון)": upcoming,
 * awaiting an update. The halves contradict each other, because `status` reads
 * `confirmed` only while nobody has marked the meeting, which is the very thing
 * the note reports. So the note now stands alone, in the one phrase the session
 * card already used.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

const bookingsTab = read('components/crm/contact-drawer/BookingsTab.tsx');
const sessionCard = read('components/crm/SessionCard.tsx');
const translations = read('lib/business-os/LanguageContext.tsx');

describe('the badge surfaces consult the clock', () => {
  it.each([
    ['BookingsTab', 'components/crm/contact-drawer/BookingsTab.tsx'],
    ['SessionCard', 'components/crm/SessionCard.tsx'],
  ])('%s calls isMeetingPastDue', (_name, file) => {
    expect(read(file)).toMatch(/isMeetingPastDue\(/);
  });

  it('every getBookingStatusLabel call passes a start time', () => {
    /*
     * The parameter is optional on purpose — a caller with no start time in
     * hand must not be forced to invent one — which means a call site can
     * silently omit it and lose the note with no error anywhere. This is the
     * only thing that notices.
     *
     * Three arguments and a closing paren is the shape that drops it.
     */
    // `[\s\S]` rather than `.` with the `s` flag: dotAll needs an es2018 target
    // and this project's is lower, so the flag is a compile error here.
    const calls = bookingsTab.match(/getBookingStatusLabel\([\s\S]*?\)/g) ?? [];

    expect(calls.length).toBeGreaterThan(0);

    for (const call of calls) {
      expect(call).toMatch(/start_time/);
    }
  });

  it('SessionCard still prints the plain status when nothing is past due', () => {
    // The note is an addition. A card whose meeting is ahead must read exactly
    // as it did before this change.
    expect(sessionCard).toMatch(/:\s*t\(`crm\.booking\.status\.\$\{booking\.status\}`\)/);
  });
});

describe('the note replaces the status word, and does not wrap it', () => {
  it('reuses the session card\u2019s phrase rather than a second key', () => {
    /*
     * This used to be its own key, `crm.booking.status.past_due_note`, holding
     * a `{status} (…)` template. Two problems, and the second killed it:
     *
     *   1. Two vocabularies for one state \u2014 the badge said one thing and the
     *      session card another about the same booking in the same drawer.
     *   2. Wrapping produced "\u05e7\u05e8\u05d5\u05d1\u05d4 (\u05de\u05de\u05ea\u05d9\u05df \u05dc\u05e2\u05d3\u05db\u05d5\u05df)" \u2014 upcoming, awaiting an
     *      update \u2014 whose halves contradict each other. `status` reads
     *      `confirmed` only because nobody has marked it, which is the very
     *      thing the note reports, so printing both kept the stale half beside
     *      the true one.
     *
     * One phrase now, from `crm.journey.awaiting_outcome`, which the session
     * card already used.
     */
    for (const file of [bookingsTab, sessionCard]) {
      expect(file).toMatch(/crm\.journey\.awaiting_outcome/);
    }
  });

  it('leaves no trace of the wrapping template', () => {
    // A `{status}` interpolation here would bring the contradiction back.
    for (const file of [bookingsTab, sessionCard, translations]) {
      expect(file).not.toMatch(/past_due_note/);
    }
  });

  it('the phrase itself exists in all three locales', () => {
    /*
     * Three, not one. A missing locale falls back to the English literal in the
     * call site's `||`, so Hebrew would quietly print English in an RTL badge.
     */
    const keys = translations.match(/'crm\.journey\.awaiting_outcome':/g) ?? [];

    expect(keys).toHaveLength(3);
  });
});
