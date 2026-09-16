/**
 * Landing Page Preview API
 * POST - Returns HTML preview of landing page blocks (for wizard preview)
 *
 * This endpoint renders the actual block components with provided content
 * so the wizard preview matches what will be shown in edit/preview mode.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { resolveBusinessLogo } from '@/lib/branding/businessLogo';
import { imageForSection } from '@/lib/services/StockImageService';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { getBusinessTemplate } from '@/lib/business-os/businessTemplate';
import { completeTheme } from '@/lib/branding/theme';
import { z } from 'zod';

const logger = createLogger({ module: 'LandingPagePreviewAPI' });

const PreviewSchema = z.object({
  serviceName: z.string(),
  serviceId: z.string().optional(),
  servicePrice: z.number().nullable().optional(),
  serviceDuration: z.number().nullable().optional(),
  serviceCurrency: z.string().optional().default('USD'),
  theme: z.object({
    colors: z.object({
      primary: z.string(),
      secondary: z.string()
    }),
    fonts: z.object({
      heading: z.string(),
      body: z.string()
    })
  }),
  /*
   * Which design the preview is OF.
   *
   * The preview had no way to know. It received two colours and two font names
   * and assembled the rest by hand, so it showed white with 8px corners no
   * matter which archetype the wizard had selected — and the owner judged a
   * design they were never actually shown. Optional because a caller that omits
   * it still gets the platform default, exactly as before.
   */
  templateId: z.string().optional(),
  generatedContent: z.record(z.unknown()).optional(),
  clientFlow: z.array(z.string()).optional(),
  language: z.enum(['en', 'es', 'he']).optional().default('en'),
  showLogo: z.boolean().optional(),
  companyName: z.string().optional(),
  subdomain: z.string().optional()
});

// Offering types that require booking vs direct purchase
const BOOKABLE_TYPES = ['service', 'coaching', 'treatment', 'session', 'consultation'];

