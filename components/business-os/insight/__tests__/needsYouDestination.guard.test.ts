/**
 * Where a Needs-you button actually lands the owner.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Two rows on this card navigate instead of sending, because both ask the owner
 * to make a judgement a button must not make for them: writing a quote means
 * deciding what the work costs, and billing a phase means deciding the work
 * happened.
 *
 * Both therefore have to open the tab that HOLDS that control, and "bill_stage"
 * did not. It pushed `&section=payments`, while `onCompleteStage` — the prop
 * that raises the "mark done and bill" confirmation — is a prop of
 * `BookingsTab`. The payments section has never had that control, so the button
 * landed the owner on a tab where the thing they came to do does not exist, and
 * nothing failed: the drawer opened, on the wrong section, looking correct.
 *
 * A SOURCE-LEVEL GUARD spanning two files, because the invariant spans them.
 * Neither file alone can be wrong: the destination is only right if it names
 * the tab that owns the control. Same approach as
 * `app/api/business-os/stats/__tests__/bookedThisWeek.guard.test.ts`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const CARD = join(__dirname, '..', 'NeedsYouCard.tsx');
const DRAWER = join(
  __dirname, '..', '..', '..', 'crm', 'contact-drawer', 'CRMContactDrawerV2.tsx'
);

const card = readFileSync(CARD, 'utf8');
const drawer = readFileSync(DRAWER, 'utf8');

/** The `act` branch for one navigating action, with its `router.push`. */
function destinationFor(action: string): string | undefined {
  const branch = card.split(`if (action === '${action}')`)[1];
  return branch?.slice(0, 300).match(/section=([a-z]+)/)?.[1];
}

/** The props handed to the element that opens `tag`. */
function propsOf(tag: string): string {
  const open = drawer.indexOf(`<${tag}`);
  return open === -1 ? '' : drawer.slice(open, open + 6000);
}

describe('the two rows that navigate rather than send', () => {
  it('sends a phase waiting to be billed to the BOOKINGS section', () => {
    expect(destinationFor('bill_stage')).toBe('bookings');
  });

  it('sends a quote that needs writing to the bookings section too', () => {
    // The consultation and its quote action are both on that booking.
    expect(destinationFor('write_quote')).toBe('bookings');
  });
});

describe('the tab that owns each control', () => {
  it('puts "mark done and bill" on the bookings tab', () => {
    /*
     * If this moves, the destination above has to move with it. That is the
     * whole point of asserting across both files rather than pinning a string.
     */
    expect(propsOf('BookingsTab')).toContain('onCompleteStage');
  });

  it('is the only tab with it', () => {
    // Two tabs offering the same billing control would make the destination a
    // coin toss, and the confirmation dialog is wired to exactly one of them.
    const others = drawer.split('onCompleteStage').length - 1;
    // The prop passed once, and the handler's own definition. Nothing else.
    expect(others).toBeLessThanOrEqual(2);
  });
});
