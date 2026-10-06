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

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BUSINESS'S OWN SITE IS NOT A REFERRAL.
 *
 * Reported by an owner on 2026-10-05: the channel card read "100% אתרים אחרים"
 * over two leads, with a dash against Google, Instagram, Facebook, email and
 * direct alike. All three of their contacts carried
 * `referrer_domain: 'localhost'`, which matched no named channel and fell into
 * the catch-all whose own comment promises "a referral from somewhere real — a
 * directory, a partner site, a forum".
 *
 * The production version of the same hole is worse than the development one: a
 * visitor who reads the booking page and submits it arrives with a referrer of
 * that page, so every business's own traffic was being reported as somebody
 * else's website — inflating referral and emptying direct.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('a referrer that is the business itself', () => {
  it('counts development traffic as direct, not as another website', () => {
    expect(resolveChannel('localhost').channel).toBe('direct');
    expect(resolveChannel('127.0.0.1').channel).toBe('direct');
    expect(resolveChannel('localhost:3000').channel).toBe('direct');
  });

  it('counts the local testing hosts as direct', () => {
    // `lvh.me` is what `origins.ts` recommends for exercising the real
    // subdomain shape on a laptop, so leads from it are self-referrals too.
    expect(resolveChannel('joesgym.lvh.me:3000').channel).toBe('direct');
    expect(resolveChannel('localtest.me').channel).toBe('direct');
  });

  it('counts the platform host as direct when it is given', () => {
    const own = ['app.agentspilot.ai'];

    expect(resolveChannel('app.agentspilot.ai', null, own).channel).toBe('direct');
    // A subdomain of it is still the same business's site.
    expect(resolveChannel('joesgym.app.agentspilot.ai', null, own).channel).toBe('direct');
  });

  it('still reports a genuine referral as one', () => {
    /*
     * The branch exists for real referrals and must keep working: a directory,
     * a partner site, a forum. Over-reaching here would hide the one column
     * this card is for.
     */
    expect(resolveChannel('somedirectory.co.il', null, ['app.agentspilot.ai']).channel).toBe('referral');
  });

  it('does not let a self-host beat an explicit tag', () => {
    // A smart link that stamped `utm_source=instagram` says where they came
    // from; the page they happened to land on first does not override it.
    expect(resolveChannel('localhost', 'instagram').channel).toBe('instagram');
  });

  it('still reports a named channel even if it were somehow also own', () => {
    // Checked after the named channels on purpose, so the ordering is pinned.
    expect(resolveChannel('google.com', null, ['google.com']).channel).toBe('google');
  });

  it('keeps no referrer at all as direct', () => {
    // Unchanged, and the reason `basis` exists: this one is a guess from
    // absence, the self-host ones are read from a real referrer.
    expect(resolveChannel(null).basis).toBe('none');
    expect(resolveChannel('localhost').basis).toBe('referrer');
  });
});
