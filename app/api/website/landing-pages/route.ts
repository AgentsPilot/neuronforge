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
import { WebsiteBlockRepository, WebsiteBlockInsert } from '@/lib/repositories/WebsiteBlockRepository';
import { z } from 'zod';

const logger = createLogger({ module: 'LandingPagesAPI' });

// Landing page block structure
const LANDING_PAGE_BLOCKS: Array<{ block_type: string; defaultContent: Record<string, unknown> }> = [
  {
    block_type: 'header',
    defaultContent: {
      logo_text: '',
      menu_items: [],
      cta_button: { text: 'Book Now', link: '#booking' },
      style: 'minimal'
    }
  },
  {
    block_type: 'hero',
    defaultContent: {
      layout: 'center',
      headline: '',
      subheadline: '',
      cta_text: 'Book Now',
      cta_link: '#booking',
      background_type: 'gradient'
    }
  },
  {
    block_type: 'features',
    defaultContent: {
      title: 'Why Choose This Service',
      features: []
    }
  },
  {
    block_type: 'pricing',
    defaultContent: {
      title: 'Investment',
      plans: []
    }
  },
  {
    block_type: 'faq',
    defaultContent: {
      title: 'Frequently Asked Questions',
      items: []
    }
  },
  {
    block_type: 'booking_widget',
    defaultContent: {
      title: 'Ready to Get Started?',
      services: []
    }
  },
  {
    block_type: 'contact_form',
    defaultContent: {
      title: 'Questions? Get in Touch',
      fields: ['name', 'email', 'message']
    }
  }
];

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
  generatedContent: z.record(z.unknown()).optional(),
  shouldPublish: z.boolean().default(false)
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

    // Get user's homepage to inherit subdomain
    const homepageResult = await pageRepo.getHomepage(user.id);
    const subdomain = homepageResult.data?.subdomain;

    // Convert theme to PageTheme format
    const pageTheme: PageTheme = {
      colors: {
        primary: validated.theme.colors.primary,
        secondary: validated.theme.colors.secondary,
        accent: validated.theme.colors.secondary,
        background: '#ffffff',
        surface: '#f9fafb',
        text: '#1a1a1a',
        textSecondary: '#6b7280'
      },
      fonts: {
        heading: validated.theme.fonts.heading,
        body: validated.theme.fonts.body
      },
      spacing: 'normal',
      borderRadius: '8px'
    };

    // Create the landing page
    const pageData: WebsitePageInsert = {
      user_id: user.id,
      page_type: 'landing',
      slug: `/${validated.slug}`,
      title: validated.serviceName,
      subdomain: subdomain || null,
      status: validated.shouldPublish ? 'live' : 'draft',
      theme: pageTheme
    };

    const pageResult = await pageRepo.create(pageData);

    if (pageResult.error || !pageResult.data) {
      throw pageResult.error || new Error('Failed to create landing page');
    }

    // Create blocks with generated content
    const blocksToCreate: WebsiteBlockInsert[] = LANDING_PAGE_BLOCKS.map((block, index) => {
      // Merge generated content if available
      let content = { ...block.defaultContent };
      if (validated.generatedContent && validated.generatedContent[block.block_type]) {
        content = {
          ...content,
          ...(validated.generatedContent[block.block_type] as Record<string, unknown>)
        };
      }

      // For booking_widget, add the specific service
      if (block.block_type === 'booking_widget') {
        content.services = [validated.serviceId];
        content.service_filter = [validated.serviceId];
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
