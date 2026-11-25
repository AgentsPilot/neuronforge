/**
 * "Add another meeting" asks the PACKAGE, not the card it hangs off.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * REPORTED WITH A SCREENSHOT, 2026-11-15 (ClickUp "Quotation issues").
 *
 * A contact drawer showing a package whose journey reads "Cancelled · Nov 15 ·
 * 09:30 PM", three of its five sessions struck through, $141.33 refunded — and
 * "+ Add another meeting" still offered under it.
 *
 * The gate existed and was asking the wrong row. It read
 * `session.booking.status`, which is the CARD's booking: for a package sold
 * from a consultation that is the HOST, and the host stays `confirmed` while
 * the container it sold is cancelled. `CRMContactDrawerV2` already resolves
 * that distinction one function away —
 *
 *     const containerBooking = containerId ? byId.get(containerId)?.booking : undefined;
 *     const packageSource = containerBooking ?? card.booking;
 *     const packageCalledOff = …
 *
 * — and used the answer only to grey the step. So the journey node went grey
 * and the button beside it stayed live, on the same card, from the same data.
 *
 * The flag now travels in the step's metadata and the control reads it. Two
 * copies of the question are how the two rows came to be confused, so there is
 * deliberately one: the lookup stays where the container is already in hand.
 *
 * A SOURCE GUARD, because the defect is which ROW a condition reads. Rendering
 * it needs a contact, a quote, a host booking, a container and five meetings to
 * assert one boolean, and a fixture that elaborate tends to be built from the
 * same misunderstanding it is meant to catch.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const root = process.cwd();
const read = (...parts: string[]) => readFileSync(join(root, ...parts), 'utf-8');

const DRAWER = read('components', 'crm', 'contact-drawer', 'CRMContactDrawerV2.tsx');
const TAB = read('components', 'crm', 'contact-drawer', 'BookingsTab.tsx');
const ROUTE = read('app', 'api', 'scheduling', 'bookings', '[id]', 'meetings', 'route.ts');

describe('the flag is resolved from the container', () => {
  it('prefers the container booking over the card, as it already did for the step', () => {
    const flat = DRAWER.replace(/\s+/g, ' ');

    expect(flat).toContain('const packageSource = containerBooking ?? card.booking;');
    expect(flat).toContain(
      "const packageCalledOff = packageSource.status === 'cancelled' || packageSource.meeting_status === 'cancelled';"
    );
  });

  it('and travels with the step instead of being recomputed', () => {
    /* In the metadata beside `containerId`, which is what the control needs to
       ask the same question without doing the lookup a second time. */
    const metadata = DRAWER.slice(
      DRAWER.indexOf('metadata: {\n          count: ordered.length,'),
      DRAWER.indexOf('packageFull: (() => {')
    );

    expect(metadata).toContain('containerId,');
    expect(metadata).toContain('packageCalledOff,');
  });
});

describe('the control reads it', () => {
  it('refuses to render on a called-off package', () => {
    const gate = TAB.slice(
      TAB.indexOf('{onAddPackageMeeting &&'),
      TAB.indexOf('<AddPackageMeeting')
    );

    expect(gate).toContain("step.metadata?.packageCalledOff !== true");
  });

  it('keeps the card tests beside it, for the package that IS its own card', () => {
    /*
     * An unabsorbed container is both rows at once, and these two were the
     * only gate before today. Removing them would narrow the rule while
     * fixing it.
     */
    const gate = TAB.slice(
      TAB.indexOf('{onAddPackageMeeting &&'),
      TAB.indexOf('<AddPackageMeeting')
    );

    expect(gate).toContain("session.booking.status !== 'cancelled'");
    expect(gate).toContain("session.booking.meeting_status !== 'cancelled'");
    expect(gate).toContain("step.metadata?.packageFull !== true");
  });
});

describe('and the route refuses it anyway', () => {
  it('still answers 409 package_cancelled, so the button is a courtesy and not the rule', () => {
    /*
     * The gate above stops OFFERING what this refuses. It is not the guard:
     * the portal and the drawer both post here, and a surface that offers
     * what the server refuses is how this reached a customer the first time.
     */
    expect(ROUTE).toContain("code: 'package_cancelled'");
    expect(ROUTE).toMatch(
      /container\.status === 'cancelled' \|\| container\.meeting_status === 'cancelled'/
    );
  });
});
