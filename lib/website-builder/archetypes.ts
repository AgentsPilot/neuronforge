/**
 * The six looks, as data.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY SIX, AND WHY THEY ARE PLAIN OBJECTS
 *
 * Thirty-three templates existed and every generated site looked the same. Each
 * one nominated three hex values and a font name — which is not a design, and
 * the font never rendered anyway. Meanwhile the generation prompt asked the
 * model to *"choose theme colors appropriate for the vertical"*, so the palette
 * varied per generation with no system behind it: no consistency AND no
 * quality.
 *
 * Four covered the two axes that actually separate small-business sites — quiet
 * against bold, type-led against image-led. Six exists because those four were
 * only ever TOKENS: the same markup in a new palette, which is what every owner
 * who switched template actually saw.
 *
 * What was missing is structure, and structure is the half worth sharing. Each
 * archetype now names a COMPOSITION — the bones its sections are built on — and
 * three compositions dress all six: Bloom wears Warm's bones in blush, Lumen and
 * Aster wear Bold's in lime and indigo. So the two additions are not two more
 * palettes competing with the originals; they are the two structures the
 * originals had no way to express.
 *
 * They are objects rather than code because nothing here needs to be code: every
 * value below was read off a real template's compiled stylesheet or its mockup,
 * and a seventh archetype is thirty more values and a composition it reuses, not
 * a deploy.
 *
 * WHAT WE TOOK, AND WHAT WE OWE
 *
 * Four of the six are MIT templates. Warm and Bold are not: they were drawn for
 * this platform, owe nobody an attribution, and say so in `source` rather than
 * borrowing a notice they have no right to.
 *
 * For the four that were taken: palette, type stack, radii and the layout names
 * — the design decisions. Not
 * their code, their content or their framework; three of the four are Astro
 * projects whose components could not drop into a React block if we wanted them
 * to. All four are MIT, which permits commercial use and modification and asks
 * one thing in return: that the copyright notice travels with the work. That is
 * what `source` is for, and it is reproduced in `LICENSES.md`.
 *
 * HEBREW IS SUBSTITUTED, NOT TRANSLATED
 *
 * Montserrat and Josefin Sans carry no Hebrew glyphs at all. An archetype names
 * the Hebrew face it was designed against — Rubik for Montserrat, Varela Round
 * for Josefin — so a Hebrew page keeps the character of the original instead of
 * falling back per glyph and rendering one paragraph in two faces.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/website-builder/archetypes
 */

import type { ArchetypeId, PageTheme } from '@/lib/website-builder/pageTheme';

/**
 * Quiet, type-led, and the only one with no accent colour at all.
 *
 * Source: `m6v3l9/astro-theme-stone`. Its rules, read off the stylesheet: the
 * Tailwind stone scale and nothing else, one typeface (Inter, every weight),
 * 24px panels with pill controls, and sections numbered `01 / 02 / 03`.
 *
 * Suits consultants, lawyers, accountants, coaches — anyone whose client is
 * looking for judgement rather than pictures.
 */
export const STONE: PageTheme = {
  id: 'stone',
  composition: 'stone',
  source: 'm6v3l9/astro-theme-stone · MIT',
  colors: {
    primary: '#0C0A09',
    secondary: '#57534E',
    accent: '#78716C',
    background: '#FFFFFF',
    surface: '#F5F5F4',
    text: '#0C0A09',
    textSecondary: '#57534E',
  },
  fonts: { heading: 'Inter', body: 'Inter', hebrewHeading: 'Assistant', hebrewBody: 'Assistant' },
  scale: {
    h1: 'clamp(32px, 5cqi, 64px)',
    h2: 'clamp(26px, 3.2cqi, 42px)',
    h3: '21px',
    body: '16.5px',
    small: '13px',
  },
  borderRadius: '24px',
  spacing: 'spacious',
  layouts: { hero: 'stacked', services: 'rows', cta: 'panel', gallery: 'grid', pricing: 'panels' },
};

