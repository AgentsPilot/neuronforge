import { resolveChannel, CHANNEL_ORDER } from '../channelFromReferrer';

describe('[smoke] resolveChannel', () => {
  describe('social referrers, including the app shim domains', () => {
    // Instagram and Facebook route outbound taps through l.* hosts. Matching
    // only the bare domain would miss most real in-app traffic, which is the
    // majority of social traffic for this audience.
    it.each([
      ['l.instagram.com', 'instagram'],
      ['instagram.com', 'instagram'],
      ['www.instagram.com', 'instagram'],
      ['l.facebook.com', 'facebook'],
      ['lm.facebook.com', 'facebook'],
      ['m.facebook.com', 'facebook'],
      ['facebook.com', 'facebook'],
      ['messenger.com', 'facebook'],
      ['wa.me', 'whatsapp'],
      ['l.wa.me', 'whatsapp'],
      ['tiktok.com', 'tiktok'],
      ['lnkd.in', 'linkedin'],
      ['youtu.be', 'youtube'],
    ])('maps %s to %s', (host, expected) => {
      expect(resolveChannel(host, null).channel).toBe(expected);
    });
  });

  describe('google hosts', () => {
    it('treats search as google', () => {
      expect(resolveChannel('google.com', null).channel).toBe('google');
    });

    it('handles country domains', () => {
      expect(resolveChannel('google.co.il', null).channel).toBe('google');
      expect(resolveChannel('www.google.de', null).channel).toBe('google');
    });

    it('classifies gmail as email, not google search', () => {
      // mail.google.com is a google host but is not organic search traffic.
      // Order matters here — the email rule must be checked first.
      expect(resolveChannel('mail.google.com', null).channel).toBe('email');
    });
  });

  describe('UTM takes priority over referrer', () => {
    it('prefers an explicit tag', () => {
      const result = resolveChannel('google.com', 'instagram');
      expect(result.channel).toBe('instagram');
      expect(result.basis).toBe('utm');
    });

    it('is case and whitespace insensitive', () => {
      expect(resolveChannel(null, '  Instagram  ').channel).toBe('instagram');
      expect(resolveChannel(null, 'FB').channel).toBe('facebook');
    });

    it('falls back to the referrer when the tag is unrecognised', () => {
      const result = resolveChannel('l.instagram.com', 'summer_promo_v2');
      expect(result.channel).toBe('instagram');
      expect(result.basis).toBe('referrer');
    });
  });

  describe('honest reporting of what we do not know', () => {
    it('reports direct when there is no signal at all', () => {
      expect(resolveChannel(null, null)).toEqual({ channel: 'direct', basis: 'none' });
      expect(resolveChannel('', '').channel).toBe('direct');
      expect(resolveChannel(undefined, undefined).channel).toBe('direct');
    });

    it('distinguishes an unrecognised referrer from no referrer', () => {
      // Someone linked from a directory or a forum. That is a real referral and
      // should not be lumped in with traffic we could not trace at all.
      const result = resolveChannel('some-parenting-blog.co.il', null);
      expect(result.channel).toBe('referral');
      expect(result.basis).toBe('referrer');
      expect(result.detail).toBe('some-parenting-blog.co.il');
    });

    it('does not mistake a lookalike domain for the real one', () => {
      // Substring matching would classify these as Instagram/Facebook.
      expect(resolveChannel('notinstagram.com', null).channel).toBe('referral');
      expect(resolveChannel('facebook.com.phishing.example', null).channel).toBe('referral');
      expect(resolveChannel('myfacebook.com', null).channel).toBe('referral');
    });
  });

  describe('input tolerance', () => {
    it('accepts a full URL where a domain was expected', () => {
      expect(resolveChannel('https://l.instagram.com/?u=xyz', null).channel).toBe('instagram');
    });

    it('strips ports and www', () => {
      expect(resolveChannel('www.facebook.com:443', null).channel).toBe('facebook');
    });
  });

  it('reports the basis so the UI can qualify the number', () => {
    expect(resolveChannel(null, 'instagram').basis).toBe('utm');
    expect(resolveChannel('l.instagram.com', null).basis).toBe('referrer');
    expect(resolveChannel(null, null).basis).toBe('none');
  });

  it('orders every channel it can return', () => {
    const returnable = new Set(
      [
        resolveChannel('l.instagram.com'),
        resolveChannel('facebook.com'),
        resolveChannel('google.com'),
        resolveChannel('wa.me'),
        resolveChannel('tiktok.com'),
        resolveChannel('linkedin.com'),
        resolveChannel('youtube.com'),
        resolveChannel('mail.google.com'),
        resolveChannel('example.com'),
        resolveChannel(null),
      ].map(r => r.channel)
    );

    for (const channel of returnable) {
      expect(CHANNEL_ORDER).toContain(channel);
    }
  });
});
