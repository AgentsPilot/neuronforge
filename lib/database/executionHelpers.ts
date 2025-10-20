import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface AgentExecution {
  id: string;
  agent_id: string;
  execution_type: 'manual' | 'scheduled' | 'triggered';
  scheduled_at: string;
  started_at?: string;
  completed_at?: string;
  status: 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'retrying';
  result?: any;
  error_message?: string;
  execution_duration_ms?: number;
  retry_count: number;
  next_retry_at?: string;
  job_id?: string;
  queue_name?: string;
  progress: number;
  user_id?: string;
  cron_expression?: string;
  next_scheduled_run?: string;
  logs?: any[];
  created_at: string;
  updated_at: string;
}

// Lazy initialization of Supabase client
let supabase: SupabaseClient | null = null;

function getSupabaseClient(): SupabaseClient {
  if (!supabase) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL; // Changed this line
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl) {
      throw new Error('NEXT_PUBLIC_SUPABASE_URL is required in environment variables');
    }

    if (!supabaseKey) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY is required in environment variables');
    }

    supabase = createClient(supabaseUrl, supabaseKey);
  }

  return supabase;
}
// Create new execution record
export async function createExecution(data: {
  agent_id: string;
  user_id: string | null;
  execution_type: 'manual' | 'scheduled' | 'triggered';
  cron_expression?: string;
  scheduled_at?: string;
}): Promise<{ data: AgentExecution | null; error: any }> {
  const executionData = {
    agent_id: data.agent_id,
    user_id: data.user_id,
    execution_type: data.execution_type,
    scheduled_at: data.scheduled_at || new Date().toISOString(),
    status: 'pending' as const, // Add this required field
    progress: 0, // Add this since table expects it
    retry_count: 0, // Add this since table expects it
    queue_name: 'agent-execution', // Add this since table expects it
    cron_expression: data.cron_expression || null
  };

  return await getSupabaseClient()
    .from('agent_executions')
    .insert(executionData)
    .select()
    .single();
}

// Update execution with job ID after queuing
export async function updateExecutionWithJobId(
  executionId: string, 
  jobId: string
): Promise<{ error: any }> {
  const { error } = await getSupabaseClient()
    .from('agent_executions')
    .update({ 
      job_id: jobId,
      status: 'queued',
      updated_at: new Date().toISOString()
    })
    .eq('id', executionId);

  return { error };
}

// Update execution status
export async function updateExecutionStatus(
  executionId: string,
  status: AgentExecution['status'],
  updates: Partial<AgentExecution> = {}
): Promise<{ error: any }> {
  const updateData = {
    status,
    ...updates,
    updated_at: new Date().toISOString()
  };

  const { error } = await getSupabaseClient()
    .from('agent_executions')
    .update(updateData)
    .eq('id', executionId);

  return { error };
}

// Update execution progress
export async function updateExecutionProgress(
  executionId: string,
  progress: number,
  logs?: any[]
): Promise<{ error: any }> {
  const updateData: any = {
    progress,
    updated_at: new Date().toISOString()
  };

  if (logs) {
    updateData.logs = logs;
  }

  const { error } = await getSupabaseClient()
    .from('agent_executions')
    .update(updateData)
    .eq('id', executionId);

  return { error };
}

// Get latest execution for an agent
export async function getLatestExecution(
  agentId: string
): Promise<{ data: AgentExecution | null; error: any }> {
  return await getSupabaseClient()
    .from('agent_executions')
    .select('*')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
}

// Get running executions for an agent
export async function getRunningExecutions(
  agentId: string
): Promise<{ data: AgentExecution[]; error: any }> {
  return await getSupabaseClient()
    .from('agent_executions')
    .select('*')
    .eq('agent_id', agentId)
    .in('status', ['pending', 'queued', 'running'])
    .order('created_at', { ascending: false });
}

// Get execution by job ID
export async function getExecutionByJobId(
  jobId: string
): Promise<{ data: AgentExecution | null; error: any }> {
  return await getSupabaseClient()
    .from('agent_executions')
    .select('*')
    .eq('job_id', jobId)
    .single();
}

// Mark execution as completed with results
export async function completeExecution(
  executionId: string,
  result: any,
  startedAt?: string
): Promise<{ error: any }> {
  const now = new Date().toISOString();
  const started = startedAt || now;
  
  const execution_duration_ms = startedAt 
    ? new Date(now).getTime() - new Date(started).getTime()
    : 0;

  return await updateExecutionStatus(executionId, 'completed', {
    completed_at: now,
    result,
    progress: 100,
    execution_duration_ms
  });
}

// Mark execution as failed with error
export async function failExecution(
  executionId: string,
  errorMessage: string,
  startedAt?: string
): Promise<{ error: any }> {
  const now = new Date().toISOString();
  const started = startedAt || now;
  
  const execution_duration_ms = startedAt 
    ? new Date(now).getTime() - new Date(started).getTime()
    : 0;

  return await updateExecutionStatus(executionId, 'failed', {
    completed_at: now,
    error_message: errorMessage,
    execution_duration_ms
  });
}