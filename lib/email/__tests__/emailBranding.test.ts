/**
 * What an email must look like when the website looks like something.
 *
 * Emails share the business's FLAVOUR — its colours, its faces, its radius —
 * but never its composition: email HTML is tables and inline styles, so Stone's
 * ruled rows and Bold's mono cannot render there. Sharing the flavour is the
 * most an email can do, and it is the whole of what makes a receipt look like
 * it came from the same business as the site that sent it.
 *
 * The regression these exist for: `resolveEmailBranding` read the profile's
 * stored theme verbatim. The design tab saves only the two colours and two
 * faces it edits, so one Save left a business on Lumen with a profile theme
 * carrying no ground and no radius — and every email silently went white while
 * the website stayed near-black.
 */

import { completeTheme } from '@/lib/branding/theme';

/** What the design tab writes to `business_profiles.theme` after a Save. */
const AFTER_DESIGN_TAB_SAVE = {
  colors: { primary: '#FF0000', secondary: '#00FF00' },
  fonts: { heading: 'Georgia', body: 'Georgia' },
};

describe('a business whose profile theme is partial', () => {
  it('still resolves its template\'s ground and radius', () => {
    const theme = completeTheme(AFTER_DESIGN_TAB_SAVE, 'lumen');

    // Lumen's own, not the platform's white/8px.
    expect(theme.colors.background).toBe('#141414');
    expect(theme.borderRadius).toBe('30px');

    // And the owner's edits survive.
    expect(theme.colors.primary).toBe('#FF0000');
    expect(theme.fonts.heading).toBe('Georgia');
  });

  it('resolves a dark template as dark, which is what the email inherits', () => {
    expect(completeTheme(AFTER_DESIGN_TAB_SAVE, 'bold').colors.background).toBe('#141416');
    expect(completeTheme(AFTER_DESIGN_TAB_SAVE, 'warm').colors.background).toBe('#FBF7F1');
  });
});

describe('a business that has chosen nothing', () => {
  /*
   * The behaviour the old `raw` read was protecting, kept deliberately: an
   * account with no look sends exactly the email it always sent. It survives
   * because the platform default and the email default are the same two
   * colours — `#4F46E5` and `#818CF8`.
   */
  it('falls back to the colours emails have always used', () => {
    const theme = completeTheme(null, null);
    expect(theme.colors.primary).toBe('#4F46E5');
    expect(theme.colors.secondary).toBe('#818CF8');
  });
});
