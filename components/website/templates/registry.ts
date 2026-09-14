/**
 * Which component draws a section, for a given template.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE MODEL
 *
 * A block is CONTENT and BEHAVIOUR. It knows what the section says, which
 * services it offers, what happens when someone clicks Book. It does not own how
 * any of that looks.
 *
 * A template owns PRESENTATION — all of it. The owner supplies an image, a name
 * and a bio; the template decides whether that is a square portrait in a row, a
 * circle in a bento, or a full-bleed crop. Stone lists offers as numbered ruled
 * rows; Bold lists the same offers as a two-up grid whose first card inverts.
 * Those are different markup, not the same markup in a different colour, which
 * is why a stylesheet layered over one fixed rendering could never get there.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY SHAPES RATHER THAN SIX COPIES OF EVERYTHING
 *
 * Twenty-one sections across six templates is a hundred and twenty cells, and
 * six hand-written copies of each section would be six places to fix every bug.
 *
 * The mockups themselves say that is not needed: Stone and Warm both list offers
 * as ruled rows and differ in the colour of the index; Bloom is Warm's structure
 * in blush. So a SHAPE is one arrangement of one section, and a template
 * declares which shape it uses. Where two templates agree they share the shape
 * and the stylesheet separates them; where they disagree — Bold's offer grid
 * against Stone's ruled list — they name different shapes.
 *
 * Adding a seventh template is then a row in TEMPLATES plus a stylesheet, and
 * only the sections it genuinely draws differently need new shapes.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS DELIBERATELY ABSENT
 *
 * Four sections are not here: booking_widget, process_flow, payment_button and
 * contact_form. Each carries real state — availability, a multi-step journey, a
 * payment intent, a submitting form — and re-implementing that per template
 * would be four more places for a booking to break. They keep their own
 * components and are dressed by the composition's stylesheet, which reaches
 * their fields, controls and panels the same way it reaches everything else.
 *
 * services and pricing are absent for a narrower reason: both already choose
 * between a rows and a cards rendering from theme.layouts, which is exactly the
 * choice a shape would make, and both own the booking handler. The template
 * still decides which of the two they use.
 *
 * @module components/website/templates/registry
 */

import type React from 'react';
import type { ArchetypeId, PageTheme } from '@/lib/website-builder/pageTheme';
import type { BlockRendererProps, BlockType } from '@/components/website/blocks/types';

import { HeaderSection } from './shapes/Header';
import { HeroSection } from './shapes/Hero';
import { AboutSection } from './shapes/About';
import { FeaturesSection } from './shapes/Features';
import { ProcessSection } from './shapes/Process';
import { GallerySection } from './shapes/Gallery';
import { TestimonialsSection } from './shapes/Testimonials';
import { StatsSection } from './shapes/Stats';
import { TeamSection } from './shapes/Team';
import { FAQSection } from './shapes/FAQ';
import { CTASection } from './shapes/CTA';
import { LogoCloudSection } from './shapes/LogoCloud';
import { VideoSection } from './shapes/Video';
import { NewsletterSection } from './shapes/Newsletter';
import { FooterSection } from './shapes/Footer';

type Renderer = React.ComponentType<BlockRendererProps>;

/**
 * The sections every template draws, and the shape each one uses.
 *
 * All six currently agree on which shape a section takes — what separates them
 * is the stylesheet, which is what the mockups show for these fifteen. The two
 * that genuinely diverge, services and pricing, diverge inside their own
 * components via theme.layouts, and the note above says why.
 *
 * When a template needs its own arrangement of a section, give it an entry in
 * OVERRIDES below rather than editing this.
 */
const SHAPES: Partial<Record<BlockType, Renderer>> = {
  header: HeaderSection,
  hero: HeroSection,
  about: AboutSection,
  features: FeaturesSection,
  process: ProcessSection,
  gallery: GallerySection,
  testimonials: TestimonialsSection,
  stats: StatsSection,
  team: TeamSection,
  faq: FAQSection,
  cta: CTASection,
  logo_cloud: LogoCloudSection,
  video: VideoSection,
  newsletter: NewsletterSection,
  footer: FooterSection,
};

/**
 * Where one template draws a section differently from the shared shape.
 *
 * Empty today and expected to stay small: a mockup that needs its own
 * arrangement gets an entry here, and everything it agrees about keeps coming
 * from SHAPES. This is the seam that lets Bloom, Lumen or Aster take over any
 * single section without forking the other fourteen.
 */
const OVERRIDES: Partial<Record<ArchetypeId, Partial<Record<BlockType, Renderer>>>> = {};

/** Every template that ships, so coverage can be asserted rather than assumed. */
export const TEMPLATES: readonly ArchetypeId[] = [
  'stone',
  'warm',
  'bloom',
  'bold',
  'lumen',
  'aster',
];

/** The sections a template draws itself, rather than the block drawing itself. */
export const TEMPLATE_SECTIONS = Object.keys(SHAPES) as BlockType[];

/**
 * The renderer for this section under this theme's template, or null to fall
 * back to the block drawing itself.
 *
 * Most specific first: an override for this exact template, then the shared
 * shape, then nothing. Null is the right answer for the four stateful sections
 * and for any theme that names no design at all — in both cases the block
 * renders exactly as it does today.
 */
export function templateRendererFor(
  theme: PageTheme | null | undefined,
  blockType: BlockType
): Renderer | null {
  const archetype = theme?.id as ArchetypeId | undefined;
  if (!archetype || !TEMPLATES.includes(archetype)) return null;

  return OVERRIDES[archetype]?.[blockType] ?? SHAPES[blockType] ?? null;
}
