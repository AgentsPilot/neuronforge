/**
 * Website Templates API
 * GET - List available templates, optionally filtered by vertical
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { selectTemplateForBusiness } from '@/lib/website-builder/selectTemplate';
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
    const subVertical = searchParams.get('sub_vertical');
    const description = searchParams.get('description');
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

      if (filteredTemplates.length === 0) {
        // Worth saying out loud: the caller gets all 33 templates ordered
        // therapist-first, so a business whose vertical we do not recognise is
        // shown — and used to be pre-selected into — a therapist template.
        requestLogger.warn(
          { vertical, normalizedVertical },
          'No templates for this vertical; returning the full roster'
        );
      }
    }

    // Filter by template type if provided
    if (templateType) {
      templates = templates.filter(t => t.template_type === templateType);
    }

    // Get unique verticals for the filter dropdown
    const verticals = [...new Set(WEBSITE_TEMPLATES.map(t => t.vertical))];

    /*
     * The recommendation, and the list ordered to match it.
     *
     * The vertical filter above only narrows a gallery; it never picked one, so
     * the wizard pre-selected whatever was first in the array. The selector
     * below is allowed to cross the vertical boundary on the sub-vertical —
     * which is the only way a parenting school reaches a coaching template
     * rather than academic tutoring.
     *
     * Ordering the response rather than only naming a winner means the four
     * templates the wizard shows are the four best, not the first four.
     */
    let recommendedTemplateId: string | undefined;
    if (vertical || subVertical) {
      const selection = selectTemplateForBusiness({
        vertical,
        sub_vertical: subVertical,
        description,
      });
      recommendedTemplateId = selection.template.id;
      requestLogger.info(
        { vertical, subVertical, recommendedTemplateId, reason: selection.reason },
        'Template recommended'
      );

      // Order the returned list to match, keeping anything the selector's pool
      // did not cover at the end rather than dropping it.
      const rank = new Map(selection.candidates.map((t, i) => [t.id, i]));
      templates = [...templates].sort(
        (a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER)
      );
    }

    return NextResponse.json({
      success: true,
      templates,
      verticals,
      recommendedTemplateId,
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
