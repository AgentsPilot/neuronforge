/**
 * The phone rules, which two separate surfaces have to agree on: what the
 * settings form accepts, and what the public pages can turn into a link.
 */

import { isPlausiblePhone, whatsappLink, PHONE_MAX_LENGTH } from '@/lib/branding/phone';
import { cleanPublicContact } from '@/lib/branding/placeholderContact';

describe('isPlausiblePhone', () => {
  it('accepts the formats real businesses actually type', () => {
    // Rejecting any of these would block an owner from entering the number
    // their own clients dial, which is worse than storing an odd format.
    for (const value of [
      '+972 54 123 4567',
      '054-123-4567',
      '(054) 1234567',
      '+1 (415) 555-0134'.replace('555', '212'),
      '03-9876543',
      '+44 20 7946 0958',
      '00972541234567',
      '1234567',
    ]) {
      expect({ value, ok: isPlausiblePhone(value) }).toEqual({ value, ok: true });
    }
  });

  it('treats empty as cleared rather than invalid', () => {
    // The settings form sends '' when the owner empties the field.
    expect(isPlausiblePhone('')).toBe(true);
    expect(isPlausiblePhone('   ')).toBe(true);
    expect(isPlausiblePhone(null)).toBe(true);
    expect(isPlausiblePhone(undefined)).toBe(true);
  });

  it('rejects prose and overlong values', () => {
    expect(isPlausiblePhone('call me maybe')).toBe(false);
    expect(isPlausiblePhone('ask at reception')).toBe(false);
    expect(isPlausiblePhone('12')).toBe(false);
    expect(isPlausiblePhone('9'.repeat(PHONE_MAX_LENGTH + 1))).toBe(false);
  });
});

describe('whatsappLink', () => {
  it('builds a link from an international number', () => {
    expect(whatsappLink('+972 54 123 4567')).toBe('https://wa.me/972541234567');
    expect(whatsappLink('+44 20 7946 0958')).toBe('https://wa.me/442079460958');
  });

  it('handles the 00 international prefix', () => {
    // `00` and `+` mean the same thing; the link must not keep the zeros.
    expect(whatsappLink('00972541234567')).toBe('https://wa.me/972541234567');
  });

  it('returns null without a country code', () => {
    /*
     * The important case. A local number cannot become a working link, and
     * guessing the country from the business's language would produce a link
     * that dials a stranger. The page offers the plain number instead.
     */
    expect(whatsappLink('054-123-4567')).toBeNull();
    expect(whatsappLink('03-9876543')).toBeNull();
  });

  it('returns null for absent or too-short numbers', () => {
    expect(whatsappLink(null)).toBeNull();
    expect(whatsappLink('')).toBeNull();
    expect(whatsappLink('+123')).toBeNull();
  });
});

describe('the settings value and the public value together', () => {
  it('lets a real number through to the public pages', () => {
    const typed = '+972 54 123 4567';
    expect(isPlausiblePhone(typed)).toBe(true);
    expect(cleanPublicContact(typed, 'phone')).toBe(typed);
    expect(whatsappLink(typed)).toBe('https://wa.me/972541234567');
  });

  it('stores a placeholder but never shows it', () => {
    /*
     * The migration backfills `website_content.contact.phone` into the profile
     * without filtering, so a template's example number can land in the column.
     * It is valid to STORE — the owner sees it in settings and can correct it —
     * and suppressed on every public page.
     */
    const seeded = '+1 (555) 123-4567';
    expect(isPlausiblePhone(seeded)).toBe(true);
    expect(cleanPublicContact(seeded, 'phone')).toBeNull();
  });
});
