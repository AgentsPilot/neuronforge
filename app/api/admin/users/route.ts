// app/api/admin/users/route.ts
//
// The admin Businesses list (/admin/users): every login, each with its Business
// OS business name when it has one (one login = one business, OQ-3).
//
// Admin reorganisation slice 2b rewrote the GET body (user decision,
// 2026-09-25): structured Pino with a correlation id instead of console.*, no
// error text in production responses, Zod-validated inputs, and the search no
// longer interpolated into a PostgREST `.or()` filter string (it could inject
// filter syntax). Reads go through repositories; the business names come from
// ONE batched read, never one per row.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { createLogger } from '@/lib/logger';
import { userProfileRepository } from '@/lib/repositories/UserProfileRepository';
import { businessProfileRepository, BUSINESS_SEARCH_MAX_LIMIT } from '@/lib/repositories/BusinessProfileRepository';

const logger = createLogger({ module: 'UsersAdminAPI' });

// Auth admin API only (emails, sign-in times): there is no table to put behind
// a repository here. Service role, because listing every auth user is an admin
// operation by definition; the caller is gated by requireAdmin.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // Use service role for admin access
);

// Mark as dynamic since it uses request.url and searchParams
export const dynamic = 'force-dynamic';

/** Most accounts one list request returns. */
const LIST_LIMIT = 1000;

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

