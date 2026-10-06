/**
 * What a form means when it sends an empty string.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS SHARED RATHER THAN WRITTEN PER ROUTE
 *
 * A React form holds every field as a string and posts all of them on every
 * save — `contact.email || ''`, `contact.source || ''`. A Zod schema written
 * for the value reads `''` as a violation: `.min(1)` says "too short",
 * `.email()` says "invalid address". So one untouched, legitimately empty field
 * rejects the WHOLE request, and the owner is told "Invalid input" about
 * something they never typed in.
 *
 * It has now bitten twice, in the two halves of the same screen:
 *
 *   · Creating a contact — `first_name`, `stage`, `source` and `email` could
 *     each fail at once while the owner saw one generic message.
 *   · Updating one — a contact with no email could not be saved AT ALL, so a
 *     lead captured from a booking (phone number, no address) swallowed every
 *     edit. The owner typed a phone number, pressed save, was told "Invalid
 *     input", and found the number gone on reopen.
 *
 * The create route solved it locally and the update route never learned. One
 * module, so the next form to post a blank field finds the answer already here.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { z } from 'zod';

/**
 * Treat a blank string as "not provided".
 *
 * For a CREATE, and for any field where empty means "I did not fill this in".
 * The value never reaches the inner schema, so `.min(1)` and `.email()` are
 * free to be as strict as they like about values that are actually there.
 *
 * NOT for a field an owner may be deliberately CLEARING on an update — this
 * turns "" into `undefined`, which most repositories read as "leave it alone",
 * so the old value would quietly survive the attempt to remove it. Use
 * `emptiableEmail` or an explicit nullable for those.
 */
export const blankAsAbsent = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(
    value => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    schema
  );

/**
 * An email address, or none — where none is a value the owner can SET.
 *
 * `z.string().email()` rejects `''`, and `blankAsAbsent` would swallow it: an
 * owner deleting an address and saving would be told nothing and find it still
 * there. This keeps `''` as a real answer that reaches the column, while a
 * non-empty value must still be a real address.
 */
export const emptiableEmail = (max = 200) =>
  z
    .string()
    .trim()
    .max(max, 'Email address is too long')
    .refine(
      value => value === '' || z.string().email().safeParse(value).success,
      'That does not look like an email address'
    );
