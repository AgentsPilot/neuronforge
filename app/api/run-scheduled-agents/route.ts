// /app/api/run-scheduled-agents/route.ts
// Centralized scheduler that runs every 5 minutes via Vercel Cron
// Finds agents due to run and queues them for execution

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabaseClient';
import { addManualExecution } from '@/lib/queues/agentQueue'; // FIXED: Use correct function
import parser from 'cron-parser';

/**
 * Check if an agent is due to run based on its cron schedule
 */
function isAgentDue(
  cronExpression: string,
  timezone: string = 'UTC',
  lastRun?: string,
  nextRun?: string
): boolean {
  try {
    const now = new Date();
    
    // If we have a pre-calculated next_run, use it for efficiency
    if (nextRun) {
      const nextRunDate = new Date(nextRun);
      return now >= nextRunDate;
    }
    
    // Fallback: parse cron expression manually
    const interval = parser.parseExpression(cronExpression, {
      tz: timezone,
      currentDate: lastRun ? new Date(lastRun) : new Date(now.getTime() - 5 * 60 * 1000), // 5 minutes ago
    });
    
    const nextExecution = interval.next().toDate();
    return now >= nextExecution;
    
  } catch (error) {
    console.error('Error checking if agent is due:', error);
    return false;
  }
}

/**
 * Calculate next run time for an agent
 */
function calculateNextRun(cronExpression: string, timezone: string = 'UTC'): Date {
  try {
    const interval = parser.parseExpression(cronExpression, {
      tz: timezone,
      currentDate: new Date(),
    });
    return interval.next().toDate();
  } catch (error) {
    console.error('Error calculating next run:', error);
    // Fallback: 1 hour from now
    return new Date(Date.now() + 60 * 60 * 1000);
  }
}

/**
 * Main scheduler function
 * Called every 5 minutes by Vercel Cron
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  console.log('🕐 Scheduler called at:', new Date().toISOString());
  console.log('🔍 Request headers:', Object.fromEntries(request.headers.entries()));
  try {
    console.log('🕐 Starting scheduled agent scan...');
    
    // Verify this is called by Vercel Cron (security check)
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      console.warn('❌ Unauthorized cron request');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 1. Fetch all active scheduled agents from Supabase
    const { data: agents, error: agentsError } = await supabase
      .from('agents')
      .select('id, agent_name, user_id, schedule_cron, timezone, last_run, next_run, status, mode')
      .eq('mode', 'scheduled')
      .neq('status', 'archived')
      .neq('status', 'inactive');

    if (agentsError) {
      console.error('❌ Failed to fetch scheduled agents:', agentsError);
      return NextResponse.json(
        { error: 'Failed to fetch agents', details: agentsError.message },
        { status: 500 }
      );
    }

    if (!agents || agents.length === 0) {
      console.log('ℹ️ No scheduled agents found');
      return NextResponse.json({
        success: true,
        message: 'No scheduled agents to process',
        processed: 0,
        duration: Date.now() - startTime,
      });
    }

    console.log(`📋 Found ${agents.length} scheduled agents, checking which are due...`);

    // 2. Check which agents are due to run
    const agentsDue = agents.filter(agent => {
      if (!agent.schedule_cron) {
        console.warn(`⚠️ Agent ${agent.id} has no cron expression`);
        return false;
      }

      const isDue = isAgentDue(
        agent.schedule_cron,
        agent.timezone || 'UTC',
        agent.last_run,
        agent.next_run
      );

      if (isDue) {
        console.log(`⏰ Agent ${agent.agent_name} (${agent.id}) is due to run`);
      }

      return isDue;
    });

    if (agentsDue.length === 0) {
      console.log('✅ No agents are due to run at this time');
      return NextResponse.json({
        success: true,
        message: 'No agents due to run',
        totalAgents: agents.length,
        processed: 0,
        duration: Date.now() - startTime,
      });
    }

    console.log(`🚀 Found ${agentsDue.length} agents due to run, processing...`);

    // 3. Process each due agent
    const results = await Promise.allSettled(
      agentsDue.map(async (agent) => {
        try {
          // Create execution record
          const scheduledAt = new Date().toISOString();
          const { data: execution, error: executionError } = await supabase
            .from('agent_executions')
            .insert({
              agent_id: agent.id,
              user_id: agent.user_id,
              execution_type: 'scheduled',
              scheduled_at: scheduledAt,
              status: 'pending',
              cron_expression: agent.schedule_cron,
              progress: 0,
            })
            .select('id')
            .single();

          if (executionError || !execution) {
            throw new Error(`Failed to create execution record: ${executionError?.message}`);
          }

          // FIXED: Add job to queue using correct function and parameters
          const { jobId } = await addManualExecution(
            agent.id,           // agentId
            agent.user_id,      // userId
            execution.id,       // executionId
            {},                 // inputVariables (empty for scheduled runs)
            undefined           // overrideUserPrompt
          );

          // Update agent's next_run for efficient future queries
          const nextRun = calculateNextRun(agent.schedule_cron, agent.timezone || 'UTC');
          await supabase
            .from('agents')
            .update({ next_run: nextRun.toISOString() })
            .eq('id', agent.id);

          console.log(`✅ Queued agent ${agent.agent_name} (${agent.id})`, {
            executionId: execution.id,
            jobId,
            nextRun: nextRun.toISOString(),
          });

          return {
            agentId: agent.id,
            agentName: agent.agent_name,
            executionId: execution.id,
            jobId,
            success: true,
          };

        } catch (error) {
          console.error(`❌ Failed to queue agent ${agent.id}:`, error);
          return {
            agentId: agent.id,
            agentName: agent.agent_name,
            error: error instanceof Error ? error.message : 'Unknown error',
            success: false,
          };
        }
      })
    );

    // 4. Analyze results
    const successful = results.filter(r => r.status === 'fulfilled' && r.value.success);
    const failed = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success));

    const duration = Date.now() - startTime;

    console.log(`📊 Scheduler completed in ${duration}ms:`, {
      totalAgents: agents.length,
      agentsDue: agentsDue.length,
      successful: successful.length,
      failed: failed.length,
    });

    // 5. Return summary
    return NextResponse.json({
      success: true,
      summary: {
        totalAgents: agents.length,
        agentsDue: agentsDue.length,
        successful: successful.length,
        failed: failed.length,
        duration,
      },
      results: results.map(r => r.status === 'fulfilled' ? r.value : { error: 'Promise rejected' }),
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error('❌ Scheduler failed:', error);
    
    return NextResponse.json(
      {
        error: 'Scheduler failed',
        message: error instanceof Error ? error.message : 'Unknown error',
        duration,
      },
      { status: 500 }
    );
  }
}

// Prevent caching of this endpoint
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';