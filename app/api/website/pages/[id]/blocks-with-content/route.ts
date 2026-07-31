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
import { supabaseServer } from '@/lib/supabaseServer';
import { WebsitePageRepository } from '@/lib/repositories/WebsitePageRepository';
import { WebsiteBlockRepository, WebsiteBlock } from '@/lib/repositories/WebsiteBlockRepository';
import { WebsiteContentRepository, WebsiteContent, SectionType } from '@/lib/repositories/WebsiteContentRepository';
import { SchedulingServiceRepository } from '@/lib/repositories/SchedulingRepository';

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

    // Get blocks for this page
    const blocksResult = await blockRepo.findByPageId(pageId);
    if (blocksResult.error) {
      throw blocksResult.error;
    }

    // Get central content
    const contentResult = await contentRepo.getOrCreate(user.id);
    if (contentResult.error) {
      throw contentResult.error;
    }

    const centralContent = contentResult.data as WebsiteContent;
    const blocks = blocksResult.data || [];

    // Always fetch live services from Scheduling capability for services blocks
    // This ensures only active services are shown and reflects any changes in real-time
    let liveServices: Array<{ id: string; name: string; description: string; icon: string; price?: string; priceRaw?: number; currency?: string; duration?: string; durationMinutes?: number }> = [];
    const hasServicesBlock = blocks.some(b => b.block_type === 'services');

    if (hasServicesBlock) {
      try {
        const schedulingRepo = new SchedulingServiceRepository(supabaseServer);
        const servicesResult = await schedulingRepo.listAll(user.id, true); // active only
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
      // Merge with saved hidden flags from block content
      // PROCESS: Use block content directly (page-specific flow/steps)
      // HEADER: Use block content directly (page-specific menu/logo)
      if (block.block_type === 'process' || block.block_type === 'header') {
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

      if (sectionName && centralContent[sectionName]) {
        // Get central content for this section
        const sectionContent = centralContent[sectionName] as Record<string, unknown>;

        // Only merge non-empty values from central content
        // This prevents empty defaults from overwriting template content
        const nonEmptyContent: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(sectionContent)) {
          // Skip empty strings, empty arrays, null, undefined
          if (value === '' || value === null || value === undefined) continue;
          if (Array.isArray(value) && value.length === 0) continue;
          nonEmptyContent[key] = value;
        }

        // Map field names between central content and block content
        // Central uses about_text, block expects content
        if (sectionName === 'about' && nonEmptyContent.about_text) {
          nonEmptyContent.content = nonEmptyContent.about_text;
          delete nonEmptyContent.about_text;
        }

        // Merge: block content as base, non-empty central content on top
        const mergedContent = {
          ...block.content,
          ...nonEmptyContent
        };

        return {
          ...block,
          content: mergedContent
        };
      }

      // No central content for this block type, use block's own content
      return block;
    });

    requestLogger.info(
      { pageId, userId: user.id, blockCount: blocksWithContent.length },
      'Fetched blocks with central content'
    );

    return NextResponse.json({
      success: true,
      page: pageResult.data,
      blocks: blocksWithContent,
      centralContentId: centralContent.id
    });
  } catch (error) {
    requestLogger.error({ err: error, pageId }, 'Failed to get blocks with content');
    return NextResponse.json(
      { success: false, error: 'Failed to get blocks' },
      { status: 500 }
    );
  }
}
