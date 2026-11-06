/**
 * A phone column refuses a value that cannot be a phone.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT REACHED THE OWNER'S CRM
 *
 * A spreadsheet import on 2026-11-05 filed 39 contacts. THIRTY-ONE of them
 * carried a phone number like:
 *
 *     -7475     -10022     -4022     -5244     -9161
 *
 * Negative integers. They travelled from the cell, through the importer's
 * column mapping, into `crm_contacts.phone` unexamined, and the owner then
 * read them as their clients' telephone numbers.
 *
 * Nothing was broken in the sense of throwing. Every layer did what it was
 * told: the sheet said `-7475`, the mapping said "column E is the phone", and
 * the write said "store the phone". No layer asked whether the thing could be
 * a phone at all.
 *
 * Whatever produced those values in the spreadsheet is the owner's data to fix
 * — a dash-separated number the sheet evaluated as subtraction is the likeliest
 * explanation. What was ours is that we wrote it down and presented it as fact.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULE, AND WHY IT IS LOOSE
 *
 * Phone formats are not ours to police. A guard tight enough to be "correct"
 * would reject real numbers from countries we have not thought about, and
 * losing a real phone is worse than keeping an odd-looking one.
 *
 * So: `+`, spaces, dashes, dots and brackets are formatting and ignored; seven
 * digits must survive. A leading minus is not formatting — it is the signature
 * of arithmetic — and is refused outright.
 *
 * The answer is NULL, never a thrown error. An unusable phone must not cost
 * the owner the contact: the name and the email are the valuable part, and an
 * import that dropped whole rows over a malformed phone would be the worse
 * failure of the two.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

/*
 * `usablePhoneOrNull` is module-private and `resolveWriteValue` needs a
 * resolved entity, a resolved field and a catalogue to reach it. The rule
 * itself is pure, so it is exercised directly — compiled out of the source the
 * same way the module defines it, which keeps this test honest about the real
 * implementation rather than a copy of it.
 */
const SOURCE = path.join(process.cwd(), 'lib/business-os/bizql/mutate/MutateExecutor.ts');
const source = fs.readFileSync(SOURCE, 'utf8');

const body = source.slice(
  source.indexOf('function usablePhoneOrNull'),
  source.indexOf('function resolveWriteValue')
);

/*
 * The signature is rewritten whole rather than having each annotation stripped
 * by name. Matching the exact type text meant that widening the parameter to
 * `unknown` broke the EXTRACTION and not the rule — a red suite that said
 * nothing about whether a phone is accepted. This survives any future change to
 * the types; only a rename of the function itself would reach it.
 */
const plainJs = body.replace(
  /function usablePhoneOrNull\s*\([^)]*\)\s*:[^{]+\{/,
  'function usablePhoneOrNull(value) {'
);

// eslint-disable-next-line @typescript-eslint/no-implied-eval
const usablePhoneOrNull = new Function(
  `${plainJs}; return usablePhoneOrNull;`
)() as (v: unknown) => string | null;

describe('the values that cost the owner their trust', () => {
  it.each([-7475, -10022, -4022, -5244, -9161, -1838, -6723])(
    'refuses %p, which a spreadsheet produced by subtraction',
    value => {
      expect(usablePhoneOrNull(value)).toBeNull();
    }
  );

  it('refuses the string form too, which is how it actually arrived', () => {
    /* The cell came through as text: the API returns FORMATTED_VALUE. */
    expect(usablePhoneOrNull('-10022')).toBeNull();
  });
});

describe('what a phone column still accepts', () => {
  it.each([
    ['502225555', 'the plain national number the same import filed correctly'],
    ['+972 50 222 5555', 'international, spaced'],
    ['050-222-5555', 'dashes as formatting, not arithmetic'],
    ['(050) 222-5555', 'brackets'],
    ['+1 (555) 010.9999', 'dots and a country code'],
  ])('keeps %p — %s', phone => {
    expect(usablePhoneOrNull(phone)).toBe(phone);
  });

  it('returns the value unchanged, never a reformatted one', () => {
    /* We are judging the value, not rewriting it. An owner who typed their
       client's number one way must see it back that way. */
    expect(usablePhoneOrNull('050-222-5555')).toBe('050-222-5555');
  });
});

describe('too little to be a number', () => {
  it.each([['', 'blank'], ['   ', 'whitespace'], ['12345', 'five digits'], ['n/a', 'a word']])(
    'refuses %p (%s)',
    value => {
      expect(usablePhoneOrNull(value)).toBeNull();
    }
  );

  it('accepts exactly seven digits, the boundary', () => {
    expect(usablePhoneOrNull('1234567')).toBe('1234567');
  });
});
