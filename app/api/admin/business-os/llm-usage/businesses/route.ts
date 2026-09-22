/**
 * Businesses the admin LLM usage tab can inspect (Layer 1.1 FR-2).
 *
 * ADMIN ONLY, gated here in the route (middleware does not protect `/api`)
 * through AdminAccessService (the admin_users table) — never the user-writable
 * profile role field.
 * Order: 401 signed out → 403 not an admin (or the admin check threw: fail
 * closed) → 400 invalid query. Nothing is read before all three pass.
 *
 * Returns only account ids and company names (no email or other personal
 * data), at most 50, plus the platform account ids so the tab can warn before
 * one is selected. Read-only; no audit event (Pino only, OQ-5).
 *
 *   GET /api/admin/business-os/llm-usage/businesses?search=<text>
 *
 * @module app/api/admin/business-os/llm-usage/businesses
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AdminAccessService } from '@/lib/services/AdminAccessService';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { isPlatformAccountEnvIgnored, platformAccountIds } from '@/lib/business-os/llm/callCatalog';
import {
  BusinessListQuerySchema,
  LLM_USAGE_LIMITS,
  firstIssueMessage,
} from '@/lib/business-os/usage/llmUsageVerification';
import type { BusinessListResponse } from '@/lib/business-os/usage/llmUsageReportTypes';

const logger = createLogger({ module: 'AdminLlmUsageBusinessesAPI' });

// The catalog imports Node `crypto` and Pino: never the Edge runtime. An
// admin- and cookie-dependent GET must never be cached.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    let isAdmin = false;
    try {
      isAdmin = await AdminAccessService.getInstance().isAdmin({ id: user.id, email: user.email });
    } catch (err) {
      // Fail closed: an admin check that cannot answer is a "no".
      requestLogger.error({ err, userId: user.id }, 'Admin check threw; denying access');
    }

    if (!isAdmin) {
      requestLogger.warn({ userId: user.id }, 'Non-admin attempted to list businesses for LLM usage');
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const url = new URL(request.url);
    const parsed = BusinessListQuerySchema.safeParse({
      search: url.searchParams.get('search') ?? undefined,
    });

    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: firstIssueMessage(parsed.error),
          details: process.env.NODE_ENV === 'development' ? parsed.error.flatten() : undefined,
        },
        { status: 400 }
      );
    }

    const { search } = parsed.data;
    const { data, error } = await businessProfileRepository.searchForAdmin(search, LLM_USAGE_LIMITS.BUSINESS_LIST);

    if (error || !data) {
      requestLogger.error({ err: error, adminUserId: user.id }, 'Failed to list businesses for LLM usage');
      return NextResponse.json({ success: false, error: 'Could not load businesses' }, { status: 500 });
    }

    const envIgnored = isPlatformAccountEnvIgnored();
    if (envIgnored) {
      requestLogger.warn(
        { adminUserId: user.id },
        'SYSTEM_ADMIN_USER_ID is set but is not a UUID; only the all-zero platform account is checked'
      );
    }

    const response: BusinessListResponse = {
      businesses: data.map((entry) => ({ userId: entry.user_id, companyName: entry.company_name })),
      limit: LLM_USAGE_LIMITS.BUSINESS_LIST,
      platformAccountIds: platformAccountIds(),
      platformAccountEnvIgnored: envIgnored,
    };

    // Never the search text or names: a search is usually a business name.
    requestLogger.info(
      { adminUserId: user.id, searchLength: search?.length ?? 0, resultCount: response.businesses.length },
      'LLM usage business list served'
    );

    return NextResponse.json({ success: true, data: response });
  } catch (error) {
    requestLogger.error({ err: error }, 'LLM usage business list failed');
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
      { status: 500 }
    );
  }
}
