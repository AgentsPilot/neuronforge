/**
 * Landing Page Preview API
 * POST - Returns HTML preview of landing page blocks (for wizard preview)
 *
 * This endpoint renders the actual block components with provided content
 * so the wizard preview matches what will be shown in edit/preview mode.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { z } from 'zod';

const logger = createLogger({ module: 'LandingPagePreviewAPI' });

const PreviewSchema = z.object({
  serviceName: z.string(),
  serviceId: z.string().optional(),
  servicePrice: z.number().nullable().optional(),
  serviceDuration: z.number().nullable().optional(),
  serviceCurrency: z.string().optional().default('USD'),
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
  clientFlow: z.array(z.string()).optional(),
  language: z.enum(['en', 'es', 'he']).optional().default('en'),
  logoUrl: z.string().optional(),
  companyName: z.string().optional(),
  subdomain: z.string().optional()
});

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

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const validated = PreviewSchema.parse(body);

    // Get offering type from AI-generated content to determine which blocks to include
    const offeringType = (validated.generatedContent?.offering_type as string) || undefined;
    const landingPageBlocks = getBlocksForOfferingType(offeringType, validated.language);

    requestLogger.info({
      offeringType,
      blockTypes: landingPageBlocks.map(b => b.block_type),
      hasBookingWidget: landingPageBlocks.some(b => b.block_type === 'booking_widget'),
      language: validated.language
    }, 'Generating preview blocks based on offering type');

    // Build blocks with merged content (same logic as landing page creation)
    const blocks = landingPageBlocks.map((block, index) => {
      let content = { ...block.defaultContent };

      // Merge generated content
      if (validated.generatedContent && validated.generatedContent[block.block_type]) {
        content = {
          ...content,
          ...(validated.generatedContent[block.block_type] as Record<string, unknown>)
        };
      }

      // For hero, set headline to service name
      if (block.block_type === 'hero') {
        content.headline = validated.serviceName;
      }

      // For header, set logo/company
      if (block.block_type === 'header') {
        content.logo_url = validated.logoUrl;
        content.logo_text = validated.companyName || '';
      }

      // For booking_widget, set client flow and service
      // Default to scheduling + client_info + confirmation for bookable services
      if (block.block_type === 'booking_widget') {
        content.client_flow = validated.clientFlow || ['scheduling', 'client_info', 'confirmation'];
        if (validated.serviceId) {
          content.services = [validated.serviceId];
          content.service_filter = [validated.serviceId];
        }
      }

      // For pricing, add service info for booking integration
      // Default to scheduling + client_info + confirmation for bookable services
      if (block.block_type === 'pricing') {
        content.serviceId = validated.serviceId;
        content.serviceName = validated.serviceName;
        content.durationMinutes = validated.serviceDuration || 60;
        content.currency = validated.serviceCurrency || 'USD';
        content.client_flow = validated.clientFlow || ['scheduling', 'client_info', 'confirmation'];
      }

      // For CTA (non-bookable items like courses/products), add service info
      // Default to client_info + payment + confirmation (no scheduling)
      if (block.block_type === 'cta') {
        content.serviceId = validated.serviceId;
        content.client_flow = validated.clientFlow || ['client_info', 'payment', 'confirmation'];
      }

      return {
        id: `preview-${block.block_type}-${index}`,
        block_type: block.block_type,
        content,
        styles: {},
        position: index,
        enabled: true
      };
    });

    // Build the theme object for preview
    const theme = {
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

    requestLogger.info({
      userId: user.id,
      serviceName: validated.serviceName,
      blockCount: blocks.length
    }, 'Generated preview blocks');

    return NextResponse.json({
      success: true,
      blocks,
      theme,
      language: validated.language,
      subdomain: validated.subdomain
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid input', details: error.errors },
        { status: 400 }
      );
    }

    requestLogger.error({ err: error }, 'Failed to generate preview');
    return NextResponse.json(
      { success: false, error: 'Failed to generate preview' },
      { status: 500 }
    );
  }
}
