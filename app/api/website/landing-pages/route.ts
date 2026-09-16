/**
 * Landing Pages API
 * GET - List all landing pages for the user
 * POST - Create a new landing page for a service
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { WebsitePageRepository, WebsitePageInsert, PageTheme } from '@/lib/repositories/WebsitePageRepository';
import { adoptBusinessTemplate, adoptBusinessTheme, getBusinessTemplate } from '@/lib/business-os/businessTemplate';
import { resolveBusinessSubdomain } from '@/lib/business-os/businessSubdomain';
import { WebsiteBlockRepository, WebsiteBlockInsert } from '@/lib/repositories/WebsiteBlockRepository';
import { completeTheme } from '@/lib/branding/theme';
import { imageForSection } from '@/lib/services/StockImageService';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { z } from 'zod';

const logger = createLogger({ module: 'LandingPagesAPI' });

// Offering types that require booking vs direct purchase
const BOOKABLE_TYPES = ['service', 'coaching', 'treatment', 'session', 'consultation'];

// Get blocks based on offering type - courses/products don't need booking
function getBlocksForOfferingType(
  offeringType: string | undefined,
  language: string = 'en'
): Array<{ block_type: string; defaultContent: Record<string, unknown> }> {
  // A booking section is added only when the offering is known to be bookable.
  //
  // `!offeringType ||` made "we don't know" mean "yes": `offering_type` comes
  // from the generated content, so any page whose generation did not classify
  // the offering — which is every page where generation was skipped or fell
  // back — got a booking widget it had not asked for. The other branch already
  // covers this case properly, adding a CTA block and pointing the header and
  // hero at `#pricing` instead of `#booking`, so nothing is left without a
  // destination.
  const needsBooking = !!offeringType && BOOKABLE_TYPES.includes(offeringType.toLowerCase());

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
        /*
         * The business name, not an empty string.
         *
         * This was blank, and with no menu items either the header rendered as
         * a bare strip with one button in it — which read as a missing block
         * rather than a deliberate one. The generator already receives
         * `companyName` and writes it further down; it just started from
         * nothing. Overwritten below for the same reason the logo is.
         */
        logo_text: '',
        /*
         * Anchors to this page's own sections, never away from it.
         *
         * A landing page sells one thing, so a nav that leaves it is working
         * against the page. These point at the sections this generator is about
         * to create, so the menu helps someone move DOWN the page rather than
         * off it. Filtered below to whatever actually got built.
         */
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
        /*
         * The closing ask, without guessing what is being sold.
         *
         * "Ready to Start Learning?" and "Enroll now" were shown for anything
         * classified as a course — wrong, and prominently, on a page selling a
         * training package or a treatment. The plain version is right for all
         * of them, and the model overwrites it with something specific whenever
         * generation runs.
         */
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

