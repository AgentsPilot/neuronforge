/**
 * Homepage structure, and the designs that stored template ids resolve to.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE USED TO BE
 *
 * Thirty-three website templates across 2,689 lines — and every generated site
 * looked the same. Each template nominated three hex values, a font name and a
 * block list. The font never rendered, because every public surface hardcoded
 * Heebo at the front of the stack; the block list was never consulted, because
 * the generator emitted the same eleven sections at the same positions for
 * everyone. So a photographer and a lawyer picked from different galleries and
 * got the same page in a different accent colour.
 *
 * The three things a template claimed to supply now come from somewhere that
 * actually supplies them:
 *
 *   the look      an archetype   `lib/website-builder/archetypes.ts`
 *   the sections  a recipe       `lib/website-builder/recipes.ts`
 *   the words     the model, per business
 *
 * What remains is the part that was always real: the fixed homepage structure,
 * and the map from every template id ever stored to the design it now wears.
 *
 * WHY THE MAP CANNOT BE DELETED TOO
 *
 * `template_id` is persisted on `business_profiles` and on `website_pages`, so
 * every id in it is live on somebody's account and has to keep resolving.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/website-builder/templates
 */

import type { PageTheme } from '@/lib/repositories/WebsitePageRepository';
import type { ArchetypeId } from '@/lib/website-builder/pageTheme';
import { DEFAULT_ARCHETYPE, getArchetype } from '@/lib/website-builder/archetypes';
import {
  HeaderBlock,
  HeroBlock,
  ServicesBlock,
  CTABlock,
  ContactFormBlock,
  TestimonialsBlock,
  FAQBlock,
  AboutBlock,
  ProcessBlock,
  FooterBlock,
  type BuildingBlock
} from './building-blocks';

/**
 * Standard homepage block structure used by ALL templates.
 * This defines WHICH sections exist - content comes from website_content table.
 * Templates only change the visual styling (theme), not the structure.
 */
export function getStandardHomepageBlocks(): BuildingBlock[] {
  return [
    // 1. Header - Navigation (4 main sections: About, Services, Process, Contact)
    HeaderBlock.standard({
      logo_text: 'Your Business',
      menu_items: [
        { label: 'About', anchor: '#about' },
        { label: 'Services', anchor: '#services' },
        { label: 'Process', anchor: '#process' },
        { label: 'Contact', anchor: '#contact' }
      ],
      // `#services`, not `#booking`: this scaffold no longer installs a booking
      // section, and the booking now starts from each service's own button.
      cta_button: { text: 'Book Now', link: '#services' },
      style: 'blur'
    }),

    // 2. Hero - Main headline and CTA
    HeroBlock.warm({
      name: 'Your Business',
      tagline: 'Professional Services for Your Needs',
      cta: 'Get Started'
    }),

    // 3. About - Business story/bio
    AboutBlock.withImage({
      title: 'About',
      content: 'Tell your story here. Share your background, expertise, and what makes you unique.'
    }),

    // 4. Services - What you offer (content from Scheduling capability)
    ServicesBlock.grid([
      { name: 'Service 1', description: 'Description of your first service', icon: 'Star' },
      { name: 'Service 2', description: 'Description of your second service', icon: 'Star' },
      { name: 'Service 3', description: 'Description of your third service', icon: 'Star' }
    ]),

    // 5. Process - How it works
    // NOTE: Steps are PLACEHOLDERS - they get replaced by:
    // 1. User-defined steps from business_profiles.process_steps (if set)
    // 2. Auto-generated steps from user's active capabilities (CRM, Scheduling, Payments, etc.)
    // These placeholders only show if neither of the above exist
    ProcessBlock.numbered([
      { title: 'Step 1', description: 'Define your first step' },
      { title: 'Step 2', description: 'Define your second step' },
      { title: 'Step 3', description: 'Define your third step' }
    ]),

    // 6. Testimonials - Social proof, empty until the business has some.
    //
    // This shipped two invented reviews — "Amazing experience!" from "Client
    // Name" and "Another Client" — straight onto the site of a business that had
    // never had a client. They are what the reported live site is showing.
    // The section stays so it can be filled; the quotes go.
    TestimonialsBlock.carousel([]),

    // 7. FAQ - Common questions
    FAQBlock.accordion([
      { question: 'What should I expect?', answer: 'Answer to your frequently asked question.' },
      { question: 'How do I get started?', answer: 'Simply book a consultation to get started.' }
    ]),

    // Booking is NOT a default section.
    //
    // A page-level calendar cannot express what the services now decide for
    // themselves: one service is booked against a time and another is a
    // download, and an inline widget offers the same appointment for both. The
    // services section already gives each service its own button, resolved from
    // that service's journey. Anyone who wants a standalone calendar can add
    // the section; it is no longer installed on every site that happens to sell
    // one bookable thing.

    // 9. Contact Form - Get in touch
    ContactFormBlock.standard({
      title: 'Get in Touch',
      email: 'contact@yourbusiness.com',
      phone: '+1 (555) 123-4567'
    }),

    /*
     * 10. The close.
     *
     * Every recipe has ended `… cta, footer` since recipes existed, and this
     * scaffold emitted neither — so a page created from a template stopped dead
     * after the contact form. The closing block is the one section whose entire
     * job is to ask, and in all six designs it is the loudest thing on the page.
     */
    CTABlock.primary({
      title: 'Ready to start?',
      description: 'Book a first conversation and we will take it from there.',
      button_text: 'Get started'
    }),

    // 11. Footer
    FooterBlock.standard({
      company_name: 'Your Business',
      email: 'contact@yourbusiness.com',
      phone: '+1 (555) 123-4567'
    })
  ];
}

