// /app/api/run-scheduled-agents/route.ts
// Centralized scheduler that runs every 5 minutes via Vercel Cron
// FIXED VERSION: Prevents race conditions and multiple executions

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { addManualExecution } from '@/lib/queues/qstashQueue';
import parser from 'cron-parser';

// Required exports for Vercel function detection
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

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
 * FIXED: Uses atomic operations to prevent race conditions
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    console.log('Scheduler called at:', new Date().toISOString());
    console.log('Starting scheduled agent scan...');
    
    // Create server-side Supabase client
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
    
    // Verify this is called by Vercel Cron (security check)
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      console.warn('Unauthorized cron request - Auth header:', authHeader);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 1. Fetch all active scheduled agents from Supabase
    const { data: agents, error: agentsError } = await supabase
      .from('agents')
      .select('id, agent_name, user_id, schedule_cron, timezone, last_run, next_run, status, mode, schedule_enabled')
      .eq('mode', 'scheduled')
      .eq('status', 'active')
      .eq('schedule_enabled', true)
      .not('schedule_cron', 'is', null);

    if (agentsError) {
      console.error('Failed to fetch scheduled agents:', agentsError);
      return NextResponse.json(
        { error: 'Failed to fetch agents', details: agentsError.message },
        { status: 500 }
      );
    }

    if (!agents || agents.length === 0) {
      console.log('No scheduled agents found');
      return NextResponse.json({
        success: true,
        message: 'No scheduled agents to process',
        processed: 0,
        duration: Date.now() - startTime,
      });
    }

    console.log(`Found ${agents.length} scheduled agents, processing...`);

    // 2. Process each agent with atomic operations to prevent race conditions
    const results = await Promise.allSettled(
      agents.map(async (agent) => {
        try {
          const now = new Date();
          
          // STEP 1: Check if agent is actually due (with current time)
          const nextRunDate = agent.next_run ? new Date(agent.next_run) : null;
          
          if (!nextRunDate || now < nextRunDate) {
            return {
              agentId: agent.id,
              agentName: agent.agent_name,
              skipped: true,
              reason: `Not due yet. Next run: ${nextRunDate?.toISOString()}`,
              success: false,
            };
          }

          console.log(`Agent ${agent.agent_name} (${agent.id}) is due to run. Next run was: ${nextRunDate.toISOString()}`);

          // STEP 2: Check for existing pending/running executions
          const { data: pendingExecutions } = await supabase
            .from('agent_executions')
            .select('id, status, created_at')
            .eq('agent_id', agent.id)
            .in('status', ['pending', 'queued', 'running'])
            .order('created_at', { ascending: false })
            .limit(1);

          if (pendingExecutions && pendingExecutions.length > 0) {
            console.log(`Skipping agent ${agent.id} - already has pending execution:`, pendingExecutions[0]);
            return {
              agentId: agent.id,
              agentName: agent.agent_name,
              skipped: true,
              reason: `Already has ${pendingExecutions[0].status} execution from ${pendingExecutions[0].created_at}`,
              success: false,
            };
          }

          // STEP 3: ATOMIC OPERATION - Update next_run FIRST with WHERE condition
          // This prevents race conditions by ensuring only one scheduler instance can claim this agent
          const nextRun = calculateNextRun(agent.schedule_cron, agent.timezone || 'UTC');
          const currentTime = new Date().toISOString();
          
          console.log(`Attempting to claim agent ${agent.id} for execution. Setting next run to: ${nextRun.toISOString()}`);
          
          const { data: updateResult, error: updateError } = await supabase
            .from('agents')
            .update({ 
              next_run: nextRun.toISOString(),
              last_run: currentTime,
              updated_at: currentTime
            })
            .eq('id', agent.id)
            .eq('next_run', agent.next_run) // CRITICAL: Only update if next_run hasn't changed (prevents race condition)
            .select('id, next_run');

          // If update failed or returned no rows, another scheduler instance got it
          if (updateError || !updateResult || updateResult.length === 0) {
            console.log(`Agent ${agent.id} already claimed by another scheduler instance or next_run changed`);
            return {
              agentId: agent.id,
              agentName: agent.agent_name,
              skipped: true,
              reason: 'Already claimed by another scheduler instance',
              success: false,
            };
          }

          console.log(`Successfully claimed agent ${agent.id}. New next_run: ${updateResult[0].next_run}`);

          // STEP 4: Create execution record
          const { data: execution, error: executionError } = await supabase
            .from('agent_executions')
            .insert({
              agent_id: agent.id,
              user_id: agent.user_id,
              execution_type: 'scheduled',
              scheduled_at: currentTime,
              status: 'pending',
              cron_expression: agent.schedule_cron,
              progress: 0,
            })
            .select('id')
            .single();

          if (executionError || !execution) {
            console.error(`Failed to create execution record for agent ${agent.id}:`, executionError);
            
            // ROLLBACK: Revert the next_run update if execution creation failed
            await supabase
              .from('agents')
              .update({ 
                next_run: agent.next_run,
                last_run: agent.last_run,
                updated_at: agent.updated_at
              })
              .eq('id', agent.id);
            
            throw new Error(`Failed to create execution record: ${executionError?.message}`);
          }

          console.log(`Created execution record ${execution.id} for agent ${agent.id}`);

          // STEP 5: Queue the job for execution
          const { jobId } = await addManualExecution(
            agent.id,           // agentId
            agent.user_id,      // userId
            execution.id,       // executionId
            {},                 // inputVariables (empty for scheduled runs)
            undefined           // overrideUserPrompt
          );

          console.log(`Successfully queued agent ${agent.agent_name} (${agent.id})`, {
            executionId: execution.id,
            jobId,
            nextRun: nextRun.toISOString(),
            previousNextRun: agent.next_run,
          });

          return {
            agentId: agent.id,
            agentName: agent.agent_name,
            executionId: execution.id,
            jobId,
            nextRun: nextRun.toISOString(),
            previousNextRun: agent.next_run,
            success: true,
          };

        } catch (error) {
          console.error(`Failed to process agent ${agent.id}:`, error);
          return {
            agentId: agent.id,
            agentName: agent.agent_name,
            error: error instanceof Error ? error.message : 'Unknown error',
            success: false,
          };
        }
      })
    );

    // 3. Analyze results
    const successful = results.filter(r => r.status === 'fulfilled' && r.value.success);
    const failed = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success && !r.value.skipped));
    const skipped = results.filter(r => r.status === 'fulfilled' && r.value.skipped);

    const duration = Date.now() - startTime;

    console.log(`Scheduler completed in ${duration}ms:`, {
      totalAgents: agents.length,
      successful: successful.length,
      failed: failed.length,
      skipped: skipped.length,
    });

    // Log successful executions
    if (successful.length > 0) {
      console.log('Successfully queued agents:', successful.map(r => ({
        agentName: r.value.agentName,
        executionId: r.value.executionId,
        nextRun: r.value.nextRun
      })));
    }

    // Log skipped agents (for debugging)
    if (skipped.length > 0) {
      console.log('Skipped agents:', skipped.map(r => ({
        agentName: r.value.agentName,
        reason: r.value.reason
      })));
    }

    // 4. Return comprehensive summary
    return NextResponse.json({
      success: true,
      summary: {
        totalAgents: agents.length,
        successful: successful.length,
        failed: failed.length,
        skipped: skipped.length,
        duration,
        timestamp: new Date().toISOString(),
      },
      details: {
        successful: successful.map(r => r.value),
        failed: failed.map(r => r.status === 'fulfilled' ? r.value : { 
          error: r.status === 'rejected' ? r.reason?.message || 'Promise rejected' : 'Unknown error' 
        }),
        skipped: skipped.map(r => r.value)
      }
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error('Scheduler failed with error:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: 'Scheduler failed',
        message: error instanceof Error ? error.message : 'Unknown error',
        duration,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}