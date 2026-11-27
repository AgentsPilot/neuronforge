/**
 * GET /api/version — which build is running (app version stamp R19;
 * DEVELOPMENT_LIFECYCLE.md §5.4; SA-V5).
 *
 * Returns `{ environment, commit, builtAt }` and nothing else: the role id
 * (production, staging, …), a 7-character commit SHA and the build time.
 *
 * PUBLIC ON PURPOSE (SA ruling Q4): §5.4 makes the stamp what support,
 * customers and the QA agent can see, and the smoke test (R10) checks it on
 * Staging and Production before it tests anything, with no session. It returns
 * no secret, reads no database, takes no input and changes nothing, so there
 * is nothing to authorise and nothing to audit. The commit is of a public
 * repository.
 *
 * The answer passes through a STRICT schema before it is sent, so a field that
 * is not one of the three can never reach a caller.
 *
 * @module app/api/version/route
 */

import { NextRequest, NextResponse } from 'next/server';

import { createLogger } from '@/lib/logger';
import { appVersionSchema } from '@/lib/validation/app-version-schema';
import { appVersionOf, currentAppVersionSource } from '@/lib/version/readAppVersion';

export const dynamic = 'force-dynamic';

const logger = createLogger({ module: 'AppVersionAPI' });

/** One build's answer must never be served for another, by a CDN or a browser. */
const NO_STORE = { 'Cache-Control': 'no-store' };

// Takes no input: query parameters are not read, so there is nothing to validate.
export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const data = appVersionSchema.parse(appVersionOf(currentAppVersionSource()));
    // debug only: a probe endpoint must not fill the logs.
    requestLogger.debug({ environment: data.environment }, 'App version served');
    return NextResponse.json({ success: true, data }, { headers: NO_STORE });
  } catch (error) {
    requestLogger.error({ err: error }, 'App version failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Version unavailable',
        details:
          process.env.NODE_ENV === 'development'
            ? error instanceof Error
              ? error.message
              : String(error)
            : undefined,
      },
      { status: 500, headers: NO_STORE }
    );
  }
}
