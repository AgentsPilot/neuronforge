/**
 * One payment per hour the client actually receives.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A pay-per-session package bills the hour whether it was HELD or MISSED — the
 * slot was reserved and will not be held again, so the stage bound to it falls
 * due. The no-show dialog offers one lever over that: "charge the session".
 *
 *   charged (the default)  the client paid for the hour they missed, so a
 *                          make-up is the owner's gift and carries no money.
 *   WAIVED                 nothing was collected for the missed hour.
 *
 * The make-up was hardcoded free in BOTH cases. So a waived miss plus a make-up
 * gave the client a delivered session for nothing — and it hid for a long time
 * because the other three combinations were already right.
 *
 * Measured on a live package: session #2 missed and charged ₪110, its make-up
 * #6 carrying no money at all.
 *
 * The cancel path never had this bug — it passes `billsPerSession` straight
 * through — which is why the two are pinned together below.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const drawer = fs.readFileSync(
  path.join(process.cwd(), 'components/crm/contact-drawer/CRMContactDrawerV2.tsx'),
  'utf8'
);

/** Comments stripped: the note above the fix quotes the old `false`. */
const code = drawer.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('a make-up booked from the no-show dialog', () => {
  it('is billed only when the missed hour was waived', () => {
    expect(code).toContain(
      'const missedHourWasWaived = pendingOutcomeChargeable && chargeSession === false;'
    );
  });

  it('reads the waiver from the same flag the endpoint is sent', () => {
    /*
     * `pendingOutcomeChargeable` is what decides whether `chargeSession` is
     * sent to the outcome route at all. Where there is no stage to bill or
     * waive there is nothing to mirror, and the make-up stays free — so the
     * two must be read together, not `chargeSession` alone.
     */
    /* The dialog hands back both, in one destructure. */
    expect(code).toMatch(/onConfirm=\{async \(\{[^}]*chargeSession[^}]*addReplacement[^}]*\}\)/);
    expect(code).toContain('...(pendingOutcomeChargeable ? { chargeSession } : {})');
  });

  it('still charges nothing on an upfront package', () => {
    /* `billsPerSession` gates it. An upfront block's money is already in, so
       no session bills and none can be waived. */
    expect(code).toContain('replacementOffer.billsPerSession && missedHourWasWaived');
  });

  it('no longer hardcodes the make-up as free', () => {
    /* The fault exactly as it was written: the third argument to
       `bookReplacement` on the no-show path. */
    expect(code).not.toMatch(/bookReplacement\(\s*replacementOffer\.containerId,\s*takes,\s*false,/);
  });
});

describe('the cancel path, which never had this bug', () => {
  it('still bills the replacement on a per-session package', () => {
    /*
     * Pinned beside the fix so the two cannot drift: cancelling bills the
     * replacement outright, because the cancelled hour was never charged.
     */
    expect(code).toMatch(
      /bookReplacement\(\s*replacementOffer\.containerId,\s*takes,\s*replacementOffer\.billsPerSession,/
    );
  });

  it('and the two paths are the only callers', () => {
    /* A third caller would need its own answer to the money question, and
       would not be covered by either assertion above. */
    expect(code.match(/await bookReplacement\(/g) ?? []).toHaveLength(2);
  });
});
