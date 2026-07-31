/**
 * Website Pages API
 * GET - List all pages for the user
 * POST - Create a new page from template
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { WebsitePageRepository, WebsitePageInsert, PageTheme } from '@/lib/repositories/WebsitePageRepository';
import { WebsiteBlockRepository, WebsiteBlockInsert } from '@/lib/repositories/WebsiteBlockRepository';
import { getTemplateById, getStandardHomepageBlocks, WebsiteTemplate } from '@/lib/website-builder/templates';
import { BuildingBlock } from '@/lib/website-builder/building-blocks';
import { websiteBlockEnrichmentService } from '@/lib/services/WebsiteBlockEnrichmentService';
import { translateBlockContent } from '@/lib/i18n/website-block-translations';
import type { Locale } from '@/lib/i18n/config';
import { z } from 'zod';

const logger = createLogger({ module: 'WebsitePagesAPI' });

const CreatePageSchema = z.object({
  title: z.string().min(1).max(100),
  page_type: z.enum(['homepage', 'landing', 'about', 'services', 'blog_post']).default('homepage'),
  slug: z.string().min(1).max(100).optional(),
  template_id: z.string().optional(), // Template ID like 'therapist_warm_welcoming'
  subdomain: z.string().min(3).max(30).optional(),
  website_language: z.enum(['en', 'es', 'he']).default('en'), // Language for content generation
  enrich_with_business_data: z.boolean().default(true), // Auto-enrich blocks with real business data
  blocks: z.array(z.object({
    block_type: z.string(),
    content: z.record(z.unknown()),
    styles: z.record(z.unknown()).optional(),
    position: z.number().optional()
  })).optional()
});

/**
 * Convert a template's BuildingBlock to WebsiteBlockInsert format
 * NOTE: Services are stripped - they come from Scheduling capability.
 * Other content is kept as template defaults until user customizes.
 * Content is translated based on the page's website_language setting.
 */
function convertTemplateBlockToInsert(
  block: BuildingBlock,
  pageId: string,
  position: number,
  locale: Locale = 'en'
): WebsiteBlockInsert {
  const rawContent = block.content as Record<string, unknown>;

  // Translate content based on page language
  const content = translateBlockContent(rawContent, locale);

  // For services block, strip mockup services - real services come from Scheduling
  if (block.block_type === 'services') {
    const { services, ...rest } = content;
    return {
      page_id: pageId,
      block_type: block.block_type as WebsiteBlockInsert['block_type'],
      content: rest as WebsiteBlockInsert['content'],
      styles: (block.styles || {}) as WebsiteBlockInsert['styles'],
      position,
      enabled: true
    };
  }

  // For other blocks, keep translated template content as defaults
  return {
    page_id: pageId,
    block_type: block.block_type as WebsiteBlockInsert['block_type'],
    content: content as WebsiteBlockInsert['content'],
    styles: (block.styles || {}) as WebsiteBlockInsert['styles'],
    position,
    enabled: true
  };
}

/**
 * Convert template theme to PageTheme format
 */
