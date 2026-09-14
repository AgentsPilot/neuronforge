/**
 * A business's look, as a complete theme. Pure, and safe on both sides.
 *
 * WHY THIS IS SEPARATE FROM `resolveTheme`
 *
 * These two exports are needed on BOTH sides of the server/client boundary: the
 * server resolver fills gaps with them, and the client error boundary — which
 * renders precisely when a page has failed and there may be no resolved
 * branding at all — needs something to paint with.
 *
 * They used to live in `resolveTheme`, which reaches `getBusinessTemplate` and
 * therefore the service-role Supabase client. Importing one plain object from
 * there pulled that whole chain into the browser bundle, where
 * `SUPABASE_SERVICE_ROLE_KEY` does not exist and must not — so the page threw
 * `supabaseKey is required` in the customer's browser, on the component whose
 * entire job is to handle failure gracefully.
 *
 * Nothing here touches the database, so `resolveTheme` can stay `server-only`
 * while these stay importable from anywhere.
 *
 * @module lib/branding/theme
 */

import { themeForTemplateId } from '@/lib/website-builder/templates';
import type { PageTheme } from '@/lib/repositories/WebsitePageRepository';

/**
 * The look of a business that has chosen nothing.
 *
 * `primary` and `secondary` are the values the emails have always used
 * (`DEFAULT_EMAIL_BRANDING`). They are the right anchor because the customer
 * sees the confirmation email before the page it links to, so any other choice
 * would make the first branded thing they see disagree with the second.
 */
export const DEFAULT_PUBLIC_THEME: PageTheme = {
  colors: {
    primary: '#4F46E5',
    secondary: '#818CF8',
    accent: '#EC4899',
    background: '#FFFFFF',
    surface: '#F9FAFB',
    text: '#111827',
    textSecondary: '#6B7280',
  },
  fonts: {
    heading: 'Inter',
    body: 'Inter',
  },
  borderRadius: '8px',
  spacing: 'normal',
};

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Fill a partial theme out to a complete one.
 *
 * Merged key by key, in order: what the business stored, then the template it
 * chose, then the platform defaults. Key-by-key matters — a theme carrying only
 * `colors.primary` (which is what the design tab produces on an account with no
 * website) must still yield a full seven-colour palette rather than falling
 * wholesale back to the defaults and discarding the one colour it does have.
 */
