/**
 * Public Website API
 * GET - Fetch public website data by subdomain (no auth required)
 *
 * CONTENT ARCHITECTURE:
 * - Blocks are merged with central website_content
 * - Services are fetched live from Scheduling capability
 * - Template content serves as fallback
 */

import { NextRequest, NextResponse } from 'next/server';
import { withProfileContact } from '@/lib/branding/contactBlockContent';
import { withProfileFooter } from '@/lib/branding/footerBlockContent';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { completeTheme } from '@/lib/branding/theme';
import { createLogger } from '@/lib/logger';
import { mergeCentralContent } from '@/lib/website-builder/mergeCentralContent';
import { resolveBusinessLogo } from '@/lib/branding/businessLogo';
import { supabaseServer } from '@/lib/supabaseServer';
import { WebsitePageRepository } from '@/lib/repositories/WebsitePageRepository';
import { WebsiteBlockRepository, WebsiteBlock } from '@/lib/repositories/WebsiteBlockRepository';
import { WebsiteContentRepository, WebsiteContent, SectionType } from '@/lib/repositories/WebsiteContentRepository';
import { SchedulingServiceRepository } from '@/lib/repositories/SchedulingRepository';
import { loadServicePaymentPlans, type ServicePaymentPlan } from '@/lib/business-os/servicePaymentPlan';
import { formatPrice } from '@/lib/website-builder/servicePrice';
import { toServiceCard } from '@/lib/website-builder/serviceCard';

const logger = createLogger({ module: 'PublicWebsiteAPI' });

// Map block_type to section name in website_content
const BLOCK_TO_SECTION_MAP: Record<string, SectionType> = {
  'hero': 'hero',
  'about': 'about',
  'services': 'services',
  'testimonials': 'testimonials',
  'faq': 'faq',
  'team': 'team',
  'contact_form': 'contact',
  'process': 'process',
  'features': 'features',
  'stats': 'stats',
  'pricing': 'pricing',
  'gallery': 'gallery',
  'cta': 'cta',
  'newsletter': 'newsletter',
  'logo_cloud': 'logo_cloud',
  'video': 'video',
  'booking_widget': 'booking_widget',
  'payment_button': 'payment_button'
};

