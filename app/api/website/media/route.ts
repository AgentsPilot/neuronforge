/**
 * A business's own pictures.
 *
 * Backs the "your images" tab in the media picker. Everything a business has —
 * photographs found for it when its site was generated, anything generated on
 * request, and its own uploads — in one list, newest first.
 *
 * Read-only. Pictures arrive through generation or through the upload endpoint,
 * which already owns the bucket write and its own validation; a second way to
 * create one would be a second place to get the scoping wrong.
 *
 * @module app/api/website/media
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { userMediaRepository } from '@/lib/repositories/UserMediaRepository';

const logger = createLogger({ module: 'WebsiteMediaAPI' });

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    /*
     * The slot being filled, when the caller knows it.
     *
     * A hero crop is not a team portrait. Offering every picture for every slot
     * offers mostly wrong answers, so a caller that knows what it is filling
     * gets that section's pictures first — and still gets the rest, because an
     * owner who wants their gallery photograph in the hero should not be
     * argued with.
     */
    const section = request.nextUrl.searchParams.get('section');

    const media = await userMediaRepository.listForUser(user.id);

    /*
     * A failed read is not an empty library.
     *
     * Saying "no pictures yet" when the query failed sends the owner looking
     * for a picture they already made. The commonest cause is the `user_media`
     * migration not having been applied, which is invisible from the UI and
     * indistinguishable from a new account.
     */
    if (media === null) {
      requestLogger.warn({ userId: user.id }, 'Could not read the media library');
      return NextResponse.json(
        { success: false, reason: 'unavailable' },
        { status: 503 }
      );
    }
    const ordered = section
      ? [...media].sort((a, b) => Number(b.section === section) - Number(a.section === section))
      : media;

    requestLogger.info({ userId: user.id, count: ordered.length }, 'Listed a business\'s pictures');

    return NextResponse.json({
      success: true,
      data: ordered.map(item => ({
        id: item.id,
        url: item.public_url,
        description: item.description,
        section: item.section,
        aspect: item.aspect,
        source: item.source,
        width: item.width,
        height: item.height,
      })),
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to list pictures');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
