/**
 * `?flag=false` means false.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * It did not. `z.coerce.boolean()` calls `Boolean(value)`, and `Boolean('false')`
 * is `true` — every non-empty string is. So a route reading
 * `?includeCorrelated=false` got `true`, and the caller's instruction was not
 * ignored but INVERTED.
 *
 * On `/api/business-os/insights` the dashboard asks for one insight cheaply and
 * switches three expensive sections off. All three were built anyway. Nothing
 * failed, nothing logged, and the response simply cost what the caller had
 * asked it not to.
 *
 * The assertions below are mostly about `'false'` and about ABSENT, because
 * those are the two the old behaviour got wrong in opposite directions: a flag
 * defaulting to true could never be turned off, and an absent flag must still
 * fall to the schema's own default rather than to `false`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { z } from 'zod';

import { booleanParam } from '../booleanParam';

const parse = (fallback: boolean, value?: string) =>
  z.object({ flag: booleanParam(fallback) }).parse(value === undefined ? {} : { flag: value }).flag;

describe('the word that broke it', () => {
  it('reads "false" as false', () => {
    expect(parse(true, 'false')).toBe(false);
  });

  it('reads it whatever case it arrives in', () => {
    expect(parse(true, 'False')).toBe(false);
    expect(parse(true, 'FALSE')).toBe(false);
    expect(parse(true, ' false ')).toBe(false);
  });

  it('reads the other spellings a client actually sends', () => {
    for (const value of ['0', 'no', 'off', '']) {
      expect(parse(true, value)).toBe(false);
    }
  });
});

describe('true stays true', () => {
  it('reads the usual spellings', () => {
    for (const value of ['true', '1', 'yes', 'on']) {
      expect(parse(false, value)).toBe(true);
    }
  });

  /* `?flag` with no value arrives as an empty string in some clients and as
     'true' in others. The empty string is handled above, deliberately as FALSE:
     a bare flag is rare here and an accidental empty value is not an opt-in. */
  it('treats an unrecognised value as true rather than throwing', () => {
    expect(parse(false, 'maybe')).toBe(true);
  });
});

describe('absent is not false', () => {
  /*
   * The half that would break every existing caller if it were got wrong. A
   * route whose flag defaults to true must stay true when nobody says anything,
   * or the fix for the inversion becomes a second, larger inversion.
   */
  it('falls to the schema default, both ways', () => {
    expect(parse(true)).toBe(true);
    expect(parse(false)).toBe(false);
  });
});

describe('the behaviour this replaces', () => {
  /*
   * Pinned so nobody reaches for `z.coerce.boolean()` again believing it does
   * what it looks like it does.
   */
  it('is what z.coerce.boolean gets wrong', () => {
    const coerced = z.object({ flag: z.coerce.boolean().optional().default(true) });

    expect(coerced.parse({ flag: 'false' }).flag).toBe(true);
    expect(parse(true, 'false')).toBe(false);
  });
});
