/**
 * The contact section's details must be the same in the preview and in public.
 *
 * They were resolved on the published site and not in the preview, so a
 * business whose profile had every field filled in saw an empty contact panel
 * in the editor — and because the two-column layout is gated on having any of
 * those details, the section also silently rendered as one column there and two
 * columns live.
 */

import { withProfileContact } from '../contactBlockContent';

const PROFILE = {
  email: 'hello@realsalon.co.il',
  phone: '+972-52-555-0134',
  address: 'Dizengoff 100, Tel Aviv',
};

describe('withProfileContact', () => {
  it('fills empty block fields from the profile', () => {
    const merged = withProfileContact({}, PROFILE);
    expect(merged.business_email).toBe('hello@realsalon.co.il');
    expect(merged.business_phone).toBe('+972-52-555-0134');
    expect(merged.business_address).toBe('Dizengoff 100, Tel Aviv');
  });

  it('lets a value typed on the block win', () => {
    const merged = withProfileContact({ business_phone: '03-000-0000' }, PROFILE);
    expect(merged.business_phone).toBe('03-000-0000');
    expect(merged.business_email).toBe('hello@realsalon.co.il');
  });

  it('treats whitespace on the block as absent', () => {
    const merged = withProfileContact({ business_email: '   ' }, PROFILE);
    expect(merged.business_email).toBe('hello@realsalon.co.il');
  });

  it('keeps every other field on the block', () => {
    const merged = withProfileContact({ title: 'Talk to us', fields: ['name'] }, PROFILE);
    expect(merged.title).toBe('Talk to us');
    expect(merged.fields).toEqual(['name']);
  });

  /*
   * The profile's contact columns were backfilled from website copy that was
   * often still the template's scaffolding, so a raw read hands back exactly
   * the placeholder this is meant to replace.
   */
  it('does not promote a scaffolding placeholder to a real value', () => {
    const merged = withProfileContact({}, { email: 'contact@example.com' });
    expect(merged.business_email).toBeUndefined();
  });

  it('survives a business with no profile row', () => {
    const merged = withProfileContact({ title: 'Contact' }, null);
    expect(merged.title).toBe('Contact');
    expect(merged.business_email).toBeUndefined();
    expect(merged.business_phone).toBeUndefined();
  });

  /*
   * No profile column holds opening hours as display copy, so this one stays
   * the block's own — it must not be invented from anywhere.
   */
  it('leaves opening hours to the block', () => {
    expect(withProfileContact({ business_hours: 'Sun–Thu 9–18' }, PROFILE).business_hours)
      .toBe('Sun–Thu 9–18');
    expect(withProfileContact({}, PROFILE).business_hours).toBeUndefined();
  });
});
