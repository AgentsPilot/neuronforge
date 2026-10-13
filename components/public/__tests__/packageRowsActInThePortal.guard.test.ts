/**
 * A package meeting is changed the same way the booking above it is.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS
 *
 * The rows of "6 meetings in this package" offered two links:
 *
 *     <a href={`/reschedule/${meeting.token}`}>          → 404
 *     <a href={`/book/manage/${meeting.token}/cancel`}>  → out of the portal
 *
 * The first pointed at a route that no longer exists. `/reschedule/[token]`
 * was removed when that screen moved into the portal as `ReschedulePanel`, and
 * nothing updated these rows — so every package row on every booking has been
 * offering a dead link, silently, because a 404 from an `<a>` is not an error
 * anything in the build or the test suite can see.
 *
 * The second worked and was still wrong: it sent the client out of the portal
 * to a page of its own, which is the thing this whole surface was rebuilt to
 * stop doing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE TOKEN TRAVELS WITH THE OPEN TASK
 *
 * A package meeting is a DIFFERENT booking with its own token — the route
 * mints one per sibling for exactly this. Three booleans could say WHAT was
 * open but not WHICH booking it was open against, so a panel opened from a
 * sibling's row would have acted on the booking the client was looking at
 * instead of the one they clicked. The open task carries its token.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const page = fs.readFileSync(
  path.join(process.cwd(), 'app/book/manage/[token]/page.tsx'),
  'utf8'
);

/** Comments explain the fix; only code can reintroduce it. */
const code = page
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

describe('the package rows never navigate away', () => {
  it('links to no route at all', () => {
    /*
     * Not "links to the right route": every task on this page opens in place,
     * so an anchor in these rows is the defect whatever it points at.
     */
    expect(code).not.toMatch(/href=\{`\/reschedule\//);
    expect(code).not.toMatch(/href=\{`\/book\/manage\/\$\{meeting\.token\}/);
  });

  it('opens the same two panels the booking card opens', () => {
    // One implementation of each, mounted in two places.
    expect(code).toMatch(/<ReschedulePanel[\s\S]{0,200}token=\{task\.token\}/);
    expect(code).toMatch(/<CancelPanel[\s\S]{0,200}token=\{task\.token\}/);
  });

  it('reports back so the list and the booking both refresh', () => {
    // Silent refetch, not a reload: the booking and the list being refreshed
    // are both on screen.
    const mount = code.slice(code.indexOf("task.kind === 'reschedule' || task.kind === 'cancel'"));
    expect(mount.slice(0, 900)).toMatch(/onChanged=\{\(\) => loadBooking\(true\)\}/);
  });
});

describe('both panels open below the list of meetings', () => {
  /*
   * The arrangement asked for, and the reason it is a guard rather than a
   * preference: these opened directly under the booking tile, which put the
   * picker ABOVE the list of meetings it was changing one of. The row the
   * client clicked scrolled away from the panel acting on it.
   */
  const packageList = code.indexOf('meetings.length > 0 &&');
  const mount = code.indexOf("task.kind === 'reschedule' || task.kind === 'cancel'");

  it('mounts them after the package list, not before it', () => {
    expect(packageList).toBeGreaterThan(-1);
    expect(mount).toBeGreaterThan(packageList);
  });

  it('mounts them in exactly one place', () => {
    // Two mounts would put two live pickers for one appointment on screen.
    expect(code.match(/<ReschedulePanel/g)).toHaveLength(1);
    expect(code.match(/<CancelPanel/g)).toHaveLength(1);
  });

  it('keeps the intake form under the booking instead', () => {
    /*
     * Intake belongs to the booking this portal is for and never to a
     * sibling, so it stays with the appointment whose questions it asks —
     * which means it must appear BEFORE the package list.
     */
    const intake = code.indexOf('intakeOpen && (');
    expect(intake).toBeGreaterThan(-1);
    expect(intake).toBeLessThan(packageList);
  });
});

describe('what is open says which booking it is open against', () => {
  it('carries the token with the task', () => {
    /*
     * The union grows as actions move into the page (the quote joined it), so
     * this pins the SHAPE — a kind beside a token — rather than the list.
     */
    expect(code).toMatch(/kind: (?:'[a-z]+'(?: \| )?)+;\s*token: string;/);
  });

  it('defaults to this booking, so the card above is unaffected', () => {
    expect(code).toMatch(/forToken: string = token/);
  });

  it('serves every row from the one mount', () => {
    /*
     * Not gated on whose booking it is: the booking card's buttons and every
     * package row open into the same place, and `task.token` is the only
     * thing that differs between them.
     */
    expect(code).toMatch(/task\.kind === 'reschedule' \|\| task\.kind === 'cancel'/);
    expect(code).not.toMatch(/task\.token !== token/);
  });

  it('names the kinds it draws instead of excluding one', () => {
    /*
     * It read `task.kind !== 'intake'`. When the quote joined the union that
     * exclusion silently matched it too, and the `reschedule ? … : …` below
     * fell to its else branch — so opening a quote drew the CANCEL panel
     * under the package list. An exclusion grows wrong every time the union
     * does; a positive list fails to compile instead.
     */
    expect(code).not.toMatch(/task\.kind !== 'intake'/);
  });

  it('remounts the panel when the row changes', () => {
    // Without a `key` on the token, React reuses the mounted panel and the
    // client sees the previous meeting's slots under the row they just opened.
    expect(code).toMatch(/key=\{task\.token\}/);
  });
});
