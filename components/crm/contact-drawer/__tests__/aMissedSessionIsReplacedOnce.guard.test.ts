/**
 * A missed session is replaced ONCE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS GUARDS
 *
 * A make-up is a new session at a new hour that points back at the one it
 * stands in for. Offering to book a second leaves the client holding two hours
 * for a session they missed, and the second carries nothing recording what it
 * replaces.
 *
 * This was the first symptom reported of the whole missed-session flow: "for
 * no-show booking it keeps the reschedule after adding another meeting as
 * makeup."
 *
 * The cause was not a missing rule but a dropped value. `CRMContactDrawerV2`
 * builds a `replaced` set from every attempt's `replaces_meeting_id` and puts
 * `was_replaced` on each session row. `BookingsTab` then gated `onEditSession`
 * on exactly that field — and never passed it to the actions menu beside it, so
 * one control on the row knew and the other did not. `MeetingRowActions` had no
 * reference to it at all.
 *
 * The CLIENT's portal has withheld its own version of this action on the same
 * basis all along, so the owner's menu was the side that disagreed with both
 * the portal and the row it sat in.
 *
 * Measured 2026-11-08 against the live account: 6 missed sessions across 4
 * bookings were offering a second replacement, out of 75 rows offering the
 * action at all. The other 69 are unaffected.
 *
 * A source guard because the failure is a prop that is computed and not
 * forwarded. Nothing throws, every test stays green, and the row renders
 * perfectly — it just offers one control too many.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const ACTIONS = join(__dirname, '..', 'MeetingRowActions.tsx');
const TAB = join(__dirname, '..', 'BookingsTab.tsx');
const DRAWER = join(__dirname, '..', 'CRMContactDrawerV2.tsx');

describe('a session that has already been made up offers no second replacement', () => {
  const actions = readFileSync(ACTIONS, 'utf8');
  const tab = readFileSync(TAB, 'utf8');
  const drawer = readFileSync(DRAWER, 'utf8');

  it('takes the fact as a prop, defaulting to false', () => {
    /* Defaulted, so a caller that does not know stays exactly as it was. */
    expect(actions).toContain('alreadyReplaced?: boolean;');
    expect(actions).toContain('alreadyReplaced = false,');
  });

  it('withholds the action on it, beside held and called-off', () => {
    /*
     * All three say the same thing: this hour's outcome is settled and there
     * is nothing left to arrange for it.
     */
    const gate = actions.match(/if \(onReschedule && [^)]*\)/);
    expect(gate).not.toBeNull();
    expect(gate![0]).toContain('!held');
    expect(gate![0]).toContain('!calledOff');
    expect(gate![0]).toContain('!alreadyReplaced');
  });

  it('is given the fact by the row that already had it', () => {
    /*
     * `was_replaced` is on the row and `BookingsTab` was already gating
     * `onEditSession` on it. The menu beside it must read the same field, or
     * one control on one row contradicts the other.
     */
    expect(tab).toContain('alreadyReplaced={Boolean(row.was_replaced)}');
    expect(tab).toContain('!row.was_replaced');
  });

  it('still computes that fact from what points at the session', () => {
    /*
     * A session is replaced when something POINTS AT it, never by a flag on
     * the session itself — nothing writes one, and a make-up that was later
     * moved still stands in for the same hour.
     */
    expect(drawer).toContain('replaces_meeting_id');
    expect(drawer).toContain('was_replaced: replaced.has(attempt.id)');
  });

  it('keeps the cancelled-job rule, which is a different reason to withhold it', () => {
    /*
     * A called-off job withholds the action on every session, replaced or not:
     * there is no work left to rearrange. Live case 2026-11-08, booking
     * a7bc8084 — cancelled with `cancel_reason: client_no_show` — where every
     * session is withheld on this rule rather than on the one above.
     */
    expect(actions).toMatch(/const calledOff =[\s\S]{0,160}bookingCancelled/);
  });
});
