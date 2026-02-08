// app/api/run-agent-stream/route.ts
// SSE (Server-Sent Events) endpoint for real-time visualization of agent execution
// IMPORTANT: This endpoint does NOT execute the agent - it only streams events
// from an existing execution happening in /api/run-agent

import { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { ExecutionEventEmitter } from '@/lib/execution/ExecutionEventEmitter';

/**
 * SSE endpoint for streaming agent execution events (VISUALIZATION ONLY)
 *
 * Architecture:
 * - /api/run-agent executes the agent and emits events via ExecutionEventEmitter
 * - This endpoint listens to those events and streams them to the client
 * - NO duplicate execution - single source of truth
 *
 * Client connects via EventSource and receives events:
 * - step_started: When a step begins execution
 * - step_completed: When a step completes successfully
 * - step_failed: When a step fails
 * - execution_complete: Final result
 * - error: If execution fails
 */
export async function POST(request: NextRequest) {
  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name) => cookieStore.get(name)?.value,
        set: async () => {},
        remove: async () => {},
      },
    }
  );

  // Authenticate user
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Parse request
  const body = await request.json();
  const { execution_id, session_id, agent_id } = body;

  // Support two modes:
  // 1. Direct execution_id (when known upfront)
  // 2. agent_id + session_id (wait for execution to be created, then find execution_id)

  if (!execution_id && (!agent_id || !session_id)) {
    return new Response(
      JSON.stringify({ error: 'Either execution_id OR (agent_id + session_id) is required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  let finalExecutionId = execution_id;

  // If we have session_id but not execution_id, query database to find it
  if (!finalExecutionId && agent_id && session_id) {
    console.log(`📡 [SSE] Waiting for execution to be created for agent ${agent_id}, session ${session_id}...`);

    // Poll database for up to 10 seconds to find the execution
    // Query workflow_executions table (used by WorkflowPilot/StateManager)
    for (let i = 0; i < 20; i++) {
      const { data: execution } = await supabase
        .from('workflow_executions')
        .select('id')
        .eq('agent_id', agent_id)
        .eq('session_id', session_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (execution?.id) {
        finalExecutionId = execution.id;
        console.log(`📡 [SSE] Found execution_id: ${finalExecutionId}`);
        break;
      }

      // Wait 500ms before next check
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    if (!finalExecutionId) {
      return new Response(
        JSON.stringify({ error: 'Execution not found - timed out waiting for execution to start' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  console.log(`📡 [SSE] Client connected to stream execution events for: ${finalExecutionId}`);

  // Create SSE stream
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let timeoutId: NodeJS.Timeout | null = null;

      // Helper to send SSE events safely
      const sendEvent = (event: string, data: any) => {
        try {
          const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(message));
        } catch (error: any) {
          // Stream already closed, ignore
          console.log(`📡 [SSE] Cannot send event - stream already closed: ${error.message}`);
        }
      };

      // Helper to safely close stream
      const closeStream = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        try {
          controller.close();
        } catch (error: any) {
          // Already closed, ignore
          console.log(`📡 [SSE] Stream already closed: ${error.message}`);
        }
      };

      console.log(`📡 [SSE] Stream started for execution: ${finalExecutionId}`);

      // Set up event listener for this execution
      const cleanupListener = ExecutionEventEmitter.onExecutionEvent(
        finalExecutionId,
        (executionEvent) => {
          console.log(`📡 [SSE] Received event: ${executionEvent.type} for ${finalExecutionId}`);

          try {
            // Map global events to SSE events
            switch (executionEvent.type) {
              case 'step_started':
                sendEvent('step_started', {
                  stepId: executionEvent.data.step_id,
                  stepName: executionEvent.data.step_name,
                  timestamp: executionEvent.timestamp,
                });
                break;

              case 'step_completed':
                sendEvent('step_completed', {
                  stepId: executionEvent.data.step_id,
                  stepName: executionEvent.data.step_name,
                  output: executionEvent.data.result, // result field from ExecutionEventEmitter
                  timestamp: executionEvent.timestamp,
                });
                break;

              case 'step_failed':
                sendEvent('step_failed', {
                  stepId: executionEvent.data.step_id,
                  stepName: executionEvent.data.step_name,
                  error: executionEvent.data.error,
                  timestamp: executionEvent.timestamp,
                });
                break;

              case 'execution_complete':
                sendEvent('execution_complete', {
                  success: executionEvent.data.success,
                  results: executionEvent.data.results,
                  timestamp: executionEvent.timestamp,
                });
                // Clean up and close stream
                cleanupListener();
                ExecutionEventEmitter.cleanupExecution(finalExecutionId);
                closeStream();
                console.log(`📡 [SSE] Stream closed for completed execution: ${finalExecutionId}`);
                break;

              case 'execution_error':
                sendEvent('error', {
                  error: executionEvent.data.error,
                  timestamp: executionEvent.timestamp,
                });
                // Clean up and close stream
                cleanupListener();
                ExecutionEventEmitter.cleanupExecution(finalExecutionId);
                closeStream();
                console.log(`📡 [SSE] Stream closed for failed execution: ${finalExecutionId}`);
                break;
            }
          } catch (error: any) {
            console.error(`📡 [SSE] Error sending event:`, error);
          }
        }
      );

      // Set a timeout to prevent hanging connections (5 minutes)
      timeoutId = setTimeout(() => {
        console.log(`📡 [SSE] Stream timeout for execution: ${finalExecutionId}`);
        cleanupListener();
        ExecutionEventEmitter.cleanupExecution(finalExecutionId);
        sendEvent('error', { error: 'Stream timeout - execution may still be running' });
        closeStream();
      }, 300000); // 5 minutes

      // Clean up on client disconnect
      request.signal.addEventListener('abort', () => {
        console.log(`📡 [SSE] Client disconnected from execution: ${finalExecutionId}`);
        cleanupListener();
        // Don't cleanup execution events - other clients might be listening
        closeStream();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

export const dynamic = 'force-dynamic';