const CreateLandingPageSchema = z.object({
  serviceId: z.string().uuid(),
  serviceName: z.string().min(1).max(200),
  slug: z.string().min(1).max(100),
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
  /** The template the page was built from, when the wizard chose one. */
  templateId: z.string().min(1).max(200).optional(),
  generatedContent: z.record(z.unknown()).optional(),
  shouldPublish: z.boolean().default(false),
  // Client flow steps - 'scheduling' and 'client_info' are the new split steps, 'booking' is legacy
  clientFlow: z.array(z.enum(['scheduling', 'client_info', 'booking', 'payment', 'intake', 'confirmation'])).optional(),
  // Language for localized content
  language: z.enum(['en', 'es', 'he']).optional().default('en'),
  // Business branding for header
  // Whether this page's header wears the business logo. The image itself is
  // never passed in or stored here — it comes from the business profile.
  showLogo: z.boolean().optional(),
  companyName: z.string().optional(),
  // Service details for pricing and booking
  servicePrice: z.number().nullable().optional(),
  serviceDuration: z.number().optional(),
  serviceCurrency: z.string().optional().default('USD')
});

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Get all landing pages for this user
    const { data, error } = await supabaseServer
      .from('website_pages')
      .select('*')
      .eq('user_id', user.id)
      .eq('page_type', 'landing')
      .neq('status', 'archived')
      .order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json({ success: true, landingPages: data || [] });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to list landing pages');
    return NextResponse.json(
      { success: false, error: 'Failed to list landing pages' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const validated = CreateLandingPageSchema.parse(body);

    const pageRepo = new WebsitePageRepository(supabaseServer);
    const blockRepo = new WebsiteBlockRepository(supabaseServer);

    /*
     * The business's address, not just the homepage's.
     *
     * This asked only the homepage, so a business without a website created
     * every landing page with `subdomain: null` — and could then never publish
     * one, because publishing refuses a page with no address.
     */
    const subdomain = await resolveBusinessSubdomain(user.id);

    /*
     * The landing page's look.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * WHY THIS IS NOT ASSEMBLED BY HAND ANY MORE
     *
     * It used to be: two colours off the wizard, then `#ffffff`, `#f9fafb`,
     * `#1a1a1a`, `normal` and `8px` written in literally. That produced a theme
     * that contradicted the `template_id` stored in the same row — a landing
     * page created on Lumen, which is a DARK archetype with 30px corners,
     * rendered white with 8px corners. It also carried no `id`, no `scale`, no
     * `layouts` and no `composition`, so every block fell back to its default
     * arrangement and the archetype reached the page as nothing but two hex
     * values.
     *
     * `completeTheme` is the one merge that already knows the answer: the
     * wizard's overrides first, then the named archetype, then the platform
     * default. It also forces `id`, `source`, `scale`, `layouts` and
     * `composition` to come from the archetype itself, so a caller cannot
     * half-apply a design.
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
    /*
     * THE BUSINESS'S TEMPLATE WINS. A landing page does not get its own.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * WHY
     *
     * A landing page is the same business as the invoice that follows it and the
     * booking confirmation after that. When it could carry its own template, a
     * client met a near-black Bold page, booked, and received a warm cream
     * receipt — and nothing about that reads as one business. The template is a
     * property of the business, not of a page.
     *
     * The wizard's own picker made this reachable in one click, and the split
     * was permanent: `adoptBusinessTemplate` is adopt-only, so a page choosing
     * a different template never changed the business's, and the only repair
     * was to re-apply the business template, which silently overwrote the page.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * THE ONE EXCEPTION, WHICH IS NOT A DIFFERENT TEMPLATE
     *
     * A business whose FIRST surface is a landing page has no template yet. Its
     * choice there establishes the look for everything it later builds, which
     * is the same first-surface-wins rule the website already follows. That is
     * the business choosing, not the page diverging.
     */
    const businessTemplate = await getBusinessTemplate(user.id);
    const designId = businessTemplate.templateId ?? validated.templateId ?? undefined;

    const pageTheme: PageTheme = completeTheme(
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

    // Create the landing page
    const pageData: WebsitePageInsert = {
      user_id: user.id,
      page_type: 'landing',
      // No leading slash. It was stored as `/${slug}`, so a page saved as
      // `test-1` came back as `/test-1` and every URL built from it —
      // `{subdomain}.agentpilot.io/{slug}` — doubled the separator.
      slug: validated.slug.replace(/^\/+/, ''),
      title: validated.serviceName,
      subdomain: subdomain || null,
      status: validated.shouldPublish ? 'live' : 'draft',
      /*
       * The template this page actually renders in — which is the business's.
       *
       * This wrote `validated.templateId`, so a page built on the business's
       * look recorded null, and a page that had chosen its own recorded the
       * difference. Writing what was actually used keeps the column and the
       * theme beside it telling the same story.
       */
      template_id: designId || null,
      theme: pageTheme,
      // Store the language for RTL support and localized content
      website_language: validated.language
    };

    const pageResult = await pageRepo.create(pageData);

    if (pageResult.error || !pageResult.data) {
      throw pageResult.error || new Error('Failed to create landing page');
    }

    /*
     * If this is the first thing the business has published, its template
     * becomes the business's template.
     *
     * The wizard now picks from the real catalogue, so there is an id to record
     * and `adoptBusinessTemplate` can set both halves — the choice and the
     * colours it implies. The theme-only path remains for a page created
     * without one, which still has to claim the look or a website generated
     * afterwards would choose its own and leave the landing page the odd one
     * out. A business that already has a template keeps it; this does nothing.
     */
    if (designId) {
      // Only ever an adoption: `designId` is already the business's template
      // where it had one, so this is the first-surface case and nothing else.
      await adoptBusinessTemplate(user.id, designId);
    } else {
      await adoptBusinessTheme(user.id, pageTheme as unknown as Record<string, unknown>);
    }

    // Get offering type from AI-generated content to determine which blocks to include
    const offeringType = (validated.generatedContent?.offering_type as string) || undefined;
    const landingPageBlocks = getBlocksForOfferingType(offeringType, validated.language);

    requestLogger.info({
      offeringType,
      blockTypes: landingPageBlocks.map(b => b.block_type),
      hasBookingWidget: landingPageBlocks.some(b => b.block_type === 'booking_widget')
    }, 'Generating landing page blocks based on offering type');

    /*
     * A picture for the hero, and nothing else.
     *
     * Three more were fetched for the FEATURE tiles, and every one of them was
     * wasted: a feature cell only becomes a photo tile when it has no heading
     * and no sentence, and this section is generated with copy in every cell.
     * Each page therefore paid for three searches, three downloads and three
     * uploads to produce images nothing would ever render.
     *
     * Asked for only when the page actually has a hero to put one in — the
     * business profile too, which is read solely to decide what to search for.
     * Never fatal: null means the hero keeps the gradient it had before this
     * existed, which is what every landing page looked like until recently.
     */
    const wantsHeroImage = landingPageBlocks.some(block => block.block_type === 'hero');
    const businessProfile = wantsHeroImage
      ? (await businessProfileRepository.findByUserId(user.id)).data
      : null;
    const heroImage = wantsHeroImage
      ? await imageForSection(user.id, businessProfile?.vertical ?? null, 'portrait', 'hero')
      : null;

    // Create blocks with generated content
    const blocksToCreate: WebsiteBlockInsert[] = landingPageBlocks.map((block, index) => {
      // Merge generated content if available
      let content = { ...block.defaultContent };
      if (validated.generatedContent && validated.generatedContent[block.block_type]) {
        content = {
          ...content,
          ...(validated.generatedContent[block.block_type] as Record<string, unknown>)
        };
      }

      if (block.block_type === 'hero' && heroImage) {
        content.background_image = heroImage;
        content.background_type = 'image';
      }

      // For header, record whether to show the logo and the company name. The
      // logo URL is injected at read time from the business profile.
      if (block.block_type === 'header') {
        content.show_logo = validated.showLogo ?? false;
        content.logo_text = validated.companyName || '';

        /*
         * ─────────────────────────────────────────────────────────────────────
         * NO MENU ON A LANDING PAGE.
         *
         * This built a menu of the page's own sections — Pricing, FAQ, Book —
         * which is website thinking applied to a page with the opposite job. A
         * website's header helps someone navigate to the part they want; a
         * landing page exists to carry one visitor down one path to one action.
         *
         * Section links are escape hatches from that path. They invite a reader
         * to jump to the price before anything has given them a reason to care
         * about it, or to the FAQ before they know what is on offer — skipping
         * the argument the page was written to make. And they are anchors
         * within the same page, so they are barely navigation at all: the
         * content is already there, one scroll away.
         *
         * What the header keeps is what earns its place — the logo, and the
         * single action the whole page is driving at.
         */
        content.menu_items = [];
      }

      // For hero, always set headline to service name (AI only generates subheadline)
      if (block.block_type === 'hero') {
        content.headline = validated.serviceName;
      }

      // For booking_widget, add the specific service and client flow
      if (block.block_type === 'booking_widget') {
        content.services = [validated.serviceId];
        // Use new split steps as default - scheduling + client_info for bookable services
        content.client_flow = validated.clientFlow || ['scheduling', 'client_info', 'confirmation'];
      }

      // For pricing, add the service info for booking integration
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
        // Set client flow from wizard - determines which steps are shown in booking modal
        content.client_flow = validated.clientFlow || ['scheduling', 'client_info', 'confirmation'];
        // Add priceRaw to plans if present
        if (content.plans && Array.isArray(content.plans)) {
          content.plans = (content.plans as Array<Record<string, unknown>>).map(plan => ({
            ...plan,
            serviceId: validated.serviceId,
            priceRaw: validated.servicePrice || undefined,
            currency: validated.serviceCurrency || 'USD',
            durationMinutes: validated.serviceDuration || 60
          }));
        }
      }

      // For CTA (courses/products), also add service info
      if (block.block_type === 'cta') {
        content.serviceId = validated.serviceId;
        content.serviceName = validated.serviceName;
        content.priceRaw = validated.servicePrice || undefined;
        content.currency = validated.serviceCurrency || 'USD';
        // Set client flow from wizard - for courses/products, typically no scheduling
        content.client_flow = validated.clientFlow || ['client_info', 'payment', 'confirmation'];
      }

      return {
        page_id: pageResult.data!.id,
        block_type: block.block_type as WebsiteBlockInsert['block_type'],
        content: content as WebsiteBlockInsert['content'],
        styles: {},
        position: index,
        enabled: true
      };
    });

    const blocksResult = await blockRepo.bulkCreate(blocksToCreate);
    if (blocksResult.error) {
      requestLogger.warn({ err: blocksResult.error }, 'Failed to create landing page blocks');
    }

    // If publishing, update published_at
    if (validated.shouldPublish) {
      await pageRepo.publish(pageResult.data.id, user.id);
    }

    requestLogger.info({
      pageId: pageResult.data.id,
      userId: user.id,
      serviceId: validated.serviceId,
      published: validated.shouldPublish
    }, 'Created landing page');

    return NextResponse.json({
      success: true,
      landingPage: pageResult.data,
      url: subdomain ? `https://${subdomain}.agentspilot.com/${validated.slug}` : null
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid input', details: error.errors },
        { status: 400 }
      );
    }

    // Check for duplicate slug error
    const pgError = error as { code?: string; details?: string };
    if (pgError.code === '23505' && pgError.details?.includes('slug')) {
      requestLogger.warn({ err: error }, 'Duplicate landing page slug');
      return NextResponse.json(
        {
          success: false,
          error: 'A landing page with this URL already exists. Please choose a different name or URL.',
          code: 'DUPLICATE_SLUG'
        },
        { status: 409 }
      );
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    requestLogger.error({ err: error, errorMessage }, 'Failed to create landing page');

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to create landing page',
        details: process.env.NODE_ENV === 'development' ? errorMessage : undefined
      },
      { status: 500 }
    );
  }
}