const UsersListQuerySchema = z.object({
  search: z
    .string()
    .max(100)
    .refine((v) => !CONTROL_CHARS.test(v), 'Control characters are not allowed')
    .optional()
    .default(''),
  status: z.enum(['all', 'active', 'inactive']).optional().default('all'),
  sortBy: z.enum(['created_at', 'full_name']).optional().default('created_at'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
});

/** The business shown on a row. `null` = the login has no Business OS business. */
interface RowBusiness {
  companyName: string | null;
  vertical: string;
}

/** The fields this route reads from an auth user. */
interface AuthUser {
  id: string;
  email?: string;
  email_confirmed_at?: string | null;
  last_sign_in_at?: string | null;
  created_at?: string;
  updated_at?: string;
  phone?: string | null;
  role?: string;
  app_metadata?: { providers?: string[] };
}

function isRecentlyActive(lastSignInAt: string | null | undefined, now: Date): boolean {
  if (!lastSignInAt) return false;
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  return new Date(lastSignInAt) > thirtyDaysAgo;
}

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // Admin gate. Nothing above this line may touch a request body,
    // the database, a job queue, or an outbound message (FR-5).
    const gate = await requireAdmin(requestLogger);
    if (gate instanceof NextResponse) return gate;

    const { searchParams } = new URL(request.url);
    const parsed = UsersListQuerySchema.safeParse({
      search: searchParams.get('search') ?? undefined,
      status: searchParams.get('status') ?? undefined,
      sortBy: searchParams.get('sortBy') ?? undefined,
      sortOrder: searchParams.get('sortOrder') ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid query parameters',
          details: process.env.NODE_ENV === 'development' ? parsed.error.flatten() : undefined,
        },
        { status: 400 }
      );
    }
    const { search, status, sortBy, sortOrder } = parsed.data;
    const term = search.trim();

    // A search also matches business names: those accounts' ids are added to
    // the profile search as parameters (never interpolated into a filter).
    // The business-name search is capped; when it returns the cap there may be
    // more matches, and the page says so rather than dropping them silently
    // (QA E-4 / SA N-3a).
    let businessMatchIds: string[] = [];
    let businessMatchesCapped = false;
    let businessSearch: 'ok' | 'failed' | 'skipped' = 'skipped';
    if (term) {
      const matches = await businessProfileRepository.searchForAdmin(term, BUSINESS_SEARCH_MAX_LIMIT);
      if (matches.error) {
        businessSearch = 'failed';
        requestLogger.warn({ err: matches.error }, 'Business-name search failed; searching people only');
      } else {
        businessSearch = 'ok';
        businessMatchIds = (matches.data ?? []).map((m) => m.user_id);
        businessMatchesCapped = businessMatchIds.length >= BUSINESS_SEARCH_MAX_LIMIT;
      }
    }

    const profilesResult = await userProfileRepository.listForAdmin({
      search: term,
      extraIds: businessMatchIds,
      sortBy,
      ascending: sortOrder === 'asc',
      limit: LIST_LIMIT,
    });
    if (profilesResult.error || !profilesResult.data) {
      requestLogger.error({ err: profilesResult.error, adminUserId: gate.user.id }, 'Admin user list read failed');
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to fetch users',
          details: process.env.NODE_ENV === 'development' ? profilesResult.error?.message : undefined,
        },
        { status: 500 }
      );
    }
    const profiles = profilesResult.data;

    // Business names: ONE batched read for the whole list (chunked inside).
    const businesses = new Map<string, RowBusiness>();
    let businessLookup: 'ok' | 'failed' = 'ok';
    if (profiles.length > 0) {
      const identities = await businessProfileRepository.findAdminIdentitiesByUserIds(profiles.map((p) => p.id));
      if (identities.error || !identities.data) {
        businessLookup = 'failed';
        requestLogger.error({ err: identities.error }, 'Business name lookup failed; list continues without it');
      } else {
        for (const identity of identities.data) {
          businesses.set(identity.user_id, { companyName: identity.company_name, vertical: identity.vertical });
        }
      }
    }

    // Enrich with auth metadata (email, last sign-in, etc.)
    let authUsersMap = new Map<string, AuthUser>();
    try {
      const { data: authUsers, error: authError } = await supabase.auth.admin.listUsers();
      if (authError) {
        requestLogger.warn({ err: authError }, 'Auth user enrichment failed; continuing with profile data');
      } else if (authUsers) {
        authUsersMap = new Map((authUsers.users as AuthUser[]).map((u) => [u.id, u]));
      }
    } catch (enrichError) {
      requestLogger.warn({ err: enrichError }, 'Auth user enrichment threw; continuing with profile data');
    }

    const enrichedUsers = profiles.map((profile) => {
      const authUser = authUsersMap.get(profile.id);
      return {
        ...profile,
        email: authUser?.email || 'N/A',
        email_confirmed: authUser?.email_confirmed_at ? true : false,
        last_sign_in_at: authUser?.last_sign_in_at || null,
        created_at: authUser?.created_at || profile.created_at,
        updated_at: authUser?.updated_at || profile.updated_at,
        phone: authUser?.phone || null,
        providers: authUser?.app_metadata?.providers || [],
        role: authUser?.role || 'authenticated',
        // null = no Business OS business for this login. Undefined when the
        // lookup itself failed, so the page can say "unknown", not "none".
        business: businessLookup === 'ok' ? (businesses.get(profile.id) ?? null) : undefined,
      };
    });

    const now = new Date();
    let filteredUsers = enrichedUsers;
    if (status === 'active') {
      filteredUsers = enrichedUsers.filter((u) => isRecentlyActive(u.last_sign_in_at, now));
    } else if (status === 'inactive') {
      filteredUsers = enrichedUsers.filter((u) => !isRecentlyActive(u.last_sign_in_at, now));
    }

    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const stats = {
      totalUsers: filteredUsers.length,
      activeUsers: enrichedUsers.filter((u) => isRecentlyActive(u.last_sign_in_at, now)).length,
      newUsersToday: enrichedUsers.filter((u) => !!u.created_at && new Date(u.created_at) >= today).length,
    };

    // Counts only: no names, emails or search text.
    requestLogger.info(
      {
        adminUserId: gate.user.id,
        status,
        searchLength: term.length,
        rows: filteredUsers.length,
        withBusiness: businesses.size,
        businessLookup,
        businessSearch,
        businessMatchesCapped,
      },
      'Admin user list served'
    );

    return NextResponse.json({
      success: true,
      data: filteredUsers,
      stats,
      // Shown on the page: a capped business-name search may be missing matches.
      search: { businessSearch, businessMatchesCapped, businessMatchLimit: BUSINESS_SEARCH_MAX_LIMIT },
      pagination: {
        total: filteredUsers.length,
        page: 1,
        limit: LIST_LIMIT,
      },
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Admin users API error');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' && error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

// Health check endpoint.
//
// Gated like everything else under /api/admin. It reads nothing and returns an
// empty 200, so it leaks no data — but an ungated 200 here CONFIRMS TO AN
// ANONYMOUS PROBER that this admin route exists, which is exactly what
// NFR-Security forbids of a denial response. Finding E-4: the original census
// grepped five verbs and never saw these HEAD handlers; the CI guard did.
export async function HEAD() {
  // No request object on this handler, so the correlation id is generated
  // rather than propagated.
  const requestLogger = logger.child({ correlationId: crypto.randomUUID() });

  const gate = await requireAdmin(requestLogger);
  if (gate instanceof NextResponse) return gate;

  return new NextResponse(null, { status: 200 });
}
