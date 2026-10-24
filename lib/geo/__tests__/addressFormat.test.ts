/**
 * Which countries get a State field, and what it is called there.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ANSWERS COME FROM GOOGLE'S DATA, NOT FROM A TABLE.
 *
 * This file previously tested a 28-country list written by hand, and it passed
 * — because it asserted exactly what that list said. The list was wrong: the
 * real metadata has a state field for 80 of 252 countries, under twelve
 * different names, several of which were missing or mislabelled.
 *
 * So these assert against the metadata rather than against a copy of it, and
 * the cases chosen are the ones a hand-written list gets wrong: Israel (has
 * districts, uses none), Ireland (county, not state), Japan (prefecture),
 * Russia (oblast — absent from the old list entirely).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { addressRulesFor } from '@/lib/geo/addressFormat';
import { formatAddressOneLine } from '@/lib/geo/address';

describe('countries whose addresses carry no administrative area', () => {
  it.each(['IL', 'GB', 'FR', 'DE', 'NL', 'BE', 'DK', 'NO'])('%s shows no state field', async country => {
    const rules = await addressRulesFor(country);

    expect(rules.adminLabel).toBeNull();
    expect(rules.adminRequired).toBe(false);
  });

  it('Israel has districts in the subdivision data and still shows nothing', async () => {
    /*
     * The exact trap. `country-region-data` lists six Israeli districts, so
     * gating on "has subdivisions" put a State box on every Israeli form. The
     * address metadata is clear that an Israeli address has no such field.
     */
    const rules = await addressRulesFor('IL');

    expect(rules.adminLabel).toBeNull();
    expect(rules.regions).toEqual([]);
  });
});

describe('countries that do carry one, under the right name', () => {
  it.each([
    ['US', 'state'],
    ['CA', 'province'],
    ['JP', 'prefecture'],
    ['IE', 'county'],
    ['RU', 'oblast'],
    ['AE', 'emirate'],
  ])('%s → %s', async (country, label) => {
    const rules = await addressRulesFor(country);

    expect(rules.adminLabel).toBe(label);
  });

  it('never calls a Canadian province or a Japanese prefecture a state', async () => {
    // The reason the label is a key rather than the word "State".
    expect((await addressRulesFor('CA')).adminLabel).not.toBe('state');
    expect((await addressRulesFor('JP')).adminLabel).not.toBe('state');
    expect((await addressRulesFor('IE')).adminLabel).not.toBe('state');
  });

  it('knows when the field is required rather than merely present', async () => {
    expect((await addressRulesFor('US')).adminRequired).toBe(true);
  });
});

describe('the real subdivision list', () => {
  it('gives the US its states, with codes', async () => {
    const { regions } = await addressRulesFor('US');

    expect(regions.length).toBeGreaterThan(50);
    expect(regions).toContainEqual({ code: 'CA', name: 'California' });
    expect(regions).toContainEqual({ code: 'NY', name: 'New York' });
  });

  it('gives Canada its provinces', async () => {
    const { regions } = await addressRulesFor('CA');

    expect(regions).toContainEqual({ code: 'ON', name: 'Ontario' });
  });
});

describe('postcodes, which are not universal either', () => {
  it('names them the way each country does', async () => {
    expect((await addressRulesFor('US')).postalLabel).toBe('zip');
    expect((await addressRulesFor('IE')).postalLabel).toBe('eircode');
    expect((await addressRulesFor('GB')).postalLabel).toBe('postal');
  });
});

describe('anything unknown degrades rather than throwing', () => {
  it.each([null, undefined, '', 'Israel', 'ZZ', 'XX'])(
    '%s yields a plain address with no state field',
    async input => {
      const rules = await addressRulesFor(input as string | null | undefined);

      expect(rules.adminLabel).toBeNull();
      expect(rules.regions).toEqual([]);
    }
  );

  it('an unregistered code does not throw', async () => {
    // `lib-address` throws CountryMissingError for an unknown country; a
    // settings form must not fall over because of a stale value in a column.
    await expect(addressRulesFor('QQ')).resolves.toBeDefined();
  });
});

/**
 * The same place is never named twice.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Address autocomplete does not always put one place in one field. Live on the
 * contact panel of a published site:
 *
 *   city  = "Tel Mond, Central District"
 *   state = "Tel Mond, Central District"
 *
 * which read "Narkis 59, Tel Mond, Central District, Tel Mond, Central
 * District, 6543, Israel" — the business's own address, stuttering, on the page
 * a client reads before getting in touch.
 *
 * The comparison is by comma-separated NAME, not by substring, and that is the
 * whole care in it: "Kansas" is a substring of "Kansas City" and a real,
 * different place, so a substring test would delete a state that belongs there.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('an address never says the same place twice', () => {
  it('drops a state that repeats the city verbatim', () => {
    expect(
      formatAddressOneLine({
        line1: 'Narkis 59',
        city: 'Tel Mond, Central District',
        state: 'Tel Mond, Central District',
        postal_code: '6543',
        country: 'Israel',
      } as never)
    ).toBe('Narkis 59, Tel Mond, Central District, 6543, Israel');
  });

  it('keeps the fuller of the two, whichever field holds it', () => {
    const fuller = 'A 1, Tel Mond, Central District, 1, Israel';

    expect(
      formatAddressOneLine({
        line1: 'A 1', city: 'Tel Mond', state: 'Tel Mond, Central District',
        postal_code: '1', country: 'IL',
      } as never)
    ).toBe(fuller);

    expect(
      formatAddressOneLine({
        line1: 'A 1', city: 'Tel Mond, Central District', state: 'Tel Mond',
        postal_code: '1', country: 'IL',
      } as never)
    ).toBe(fuller);
  });

  it('never deletes a state that merely shares letters with its city', () => {
    /* The regression a substring test would cause. Both are real and both stay. */
    expect(
      formatAddressOneLine({
        line1: '1 Main St', city: 'Kansas City', state: 'Kansas',
        postal_code: '66101', country: 'US',
      } as never)
    ).toBe('1 Main St, Kansas City, Kansas, 66101, United States');

    expect(
      formatAddressOneLine({
        line1: '2 High St', city: 'York', state: 'New York',
        postal_code: '10001', country: 'US',
      } as never)
    ).toBe('2 High St, York, New York, 10001, United States');
  });

  it('leaves an ordinary address exactly as it was', () => {
    expect(
      formatAddressOneLine({
        line1: '14 Venus Drive', line2: 'Apt 4', city: 'Closter', state: 'NJ',
        postal_code: '07624', country: 'US',
      } as never)
    ).toBe('14 Venus Drive, Apt 4, Closter, NJ, 07624, United States');
  });
});
