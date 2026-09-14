/**
 * Which sections a page has, and in what order.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HARVESTED, NOT INVENTED
 *
 * `buildBlocks` emits the same eleven blocks at positions 0–10 for every
 * business on the platform, which is half of why every generated site reads the
 * same. The other half is the look, and that is the archetype's job.
 *
 * The four recipes below were read out of the 33 templates in `templates.ts`,
 * because that ordering work had already been done and was simply never
 * consulted at generation time. Parsing their block lists shows the patterns
 * plainly:
 *
 *   photographer  gallery third, in 4 of 4. Never any stats.
 *   consultant    services BEFORE about, stats early, no gallery in any of them
 *   lawyer        same, plus a closing cta in half
 *   therapist     about BEFORE services — warmth first, then what is on offer
 *   coach         same, with stats
 *   trainer       pricing present in 2 of 3, booking widget near the end
 *   tutor         pricing in every one
 *
 * Four recipes cover all nine verticals, because the question is never "what
 * trade is this" — it is *does the work photograph, and does the client need
 * proof or reassurance*.
 *
 * WHAT IS NOT HERE
 *
 * Whether a section has anything to say. `planSections` already answers that
 * from the data — no services means no services block, no real reviews means no
 * testimonials — and a recipe must not override it. A recipe proposes an order;
 * the data decides what survives.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/website-builder/recipes
 */

import type { BlockType } from '@/components/website/blocks/types';
import type { ArchetypeId, ThemeLayouts } from '@/lib/website-builder/pageTheme';

export type RecipeId = 'gallery_led' | 'proof_led' | 'story_led' | 'offer_led' | 'landing';

/**
 * Every recipe, as an ordered list of block types.
 *
 * `header` and `footer` open and close all of them: the 33 templates carry a
 * header and no footer at all, which is a gap in them rather than a decision —
 * `buildBlocks` has always emitted one.
 */
export const RECIPES: Record<RecipeId, readonly BlockType[]> = {
  /** The work is the argument, so it comes before the words. */
  gallery_led: [
    'header', 'hero', 'gallery', 'services', 'about', 'process',
    'testimonials', 'faq', 'contact_form', 'cta', 'footer',
  ],

  /** Credentials before warmth. Never a gallery — these clients want judgement. */
  proof_led: [
    'header', 'hero', 'stats', 'services', 'about', 'features', 'process',
    'faq', 'contact_form', 'cta', 'footer',
  ],

  /** Who you are, then what you offer. The order every therapist template uses. */
  story_led: [
    'header', 'hero', 'about', 'services', 'process', 'features',
    'testimonials', 'faq', 'booking_widget', 'contact_form', 'cta', 'footer',
  ],

  /** Sold rather than offered: numbers early, prices present, booking at the end. */
  offer_led: [
    'header', 'hero', 'stats', 'services', 'pricing', 'testimonials', 'process',
    'faq', 'booking_widget', 'contact_form', 'cta', 'footer',
  ],

  /**
   * A landing page is one offer, not a business.
   *
   * No about and no process — a visitor who followed an ad has not asked who
   * you are, and every section between them and the price is a place to leave.
   */
  landing: ['header', 'hero', 'features', 'pricing', 'faq', 'cta', 'contact_form', 'footer'],
};

/**
 * Vertical to recipe.
 *
 * The ONE place a vertical is named. No block component and no theme emitter
 * knows what a photographer is — a vertical reaches the renderer as a recipe id
 * and nothing else, which is what stops trade-specific rules leaking into the
 * rendering layer the way they leaked into the prompt.
 *
 * Read off the 33 templates: these are the orders they already used.
 */
const RECIPE_BY_VERTICAL: Record<string, RecipeId> = {
  photographer: 'gallery_led',
  designer: 'gallery_led',
  beauty: 'gallery_led',

  consultant: 'proof_led',
  lawyer: 'proof_led',
  accountant: 'proof_led',
  realtor: 'proof_led',

  therapist: 'story_led',
  psychologist: 'story_led',
  counselor: 'story_led',
  coach: 'story_led',
  wellness: 'story_led',

  trainer: 'offer_led',
  fitness: 'offer_led',
  tutor: 'offer_led',
  teacher: 'offer_led',
};

/**
 * Vertical to archetype — which LOOK a business is shown first.
 *
 * Beside the recipe map on purpose. A vertical answers exactly two questions in
 * this system — what order the sections go in, and which of the four looks suits
 * the trade — and keeping both answers in one file is what makes "the one place
 * a vertical is named" literally true. Split across two modules, the next person
 * adding a trade updates one and not the other.
 *
 * This is a RECOMMENDATION and nothing more. The owner picks in the wizard, and
 * whatever they pick is stored on the page; this only decides which card is
 * pre-selected on a first run.
 */
const ARCHETYPE_BY_VERTICAL: Record<string, ArchetypeId> = {
  // Quiet and type-led, for anyone selling judgement.
  consultant: 'stone',
  lawyer: 'stone',
  accountant: 'stone',
  realtor: 'stone',

  // Warm, for anyone whose client arrives anxious.
  therapist: 'bloom',
  psychologist: 'bloom',
  counselor: 'bloom',
  wellness: 'bloom',
  coach: 'bloom',

  // Dark and image-led, where the work itself is the argument.
  photographer: 'lumen',
  designer: 'lumen',
  beauty: 'lumen',

  // High contrast and product-shaped, for anything sold rather than offered.
  trainer: 'aster',
  fitness: 'aster',
  tutor: 'aster',
  teacher: 'aster',

  // Editorial, for anyone whose client is buying a considered opinion and
  // expects to read before they book.
  clinic: 'warm',
  nutritionist: 'warm',
  writer: 'warm',
  editor: 'warm',

  // Loud, for a trade sold with urgency and a visible price.
  gym: 'bold',
  trades: 'bold',
  contractor: 'bold',
  studio: 'bold',
};

