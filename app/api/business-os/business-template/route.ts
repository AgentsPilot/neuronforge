/**
 * Business Template API
 * GET - What template this business wears
 * PUT - Change it, restyling every surface the business has
 *
 * A template is the business's, not a page's. This route exists because
 * choosing one must not require owning a website: a business reaching clients
 * by booking link still has landing pages, smart links, invoices and emails,
 * and all of them are drawn from the same colours and fonts.
 *
 * The page-scoped `/api/website/pages/[id]/apply-template` remains the path for
 * "change the template while I am editing this site" — it applies the same
 * business-wide change, and additionally repaints the page in hand.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { getBusinessTemplate, setBusinessTemplate, clearBusinessTemplate } from '@/lib/business-os/businessTemplate';
import { getTemplateById } from '@/lib/website-builder/templates';
import { z } from 'zod';

const logger = createLogger({ module: 'BusinessTemplateAPI' });

const SetTemplateSchema = z.object({
  template_id: z.string().min(1).max(200),
});

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const state = await getBusinessTemplate(user.id);
    return NextResponse.json({ success: true, ...state });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to read the business template');
    return NextResponse.json(
      { success: false, error: 'Failed to read the business template' },
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
    const validated = SetTemplateSchema.parse(body);

    // Refused here rather than inside, so an id that names no template reads
    // back as a bad request instead of a silent no-op.
    if (!getTemplateById(validated.template_id)) {
      return NextResponse.json(
        { success: false, error: 'Unknown template' },
        { status: 400 }
      );
    }

    const result = await setBusinessTemplate(user.id, validated.template_id);

    requestLogger.info(
      { userId: user.id, templateId: validated.template_id, propagatedPages: result.propagatedPages },
      'Business template changed'
    );

    return NextResponse.json({
      success: true,
      template_id: validated.template_id,
      propagatedPages: result.propagatedPages,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid input', details: error.errors },
        { status: 400 }
      );
    }

    requestLogger.error({ err: error }, 'Failed to change the business template');
    return NextResponse.json(
      { success: false, error: 'Failed to change the business template' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const result = await clearBusinessTemplate(user.id);

    if (!result.cleared) {
      // A refusal the owner can act on, not a server fault.
      return NextResponse.json(
        {
          success: false,
          error: result.blockedByPages > 0
            ? 'This template is in use. Delete the website and landing pages built from it before unselecting.'
            : 'Failed to clear the business template',
          reason: result.blockedByPages > 0 ? 'in_use' : 'error',
          pages: result.blockedByPages,
        },
        { status: result.blockedByPages > 0 ? 409 : 500 }
      );
    }

    requestLogger.info({ userId: user.id }, 'Business template cleared');
    return NextResponse.json({ success: true });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to clear the business template');
    return NextResponse.json(
      { success: false, error: 'Failed to clear the business template' },
      { status: 500 }
    );
  }
}