// Get blocks based on offering type - courses/products don't need booking
function getBlocksForOfferingType(
  offeringType: string | undefined,
  language: string = 'en'
): Array<{ block_type: string; defaultContent: Record<string, unknown> }> {
  const needsBooking = !offeringType || BOOKABLE_TYPES.includes(offeringType.toLowerCase());

  // Localized CTA text
  const ctaText = {
    book: language === 'he' ? 'הזמן עכשיו' : language === 'es' ? 'Reservar Ahora' : 'Book Now',
    enroll: language === 'he' ? 'הירשם עכשיו' : language === 'es' ? 'Inscríbete Ahora' : 'Enroll Now',
    buy: language === 'he' ? 'קנה עכשיו' : language === 'es' ? 'Comprar Ahora' : 'Buy Now',
    getStarted: language === 'he' ? 'התחל עכשיו' : language === 'es' ? 'Comenzar' : 'Get Started'
  };

  const blocks: Array<{ block_type: string; defaultContent: Record<string, unknown> }> = [
    {
      block_type: 'header',
      defaultContent: {
        logo_text: '',
        menu_items: [],
        cta_button: {
          // Book where a time is picked, otherwise the neutral ask. The
          // course/product branch guessed at what was being sold and put
          // "Enroll Now" on things nobody enrolls in.
          text: needsBooking ? ctaText.book : ctaText.getStarted,
          link: needsBooking ? '#booking' : '#pricing'
        },
        style: 'minimal'
      }
    },
    {
      block_type: 'hero',
      defaultContent: {
        layout: 'center',
        headline: '',
        subheadline: '',
        cta_text: needsBooking ? ctaText.book : ctaText.getStarted,
        cta_link: needsBooking ? '#booking' : '#pricing',
        background_type: 'gradient'
      }
    },
    {
      block_type: 'features',
      defaultContent: {
        /*
         * One heading for every offering.
         *
         * This was "What You Will Learn" for anything the generator had
         * classified as a course and "Why Choose Us" otherwise — a guess that
         * is visible when wrong, exactly as "Course Details" was on the pricing
         * section. "What's included" is true of a course, a treatment, a
         * package and a download alike, and needs nothing inferred.
         *
         * Generated copy still wins: the model reads the real description and
         * writes a heading about THIS offering, which is better than either
         * branch. This is only what shows when generation is skipped.
         */
        title: language === 'he' ? 'מה כלול' : language === 'es' ? 'Qué Incluye' : "What's Included",
        features: []
      }
    },
    {
      block_type: 'pricing',
      defaultContent: {
        // Just "Pricing".
        //
        // This was picked from `offeringType === 'course'` — "Course Details"
        // or "Investment" — a guess about the offering that is visible when
        // wrong: a landing page for a training package was headed "Course
        // Details". The section lists prices; the plainest word for it is
        // correct for every offering and needs nothing inferred.
        title: language === 'he' ? 'מחירון' : language === 'es' ? 'Precios' : 'Pricing',
        plans: []
      }
    },
    {
      block_type: 'faq',
      defaultContent: {
        title: language === 'he' ? 'שאלות נפוצות' : language === 'es' ? 'Preguntas Frecuentes' : 'Frequently Asked Questions',
        faqs: []
      }
    }
  ];

  // Only add booking widget for bookable services
  if (needsBooking) {
    blocks.push({
      block_type: 'booking_widget',
      defaultContent: {
        title: language === 'he' ? 'מוכנים להתחיל?' : language === 'es' ? '¿Listo para comenzar?' : 'Ready to Get Started?',
        services: []
      }
    });
  } else {
    // For courses/products, add a CTA block instead of booking
    blocks.push({
      block_type: 'cta',
      defaultContent: {
        // One closing ask for every offering. The course branch that used to
        // live here wrote "Ready to Start Learning?" and "Enroll now" onto
        // pages selling treatments and packages.
        title: language === 'he' ? 'מוכנים להתחיל?' : language === 'es' ? '¿Listo para comenzar?' : 'Ready to Get Started?',
        description: language === 'he' ? 'קבלו גישה היום' : language === 'es' ? 'Obtén acceso hoy' : 'Get access today',
        cta_text: ctaText.getStarted,
        cta_link: '#pricing'
      }
    });
  }

  // Always add contact form at the end
  blocks.push({
    block_type: 'contact_form',
    defaultContent: {
      title: language === 'he' ? 'שאלות? צרו קשר' : language === 'es' ? '¿Preguntas? Contáctenos' : 'Questions? Get in Touch',
      fields: ['name', 'email', 'message']
    }
  });

  return blocks;
}

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    /*
     * The body is read as text before it is parsed.
     *
     * `request.json()` throws a SyntaxError on an empty or truncated body, and
     * that landed in the catch below as a 500 with no explanation — the wizard
     * showed a preview that never arrived and the log said "Unexpected end of
     * JSON input". A request this route cannot read is the caller's problem and
     * has to be answered as one.
     */
    const raw = await request.text();
    if (!raw.trim()) {
      requestLogger.warn({ userId: user.id }, 'Preview called with an empty body');
      return NextResponse.json(
        { success: false, error: 'Preview data could not be read' },
        { status: 400 }
      );
    }

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch (parseError) {
      requestLogger.warn({ err: parseError, userId: user.id }, 'Preview body was not valid JSON');
      return NextResponse.json(
        { success: false, error: 'Preview data could not be read' },
        { status: 400 }
      );
    }

    const validated = PreviewSchema.parse(body);

    // The preview must look like the published page, so the logo comes from the
    // same place the published header will read it from.
    const previewLogoUrl = validated.showLogo ? await resolveBusinessLogo(user.id) : null;

    // Get offering type from AI-generated content to determine which blocks to include
    const offeringType = (validated.generatedContent?.offering_type as string) || undefined;
    const landingPageBlocks = getBlocksForOfferingType(offeringType, validated.language);

    /*
     * A picture for the hero, and nothing else.
     *
     * Three more were fetched for the FEATURE tiles, and every one of them was
     * wasted: a feature cell only becomes a photo tile when it has no heading
     * and no sentence, and this section is generated with copy in every cell.
     * Each preview therefore paid for three searches, three downloads and three
     * uploads to produce images nothing would ever render.
     *
     * Asked for only when the page actually has a hero to put one in — the
     * business profile too, which is read solely to decide what to search for.
     * Never fatal: null means the hero keeps the gradient it had before this
     * existed.
     */
    const wantsHeroImage = landingPageBlocks.some(block => block.block_type === 'hero');
    const previewProfile = wantsHeroImage
      ? (await businessProfileRepository.findByUserId(user.id)).data
      : null;
    const heroImage = wantsHeroImage
      ? await imageForSection(user.id, previewProfile?.vertical ?? null, 'portrait', 'hero')
      : null;

    requestLogger.info({
      offeringType,
      blockTypes: landingPageBlocks.map(b => b.block_type),
      hasBookingWidget: landingPageBlocks.some(b => b.block_type === 'booking_widget'),
      language: validated.language
    }, 'Generating preview blocks based on offering type');

    // Build blocks with merged content (same logic as landing page creation)
    const blocks = landingPageBlocks.map((block, index) => {
      let content = { ...block.defaultContent };

      // Merge generated content
      if (validated.generatedContent && validated.generatedContent[block.block_type]) {
        content = {
          ...content,
          ...(validated.generatedContent[block.block_type] as Record<string, unknown>)
        };
      }

      // For hero, set headline to service name — and the same photograph the
      // published page will carry, so the preview is not a grey box the real
      // page fills in later.
      if (block.block_type === 'hero') {
        content.headline = validated.serviceName;
        if (heroImage) {
          content.background_image = heroImage;
          content.background_type = 'image';
        }
      }

      // For header, set the logo flag and company name. The preview resolves
      // the image from the profile below, the same as a published page.
      if (block.block_type === 'header') {
        content.show_logo = validated.showLogo ?? false;
        content.logo_url = previewLogoUrl || undefined;
        content.logo_text = validated.companyName || '';
      }

      // For booking_widget, set client flow and service
      // Default to scheduling + client_info + confirmation for bookable services
      if (block.block_type === 'booking_widget') {
        content.client_flow = validated.clientFlow || ['scheduling', 'client_info', 'confirmation'];
        if (validated.serviceId) {
          content.services = [validated.serviceId];
        }
      }

      // For pricing, add service info for booking integration
      // Default to scheduling + client_info + confirmation for bookable services
      if (block.block_type === 'pricing') {
        /*
         * "Pricing" is the page's word, not the model's.
         *
         * The merge above spreads whatever the generator returned, and the
         * prompt asking it not to write a title is guidance, not a guarantee.
         * A heading here is the one thing about this section that does not
         * depend on the offering, so it is set after the merge rather than
         * defaulted before it.
         */
        content.title =
          validated.language === 'he' ? 'מחירון'
          : validated.language === 'es' ? 'Precios'
          : 'Pricing';
        content.serviceId = validated.serviceId;
        content.serviceName = validated.serviceName;
        content.durationMinutes = validated.serviceDuration || 60;
        content.currency = validated.serviceCurrency || 'USD';
        content.client_flow = validated.clientFlow || ['scheduling', 'client_info', 'confirmation'];
      }

      // For CTA (non-bookable items like courses/products), add service info
      // Default to client_info + payment + confirmation (no scheduling)
      if (block.block_type === 'cta') {
        content.serviceId = validated.serviceId;
        content.client_flow = validated.clientFlow || ['client_info', 'payment', 'confirmation'];
      }

      return {
        id: `preview-${block.block_type}-${index}`,
        block_type: block.block_type,
        content,
        styles: {},
        position: index,
        enabled: true
      };
    });

    /*
     * The theme the preview renders in — completed from the archetype, not
     * assembled here.
     *
     * The preview and the saved page have to agree, or the owner approves one
     * design and publishes another. Both now go through `completeTheme` with
     * the same template id, so they cannot drift.
     */
    /*
     * Which design to complete the theme from.
     *
     * The wizard sends a `templateId` when the owner picks a look, and sends
     * none when they choose to reuse what the business already wears. Falling
     * back to the business's own template is what makes that second case mean
     * "the same as everything else I have" rather than "the platform default" —
     * without it, reusing an existing theme produced a page with no archetype,
     * no type scale, no layouts and no composition, which is the one outcome
     * the owner was explicitly trying to avoid.
     */
    const businessTemplate = await getBusinessTemplate(user.id);
    /*
     * Same precedence as the save: the business's template wins, and the
     * wizard's choice only applies to a business that has none yet. If these
     * two disagreed the owner would approve one design and publish another.
     */
    const designId = businessTemplate.templateId ?? validated.templateId ?? undefined;

    const theme = completeTheme(
      {
        colors: {
          primary: validated.theme.colors.primary,
          secondary: validated.theme.colors.secondary,
        },
        fonts: {
          heading: validated.theme.fonts.heading,
          body: validated.theme.fonts.body,
        },
      },
      designId
    );

    requestLogger.info({
      userId: user.id,
      serviceName: validated.serviceName,
      blockCount: blocks.length
    }, 'Generated preview blocks');

    return NextResponse.json({
      success: true,
      blocks,
      theme,
      language: validated.language,
      subdomain: validated.subdomain
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid input', details: error.errors },
        { status: 400 }
      );
    }

    requestLogger.error({ err: error }, 'Failed to generate preview');
    return NextResponse.json(
      { success: false, error: 'Failed to generate preview' },
      { status: 500 }
    );
  }
}
