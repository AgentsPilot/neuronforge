/**
 * What a form means when it sends an empty string.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BUG THIS PINS, in the owner's words: "the phone number in the contact
 * drawer is not storing it".
 *
 * The drawer holds every field as a string and posts all of them on every save
 * — `contact.email || ''`, `contact.source || ''`. `z.string().email()` rejects
 * `''` and `.min(1)` calls it too short, so ONE legitimately empty field they
 * never touched rejected the WHOLE request. The phone number went with it, and
 * the message was "Invalid input".
 *
 * It hit exactly the contacts most likely to need editing: a lead captured from
 * a booking has a phone number and no email address.
 *
 * The create route had already been fixed for this and the update route had
 * not, which is why the helpers now live in one module rather than two.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { z } from 'zod';

import { blankAsAbsent, emptiableEmail } from '../blankFields';

/** The drawer's update payload, in the shape the route validates. */
const drawerSchema = z.object({
  first_name: z.string().optional(),
  email: emptiableEmail().optional(),
  phone: z.string().optional(),
  stage: blankAsAbsent(z.string().min(1).max(50).optional()),
  source: blankAsAbsent(z.string().min(1).max(50).optional()),
});

describe('the save that was failing', () => {
  /* A lead from a booking: a phone number, no email, no source. */
  it('accepts a contact that has only a phone number', () => {
    const result = drawerSchema.safeParse({
      first_name: 'Ofir',
      email: '',
      phone: '+972541234567',
      stage: 'lead',
      source: '',
    });

    expect(result.success).toBe(true);
    // The whole point: the number survives.
    expect(result.success && result.data.phone).toBe('+972541234567');
  });

  it('still refuses an address that is not an address', () => {
    const result = drawerSchema.safeParse({ email: 'not-an-email', phone: '+972541234567' });

    expect(result.success).toBe(false);
  });

  /*
   * An empty box on an UPDATE is also how an owner removes an address they no
   * longer have. `blankAsAbsent` would turn it into `undefined`, which the
   * repository reads as "leave it alone" — the removal would be swallowed and
   * nothing would say so.
   */
  it('keeps an emptied email as a value, so it can actually be cleared', () => {
    const result = drawerSchema.safeParse({ email: '' });

    expect(result.success).toBe(true);
    expect(result.success && 'email' in result.data).toBe(true);
    expect(result.success && result.data.email).toBe('');
  });

  /*
   * `stage` and `source` are the opposite case: `.min(1)` is a real rule about
   * values that exist, and blank means "not set" rather than "set to nothing".
   */
  it('treats a blank constrained field as not provided, not as too short', () => {
    const result = drawerSchema.safeParse({ source: '   ', stage: '' });

    expect(result.success).toBe(true);
    expect(result.success && result.data.source).toBeUndefined();
    expect(result.success && result.data.stage).toBeUndefined();
  });

  it('still refuses a real value that breaks the rule', () => {
    expect(drawerSchema.safeParse({ source: 'x'.repeat(51) }).success).toBe(false);
  });
});

describe('emptiableEmail on its own', () => {
  it.each([[''], ['  '], ['a@b.co'], ['Ofir@Example.COM']])('accepts %j', value => {
    expect(emptiableEmail().safeParse(value).success).toBe(true);
  });

  it.each([['nope'], ['a@'], ['@b.co']])('refuses %j', value => {
    expect(emptiableEmail().safeParse(value).success).toBe(false);
  });

  it('refuses one that is too long even though it parses', () => {
    const long = `${'a'.repeat(200)}@example.com`;
    expect(emptiableEmail().safeParse(long).success).toBe(false);
  });
});