interface RouteParams {
  params: Promise<{ subdomain: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { subdomain } = await params;
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const pageRepo = new WebsitePageRepository(supabaseServer);
    const blockRepo = new WebsiteBlockRepository(supabaseServer);
    const contentRepo = new WebsiteContentRepository(supabaseServer);

    /*
     * Which page this address is asking for.
     *
     * A slug names a landing page; without one this is the business's website.
     * Landing pages share the single business subdomain, so before they had an
     * address of their own a business could publish a website OR a landing
     * page and never both — the second one made the subdomain ambiguous rather
     * than shadowing the first.
     */
    const slug = request.nextUrl.searchParams.get('slug');

    const pageResult = slug
      ? await pageRepo.findLiveLandingBySlug(subdomain, slug)
      : await pageRepo.findBySubdomain(subdomain);

    if (pageResult.error || !pageResult.data) {
      /*
       * Coming soon — in the business's own look, where there is one.
       *
       * This returned no `page` key at all, so the renderer's `data.page?.theme`
       * was always undefined and every coming-soon page rendered in platform
       * indigo. That is often the FIRST thing anyone sees of a business: the
       * address is shared before the site is finished.
       *
       * The draft is where the look lives. A business waiting to publish has a
       * page with a theme on it and a status that is not yet `live`, so the
       * same row that is not being served is the one that knows what it will
       * look like. Any failure here simply leaves the page unthemed, exactly as
       * before.
       */
      if (slug) {
        return NextResponse.json(
          { success: false, error: 'Not found' },
          { status: 404 }
        );
      }

      const draft = await pageRepo.findBySubdomainAny(subdomain);
      const draftTheme = draft.data
        ? completeTheme(draft.data.theme, draft.data.template_id)
        : null;

      return NextResponse.json({
        success: true,
        status: 'coming_soon',
        subdomain,
        ...(draftTheme ? { page: { theme: draftTheme } } : {}),
      });
    }

    const userId = pageResult.data.user_id;

    // Get enabled blocks only
    const blocksResult = await blockRepo.findByPageId(pageResult.data.id, true);
    const blocks = blocksResult.data || [];

    // Get central content — read only.
    //
    // This ran with the service-role client on behalf of anonymous visitors, so
    // a stranger loading a public page created the business's content row and
    // seeded it with English placeholders. A page view must not write.
    const contentResult = await contentRepo.findByUserId(userId);
    const centralContent = contentResult.data;

    // Check page type for landing page specific logic
    const isLandingPage = pageResult.data.page_type === 'landing';

    // Fetch live services from Scheduling capability
    // Needed for services blocks AND pricing/CTA blocks (for live pricing data)
    let liveServices: Array<{
      id: string; name: string; description: string; icon: string;
      price?: string; priceRaw?: number; currency?: string;
      duration?: string; durationMinutes?: number | null;
      /** The three facts a booking journey is built from. */
      is_scheduled?: boolean; collection?: 'online' | 'invoice' | null;
      sale_mode?: 'direct' | 'proposal';
      /** How this service may be paid over time, when the business offers it. */
      paymentPlan?: ServicePaymentPlan;
      hidden?: boolean;
    }> = [];
    const hasServicesBlock = blocks.some(b => b.block_type === 'services');
    const hasPricingBlock = blocks.some(b => b.block_type === 'pricing');
    const hasCtaBlock = blocks.some(b => b.block_type === 'cta');

    // Fetch live services if we have services, pricing, or CTA blocks
    /*
     * A landing page always needs the live list, whatever blocks it has.
     *
     * The page-level check below asks whether the service this page sells still
     * exists, and it has nothing to check against on a landing page built from
     * a hero and a header alone — which would leave exactly that page's buttons
     * live after its service was deleted.
     */
    if (hasServicesBlock || hasPricingBlock || hasCtaBlock || isLandingPage) {
      try {
        const schedulingRepo = new SchedulingServiceRepository(supabaseServer);
        // Both in one pass: a plan is a fact about a service, like its price.
        const [servicesResult, plansByService] = await Promise.all([
          schedulingRepo.listAll(userId, true), // active only
          loadServicePaymentPlans(userId),
        ]);
        if (servicesResult.data && servicesResult.data.length > 0) {
          liveServices = servicesResult.data.map(s => ({
            // The shared mapper: icon, price, journey facts. This route had its
            // own copy of all three, which is how the same service showed a
            // different icon here than in the editor.
            ...toServiceCard(s),
            // Undefined where the business offers no plan, which is most of
            // them — the widgets then show a single price as they always have.
            paymentPlan: plansByService[s.id],
            hidden: false
          }));
        }
      } catch (err) {
        requestLogger.warn({ err }, 'Failed to fetch live services');
      }
    }

    // The header's logo is the BUSINESS's logo, not the page's. The block only
    // records whether to show one (`show_logo`); the image is injected here at
    // read time so a site can never drift from the profile, and so changing the
    // logo once changes it everywhere.
    const headerShowsLogo = blocks.some(
      b => b.block_type === 'header' && (b.content as Record<string, unknown>)?.show_logo === true
    );
    const businessLogoUrl = headerShowsLogo
      ? await resolveBusinessLogo(userId)
      : null;

    /*
     * The contact details beside the form, from the business profile.
     *
     * These lived only on the block, so an owner typed their email, phone,
     * address and opening hours into the contact section by hand — details they
     * had already given the platform, which appear on their invoices and in
     * their booking confirmations. When any of it changed they had to remember
     * this section existed, and a stale phone number on a contact form is worse
     * than none.
     *
     * Injected the same way the logo is, and for the same reason: the profile
     * is the single source and changing it once changes it everywhere. It is
     * authoritative rather than a default, so the contact form and the footer
     * on one page cannot state two different phone numbers.
     */
    /*
     * The footer reads the same row.
     *
     * It states opening hours, the registered name and number, and the contact
     * details — all of it resolved here rather than stored, because hours are a
     * CLAIM: baked into the block at generation, a page goes on telling clients
     * to come on a day the business has since stopped working.
     */
    const needsProfile = blocks.some(
      b => b.block_type === 'contact_form' || b.block_type === 'footer'
    );
    const contactProfile = needsProfile
      ? (await businessProfileRepository.findByUserId(userId)).data
      : null;

    // Merge central content into blocks
    /*
     * ─────────────────────────────────────────────────────────────────────────
     * DOES THE SERVICE THIS LANDING PAGE SELLS STILL EXIST?
     *
     * Asked about the PAGE, not each block. Only some blocks carry the service
     * id — the pricing block does, a CTA generated for a course does — while a
     * hero, a header and most CTAs just call `resolveBookingAction`, which
     * opens booking for the BUSINESS. A per-block check therefore disabled the
     * pricing block and left the buttons beside it working, offering a visitor
     * a completely different set of services on a page written to sell one
     * deleted course.
     *
     * Deleting a service already unpublishes the pages that sell it, so this
     * should rarely fire — but that take-down swallows its own failures by
     * design, and a deactivated service reaches the same state. This is the
     * render-time guard that actually protects the public page.
     */
    const pageServiceId = isLandingPage
      ? blocks
          .map(b => (b.content as Record<string, unknown> | null)?.serviceId)
          .find((id): id is string => typeof id === 'string' && id.length > 0)
      : undefined;

    const pageServiceGone = !!pageServiceId && !liveServices.some(svc => svc.id === pageServiceId);

    if (pageServiceGone) {
      requestLogger.warn(
        { subdomain, pageServiceId },
        'A live landing page sells a service that is no longer active; disabling its conversion controls'
      );
    }

    /** Blocks whose button can start a booking, and so must go dead with it. */
    const CONVERTING = new Set(['cta', 'hero', 'header', 'booking_widget']);

    const blocksWithContent: WebsiteBlock[] = blocks.map(block => {
      // Marked first, so a branch below that returns early still carries it.
      if (pageServiceGone && CONVERTING.has(block.block_type)) {
        return {
          ...block,
          content: {
            ...(block.content as Record<string, unknown>),
            serviceId: pageServiceId,
            serviceUnavailable: true,
          },
        };
      }

      if (block.block_type === 'contact_form' && contactProfile) {
        return {
          ...block,
          content: withProfileContact(
            block.content as Record<string, unknown>,
            contactProfile as unknown as Record<string, unknown>,
            pageResult.data.website_language ?? 'en'
          ),
        };
      }

      if (block.block_type === 'footer') {
        const footerContent = block.content as Record<string, unknown>;
        return {
          ...block,
          content: {
            ...withProfileFooter(
              footerContent,
              contactProfile as unknown as Record<string, unknown> | null,
              pageResult.data.website_language ?? 'en'
            ),
            /*
             * The mark, unless the owner has switched it off.
             *
             * The header is opt-IN (`show_logo === true`) because a header can
             * show a wordmark instead, and an owner choosing between them is
             * making a design decision. A footer has no such alternative — it
             * simply ends the page — and no footer block written before today
             * carries the flag at all, so requiring it meant a business with a
             * logo got a footer without one and no control anywhere to say why.
             *
             * Opt-OUT instead: any business with a logo wears it here until it
             * explicitly says otherwise.
             */
            logo_url: footerContent?.show_logo !== false && businessLogoUrl ? businessLogoUrl : undefined,
          },
        };
      }

      if (block.block_type === 'header') {
        const headerContent = block.content as Record<string, unknown>;
        return {
          ...block,
          content: {
            ...headerContent,
            // Absent rather than empty: HeaderBlock renders logo_text when
            // there is no logo_url, and an empty string is not falsy enough for
            // every consumer downstream.
            logo_url: headerContent?.show_logo === true && businessLogoUrl ? businessLogoUrl : undefined,
          },
        };
      }

      const sectionName = BLOCK_TO_SECTION_MAP[block.block_type];

      // For landing pages, inject live service data into pricing and CTA blocks
      if (isLandingPage) {
        // PRICING: Inject live service data for accurate pricing
        /*
         * NOT gated on `liveServices.length > 0`.
         *
         * That gate skipped the whole branch for a business with no active
         * services left — which is precisely the business whose landing page
         * needs `serviceUnavailable` set. Deleting the LAST service therefore
         * left the page quoting its old price with a working booking button,
         * while deleting any other service correctly disabled it.
         *
         * A block with no `serviceId` still falls straight through, so a
         * homepage's own CTA is unaffected.
         */
        if (block.block_type === 'pricing') {
          const blockContent = block.content as Record<string, unknown>;
          const serviceId = blockContent.serviceId as string | undefined;

          if (serviceId) {
            const matchingService = liveServices.find(s => s.id === serviceId);

            /*
             * The service this page is about is gone — deleted, or switched
             * off, which lands here identically because `liveServices` is
             * active-only.
             *
             * Removing a service now takes its landing page back to draft, so
             * this is the safety net rather than the main path: a page that
             * predates that behaviour, or one being served in the moment
             * between the two writes. Falling through instead would render the
             * last-known name and price with a working Book button, because
             * `PricingBlock` only checks the id is a well-formed UUID — and the
             * client would fill in the entire form before the booking API told
             * them the service does not exist.
             *
             * `serviceUnavailable` is what the block reads to drop the CTA.
             */
            if (!matchingService) {
              return {
                ...block,
                content: { ...blockContent, serviceUnavailable: true }
              };
            }

            if (matchingService) {
              // Update the pricing plan with live service data
              const existingPlans = (blockContent.plans as Array<Record<string, unknown>>) || [];
              const updatedPlans = existingPlans.map(plan => ({
                ...plan,
                priceRaw: matchingService.priceRaw,
                price: matchingService.price || plan.price,
                currency: matchingService.currency,
                durationMinutes: matchingService.durationMinutes,
                // The journey too, not just the money — a landing page's
                // booking modal builds its steps from these.
                is_scheduled: matchingService.is_scheduled,
                collection: matchingService.collection,
                // On the PLAN, not only on the block.
                //
                // It was added to the block content alone, and the pricing card
                // reads `plan.paymentPlan` when it builds the service it hands
                // the booking modal — so the split reached the published page
                // and stopped one level above the thing that needed it. The
                // editor's route had it in the right place, which is why the
                // preview showed the plan and the public page did not.
                paymentPlan: matchingService.paymentPlan,
                serviceId: matchingService.id,
                serviceName: matchingService.name
              }));

              return {
                ...block,
                content: {
                  ...blockContent,
                  plans: updatedPlans,
                  priceRaw: matchingService.priceRaw,
                  currency: matchingService.currency,
                  durationMinutes: matchingService.durationMinutes,
                  serviceName: matchingService.name,
                  // Same for the CTA block a course or product is sold from.
                  is_scheduled: matchingService.is_scheduled,
                  collection: matchingService.collection,
                  // The split, where the business offers one.
                  paymentPlan: matchingService.paymentPlan,
                  allServices: liveServices
                }
              };
            }
          }
        }

        // CTA: Inject live service data for courses/products
        // Same gate, same reason as the pricing block above.
        if (block.block_type === 'cta') {
          const blockContent = block.content as Record<string, unknown>;
          const serviceId = blockContent.serviceId as string | undefined;

          if (serviceId) {
            const matchingService = liveServices.find(s => s.id === serviceId);

            // Same reasoning as the pricing block above.
            if (!matchingService) {
              return {
                ...block,
                content: { ...blockContent, serviceUnavailable: true }
              };
            }

            if (matchingService) {
              return {
                ...block,
                content: {
                  ...blockContent,
                  priceRaw: matchingService.priceRaw,
                  currency: matchingService.currency,
                  durationMinutes: matchingService.durationMinutes,
                  serviceName: matchingService.name
                }
              };
            }
          }
        }
      }

      // SERVICES: Always use live services from Scheduling capability
      if (block.block_type === 'services') {
        if (liveServices.length > 0) {
          // Get saved services to preserve hidden flags
          const savedServices = (block.content as Record<string, unknown>)?.services as Array<{ name: string; hidden?: boolean }> | undefined;
          const hiddenMap = new Map<string, boolean>();

          if (savedServices && Array.isArray(savedServices)) {
            savedServices.forEach(s => {
              if (s.name && s.hidden !== undefined) {
                hiddenMap.set(s.name, s.hidden);
              }
            });
          }

          // Merge live services with saved hidden flags, filter out hidden ones for public display
          const visibleServices = liveServices
            .map(service => ({
              ...service,
              hidden: hiddenMap.get(service.name) ?? false
            }))
            .filter(s => !s.hidden);

          return {
            ...block,
            content: {
              ...block.content,
              services: visibleServices
            }
          };
        }
        // No live services - return block with empty services
        return {
          ...block,
          content: {
            ...block.content,
            services: []
          }
        };
      }

      // For other blocks, merge central content — the SAME helper the editor
      // uses, so the site a business previews and the site its clients get
      // cannot drift apart.
      if (centralContent && sectionName && centralContent[sectionName]) {
        return {
          ...block,
          content: mergeCentralContent(
            block.content as Record<string, unknown>,
            centralContent[sectionName] as unknown as Record<string, unknown>,
            sectionName
          ),
        };
      }

      return block;
    });

    // Page views are recorded by <PageViewTracker> in the browser, not here.
    // This route is reached via an internal server-to-server fetch from
    // app/site/[subdomain]/page.tsx, so `request` carries the headers of THAT
    // request — tracking here recorded a null referrer, Node's user-agent and
    // the app server's IP for every visitor.

    return NextResponse.json({
      success: true,
      status: 'live',
      page: {
        title: pageResult.data.title,
        meta_description: pageResult.data.meta_description,
        /*
         * Completed here rather than served raw.
         *
         * ───────────────────────────────────────────────────────────────────
         * WHY THE STORED BLOB IS NOT ENOUGH
         *
         * `website_pages.theme` is whatever was written when the page was
         * created, and for most live pages that is a palette and nothing else —
         * the landing-page route used to assemble two colours plus hardcoded
         * greys, storing no `id`, no `scale`, no `layouts` and no
         * `composition`, while recording the chosen archetype in the
         * `template_id` COLUMN beside it. So the row knew it was Lumen and the
         * theme it served did not.
         *
         * Serving that blob raw is why an existing page still renders in the
         * default arrangement after a template switch: nothing in it names a
         * design, so nothing downstream can apply one. `completeTheme` merges
         * the stored values over the archetype `template_id` names, which fills
         * in exactly the four fields the renderer needs and leaves every colour
         * the owner actually chose untouched.
         */
        theme: completeTheme(pageResult.data.theme, pageResult.data.template_id),
        favicon_url: pageResult.data.favicon_url,
        og_image_url: pageResult.data.og_image_url,
        website_language: pageResult.data.website_language || 'en'
      },
      blocks: blocksWithContent
    });
  } catch (error) {
    requestLogger.error({ err: error, subdomain }, 'Failed to fetch public website');
    return NextResponse.json(
      { success: false, error: 'Failed to load website' },
      { status: 500 }
    );
  }
}
