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
import { createLogger } from '@/lib/logger';
import { resolveBusinessLogo } from '@/lib/branding/businessLogo';
import { supabaseServer } from '@/lib/supabaseServer';
import { WebsitePageRepository } from '@/lib/repositories/WebsitePageRepository';
import { WebsiteBlockRepository, WebsiteBlock } from '@/lib/repositories/WebsiteBlockRepository';
import { WebsiteContentRepository, WebsiteContent, SectionType } from '@/lib/repositories/WebsiteContentRepository';
import { SchedulingServiceRepository } from '@/lib/repositories/SchedulingRepository';

const logger = createLogger({ module: 'PublicWebsiteAPI' });

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

    // Find live page by subdomain
    const pageResult = await pageRepo.findBySubdomain(subdomain);

    if (pageResult.error || !pageResult.data) {
      // Return coming soon page data
      return NextResponse.json({
        success: true,
        status: 'coming_soon',
        subdomain
      });
    }

    const userId = pageResult.data.user_id;

    // Get enabled blocks only
    const blocksResult = await blockRepo.findByPageId(pageResult.data.id, true);
    const blocks = blocksResult.data || [];

    // Get central content
    const contentResult = await contentRepo.getOrCreate(userId);
    const centralContent = contentResult.data as WebsiteContent | null;

    // Check page type for landing page specific logic
    const isLandingPage = pageResult.data.page_type === 'landing';

    // Fetch live services from Scheduling capability
    // Needed for services blocks AND pricing/CTA blocks (for live pricing data)
    let liveServices: Array<{
      id: string; name: string; description: string; icon: string;
      price?: string; priceRaw?: number; currency?: string;
      duration?: string; durationMinutes?: number | null;
      /** The two facts a booking journey is built from. */
      is_scheduled?: boolean; collection?: 'online' | 'invoice' | null;
      hidden?: boolean;
    }> = [];
    const hasServicesBlock = blocks.some(b => b.block_type === 'services');
    const hasPricingBlock = blocks.some(b => b.block_type === 'pricing');
    const hasCtaBlock = blocks.some(b => b.block_type === 'cta');

    // Fetch live services if we have services, pricing, or CTA blocks
    if (hasServicesBlock || hasPricingBlock || hasCtaBlock) {
      try {
        const schedulingRepo = new SchedulingServiceRepository(supabaseServer);
        const servicesResult = await schedulingRepo.listAll(userId, true); // active only
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
            // The two facts the booking widget builds its journey from. Without
            // them the website decided from the price alone and asked an
            // invoiced client for a card.
            is_scheduled: s.is_scheduled !== false,
            collection: s.collection ?? null,
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

    // Merge central content into blocks
    const blocksWithContent: WebsiteBlock[] = blocks.map(block => {
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
        if (block.block_type === 'pricing' && liveServices.length > 0) {
          const blockContent = block.content as Record<string, unknown>;
          const serviceId = blockContent.serviceId as string | undefined;

          if (serviceId) {
            const matchingService = liveServices.find(s => s.id === serviceId);
            if (matchingService) {
              // Update the pricing plan with live service data
              const existingPlans = (blockContent.plans as Array<Record<string, unknown>>) || [];
              const updatedPlans = existingPlans.map(plan => ({
                ...plan,
                priceRaw: matchingService.priceRaw,
                price: matchingService.price || plan.price,
                currency: matchingService.currency,
                durationMinutes: matchingService.durationMinutes,
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
                  allServices: liveServices
                }
              };
            }
          }
        }

        // CTA: Inject live service data for courses/products
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

      // For other blocks, merge central content
      if (centralContent && sectionName && centralContent[sectionName]) {
        const sectionContent = centralContent[sectionName] as Record<string, unknown>;

        // Only merge non-empty values from central content
        const nonEmptyContent: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(sectionContent)) {
          if (value === '' || value === null || value === undefined) continue;
          if (Array.isArray(value) && value.length === 0) continue;
          nonEmptyContent[key] = value;
        }

        // Map field names between central content and block content
        if (sectionName === 'about' && nonEmptyContent.about_text) {
          nonEmptyContent.content = nonEmptyContent.about_text;
          delete nonEmptyContent.about_text;
        }

        return {
          ...block,
          content: {
            ...block.content,
            ...nonEmptyContent
          }
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
        theme: pageResult.data.theme,
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
