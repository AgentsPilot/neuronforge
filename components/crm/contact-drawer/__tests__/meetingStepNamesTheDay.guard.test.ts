/**
 * The meeting step on a contact's journey says WHICH DAY.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS MISSING
 *
 * The step's first line was the clock alone — "14:00 – 15:00". The weekday sits
 * further down the same card, beside the status, so an owner reading the
 * meeting step learned it was a Monday at two and had to work out WHICH Monday
 * from the booking's position in the list. On a contact with a package of six
 * sessions, every one of those steps read the same.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE GUARD
 *
 * The step is rendered deep inside a journey built from a booking, its payment,
 * its intake and its proposal; mounting it needs most of a contact's world as a
 * fixture. What actually went wrong is one expression, and the rules worth
 * keeping are about which formatter it uses: the file's own date, so the step
 * matches the dates beside it, and the BUSINESS's timezone, which is the fault
 * this file has already fixed once — an evening appointment named the next day
 * for an owner logged in from abroad.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const FILE = 'components/crm/contact-drawer/BookingsTab.tsx';
const source = fs.readFileSync(path.join(process.cwd(), FILE), 'utf8');
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/** The expression that builds the meeting step's first line. */
const fact = code.slice(code.indexOf('const scheduleFact ='), code.indexOf('const meetingSettled'));

describe('the meeting step', () => {
  it('strips comments before matching, or it fails on its own explanation', () => {
    expect(source).toContain('WHICH DAY, not just which hour');
    expect(code).not.toContain('WHICH DAY, not just which hour');
  });

  it('names the date as well as the time', () => {
    /*
     * Whitespace-tolerant: the date is built inside a template literal now, so
     * the call spans lines and a contiguous substring no longer matches. What
     * has to stay true is that both appear, not how they are wrapped.
     */
    expect(fact).toMatch(/formatShortDate\(\s*booking\.start_time/);
    expect(fact).toContain('formatTime(booking.start_time)');
  });

  it('names the weekday beside its own date', () => {
    /*
     * The weekday used to sit two lines down beside the status, so "4 Oct 2026"
     * and "Sunday" were one fact printed twice and the status read as a
     * property of the weekday it was glued to. A comma joins them, not the
     * middot this card uses for things that are genuinely separate.
     */
    expect(fact).toMatch(/weekday: 'long'/);
    expect(fact).toMatch(/\}, \$\{formatShortDate/);
  });

  it('carries the year, because a drawer is read months later', () => {
    /*
     * The drawer holds a client's whole history at once: a package running into
     * next year, a booking from last autumn. "12 Oct" answers none of those,
     * and unlike a list grouped under a date heading there is no surrounding
     * context to recover the year from.
     */
    expect(fact).toContain('{ withYear: true }');
  });

  it('leads with the date, because that is what the step is being asked', () => {
    // The hour is the detail of the day, not the other way round.
    expect(fact.indexOf('formatShortDate')).toBeLessThan(fact.indexOf('formatTime'));
  });

  it('keeps the range when the booking has an end', () => {
    expect(fact).toContain('formatTime(booking.end_time)');
  });

  it('and so does the booking header above it', () => {
    // The card's headline date, and the only one a collapsed booking shows.
    // Both branches: a scheduled appointment, and an unscheduled purchase whose
    // only record of "when" is the moment it was bought.
    expect(code).toContain('formatDate(booking.start_time, { withYear: true })');
    // The purchase date's own argument carries parentheses of its own, so this
    // matches the tail rather than trying to span the call.
    expect(code).toContain('formatDateTime(booking.created_at');
    expect(code).toContain("new Date().toISOString(), { withYear: true })");
  });

  it('leaves the compact dates alone', () => {
    /*
     * A refund date inside a 290px money column and a version stamp are read in
     * the context of the row they sit in, so a year there costs width to repeat
     * what the row already implies. Opt-in, not applied to every date.
     */
    /*
     * The refund date this used to cite lived in the charged/returned/kept
     * ledger, which is gone: the strip below it now carries those three figures
     * in those words, so the card was stating one account twice. A version
     * stamp is the remaining compact date, and the opt-in is what keeps the year
     * off it.
     */
    expect(code).toContain('version.at ? formatShortDate(version.at)');
    expect(code).toMatch(/const withYear = \(on\?: boolean\)/);
  });

  it('uses the file\'s own formatters, not a new one', () => {
    /*
     * Both resolve through `timeZoneOptions`, which pins them to the business's
     * zone. A date built with `toLocaleDateString` here would name an evening
     * appointment as the next day for an owner logged in from abroad — the
     * exact fault the weekday below it carries a comment about.
     */
    const definitions = code.slice(0, code.indexOf('const scheduleFact ='));
    expect(definitions).toMatch(/const formatShortDate = \(dateString: string, opts\?: \{ withYear\?: boolean \}\) => \{/);
    expect(definitions.slice(definitions.indexOf('const formatShortDate'))).toContain('timeZoneOptions');
    expect(fact).not.toContain('toLocaleDateString');
  });
});
