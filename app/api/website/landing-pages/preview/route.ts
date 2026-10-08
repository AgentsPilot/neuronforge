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
import { repairBlockLinks } from '@/lib/website-builder/linkIntegrity';
import { loadLiveServiceCards, narrowToPageService } from '@/lib/website-builder/liveServiceCards';
import { leadSentence } from '@/lib/website-builder/leadSentence';
import { resolvePaymentCollectionCapability } from '@/lib/payments/stripeAccountContext';
import { supabaseServer } from '@/lib/supabaseServer';
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

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * DOES A CLIENT PICK A TIME? THE SERVICE ROW SAYS SO.
 *
 * This read `offering_type` — a word a language model chose while describing
 * the offering — and matched it against a hardcoded list to decide whether the
 * page gets a booking section. Two things were wrong with that. The platform
 * already HOLDS the answer in `scheduling_services.is_scheduled`, so it was
 * guessing at a fact it owns; and the list could only ever recognise the words
 * somebody had thought of, so a business selling a "programme" or a "retainer"
 * lost its booking widget for using an unfamiliar noun.
 *
 * The prompt no longer offers the model a fixed vocabulary at all, which would
 * have made that list wrong far more often. `offering_type` still travels with
 * the content and still shapes the WORDING; it no longer decides the layout.
 * ─────────────────────────────────────────────────────────────────────────────
 */
async function serviceTakesBookings(userId: string, serviceId: string | undefined): Promise<boolean> {
  /*
   * The preview can be asked for before a service is chosen — `serviceId` is
   * optional on this route alone. With nothing to ask about, the safe answer is
   * the same as an unreadable row: no booking section, and a CTA that points at
   * the pricing one, rather than an anchor leading to a section that is not
   * there.
   */
  if (!serviceId) return false;

  const { data, error } = await supabaseServer
    .from('scheduling_services')
    .select('is_scheduled')
    .eq('id', serviceId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !data) {
    /*
     * Unreadable, or a service that is not this owner's. Treated as NOT
     * bookable, which is the safe direction: the other branch builds a CTA
     * pointing at the pricing section, so the page still has a way to act,
     * whereas a booking anchor with no booking section is a button that
     * scrolls nowhere.
     */
    return false;
  }

  // Null means "never said", and every service that predates the column takes
  // appointments — the column was added to mark the exceptions.
  return data.is_scheduled !== false;
}

