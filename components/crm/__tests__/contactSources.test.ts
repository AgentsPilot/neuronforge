/**
 * Which chip a contact gets, and why.
 *
 * The rule, in order:
 *   1. the owner's own answer wins;
 *   2. a UTM tag decides the channel — only a UTM, never an inferred referrer;
 *   3. otherwise the chip is the property that captured them.
 *
 * The fixtures are the real `source_metadata` off three contacts, because the
 * thing most likely to be wrong is an assumption about the shape, and an
 * invented one would agree with whatever this file assumed.
 */

import { contactOrigin } from '../contactSources';

/** A booking on the website, tagged utm_source=facebook by the shared link. */
const fromFacebook = {
  capture_channel: 'booking',
  utm_source: 'facebook',
  utm_medium: 'social',
  referrer_domain: 'localhost',
  capture_page_url: '/api/website/booking/create',
};

/** The same booking, untagged. */
const untagged = {
  capture_channel: 'booking',
  referrer_domain: 'localhost',
  capture_page_url: '/api/website/booking/create',
};

describe('a UTM tag decides the chip', () => {
  it('shows the channel, not the property it landed on', () => {
    expect(contactOrigin('website_booking', fromFacebook)?.group).toBe('facebook');
  });

  it('still records which property captured them', () => {
    expect(contactOrigin('website_booking', fromFacebook)?.surface).toBe('website');
  });

  it('carries the tag back verbatim, as the owner\'s receipt', () => {
    expect(contactOrigin('website_booking', fromFacebook)?.utm).toBe(
      'utm_source=facebook, utm_medium=social'
    );
  });

  it('beats the property even on a smart link or a landing page', () => {
    const viaSmartLink = { ...fromFacebook, smart_link_id: 'abc', smart_link_name: 'Booking Link' };
    const origin = contactOrigin('website_booking', viaSmartLink);
    expect(origin?.group).toBe('facebook');
    expect(origin?.surface).toBe('smart_link');
    expect(origin?.detailText).toBe('Booking Link');
  });
});

describe('with no tag, the chip is the property that captured them', () => {
  it('falls back to the website, never to "direct"', () => {
    const origin = contactOrigin('website_booking', untagged);
    expect(origin?.group).toBe('website');
    expect(origin?.utm).toBeUndefined();
  });

  /*
   * The decision taken deliberately: show what can be PROVEN. A referrer is a
   * good guess and a guess is not what the chip claims to be.
   */
  it('does not infer a channel from a recognised referrer', () => {
    const origin = contactOrigin('website_booking', {
      ...untagged,
      referrer_domain: 'facebook.com',
    });
    expect(origin?.group).toBe('website');
  });

  it('names the smart link when there is one', () => {
    const origin = contactOrigin('website_booking', {
      ...untagged,
      smart_link_id: 'abc',
      smart_link_name: 'Booking Link',
    });
    expect(origin?.group).toBe('smart_link');
    expect(origin?.detailText).toBe('Booking Link');
  });

  it('names the landing page when the capture recorded one', () => {
    const origin = contactOrigin('website_booking', {
      ...untagged,
      page_type: 'landing',
      capture_page_url: '/training-package',
    });
    expect(origin?.group).toBe('landing_page');
    expect(origin?.detailText).toBe('/training-package');
  });
});

describe('the owner always has the last word', () => {
  it('takes their answer over any attribution', () => {
    // They booked through the site with a Facebook tag; the owner asked, and it
    // was a friend's recommendation.
    expect(contactOrigin('referral', fromFacebook)?.group).toBe('referral');
  });

  it('says nothing about a value it does not know', () => {
    expect(contactOrigin('carrier_pigeon', untagged)).toBeUndefined();
  });

  it('says nothing for a contact with no source at all', () => {
    expect(contactOrigin(null)).toBeUndefined();
    expect(contactOrigin(undefined, fromFacebook)).toBeUndefined();
  });
});