function convertTemplateTheme(template: WebsiteTemplate): PageTheme {
  // Use explicit font_heading/font_body if available, otherwise fallback to font_family
  const headingFont = template.theme.font_heading || template.theme.font_family.split(',')[0].trim();
  const bodyFont = template.theme.font_body || template.theme.font_family.split(',')[0].trim();

  // Determine background and text colors (support dark templates)
  const isDarkTemplate = template.theme.background_color &&
    (template.theme.background_color.startsWith('#0') ||
     template.theme.background_color.startsWith('#1') ||
     template.theme.background_color === '#000000');

  const backgroundColor = template.theme.background_color || '#ffffff';
  const textColor = template.theme.text_color || (isDarkTemplate ? '#ffffff' : '#1a1a1a');
  const textSecondary = isDarkTemplate ? '#9ca3af' : '#6b7280';
  const surfaceColor = isDarkTemplate ? '#1f2937' : '#f9fafb';

  return {
    colors: {
      primary: template.theme.primary_color,
      secondary: template.theme.secondary_color,
      accent: template.theme.accent_color || template.theme.secondary_color,
      background: backgroundColor,
      surface: surfaceColor,
      text: textColor,
      textSecondary: textSecondary
    },
    fonts: {
      heading: headingFont,
      body: bodyFont
    },
    spacing: 'normal',
    borderRadius: '8px'
  };
}

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const pageRepo = new WebsitePageRepository(supabaseServer);
    const result = await pageRepo.listByUser(user.id);

    if (result.error) {
      throw result.error;
    }

    return NextResponse.json({ success: true, pages: result.data });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to list pages');
    return NextResponse.json(
      { success: false, error: 'Failed to list pages' },
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
    const validated = CreatePageSchema.parse(body);

    const pageRepo = new WebsitePageRepository(supabaseServer);
    const blockRepo = new WebsiteBlockRepository(supabaseServer);

    // Look up template if provided
    let template: WebsiteTemplate | undefined;
    if (validated.template_id) {
      template = getTemplateById(validated.template_id);
      if (!template) {
        return NextResponse.json(
          { success: false, error: 'Template not found' },
          { status: 404 }
        );
      }
      requestLogger.info({ templateId: validated.template_id, templateName: template.name }, 'Using template');
    }

    // Generate slug if not provided
    const slug = validated.slug || `/${validated.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;

    // Create page with template theme if available
    // Note: template_id is stored as the string identifier (e.g., 'therapist_warm_welcoming')
    // not as a UUID reference to the database templates table
    const pageData: WebsitePageInsert = {
      user_id: user.id,
      page_type: validated.page_type,
      slug,
      title: validated.title,
      template_id: validated.template_id || null, // String ID like 'therapist_modern_minimal'
      subdomain: validated.subdomain || null,
      status: 'draft',
      theme: template ? convertTemplateTheme(template) : undefined,
      website_language: validated.website_language
    };

    const pageResult = await pageRepo.create(pageData);

    if (pageResult.error || !pageResult.data) {
      throw pageResult.error || new Error('Failed to create page');
    }

    // Determine which blocks to create
    // All homepage templates use the SAME standard block structure
    // Templates only define the visual theme (colors, fonts)
    let blocksToCreate: WebsiteBlockInsert[] = [];

    if (validated.page_type === 'homepage') {
      // Use STANDARD homepage blocks (same for all templates)
      // Templates only change the theme, not which sections exist
      const standardBlocks = getStandardHomepageBlocks();
      blocksToCreate = standardBlocks.map((block, index) =>
        convertTemplateBlockToInsert(block, pageResult.data!.id, index, validated.website_language as Locale)
      );
      requestLogger.info({
        blockCount: blocksToCreate.length,
        language: validated.website_language,
        templateId: validated.template_id || 'default'
      }, 'Creating standard homepage blocks');
    } else if (validated.blocks && validated.blocks.length > 0) {
      // Use provided blocks for non-homepage page types
      blocksToCreate = validated.blocks.map((block, index) => ({
        page_id: pageResult.data!.id,
        block_type: block.block_type as WebsiteBlockInsert['block_type'],
        content: block.content as WebsiteBlockInsert['content'],
        styles: block.styles as WebsiteBlockInsert['styles'],
        position: block.position ?? index,
        enabled: true
      }));
    }

    // Enrich blocks with real business data (services, profile, stats, etc.)
    if (validated.enrich_with_business_data && blocksToCreate.length > 0) {
      requestLogger.info({ userId: user.id }, 'Enriching blocks with business data');
      try {
        const blocksForEnrichment = blocksToCreate.map(b => ({
          block_type: b.block_type,
          content: b.content as Record<string, unknown>,
          position: b.position
        }));

        // Use the page's language for localized content
        const enrichedBlocks = await websiteBlockEnrichmentService.enrichBlocks(user.id, blocksForEnrichment, validated.website_language, false, user.email);

        // Update blocksToCreate with enriched content
        blocksToCreate = blocksToCreate.map((block, index) => ({
          ...block,
          content: enrichedBlocks[index].content as WebsiteBlockInsert['content']
        }));

        const enrichedCount = enrichedBlocks.filter(b => b.enriched).length;
        requestLogger.info({ enrichedCount, totalBlocks: blocksToCreate.length }, 'Blocks enriched with business data');
      } catch (enrichError) {
        requestLogger.warn({ err: enrichError }, 'Block enrichment failed, using template defaults');
        // Continue with template defaults if enrichment fails
      }
    }

    // Create blocks
    if (blocksToCreate.length > 0) {
      const blocksResult = await blockRepo.bulkCreate(blocksToCreate);
      if (blocksResult.error) {
        requestLogger.warn({ err: blocksResult.error }, 'Failed to create blocks');
      }
    }

    requestLogger.info({ pageId: pageResult.data.id, userId: user.id, templateUsed: !!template }, 'Created website page');

    return NextResponse.json({
      success: true,
      page: pageResult.data
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid input', details: error.errors },
        { status: 400 }
      );
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    requestLogger.error({ err: error, errorMessage, errorStack }, 'Failed to create page');

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to create page',
        details: process.env.NODE_ENV === 'development' ? errorMessage : undefined
      },
      { status: 500 }
    );
  }
}
