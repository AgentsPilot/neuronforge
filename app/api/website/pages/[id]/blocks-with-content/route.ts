/**
 * Website Blocks with Central Content API
 * GET - Get page blocks with content merged from central website_content store
 *
 * This endpoint combines:
 * - Block structure (which blocks, what order) from website_blocks table
 * - Block content from central website_content table
 * - Live data from capabilities (e.g., services from Scheduling)
 *
 * This ensures content persists across template changes since
 * templates only define structure, not content.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { mergeCentralContent } from '@/lib/website-builder/mergeCentralContent';
import { resolveBusinessLogo } from '@/lib/branding/businessLogo';
import { supabaseServer } from '@/lib/supabaseServer';
import { WebsitePageRepository } from '@/lib/repositories/WebsitePageRepository';
import { WebsiteBlockRepository, WebsiteBlock } from '@/lib/repositories/WebsiteBlockRepository';
import { WebsiteContentRepository, WebsiteContent, SectionType } from '@/lib/repositories/WebsiteContentRepository';
import { SchedulingServiceRepository } from '@/lib/repositories/SchedulingRepository';
import { loadServicePaymentPlans, type ServicePaymentPlan } from '@/lib/business-os/servicePaymentPlan';

const logger = createLogger({ module: 'BlocksWithContentAPI' });

// Service icon mapping based on common service keywords
function getServiceIcon(serviceName: string): string {
  const name = serviceName.toLowerCase();
  if (name.includes('consult') || name.includes('session') || name.includes('call')) return 'MessageCircle';
  if (name.includes('coach') || name.includes('mentor')) return 'Target';
  if (name.includes('therapy') || name.includes('counsel')) return 'Heart';
  if (name.includes('class') || name.includes('workshop') || name.includes('course')) return 'GraduationCap';
  if (name.includes('massage') || name.includes('spa') || name.includes('wellness')) return 'Sparkles';
  if (name.includes('fitness') || name.includes('training') || name.includes('workout')) return 'Dumbbell';
  if (name.includes('design') || name.includes('creative')) return 'Palette';
  if (name.includes('photo') || name.includes('video')) return 'Camera';
  if (name.includes('legal') || name.includes('law')) return 'Scale';
  if (name.includes('finance') || name.includes('account') || name.includes('tax')) return 'Calculator';
  if (name.includes('tech') || name.includes('development') || name.includes('code')) return 'Code';
  if (name.includes('marketing') || name.includes('seo') || name.includes('ads')) return 'TrendingUp';
  return 'Star';
}

// Format price for display
function formatPrice(price: number, currency?: string): string {
  const symbols: Record<string, string> = { USD: '$', EUR: '€', ILS: '₪', GBP: '£' };
  const symbol = symbols[currency || 'USD'] || '$';
  return `${symbol}${price.toFixed(0)}`;
}

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
  'payment_button': 'payment_button',
  'intake_form': 'intake_form'
};

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: pageId } = await params;
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const pageRepo = new WebsitePageRepository(supabaseServer);
    const blockRepo = new WebsiteBlockRepository(supabaseServer);
    const contentRepo = new WebsiteContentRepository(supabaseServer);

    // Verify page ownership
    const pageResult = await pageRepo.findById(pageId, user.id);
    if (pageResult.error || !pageResult.data) {
      return NextResponse.json({ success: false, error: 'Page not found' }, { status: 404 });
    }

    const page = pageResult.data;
    const isLandingPage = page.page_type === 'landing';

    // Get blocks for this page
    const blocksResult = await blockRepo.findByPageId(pageId);
    if (blocksResult.error) {
      throw blocksResult.error;
    }

    const blocks = blocksResult.data || [];

    // For landing pages, use block content directly (AI-generated content is stored in blocks)
    // Only fetch central content for homepage/main website pages
    let centralContent: WebsiteContent | null = null;
    if (!isLandingPage) {
      // Read, never create. Materialising the row here filled it with the
      // table's English column defaults, which then outranked the generated
      // block content in the merge below — so simply opening the editor turned
      // a Hebrew site English.
      const contentResult = await contentRepo.findByUserId(user.id);
      if (contentResult.error) {
        // Degrade to block content instead of 500ing the whole endpoint. This
        // is the only source of the editor's section list: throwing here left
        // the page with no sections at all and nothing saying why.
        requestLogger.error(
          { err: contentResult.error, userId: user.id },
          'Central content unavailable; falling back to block content'
        );
      } else {
        centralContent = contentResult.data;
      }
    }

    // Always fetch live services from Scheduling capability for services/pricing blocks
    // This ensures only active services are shown and reflects any changes in real-time
    let liveServices: Array<{
      id: string; name: string; description: string; icon: string;
      price?: string; priceRaw?: number; currency?: string;
      duration?: string; durationMinutes?: number | null;
      /** The two facts every surface builds this service's journey from. */
      is_scheduled?: boolean; collection?: 'online' | 'invoice' | null;
      /** How this service may be paid over time, when the business offers it. */
      paymentPlan?: ServicePaymentPlan;
      hidden?: boolean;
    }> = [];
    const hasServicesBlock = blocks.some(b => b.block_type === 'services');
    const hasPricingBlock = blocks.some(b => b.block_type === 'pricing');

    // Fetch live services if we have services block OR pricing block (for landing pages)
    if (hasServicesBlock || hasPricingBlock) {
      try {
        const schedulingRepo = new SchedulingServiceRepository(supabaseServer);
        // Both in one pass, and the same pair the public route loads — the
        // editor and the live site must describe a service identically.
        const [servicesResult, plansByService] = await Promise.all([
          schedulingRepo.listAll(user.id, true), // active only
          loadServicePaymentPlans(user.id),
        ]);
        if (servicesResult.data && servicesResult.data.length > 0) {
          liveServices = servicesResult.data.map(s => ({
            id: s.id,
            name: s.service_name,
            description: s.description || '',
            icon: getServiceIcon(s.service_name),
            price: s.price ? formatPrice(s.price, s.currency) : undefined,
            priceRaw: s.price || undefined,
            currency: s.currency,
            duration: s.duration_minutes ? `${s.duration_minutes} min` : undefined,
            durationMinutes: s.duration_minutes,
            /*
             * The two facts that decide this service's journey.
             *
             * They were missing here while the PUBLIC route already carried
             * them, so the editor and the live site computed different
             * journeys from the same services. Worse than merely absent:
             * `journeySteps` reads an undefined `is_scheduled` as "yes" and an
             * undefined `collection` as "takes a card", so every service in the
             * editor looked like a paid appointment — including a free product.
             *
             * This mapping replaces the stored block content wholesale, so
             * dropping them here also discarded the facts generation had
             * written into the block.
             */
            is_scheduled: s.is_scheduled !== false,
            collection: s.collection ?? null,
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

    // The editor previews what visitors will see, so the header's logo is
    // injected from the business profile here exactly as the public route does.
    // The block itself only stores `show_logo`.
    const headerShowsLogo = blocks.some(
      b => b.block_type === 'header' && (b.content as Record<string, unknown>)?.show_logo === true
    );
    const businessLogoUrl = headerShowsLogo ? await resolveBusinessLogo(user.id) : null;

    // Merge central content into blocks (only for homepage/main website, not landing pages)
    const blocksWithContent: WebsiteBlock[] = blocks.map(block => {
      if (block.block_type === 'header') {
        const headerContent = block.content as Record<string, unknown>;
        return {
          ...block,
          content: {
            ...headerContent,
            logo_url: headerContent?.show_logo === true && businessLogoUrl ? businessLogoUrl : undefined,
          },
        };
      }

      // For landing pages, use block content directly (AI-generated content stored in blocks)
      // BUT inject live service data for pricing blocks so prices stay current
      if (isLandingPage) {
        // For pricing blocks, inject live service data from Scheduling
        if (block.block_type === 'pricing' && liveServices.length > 0) {
          const blockContent = block.content as Record<string, unknown>;
          const serviceId = blockContent.serviceId as string | undefined;

          // Find the matching service from live data
          if (serviceId) {
            const matchingService = liveServices.find(s => s.id === serviceId);
            if (matchingService) {
              /*
               * The plans that belong to THIS page.
               *
               * A landing page is about one service, and its plan carries that
               * service's id from the moment it is created. Publishing used to
               * run the pricing block through catalogue enrichment, which
               * replaced those plans with every priced service the business has
               * — each without a `serviceId`, so their buttons could not open
               * the booking modal, and one of them arbitrarily marked
               * "popular". Enrichment no longer does that, and dropping the
               * strays here means pages published before the fix stop showing
               * them without anyone having to edit the row.
               *
               * Only ever narrows to plans that match, and only when at least
               * one does — a page whose plans predate service ids keeps them.
               */
              const allPlans = (blockContent.plans as Array<Record<string, unknown>>) || [];
              const ownPlans = allPlans.filter(plan => plan.serviceId === serviceId);

              /*
               * Where the plans do not identify themselves, rebuild the one.
               *
               * Publishing used to run a landing page's pricing block through
               * catalogue enrichment, which REPLACED its plans with every
               * priced service the business has — none carrying a `serviceId`,
               * one arbitrarily marked "popular", and every button pointing at
               * a bare `/booking` link instead of opening the booking modal.
               * Enrichment no longer does that, but pages published before the
               * fix still hold the catalogue.
               *
               * The block knows which service it is about, and that service is
               * loaded right here. So a landing page whose plans have lost
               * their id gets one plan rebuilt from its own service, which is
               * what its pricing section is supposed to be. A page whose plans
               * DO identify themselves is left alone.
               */
              const rebuiltPlan = isLandingPage && ownPlans.length === 0 && allPlans.length > 0;
              const existingPlans = ownPlans.length > 0
                ? ownPlans
                : rebuiltPlan
                  ? [{
                      name: matchingService.name,
                      description: matchingService.description,
                      price: matchingService.price,
                    }]
                  : allPlans;

              if (rebuiltPlan) {
                requestLogger.info(
                  { pageId, replaced: allPlans.length },
                  'Rebuilt a landing page pricing plan from its own service'
                );
              }
              const updatedPlans = existingPlans.map(plan => {
                // `features` is dropped, not carried through. The generator used
                // to ask the model for four bullet "inclusions" per plan and it
                // duly invented them — "an hour long", "tailored to your needs",
                // "immediate results", "good value" — copy about a service that
                // says nothing the service itself does not, and one bullet of
                // which merely restated the duration. Dropping it here rather
                // than migrating means pages generated under the old prompt stop
                // showing them on their next read.
                const { features: _discardedFeatures, ...rest } = plan;

                return {
                  ...rest,
                  // The service's own words, kept current the same way its price
                  // is. This is what replaces the invented bullets.
                  description: matchingService.description || rest.description,
                  priceRaw: matchingService.priceRaw,
                  price: matchingService.price || rest.price,
                  currency: matchingService.currency,
                  durationMinutes: matchingService.durationMinutes,
                  // The journey too, not just the money — a landing page's
                  // booking modal builds its steps from these.
                  is_scheduled: matchingService.is_scheduled,
                  collection: matchingService.collection,
                  // The split, where the business offers one.
                  paymentPlan: matchingService.paymentPlan,
                  serviceId: matchingService.id,
                  serviceName: matchingService.name
                };
              });

              return {
                ...block,
                content: {
                  ...blockContent,
                  plans: updatedPlans,
                  // Also update block-level service info
                  priceRaw: matchingService.priceRaw,
                  currency: matchingService.currency,
                  durationMinutes: matchingService.durationMinutes,
                  serviceName: matchingService.name,
                  // Same for the CTA block a course or product is sold from.
                  is_scheduled: matchingService.is_scheduled,
                  collection: matchingService.collection,
                  // Include all services for landing pages that show service list
                  allServices: liveServices
                }
              };
            }
          }
        }

        // For CTA blocks (used instead of booking for courses), inject live service data
        if (block.block_type === 'cta' && liveServices.length > 0) {
          const blockContent = block.content as Record<string, unknown>;
          const serviceId = blockContent.serviceId as string | undefined;

          if (serviceId) {
            const matchingService = liveServices.find(s => s.id === serviceId);
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

        return block;
      }

      const sectionName = BLOCK_TO_SECTION_MAP[block.block_type];

      // SERVICES: Always use live services from Scheduling capability
      // Merge with saved hidden flags from block content
      // PROCESS: Use block content directly (page-specific flow/steps)
      // (HEADER is handled above, where the business logo is injected.)
      if (block.block_type === 'process') {
        // These blocks store page-specific content that should not be merged with central content
        return block;
      }

      if (block.block_type === 'services') {
        if (liveServices.length > 0) {
          // Get saved services to preserve hidden flags
          const savedServices = (block.content as Record<string, unknown>)?.services as Array<{ name: string; hidden?: boolean }> | undefined;
          const hiddenMap = new Map<string, boolean>();

          // Build map of hidden flags by service name
          if (savedServices && Array.isArray(savedServices)) {
            savedServices.forEach(s => {
              if (s.name && s.hidden !== undefined) {
                hiddenMap.set(s.name, s.hidden);
              }
            });
          }

          // Merge live services with saved hidden flags
          const mergedServices = liveServices.map(service => ({
            ...service,
            hidden: hiddenMap.get(service.name) ?? false
          }));

          return {
            ...block,
            content: {
              ...block.content,
              services: mergedServices
            }
          };
        }
        // No live services - return block with empty services (not mockups)
        return {
          ...block,
          content: {
            ...block.content,
            services: []
          }
        };
      }

      if (sectionName && centralContent && centralContent[sectionName]) {
        return {
          ...block,
          content: mergeCentralContent(
            block.content as Record<string, unknown>,
            centralContent[sectionName] as unknown as Record<string, unknown>,
            sectionName
          ),
        };
      }

      // No central content for this block type, use block's own content
      return block;
    });

    // Normalize blocks to ensure `enabled` is always a proper boolean (defaults to true if null/undefined)
    const normalizedBlocks = blocksWithContent.map(block => ({
      ...block,
      enabled: block.enabled !== false // Treat null/undefined as true
    }));

    requestLogger.info(
      { pageId, userId: user.id, blockCount: normalizedBlocks.length, isLandingPage },
      isLandingPage ? 'Fetched blocks for landing page (no central content merge)' : 'Fetched blocks with central content'
    );

    return NextResponse.json({
      success: true,
      page: pageResult.data,
      blocks: normalizedBlocks,
      centralContentId: centralContent?.id || null
    });
  } catch (error) {
    requestLogger.error({ err: error, pageId }, 'Failed to get blocks with content');
    return NextResponse.json(
      { success: false, error: 'Failed to get blocks' },
      { status: 500 }
    );
  }
}
