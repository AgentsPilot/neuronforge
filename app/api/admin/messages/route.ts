// app/api/admin/messages/route.ts
// GET: the contact-form inbox for the admin Messages screen (/admin/messages).
// The 200 keeps `messages` at the top level, which is what the page reads.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { createLogger } from '@/lib/logger';
import { contactMessagesRepository } from '@/lib/repositories/ContactMessagesRepository';
import { adminMessagesListQuerySchema } from '@/lib/validation/contactMessages';

const logger = createLogger({ module: 'MessagesAdminAPI' });

// Mark as dynamic since it uses request.url and searchParams
export const dynamic = 'force-dynamic';

const devDetails = (details: unknown) => (process.env.NODE_ENV === 'development' ? details : undefined);

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // Admin gate. Nothing above this line may touch a request body,
    // the database, a job queue, or an outbound message (FR-5).
    const gate = await requireAdmin(requestLogger);
    if (gate instanceof NextResponse) return gate;

    const searchParams = request.nextUrl.searchParams;
    const query = adminMessagesListQuerySchema.parse({
      filter: searchParams.get('filter') ?? undefined,
      search: searchParams.get('search') ?? undefined,
    });

    const { data, error } = await contactMessagesRepository.listForAdmin(
      { correlationId, adminId: gate.user.id },
      { status: query.filter, search: query.search }
    );

    if (error || !data) {
      requestLogger.error({ err: error, filter: query.filter }, 'Failed to fetch contact messages');
      return NextResponse.json(
        { success: false, error: 'Failed to fetch messages', details: devDetails(error?.message) },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, messages: data });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid input', details: devDetails(error.flatten()) },
        { status: 400 }
      );
    }
    requestLogger.error({ err: error }, 'Contact messages list request failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: devDetails(error instanceof Error ? error.message : String(error)),
      },
      { status: 500 }
    );
  }
}
