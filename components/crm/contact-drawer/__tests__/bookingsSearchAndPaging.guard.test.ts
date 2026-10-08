/**
 * The bookings tab is searchable, and reads five at a time.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY
 *
 * A contact who has been with a business for a year has thirty bookings in this
 * tab, each an expandable journey card several hundred pixels tall, inside a
 * drawer that is a column beside the contact rather than a page of its own.
 * Finding "the consultation in March" was scrolling, not reading.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS WORTH PINNING, AND IT IS NOT THE MARKUP
 *
 * Three decisions, each of which has a wrong version that looks right:
 *
 *   · The page is CLAMPED against the filtered list rather than reset by an
 *     effect. Searching narrows the list under the reader, and page 4 of a set
 *     that now has one page renders empty — the same "it is there but you
 *     cannot see it" fault the orders page shipped.
 *
 *   · The date is searched AS RENDERED. Matching the ISO string instead would
 *     find "2026" in a UTC timestamp while the card shows a different year in
 *     the business's zone, and would never match "אוק" at all.
 *
 *   · A PACKAGE's meetings are searched. The card an owner is hunting for is
 *     the container, so hiding a package whose fourth session matches hides the
 *     only row that could have shown it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const FILE = 'components/crm/contact-drawer/BookingsTab.tsx';
const CONTEXT = 'lib/business-os/LanguageContext.tsx';

const source = fs.readFileSync(path.join(process.cwd(), FILE), 'utf8');
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const context = fs.readFileSync(path.join(process.cwd(), CONTEXT), 'utf8');

describe('paging', () => {
  it('strips comments before matching, or it fails on its own explanation', () => {
    expect(source).toContain('Five a page.');
    expect(code).not.toContain('Five a page.');
  });

  it('shows five', () => {
    expect(code).toContain('const PAGE_SIZE = 5;');
  });

  it('renders the page, not the whole list', () => {
    expect(code).toMatch(/visibleSessions = filteredSessions\.slice\(page \* PAGE_SIZE, page \* PAGE_SIZE \+ PAGE_SIZE\)/);
    expect(code).toContain('{visibleSessions.map((session) => {');
    // The old render, which drew everything.
    expect(code).not.toContain('{sortedSessions.map((session) => {');
  });

  it('clamps the page instead of resetting it from an effect', () => {
    /*
     * Derived at render from what EXISTS, so it can never point past the end
     * and there is no frame in between where the list is empty.
     */
    expect(code).toMatch(/const page = Math\.min\(bookingPage, pageCount - 1\)/);
    expect(code).toMatch(/const pageCount = Math\.max\(1, Math\.ceil\(filteredSessions\.length \/ PAGE_SIZE\)\)/);
  });

  it('counts the filtered set, which is the list being looked at', () => {
    // A pager that counted everything while the search had narrowed it would
    // be describing a different screen.
    const pager = code.slice(code.indexOf('{pageCount > 1 && ('));
    expect(pager).toContain("String(filteredSessions.length)");
    expect(pager).not.toContain('sortedSessions.length');
  });

  it('reuses the orders pager copy rather than writing a second one', () => {
    // Two pagers saying the same thing in different words are two answers to
    // one question. These keys already exist in all three languages.
    expect(code).toContain("t('payments.pagination.showing')");
    expect(code).toContain("t('payments.pagination.prev')");
    expect(code).toContain("t('payments.pagination.next')");
  });

  it('hides itself when it cannot move', () => {
    expect(code).toContain('{pageCount > 1 && (');
  });
});

describe('search', () => {
  const haystack = code.slice(code.indexOf('const haystack'), code.indexOf('return haystack(session)'));

  it('matches the service, the note and the status', () => {
    expect(haystack).toContain('one.booking.service?.service_name');
    expect(haystack).toContain('one.booking.notes');
    expect(haystack).toContain('getBookingStatusLabel(');
  });

  it('searches the status word the owner can actually see', () => {
    // Clock-aware: a confirmed meeting whose time has passed with nobody
    // marking it reads "awaiting an outcome", not "upcoming".
    expect(haystack).toContain('one.booking.start_time\n      ).text;');
  });

  it('matches the date as the card renders it, not as it is stored', () => {
    expect(haystack).toContain('formatDate(one.booking.start_time, { withYear: true })');
    expect(haystack).not.toContain('one.booking.start_time.toLowerCase()');
  });

  it("looks inside a package's meetings", () => {
    expect(code).toMatch(/\(session\.meetings \?\? \[\]\)\.some\(meeting => haystack\(meeting\)\.includes\(needle\)\)/);
  });

  it('is case-folded, trimmed, and does not transliterate', () => {
    // A Hebrew business searching Hebrew words against Hebrew records needs no
    // romanisation, and guessing at one matches things nobody asked for.
    expect(code).toContain("const needle = bookingSearch.trim().toLowerCase();");
    expect(code).not.toMatch(/translit|romani[sz]/i);
  });

  it('appears only once there is more than a page to hunt through', () => {
    expect(code).toContain('{sortedSessions.length > PAGE_SIZE && (');
  });

  it('returns to the first page when the term changes', () => {
    const input = code.slice(code.indexOf('{sortedSessions.length > PAGE_SIZE && ('), code.indexOf('{filteredSessions.length === 0 ?'));
    expect(input).toContain('setBookingSearch(e.target.value)');
    expect(input).toContain('setBookingPage(0)');
  });

  it('says so when it finds nothing, and quotes the term', () => {
    // An empty list under a filled-in box reads as a broken drawer.
    expect(code).toContain("t('crm.drawer.no_booking_matches')");
    expect(code).toContain("'{term}'");
  });

  it('is labelled in every language the drawer speaks', () => {
    expect(context.match(/'crm\.drawer\.search_bookings':/g) ?? []).toHaveLength(3);
    expect(context.match(/'crm\.drawer\.no_booking_matches':/g) ?? []).toHaveLength(3);
    expect(context).toContain("'crm.drawer.search_bookings': 'חיפוש בהזמנות'");
  });
});