/**
 * Every template id that was ever stored, and the design it now wears.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * `template_id` is persisted on `business_profiles` and on `website_pages`, so
 * every id below is live on somebody's account and must keep resolving. What it
 * resolves TO is now one of the four archetypes rather than the three hex
 * values the template nominated — which is the entire point of the change:
 * thirty-three templates that differed only in accent colour become four
 * designs that differ in palette, typeface, type scale, corner radius and
 * layout.
 *
 * Assigned from the template's own `vertical` and `brand_voice`, which is the
 * closest thing the old catalogue had to a design intent:
 *
 *   warm                      → Bloom   soft, for a client who arrives anxious
 *   professional / minimal    → Stone   quiet, for anyone selling judgement
 *   bold                      → Aster   high contrast, for anything sold
 *   elegant / creative + image→ Lumen   dark and image-led
 *
 * A business that had customised its own colours keeps them: `completeTheme`
 * layers what it stored over this, key by key.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const LEGACY_TEMPLATE_ARCHETYPE: Record<string, ArchetypeId> = {
  therapist_warm_welcoming: 'bloom',
  therapist_professional_clinical: 'stone',
  therapist_modern_minimal: 'stone',
  therapist_specialized_trauma: 'bloom',

  coach_inspiring_transformation: 'aster',
  coach_professional_executive: 'stone',
  coach_wellness_mindfulness: 'bloom',
  coach_career_transition: 'aster',

  consultant_professional_services: 'stone',
  consultant_tech_advisory: 'aster',
  consultant_marketing_agency: 'lumen',
  consultant_financial_advisory: 'stone',

  lawyer_professional_firm: 'stone',
  lawyer_personal_injury: 'aster',
  lawyer_family_law: 'bloom',
  lawyer_criminal_defense: 'aster',

  // The image trades. Lumen where the work is the argument, Bloom where the
  // subject is a person at an emotional moment.
  photographer_portfolio_minimal: 'lumen',
  photographer_wedding: 'bloom',
  photographer_commercial: 'lumen',
  photographer_portrait: 'bloom',

  realtor_luxury: 'stone',
  realtor_family_homes: 'bloom',
  realtor_commercial: 'stone',
  realtor_first_time_buyers: 'bloom',

  trainer_gym_fitness: 'aster',
  trainer_wellness_coach: 'bloom',
  trainer_sports_performance: 'aster',

  tutor_academic: 'stone',
  tutor_test_prep: 'aster',
  tutor_language: 'bloom',

  beauty_glamour_studio: 'lumen',
  beauty_modern_salon: 'lumen',
  beauty_natural_aesthetics: 'bloom',
};

/**
 * The design behind an id — whichever kind of id it is.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ONE PLACE THAT RESOLVES A STORED `template_id`
 *
 * Two kinds of id reach the same columns:
 *
 *   'stone' | 'bloom' | 'lumen' | 'aster'   an archetype, chosen in the wizard
 *   'therapist_warm_welcoming' | …          a legacy template, chosen before
 *
 * Four call sites used to validate an id by looking it up in the template
 * catalogue and refusing anything it did not know, which would have rejected
 * every archetype the wizard now sends — a 400 on save, and a silent no-op on
 * the business theme.
 *
 * Answering null means the id names nothing, which is still worth refusing.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Note: this resolves the four archetypes that ship in the repo. One added as a
 * database row resolves through `ArchetypeRepository`, which is async — used by
 * `setBusinessTemplate`, where it matters, since that is what writes a
 * business's stored theme in the first place.
 */
export function themeForTemplateId(id: string | null | undefined): PageTheme | null {
  const archetype = getArchetype(id);
  if (archetype) return archetype;

  const legacy = id ? LEGACY_TEMPLATE_ARCHETYPE[id] : undefined;
  if (!legacy) return null;

  // A mapped id always names one of the four, so the fallback is unreachable —
  // it is here so a typo in the map above degrades to Stone rather than to null,
  // which a caller would read as "this business chose nothing".
  return getArchetype(legacy) ?? DEFAULT_ARCHETYPE;
}

/** Whether an id names a design at all — an archetype or a legacy template. */
export function isKnownDesignId(id: string | null | undefined): boolean {
  return themeForTemplateId(id) !== null;
}
