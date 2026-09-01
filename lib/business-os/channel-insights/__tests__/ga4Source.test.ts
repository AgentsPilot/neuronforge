import { ga4SourceToChannel, ga4CoversHost } from '../ga4Source';

describe('[smoke] ga4SourceToChannel', () => {
  describe('referrer-shaped values', () => {
    it.each([
      ['l.instagram.com', 'instagram'],
      ['instagram.com', 'instagram'],
      ['m.facebook.com', 'facebook'],
      ['l.facebook.com', 'facebook'],
      ['lm.facebook.com', 'facebook'],
      ['tiktok.com', 'tiktok'],
      ['lnkd.in', 'linkedin'],
    ])('maps %s to %s', (source, expected) => {
      expect(ga4SourceToChannel(source).channel).toBe(expected);
    });
  });

  describe('UTM-token-shaped values', () => {
    // GA4 puts a bare tag in the same field as a hostname when the link was
    // tagged, so both shapes have to resolve.
    it.each([
      ['instagram', 'instagram'],
      ['ig', 'instagram'],
      ['facebook', 'facebook'],
      ['fb', 'facebook'],
      ['google', 'google'],
      ['newsletter', 'email'],
      ['mailchimp', 'email'],
    ])('maps %s to %s', (source, expected) => {
      expect(ga4SourceToChannel(source).channel).toBe(expected);
    });
  });

  describe("GA4's placeholders for no source", () => {
    // Without the explicit guard these fall through to resolveChannel, which
    // treats them as unrecognised hostnames and returns 'referral' — silently
    // filing direct traffic as a referral from a site called "(direct)".
    it.each(['(direct)', '(none)', '(not set)', 'direct', ''])(
      'maps %s to direct',
      source => {
        expect(ga4SourceToChannel(source).channel).toBe('direct');
      }
    );

    it('handles null and undefined', () => {
      expect(ga4SourceToChannel(null).channel).toBe('direct');
      expect(ga4SourceToChannel(undefined).channel).toBe('direct');
    });
  });

  it('is case and whitespace insensitive', () => {
    expect(ga4SourceToChannel('  Instagram  ').channel).toBe('instagram');
    expect(ga4SourceToChannel('(DIRECT)').channel).toBe('direct');
  });

  it('reports an unrecognised real source as a referral, not direct', () => {
    // A genuine referrer we don't have a rule for is still a real referral.
    // Collapsing it into 'direct' would overstate untraceable traffic.
    expect(ga4SourceToChannel('some-parenting-blog.co.il').channel).toBe('referral');
  });
});

describe('[smoke] ga4CoversHost', () => {
  it('detects overlap with an AgentPilot-hosted site', () => {
    expect(ga4CoversHost(['school.agentpilot.io'], ['school.agentpilot.io'])).toBe(true);
  });

  it('ignores www and casing rather than missing an overlap', () => {
    // A false negative here silently doubles every visit number, so the
    // comparison has to be forgiving in exactly these two ways.
    expect(ga4CoversHost(['www.school.agentpilot.io'], ['school.agentpilot.io'])).toBe(true);
    expect(ga4CoversHost(['School.AgentPilot.IO'], ['school.agentpilot.io'])).toBe(true);
  });

  it('reports no overlap for a genuinely different site', () => {
    // A Wix site and an AgentPilot landing page are two different places;
    // their visits are additive, not duplicated.
    expect(ga4CoversHost(['mysite.wixsite.com'], ['school.agentpilot.io'])).toBe(false);
  });

  it('handles empty inputs without claiming overlap', () => {
    expect(ga4CoversHost([], ['school.agentpilot.io'])).toBe(false);
    expect(ga4CoversHost(['school.agentpilot.io'], [])).toBe(false);
    expect(ga4CoversHost([], [])).toBe(false);
  });

  it('matches when a property measures several hosts and one is ours', () => {
    expect(
      ga4CoversHost(['mysite.wixsite.com', 'school.agentpilot.io'], ['school.agentpilot.io'])
    ).toBe(true);
  });
});
