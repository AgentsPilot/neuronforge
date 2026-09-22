// app/api/business-os/purge/preview/route.ts
//
// T19 (dry-run slice) — the purge preview.
//
// ⚠️ READ-ONLY. This route counts rows and evaluates the gate. It cannot
// delete anything, and there is no sibling commit route in this build.
//
// FR-2 / AC-28: the target is ALWAYS the session user. No user id is accepted
// in the body, the query string or a header — the Zod schema below is
// `.strict()`, so an injected `userId` key is a 400 rather than an ignored
// field. That is not politeness; it is the primary reason a caller cannot aim
// this at someone else's business.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { authorizePurge, type PurgeSurface } from '@/lib/business-os/purge/purgeAuthz';
import { buildPurgePreview } from '@/lib/business-os/purge/PreviewService';

const logger = createLogger({ module: 'PurgePreviewAPI' });

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Above the gate's own budget, so a slow preview is reported by our code rather
 * than killed by the platform. The default is 10s, which is the gate's entire
 * budget — a preview would be cut off at exactly the moment it had something to
 * say about why it was slow.
 */
export const maxDuration = 60;

const previewSchema = z
  .object({
    level: z.enum(['reset', 'purge']),
    surface: z.enum(['internal', 'customer']).default('internal'),
    options: z
      .object({
        integrations: z.boolean().default(false),
        agents: z.boolean().default(false),
        activityHistory: z.boolean().default(false),
      })
      .default({ integrations: false, agents: false, activityHistory: false }),
  })
  .strict();

export async function POST(request: NextRequest) {
  const correlationId =
    request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 },
      );
    }

    // E-2: a malformed JSON body is invalid input — a 400, not a 500. Unguarded,
    // `request.json()` throws a SyntaxError that falls through to the generic
    // handler and reports an internal server error for what is a client mistake.
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid input', details: 'Request body is not valid JSON' },
        { status: 400 },
      );
    }
    const validated = previewSchema.parse(body);

    // Server-side authorisation (T30 / C-15 / C-22). The UI's decision to
    // render a button is not an input to this.
    const decision = await authorizePurge(
      { id: user.id, email: user.email ?? null },
      validated.level,
      validated.surface as PurgeSurface,
    );

    if (!decision.allowed) {
      requestLogger.warn(
        { userId: user.id, level: validated.level, surface: validated.surface },
        'Purge preview denied',
      );
      return NextResponse.json(
        { success: false, error: decision.reason },
        { status: decision.status },
      );
    }

    const preview = await buildPurgePreview({
      userId: user.id, // session user only — never from the request
      level: validated.level,
      options: validated.options,
      correlationId,
    });

    return NextResponse.json({ success: true, data: preview });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid input', details: error.flatten() },
        { status: 400 },
      );
    }

    requestLogger.error({ err: error }, 'Purge preview failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details:
          process.env.NODE_ENV === 'development'
            ? error instanceof Error
              ? error.message
              : String(error)
            : undefined,
      },
      { status: 500 },
    );
  }
}
