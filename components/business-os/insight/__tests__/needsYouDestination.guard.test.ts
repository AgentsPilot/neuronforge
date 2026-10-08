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

/**
 * Where one navigating action lands, resolved through the helper it calls.
 *
 * The three branches used to each write their own `router.push`, and this read
 * the URL out of the branch. They now call one `openBooking`, so a branch names
 * the helper and the helper holds the destination — which is the point of
 * having one: three copies of a URL are three places for it to drift.
 */
function destinationFor(action: string): string | undefined {
  const branch = card.split(`if (action === '${action}')`)[1]?.slice(0, 300);
  if (!branch) return undefined;

  // Still written inline? Read it where it is.
  const inline = branch.match(/section=([a-z]+)/)?.[1];
  if (inline) return inline;

  // Otherwise the branch must delegate, and the helper must name the section.
  if (!/openBooking\s*\(/.test(branch)) return undefined;
  return openBookingBody().match(/section=([a-z]+)/)?.[1];
}

/** The body of the shared `openBooking` helper. */
function openBookingBody(): string {
  const start = card.indexOf('const openBooking =');
  return start === -1 ? '' : card.slice(start, start + 700);
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

/**
 * The row, not just the list.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Landing on the bookings section was the second of three attempts at this
 * target. The first sent `&action=quote`, which nothing read, so the drawer
 * opened on `details`. The second reached the right LIST and stopped there: the
 * card raises every one of these gaps FROM a booking and knew its id the whole
 * time, so the owner arrived at a list of that contact's bookings and had to
 * work out which one the card meant.
 *
 * The invariant spans three files, which is why it is checked across them: the
 * card must SEND the id, the CRM page must READ it, and `BookingsTab` must open
 * that row. Any one of the three silently dropping it puts the owner back on a
 * list of collapsed rows, and nothing fails.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('the booking a gap was raised from', () => {
  const crmPage = readFileSync(
    join(__dirname, '..', '..', '..', '..', 'app', 'business-os', 'crm', 'page.tsx'),
    'utf8'
  );
  const bookingsTab = readFileSync(
    join(__dirname, '..', '..', '..', 'crm', 'contact-drawer', 'BookingsTab.tsx'),
    'utf8'
  );

  it('is named in the link the card pushes', () => {
    expect(openBookingBody()).toMatch(/booking=/);
    // From the gap's own entity, never a guess.
    expect(openBookingBody()).toMatch(/entityId/);
  });

  /* A gap with no entity must degrade to the list rather than naming a booking
     that does not exist. */
  it('is omitted when the gap carries no entity', () => {
    expect(openBookingBody()).toMatch(/item\.entityId\s*\?/);
  });

  it('is read by the CRM page and handed to the drawer', () => {
    expect(crmPage).toMatch(/searchParams\.get\('booking'\)/);
    expect(crmPage).toMatch(/focusBookingId=\{/);
  });

  it('opens that row expanded in the bookings tab', () => {
    expect(bookingsTab).toMatch(/focusBookingId\?: string/);
    // Seeded into the expanded set, so the row is open on first render.
    expect(bookingsTab).toMatch(/expandedBookings[\s\S]{0,200}focusBookingId/);
  });
});
