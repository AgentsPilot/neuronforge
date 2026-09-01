/**
 * Website Page Publish API
 * POST   - Publish page (draft -> live)
 * DELETE - Unpublish page (live -> draft)
 *
 * The sequence lives in WebsitePublishService so the chat publishes a site the
 * same way this route does — with the same refusals for a page that has no
 * address or nothing on it.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import {
  publishPage,
  unpublishPage,
  PageNotPublishableError,
} from '@/lib/services/WebsitePublishService';

const logger = createLogger({ module: 'WebsitePagePublishAPI' });

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const result = await publishPage({
      pageId: id,
      userId: user.id,
      request,
      logger: requestLogger
    });

    if (result.error) {
      // A page that is not READY is the owner's to fix in a minute, so it reads
      // back as their message rather than a server fault.
      if (result.error instanceof PageNotPublishableError) {
        return NextResponse.json(
          { success: false, error: result.error.message, reason: result.error.reason },
          { status: result.error.reason === 'not_found' ? 404 : 400 }
        );
      }

      requestLogger.error({ err: result.error, id }, 'Failed to publish page');
      return NextResponse.json(
        { success: false, error: 'Failed to publish page' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      page: { id: result.data!.pageId, subdomain: result.data!.subdomain },
      url: result.data!.url
    });
  } catch (error) {
    requestLogger.error({ err: error, id }, 'Failed to publish page');
    return NextResponse.json(
      { success: false, error: 'Failed to publish page' },
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

    const result = await unpublishPage({
      pageId: id,
      userId: user.id,
      request,
      logger: requestLogger
    });

    if (result.error) {
      requestLogger.error({ err: result.error, id }, 'Failed to unpublish page');
      return NextResponse.json(
        { success: false, error: 'Failed to unpublish page' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, page: { id: result.data!.pageId } });
  } catch (error) {
    requestLogger.error({ err: error, id }, 'Failed to unpublish page');
    return NextResponse.json(
      { success: false, error: 'Failed to unpublish page' },
      { status: 500 }
    );
  }
}