/**
 * Dark and image-led: the work is the argument, so it comes before the words.
 *
 * Source: `Gothsec/dark-minimal`. Near-black with an acid lime and a violet,
 * Montserrat, and 30px radii — the largest of the four, which is most of why it
 * reads as recent.
 *
 * Suits photographers, designers, studios.
 */
export const LUMEN: PageTheme = {
  id: 'lumen',
  composition: 'bold',
  source: 'Gothsec/dark-minimal · MIT',
  colors: {
    primary: '#A9FF5B',
    secondary: '#A476FF',
    accent: '#A476FF',
    background: '#141414',
    surface: '#1C1C1C',
    text: '#FFFFFF',
    textSecondary: '#9E9E9E',
  },
  fonts: { heading: 'Montserrat', body: 'Montserrat', hebrewHeading: 'Rubik', hebrewBody: 'Rubik' },
  scale: {
    h1: 'clamp(32px, 5cqi, 58px)',
    h2: 'clamp(26px, 3.4cqi, 40px)',
    h3: '20px',
    body: '16.5px',
    small: '13px',
  },
  borderRadius: '30px',
  spacing: 'normal',
  layouts: { hero: 'stacked', services: 'cards', cta: 'flat', gallery: 'mosaic', pricing: 'panels' },
};

/**
 * Warm and soft, and the only one that is not black on white or white on black.
 *
 * Source: `ttomczak3/Milky-Way`. Blush, mint and plum with a rounded geometric
 * face — the palette a parent or a patient reads as unthreatening.
 *
 * Suits therapy, wellness, parenting, anything with children in it.
 */
export const BLOOM: PageTheme = {
  id: 'bloom',
  composition: 'warm',
  source: 'ttomczak3/Milky-Way · MIT',
  colors: {
    primary: '#78C2AD',
    secondary: '#FDEBF3',
    accent: '#584966',
    background: '#FFF9FB',
    surface: '#FFFFFF',
    text: '#3E3350',
    textSecondary: '#7A6C88',
  },
  fonts: {
    heading: 'Josefin Sans',
    body: 'Assistant',
    hebrewHeading: 'Varela Round',
    hebrewBody: 'Assistant',
  },
  scale: {
    h1: 'clamp(29px, 4.4cqi, 50px)',
    h2: 'clamp(24px, 2.8cqi, 34px)',
    h3: '19px',
    body: '16.5px',
    small: '13px',
  },
  borderRadius: '26px',
  spacing: 'normal',
  layouts: { hero: 'split', services: 'cards', cta: 'panel', gallery: 'grid', pricing: 'panels' },
};

/**
 * Bold and high contrast — the one that wants to look like a product.
 *
 * Source: `matt765/Tailcast`. Indigo on charcoal, the smallest radii of the
 * four (14px), and the heaviest headings.
 *
 * Suits fitness, trainers, courses, anything sold rather than offered.
 */
export const ASTER: PageTheme = {
  id: 'aster',
  composition: 'bold',
  source: 'matt765/Tailcast · MIT',
  colors: {
    primary: '#6366F1',
    secondary: '#C8C9F8',
    accent: '#A1A3F7',
    background: '#1A1B21',
    surface: '#23242C',
    text: '#FFFFFF',
    textSecondary: '#9B9CAE',
  },
  fonts: { heading: 'Fraunces', body: 'Inter', hebrewHeading: 'Heebo', hebrewBody: 'Heebo' },
  scale: {
    h1: 'clamp(31px, 5cqi, 56px)',
    h2: 'clamp(26px, 3.2cqi, 38px)',
    h3: '19px',
    body: '16.5px',
    small: '12.5px',
  },
  borderRadius: '14px',
  spacing: 'normal',
  layouts: { hero: 'centered', services: 'cards', cta: 'panel', gallery: 'grid', pricing: 'panels' },
};