/**
 * The look to show first, for a trade.
 *
 * Falls back to Stone, which is the platform default: it is the only one of the
 * six with no accent colour at all, so it is the least wrong thing to put in
 * front of a business we cannot place.
 *
 * This is now consulted by website GENERATION as well as by the templates
 * listing. It used to be read only by the listing endpoint, which sorted one
 * card to the front with it — so the recommendation was visible in the gallery
 * and had no effect on anything actually built.
 */
export function recommendArchetypeId(vertical: string | null | undefined): ArchetypeId {
  if (!vertical) return 'stone';
  return ARCHETYPE_BY_VERTICAL[vertical] ?? 'stone';
}

/**
 * Stone's own register, and the safest thing to be wrong with.
 *
 * `story_led` is the most forgiving order for a business we cannot place: it
 * explains before it sells, which reads as considered rather than pushy for
 * every trade, whereas leading with a gallery is actively wrong for anyone
 * whose work does not photograph.
 */
export const DEFAULT_RECIPE: RecipeId = 'story_led';

export function recipeIdFor(
  vertical: string | null | undefined,
  pageType?: string | null
): RecipeId {
  // The page type wins outright. A landing page for a therapist is still a
  // landing page — one offer, no biography.
  if (pageType === 'landing') return 'landing';
  if (!vertical) return DEFAULT_RECIPE;
  return RECIPE_BY_VERTICAL[vertical] ?? DEFAULT_RECIPE;
}

/** The ordered block list for a business. */
export function recipeFor(
  vertical: string | null | undefined,
  pageType?: string | null
): readonly BlockType[] {
  return RECIPES[recipeIdFor(vertical, pageType)];
}

/**
 * Put the blocks in the recipe's order, and tell each one how to draw itself.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A SEPARATE PASS
 *
 * `buildBlocks` is two hundred lines of content construction — what the hero
 * says, which button the CTA carries, how a service becomes a row. That work
 * is right and none of it needed to change. What was wrong is that the same
 * function also fixed the ORDER, by writing `position: 0` through
 * `position: 10` into the literals. So the order could not vary without
 * touching every branch of the content logic.
 *
 * Reordering afterwards keeps the two apart: the recipe decides sequence, the
 * builder decides substance, and neither has to know about the other.
 *
 * NOTHING IS DROPPED. A block the recipe does not mention is appended rather
 * than discarded — the builder only ever produces a block because something
 * in the data asked for it, and silently binning one would be a section a
 * business filled in and never saw again.
 * ───────────────────────────────────────────────────────────────────────────
 *
 * @param blocks  what `buildBlocks` produced, in whatever order
 * @param recipe  the order this business's sections should appear in
 * @param layouts the archetype's layout names, written onto each block
 */
export function orderByRecipe(
  blocks: any[],
  recipe: readonly BlockType[],
  layouts?: ThemeLayouts,
): any[] {
  const remaining = [...blocks];
  const ordered: any[] = [];

  for (const blockType of recipe) {
    const index = remaining.findIndex(block => block.block_type === blockType);
    if (index === -1) continue;
    ordered.push(remaining.splice(index, 1)[0]);
  }

  /*
   * Anything the recipe did not name, in the order the builder made it — but
   * ABOVE the footer.
   *
   * Every recipe ends with the footer, so a plain append put unnamed sections
   * after it. That is not a cosmetic ordering problem: a Team or Video section
   * an owner adds by hand is a section the recipe has never heard of, and it
   * landed below the copyright line where nobody scrolls. The sections most
   * likely to be added by hand are exactly the ones no recipe names.
   */
  const footerIndex = ordered.findIndex(block => block.block_type === 'footer');
  if (footerIndex === -1) {
    ordered.push(...remaining);
  } else {
    ordered.splice(footerIndex, 0, ...remaining);
  }

  return ordered.map((block, position) => ({
    ...block,
    position,
    /*
     * The layout name, for the five blocks that switch on one.
     *
     * Merged into whatever `styles` the builder already set rather than
     * replacing it: `padding`, `background` and `alignment` are the builder's
     * to decide per block, and only `layout` belongs to the archetype.
     *
     * A block type with no layout in the vocabulary gets none, and renders in
     * its own default — which is what every block did before this existed.
     */
    styles: {
      ...(block.styles ?? {}),
      ...(layouts ? layoutFor(block.block_type, layouts) : {}),
    },
  }));
}

/**
 * The archetype's layout name for one block type, if it has one.
 *
 * Five block types carry a variant; the other sixteen change appearance
 * through the tokens alone and need nothing here.
 */
function layoutFor(blockType: string, layouts: ThemeLayouts): { layout?: string } {
  const byType: Record<string, string | undefined> = {
    hero: layouts.hero,
    services: layouts.services,
    cta: layouts.cta,
    gallery: layouts.gallery,
    pricing: layouts.pricing,
  };

  const layout = byType[blockType];
  return layout ? { layout } : {};
}
