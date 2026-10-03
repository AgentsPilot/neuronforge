// app/api/admin/users/[id]/stats/route.ts
//
// Serves the "Connected Plugins" and "AI spend, all products" cards of the
// Businesses detail (`app/admin/users/page.tsx`, its only caller).
//
// The agents, agent-executions and subscription reads were removed in
// ADMIN_BOS_CLEANUP slice 5a: the executions read named a column that does not
// exist (`agent_executions.total_tokens_used`) and the subscription read named
// two (`user_subscriptions.plan_name`, `subscription_status`), so neither ever
// returned data (requirement SA Review §A). Their cards are gone with them.
//
// A failed read comes back as `null` for its section, never as zeros: a zero
// spend or "0 plugins" reads as a real answer.
//
// Known debt (OI-9, docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md): the two
// reads below are inline service-role reads, not repository calls.
// `PluginConnectionRepository` selects `*` on a table that holds OAuth tokens,
// and no token-usage repository method returns one account's all-feature
// 30-day rows, so neither is a drop-in swap. The fix follows the
// `AdminTokenUsageAnalyticsRepository` template (admin-only methods,
// allow-listed columns, `{ data, error }`).
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'UsersIdStatsAdminAPI' });

// Service role on purpose: an admin reads another account's rows, which RLS
// would refuse. Every read below is still scoped with `.eq('user_id', userId)`.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const dynamic = 'force-dynamic';

const userIdSchema = z.string().uuid();

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

interface TokenStats {
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_usd: number;
  total_calls: number;
  by_model: Array<{ model: string; input: number; output: number; cost: number; calls: number }>;
}

interface PluginStats {
  total: number;
  active: number;
  list: Array<{ plugin: string; connected_at: string; is_active: boolean }>;
}

interface TokenUsageRow {
  model_name: string | null;
  provider: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | string | null;
  created_at: string;
}

interface PluginConnectionRow {
  plugin_key: string;
  connected_at: string;
  status: string | null;
}

/** `cost_usd` is numeric in Postgres, which PostgREST may return as a string. */
function toNumber(value: number | string | null): number {
  if (value === null) return 0;
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function buildTokenStats(rows: TokenUsageRow[]): TokenStats {
  const modelUsage: Record<string, { input: number; output: number; cost: number; calls: number }> = {};

  rows.forEach(t => {
    const key = `${t.provider}/${t.model_name}`;
    if (!modelUsage[key]) {
      modelUsage[key] = { input: 0, output: 0, cost: 0, calls: 0 };
    }
    modelUsage[key].input += t.input_tokens || 0;
    modelUsage[key].output += t.output_tokens || 0;
    modelUsage[key].cost += toNumber(t.cost_usd);
    modelUsage[key].calls += 1;
  });

  return {
    total_input_tokens: rows.reduce((sum, t) => sum + (t.input_tokens || 0), 0),
    total_output_tokens: rows.reduce((sum, t) => sum + (t.output_tokens || 0), 0),
    total_cost_usd: rows.reduce((sum, t) => sum + toNumber(t.cost_usd), 0),
    total_calls: rows.length,
    by_model: Object.entries(modelUsage)
      .map(([model, stats]) => ({ model, ...stats }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 10)
  };
}

function buildPluginStats(rows: PluginConnectionRow[]): PluginStats {
  return {
    total: rows.length,
    active: rows.filter(p => p.status === 'active').length,
    list: rows.map(p => ({
      plugin: p.plugin_key,
      connected_at: p.connected_at,
      is_active: p.status === 'active'
    }))
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // Admin gate. Nothing above this line may touch a request body,
    // the database, a job queue, or an outbound message (FR-5).
    const gate = await requireAdmin(requestLogger);
    if (gate instanceof NextResponse) return gate;

    const parsedId = userIdSchema.safeParse((await params).id);
    if (!parsedId.success) {
      return NextResponse.json({ success: false, error: 'Invalid user id' }, { status: 400 });
    }
    const userId = parsedId.data;

    const since = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();

    const [tokenUsageResult, pluginConnectionsResult] = await Promise.all([
      supabase
        .from('token_usage')
        .select('model_name, provider, input_tokens, output_tokens, cost_usd, created_at')
        .eq('user_id', userId)
        .gte('created_at', since),

      supabase
        .from('plugin_connections')
        .select('plugin_key, connected_at, status')
        .eq('user_id', userId)
        .neq('status', 'disconnected')
    ]);

    // Each section is built only from a read that succeeded; a failed read is
    // `null`, so the card says it could not be read instead of showing zeros.
    let tokens: TokenStats | null = null;
    if (tokenUsageResult.error) {
      requestLogger.error(
        { err: tokenUsageResult.error, section: 'tokens', targetUserId: userId },
        'User stats read failed'
      );
    } else {
      tokens = buildTokenStats((tokenUsageResult.data ?? []) as TokenUsageRow[]);
    }

    let plugins: PluginStats | null = null;
    if (pluginConnectionsResult.error) {
      requestLogger.error(
        { err: pluginConnectionsResult.error, section: 'plugins', targetUserId: userId },
        'User stats read failed'
      );
    } else {
      plugins = buildPluginStats((pluginConnectionsResult.data ?? []) as PluginConnectionRow[]);
    }

    return NextResponse.json({ success: true, data: { tokens, plugins } });

  } catch (error) {
    requestLogger.error({ err: error }, 'User stats request failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch user statistics',
        details: process.env.NODE_ENV === 'development'
          ? (error instanceof Error ? error.message : String(error))
          : undefined
      },
      { status: 500 }
    );
  }
}