/**
 * Paper, ink and a serif — the one that reads as written rather than built.
 *
 * Drawn for this platform, not adapted from a template. Warm paper (#FBF7F1)
 * under Frank Ruhl Libre headings, a violet that appears once per screen, and a
 * bento grid where the others run cards. The serif is the whole argument: it is
 * the only face in the set that carries authorship, and Frank Ruhl Libre carries
 * Hebrew natively — so a Hebrew page keeps the character instead of substituting
 * it, which none of the borrowed four can claim.
 *
 * Suits editors, writers, clinics, consultancies — anyone whose client is buying
 * a considered opinion.
 */
export const WARM: PageTheme = {
  id: 'warm',
  composition: 'warm',
  source: 'AgentPilot original',
  colors: {
    primary: '#6D28D9',
    secondary: '#5B5147',
    accent: '#6D28D9',
    background: '#FBF7F1',
    surface: '#FFFFFF',
    text: '#17130F',
    textSecondary: '#5B5147',
  },
  fonts: {
    heading: 'Frank Ruhl Libre',
    body: 'Assistant',
    hebrewHeading: 'Frank Ruhl Libre',
    hebrewBody: 'Assistant',
  },
  scale: {
    h1: 'clamp(34px, 4.6cqi, 62px)',
    h2: 'clamp(26px, 3.1cqi, 40px)',
    h3: '20px',
    body: '16.5px',
    small: '13px',
  },
  borderRadius: '18px',
  spacing: 'spacious',
  // Warm lists its offers as ruled rows, not cards — see `warm-archetype.html`.
  // The cells in that mockup are the ABOUT section, not the offer list.
  layouts: { hero: 'split', services: 'rows', cta: 'panel', gallery: 'grid', pricing: 'panels' },
};

/**
 * Night and flame — the loudest of the six, and the only one with a mono face.
 *
 * Drawn for this platform. Near-black (#141416) with a flame orange used as a
 * signal rather than a decoration: it marks the one thing on each screen the
 * visitor is meant to do. IBM Plex Mono carries the small print — prices, steps,
 * labels — which is what keeps the loudness from reading as shouting.
 *
 * Suits trades, gyms, studios, courses — anything sold with urgency.
 */
export const BOLD: PageTheme = {
  id: 'bold',
  composition: 'bold',
  source: 'AgentPilot original',
  colors: {
    primary: '#FC5F2B',
    secondary: '#A1A1AA',
    accent: '#FC5F2B',
    background: '#141416',
    surface: '#1D1D20',
    text: '#F7F5F0',
    textSecondary: '#A1A1AA',
  },
  fonts: { heading: 'Assistant', body: 'Assistant', hebrewHeading: 'Assistant', hebrewBody: 'Assistant' },
  scale: {
    h1: 'clamp(36px, 5.4cqi, 70px)',
    h2: 'clamp(28px, 3.6cqi, 48px)',
    h3: '19px',
    body: '16.5px',
    small: '12.5px',
  },
  borderRadius: '14px',
  spacing: 'normal',
  layouts: { hero: 'split', services: 'cards', cta: 'panel', gallery: 'mosaic', pricing: 'panels' },
};

/** Every archetype that ships in the repo, in the order the gallery shows them. */
export const ARCHETYPES: readonly PageTheme[] = [STONE, WARM, BLOOM, BOLD, LUMEN, ASTER];

/**
 * The one a business gets when nothing else says otherwise.
 *
 * Stone, because it is the only one with no accent colour: it is the hardest to
 * make look wrong with someone else's content, which is exactly what a default
 * has to be.
 */
export const DEFAULT_ARCHETYPE: PageTheme = STONE;

const BY_ID = new Map<string, PageTheme>(ARCHETYPES.map(a => [a.id as string, a]));

/** Null for an unknown id — the caller decides whether that is a fallback or a fault. */
export function getArchetype(id: string | null | undefined): PageTheme | null {
  if (!id) return null;
  return BY_ID.get(id) ?? null;
}

export function isArchetypeId(id: string | null | undefined): id is ArchetypeId {
  return Boolean(id && BY_ID.has(id));
}
