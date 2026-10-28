/**
 * The gaps whose button NAVIGATES must say which booking to open.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Three actions on the Needs-you card navigate instead of sending, because each
 * asks the owner for a judgement no button should make for them. All three land
 * in `BookingsTab`, and the control they are sent to — the proposal builder,
 * "mark done and bill" — is a prop of a booking ROW. So the row has to be named,
 * or the owner arrives at a collapsed, paginated list and has to find it.
 *
 * WHY A SOURCE GUARD RATHER THAN A UNIT TEST
 *
 * Both faults this pins are invisible at runtime:
 *
 *   `quote_unwritten` built its rows FROM bookings and never passed the id on,
 *   so the link omitted `&booking=` entirely.
 *
 *   `stage_awaiting_completion` passed `entityId`, which for that gap is a
 *   `payment_plan_installments` id. The card spent it as a booking id, it
 *   matched no row, and nothing expanded.
 *
 * A wrong id and a missing id produce the SAME screen: the contact's booking
 * list, unexpanded. Nothing throws, nothing logs, and the only way to notice is
 * to be the owner who presses the button and then goes hunting. Running these
 * `find`s for real would need the whole Supabase surface stood up; what has to
 * hold is simply that the id each one emits is the id the link can use.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const definitions = readFileSync(join(__dirname, '..', 'definitions.ts'), 'utf8');

/** One gap's `find`, from its id to the start of the next definition. */
function gapBody(id: string): string {
  const start = definitions.indexOf(`id: '${id}'`);
  if (start === -1) return '';
  const rest = definitions.slice(start + 1);
  const next = rest.indexOf('\nconst ');
  return next === -1 ? rest : rest.slice(0, next);
}

describe('a quote that still has to be written', () => {
  const body = gapBody('quote_unwritten');

  it('exists, and is the one the card sends to the quote builder', () => {
    expect(body).toContain("action: 'write_quote'");
  });

  /*
   * This gap has TWO paths. One is a contact who filled the quote form and has
   * no booking at all; the other is a consultation that happened and was never
   * priced. Only the second can name a booking, and it is the one that was
   * dropping it.
   */
  it('names the consultation when the row came from one', () => {
    const fromBookings = body.slice(body.indexOf('for (const b of bookingRows)'));

    expect(fromBookings).toContain('entityId: b.id');
  });

  /*
   * The form path deliberately carries no booking, because there is none. The
   * link degrades to the contact's list, which is the honest answer — far
   * better than naming a booking that does not exist, which would look like a
   * bug in the drawer rather than an absence of data.
   */
  it('names none when the client only filled the form', () => {
    const fromForm = body.slice(
      body.indexOf('for (const r of formRows)'),
      body.indexOf('for (const b of bookingRows)')
    );

    expect(fromForm).not.toContain('entityId');
  });
});

describe('a phase waiting to be billed', () => {
  const body = gapBody('stage_awaiting_completion');

  it('exists, and navigates rather than billing', () => {
    expect(body).toContain("action: 'bill_stage'");
  });

  /*
   * `entityId` stays the STAGE: that is what `payment-stages/[id]/complete`
   * bills, and changing it would break the billing call to fix the link.
   */
  it('still posts to the stage', () => {
    expect(body).toContain('entityId: row.id');
  });

  /*
   * ...and the booking is carried separately, which is the fix. The two were
   * one field, and one field cannot be both.
   *
   * THE MEETING COMES FIRST, where there is one. A package is one container
   * booking plus N meetings, and the container carries no time — so opening
   * the container names the purchase rather than the session this row is
   * about, and five sessions produced five links to the same place. The
   * meeting id IS the row's booking to open; the container is the fallback for
   * a stage that has no meeting (a quote phase, or one written before the
   * column existed).
   */
  it('and separately names the job to open', () => {
    expect(body).toMatch(/bookingId:\s*\(?row\.(meeting_id|booking_id)/);
  });

  it('naming the SESSION rather than the purchase, where there is one', () => {
    expect(body).toMatch(/bookingId:[\s\S]{0,120}meeting_id[\s\S]{0,120}\?\?[\s\S]{0,60}booking_id/);
  });

  /*
   * Nullable on purpose. A stage can hang off a proposal with no appointment
   * behind it, and then there is no booking to open — the link falls back to
   * the contact's list rather than naming a phantom.
   */
  it('tolerating a phase with no appointment behind it', () => {
    /* The window allows for the meeting-first fallback above. */
    expect(body).toMatch(/bookingId:[\s\S]{0,160}\?\?\s*undefined/);
  });
});

/**
 * The field has to mean one thing.
 *
 * `entityId` is documented as "the proposal, booking or invoice this is about",
 * which is three kinds of id in one field — fine for an action that posts to it,
 * useless for a link that must open a booking. `bookingId` exists so the
 * navigating actions have an unambiguous answer, and the type is where that is
 * written down.
 */
describe('the field itself', () => {
  const types = readFileSync(join(__dirname, '..', 'types.ts'), 'utf8');

  it('is declared, and optional', () => {
    expect(types).toMatch(/bookingId\?:\s*string/);
  });
});
