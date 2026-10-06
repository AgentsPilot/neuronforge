/**
 * What a section is called when something links to it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT INSIDE THE RENDERER
 *
 * `WebsiteBlocks` stamps each section's wrapper with one of these ids, and a
 * generated button carries `#about` or `#booking` expecting to land on it. Two
 * halves of one contract — and the renderer held the only copy, inside a
 * `'use client'` module, so nothing that WRITES a link could consult it.
 *
 * Every generator therefore spelled the destinations by hand. They agree today;
 * the first renaming, or the first new section type, is where they stop
 * agreeing, and the symptom is a button that scrolls nowhere — silent, because
 * a browser asked to jump to an id that does not exist simply does nothing.
 *
 * One definition, imported by the renderer and by the link check that guards
 * what the generators produce.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/website-builder/sectionAnchors
 */

/**
 * The sections with an anchor of their own.
 *
 * Deliberately not every block type: `newsletter`, `logo_cloud` and `video` are
 * passed through by the fallback below, which is the behaviour the renderer
 * already had.
 */
const SECTION_ANCHOR: Record<string, string> = {
  hero: 'hero',
  about: 'about',
  services: 'services',
  pricing: 'pricing',
  testimonials: 'testimonials',
  faq: 'faq',
  // The one that is not its own name: the section is a contact FORM, and every
  // generated menu has always written `#contact`.
  contact_form: 'contact',
  booking_widget: 'booking',
  process: 'process',
  team: 'team',
  features: 'features',
  gallery: 'gallery',
  cta: 'cta',
  stats: 'stats',
  footer: 'footer',
};

/** The id this section's wrapper carries on the page. */
export function anchorForBlockType(blockType: string): string {
  return SECTION_ANCHOR[blockType] || blockType.replace('_', '-');
}

/**
 * Every anchor a link on this page could legitimately point at.
 *
 * A DISABLED section is not on the page — the renderer filters it out before it
 * stamps any ids — so a link to one is as dead as a link to a section that was
 * never generated.
 */
export function pageAnchors(
  blocks: Array<{ block_type: string; enabled?: boolean | null }>
): Set<string> {
  return new Set(
    blocks
      .filter(block => block.enabled !== false)
      .map(block => anchorForBlockType(block.block_type))
  );
}
