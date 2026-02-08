/**
 * GET /api/calibrate/status?executionId=xxx
 *
 * Polling endpoint for the calibration page.
 * Returns step-by-step progress from workflow_step_executions.
 * Used by the frontend to display step status without SSE.
 *
 * @module app/api/calibrate/status/route
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedServerClient } from '@/lib/supabaseServerAuth';
import { createClient } from '@supabase/supabase-js';
import {
  getFriendlyStepName,
  getFriendlyStepSummary,
  getFriendlyError,
  getFriendlyRepairDescription,
} from '@/lib/pilot/shadow/friendlyLanguage';
import type { FailureCategory } from '@/lib/pilot/shadow/types';

// Create admin client inline to avoid module initialization issues
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CalibrationStepStatus {
  step_id: string;
  step_name: string;
  friendly_name: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  auto_repaired: boolean;
  friendly_summary: string;
  friendly_error?: string;
  repair_tooltip?: string;
  item_count?: number;
  duration_ms?: number;
  plugin?: string;
  action?: string;
  parameter_error_details?: {
    parameterName: string;
    problematicValue: string;
    errorMessage: string;
  };
  output_summary?: {
    type: 'array' | 'object' | 'primitive' | 'empty';
    item_count?: number;
    field_names?: string[];
    is_empty: boolean;
    preview?: string;
  };
}

interface CalibrationStatusResponse {
  execution_id: string;
  status: 'running' | 'completed' | 'failed' | 'pending';
  steps: CalibrationStepStatus[];
  summary: {
    total: number;
    completed: number;
    failed: number;
    skipped: number;
    tokens_used: number;
    execution_time_ms: number;
  };
  calibration_run_count?: number;
  production_ready?: boolean;
  error?: string;
  data_decision_requests?: any[]; // Phase 4: Pending decision requests
}

/**
 * Generate simple, user-friendly description of what the step did.
 */
function generateFriendlyPreview(
  plugin: string | undefined,
  action: string | undefined,
  count: number | undefined,
  fieldNames: string[]
): string {
  if (!count) return 'Completed';

  // Just show the count in simple language
  return `${count} item${count === 1 ? '' : 's'}`;
}

