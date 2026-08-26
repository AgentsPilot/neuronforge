/**
 * Website Templates API
 * GET - List available templates, optionally filtered by vertical
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { WEBSITE_TEMPLATES, WebsiteTemplate } from '@/lib/website-builder/templates';

const logger = createLogger({ module: 'WebsiteTemplatesAPI' });

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const vertical = searchParams.get('vertical');
    const templateType = searchParams.get('type');

    let templates: WebsiteTemplate[] = WEBSITE_TEMPLATES;

    // Filter by vertical if provided
    // NOTE: Verticals are normalized at OnboardingConfigurationService now,
    // but we keep a fallback mapping here for backward compatibility with old data
    if (vertical) {
      // Fallback mapping for legacy data (primary normalization is at OnboardingConfigurationService)
      const fallbackMapping: Record<string, string> = {
        teacher: 'tutor',
        wellness: 'therapist',
        // Beauty has its own vertical now
        makeup_artist: 'beauty',
        makeup: 'beauty',
        esthetician: 'beauty',
        nail_tech: 'beauty',
        hairdresser: 'beauty',
        hairstylist: 'beauty',
        barber: 'beauty',
        spa: 'beauty',
        salon: 'beauty',
        cosmetologist: 'beauty',
        fitness: 'trainer',
        healthcare: 'therapist',
        accountant: 'consultant',
        designer: 'photographer',
        other: '', // Will use all templates
      };

      const normalizedVertical = fallbackMapping[vertical] ?? vertical;
      const filteredTemplates = normalizedVertical
        ? templates.filter(t => t.vertical === normalizedVertical)
        : [];

      // If exact match found, use filtered. Otherwise fall back to showing all templates
      templates = filteredTemplates.length > 0 ? filteredTemplates : WEBSITE_TEMPLATES;
    }

    // Filter by template type if provided
    if (templateType) {
      templates = templates.filter(t => t.template_type === templateType);
    }

    // Get unique verticals for the filter dropdown
    const verticals = [...new Set(WEBSITE_TEMPLATES.map(t => t.vertical))];

    return NextResponse.json({
      success: true,
      templates,
      verticals,
      total: templates.length
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to list templates');
    return NextResponse.json(
      { success: false, error: 'Failed to list templates' },
      { status: 500 }
    );
  }
}
