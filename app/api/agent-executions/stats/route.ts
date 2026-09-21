// /app/api/agent-executions/stats/route.ts
// Platform-wide agent-execution queue statistics for the admin dashboard
// (`app/admin/queues/page.tsx`).
//
// ── ADMIN ONLY. This route is cross-tenant by design. ─────────────────────
// It reads `agent_executions` for EVERY user through a service-role client, so RLS is
// not protecting it and the caller's own identity does not scope anything. Until
// 2026-09-21 it had no authentication at all: an anonymous GET returned up to 50 full
// execution rows per status — `user_id`, `agent_id`, `error_message` and the `result`
// payload of other tenants' agent runs — plus platform-wide metrics. That made it a bulk
// user-id dispenser for the other identity holes fixed in the same slice.
//
// Identity comes from `requireAdmin()` (the `admin_users` table via AdminAccessService,
// never `profiles.role`) and nothing in the request body, query or headers is trusted.
// Middleware does not authenticate `/api/*` (middleware.ts:83), so this gate is the only
// thing in front of the handler.
//
// See docs/workplans/IDENTITY_SWEEP_WORKPLAN.md § Slice 0.
//
// Known follow-ups, deliberately NOT done in a security branch (SA ruling): the
// service-role client is still built inline from `process.env` rather than imported from
// `@/lib/supabaseServer`, and the table is queried directly instead of through a
// repository — both pre-existing Mandatory Rule 1 violations.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'API', route: '/api/agent-executions/stats' });

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Explicit projection instead of `select('*')`.
 *
 * These are exactly the columns `app/admin/queues/page.tsx` renders. An allow-list means
 * a column added to `agent_executions` later — a payload blob, a token, a credential —
 * does not start flowing cross-tenant to the browser the moment the migration lands.
 */
const EXECUTION_COLUMNS = [
  'id',
  'agent_id',
  'user_id',
  'execution_type',
  'status',
  'progress',
  'scheduled_at',
  'started_at',
  'completed_at',
  'execution_duration_ms',
  'error_message',
  'result',
  'created_at',
].join(', ');

interface AgentExecution {
  id: string;
  agent_id: string;
  user_id: string;
  execution_type: 'manual' | 'scheduled';
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  scheduled_at: string;
  started_at?: string;
  completed_at?: string;
  execution_duration_ms?: number;
  error_message?: string;
  result?: any;
  created_at: string;
}

interface ExecutionStats {
  pending: { count: number; executions: AgentExecution[] };
  running: { count: number; executions: AgentExecution[] };
  completed: { count: number; executions: AgentExecution[] };
  failed: { count: number; executions: AgentExecution[] };
}

interface Metrics {
  totalProcessed: number;
  avgProcessingTime: number;
  successRate: number;
  throughputPerHour: number;
  queueHealth: 'excellent' | 'good' | 'warning' | 'critical';
  errorRate: number;
  activeExecutions: number;
}

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // Admin gate FIRST: before the client is built and before any row is read. There is
    // no user-scoped mode of this route to fall back to — it is cross-tenant or nothing.
    const gate = await requireAdmin(requestLogger);
    if (gate instanceof NextResponse) return gate;
    const { user } = gate;

    // Initialize Supabase client
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Fetch executions from the last 24 hours
    const oneDayAgo = new Date();
    oneDayAgo.setHours(oneDayAgo.getHours() - 24);

    const { data: executions, error } = await supabase
      .from('agent_executions')
      .select(EXECUTION_COLUMNS)
      .gte('created_at', oneDayAgo.toISOString())
      .order('created_at', { ascending: false })
      .limit(1000); // Limit to 1000 most recent executions

    if (error) {
      requestLogger.error({ err: error, userId: user.id }, 'Failed to fetch executions');
      throw error;
    }

    // The projection is a string, so supabase-js cannot infer a row type for it; the
    // shape is asserted here once rather than at each use below.
    const rows = (executions ?? []) as unknown as AgentExecution[];

    // Group executions by status
    const stats: ExecutionStats = {
      pending: { count: 0, executions: [] },
      running: { count: 0, executions: [] },
      completed: { count: 0, executions: [] },
      failed: { count: 0, executions: [] },
    };

    rows.forEach((execution: AgentExecution) => {
      const status = execution.status;
      if (stats[status]) {
        stats[status].count++;
        // Only include the first 50 executions per status for UI performance
        if (stats[status].executions.length < 50) {
          stats[status].executions.push(execution);
        }
      }
    });

    // Calculate metrics
    const completedExecutions = rows.filter(e => e.status === 'completed');
    const failedExecutions = rows.filter(e => e.status === 'failed');
    const totalProcessed = completedExecutions.length + failedExecutions.length;

    // Calculate average processing time (in seconds)
    const avgProcessingTime = completedExecutions.length > 0
      ? completedExecutions.reduce((sum, e) => sum + (e.execution_duration_ms || 0), 0) / completedExecutions.length / 1000
      : 0;

    // Calculate success rate
    const successRate = totalProcessed > 0
      ? (completedExecutions.length / totalProcessed) * 100
      : 100;

    // Calculate error rate
    const errorRate = totalProcessed > 0
      ? (failedExecutions.length / totalProcessed) * 100
      : 0;

    // Calculate throughput (executions per hour in last 24 hours)
    const throughputPerHour = totalProcessed / 24;

    // Active executions (pending + running)
    const activeExecutions = stats.pending.count + stats.running.count;

    // Determine queue health
    let queueHealth: 'excellent' | 'good' | 'warning' | 'critical';
    if (errorRate > 25 || activeExecutions > 100) {
      queueHealth = 'critical';
    } else if (errorRate > 10 || activeExecutions > 50) {
      queueHealth = 'warning';
    } else if (errorRate > 5 || activeExecutions > 20) {
      queueHealth = 'good';
    } else {
      queueHealth = 'excellent';
    }

    const metrics: Metrics = {
      totalProcessed,
      avgProcessingTime: Math.round(avgProcessingTime * 10) / 10, // Round to 1 decimal
      successRate: Math.round(successRate * 10) / 10, // Round to 1 decimal
      throughputPerHour: Math.round(throughputPerHour * 10) / 10, // Round to 1 decimal
      queueHealth,
      errorRate: Math.round(errorRate * 10) / 10, // Round to 1 decimal
      activeExecutions,
    };

    // Counts and health only. Never the rows: they carry other tenants' `result`
    // payloads and `error_message` text, which must not reach the log stream.
    requestLogger.debug(
      { adminUserId: user.id, rowsScanned: rows.length, queueHealth },
      'Queue statistics served'
    );

    return NextResponse.json({
      success: true,
      stats,
      metrics,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to build execution statistics');
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch execution statistics',
        // Dev-guarded: the raw message can carry Postgres detail (column names,
        // constraint text). Same treatment as the F4/F13 500 sites in PR #80.
        message:
          process.env.NODE_ENV === 'development'
            ? error instanceof Error
              ? error.message
              : 'Unknown error'
            : undefined,
      },
      { status: 500 }
    );
  }
}
