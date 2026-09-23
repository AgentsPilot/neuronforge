// app/api/admin/audit-trail/route.ts
// API for querying AIS audit trail with filters

import { NextResponse, NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getUser } from '@/lib/auth';
import { AdminAccessService } from '@/lib/services/AdminAccessService';
import { createLogger } from '@/lib/logger';
import { AdminAuditTrailQuerySchema, firstIssueMessage } from '@/lib/audit/requestSchemas';

// Initialize service role client for admin operations
const supabaseServiceRole = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const logger = createLogger({ module: 'AdminAuditTrailAPI' });
const ROUTE = '/api/admin/audit-trail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET - Fetch audit trail logs with filters
export async function GET(request: NextRequest) {
  try {
    // Admin only (Layer 3 step 0, Q-3). Middleware does not protect /api, and
    // this route reads every account's audit rows with the service role, so it
    // gates itself: 401 signed out, 403 not an admin. Admin identity comes from
    // AdminAccessService (the admin_users table), never a user-writable role.
    const adminUser = await getUser();
    if (!adminUser) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    let isAdmin = false;
    try {
      isAdmin = await AdminAccessService.getInstance().isAdmin({ id: adminUser.id, email: adminUser.email });
    } catch (err) {
      // Fail closed: an admin check that cannot answer is a "no".
      logger.error({ err, userId: adminUser.id }, 'Admin check threw; denying access');
    }
    if (!isAdmin) {
      logger.warn({ userId: adminUser.id, route: ROUTE }, 'Non-admin attempted to read audit data');
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    // Validate the query string AFTER the gate above and BEFORE any read, so an
    // unauthenticated or non-admin caller gets 401/403 and never learns what
    // this route validates. Keep it in that order.
    const parsed = AdminAuditTrailQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
    if (!parsed.success) {
      logger.warn(
        { adminUserId: adminUser.id, route: ROUTE, issue: firstIssueMessage(parsed.error) },
        'Rejected an invalid audit query'
      );
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid query parameters',
          details: process.env.NODE_ENV === 'development' ? firstIssueMessage(parsed.error) : undefined,
        },
        { status: 400 }
      );
    }

    // Filter parameters. The schema maps the UI's "all" sentinel to undefined for
    // the three dropdown filters only — `search` and the two dates are free text,
    // where "all" is a legitimate value — maps '' to undefined everywhere, and
    // guarantees page/page_size are positive integers (parseInt('abc') used to
    // reach .range(NaN, NaN) and 500).
    const {
      action,
      severity,
      entity_type: entityType,
      date_from: dateFrom,
      date_to: dateTo,
      search,
      page,
      page_size: pageSize,
    } = parsed.data;

    // Calculate offset for pagination
    const offset = (page - 1) * pageSize;

    logger.debug(
      { adminUserId: adminUser.id, action, severity, entityType, dateFrom, dateTo, hasSearch: !!search, page, pageSize, offset },
      'Fetching audit logs with filters'
    );

    // Build query - get ALL audit records with count
    let query = supabaseServiceRole
      .from('audit_trail')
      .select('*', { count: 'exact' });

    // Apply filters (the dropdowns' "all", and "" anywhere, already became
    // undefined in the schema)
    if (action) {
      query = query.eq('action', action);
    }

    if (severity) {
      query = query.eq('severity', severity);
    }

    if (entityType) {
      query = query.eq('entity_type', entityType);
    }

    if (dateFrom) {
      query = query.gte('created_at', dateFrom);
    }

    if (dateTo) {
      query = query.lte('created_at', dateTo);
    }

    // Order by most recent first
    query = query.order('created_at', { ascending: false });

    // Apply pagination with range
    if (search) {
      // When searching JSONB, fetch more records to filter in memory
      query = query.range(offset, offset + (pageSize * 5) - 1);
    } else {
      // Normal pagination
      query = query.range(offset, offset + pageSize - 1);
    }

    const { data: logs, error, count } = await query;

    if (error) {
      logger.error({ err: error }, 'Fetching audit logs failed');
      // The detail stays in the server log; only development sees it in the body.
      return NextResponse.json({
        success: false,
        error: 'Failed to fetch audit logs',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      }, { status: 500 });
    }

    // If search term is provided, search within all fields including JSONB
    let filteredLogs = logs || [];
    if (search && logs) {
      const searchLower = search.toLowerCase();

      // Helper function to search within JSONB
      const searchInJSON = (obj: any): boolean => {
        if (!obj) return false;
        const jsonString = JSON.stringify(obj).toLowerCase();
        return jsonString.includes(searchLower);
      };

      // Filter to include records where search term appears anywhere
      filteredLogs = logs.filter((log: any) => {
        // Check text fields
        const matchedTextFields =
          log.resource_name?.toLowerCase().includes(searchLower) ||
          log.entity_id?.toLowerCase().includes(searchLower) ||
          log.user_email?.toLowerCase().includes(searchLower) ||
          log.action?.toLowerCase().includes(searchLower);

        // Check JSONB fields
        const matchedJSONFields =
          searchInJSON(log.details) ||
          searchInJSON(log.changes);

        return matchedTextFields || matchedJSONFields;
      });

      // Apply limit after JSONB filtering
      filteredLogs = filteredLogs.slice(0, pageSize);
    }

    // Get unique user IDs from filtered logs to fetch additional user info (full_name)
    const userIds = [...new Set(filteredLogs?.map((log: any) => log.user_id).filter(Boolean))];

    // Fetch user information for display purposes (full_name not in audit_trail)
    let usersMap: Record<string, any> = {};
    if (userIds.length > 0) {
      const { data: users, error: usersError } = await supabaseServiceRole
        .from('users')
        .select('id, email, full_name')
        .in('id', userIds);

      if (!usersError && users) {
        usersMap = Object.fromEntries(users.map(u => [u.id, u]));
      }
    }

    // Attach user information to filtered logs for display
    const logsWithUsers = filteredLogs.map((log: any) => ({
      ...log,
      users: log.user_id ? usersMap[log.user_id] : null
    }));

    logger.debug({ count: logsWithUsers.length, page, searched: !!search }, 'Audit logs fetched');

    // Calculate pagination metadata
    const totalCount = count || 0;
    const totalPages = Math.ceil(totalCount / pageSize);
    const hasMore = page < totalPages;

    return NextResponse.json({
      success: true,
      logs: logsWithUsers,
      pagination: {
        page,
        pageSize,
        total: totalCount,
        totalPages,
        hasMore,
        showing: logsWithUsers.length
      }
    });

  } catch (error: unknown) {
    logger.error({ err: error }, 'Admin audit-trail request failed');
    return NextResponse.json({
      success: false,
      error: 'Internal server error',
      details:
        process.env.NODE_ENV === 'development' && error instanceof Error ? error.message : undefined
    }, { status: 500 });
  }
}
