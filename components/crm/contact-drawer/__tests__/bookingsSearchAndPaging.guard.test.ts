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
 *     the business's zone, and would never match "אוק" at all. The stored form
 *     is searched BESIDE it, never in its place.
 *
 *   · A PACKAGE's meetings are searched. The card an owner is hunting for is
 *     the container, so hiding a package whose fourth session matches hides the
 *     only row that could have shown it.
 *
 *   · The query is split into WORDS and every word must land, because matching
 *     the whole query as one contiguous string meant "oct 2026" failed against
 *     "Thu, Oct 12, 2026" — a comma between the two halves was enough.
 *
 *   · A NUMBER is reached twice over: as text, and as bare digits against the
 *     record's figures with their separators closed up. The owner types "1200"
 *     and the card shows "₪1,200.00"; neither should have to know about the
 *     other.
 *
 *   · The drawer fetches a window big enough to search. The tab filters
 *     CLIENT-SIDE, so a 50-row window ordered newest-first meant a client with
 *     fifty-five bookings had five the box could not see — and it answered "no
 *     bookings match" for a record that exists.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';
import { dictionarySource } from '@/tests/helpers/dictionarySource';

const FILE = 'components/crm/contact-drawer/BookingsTab.tsx';

const source = fs.readFileSync(path.join(process.cwd(), FILE), 'utf8');
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const context = dictionarySource();

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
     *
     * The stored value gained a `null` — "nobody has paged yet" — so the view
     * can follow a booking named by a link from the Needs-you card instead of
     * always opening at the top. That is a different DEFAULT, not a different
     * mechanism: still derived at render, still clamped, still no effect.
     */
    expect(code).toMatch(/const page = Math\.min\(bookingPage \?\? \w+, pageCount - 1\)/);
    expect(code).toMatch(/const pageCount = Math\.max\(1, Math\.ceil\(filteredSessions\.length \/ PAGE_SIZE\)\)/);
    // The reset-by-effect this was written against must stay gone.
    expect(code).not.toMatch(/useEffect\([\s\S]{0,200}setBookingPage/);
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
  const haystack = code.slice(code.indexOf('const haystack'), code.indexOf('const text = [haystack(session)'));

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

  it('matches the date as the card renders it AND as it is stored', () => {
    /*
     * Rendered is the only form on the business's clock and the only one that
     * can match "אוק". The ISO prefix is the form an owner reading a bank line
     * or a spreadsheet has in front of them, and one no locale will print. The
     * requirement is both; it was never "instead".
     */
    expect(haystack).toContain('formatDate(one.booking.start_time, { withYear: true })');
    expect(haystack).toContain('one.booking.start_time?.slice(0, 10)');
    expect(haystack).not.toContain('one.booking.start_time.toLowerCase()');
  });

  it("pools the container's words with its meetings, rather than testing card by card", () => {
    /*
     * `every` word must land, but not necessarily on the SAME row: "package
     * october" has its name on the container and its date on session four, and
     * a per-card test would reject both halves. The card shown is the
     * container either way.
     */
    expect(code).toMatch(/const text = \[haystack\(session\), \.\.\.\(session\.meetings \?\? \[\]\)\.map\(haystack\)\]\.join\(' '\)/);
  });

  it('splits the query into words, every one of which must land', () => {
    /*
     * Matching the whole query as one contiguous string is what made "oct
     * 2026" fail against "Thu, Oct 12, 2026". The splitting and the AND both
     * live in `lib/business-os/bookingSearch.ts`, whose own test exercises them
     * on real strings — this only pins that the tab uses them rather than
     * growing a second opinion about what a match is.
     */
    expect(code).toContain('const needles = searchWords(needle);');
    expect(code).toContain('return recordMatches(needles, text);');
    expect(code).toContain('if (needles.length === 0) return true;');
    expect(code).toContain("from '@/lib/business-os/bookingSearch'");
  });

  it('keeps the matching rules in one module, not two', () => {
    /*
     * The number handling is three assertions about one character class, and a
     * grep cannot check any of them — see bookingSearch.test.ts, which runs.
     * What this CAN check is that the component has not quietly re-implemented
     * them, which is the failure that would make the tested module irrelevant.
     */
    for (const own of ['const figures = (', 'const hitsWord = (', 'const fold = (']) {
      expect(code).not.toContain(own);
    }
  });

  it('searches the money, the ids and the phone an owner is reading off something else', () => {
    // The fields this box could not see are exactly the ones with enough
    // spread to identify one booking out of fifty.
    expect(haystack).toContain('one.payment?.amount');
    expect(haystack).toContain('one.payment?.invoicedAmount');
    expect(haystack).toContain('one.payment?.last4');
    expect(haystack).toContain('one.payment?.invoiceId');
    expect(haystack).toContain('one.booking.id');
    // Twice: as written, and as digits alone, however the record spells it.
    expect(haystack).toContain('one.booking.client_phone');
    expect(haystack).toContain("one.booking.client_phone?.replace(/\\D+/g, '')");
  });

  it('searches the journey rail, which is where a quote total is shown', () => {
    /*
     * REPORTED: a ₪280 quote could not be found by "280".
     *
     * `payment.amount` on a quoted job is the stage being described or the
     * invoice behind it, and `plan.totalAmount` exists only once a quote has
     * more than one stage — so on a job billed in one go, the figure the owner
     * is looking at was in no field this searched. It is rendered by the quote
     * step, out of `proposal.total` into `details`, and the card reads it back
     * from exactly here (`journeySteps.find(s => s.key === 'proposal')`).
     *
     * Pinned as the WHOLE rail rather than that one step: the same is true of
     * every other figure and word on it, and singling out the quote would
     * leave the next one to be reported as a bug.
     */
    expect(haystack).toContain('one.journeySteps ?? []');
    expect(haystack).toContain('step.details');
    expect(haystack).toContain('step.metadata ?? {}');
  });

  it("searches what somebody actually wrote, including the client's own answers", () => {
    expect(haystack).toContain('one.booking.cancel_note');
    // The older free text too, or rows cancelled before the code answer to
    // nothing at all.
    expect(haystack).toContain('one.booking.cancellation_reason');
    expect(haystack).toContain('one.booking.intake_responses?.responses');
  });

  it('cannot throw on an answer shape it does not know', () => {
    // Called during render: a throw here unmounts the drawer and throws the
    // owner out of the contact they were working in.
    const answer = code.slice(code.indexOf('const answerText'), code.indexOf('const needle ='));
    expect(answer).toContain('JSON.stringify(answer)');
    expect(answer).toMatch(/catch \{\s*return '';/);
  });

  it('is case-folded, trimmed, and does not transliterate', () => {
    /*
     * A Hebrew business searching Hebrew words against Hebrew records needs no
     * romanisation, and guessing at one matches things nobody asked for.
     *
     * Latin combining marks ARE stripped, from both sides, so neither the query
     * nor the record has to be spelled the way the other was. That is a fold,
     * not a transliteration: Hebrew points sit in a different Unicode block and
     * are untouched, which bookingSearch.test.ts asserts on real Hebrew.
     */
    expect(code).toContain("const needle = bookingSearch.trim().toLowerCase();");
    // Both sides folded by the same function, or one of them is not reachable
    // from the other.
    expect(code).toContain('const needles = searchWords(needle);');
    expect(code).toContain('return foldForSearch(');
    expect(code).not.toMatch(/translit|romani[sz]/i);

    /*
     * The class is pinned by its codepoints rather than by the characters
     * themselves: written literally they are invisible in a diff, and a review
     * cannot tell U+0300–U+036F (Latin marks, to be stripped) from
     * U+0591–U+05C7 (Hebrew points, to be left alone).
     */
    const matcher = fs.readFileSync(path.join(process.cwd(), 'lib/business-os/bookingSearch.ts'), 'utf8');
    expect(matcher).toContain("normalize('NFKD').replace(/[\\u0300-\\u036f]/g, '')");
    expect(matcher).not.toMatch(/\\u05[0-9a-f]{2}/i);
  });

  it('appears only once there is more than a page to hunt through', () => {
    expect(code).toContain('{sortedSessions.length > PAGE_SIZE && (');
  });

  it('stops pointing at the old page when the term changes', () => {
    /*
     * `setBookingPage(null)`, not `(0)`.
     *
     * The requirement is that page 3 of the previous set does not survive into
     * a set that may not have three pages — and `null` meets it, because the
     * derived page falls back to 0 when nothing is focused. It is the better
     * answer rather than merely an equal one: when a search still CONTAINS the
     * booking a Needs-you link named, null lands the owner back on it, where 0
     * would drop them at the top of the results and make them hunt again.
     */
    const input = code.slice(code.indexOf('{sortedSessions.length > PAGE_SIZE && ('), code.indexOf('{filteredSessions.length === 0 ?'));
    expect(input).toContain('setBookingSearch(e.target.value)');
    expect(input).toContain('setBookingPage(null)');
    // Never pinned to a literal page, which is what stranded the focused row.
    expect(input).not.toContain('setBookingPage(0)');
  });

  it('says so when it finds nothing, and quotes the term', () => {
    // An empty list under a filled-in box reads as a broken drawer.
    expect(code).toContain("t('crm.drawer.no_booking_matches')");
    expect(code).toContain("'{term}'");
  });

  it('is labelled in every language the drawer speaks', () => {
    expect(context.match(/'crm\.drawer\.search_bookings':/g) ?? []).toHaveLength(3);
    expect(context.match(/'crm\.drawer\.no_booking_matches':/g) ?? []).toHaveLength(3);
    expect(context).toContain("'crm.drawer.search_bookings': 'כל מילה, תאריך או סכום'");
  });

  it('names the date and the amount in the placeholder, in every language', () => {
    /*
     * "Search bookings" tells an owner to type the service name, which on a
     * client with fifty orders matches all fifty — and they conclude the box is
     * broken. The placeholder is the only place the numbers can be offered,
     * since nothing else on screen says a figure or an invoice number works.
     */
    expect(code).toContain("t('crm.drawer.search_bookings') || 'Any word, date or amount'");
    expect(context).toContain("'crm.drawer.search_bookings': 'Any word, date or amount'");
    expect(context).toContain("'crm.drawer.search_bookings': 'Cualquier palabra, fecha o importe'");
  });
});

