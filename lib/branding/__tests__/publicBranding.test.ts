/**
 * The invariants the public pages rely on.
 *
 * These are the three things that, if they break, break silently and only on a
 * customer's screen: a theme with a hole in it, an unreadable button, and a
 * template's example phone number presented as the business's own.
 */

import { WEBSITE_TEMPLATES } from '@/lib/website-builder/templates';
// From `theme`, not `resolveTheme`: the latter is `server-only`, which Next
// resolves at build time but Jest cannot.
import { completeTheme, DEFAULT_PUBLIC_THEME } from '@/lib/branding/theme';
import { contrastRatio, onColor, isDarkColor, withAlpha, normalizeHex } from '@/lib/branding/color';
import {
  cleanPublicContact,
  isPlaceholderEmail,
  isPlaceholderPhone,
  __templateSeedsForTest,
} from '@/lib/branding/placeholderContact';

const COLOR_KEYS = [
  'primary',
  'secondary',
  'accent',
  'background',
  'surface',
  'text',
  'textSecondary',
] as const;

/** Every field populated, and every colour a colour. */
function expectCompleteTheme(theme: ReturnType<typeof completeTheme>) {
  for (const key of COLOR_KEYS) {
    expect(typeof theme.colors[key]).toBe('string');
    expect(theme.colors[key]).not.toBe('');
    expect(theme.colors[key]).toMatch(/^#[0-9a-fA-F]{3,8}$/);
  }
  expect(theme.fonts.heading).toBeTruthy();
  expect(theme.fonts.body).toBeTruthy();
  expect(theme.borderRadius).toBeTruthy();
  expect(['compact', 'normal', 'spacious']).toContain(theme.spacing);
}

describe('completeTheme', () => {
  it('produces a complete theme from nothing at all', () => {
    // The account with no website and no template — where a partial theme used
    // to leak `undefined` into an inline style.
    expectCompleteTheme(completeTheme(null, null));
    expectCompleteTheme(completeTheme(undefined, undefined));
    expectCompleteTheme(completeTheme({}, null));
  });

  it('keeps the one colour a business did choose', () => {
    // What the design tab produces on an account with no website: a theme
    // carrying `colors.primary` and nothing else. Falling wholesale back to the
    // defaults here would discard the only choice the business has made.
    const theme = completeTheme({ colors: { primary: '#8B1A1A' } }, null);
    expect(theme.colors.primary).toBe('#8B1A1A');
    expectCompleteTheme(theme);
  });

  it('fills gaps from the template before the platform defaults', () => {
    const template = WEBSITE_TEMPLATES[0];
    const theme = completeTheme({ colors: { primary: '#123456' } }, template.id);

    expect(theme.colors.primary).toBe('#123456');
    // Secondary was not stored, so it must come from the template rather than
    // from the platform default.
    expect(theme.colors.secondary).toBe(template.theme.secondary_color);
    expect(theme.colors.secondary).not.toBe(DEFAULT_PUBLIC_THEME.colors.secondary);
  });

  it('survives a malformed row', () => {
    // `theme` is unvalidated JSONB. None of these should throw.
    expectCompleteTheme(completeTheme('nonsense', null));
    expectCompleteTheme(completeTheme(42, null));
    expectCompleteTheme(completeTheme({ colors: 'not-an-object' }, null));
    expectCompleteTheme(completeTheme({ spacing: 'enormous' }, null));
  });

  it('is complete for every template in the catalogue', () => {
    for (const template of WEBSITE_TEMPLATES) {
      expectCompleteTheme(completeTheme(null, template.id));
    }
  });

  it('ignores a template id that no longer exists', () => {
    expectCompleteTheme(completeTheme(null, 'template_that_was_deleted'));
  });
});

describe('onColor', () => {
  it('gives readable text on every template primary', () => {
    // The bug this exists to prevent: white text was hardcoded on the brand
    // button, and the paler templates in the catalogue fail contrast outright.
    for (const template of WEBSITE_TEMPLATES) {
      const brand = template.theme.primary_color;
      const ratio = contrastRatio(brand, onColor(brand));

      expect({ id: template.id, brand, ratio: Number(ratio.toFixed(2)) }).toMatchObject({
        id: template.id,
      });
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('picks dark ink on a pale brand and white on a dark one', () => {
    expect(onColor('#FFE066')).toBe('#111827');
    expect(onColor('#0D0D0D')).toBe('#FFFFFF');
  });
});

describe('color helpers', () => {
  it('parses shorthand and unprefixed hex', () => {
    expect(normalizeHex('#abc')).toBe('#aabbcc');
    expect(normalizeHex('4F46E5')).toBe('#4f46e5');
    expect(normalizeHex('not a colour')).toBeNull();
  });

  it('produces a valid 8-digit hex for alpha', () => {
    expect(withAlpha('#4F46E5', 0.1)).toMatch(/^#[0-9a-f]{8}$/);
    expect(withAlpha('#4F46E5', 1)).toBe('#4f46e5ff');
  });

  it('recognises the dark templates', () => {
    expect(isDarkColor('#0A0A0A')).toBe(true);
    expect(isDarkColor('#FFFFFF')).toBe(false);
  });
});

describe('placeholderContact', () => {
  it('harvested seeds from the template catalogue', () => {
    // If this is ever zero the deny-list has silently stopped working, and the
    // tests below would all pass while the feature does nothing.
    expect(__templateSeedsForTest().length).toBeGreaterThan(10);
  });

  it('rejects every contact value any template seeds', () => {
    // This is the test that keeps the list honest as templates are added.
    for (const seed of __templateSeedsForTest()) {
      const kind = seed.includes('@') ? 'email' : /\d/.test(seed) ? 'phone' : 'address';
      expect({ seed, cleaned: cleanPublicContact(seed, kind) }).toEqual({ seed, cleaned: null });
    }
  });

  it('rejects the generic placeholders', () => {
    expect(isPlaceholderEmail('contact@yourbusiness.com')).toBe(true);
    expect(isPlaceholderEmail('someone@example.com')).toBe(true);
    expect(isPlaceholderPhone('+1 (555) 123-4567')).toBe(true);
    expect(isPlaceholderPhone('555-0100')).toBe(true);
    expect(cleanPublicContact('123 Main St, Anytown', 'address')).toBeNull();
  });

  it('keeps a real business’s details', () => {
    expect(cleanPublicContact('yael@mirpaa.co.il', 'email')).toBe('yael@mirpaa.co.il');
    expect(cleanPublicContact('+972 54 123 4567', 'phone')).toBe('+972 54 123 4567');
    expect(cleanPublicContact('רחוב דיזנגוף 50, תל אביב', 'address')).toBe(
      'רחוב דיזנגוף 50, תל אביב'
    );
  });

  it('treats absent and blank as “not told”', () => {
    expect(cleanPublicContact(null, 'email')).toBeNull();
    expect(cleanPublicContact('   ', 'phone')).toBeNull();
    expect(cleanPublicContact(undefined, 'address')).toBeNull();
  });
});
