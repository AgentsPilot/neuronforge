/**
 * Website Content API
 * GET - Get all website section content for the user
 * PUT - Update one or more sections
 *
 * This is the CENTRAL content store for website sections.
 * Templates define which sections to show; this stores the content.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { WebsiteContentRepository, SectionType } from '@/lib/repositories/WebsiteContentRepository';
import { z } from 'zod';

const logger = createLogger({ module: 'WebsiteContentAPI' });

// Schema for updating sections
const UpdateSectionsSchema = z.object({
  sections: z.record(z.unknown()).refine(
    (obj) => Object.keys(obj).length > 0,
    { message: 'At least one section must be provided' }
  )
});

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const contentRepo = new WebsiteContentRepository(supabaseServer);

    // Get or create content for user
    const result = await contentRepo.getOrCreate(user.id);

    if (result.error) {
      throw result.error;
    }

    requestLogger.info({ userId: user.id }, 'Fetched website content');

    return NextResponse.json({
      success: true,
      content: result.data
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to get website content');
    return NextResponse.json(
      { success: false, error: 'Failed to get website content' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const validated = UpdateSectionsSchema.parse(body);

    // Validate section names
    const validSections: SectionType[] = [
      'hero', 'about', 'services', 'testimonials', 'faq',
      'team', 'contact', 'process', 'features', 'stats',
      'pricing', 'gallery', 'cta', 'newsletter', 'logo_cloud',
      'video', 'booking_widget', 'payment_button', 'intake_form'
    ];

    const invalidSections = Object.keys(validated.sections).filter(
      s => !validSections.includes(s as SectionType)
    );

    if (invalidSections.length > 0) {
      return NextResponse.json(
        { success: false, error: `Invalid sections: ${invalidSections.join(', ')}` },
        { status: 400 }
      );
    }

    const contentRepo = new WebsiteContentRepository(supabaseServer);

    const result = await contentRepo.updateMultipleSections(
      user.id,
      validated.sections as Record<SectionType, unknown>
    );

    if (result.error) {
      throw result.error;
    }

    requestLogger.info(
      { userId: user.id, sections: Object.keys(validated.sections) },
      'Updated website content sections'
    );

    return NextResponse.json({
      success: true,
      content: result.data
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid input', details: error.errors },
        { status: 400 }
      );
    }

    requestLogger.error({ err: error }, 'Failed to update website content');
    return NextResponse.json(
      { success: false, error: 'Failed to update website content' },
      { status: 500 }
    );
  }
}
