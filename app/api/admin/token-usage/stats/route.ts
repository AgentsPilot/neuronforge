import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'TokenUsageStatsAdminAPI' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // Admin gate. Nothing above this line may touch a request body,
    // the database, a job queue, or an outbound message (FR-5).
    const gate = await requireAdmin(requestLogger);
    if (gate instanceof NextResponse) return gate;

    // Get basic stats
    const { data: stats, error } = await supabase
      .from('token_usage')
      .select('cost_usd, total_tokens, success, latency_ms')
      .not('cost_usd', 'is', null);

    if (error) {
      console.error('Stats error:', error);
      return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
    }

    const totalCost = stats.reduce((sum, item) => sum + (item.cost_usd || 0), 0);
    const totalTokens = stats.reduce((sum, item) => sum + (item.total_tokens || 0), 0);
    const totalRequests = stats.length;
    const successfulRequests = stats.filter(item => item.success).length;
    const successRate = totalRequests > 0 ? (successfulRequests / totalRequests) * 100 : 0;
    const validLatencies = stats.filter(item => item.latency_ms).map(item => item.latency_ms);
    const averageLatency = validLatencies.length > 0 
      ? validLatencies.reduce((sum, lat) => sum + lat, 0) / validLatencies.length 
      : 0;

    return NextResponse.json({
      totalCost,
      totalTokens,
      totalRequests,
      successRate,
      averageLatency,
      topUsers: [], // You can implement these later if needed
      topModels: [],
      dailyUsage: []
    });
  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}