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
    if (vertical) {
      templates = templates.filter(t => t.vertical === vertical);
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
