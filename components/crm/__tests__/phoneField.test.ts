/**
 * A phone field must not change the number it was given.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WENT WRONG
 *
 * Three screens edit a contact's phone, and all three started the country
 * selector at `useState<Country>('US')`, seeded from nothing. One of them also
 * converted the stored number to E.164 for DISPLAY using that country — and
 * because the input reports its parsed value back through `onChange`, merely
 * opening a contact could rewrite their number.
 *
 * On a country lookup failure it fabricated a `+`:
 *
 *     catch { return `+${phone.replace(/\D/g, '')}` }
 *
 * A `+` asserts "what follows is a COMPLETE international number". Putting one
 * in front of a national number does not make it international; it makes a
 * different number, usually unreachable.
 *
 * The live data carried the result, including two shapes of the same person:
 *
 *     +546778512      an Israeli mobile with its 972 missing
 *     +2013643030     a US number with its 1 missing
 *     +972546778512   the same person, correct
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULE UNDER TEST
 *
 * Answer from the number, never rewrite it. Guessing is allowed in exactly one
 * place — which country an EMPTY field starts on — where being wrong costs a
 * dropdown click rather than a corrupted record.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  applyCountryToPhone,
  countryOfPhone,
  phoneFieldCountry,
  phoneFieldValue,
  publicFormCountry,
} from '../phoneField';

describe('the country a field starts on', () => {
  it('comes from the number when the number declares one', () => {
    expect(phoneFieldCountry('+972546778512')).toBe('IL');
    expect(phoneFieldCountry('+12017880445')).toBe('US');
  });

  it('beats the business country, because the number is the fact', () => {
    // An Israeli business holding a US client's number opens on US.
    expect(phoneFieldCountry('+12017880445', 'IL')).toBe('US');
  });

  it('falls back to the business country for an empty field', () => {
    expect(phoneFieldCountry('', 'IL')).toBe('IL');
    expect(phoneFieldCountry(null, 'il')).toBe('IL');
  });

  it('ignores a business country that is not a country', () => {
    // An unsupported value handed to the phone input throws, so it is checked
    // rather than trusted.
    expect(phoneFieldCountry('', 'Israel')).toBe('US');
    expect(phoneFieldCountry('', 'ZZ')).toBe('US');
    expect(phoneFieldCountry('', '')).toBe('US');
  });

  it('does not guess a country for a national number', () => {
    /*
     * `0546778512` could be Israeli, British or a dozen other things. Guessing
     * is what produced `+546778512`, so an undeclared number falls back to the
     * business rather than being interpreted.
     */
    expect(countryOfPhone('0546778512')).toBeNull();
    expect(countryOfPhone('2013643030')).toBeNull();
    expect(phoneFieldCountry('0546778512', 'IL')).toBe('IL');
  });

  it('survives the broken numbers already in the data', () => {
    // These must not throw, whatever they parse to.
    for (const stored of ['+546778512', '+2013643030', '+9722532182292', '20135373738']) {
      expect(() => phoneFieldCountry(stored, 'IL')).not.toThrow();
    }
  });
});

describe('choosing a country, which is what the owner reported', () => {
  it('turns a national number into that country\'s number', () => {
    /*
     * "I defined USA and save and after saving it shows Egypt."
     *
     * The selector was wired to the picker's state and nothing else, so the
     * number stayed `2013643030`, something put a bare `+` on it, and
     * `+2013643030` is `+20` — Egypt.
     */
    expect(applyCountryToPhone('2013643030', 'US')).toBe('+12013643030');
    expect(applyCountryToPhone('0546778512', 'IL')).toBe('+972546778512');
  });

  it('drops the national trunk zero, which never follows a +', () => {
    expect(applyCountryToPhone('0546778512', 'IL')).not.toContain('+9720');
    expect(applyCountryToPhone('054-677-8512', 'IL')).toBe('+972546778512');
  });

  it('repairs a number already saved as Egypt, which is what happened', () => {
    /*
     * `+2013643030` is a VALID Egyptian number, so nothing in the value says it
     * was meant to be American — only the owner picking United States does.
     *
     * An earlier fix refused to touch any number carrying a `+`, which meant
     * picking the country did nothing at all and the contact stayed Egyptian
     * through save after save. Both readings are built now and the one that is
     * a valid US number wins.
     */
    expect(applyCountryToPhone('+2013643030', 'US')).toBe('+12013643030');
  });

  it('repairs the Argentina reading without eating digits', () => {
    // `+546778512` parses as AR with national 6778512 — taking that would lose
    // the `54`. The whole-digits reading is the valid Israeli number.
    expect(applyCountryToPhone('+546778512', 'IL')).toBe('+972546778512');
  });

  it('leaves a number that is already right alone', () => {
    expect(applyCountryToPhone('+972546778512', 'IL')).toBe('+972546778512');
    expect(applyCountryToPhone('+12013643030', 'US')).toBe('+12013643030');
  });

  it('does not stack codes when the country changes twice', () => {
    const once = applyCountryToPhone('2013643030', 'US');
    const twice = applyCountryToPhone(once, 'US');
    expect(twice).toBe(once);
    expect(twice).toBe('+12013643030');
  });

  it('leaves nothing to apply alone', () => {
    expect(applyCountryToPhone('', 'US')).toBeUndefined();
    expect(applyCountryToPhone(null, 'US')).toBeUndefined();
  });
});

describe('what the field shows', () => {
  it('passes an international number through untouched', () => {
    // It is the record. Nothing here may reinterpret it.
    expect(phoneFieldValue('+972546778512', 'US')).toBe('+972546778512');
  });

  it('renders a national number through the SELECTED country', () => {
    // `PhoneInput` requires E.164, and the selected country is the only
    // statement anyone has made about what a national number means.
    expect(phoneFieldValue('2013643030', 'US')).toBe('+12013643030');
    expect(phoneFieldValue('0546778512', 'IL')).toBe('+972546778512');
  });

  it('never invents a + with no country code', () => {
    // The original bug, in one assertion: no country, no guess.
    expect(phoneFieldValue('2013643030')).toBeUndefined();
  });

  it('leaves an already-broken number alone rather than compounding it', () => {
    // Repairing stored data is a migration's job, done once and reviewed — not
    // something a text field should attempt while somebody is typing.
    expect(phoneFieldValue('+546778512', 'IL')).toBe('+546778512');
  });

  it('treats an empty field as empty', () => {
    expect(phoneFieldValue('', 'US')).toBeUndefined();
    expect(phoneFieldValue('   ', 'US')).toBeUndefined();
    expect(phoneFieldValue(null, 'US')).toBeUndefined();
    expect(phoneFieldValue(undefined, 'US')).toBeUndefined();
  });
});

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
