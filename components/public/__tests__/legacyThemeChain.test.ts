import { completeTheme } from '@/lib/branding/theme';
import { compositionFor } from '@/components/public/compositions';

/*
 * The exact blob the old landing-page route wrote: two real colours, hardcoded
 * greys, no id, no scale, no layouts, no composition — with the real archetype
 * recorded only in the `template_id` COLUMN beside it.
 */
const LEGACY_STORED_THEME = {
  colors: {
    primary: '#A9FF5B', secondary: '#A476FF', accent: '#A476FF',
    background: '#ffffff', surface: '#f9fafb',
    text: '#1a1a1a', textSecondary: '#6b7280',
  },
  fonts: { heading: 'Montserrat', body: 'Montserrat' },
  spacing: 'normal' as const,
  borderRadius: '8px',
};

describe('a page stored by the old code, served by the new', () => {
  it('recovers the archetype from the template_id column', () => {
    const theme = completeTheme(LEGACY_STORED_THEME, 'lumen');
    expect(theme.id).toBe('lumen');
    expect(theme.composition).toBe('bold');
    expect(theme.layouts).toBeDefined();
    expect(theme.scale).toBeDefined();
    // The archetype's real ground and radius, not the hardcoded white/8px.
    expect(theme.colors.background).toBe('#141414');
    expect(theme.borderRadius).toBe('30px');
  });

  it('gives that page a composition to render in', () => {
    expect(compositionFor(completeTheme(LEGACY_STORED_THEME, 'lumen'))).toBe('bold');
    expect(compositionFor(completeTheme(LEGACY_STORED_THEME, 'bloom'))).toBe('warm');
    expect(compositionFor(completeTheme(LEGACY_STORED_THEME, 'stone'))).toBe('stone');
  });

  it('applies no composition when the row names no design at all', () => {
    expect(compositionFor(completeTheme(LEGACY_STORED_THEME, null))).toBeNull();
  });
});
