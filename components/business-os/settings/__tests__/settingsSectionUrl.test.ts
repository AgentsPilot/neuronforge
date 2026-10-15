/**
 * `settingsUrlWithoutSection` (settings drawer review C-3, C-11): closing a
 * link-opened drawer removes `section` and nothing else.
 */

import { settingsUrlWithoutSection } from '@/components/business-os/settings/settingsSectionUrl';

const PATH = '/business-os/settings';
const params = (query: string) => new URLSearchParams(query);

describe('settingsUrlWithoutSection', () => {
  it('`?section=plan` alone becomes the bare pathname', () => {
    expect(settingsUrlWithoutSection(PATH, params('section=plan'))).toBe(PATH);
  });

  it('keeps `checkout` and `tab`, in their order, and drops only `section`', () => {
    expect(settingsUrlWithoutSection(PATH, params('section=plan&checkout=cs_test_x&tab=foo'))).toBe(
      `${PATH}?checkout=cs_test_x&tab=foo`
    );
    expect(settingsUrlWithoutSection(PATH, params('tab=foo&section=plan&checkout=cs_test_x'))).toBe(
      `${PATH}?tab=foo&checkout=cs_test_x`
    );
  });

  it('leaves an address with no `section` unchanged', () => {
    expect(settingsUrlWithoutSection(PATH, params('checkout=cs_test_x'))).toBe(`${PATH}?checkout=cs_test_x`);
    expect(settingsUrlWithoutSection(PATH, params(''))).toBe(PATH);
  });

  it('accepts null or undefined params', () => {
    expect(settingsUrlWithoutSection(PATH, null)).toBe(PATH);
    expect(settingsUrlWithoutSection(PATH, undefined)).toBe(PATH);
  });

  it('keeps encoded values intact', () => {
    const out = settingsUrlWithoutSection(PATH, params('section=plan&tab=a%26b%3Dc&note=x+y'));
    const kept = new URL(out, 'https://example.test').searchParams;
    expect(kept.get('tab')).toBe('a&b=c');
    expect(kept.get('note')).toBe('x y');
    expect(kept.has('section')).toBe(false);
  });

  it('never adds or drops `checkout`', () => {
    const withMarker = new URL(
      settingsUrlWithoutSection(PATH, params('section=plan&checkout=cs_test_x')),
      'https://example.test'
    ).searchParams;
    expect(withMarker.getAll('checkout')).toEqual(['cs_test_x']);

    const without = new URL(settingsUrlWithoutSection(PATH, params('section=plan')), 'https://example.test')
      .searchParams;
    expect(without.has('checkout')).toBe(false);
  });

  it('does not mutate the params it was given', () => {
    const given = params('section=plan&checkout=cs_test_x');
    settingsUrlWithoutSection(PATH, given);
    expect(given.get('section')).toBe('plan');
  });
});
