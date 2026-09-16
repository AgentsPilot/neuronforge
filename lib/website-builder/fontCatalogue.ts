/**
 * The typefaces an owner may choose, and whether each one can set Hebrew.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * The Design tab offered six heading faces and six body faces, written out as
 * literal `<SelectItem>`s. Not one of them was a face any template actually
 * uses. So a business on Bloom — heading set in Josefin Sans — opened the tab
 * and saw an empty dropdown: Radix has no item whose value is "Josefin Sans",
 * so it falls through to the placeholder. The font was saved correctly and was
 * rendering correctly on the live site; the control simply could not describe
 * it, which reads as "my choice was lost".
 *
 * Deriving the list from `ARCHETYPES` is what stops that recurring. A seventh
 * archetype introducing a seventh face gets it into both dropdowns without
 * anyone remembering to add it here.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY HEBREW COVERAGE IS PART OF THE DATA
 *
 * Most of the popular Latin faces on Google Fonts have no Hebrew glyphs at all.
 * Picking one is not a small compromise for a Hebrew-speaking business — every
 * heading silently falls back to a system face, and the page stops looking like
 * the template it is wearing.
 *
 * The archetypes already encode this: `theme.fonts.hebrewHeading` exists ONLY
 * where the Latin heading face carries no Hebrew (see `lib/branding/theme.ts`),
 * and `PublicThemeStyle` swaps to it when the page is Hebrew. That makes the
 * archetypes a source of truth for coverage, and it is read as one below rather
 * than restated by hand.
 *
 * @module lib/website-builder/fontCatalogue
 */

import { ARCHETYPES } from '@/lib/website-builder/archetypes';

export interface FontChoice {
  /** The Google Fonts family name, exactly as the stylesheet wants it. */
  family: string;
  /** Whether this face can set Hebrew without falling back. */
  hebrew: boolean;
}

/**
 * Faces that carry Hebrew.
 *
 * Checked against Google Fonts' own subset listings. Kept as a set rather than
 * a flag on each entry so the archetype-derived entries below can be classified
 * by the same rule as the curated ones.
 */
const HEBREW_CAPABLE = new Set([
  'Assistant',
  'Heebo',
  'Rubik',
  'Varela Round',
  'Frank Ruhl Libre',
  'Secular One',
  'Suez One',
  'David Libre',
  'Alef',
  'Miriam Libre',
  'Noto Sans Hebrew',
  'Noto Serif Hebrew',
  'Arimo',
  'Open Sans',
]);

/**
 * Faces worth offering beyond what the templates already use.
 *
 * Deliberately short. A hundred families is not a richer choice, it is a
 * decision an owner cannot make — and every one of them costs a download on
 * every page load. These are the ones that pair well with the six templates and
 * read cleanly at heading and body size.
 */
const CURATED_HEADING = [
  'Inter',
  'Assistant',
  'Heebo',
  'Rubik',
  'Montserrat',
  'Poppins',
  'Playfair Display',
  'Lora',
  'Merriweather',
  'Secular One',
];

const CURATED_BODY = [
  'Inter',
  'Assistant',
  'Heebo',
  'Rubik',
  'Open Sans',
  'Lato',
  'Nunito',
  'Roboto',
  'Arimo',
];

/**
 * Every face any template sets, in either script.
 *
 * Both the Latin face and its Hebrew stand-in: an owner who wants their whole
 * site in Assistant should be able to say so directly, not only by picking a
 * template that happens to fall back to it.
 */
function archetypeFaces(which: 'heading' | 'body'): string[] {
  return ARCHETYPES.flatMap(theme => {
    const fonts = theme.fonts as Record<string, string | undefined>;
    return which === 'heading'
      ? [fonts.heading, fonts.hebrewHeading]
      : [fonts.body, fonts.hebrewBody];
  }).filter((family): family is string => Boolean(family));
}

function catalogue(curated: string[], which: 'heading' | 'body'): FontChoice[] {
  const families = [...new Set([...curated, ...archetypeFaces(which)])];
  return families
    .map(family => ({ family, hebrew: HEBREW_CAPABLE.has(family) }))
    // Hebrew-capable first: for a business writing in Hebrew the others are not
    // really choices, and for one writing in English the ordering costs nothing.
    .sort((a, b) => Number(b.hebrew) - Number(a.hebrew) || a.family.localeCompare(b.family));
}

export const HEADING_FONTS: FontChoice[] = catalogue(CURATED_HEADING, 'heading');
export const BODY_FONTS: FontChoice[] = catalogue(CURATED_BODY, 'body');

/** Whether a family can set Hebrew without falling back to a system face. */
export function carriesHebrew(family: string | undefined | null): boolean {
  return Boolean(family && HEBREW_CAPABLE.has(family.trim()));
}

/**
 * The catalogue, guaranteed to contain what is currently saved.
 *
 * A theme edited by hand, restored from an older template, or set by a future
 * archetype can name a face this list has never heard of. Without this the
 * control would show a placeholder and the owner's next save would silently
 * replace their font with whatever they picked to make the empty box go away —
 * the original bug, in a narrower form.
 */
export function fontChoicesWith(choices: FontChoice[], current: string | undefined | null): FontChoice[] {
  const family = current?.trim();
  if (!family || choices.some(choice => choice.family === family)) return choices;
  return [{ family, hebrew: HEBREW_CAPABLE.has(family) }, ...choices];
}

/** Every family in both lists — what the picker has to load to show itself. */
export function allCatalogueFamilies(extra: Array<string | undefined | null> = []): string[] {
  return [
    ...new Set([
      ...HEADING_FONTS.map(choice => choice.family),
      ...BODY_FONTS.map(choice => choice.family),
      ...extra.map(family => family?.trim()).filter((family): family is string => Boolean(family)),
    ]),
  ];
}

/**
 * A family name as a usable CSS stack.
 *
 * The fallback is what renders while the webfont loads, and what renders
 * forever if the face has no glyph for the script in front of it — which is the
 * whole point of showing a Hebrew sample next to a Latin one.
 */
export function fontStack(family: string): string {
  return `"${family}", system-ui, sans-serif`;
}

/**
 * What each row shows the face doing.
 *
 * Both scripts, always, rather than the reader's own: the owner is choosing for
 * their CLIENTS, and a Hebrew business whose site also serves English speakers
 * needs to see both before committing. Where a face has no Hebrew the sample
 * renders in the fallback, which is exactly the information being asked for.
 */
export const FONT_SAMPLES = {
  latin: 'Handcrafted Aa',
  hebrew: 'עיצוב מוקפד',
} as const;
