// app/api/admin/users/[id]/stats/route.ts
// Fetch comprehensive user statistics: agents, token usage, executions, subscription
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: userId } = await params;

    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    // Fetch all user stats in parallel
    const [
      agentsResult,
      executionsResult,
      tokenUsageResult,
      subscriptionResult,
      pluginConnectionsResult
    ] = await Promise.all([
      // User's agents
      supabase
        .from('agents')
        .select('id, agent_name, status, created_at, mode')
        .eq('user_id', userId)
        .neq('status', 'deleted')
        .order('created_at', { ascending: false })
        .limit(20),

      // User's executions (last 30 days)
      supabase
        .from('agent_executions')
        .select('id, status, execution_duration_ms, total_tokens_used, total_cost_usd, created_at, agent_id')
        .eq('user_id', userId)
        .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false })
        .limit(100),

      // User's token usage (aggregated by model, last 30 days)
      supabase
        .from('token_usage')
        .select('model_name, provider, input_tokens, output_tokens, cost_usd, created_at')
        .eq('user_id', userId)
        .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),

      // User's subscription
      supabase
        .from('user_subscriptions')
        .select('balance, total_spent, executions_quota, executions_used, plan_name, subscription_status')
        .eq('user_id', userId)
        .single(),

      // User's plugin connections
      supabase
        .from('plugin_connections')
        .select('plugin_key, connected_at, status')
        .eq('user_id', userId)
        .neq('status', 'disconnected')
    ]);

    // Process agents data
    const agents = agentsResult.data || [];
    const agentStats = {
      total: agents.length,
      active: agents.filter(a => a.status === 'active').length,
      inactive: agents.filter(a => a.status === 'inactive').length,
      draft: agents.filter(a => a.status === 'draft').length,
      scheduled: agents.filter(a => a.mode === 'scheduled').length,
      list: agents.map(a => ({
        id: a.id,
        name: a.agent_name,
        status: a.status,
        mode: a.mode,
        created_at: a.created_at
      }))
    };

    // Process executions data
    const executions = executionsResult.data || [];
    const executionStats = {
      total_30d: executions.length,
      successful: executions.filter(e => e.status === 'completed' || e.status === 'success').length,
      failed: executions.filter(e => e.status === 'failed' || e.status === 'error').length,
      total_duration_ms: executions.reduce((sum, e) => sum + (e.execution_duration_ms || 0), 0),
      total_tokens: executions.reduce((sum, e) => sum + (e.total_tokens_used || 0), 0),
      total_cost_usd: executions.reduce((sum, e) => sum + (parseFloat(e.total_cost_usd) || 0), 0),
      success_rate: executions.length > 0
        ? Math.round((executions.filter(e => e.status === 'completed' || e.status === 'success').length / executions.length) * 100)
        : 0
    };

    // Process token usage by model
    const tokenUsage = tokenUsageResult.data || [];
    const modelUsage: Record<string, { input: number; output: number; cost: number; calls: number }> = {};

    tokenUsage.forEach(t => {
      const key = `${t.provider}/${t.model_name}`;
      if (!modelUsage[key]) {
        modelUsage[key] = { input: 0, output: 0, cost: 0, calls: 0 };
      }
      modelUsage[key].input += t.input_tokens || 0;
      modelUsage[key].output += t.output_tokens || 0;
      modelUsage[key].cost += parseFloat(t.cost_usd) || 0;
      modelUsage[key].calls += 1;
    });

    const tokenStats = {
      total_input_tokens: tokenUsage.reduce((sum, t) => sum + (t.input_tokens || 0), 0),
      total_output_tokens: tokenUsage.reduce((sum, t) => sum + (t.output_tokens || 0), 0),
      total_cost_usd: tokenUsage.reduce((sum, t) => sum + (parseFloat(t.cost_usd) || 0), 0),
      total_calls: tokenUsage.length,
      by_model: Object.entries(modelUsage)
        .map(([model, stats]) => ({ model, ...stats }))
        .sort((a, b) => b.cost - a.cost)
        .slice(0, 10)
    };

    // Process subscription data
    const subscription = subscriptionResult.data;
    const subscriptionStats = subscription ? {
      balance: subscription.balance || 0,
      total_spent: subscription.total_spent || 0,
      executions_quota: subscription.executions_quota,
      executions_used: subscription.executions_used || 0,
      plan_name: subscription.plan_name || 'free',
      status: subscription.subscription_status || 'active'
    } : null;

    // Process plugin connections
    const pluginConnections = pluginConnectionsResult.data || [];
    const pluginStats = {
      total: pluginConnections.length,
      active: pluginConnections.filter(p => p.status === 'active').length,
      list: pluginConnections.map(p => ({
        plugin: p.plugin_key,
        connected_at: p.connected_at,
        is_active: p.status === 'active'
      }))
    };

    return NextResponse.json({
      success: true,
      data: {
        agents: agentStats,
        executions: executionStats,
        tokens: tokenStats,
        subscription: subscriptionStats,
        plugins: pluginStats
      }
    });

  } catch (error) {
    console.error('Error fetching user stats:', error);
    return NextResponse.json({
      error: 'Failed to fetch user statistics',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
