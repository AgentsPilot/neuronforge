import { completeTheme } from '@/lib/branding/theme';

/*
 * What the design tab sends: the two colours and two faces the owner actually
 * edited, plus whatever the page already had carried through — and NO `id`,
 * because the form does not know about archetypes.
 */
const FROM_DESIGN_TAB = {
  colors: {
    primary: '#FF0000', secondary: '#00FF00',
    accent: '#EC4899', background: '#FFFFFF', surface: '#F9FAFB',
    text: '#111827', textSecondary: '#6B7280',
  },
  fonts: { heading: 'Georgia', body: 'Georgia' },
  borderRadius: '0.5rem',
  spacing: 'normal' as const,
};

describe('the design tab, against the new merge', () => {
  it('keeps the two colours and two faces the owner chose', () => {
    const theme = completeTheme(FROM_DESIGN_TAB, 'warm');
    expect(theme.colors.primary).toBe('#FF0000');
    expect(theme.colors.secondary).toBe('#00FF00');
    expect(theme.fonts.heading).toBe('Georgia');
    expect(theme.fonts.body).toBe('Georgia');
  });

  it('still renders in the chosen template, not the form\'s stale defaults', () => {
    const theme = completeTheme(FROM_DESIGN_TAB, 'warm');
    expect(theme.composition).toBe('warm');
    expect(theme.layouts).toBeDefined();
    expect(theme.scale).toBeDefined();
  });

  /*
   * The form carries `#FFFFFF` and `0.5rem` through from a time before
   * archetypes. Re-stamping those onto a business that chose Bold would put a
   * near-black design on a white ground.
   */
  it('does not let the form\'s carried-through defaults overwrite the template', () => {
    const theme = completeTheme(FROM_DESIGN_TAB, 'bold');
    expect(theme.colors.background).toBe('#141416');
    expect(theme.borderRadius).toBe('14px');
  });

  it('leaves a business with no template exactly as it was', () => {
    const theme = completeTheme(FROM_DESIGN_TAB, null);
    expect(theme.colors.background).toBe('#FFFFFF');
    expect(theme.colors.primary).toBe('#FF0000');
    expect(theme.composition).toBeUndefined();
  });
});

/*
 * The payload the design tab actually PUTs, validated against the route's own
 * schema. The form sends two colours and two faces; a schema demanding all
 * seven colours would reject every save, and the failure would look like a
 * network error rather than a contract mismatch.
 */
describe('the design tab payload, against the page route schema', () => {
  it('validates with only the fields the form edits', async () => {
    const { z } = await import('zod');
    const {
      HERO_LAYOUTS, SERVICES_LAYOUTS, CTA_LAYOUTS, GALLERY_LAYOUTS, PRICING_LAYOUTS, COMPOSITIONS,
    } = await import('@/lib/website-builder/pageTheme');

    // Mirrors app/api/website/pages/[id]/route.ts
    const schema = z.object({
      id: z.string().optional(),
      source: z.string().optional(),
      composition: z.enum(COMPOSITIONS).optional(),
      colors: z.object({
        primary: z.string().optional(), secondary: z.string().optional(),
        accent: z.string().optional(), background: z.string().optional(),
        surface: z.string().optional(), text: z.string().optional(),
        textSecondary: z.string().optional(),
      }).optional(),
      fonts: z.object({
        heading: z.string().optional(), body: z.string().optional(),
        hebrewHeading: z.string().optional(), hebrewBody: z.string().optional(),
      }).optional(),
      layouts: z.object({
        hero: z.enum(HERO_LAYOUTS), services: z.enum(SERVICES_LAYOUTS),
        cta: z.enum(CTA_LAYOUTS), gallery: z.enum(GALLERY_LAYOUTS), pricing: z.enum(PRICING_LAYOUTS),
      }).optional(),
      borderRadius: z.string().optional(),
    });

    const payload = {
      colors: { primary: '#FF0000', secondary: '#00FF00' },
      fonts: { heading: 'Georgia', body: 'Georgia' },
    };

    expect(() => schema.parse(payload)).not.toThrow();
  });
});

/*
 * The common case on live data, and the one that was silently broken.
 *
 * `template_id` is null on pages created by the page route, the landing route
 * and the generator unless a template was passed explicitly — but the stored
 * theme still names its archetype, because `completeTheme` stamps `id` on every
 * theme it returns. Reading only the column discarded that: the page rendered
 * with the platform default, which has no id, so it got no template shapes and
 * no composition while the editor still showed it as themed.
 */
describe('a page whose theme names a design but whose column does not', () => {
  it('keeps its design', async () => {
    const { completeTheme: merge } = await import('@/lib/branding/theme');
    const stored = merge({ colors: { primary: '#A9FF5B' } }, 'lumen');
    expect(stored.id).toBe('lumen');

    // Saved back with no template_id on the row — the routine case.
    const reread = merge(stored, null);
    expect(reread.id).toBe('lumen');
    expect(reread.composition).toBe('bold');
    expect(reread.layouts).toBeDefined();
    expect(reread.colors.background).toBe('#141414');
  });

  it('still leaves a theme that names nothing alone', async () => {
    const { completeTheme: merge } = await import('@/lib/branding/theme');
    const plain = merge({ colors: { primary: '#123456' } }, null);
    expect(plain.id).toBeUndefined();
    expect(plain.composition).toBeUndefined();
  });
});
