/**
 * A business's look, as one object. The canonical definition.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 *
 * `PageTheme` was declared TWICE — once in `components/website/blocks/types.ts`
 * for the renderer and once in `lib/repositories/WebsitePageRepository.ts` for
 * the row it is stored in. The two were character-for-character identical, so
 * TypeScript matched them structurally and nothing ever complained. That is the
 * trap: widening one and not the other compiles perfectly and silently splits
 * the two halves of the same object.
 *
 * Both now re-export from here. Nothing imports from this module except those
 * two, and this module imports nothing at all — so it is safe on either side of
 * the server/client boundary.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/website-builder/pageTheme
 */

/** The looks a business can wear. */
export type ArchetypeId = 'stone' | 'lumen' | 'bloom' | 'aster' | 'warm' | 'bold';

/*
 * Composition: how a section is BUILT, as opposed to what colour it is.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS SEPARATE FROM THE ARCHETYPE
 *
 * Archetypes used to carry tokens and nothing else — palette, faces, radius, and
 * five layout names. That is a recolour, and it is exactly what every owner who
 * switched template saw: the same card-and-shadow markup in a new palette.
 *
 * A design is also its structure: whether services are numbered rows or cards,
 * whether the closing block is an inverted panel or a flat band, whether a
 * heading sits above its section or beside it. That structure is the expensive
 * half to design and the cheap half to share — several palettes can wear the
 * same bones and still look nothing like each other.
 *
 * So an archetype is a COMPOSITION plus a FLAVOUR. Three compositions cover the
 * six archetypes: Bloom wears Warm's bones in blush, Lumen and Aster wear Bold's
 * in lime and indigo. Adding a seventh archetype stays what this system promised
 * — a row of tokens, and a composition it reuses.
 *
 * Runtime array for the same reason as the layout vocabulary below: the page
 * update endpoint validates a stored theme with Zod, and a bare `z.string()`
 * would accept a composition no stylesheet implements.
 */
export const COMPOSITIONS = ['stone', 'warm', 'bold'] as const;
export type Composition = (typeof COMPOSITIONS)[number];

/*
 * The layout vocabulary.
 *
 * CLOSED, on purpose. An archetype picks a name from each list and the block
 * component switches on it; a name that is not here does not exist, which is
 * what makes adding a new archetype a row rather than a deploy. Widening a list
 * is a deliberate act with code behind it, and it widens the vocabulary for
 * every archetype after.
 */
/*
 * Runtime arrays, not only types.
 *
 * The vocabulary has to exist at runtime as well as at compile time: the page
 * update endpoint validates a theme with Zod, and a `z.string()` there would
 * accept a layout name no block implements and store it — the section would
 * then render in its default layout with nothing anywhere saying why.
 *
 * Deriving the types from the arrays rather than writing both means the two can
 * never disagree.
 */
export const HERO_LAYOUTS = ['stacked', 'split', 'centered', 'full-bleed'] as const;
export const SERVICES_LAYOUTS = ['rows', 'cards', 'list'] as const;
export const CTA_LAYOUTS = ['panel', 'flat', 'inline'] as const;

export type HeroLayout = (typeof HERO_LAYOUTS)[number];
export type ServicesLayout = (typeof SERVICES_LAYOUTS)[number];
export type CtaLayout = (typeof CTA_LAYOUTS)[number];
/*
 * No 'none' here, deliberately.
 *
 * A theme must not be able to delete content. `gallery_led` exists because a
 * photographer's work IS the argument, and an archetype that answered 'none'
 * would drop a portfolio the owner uploaded — a section they filled in and then
 * could not find. Whether a gallery exists is the recipe's decision, made from
 * the data; this only ever says what shape it takes.
 */
export const GALLERY_LAYOUTS = ['mosaic', 'grid', 'carousel'] as const;
export const PRICING_LAYOUTS = ['panels', 'table'] as const;

export type GalleryLayout = (typeof GALLERY_LAYOUTS)[number];
export type PricingLayout = (typeof PRICING_LAYOUTS)[number];

export interface ThemeLayouts {
  hero: HeroLayout;
  services: ServicesLayout;
  cta: CtaLayout;
  gallery: GalleryLayout;
  pricing: PricingLayout;
}

/** Type sizes, as `clamp()` strings so a page scales without a media query. */
export interface ThemeScale {
  h1: string;
  h2: string;
  h3: string;
  body: string;
  small: string;
}