export async function GET(req: NextRequest) {
  const executionId = req.nextUrl.searchParams.get('executionId');

  if (!executionId) {
    return NextResponse.json(
      { error: 'executionId query parameter is required' },
      { status: 400 }
    );
  }

  // Authenticate request
  const supabase = await createAuthenticatedServerClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Fetch execution record (use admin to bypass RLS — step records use admin too)
    console.log(`[calibrate/status] Fetching execution: ${executionId}`);
    const { data: execution, error: execError } = await supabaseAdmin
      .from('workflow_executions')
      .select('status, error_message, total_steps, agent_id, started_at, completed_at, execution_trace')
      .eq('id', executionId)
      .single();

    if (execError || !execution) {
      console.error(`[calibrate/status] Execution not found:`, {
        executionId,
        error: execError?.message,
        errorCode: execError?.code,
        errorDetails: execError?.details,
      });
      return NextResponse.json(
        { error: 'Execution not found' },
        { status: 404 }
      );
    }

    console.log(`[calibrate/status] Found execution: ${executionId}, status: ${execution.status}`);

    // Fetch step executions
    const { data: steps, error: stepsError } = await supabaseAdmin
      .from('workflow_step_executions')
      .select('step_id, step_name, step_type, status, execution_metadata, started_at, completed_at, failed_at, error_message, tokens_used, execution_time_ms, plugin, action')
      .eq('workflow_execution_id', executionId)
      .order('created_at', { ascending: true });

    console.log(`[calibrate/status] Fetched ${steps?.length || 0} step execution records for ${executionId}`);
    if (steps && steps.length > 0) {
      console.log(`[calibrate/status] Step IDs: ${steps.map(s => s.step_id).join(', ')}`);
      console.log(`[calibrate/status] Step statuses: ${steps.map(s => `${s.step_id}:${s.status}`).join(', ')}`);
    }

    if (stepsError) {
      return NextResponse.json(
        { error: 'Failed to fetch step executions' },
        { status: 500 }
      );
    }

    // Fetch agent's pilot_steps to show all planned steps (not just executed ones)
    const { data: agent, error: agentError } = await supabaseAdmin
      .from('agents')
      .select('pilot_steps')
      .eq('id', execution.agent_id)
      .single();

    const plannedSteps = (agent?.pilot_steps as any[]) || [];
    console.log(`[calibrate/status] Agent has ${plannedSteps.length} planned steps`);

    // Create a map of executed steps by step_id for quick lookup
    const executedStepsMap = new Map((steps || []).map(s => [s.step_id, s]));

    // Merge planned steps with executed steps
    // For each planned step, use executed data if available, otherwise show as 'pending'
    const mappedSteps: CalibrationStepStatus[] = plannedSteps.map((plannedStep: any) => {
      const executedStep = executedStepsMap.get(plannedStep.id || plannedStep.step_id);

      // If step hasn't been executed yet, return pending status
      if (!executedStep) {
        return {
          step_id: plannedStep.id || plannedStep.step_id,
          step_name: plannedStep.name || plannedStep.id || plannedStep.step_id,
          friendly_name: getFriendlyStepName({
            name: plannedStep.name || plannedStep.id || plannedStep.step_id,
            type: plannedStep.type || 'action',
            plugin: plannedStep.plugin,
            action: plannedStep.action,
          }),
          status: 'pending' as CalibrationStepStatus['status'],
          auto_repaired: false,
          friendly_summary: 'Not started yet',
          friendly_error: undefined,
          repair_tooltip: undefined,
          item_count: undefined,
          duration_ms: undefined,
          plugin: plannedStep.plugin,
          action: plannedStep.action,
          parameter_error_details: undefined,
          output_summary: undefined,
        };
      }

      // Step has been executed - use the executed data
      const s = executedStep;
      const metadata = s.execution_metadata || {};
      const autoRepaired = metadata.auto_repaired === true;
      const itemCount = metadata.item_count ?? metadata.itemCount ?? undefined;

      // Debug logging for parameter error detection
      if (s.status === 'failed') {
        console.log(`[calibrate/status] Failed step ${s.step_id}:`, {
          has_parameter_error_details: !!metadata.parameter_error_details,
          parameter_error_details: metadata.parameter_error_details,
          error_message: s.error_message,
          full_metadata: metadata,
        });
      }

      // Build friendly name from step definition
      const friendlyName = getFriendlyStepName({
        name: s.step_name || s.step_id,
        type: s.step_type || 'action',
        plugin: s.plugin || metadata.plugin,
        action: s.action || metadata.action,
      });

      // Build friendly summary
      const friendlySummary = getFriendlyStepSummary({
        status: s.status,
        itemCount,
        error: s.error_message,
      });

      // Build friendly error if failed
      let friendlyError: string | undefined;
      if (s.status === 'failed' && s.error_message) {
        const category = (metadata.failure_category || 'execution_error') as FailureCategory;
        const subType = metadata.failure_sub_type;
        friendlyError = getFriendlyError(category, s.error_message, subType);
      }

      // Build repair tooltip if auto-repaired
      let repairTooltip: string | undefined;
      if (autoRepaired && metadata.repair_action) {
        repairTooltip = getFriendlyRepairDescription(metadata.repair_action);
      }

      // Calculate duration
      let durationMs: number | undefined;
      if (s.completed_at && s.started_at) {
        durationMs = new Date(s.completed_at).getTime() - new Date(s.started_at).getTime();
      } else if (s.execution_time_ms) {
        durationMs = s.execution_time_ms;
      }

      // Build output summary (metadata only - NO client data)
      // CRITICAL: We no longer store output_data (privacy-first), only metadata
      let outputSummary: any = undefined;
      if (s.status === 'completed') {
        // Use metadata fields: item_count and field_names (no actual data)
        const calculatedItemCount = itemCount;
        const fieldNames = metadata.field_names || [];
        const isEmpty = calculatedItemCount === 0;

        let type: 'array' | 'object' | 'primitive' | 'empty' = 'empty';
        let preview: string | undefined;

        if (calculatedItemCount !== undefined && calculatedItemCount > 0) {
          type = 'array'; // Assume array if we have item count
          preview = generateFriendlyPreview(s.plugin, s.action, calculatedItemCount, fieldNames);
        } else if (fieldNames.length > 0) {
          type = 'object';
          preview = 'Data retrieved successfully';
        } else if (calculatedItemCount === 0) {
          type = 'empty';
          preview = 'No results found';
        } else {
          // No metadata available
          preview = 'Completed';
        }

        outputSummary = {
          type,
          item_count: calculatedItemCount,
          field_names: fieldNames,
          is_empty: isEmpty,
          preview,
        };
      }

      return {
        step_id: s.step_id,
        step_name: s.step_name || s.step_id,
        friendly_name: friendlyName,
        status: s.status as CalibrationStepStatus['status'],
        auto_repaired: autoRepaired,
        friendly_summary: friendlySummary,
        friendly_error: friendlyError,
        repair_tooltip: repairTooltip,
        item_count: itemCount,
        duration_ms: durationMs,
        plugin: s.plugin || metadata.plugin,
        action: s.action || metadata.action,
        parameter_error_details: metadata.parameter_error_details,
        output_summary: outputSummary,
      };
    });

    // Calculate summary
    const completed = mappedSteps.filter(s => s.status === 'completed').length;
    const failed = mappedSteps.filter(s => s.status === 'failed').length;
    const skipped = mappedSteps.filter(s => s.status === 'skipped').length;
    const totalTokens = (steps || []).reduce((sum: number, s: any) => sum + (s.tokens_used || 0), 0);
    const totalTimeMs = execution.started_at && execution.completed_at
      ? new Date(execution.completed_at).getTime() - new Date(execution.started_at).getTime()
      : (steps || []).reduce((sum: number, s: any) => sum + (s.execution_time_ms || 0), 0);

    // Fetch agent lifecycle state (calibration info)
    let calibrationRunCount: number | undefined;
    let productionReady: boolean | undefined;
    if (execution.agent_id) {
      const { data: agent } = await supabaseAdmin
        .from('agents')
        .select('production_ready, calibration_run_count')
        .eq('id', execution.agent_id)
        .single();
      if (agent) {
        calibrationRunCount = agent.calibration_run_count || 0;
        productionReady = agent.production_ready || false;
      }
    }

    // Phase 4: Fetch pending data decision requests
    let decisionRequests: any[] = [];
    try {
      const { data: decisionsData } = await supabaseAdmin
        .from('data_decision_requests')
        .select('*')
        .eq('execution_id', executionId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      decisionRequests = decisionsData || [];
    } catch (decisionErr) {
      console.error('[calibrate/status] Error fetching decision requests (non-blocking):', decisionErr);
      // Don't fail the whole request if decision fetch fails
    }

    const response: CalibrationStatusResponse = {
      execution_id: executionId,
      status: execution.status as CalibrationStatusResponse['status'],
      steps: mappedSteps,
      summary: {
        total: execution.total_steps || mappedSteps.length,
        completed,
        failed,
        skipped,
        tokens_used: totalTokens,
        execution_time_ms: totalTimeMs,
      },
      calibration_run_count: calibrationRunCount,
      production_ready: productionReady,
      error: execution.error_message || undefined,
      data_decision_requests: decisionRequests,
    };

    return NextResponse.json(response);
  } catch (err: any) {
    console.error('[calibrate/status] Error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
