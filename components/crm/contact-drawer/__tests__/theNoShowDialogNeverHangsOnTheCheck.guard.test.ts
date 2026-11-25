/**
 * The no-show dialog's make-up check always finishes.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE OWNER SAW
 *
 * A booking taken from the booking page — one payment or a payment plan, it
 * made no difference. The owner opens "Mark as no-show" and the dialog shows:
 *
 *     ⟳  Checking whether a make-up can be booked…
 *
 * for ever. "Mark as no-show" stays disabled behind it, so the no-show cannot
 * be recorded at all. The same hour booked from the CALENDAR works, because
 * that surface does not come through this handler.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DEFECT: A FLAG RAISED OUTSIDE THE BLOCK THAT LOWERS IT
 *
 *     setReplacementLoading(true);                    ← unconditional
 *
 *     if (meetingId && (cancelled || no_show)) {
 *       …fetch…
 *       finally { setReplacementLoading(false); }     ← the only clear
 *     }
 *
 * Whenever the guard was false the flag stayed up. And it was false for every
 * PLAIN booking: `BookingsTab` calls the handler with two arguments there, so
 * `meetingId` is undefined. Only a package SESSION passes `row.meeting_id`.
 *
 * A plain booking has no package to add a session to, so "no make-up offer" is
 * the correct answer — it just has to be an ANSWER, not a spinner.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE GUARD
 *
 * Reaching the hang needs the whole drawer: a contact, a booking with a plan,
 * the row menu, and a dialog whose confirm button is disabled by a state flag.
 * What broke is a control-flow shape — a `true` with no matching `false` on one
 * branch — and that stays readable in the source. This asserts the raise sits
 * INSIDE the guard and that the other branch clears it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const DRAWER = 'components/crm/contact-drawer/CRMContactDrawerV2.tsx';
const TAB = 'components/crm/contact-drawer/BookingsTab.tsx';

const read = (file: string) =>
  fs.readFileSync(path.join(process.cwd(), file), 'utf8').replace(/\r\n/g, '\n');

/** Comments stripped: this file asserts on code, and the prose repeats it. */
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const drawer = strip(read(DRAWER));
const tab = strip(read(TAB));

/**
 * The outcome handler, from where it clears the stale offer to where it reads
 * the charge decision. Bounded so the cancel path below cannot satisfy these.
 */
function outcomeHandler(): string {
  const from = drawer.indexOf('setReplacementOffer(null);');
  const to = drawer.indexOf('setPendingOutcomeChargeable(', from);

  expect(from).toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);

  return drawer.slice(from, to);
}

describe('the make-up check cannot be left running', () => {
  it('raises the flag only inside the branch that fetches', () => {
    /*
     * THE BUG, AS ONE ASSERTION. Raised before the `if`, the flag outlives
     * every path that does not fetch.
     */
    const handler = outcomeHandler();
    const raiseAt = handler.indexOf('setReplacementLoading(true)');
    const guardAt = handler.indexOf('if (meetingId');

    expect(guardAt).toBeGreaterThan(-1);
    expect(raiseAt).toBeGreaterThan(guardAt);
  });

  it('clears it on the branch that does not fetch', () => {
    const handler = outcomeHandler();

    expect(handler).toMatch(/\}\s*else\s*\{[\s\S]{0,200}setReplacementLoading\(false\)/);
  });

  it('still clears it when the fetch finishes or throws', () => {
    /* The `finally` that was always there and always right. */
    expect(outcomeHandler()).toMatch(/finally\s*\{[\s\S]{0,120}setReplacementLoading\(false\)/);
  });

  it('raises and lowers it the same number of times', () => {
    /*
     * One raise, two lowers — the fetch's `finally` and the else. Any raise
     * without a matching path down is this defect returning.
     */
    const handler = outcomeHandler();

    expect(handler.match(/setReplacementLoading\(true\)/g)).toHaveLength(1);
    expect(handler.match(/setReplacementLoading\(false\)/g)).toHaveLength(2);
  });
});

describe('why the guard is false so often', () => {
  it('a plain booking is marked without a meeting id', () => {
    /*
     * The call that produced the hang. Two arguments: there is no meeting,
     * because a single booking is not a package session.
     */
    expect(tab).toMatch(/onSetBookingStatus\(booking\.id, 'no_show'\)/);
  });

  it('a package session passes its own meeting', () => {
    /* The case that always worked, kept so the contrast cannot be lost. */
    expect(tab).toMatch(/row\.meeting_id \?\? null/);
  });
});

describe('the cancel path, which never had this', () => {
  it('fetches unconditionally, so its finally always runs', () => {
    /*
     * Asserted so a later "tidy-up" does not give the cancel path the same
     * guard and the same hang.
     */
    const from = drawer.lastIndexOf('setReplacementLoading(true)');
    const segment = drawer.slice(from, from + 600);

    expect(segment).toContain('void (async () => {');
    expect(segment).not.toMatch(/if \(meetingId[\s\S]{0,80}\{\s*$/m);
  });
});