export function completeTheme(partial: unknown, templateId?: string | null): PageTheme {
  const stored = (partial && typeof partial === 'object' ? partial : {}) as {
    id?: unknown;
    colors?: Record<string, unknown>;
    fonts?: Record<string, unknown>;
    borderRadius?: unknown;
    spacing?: unknown;
  };

  /*
   * An archetype id or a legacy template id — both name a design.
   *
   * The COLUMN first, then the theme's own id. Reading only the column threw
   * away the design of any page whose `template_id` is null while its stored
   * theme says `lumen` — and null is the common case, not the rare one: the
   * page-create route, the landing-page route and the generator all write null
   * unless a template was passed explicitly. Those pages resolved to the
   * platform default, which carries no id, so they got no shapes, no
   * composition and no layouts while the editor showed them as themed.
   */
  const base =
    themeForTemplateId(templateId) ??
    themeForTemplateId(str(stored.id)) ??
    DEFAULT_PUBLIC_THEME;

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * WHICH STORED VALUES ARE ACTUALLY SOMEBODY'S CHOICE
   *
   * A theme that names no `id` while the ROW names a template was not authored
   * — it was assembled. The landing-page route used to build one from the two
   * colours the wizard collected and then write `#ffffff`, `#f9fafb`,
   * `#1a1a1a`, `#6b7280` and `8px` in literally, with the real archetype
   * recorded only in the `template_id` column beside it.
   *
   * Merging that blob the usual way keeps the white: a business on Lumen, which
   * is a near-black archetype, renders on a white ground with 8px corners, and
   * switching template appears to do nothing but swap two accent colours. That
   * is the whole bug, and it is in the data, not in the renderer.
   *
   * So when the stored theme names no design and the row does, only the values
   * the owner genuinely picked are honoured — the two brand colours and the two
   * faces — and the ground, the surfaces, the ink and the radius come from the
   * archetype they chose. A theme that DOES name its own design is authored and
   * wins outright, exactly as before; so does one whose row names no template,
   * which is every pre-archetype page and must not change at all.
   */
  // Still keyed on the theme's OWN id: a theme that names its design was
  // authored, whatever the column beside it says.
  const isAssembled = !str(stored.id) && Boolean(templateId);

  const OWNER_CHOSEN: ReadonlyArray<keyof PageTheme['colors']> = ['primary', 'secondary'];

  const color = (key: keyof PageTheme['colors']): string => {
    if (isAssembled && !OWNER_CHOSEN.includes(key)) {
      return base.colors[key] ?? DEFAULT_PUBLIC_THEME.colors[key];
    }
    return str(stored.colors?.[key]) ?? base.colors[key] ?? DEFAULT_PUBLIC_THEME.colors[key];
  };

  // Only the two faces every theme has. `hebrewHeading` and `hebrewBody` are
  // optional by design and go through `optionalFont` below, which is allowed to
  // answer undefined.
  const font = (key: 'heading' | 'body'): string =>
    str(stored.fonts?.[key]) ?? base.fonts[key] ?? DEFAULT_PUBLIC_THEME.fonts[key];

  /*
   * A face that may legitimately be absent.
   *
   * `hebrewHeading` and `hebrewBody` only exist where the Latin face carries no
   * Hebrew glyphs — Montserrat and Josefin Sans carry none at all. Defaulting
   * them to anything would substitute a face on a template that never needed
   * one, so an absent value stays absent and the emitter keeps the Latin face.
   */
  const optionalFont = (key: 'hebrewHeading' | 'hebrewBody'): string | undefined =>
    str(stored.fonts?.[key]) ?? base.fonts[key] ?? undefined;

  const spacing = (isAssembled ? undefined : str(stored.spacing)) ?? base.spacing;

  return {
    colors: {
      primary: color('primary'),
      secondary: color('secondary'),
      accent: color('accent'),
      background: color('background'),
      surface: color('surface'),
      text: color('text'),
      textSecondary: color('textSecondary'),
    },
    fonts: {
      heading: font('heading'),
      body: font('body'),
      hebrewHeading: optionalFont('hebrewHeading'),
      hebrewBody: optionalFont('hebrewBody'),
    },
    // The radius is the archetype's signature — 14px reads as a product, 30px as
    // recent. An assembled theme's `8px` is a literal from the old route, never
    // a choice, so it does not get to override the design it names.
    borderRadius:
      (isAssembled ? undefined : str(stored.borderRadius)) ??
      base.borderRadius ??
      DEFAULT_PUBLIC_THEME.borderRadius,
    spacing: (['compact', 'normal', 'spacious'].includes(spacing as string)
      ? spacing
      : 'normal') as PageTheme['spacing'],
    /*
     * The rest of the design, carried rather than dropped.
     *
     * This returned a seven-colour palette, two fonts, a radius and a spacing
     * word — so a business whose website wore an archetype's type scale and
     * layout got neither on its smart link, its invoice or its confirmation
     * email. Every online surface is supposed to look like the same business,
     * and these four fields are most of what that means: the type scale, the
     * layout arrangement, and the id and source that say which design it is.
     *
     * A stored theme cannot override them — they are the archetype's, and there
     * is no interface anywhere that edits a type scale by hand.
     */
    id: base.id,
    source: base.source,
    scale: base.scale,
    layouts: base.layouts,
    /*
     * The composition, for the same reason and with the same force.
     *
     * This is the half of a design that layouts alone could never express:
     * whether services are ruled rows or cards, whether the closing block
     * inverts, whether the small print is set in mono. Leaving it to a stored
     * theme would let a business keep Stone's bones while wearing Bold's
     * palette — which is precisely the mismatch the archetypes were introduced
     * to end.
     */
    composition: base.composition,
  };
}