function getBlocksForOffering(
  needsBooking: boolean,
  language: string = 'en'
): Array<{ block_type: string; defaultContent: Record<string, unknown> }> {

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
      /*
       * Who the reader would be buying from.
       *
       * A landing page is reached from an ad by someone who has never seen the
       * business: no familiar logo, no navigation to explore, no second page to
       * check. Between knowing what is on offer and being asked to pay, they
       * get one short section saying who is behind it — see the note on the
       * `landing` recipe, which this block set mirrors.
       */
      block_type: 'about',
      defaultContent: {
        title: language === 'he' ? 'מי אנחנו' : language === 'es' ? 'Quiénes somos' : 'Who we are',
        content: ''
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

    // Kept for the logs and for wording; it no longer decides the layout.
    const offeringType = (validated.generatedContent?.offering_type as string) || undefined;
    const needsBooking = await serviceTakesBookings(user.id, validated.serviceId);
    const landingPageBlocks = getBlocksForOffering(needsBooking, validated.language);

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
    /*
     * Also read for the "who we are" section, so the profile is fetched when
     * either needs it rather than only for a photograph.
     */
    const wantsProfile = wantsHeroImage || landingPageBlocks.some(block => block.block_type === 'about');
    const pageProfile = wantsProfile
      ? (await businessProfileRepository.findByUserId(user.id)).data
      : null;
    const previewProfile = pageProfile;
    const heroImage = wantsHeroImage
      ? await imageForSection(user.id, previewProfile?.vertical ?? null, 'portrait', 'hero')
      : null;

    /*
     * ─────────────────────────────────────────────────────────────────────────
     * THE REAL SERVICE, NOT THE ONE THE GENERATOR DESCRIBED.
     *
     * A landing page must behave exactly like the website and the smart link.
     * The only thing that differs is that it sells ONE service — and that
     * service has to work the way it works everywhere else.
     *
     * It did not. The published site and the website preview both replace the
     * services block with the live catalogue; this route never did, so the page
     * rendered the generator's own cards. Those carry a name and a price and
     * none of `id`, `is_scheduled`, `collection` or `sale_mode` — the facts
     * `flowForService` reads to choose a service's journey. So every card fell
     * back to the page's default flow, and one invented card ("קורס מומחים", on
     * an account with no such service) resolved to nothing at all.
     *
     * Narrowed to `serviceId` where the page has one: one card, live, behaving
     * as itself.
     * ─────────────────────────────────────────────────────────────────────────
     */
    /*
     * The live card is needed by the PRICING block too, not only by a services
     * block — and a landing page has pricing and no services block, so gating
     * on services alone meant it was never loaded for the page that needs it
     * most. See the pricing branch below for what depends on it.
     */
    const wantsLiveService = landingPageBlocks.some(
      block => block.block_type === 'services' || block.block_type === 'pricing'
    );
    const liveServiceCards = wantsLiveService
      ? narrowToPageService(await loadLiveServiceCards(user.id), validated.serviceId)
      : [];
    const pageServiceCard = liveServiceCards[0] ?? null;

    requestLogger.info({
      offeringType,
      blockTypes: landingPageBlocks.map(b => b.block_type),
      hasBookingWidget: landingPageBlocks.some(b => b.block_type === 'booking_widget'),
      liveServiceCards: liveServiceCards.length,
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

      /*
       * The services block carries the live card, and that is what the journey
       * is built from: `WebsiteBlocks` reads `journeyServices` straight out of
       * this block's content, so a card without the three facts cannot have a
       * journey of its own however the rest of the page is configured.
       *
       * Empty when the page's service has been deleted or deactivated, which is
       * deliberate — see `narrowToPageService`.
       */
      if (block.block_type === 'services') {
        content.services = liveServiceCards;
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

      /*
       * ───────────────────────────────────────────────────────────────────────
       * WHO WE ARE, FROM THE PROFILE — OR NOT AT ALL.
       *
       * The generator writes this section from the business facts. When it
       * falls back, or when it correctly returns nothing because those facts
       * are empty, the block was still built: a heading reading "מי אנחנו" with
       * silence underneath, which is worse than no section — it advertises that
       * the business has nothing to say about itself on the page where a
       * stranger is deciding whether to trust it.
       *
       * So the profile fills it where it can, and where it cannot the block is
       * dropped below.
       * ───────────────────────────────────────────────────────────────────────
       */
      if (block.block_type === 'about' && !String(content.content || '').trim()) {
        content.content = [
          pageProfile?.company_name,
          pageProfile?.unique_value_proposition,
        ]
          .map(part => (part || '').trim())
          .filter(Boolean)
          .join(' · ');
      }

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

        /*
         * ─────────────────────────────────────────────────────────────────────
         * THE ONE SERVICE THIS PAGE SELLS, WHERE THE RENDERER LOOKS FOR IT.
         *
         * `WebsiteBlocks` resolves a landing page's single service from
         * `pricing.plans` — and only when there is EXACTLY ONE entry. The
         * generator fills that array, so a page whose generation fell back to
         * the starting draft had `plans: []`, no page service, and every
         * page-level button opened the booking dialog at its catalogue step:
         * "start now" offering a list of services the page never mentioned, and
         * the closing CTA opening on nothing at all. Both were reported.
         *
         * The facts come from the service row and overwrite whatever the model
         * wrote, because `is_scheduled`, `collection`, `sale_mode` and the price
         * decide the client's journey and are not the model's to invent. Its
         * copy — the inclusions it listed — is kept underneath.
         * ─────────────────────────────────────────────────────────────────────
         */
        if (pageServiceCard) {
          const written = Array.isArray(content.plans) ? content.plans[0] : undefined;
          content.plans = [{
            ...(written as Record<string, unknown> | undefined),
            serviceId: pageServiceCard.id,
            serviceName: pageServiceCard.name,
            name: pageServiceCard.name,
            /*
             * A line, not the brief. `description` here is printed on the
             * pricing card, and the service's own description is an owner's
             * notes — eleven lines on the reporting account, repeated verbatim
             * beside the price.
             */
            description: leadSentence(pageServiceCard.description) ?? '',
            price: pageServiceCard.price,
            priceRaw: pageServiceCard.priceRaw,
            currency: pageServiceCard.currency,
            durationMinutes: pageServiceCard.durationMinutes,
            is_scheduled: pageServiceCard.is_scheduled,
            collection: pageServiceCard.collection,
            sale_mode: pageServiceCard.sale_mode,
            paymentPlan: pageServiceCard.paymentPlan,
          }];
        }
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

    /*
     * The preview shows what will be SAVED, buttons included.
     *
     * The same check the landing-page route runs before it stores these blocks
     * and the website generator runs after the recipe. Here too, so the wizard
     * cannot demonstrate a destination the saved page will not have — which is
     * where this was first noticed.
     */

    /*
     * A section with nothing in it is not a section.
     *
     * "Who we are" with an empty body tells a stranger the business has nothing
     * to say about itself, on the page where they are deciding whether to trust
     * it. Dropped rather than drawn empty — the profile fills it as soon as
     * there is anything to fill it with.
     */
    const withContent = blocks.filter(
      block => block.block_type !== 'about' || String((block.content as Record<string, unknown>)?.content || '').trim().length > 0
    );

    const { blocks: checkedBlocks, repairs: linkRepairs } = repairBlockLinks(withContent);

    requestLogger.info({
      userId: user.id,
      serviceName: validated.serviceName,
      blockCount: checkedBlocks.length,
      linkRepairs: linkRepairs.length
    }, 'Generated preview blocks');

    return NextResponse.json({
      success: true,
      blocks: checkedBlocks,
      theme,
      language: validated.language,
      subdomain: validated.subdomain,
      /*
       * Whether a card can actually be charged, the same answer the website
       * preview and the published page are given.
       *
       * Without it the journey draws no payment step, so a service sold online
       * behaved on a landing page like one that is invoiced — the second half
       * of "the service must behave the same". Read here rather than in the
       * client, which has no business asking Stripe anything.
       */
      paymentsEnabled: (await resolvePaymentCollectionCapability(supabaseServer, user.id)).canCollect
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
