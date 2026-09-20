// app/api/admin/user-emails/route.ts
// Lightweight endpoint to fetch user emails by user IDs for admin pages.
//
// This is a READ despite the POST verb — the body carries the id list, nothing
// is written. It was therefore sorted into the read slice of the admin authz
// programme; that slice is parked, so the gate lands here on its own.
//
// Until this gate, the handler had NO auth check of any kind: an anonymous
// caller could POST a list of user ids and receive their EMAIL ADDRESSES, read
// with the service role via auth.admin.listUsers().

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'UserEmailsAdminAPI' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // Use service role for admin access
);

// Mark as dynamic since it uses request.url
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // Admin gate. Nothing above this line may touch a request body,
    // the database, a job queue, or an outbound message (FR-5).
    const gate = await requireAdmin(requestLogger);
    if (gate instanceof NextResponse) return gate;
    // Named `adminUser`, not `user`: the mapping loop below already binds a
    // `user` for each AUTH user. Two identifiers meaning different people, one
    // of them the subject of an access log, is how the wrong id ends up logged.
    const { user: adminUser } = gate;

    const { userIds } = await request.json();

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return NextResponse.json(
        { error: 'userIds array is required' },
        { status: 400 }
      );
    }

    // Fetch all users from auth using admin API
    const { data: authData, error: authError } = await supabase.auth.admin.listUsers();

    if (authError) {
      requestLogger.error({ err: authError }, 'Failed to list auth users');
      return NextResponse.json(
        { error: 'Failed to fetch user emails', details: authError.message },
        { status: 500 }
      );
    }

    // Filter to only the requested user IDs and map to email
    const userEmailMap: Record<string, string> = {};

    authData.users.forEach(user => {
      if (userIds.includes(user.id)) {
        userEmailMap[user.id] = user.email || 'N/A';
      }
    });

    /*
     * Access log for a bulk PII read.
     *
     * This route returns platform users' EMAIL ADDRESSES, so an admin reaching
     * it should be attributable. Placed here — immediately before the success
     * response, after the body parse, the `userIds` validation and the auth
     * read — so the line is emitted if and only if a 200 is returned:
     *   401/403 (gate)      → no line
     *   400 (malformed body)→ no line
     *   500 (listUsers)     → the error line only, never a "fetched" line
     * Logging it earlier would claim a read that had not happened yet.
     *
     * The ADMIN's id and a COUNT only — never the email addresses and never the
     * subject user ids (FR-6, and the same discipline `requireAdmin` applies to
     * its own denial logs). `count` is what was REQUESTED; the response may
     * contain fewer if an id did not resolve.
     */
    requestLogger.info(
      { userId: adminUser.id, count: userIds.length },
      'Admin fetched user emails'
    );

    return NextResponse.json({
      success: true,
      data: userEmailMap,
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Admin user-emails request failed');
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