describe('the window the search can see', () => {
  /*
   * The tab filters CLIENT-SIDE. Everything above narrows the list that
   * ARRIVED, so the fetch decides what can be found at all — and a window
   * smaller than a client's history makes the box answer "no bookings match"
   * about a record that exists. That is the one failure a search must not have,
   * because it is indistinguishable from the truth.
   */
  const drawer = fs.readFileSync(
    path.join(process.cwd(), 'components/crm/contact-drawer/CRMContactDrawerV2.tsx'),
    'utf8'
  );

  it('asks for a window big enough to hold a client history', () => {
    const windows = drawer.match(/\/api\/scheduling\/bookings\?contact_id=\$\{contactId\}&limit=(\d+)/g) ?? [];
    expect(windows.length).toBeGreaterThan(0);
    for (const seen of windows) {
      expect(Number(seen.match(/limit=(\d+)/)![1])).toBeGreaterThanOrEqual(200);
    }
  });

  it('asks for the same window on every path, or a reload shrinks the list', () => {
    // The first load and the silent refresh both feed the same `sessions`
    // state. Two different numbers means the set being searched changes under
    // the owner for reasons they cannot see.
    const windows = (drawer.match(/\/api\/scheduling\/bookings\?contact_id=\$\{contactId\}&limit=(\d+)/g) ?? [])
      .map(seen => seen.match(/limit=(\d+)/)![1]);
    expect(new Set(windows).size).toBe(1);
  });

  it('stays inside what the route will serve', () => {
    // `/api/scheduling/bookings` validates `limit` at max 500; asking for more
    // is a 400, which is a drawer with no bookings in it.
    const route = fs.readFileSync(path.join(process.cwd(), 'app/api/scheduling/bookings/route.ts'), 'utf8');
    const ceiling = Number(route.match(/limit: z\.number\(\)\.min\(1\)\.max\((\d+)\)/)![1]);
    const windows = (drawer.match(/\/api\/scheduling\/bookings\?contact_id=\$\{contactId\}&limit=(\d+)/g) ?? [])
      .map(seen => Number(seen.match(/limit=(\d+)/)![1]));
    for (const asked of windows) expect(asked).toBeLessThanOrEqual(ceiling);
  });
});