export interface PageTheme {
  /**
   * Which archetype this is.
   *
   * Optional because every theme stored before archetypes existed has none, and
   * those pages must keep rendering exactly as they do. A theme without an id
   * is simply a palette, which is all a theme has ever been.
   */
  id?: ArchetypeId | string;
  /** Where the design came from, and the MIT notice that has to travel with it. */
  source?: string;

  /**
   * Which set of bones this look is built on.
   *
   * Optional for the same reason `id` is: every theme stored before compositions
   * existed has none. Absent, the composition is taken from the archetype `id`
   * names; absent THAT too, no composition is applied at all and the blocks
   * render exactly as they always have. A theme that is only a palette keeps
   * the arrangement its blocks give it — that arrangement IS its design.
   */
  composition?: Composition;

  colors: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    surface: string;
    text: string;
    textSecondary: string;
  };

  fonts: {
    heading: string;
    body: string;
    /**
     * The Hebrew faces, where the Latin ones have no Hebrew glyphs.
     *
     * Montserrat and Josefin Sans carry no Hebrew at all, so a Hebrew page set
     * in them falls back per glyph and renders a paragraph in two faces. An
     * archetype names the Hebrew equivalent it was designed against — Rubik for
     * Montserrat, Varela Round for Josefin — and the emitter picks by locale.
     *
     * Absent means the Latin face carries Hebrew too, or the platform default
     * covers it.
     */
    hebrewHeading?: string;
    hebrewBody?: string;
  };

  /** Absent on a theme stored before archetypes; the emitter falls back. */
  scale?: ThemeScale;

  borderRadius: string;
  spacing: 'compact' | 'normal' | 'spacious';

  /** Absent on an old theme, which renders in every block's default layout. */
  layouts?: ThemeLayouts;
}

/**
 * Which layout a block should render in, right now.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE THEME WINS OVER THE BLOCK
 *
 * Each of the five blocks that has layout variants reads `styles.layout`, and
 * that value is stamped once — by `orderByRecipe`, whose only production caller
 * is website GENERATION. Nothing re-stamps it. So changing the template
 * afterwards swapped the colours, the fonts and the radii while every block
 * kept the arrangement it was born with, and the whole feature read as a
 * palette switcher.
 *
 * Landing pages had it worse: their route never calls `orderByRecipe` at all,
 * so no block ever carried a layout and the hero fell back to `centered` under
 * every archetype.
 *
 * The theme travels with the page and is saved whole, so reading the layout
 * from it makes a template switch take effect immediately — on pages that
 * already exist, with no re-stamping and no backfill.
 *
 * `styles.layout` is kept as the fallback rather than dropped: pages generated
 * before themes carried layouts have it, and it is the only thing they have.
 *
 * @param blockType   the block asking
 * @param themeLayouts the live theme's arrangement, if it has one
 * @param stampedLayout whatever was baked into the block's own styles
 */
export function resolveBlockLayout(
  blockType: string,
  themeLayouts: ThemeLayouts | undefined,
  stampedLayout: string | undefined
): string | undefined {
  const fromTheme = themeLayouts
    ? ({
        hero: themeLayouts.hero,
        services: themeLayouts.services,
        cta: themeLayouts.cta,
        gallery: themeLayouts.gallery,
        pricing: themeLayouts.pricing,
      } as Record<string, string | undefined>)[blockType]
    : undefined;

  return fromTheme ?? stampedLayout;
}

/**
 * Which composition a theme renders in, or null for "leave it alone".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY NULL IS A REAL ANSWER, AND WHY IT IS THE DEFAULT
 *
 * This returned `stone` for anything it could not place, which was wrong in the
 * most damaging possible way. Themes are stored whole, and every theme stored
 * before this field existed carries no `composition` — so EVERY live page fell
 * through to Stone. Stone's whole character is the absence of cards: it strips
 * a panel to a transparent hairline rule with no shadow and no radius. Applied
 * to a dark, card-built Lumen or Aster page, that is not a different design, it
 * is a stripped one.
 *
 * So the rule is now: a composition is applied only when the theme actually
 * names a design. Null means emit nothing and let the blocks render exactly as
 * they always have — which is the only safe answer for a page built before
 * compositions existed, because those blocks ARE its design.
 *
 * The caller resolves a missing field from the archetype id first; see
 * `compositionFor` in `components/public/compositions.ts`.
 */
export function resolveComposition(
  theme: { composition?: string } | null | undefined
): Composition | null {
  const c = theme?.composition;
  return (COMPOSITIONS as readonly string[]).includes(c ?? '') ? (c as Composition) : null;
}
