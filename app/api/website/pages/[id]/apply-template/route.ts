/**
 * Apply Template to Existing Page API
 * POST - Apply a new template to an existing page
 *
 * ARCHITECTURE:
 * - Templates define ONLY visual styling (theme: colors, fonts, brand_voice)
 * - STANDARD_HOMEPAGE_BLOCKS defines the fixed section structure (same for all templates)
 * - Services come from Scheduling capability, not templates
 * - Content comes from central website_content table
 * - Applying a template = changing theme + ensuring standard blocks exist
 * - User's header customizations are preserved across template changes
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { WebsitePageRepository, PageTheme } from '@/lib/repositories/WebsitePageRepository';
import { WebsiteBlockRepository, WebsiteBlockInsert } from '@/lib/repositories/WebsiteBlockRepository';
import { getTemplateById, getStandardHomepageBlocks, WebsiteTemplate } from '@/lib/website-builder/templates';
import { BuildingBlock } from '@/lib/website-builder/building-blocks';
import { translateBlockContent } from '@/lib/i18n/website-block-translations';
import type { Locale } from '@/lib/i18n/config';
import { z } from 'zod';

const logger = createLogger({ module: 'ApplyTemplateAPI' });

const ApplyTemplateSchema = z.object({
  template_id: z.string().min(1)
});

/**
 * Convert a template's BuildingBlock to WebsiteBlockInsert format
 * NOTE: Services are stripped - they come from Scheduling capability.
 * Other content is kept as template defaults until user customizes.
 * Central content (website_content table) is merged on top at read time.
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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { id: pageId } = await params;

    const body = await request.json();
    const validated = ApplyTemplateSchema.parse(body);

    const pageRepo = new WebsitePageRepository(supabaseServer);
    const blockRepo = new WebsiteBlockRepository(supabaseServer);

    // Verify user owns this page
    const existingPage = await pageRepo.findById(pageId, user.id);
    if (existingPage.error || !existingPage.data) {
      return NextResponse.json(
        { success: false, error: 'Page not found' },
        { status: 404 }
      );
    }

    // Look up template
    const template = getTemplateById(validated.template_id);
    if (!template) {
      return NextResponse.json(
        { success: false, error: 'Template not found' },
        { status: 404 }
      );
    }

    requestLogger.info({
      pageId,
      templateId: validated.template_id,
      templateName: template.name,
      userId: user.id
    }, 'Applying template to existing page');

    // Get existing blocks to preserve header content
    const existingBlocksResult = await blockRepo.findByPageId(pageId);
    const existingHeaderBlock = existingBlocksResult.data?.find(b => b.block_type === 'header');
    const existingHeaderContent = existingHeaderBlock?.content as Record<string, unknown> | undefined;

    // Delete existing blocks
    const deleteResult = await blockRepo.deleteByPageId(pageId);
    if (deleteResult.error) {
      requestLogger.warn({ err: deleteResult.error }, 'Failed to delete existing blocks');
    }

    // Update page with new template and theme
    const updateResult = await pageRepo.update(pageId, user.id, {
      template_id: validated.template_id,
      theme: convertTemplateTheme(template)
    });

    if (updateResult.error) {
      throw updateResult.error;
    }

    // Create new blocks from STANDARD structure (same for all templates)
    // Templates only change the theme, not which sections exist
    // Preserve existing header content if it was customized
    const pageLanguage = (existingPage.data.website_language || 'en') as Locale;
    const standardBlocks = getStandardHomepageBlocks();

    if (standardBlocks.length > 0) {
      const blocksToCreate = standardBlocks.map((block, index) => {
        const baseBlock = convertTemplateBlockToInsert(block, pageId, index, pageLanguage);

        // Preserve existing header content (menu items, logo, CTA) if it exists
        if (block.block_type === 'header' && existingHeaderContent) {
          return {
            ...baseBlock,
            content: {
              ...baseBlock.content,
              ...existingHeaderContent // User's customizations on top
            } as typeof baseBlock.content
          };
        }

        return baseBlock;
      });

      const blocksResult = await blockRepo.bulkCreate(blocksToCreate);
      if (blocksResult.error) {
        requestLogger.warn({ err: blocksResult.error }, 'Failed to create standard blocks');
      } else {
        requestLogger.info({ blockCount: blocksToCreate.length, headerPreserved: !!existingHeaderContent }, 'Created standard blocks with template theme');
      }
    }

    // Fetch updated page
    const updatedPage = await pageRepo.findById(pageId, user.id);

    requestLogger.info({
      pageId,
      templateApplied: validated.template_id,
      userId: user.id
    }, 'Successfully applied template to page');

    return NextResponse.json({
      success: true,
      page: updatedPage.data
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid input', details: error.errors },
        { status: 400 }
      );
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    requestLogger.error({ err: error, errorMessage }, 'Failed to apply template');

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to apply template',
        details: process.env.NODE_ENV === 'development' ? errorMessage : undefined
      },
      { status: 500 }
    );
  }
}
