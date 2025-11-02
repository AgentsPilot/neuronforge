// app/api/admin/dashboard/route.ts
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // Use service role for admin access
);

export async function GET() {
  try {
    console.log('Dashboard API called');

    // Calculate date ranges
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

    // Fetch all dashboard data in parallel
    const [
      usersResult,
      agentsResult,
      tokenUsageResult,
      memoriesResult,
      memoryThisWeekResult,
      memoryLastWeekResult,
      memoryCostResult,
      queueStatsResult,
      aisRangesResult,
      authUsersResult
    ] = await Promise.all([
      // Users stats
      supabase.from('profiles').select('id, created_at'),

      // Agents stats
      supabase.from('agents').select('id, status, created_at'),

      // Token usage stats
      supabase.from('token_usage').select('total_tokens, cost_usd, success, created_at, activity_type, agent_id'),

      // Memory system stats - total
      supabase.from('run_memories').select('id', { count: 'exact', head: true }),

      // Memory this week
      supabase.from('run_memories')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', oneWeekAgo.toISOString()),

      // Memory last week
      supabase.from('run_memories')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', twoWeeksAgo.toISOString())
        .lt('created_at', oneWeekAgo.toISOString()),

      // Memory creation costs
      supabase.from('token_usage')
        .select('cost_usd')
        .eq('activity_type', 'memory_creation'),

      // Queue execution stats
      supabase.from('agent_executions').select('status, started_at, completed_at'),

      // AIS normalization ranges
      supabase.from('ais_normalization_ranges')
        .select('active_mode, min_executions_threshold, data_points_analyzed')
        .limit(1)
        .single(),

      // Auth users
      supabase.auth.admin.listUsers()
    ]);

    // Process Users
    const users = usersResult.data || [];
    const authUsers = authUsersResult.data;
    const activeUsers = authUsers?.users.filter(u =>
      u.last_sign_in_at && new Date(u.last_sign_in_at) > thirtyDaysAgo
    ).length || 0;

    // Process Agents
    const agents = agentsResult.data || [];
    const activeAgents = agents.filter(a => a.status === 'active').length;

    // Process Token Usage
    const tokenUsage = tokenUsageResult.data || [];
    const totalTokens = tokenUsage.reduce((sum, t) => sum + (t.total_tokens || 0), 0);
    const totalCost = tokenUsage.reduce((sum, t) => sum + (t.cost_usd || 0), 0);
    const successfulRequests = tokenUsage.filter(t => t.success).length;
    const successRate = tokenUsage.length > 0
      ? (successfulRequests / tokenUsage.length) * 100
      : 0;

    // Process Memory System
    const totalMemories = memoriesResult.count || 0;
    const thisWeekMemories = memoryThisWeekResult.count || 0;
    const lastWeekMemories = memoryLastWeekResult.count || 0;
    const memoryGrowth = lastWeekMemories > 0
      ? ((thisWeekMemories - lastWeekMemories) / lastWeekMemories) * 100
      : thisWeekMemories > 0 ? 100 : 0;

    const memoryCosts = memoryCostResult.data || [];
    const memoryCost = memoryCosts.reduce((sum, m) => sum + (m.cost_usd || 0), 0);
    const estimatedSavings = memoryCost * 15; // 15x ROI multiplier

    // Process Queue Stats
    const executions = queueStatsResult.data || [];
    const completedExecutions = executions.filter(e => e.status === 'completed');
    const failedExecutions = executions.filter(e => e.status === 'failed');
    const queueSuccessRate = executions.length > 0
      ? (completedExecutions.length / executions.length) * 100
      : 0;

    // Calculate average processing time
    const executionTimes = completedExecutions
      .filter(e => e.started_at && e.completed_at)
      .map(e => {
        const start = new Date(e.started_at!).getTime();
        const end = new Date(e.completed_at!).getTime();
        return (end - start) / 1000; // in seconds
      });
    const avgProcessingTime = executionTimes.length > 0
      ? executionTimes.reduce((sum, t) => sum + t, 0) / executionTimes.length
      : 0;

    // Determine queue health
    let queueHealth = 'excellent';
    if (queueSuccessRate < 90) queueHealth = 'critical';
    else if (queueSuccessRate < 95) queueHealth = 'warning';
    else if (queueSuccessRate < 98) queueHealth = 'good';

    // Process AIS Data
    const aisRange = aisRangesResult.data;
    const aisMode = aisRange?.active_mode === 1 ? 'dynamic' : 'best_practice';
    const dataPointsAnalyzed = aisRange?.data_points_analyzed || 0;

    // Calculate AIS-related stats from token usage
    const agentIds = new Set(agents.map(a => a.id));
    const aisTokenUsage = tokenUsage.filter(t =>
      t.agent_id && agentIds.has(t.agent_id) &&
      (t.activity_type === 'agent_creation' ||
       t.activity_type === 'agent_generation' ||
       t.activity_type === 'agent_execution')
    );

    const creationTokens = aisTokenUsage
      .filter(t => t.activity_type === 'agent_creation' || t.activity_type === 'agent_generation')
      .reduce((sum, t) => sum + (t.total_tokens || 0), 0);

    const executionTokens = aisTokenUsage
      .filter(t => t.activity_type === 'agent_execution')
      .reduce((sum, t) => sum + (t.total_tokens || 0), 0);

    // Calculate AIS costs
    const aisCost = aisTokenUsage.reduce((sum, t) => sum + (t.cost_usd || 0), 0);

    // Query agents with output token growth alerts (NEW)
    const { data: growthAlerts, error: growthAlertsError } = await supabase
      .from('agent_intensity_metrics')
      .select('agent_id, output_token_growth_rate, output_token_alert_level')
      .gte('output_token_growth_rate', 50); // 50%+ growth (rescore or upgrade level)

    if (growthAlertsError) {
      console.error('Error fetching growth alerts:', growthAlertsError);
    }

    const growthAlertsData = growthAlerts || [];
    const avgGrowthRate = growthAlertsData.length > 0
      ? Math.round(growthAlertsData.reduce((sum, a) => sum + a.output_token_growth_rate, 0) / growthAlertsData.length)
      : 0;

    // Build response
    const dashboardData = {
      users: {
        total: users.length,
        active: activeUsers
      },
      agents: {
        total: agents.length,
        active: activeAgents
      },
      tokenUsage: {
        totalCost,
        totalTokens,
        successRate: Math.round(successRate * 10) / 10
      },
      memory: {
        total: totalMemories,
        weeklyGrowth: Math.round(memoryGrowth),
        roi: memoryCost > 0 ? Math.round((estimatedSavings / memoryCost) * 100) / 10 : 0,
        cost: memoryCost,
        savings: estimatedSavings
      },
      queue: {
        totalProcessed: executions.length,
        successRate: Math.round(queueSuccessRate * 10) / 10,
        avgProcessingTime: Math.round(avgProcessingTime * 100) / 100,
        health: queueHealth,
        pending: executions.filter(e => e.status === 'pending').length,
        running: executions.filter(e => e.status === 'running').length,
        failed: failedExecutions.length
      },
      ais: {
        mode: aisMode,
        totalAgents: agents.length,
        dataPoints: dataPointsAnalyzed,
        creationTokens: Math.round(creationTokens / 1000), // in K
        executionTokens: Math.round(executionTokens / 1000), // in K
        totalTokens: creationTokens + executionTokens, // raw tokens for better display
        totalCost: aisCost,
        growthAlerts: growthAlertsData.length, // NEW: Number of agents with high growth
        avgGrowthRate // NEW: Average growth rate for alerted agents
      },
      overview: {
        lastUpdated: new Date().toISOString()
      }
    };

    console.log('Dashboard data processed successfully');

    return NextResponse.json({
      success: true,
      data: dashboardData
    });

  } catch (error) {
    console.error('Dashboard API error:', error);
    return NextResponse.json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

// Health check endpoint
export async function HEAD() {
  return new NextResponse(null, { status: 200 });
}
