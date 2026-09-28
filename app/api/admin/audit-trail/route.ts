// app/api/admin/audit-trail/route.ts
// Admin audit trail browser: every account's audit rows, with filters.
//
// The read still uses an inline service-role client rather than a repository.
// This PR only adds one predicate (user_id); moving the read is an OI-9
// candidate (docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md), recorded rather
// than silently waived.

import { NextResponse, NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/admin/requireAdminRoute';
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
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId, route: ROUTE });

  try {
    // Admin gate. Nothing above this line may touch a request body,
    // the database, a job queue, or an outbound message. This route reads every
    // account's audit rows with the service role; requireAdmin owns the 401/403
    // split and fails closed (slice 2c replaced the inline copy, SA C-6).
    const gate = await requireAdmin(requestLogger);
    if (gate instanceof NextResponse) return gate;
    const adminUser = gate.user;

    // Validate the query string AFTER the gate above and BEFORE any read, so an
    // unauthenticated or non-admin caller gets 401/403 and never learns what
    // this route validates. Keep it in that order.
    const parsed = AdminAuditTrailQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
    if (!parsed.success) {
      requestLogger.warn(
        { adminUserId: adminUser.id, issue: firstIssueMessage(parsed.error) },
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
      user_id: accountId,
      page,
      page_size: pageSize,
    } = parsed.data;

    // Calculate offset for pagination
    const offset = (page - 1) * pageSize;

    requestLogger.debug(
      { adminUserId: adminUser.id, action, severity, entityType, accountId, dateFrom, dateTo, hasSearch: !!search, page, pageSize, offset },
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

    if (accountId) {
      query = query.eq('user_id', accountId);
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
      requestLogger.error({ err: error }, 'Fetching audit logs failed');
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

    requestLogger.debug({ count: logsWithUsers.length, page, searched: !!search }, 'Audit logs fetched');

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
    requestLogger.error({ err: error }, 'Admin audit-trail request failed');
    return NextResponse.json({
      success: false,
      error: 'Internal server error',
      details:
        process.env.NODE_ENV === 'development' && error instanceof Error ? error.message : undefined
    }, { status: 500 });
  }
}
