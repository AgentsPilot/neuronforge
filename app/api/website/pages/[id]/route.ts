/**
 * Website Page API
 * GET - Get page by ID
 * PUT - Update page
 * DELETE - Delete page
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { WebsitePageRepository, WebsitePageUpdate } from '@/lib/repositories/WebsitePageRepository';
import { WebsiteBlockRepository } from '@/lib/repositories/WebsiteBlockRepository';
import { z } from 'zod';

const logger = createLogger({ module: 'WebsitePageAPI' });

const UpdatePageSchema = z.object({
  title: z.string().min(1).max(100).optional(),
  page_type: z.enum(['homepage', 'landing', 'about', 'services', 'blog_post']).optional(),
  slug: z.string().min(1).max(100).optional(),
  meta_description: z.string().max(160).nullable().optional(),
  seo_keywords: z.array(z.string()).optional(),
  subdomain: z.string().min(3).max(30).nullable().optional(),
  custom_domain: z.string().nullable().optional(),
  website_language: z.enum(['en', 'es', 'he']).optional(),
  theme: z.object({
    colors: z.object({
      primary: z.string(),
      secondary: z.string(),
      accent: z.string(),
      background: z.string(),
      surface: z.string(),
      text: z.string(),
      textSecondary: z.string()
    }).optional(),
    fonts: z.object({
      heading: z.string(),
      body: z.string()
    }).optional(),
    borderRadius: z.string().optional(),
    spacing: z.enum(['compact', 'normal', 'spacious']).optional()
  }).nullable().optional(),
  favicon_url: z.string().nullable().optional(),
  og_image_url: z.string().nullable().optional()
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const pageRepo = new WebsitePageRepository(supabaseServer);
    const blockRepo = new WebsiteBlockRepository(supabaseServer);

    const pageResult = await pageRepo.findById(id, user.id);
    if (pageResult.error || !pageResult.data) {
      return NextResponse.json({ success: false, error: 'Page not found' }, { status: 404 });
    }

    const blocksResult = await blockRepo.findByPageId(id);

    return NextResponse.json({
      success: true,
      page: pageResult.data,
      blocks: blocksResult.data || []
    });
  } catch (error) {
    requestLogger.error({ err: error, id }, 'Failed to get page');
    return NextResponse.json(
      { success: false, error: 'Failed to get page' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const validated = UpdatePageSchema.parse(body);

    const pageRepo = new WebsitePageRepository(supabaseServer);

    const updates: WebsitePageUpdate = {};
    if (validated.title !== undefined) updates.title = validated.title;
    if (validated.page_type !== undefined) updates.page_type = validated.page_type;
    if (validated.slug !== undefined) updates.slug = validated.slug;
    if (validated.meta_description !== undefined) updates.meta_description = validated.meta_description;
    if (validated.seo_keywords !== undefined) updates.seo_keywords = validated.seo_keywords;
    if (validated.subdomain !== undefined) updates.subdomain = validated.subdomain;
    if (validated.custom_domain !== undefined) updates.custom_domain = validated.custom_domain;
    if (validated.theme !== undefined) updates.theme = validated.theme;
    if (validated.favicon_url !== undefined) updates.favicon_url = validated.favicon_url;
    if (validated.og_image_url !== undefined) updates.og_image_url = validated.og_image_url;
    if (validated.website_language !== undefined) updates.website_language = validated.website_language;

    const result = await pageRepo.update(id, user.id, updates);

    if (result.error || !result.data) {
      throw result.error || new Error('Failed to update page');
    }

    requestLogger.info({ pageId: id, userId: user.id }, 'Updated website page');

    return NextResponse.json({ success: true, page: result.data });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid input', details: error.errors },
        { status: 400 }
      );
    }

    requestLogger.error({ err: error, id }, 'Failed to update page');
    return NextResponse.json(
      { success: false, error: 'Failed to update page' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const pageRepo = new WebsitePageRepository(supabaseServer);

    // Archive instead of hard delete
    const result = await pageRepo.archive(id, user.id);

    if (result.error) {
      throw result.error;
    }

    requestLogger.info({ pageId: id, userId: user.id }, 'Archived website page');

    return NextResponse.json({ success: true });
  } catch (error) {
    requestLogger.error({ err: error, id }, 'Failed to delete page');
    return NextResponse.json(
      { success: false, error: 'Failed to delete page' },
      { status: 500 }
    );
  }
}
