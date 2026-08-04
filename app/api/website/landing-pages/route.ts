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

// Offering types that require booking vs direct purchase
const BOOKABLE_TYPES = ['service', 'coaching', 'treatment', 'session', 'consultation'];

// Get blocks based on offering type - courses/products don't need booking
function getBlocksForOfferingType(
  offeringType: string | undefined,
  language: string = 'en'
): Array<{ block_type: string; defaultContent: Record<string, unknown> }> {
  const needsBooking = !offeringType || BOOKABLE_TYPES.includes(offeringType.toLowerCase());
  const isCourse = offeringType?.toLowerCase() === 'course';

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
        logo_text: '',
        menu_items: [],
        cta_button: {
          text: needsBooking ? ctaText.book : (isCourse ? ctaText.enroll : ctaText.getStarted),
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
        cta_text: needsBooking ? ctaText.book : (isCourse ? ctaText.enroll : ctaText.buy),
        cta_link: needsBooking ? '#booking' : '#pricing',
        background_type: 'gradient'
      }
    },
    {
      block_type: 'features',
      defaultContent: {
        title: isCourse
          ? (language === 'he' ? 'מה תלמדו' : language === 'es' ? 'Qué Aprenderás' : 'What You Will Learn')
          : (language === 'he' ? 'למה לבחור בנו' : language === 'es' ? 'Por Qué Elegirnos' : 'Why Choose Us'),
        features: []
      }
    },
    {
      block_type: 'pricing',
      defaultContent: {
        title: isCourse
          ? (language === 'he' ? 'פרטי הקורס' : language === 'es' ? 'Detalles del Curso' : 'Course Details')
          : (language === 'he' ? 'השקעה' : language === 'es' ? 'Inversión' : 'Investment'),
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
        title: isCourse
          ? (language === 'he' ? 'מוכנים להתחיל ללמוד?' : language === 'es' ? '¿Listo para empezar a aprender?' : 'Ready to Start Learning?')
          : (language === 'he' ? 'מוכנים להתחיל?' : language === 'es' ? '¿Listo para comenzar?' : 'Ready to Get Started?'),
        description: isCourse
          ? (language === 'he' ? 'הירשמו עכשיו והתחילו את המסע שלכם' : language === 'es' ? 'Inscríbete ahora y comienza tu viaje' : 'Enroll now and begin your journey')
          : (language === 'he' ? 'קבלו גישה היום' : language === 'es' ? 'Obtén acceso hoy' : 'Get access today'),
        cta_text: isCourse ? ctaText.enroll : ctaText.buy,
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
  generatedContent: z.record(z.unknown()).optional(),
  shouldPublish: z.boolean().default(false),
  // Client flow steps - 'scheduling' and 'client_info' are the new split steps, 'booking' is legacy
  clientFlow: z.array(z.enum(['scheduling', 'client_info', 'booking', 'payment', 'intake', 'confirmation'])).optional(),
  // Language for localized content
  language: z.enum(['en', 'es', 'he']).optional().default('en'),
  // Business branding for header
  logoUrl: z.string().optional(),
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
      theme: pageTheme,
      // Store the language for RTL support and localized content
      website_language: validated.language
    };

    const pageResult = await pageRepo.create(pageData);

    if (pageResult.error || !pageResult.data) {
      throw pageResult.error || new Error('Failed to create landing page');
    }

    // Get offering type from AI-generated content to determine which blocks to include
    const offeringType = (validated.generatedContent?.offering_type as string) || undefined;
    const landingPageBlocks = getBlocksForOfferingType(offeringType, validated.language);

    requestLogger.info({
      offeringType,
      blockTypes: landingPageBlocks.map(b => b.block_type),
      hasBookingWidget: landingPageBlocks.some(b => b.block_type === 'booking_widget')
    }, 'Generating landing page blocks based on offering type');

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

      // For header, set logo and company name
      if (block.block_type === 'header') {
        content.logo_url = validated.logoUrl || null;
        content.logo_text = validated.companyName || '';
      }

      // For hero, always set headline to service name (AI only generates subheadline)
      if (block.block_type === 'hero') {
        content.headline = validated.serviceName;
      }

      // For booking_widget, add the specific service and client flow
      if (block.block_type === 'booking_widget') {
        content.services = [validated.serviceId];
        content.service_filter = [validated.serviceId];
        // Use new split steps as default - scheduling + client_info for bookable services
        content.client_flow = validated.clientFlow || ['scheduling', 'client_info', 'confirmation'];
      }

      // For pricing, add the service info for booking integration
      if (block.block_type === 'pricing') {
        content.serviceId = validated.serviceId;
        content.serviceName = validated.serviceName;
        content.durationMinutes = validated.serviceDuration || 60;
        content.currency = validated.serviceCurrency || 'USD';
        // Set client flow from wizard - determines which steps are shown in booking modal
        content.client_flow = validated.clientFlow || ['scheduling', 'client_info', 'confirmation'];
        // Add priceRaw to plans if present
        if (content.plans && Array.isArray(content.plans)) {
          content.plans = (content.plans as Array<Record<string, unknown>>).map(plan => ({
            ...plan,
            serviceId: validated.serviceId,
            priceRaw: validated.servicePrice || undefined,
            currency: validated.serviceCurrency || 'USD',
            durationMinutes: validated.serviceDuration || 60
          }));
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
