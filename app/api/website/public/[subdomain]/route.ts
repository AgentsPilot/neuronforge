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

    // Fetch live services from Scheduling capability
    let liveServices: Array<{ name: string; description: string; icon: string; price?: string; duration?: string }> = [];
    const hasServicesBlock = blocks.some(b => b.block_type === 'services');

    if (hasServicesBlock) {
      try {
        const schedulingRepo = new SchedulingServiceRepository(supabaseServer);
        const servicesResult = await schedulingRepo.listAll(userId, true); // active only
        if (servicesResult.data && servicesResult.data.length > 0) {
          liveServices = servicesResult.data.map(s => ({
            name: s.service_name,
            description: s.description || '',
            icon: getServiceIcon(s.service_name),
            price: s.price ? formatPrice(s.price, s.currency) : undefined,
            duration: s.duration_minutes ? `${s.duration_minutes} min` : undefined,
            hidden: false
          }));
        }
      } catch (err) {
        requestLogger.warn({ err }, 'Failed to fetch live services');
      }
    }

    // Merge central content into blocks
    const blocksWithContent: WebsiteBlock[] = blocks.map(block => {
      const sectionName = BLOCK_TO_SECTION_MAP[block.block_type];

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

    // Track page view (non-blocking)
    trackPageView(subdomain, request).catch(err =>
      requestLogger.warn({ err }, 'Failed to track page view')
    );

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

// Track page view for analytics (future feature)
async function trackPageView(subdomain: string, request: NextRequest): Promise<void> {
  // TODO: Implement analytics tracking
  // For now, just log it
  const userAgent = request.headers.get('user-agent') || 'unknown';
  const referer = request.headers.get('referer') || 'direct';

  logger.debug({ subdomain, userAgent, referer }, 'Page view');
}
