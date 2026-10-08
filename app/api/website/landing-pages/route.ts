/**
 * Landing Pages API
 * GET - List all landing pages for the user
 * POST - Create a new landing page for a service
 */

import { NextRequest, NextResponse } from 'next/server';
import { publicSiteUrl } from '@/lib/utils/origins';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { WebsitePageRepository, WebsitePageInsert, PageTheme } from '@/lib/repositories/WebsitePageRepository';
import { adoptBusinessTemplate, adoptBusinessTheme, getBusinessTemplate } from '@/lib/business-os/businessTemplate';
import { resolveBusinessSubdomain } from '@/lib/business-os/businessSubdomain';
import { WebsiteBlockRepository, WebsiteBlockInsert } from '@/lib/repositories/WebsiteBlockRepository';
import { completeTheme } from '@/lib/branding/theme';
import { imageForSection } from '@/lib/services/StockImageService';
import { repairBlockLinks } from '@/lib/website-builder/linkIntegrity';
import { loadLiveServiceCards, narrowToPageService } from '@/lib/website-builder/liveServiceCards';
import { leadSentence } from '@/lib/website-builder/leadSentence';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { z } from 'zod';

const logger = createLogger({ module: 'LandingPagesAPI' });

// Offering types that require booking vs direct purchase

// Get blocks based on offering type - courses/products don't need booking
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
async function serviceTakesBookings(userId: string, serviceId: string): Promise<boolean> {
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

    // Kept for the logs and for wording; it no longer decides the layout.
    const offeringType = (validated.generatedContent?.offering_type as string) || undefined;
    const needsBooking = await serviceTakesBookings(user.id, validated.serviceId);
    // Read for the "who we are" section, which is written from it.
    const pageProfile = (await businessProfileRepository.findByUserId(user.id)).data;
    // The live card for the one service this page sells: its facts, not the
    // generator's description of them. Used by the pricing block below.
    const pageServiceCard =
      narrowToPageService(await loadLiveServiceCards(user.id), validated.serviceId)[0] ?? null;
    const landingPageBlocks = getBlocksForOffering(needsBooking, validated.language);

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
        content.currency = validated.serviceCurrency || 'USD';
        // Set client flow from wizard - determines which steps are shown in booking modal
        content.client_flow = validated.clientFlow || ['scheduling', 'client_info', 'confirmation'];
        /*
         * ─────────────────────────────────────────────────────────────────────
         * THE ONE SERVICE THIS PAGE SELLS, WHERE THE RENDERER LOOKS FOR IT.
         *
         * `WebsiteBlocks` resolves a landing page's single service from
         * `pricing.plans`, and only when there is EXACTLY ONE entry. This
         * mapped over whatever the generator had written — so a page whose
         * generation fell back to the starting draft kept `plans: []`, had no
         * page service, and every page-level button opened the booking dialog
         * at its catalogue step: "start now" offering services the page never
         * mentioned, and the closing CTA opening on nothing. Both were reported
         * from a real page.
         *
         * So the entry is BUILT rather than decorated. The facts come from the
         * service row because `is_scheduled`, `collection`, `sale_mode` and the
         * price decide the client's journey and are not the model's to invent;
         * whatever copy it wrote is kept underneath.
         * ─────────────────────────────────────────────────────────────────────
         */
        if (pageServiceCard) {
          const written = Array.isArray(content.plans)
            ? (content.plans as Array<Record<string, unknown>>)[0]
            : undefined;
          content.plans = [{
            ...written,
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

    /*
     * ─────────────────────────────────────────────────────────────────────────
     * EVERY BUTTON POINTS AT A SECTION THIS PAGE ACTUALLY HAS.
     *
     * The destinations above are decided from the OFFERING — `needsBooking`
     * sends the header and hero to `#booking`, otherwise to `#pricing` — while
     * which sections get installed is decided separately a few lines up, and
     * the generated content spread into each block can carry destinations of
     * its own. Two authors, one contract, and nothing checked them against each
     * other.
     *
     * A fragment naming no element is the quietest failure a page can have: the
     * browser does not navigate, does not scroll and reports nothing, so the
     * one button a landing page exists for silently does nothing.
     *
     * The same pass the renderer and the website generator run, from the same
     * shared table of section anchors, so what is stored is already right.
     * ─────────────────────────────────────────────────────────────────────────
     */

    /*
     * A section with nothing in it is not a section.
     *
     * "Who we are" with an empty body tells a stranger the business has nothing
     * to say about itself, on the page where they are deciding whether to trust
     * it. Dropped rather than drawn empty — the profile fills it as soon as
     * there is anything to fill it with.
     */
    const withContent = blocksToCreate.filter(
      block => block.block_type !== 'about' || String((block.content as Record<string, unknown>)?.content || '').trim().length > 0
    );

    const { blocks: checkedBlocks, repairs: linkRepairs } = repairBlockLinks(withContent);

    if (linkRepairs.length > 0) {
      requestLogger.warn(
        { pageId: pageResult.data.id, repairs: linkRepairs },
        'Landing page buttons named sections the page does not have; destinations resolved'
      );
    }

    const blocksResult = await blockRepo.bulkCreate(checkedBlocks);
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
      // From the one resolver: this line read `agentspilot.com` while the
      // dashboard read `agentspilot.site` and middleware served `agentpilot.io`.
      url: subdomain ? publicSiteUrl(subdomain, `/${validated.slug}`) : null
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
