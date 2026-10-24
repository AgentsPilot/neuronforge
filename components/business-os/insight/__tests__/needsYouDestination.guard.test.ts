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

/**
 * The body of the shared `openBooking` helper.
 *
 * Read to the function's own closing brace rather than a fixed number of
 * characters. It was 700, which silently stopped covering the body the moment a
 * comment was added above the `router.push` — and a window that falls short
 * makes this guard report the destination as MISSING, which is the same thing
 * it reports when the destination really is missing.
 */
function openBookingBody(): string {
  const start = card.indexOf('const openBooking =');
  if (start === -1) return '';
  const rest = card.slice(start);
  const end = rest.indexOf('\n  };');
  return end === -1 ? rest : rest.slice(0, end);
}

/**
 * The props handed to the element that opens `tag` — the WHOLE element.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * This took a fixed 6000 characters from the opening tag, which is a guess
 * about how long a props list is rather than a statement about where it ends.
 * `BookingsTab`'s is 10,885, and the moment a handler above `onCompleteStage`
 * grew, the prop fell outside the window and this failed while the wiring it
 * guards was perfectly correct.
 *
 * The wrong half of that is worse than the false alarm: a window too SHORT
 * cries wolf, but a window too LONG runs into the next element, and
 * "is this prop on BookingsTab" would start passing because a sibling has it.
 *
 * JSX closes a self-closing element on a line indented exactly as its opening
 * tag, which is what this reads. No window, no guess.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function propsOf(tag: string): string {
  const open = drawer.indexOf(`<${tag}`);
  if (open === -1) return '';

  const indent = drawer.slice(drawer.lastIndexOf('\n', open) + 1, open);
  const close = drawer.indexOf(`\n${indent}/>`, open);

  return close === -1 ? drawer.slice(open) : drawer.slice(open, close);
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
  /*
   * Comments stripped before matching.
   *
   * These assertions look for two things NEAR each other, and a comment
   * explaining the code between them pushed one out of the window — the test
   * failed while the wiring it guards was intact and three lines apart in the
   * code. A source guard that a comment can break is guarding the comments.
   */
  const bookingsTabSource = readFileSync(
    join(__dirname, '..', '..', '..', 'crm', 'contact-drawer', 'BookingsTab.tsx'),
    'utf8'
  );
  const bookingsTab = bookingsTabSource
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

  it('reads the code, not its own explanation', () => {
    /* Contiguous on one line in the source: the comment wraps after "from". */
    expect(bookingsTabSource).toContain('A CARD OPENS ITSELF WHEN THE BALL');
    expect(bookingsTab).not.toContain('A CARD OPENS ITSELF WHEN THE BALL');
  });

  it('is named in the link the card pushes', () => {
    expect(openBookingBody()).toMatch(/booking=/);
    // From the gap's own entity, never a guess.
    expect(openBookingBody()).toMatch(/entityId/);
  });

  /* A gap with no entity must degrade to the list rather than naming a booking
     that does not exist. */
  it('is omitted when the gap carries no entity', () => {
    expect(openBookingBody()).toMatch(/bookingId\s*\?/);
  });

  /**
   * AND IT MUST BE A BOOKING ID, WHICH `entityId` IS NOT ALWAYS.
   *
   * `entityId` is whatever the gap's action posts to: a proposal for
   * `send_quote`, an invoice for `send_invoice`, a payment stage for
   * `bill_stage`. Passing a stage id as `&booking=` matched no row in the list,
   * so nothing expanded and the owner landed exactly where they would have with
   * no id at all. That is the trap this whole describe exists for: a WRONG id
   * and a MISSING id fail identically, in silence.
   */
  it('prefers the gap\'s booking over whatever its action posts to', () => {
    expect(openBookingBody()).toMatch(/item\.bookingId\s*\?\?\s*item\.entityId/);
  });

  it('is carried by the route that feeds the card', () => {
    // Written field by field, so a new one is dropped unless it is named.
    const route = readFileSync(
      join(__dirname, '..', '..', '..', '..', 'app', 'api', 'business-os', 'gaps', 'route.ts'),
      'utf8'
    );
    expect(route).toMatch(/bookingId:\s*item\.bookingId/);
  });

  /**
   * THE PAGE HAS TO CONTAIN THE ROW, OR EXPANDING IT SHOWS NOTHING.
   *
   * The list is five to a page. Expanding a booking on page four while the view
   * sits on page one renders the open row outside the slice: the link looks
   * like it did nothing. Gaps that raise these rows are weeks old by the time
   * they are worth showing, so the booking named is rarely among the five most
   * recent — and the one case where page one happens to be right is a contact
   * with a single booking, which is the contact the fault cannot be seen on.
   */
  it('moves the list to the page that row is on', () => {
    expect(bookingsTab).toMatch(/findIndex[\s\S]{0,120}focusBookingId/);
    // Derived, not stored: the owner's own paging must still win afterwards.
    expect(bookingsTab).toMatch(/bookingPage\s*\?\?/);
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
