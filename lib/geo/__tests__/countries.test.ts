/**
 * Countries and addresses.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Two things are worth testing here and they pull in opposite directions.
 *
 * The country is now STORED as an ISO code, which is the whole point: nothing
 * downstream has to interpret free text any more.
 *
 * But it is RENDERED onto an invoice, which is a tax document — so a stored
 * 'IL' must never reach a client as the letters "IL", and an address saved
 * before the picker existed must keep printing exactly what its owner typed.
 *
 * That asymmetry — strict going in, forgiving coming out — is what most of
 * these pin.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  countryName,
  countryOptions,
  isCountryCode,
  legacyCountryToCode,
} from '@/lib/geo/countries';
import {
  formatAddressLines,
  formatAddressOneLine,
  hasAddressContent,
} from '@/lib/geo/address';

describe('the country list', () => {
  it('comes from the package, not from a hand-written list', () => {
    const options = countryOptions('en');

    // Enough to be the real ISO set rather than a curated handful.
    expect(options.length).toBeGreaterThan(200);
    expect(options.map(o => o.code)).toContain('IL');
    expect(options.map(o => o.code)).toContain('US');
  });

  it('is sorted in the reader’s own language', () => {
    // An alphabetical list that is alphabetical in English only is not sorted
    // at all to a Hebrew reader.
    const he = countryOptions('he').map(o => o.name);
    const sorted = [...he].sort((a, b) => a.localeCompare(b, 'he'));

    expect(he).toEqual(sorted);
  });

  it('names a country in each language the product speaks', () => {
    expect(countryName('IL', 'en')).toBe('Israel');
    expect(countryName('IL', 'he')).toBe('ישראל');
    expect(countryName('US', 'es')).toBe('Estados Unidos');
  });
});

describe('reading a stored value back', () => {
  it('a code becomes a name — never printed as the code', () => {
    /*
     * The invoice regression this exists to prevent. The PDF pushes this
     * straight onto the page, so storing codes without translating them would
     * have started printing "IL" to clients.
     */
    expect(countryName('IL', 'en')).not.toBe('IL');
  });

  it('free text written before the picker is passed through untouched', () => {
    // No migration ran, so these are still in the column. They must keep
    // printing exactly as their owner typed them.
    expect(countryName('Israel', 'en')).toBe('Israel');
    expect(countryName('USA', 'he')).toBe('USA');
    expect(countryName('2nd floor, above the bakery', 'en')).toBe(
      '2nd floor, above the bakery'
    );
  });

  it('nothing in, nothing out', () => {
    expect(countryName(null)).toBe('');
    expect(countryName(undefined)).toBe('');
    expect(countryName('   ')).toBe('');
  });
});

describe('telling a code from prose', () => {
  it.each(['IL', 'il', 'US', 'gb'])('%s is a code', value => {
    expect(isCountryCode(value)).toBe(true);
  });

  it.each(['Israel', 'USA', '', 'ZZ', 'United Kingdom'])('%s is not', value => {
    expect(isCountryCode(value)).toBe(false);
  });
});

describe('the legacy mapping, which exists only for rows already written', () => {
  it.each([
    ['Israel', 'IL'],
    ['ישראל', 'IL'],
    ['USA', 'US'],
    ['united states', 'US'],
    ['IL', 'IL'],
  ])('%s → %s', (raw, code) => {
    expect(legacyCountryToCode(raw)).toBe(code);
  });

  it('refuses to guess at a typo', () => {
    // The owner picks from the list instead. Guessing here is how the wrong
    // country ends up deciding a tax rule.
    expect(legacyCountryToCode('Isreal')).toBeNull();
    expect(legacyCountryToCode('Narnia')).toBeNull();
  });
});

describe('formatting an address', () => {
  const FULL = {
    line1: '12 Herzl St',
    line2: 'Floor 3',
    city: 'Tel Aviv',
    state: '',
    postal_code: '6120201',
    country: 'IL',
  };

  it('renders the country as a name, in the document’s language', () => {
    expect(formatAddressLines(FULL, 'en')).toEqual([
      '12 Herzl St',
      'Floor 3',
      'Tel Aviv, 6120201',
      'Israel',
    ]);
    expect(formatAddressLines(FULL, 'he')).toContain('ישראל');
  });

  it('keeps a legacy one-line address readable', () => {
    // What a pre-picker row looks like once it is carried into `line1`: the
    // rendered result is identical to what clients saw before.
    const legacy = { line1: '2nd floor, above the bakery' };

    expect(formatAddressOneLine(legacy)).toBe('2nd floor, above the bakery');
  });

  it('skips empty parts rather than leaving gaps', () => {
    expect(formatAddressOneLine({ line1: '12 Herzl St', country: 'IL' })).toBe(
      '12 Herzl St, Israel'
    );
  });

  it('an empty address is nothing, not an empty string of commas', () => {
    expect(formatAddressOneLine({})).toBeNull();
    expect(formatAddressOneLine(null)).toBeNull();
    expect(formatAddressLines(undefined)).toEqual([]);
  });

  it('knows whether there is anything worth showing', () => {
    // Drives the "country is required" rule: an address with nothing in it must
    // stay savable, one with content must name its country.
    expect(hasAddressContent({})).toBe(false);
    expect(hasAddressContent({ line2: 'Floor 3' })).toBe(false);
    expect(hasAddressContent({ line1: '12 Herzl St' })).toBe(true);
    expect(hasAddressContent({ city: 'Tel Aviv' })).toBe(true);
  });
});
