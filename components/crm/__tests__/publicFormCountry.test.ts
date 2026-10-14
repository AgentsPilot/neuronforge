/**
 * BR-2: the public form's starting country, and the calling code its
 * placeholder shows, without loading the phone library.
 *
 * The default-country cases moved here from `phoneField.test.ts` with the
 * function. The calling codes are pinned to the library itself: the
 * placeholder's country box must read exactly what the real country button
 * will read, or the row shifts when the field arrives (AC-2.3).
 */

import { getCountryCallingCode } from 'react-phone-number-input';
import { publicFormCallingCode, publicFormCountry } from '../publicFormCountry';

describe('a public form, where there is no record to answer from', () => {
  it('starts on the country the page is written for', () => {
    // A Hebrew site's visitors had to correct the dropdown before typing.
    expect(publicFormCountry('he')).toBe('IL');
    expect(publicFormCountry('es')).toBe('ES');
  });

  it('leaves English on US, because `en` is not a country', () => {
    expect(publicFormCountry('en')).toBe('US');
    expect(publicFormCountry(null)).toBe('US');
    expect(publicFormCountry('de')).toBe('US');
  });
});

describe("the placeholder's calling code", () => {
  it.each(['IL', 'ES', 'US'] as const)('%s matches the library', country => {
    expect(publicFormCallingCode(country)).toBe(getCountryCallingCode(country));
  });

  it('covers every country publicFormCountry can return', () => {
    for (const locale of ['he', 'es', 'en', null, 'de']) {
      expect(publicFormCallingCode(publicFormCountry(locale))).toMatch(/^\d+$/);
    }
  });
});
