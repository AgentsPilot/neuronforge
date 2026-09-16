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

  /*
   * Reversed deliberately. The block used to win, which is how one page ended
   * up stating two different phone numbers — an old one typed into this form
   * and the current one in the footer below it, which resolves the same details
   * the same way. There is one true phone number per business.
   */
  it('lets the profile beat a stale value typed on the block', () => {
    const merged = withProfileContact({ business_phone: '03-000-0000' }, PROFILE);
    expect(merged.business_phone).toBe('+972-52-555-0134');
    expect(merged.business_email).toBe('hello@realsalon.co.il');
  });

  it('falls back to the block when the profile has nothing', () => {
    const merged = withProfileContact({ business_phone: '03-000-0000' }, { email: 'a@b.co' });
    expect(merged.business_phone).toBe('03-000-0000');
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
   * Hours are derived from the availability the booking calendar runs on, so
   * this section and the footer cannot give two different answers about when
   * the business opens. A typed value is the fallback for a business that has
   * set no availability, which is the only case with nothing truer to show.
   */
  it('derives opening hours from availability', () => {
    const withHours = {
      ...PROFILE,
      scheduling_availability: {
        sunday: [{ start: '09:00', end: '17:00' }],
        monday: [{ start: '09:00', end: '17:00' }],
        tuesday: [],
        wednesday: [],
        thursday: [],
        friday: [{ start: '09:00', end: '13:00' }],
        saturday: [],
      },
    };
    // The typed value is discarded, not merged: availability is the source.
    expect(withProfileContact({ business_hours: 'Sun–Thu 9–18' }, withHours).business_hours)
      .toBe('Sun–Mon 09:00–17:00 · Fri 09:00–13:00');
  });

  it('says nothing about hours when no availability is set', () => {
    // Deliberately drops a typed value rather than showing it. A string typed
    // months ago is the exact failure this prevents: it survives every change
    // to the calendar and goes on naming days the business no longer works.
    expect(withProfileContact({ business_hours: 'By appointment' }, PROFILE).business_hours)
      .toBeUndefined();
    expect(withProfileContact({}, PROFILE).business_hours).toBeUndefined();
  });
});
