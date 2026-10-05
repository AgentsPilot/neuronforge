/**
 * Turning Google's address components into the fields this platform stores.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE PART THAT CAN BE WRONG WITHOUT ANYONE NOTICING.
 *
 * The network calls are Google's problem. This is ours: a mapping that puts the
 * street number in the wrong field, or the long country name where an ISO code
 * belongs, produces an address that looks filled in and is subtly wrong — on an
 * invoice, and on the public page clients use to find the business.
 *
 * Two details carry most of the risk and both are pinned below: the country and
 * the state must arrive as SHORT codes, because that is what the country
 * dropdown and the state dropdown store. A long name lands in those fields
 * matching no option, and saves as unselected.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { addressFromComponents, isPlacesConfigured } from '@/lib/geo/placesAutocomplete';

type Component = { longText?: string | null; shortText?: string | null; types: string[] };

const c = (longText: string, shortText: string, ...types: string[]): Component => ({
  longText,
  shortText,
  types,
});

describe('a US address', () => {
  const components = [
    c('1600', '1600', 'street_number'),
    c('Amphitheatre Parkway', 'Amphitheatre Pkwy', 'route'),
    c('Mountain View', 'Mountain View', 'locality'),
    c('California', 'CA', 'administrative_area_level_1'),
    c('United States', 'US', 'country'),
    c('94043', '94043', 'postal_code'),
  ];

  it('builds the street line from number and route', () => {
    expect(addressFromComponents(components).line1).toBe('1600 Amphitheatre Parkway');
  });

  it('stores the country as an ISO code, not a name', () => {
    // 'United States' here would match no option in the country dropdown and
    // would save as nothing selected.
    expect(addressFromComponents(components).country).toBe('US');
  });

  it('stores the state as its short code, so it matches the state dropdown', () => {
    // `lib-address` lists California as 'CA'. 'California' would not match.
    expect(addressFromComponents(components).state).toBe('CA');
  });

  it('fills city and postcode', () => {
    const address = addressFromComponents(components);

    expect(address.city).toBe('Mountain View');
    expect(address.postal_code).toBe('94043');
  });
});

describe('a UK address, where Google does not send a locality', () => {
  it('falls back to postal_town for the city', () => {
    /*
     * Real behaviour, not a hypothetical: for most UK addresses `locality` is
     * absent and the town arrives as `postal_town`. Reading only locality left
     * every London address with no city at all.
     */
    const address = addressFromComponents([
      c('10', '10', 'street_number'),
      c('Downing Street', 'Downing St', 'route'),
      c('London', 'London', 'postal_town'),
      c('United Kingdom', 'GB', 'country'),
      c('SW1A 2AA', 'SW1A 2AA', 'postal_code'),
    ]);

    expect(address.city).toBe('London');
    expect(address.country).toBe('GB');
  });
});

describe('an Israeli address', () => {
  it('maps cleanly and carries no state', () => {
    // Israel has no administrative area in an address, so nothing should appear
    // in that field for the state dropdown to reject.
    const address = addressFromComponents([
      c('50', '50', 'street_number'),
      c('דיזנגוף', 'דיזנגוף', 'route'),
      c('תל אביב-יפו', 'תל אביב-יפו', 'locality'),
      c('ישראל', 'IL', 'country'),
      c('6433222', '6433222', 'postal_code'),
    ]);

    expect(address.line1).toBe('50 דיזנגוף');
    expect(address.city).toBe('תל אביב-יפו');
    expect(address.country).toBe('IL');
    expect(address.state).toBe('');
  });
});

describe('partial and awkward results', () => {
  it('a route with no street number does not leave a leading space', () => {
    const address = addressFromComponents([
      c('Rothschild Boulevard', 'Rothschild Blvd', 'route'),
      c('Tel Aviv', 'Tel Aviv', 'locality'),
      c('Israel', 'IL', 'country'),
    ]);

    expect(address.line1).toBe('Rothschild Boulevard');
  });

  it('a unit number goes to line 2 rather than being lost', () => {
    const address = addressFromComponents([
      c('12', '12', 'street_number'),
      c('Herzl', 'Herzl', 'route'),
      c('Apt 4', 'Apt 4', 'subpremise'),
      c('Israel', 'IL', 'country'),
    ]);

    expect(address.line2).toBe('Apt 4');
  });

  it('empty components produce empty fields, not undefined', () => {
    const address = addressFromComponents([]);

    expect(address).toEqual({
      line1: '',
      line2: '',
      city: '',
      state: '',
      postal_code: '',
      country: '',
    });
  });
});

describe('an administrative area the country does not use', () => {
  it('is mapped, then dropped by resolveSuggestion — verified against live data', () => {
    /*
     * Google returned exactly this for דיזנגוף 50: an `administrative_area_level_1`
     * of "מחוז תל אביב". It is a real district and no Israeli address contains it.
     *
     * The mapping keeps it — this function does not know the country's rules —
     * and `resolveSuggestion` clears it, because the state field never renders
     * for Israel. Left in, it would be invisible to the owner AND printed on the
     * invoice by `formatAddressLines`.
     *
     * Pinned here as the mapping's half of that contract.
     */
    const address = addressFromComponents([
      c('50', '50', 'street_number'),
      c('דיזנגוף', 'דיזנגוף', 'route'),
      c('תל אביב-יפו', 'תל אביב-יפו', 'locality'),
      c('מחוז תל אביב', 'מחוז תל אביב', 'administrative_area_level_1'),
      c('ישראל', 'IL', 'country'),
    ]);

    expect(address.line1).toBe('50 דיזנגוף');
    expect(address.country).toBe('IL');
    // Present at this stage; resolveSuggestion is what removes it.
    expect(address.state).toBe('מחוז תל אביב');
  });
});

describe('running without an API key', () => {
  it('reports itself unconfigured so the forms fall back to manual entry', () => {
    // No key is set in the test environment, and that must be a supported
    // state rather than a crash — the address form worked before autocomplete
    // existed and has to keep working.
    expect(isPlacesConfigured()).toBe(false);
  });
});
