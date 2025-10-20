// app/api/admin/dashboard/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // Use service role for admin access
);

export async function GET(request: NextRequest) {
  try {
    console.log('Dashboard API called');

    // Fetch all dashboard data in parallel
    const [
      messagesResult,
      usersResult,
      tokenUsageResult,
      agentsResult
    ] = await Promise.all([
      // Messages stats
      supabase.from('contact_messages').select('id, status, created_at'),

      // Users stats
      supabase.from('profiles').select('id, created_at'),

      // Token usage stats
      supabase.from('token_usage').select('total_tokens, cost_usd, success, created_at'),

      // Agents stats
      supabase.from('agents').select('id, status, created_at')
    ]);

    // Get auth users for active user count
    const { data: authUsers } = await supabase.auth.admin.listUsers();

    // Process Messages
    const messages = messagesResult.data || [];
    const unreadMessages = messages.filter(m => m.status === 'unread').length;
    const todayMessages = messages.filter(m => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return new Date(m.created_at) >= today;
    }).length;

    // Process Users
    const users = usersResult.data || [];
    const todayUsers = users.filter(u => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return new Date(u.created_at) >= today;
    }).length;

    // Calculate active users (signed in within last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const activeUsers = authUsers?.users.filter(u =>
      u.last_sign_in_at && new Date(u.last_sign_in_at) > thirtyDaysAgo
    ).length || 0;

    // Process Token Usage
    const tokenUsage = tokenUsageResult.data || [];
    const totalTokens = tokenUsage.reduce((sum, t) => sum + (t.total_tokens || 0), 0);
    const totalCost = tokenUsage.reduce((sum, t) => sum + (t.cost_usd || 0), 0);
    const successfulRequests = tokenUsage.filter(t => t.success).length;
    const successRate = tokenUsage.length > 0
      ? (successfulRequests / tokenUsage.length) * 100
      : 0;

    // Today's token usage
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTokenUsage = tokenUsage.filter(t => new Date(t.created_at) >= today);
    const todayTokens = todayTokenUsage.reduce((sum, t) => sum + (t.total_tokens || 0), 0);
    const todayCost = todayTokenUsage.reduce((sum, t) => sum + (t.cost_usd || 0), 0);

    // Process Agents
    const agents = agentsResult.data || [];
    const activeAgents = agents.filter(a => a.status === 'active').length;
    const todayAgents = agents.filter(a => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return new Date(a.created_at) >= today;
    }).length;

    // Calculate trends (comparing with yesterday)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    const today2 = new Date();
    today2.setHours(0, 0, 0, 0);

    const yesterdayMessages = messages.filter(m => {
      const date = new Date(m.created_at);
      return date >= yesterday && date < today2;
    }).length;

    const yesterdayUsers = users.filter(u => {
      const date = new Date(u.created_at);
      return date >= yesterday && date < today2;
    }).length;

    const messageTrend = yesterdayMessages > 0
      ? ((todayMessages - yesterdayMessages) / yesterdayMessages) * 100
      : todayMessages > 0 ? 100 : 0;

    const userTrend = yesterdayUsers > 0
      ? ((todayUsers - yesterdayUsers) / yesterdayUsers) * 100
      : todayUsers > 0 ? 100 : 0;

    // Recent activity (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentMessages = messages.filter(m => new Date(m.created_at) >= sevenDaysAgo);
    const recentUsers = users.filter(u => new Date(u.created_at) >= sevenDaysAgo);
    const recentTokenUsage = tokenUsage.filter(t => new Date(t.created_at) >= sevenDaysAgo);

    // Build response
    const dashboardData = {
      messages: {
        total: messages.length,
        unread: unreadMessages,
        today: todayMessages,
        trend: Math.round(messageTrend * 10) / 10,
        recent: recentMessages.length
      },
      users: {
        total: users.length,
        active: activeUsers,
        today: todayUsers,
        trend: Math.round(userTrend * 10) / 10,
        recent: recentUsers.length
      },
      tokenUsage: {
        totalTokens,
        totalCost,
        totalRequests: tokenUsage.length,
        successRate: Math.round(successRate * 10) / 10,
        todayTokens,
        todayCost,
        todayRequests: todayTokenUsage.length,
        recent: recentTokenUsage.length
      },
      agents: {
        total: agents.length,
        active: activeAgents,
        today: todayAgents
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
