// /app/api/run-scheduled-agents-direct/route.ts
// Vercel-compatible scheduler - executes agents directly without queue
// This version doesn't use Redis/BullMQ - executes agents synchronously

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { runAgentWithContext } from '@/lib/utils/runAgentWithContext';
import parser from 'cron-parser';
import { createLogger } from '@/lib/logger';
import { isAuthorizedCronRequest } from '@/lib/cron/cronAuth';

const logger = createLogger({ module: 'RunScheduledAgentsDirect' });

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // 1 minute max for execution

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
    logger.error({ err: error, cronExpression, timezone }, 'Error calculating next run');
    return new Date(Date.now() + 60 * 60 * 1000);
  }
}

/**
 * Direct execution scheduler - NO QUEUE
 * Executes agents directly in the serverless function
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();

  /*
   * Cron auth: lib/cron/cronAuth.ts, fail-closed (PROD-1b, A5), before any
   * work. The check used to compare against a template of the secret without
   * testing it existed, so with the secret unset the header "Bearer undefined"
   * was accepted. Not scheduled in vercel.json; G-6 lists it explicitly.
   */
  if (!isAuthorizedCronRequest(request, logger)) {
    logger.warn('Unauthorized cron request');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    logger.info('Direct scheduler called');

    // Create Supabase client
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    // Fetch due agents
    const now = new Date();
    const { data: agents, error: agentsError } = await supabase
      .from('agents')
      .select('id, agent_name, user_id, schedule_cron, timezone, next_run, system_prompt, input_schema, output_schema, connected_plugins')
      .eq('mode', 'scheduled')
      .eq('status', 'active')
      .eq('schedule_enabled', true)
      .not('schedule_cron', 'is', null)
      .lte('next_run', now.toISOString()); // Only agents that are due

    if (agentsError) {
      logger.error({ err: agentsError }, 'Failed to fetch agents');
      return NextResponse.json({ error: 'Failed to fetch agents' }, { status: 500 });
    }

    if (!agents || agents.length === 0) {
      logger.info('No agents due for execution');
      return NextResponse.json({
        success: true,
        message: 'No agents due',
        processed: 0,
        duration: Date.now() - startTime,
      });
    }

    logger.info({ dueCount: agents.length }, 'Found due agents');

    // Process agents (limit to 3 at a time to stay under 60s limit)
    const agentsToProcess = agents.slice(0, 3);
    const results = await Promise.allSettled(
      agentsToProcess.map(async (agent) => {
        try {
          logger.info({ agentId: agent.id }, 'Executing agent');

          // Calculate next run time
          const nextRun = calculateNextRun(agent.schedule_cron, agent.timezone || 'UTC');

          // Update agent's next_run atomically
          const { data: updateResult } = await supabase
            .from('agents')
            .update({
              next_run: nextRun.toISOString(),
              last_run: now.toISOString(),
            })
            .eq('id', agent.id)
            .eq('next_run', agent.next_run)
            .select('id');

          if (!updateResult || updateResult.length === 0) {
            logger.info({ agentId: agent.id }, 'Agent already claimed');
            return { agentId: agent.id, skipped: true };
          }

          // Create execution record
          const { data: execution, error: execError } = await supabase
            .from('agent_executions')
            .insert({
              agent_id: agent.id,
              user_id: agent.user_id,
              execution_type: 'scheduled',
              scheduled_at: now.toISOString(),
              started_at: now.toISOString(),
              status: 'running',
              cron_expression: agent.schedule_cron,
              progress: 0,
            })
            .select('id')
            .single();

          if (execError || !execution) {
            throw new Error(`Failed to create execution: ${execError?.message}`);
          }

          // Execute agent directly
          const result = await runAgentWithContext({
            supabase,
            agent,
            userId: agent.user_id,
            input_variables: {},
            override_user_prompt: undefined,
            onProgress: async (progress) => {
              await supabase
                .from('agent_executions')
                .update({ progress })
                .eq('id', execution.id);
            },
          });

          const endTime = new Date();
          const duration = endTime.getTime() - now.getTime();

          // Update execution as completed
          await supabase
            .from('agent_executions')
            .update({
              status: 'completed',
              completed_at: endTime.toISOString(),
              result,
              execution_duration_ms: duration,
              progress: 100,
            })
            .eq('id', execution.id);

          logger.info({ agentId: agent.id, durationMs: duration }, 'Agent completed');

          return {
            agentId: agent.id,
            agentName: agent.agent_name,
            executionId: execution.id,
            duration,
            success: true,
          };

        } catch (error) {
          logger.error({ err: error, agentId: agent.id }, 'Agent failed');
          return {
            agentId: agent.id,
            error: error instanceof Error ? error.message : 'Unknown error',
            success: false,
          };
        }
      })
    );

    const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;

    return NextResponse.json({
      success: true,
      processed: successful,
      total: agentsToProcess.length,
      duration: Date.now() - startTime,
      results: results.map(r => r.status === 'fulfilled' ? r.value : { error: r.reason }),
    });

  } catch (error) {
    logger.error({ err: error }, 'Scheduler error');
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
