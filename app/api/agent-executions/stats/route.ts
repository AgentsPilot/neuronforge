// /app/api/agent-executions/stats/route.ts
// Provides real-time statistics for agent executions
// Used by admin dashboard to monitor queue health and execution metrics

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
  try {
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
      .select('*')
      .gte('created_at', oneDayAgo.toISOString())
      .order('created_at', { ascending: false })
      .limit(1000); // Limit to 1000 most recent executions

    if (error) {
      console.error('Error fetching executions:', error);
      throw error;
    }

    // Group executions by status
    const stats: ExecutionStats = {
      pending: { count: 0, executions: [] },
      running: { count: 0, executions: [] },
      completed: { count: 0, executions: [] },
      failed: { count: 0, executions: [] },
    };

    executions?.forEach((execution: AgentExecution) => {
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
    const completedExecutions = executions?.filter(e => e.status === 'completed') || [];
    const failedExecutions = executions?.filter(e => e.status === 'failed') || [];
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

    return NextResponse.json({
      success: true,
      stats,
      metrics,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('Error in /api/agent-executions/stats:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch execution statistics',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
