/**
 * Website Page Publish API
 * GET    - Can this page go live? (asks without publishing)
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
import { bustSiteCache } from '@/lib/website-builder/siteCache';
import {
  publishPage,
  unpublishPage,
  pagePublishBlocker,
  PageNotPublishableError,
} from '@/lib/services/WebsitePublishService';

const logger = createLogger({ module: 'WebsitePagePublishAPI' });

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * The same refusal the publish would give, without performing it.
 *
 * The editor asks before opening a PREVIEW. A booking step with no working
 * hours behind it shows an empty calendar, and an owner sent into that reads it
 * as a broken preview rather than as a setting they have not filled in — so the
 * preview is gated on exactly what the publish is gated on, and says the same
 * sentence when it refuses.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const blocker = await pagePublishBlocker(id, user.id);

    return NextResponse.json({
      success: true,
      ready: blocker === null,
      error: blocker?.message,
      reason: blocker?.reason,
      // Each gap apart, so the caller can offer a way to fix each one.
      gaps: blocker?.gaps ?? [],
    });
  } catch (error) {
    requestLogger.error({ err: error, pageId: id }, 'Failed to check publish readiness');
    // Never block on a failed CHECK: the publish itself asks again and refuses
    // properly, so a broken check must not stand between an owner and a preview.
    return NextResponse.json({ success: true, ready: true });
  }
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
          {
            success: false,
            error: result.error.message,
            reason: result.error.reason,
            // Each gap apart, so the editor can offer a fix for each.
            gaps: result.error.gaps,
          },
          { status: result.error.reason === 'not_found' ? 404 : 400 }
        );
      }

      requestLogger.error({ err: result.error, id }, 'Failed to publish page');
      return NextResponse.json(
        { success: false, error: 'Failed to publish page' },
        { status: 500 }
      );
    }

    // Going live is the change that matters most: the cached copy is of a page
    // that was not being served at all.
    bustSiteCache(result.data!.subdomain);

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
