// lib/services/workflowService.ts
import { supabase } from '../supabaseClient';
import { simulateStepTest, TestResult } from '../utils/testingHelpers';
import { useState, useEffect } from 'react';

export interface WorkflowStep {
  id: string;
  name: string;
  description: string;
  agentId: string;
  inputs: Array<{
    name: string;
    type: string;
    required: boolean;
    source?: 'user' | 'previous_step';
    sourceStepId?: string;
    sourceOutputName?: string;
  }>;
  outputs: Array<{
    name: string;
    type: string;
    required: boolean;
    description?: string;
  }>;
  position: { x: number; y: number };
}

export interface AgentInstance {
  id: string;
  name: string;
  type: 'smart' | 'ai-generated' | 'custom';
  configuration: Record<string, any>;
  outputSchema: {
    type: string;
    fields?: Array<{ name: string; type: string }>;
  };
  executor?: {
    execute: (inputs: Record<string, any>, config?: Record<string, any>) => Promise<any>;
    validate?: (inputs: Record<string, any>) => Promise<{ isValid: boolean; errors: string[] }>;
  };
}

export interface StepConnection {
  id: string;
  fromStepId: string;
  toStepId: string;
  fromOutputName: string;
  toInputName: string;
  dataTransform?: string;
}

export interface WorkflowData {
  id: string;
  userId?: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  agents: AgentInstance[];
  connections: StepConnection[];
  status: 'draft' | 'testing' | 'validated' | 'active';
  testResults?: Record<string, TestResult>;
  lastTested?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkflowExecution {
  id: string;
  workflowId: string;
  userId: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: Date;
  completedAt?: Date;
  results?: Record<string, any>;
  errorMessage?: string;
  executionTimeMs?: number;
}

export class WorkflowService {
  private static autoSaveInterval = 30000; // 30 seconds
  private static autoSaveTimer: NodeJS.Timeout | null = null;

  /**
   * Generate a proper UUID v4
   */
  static generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * Validate UUID format
   */
  private static isValidUUID(uuid: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
  }

  /**
   * Enhanced authentication helper with retry logic
   */
  private static async getAuthenticatedUser(retries = 2): Promise<{ user: any; error?: string }> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        // First try getUser()
        const { data: userData, error: userError } = await supabase.auth.getUser();
        
        if (!userError && userData.user) {
          return { user: userData.user };
        }

        // If getUser fails, try getSession()
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        
        if (!sessionError && sessionData.session?.user) {
          return { user: sessionData.session.user };
        }

        // If this is not the last attempt, wait a bit before retrying
        if (attempt < retries) {
          await new Promise(resolve => setTimeout(resolve, 500));
          console.log(`🔄 [AUTH] Retry attempt ${attempt + 1}/${retries + 1}`);
        }
      } catch (error) {
        console.error(`❌ [AUTH] Attempt ${attempt + 1} failed:`, error);
        if (attempt === retries) {
          return { user: null, error: error instanceof Error ? error.message : 'Authentication failed' };
        }
      }
    }

    return { user: null, error: 'Authentication failed after all retries' };
  }

  /**
   * AUTO-SAVE FUNCTIONALITY
   */
  static startAutoSave(workflow: WorkflowData, onSave?: (success: boolean) => void) {
    this.stopAutoSave(); // Clear existing timer
    
    this.autoSaveTimer = setInterval(async () => {
      try {
        console.log(`[AUTO-SAVE] Starting auto-save for workflow: ${workflow.name}`);
        const result = await this.saveDraft(workflow);
        
        if (result.success) {
          console.log(`[AUTO-SAVE] Workflow "${workflow.name}" auto-saved successfully at ${new Date().toISOString()}`);
          try {
            onSave?.(true);
          } catch (callbackError) {
            console.error('[AUTO-SAVE] Callback error (success):', callbackError);
          }
        } else {
          console.error(`[AUTO-SAVE] Save failed for workflow "${workflow.name}":`, result.error);
          try {
            onSave?.(false);
          } catch (callbackError) {
            console.error('[AUTO-SAVE] Callback error (failure):', callbackError);
          }
        }
      } catch (error) {
        console.error('[AUTO-SAVE] Unexpected error:', error);
        try {
          onSave?.(false);
        } catch (callbackError) {
          console.error('[AUTO-SAVE] Callback error (catch):', callbackError);
        }
      }
    }, this.autoSaveInterval);
  }

  static stopAutoSave() {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
  }

  /**
   * DRAFT OPERATIONS (Work in Progress) - Enhanced with better error handling
   */
 
  static async saveDraft(workflow: WorkflowData): Promise<{ success: boolean; draftId?: string; error?: string }> {
    try {
      console.log('🚀 [SAVE-DRAFT] Starting save operation');
      
      // Enhanced authentication check with retry logic
      const { user, error: authError } = await this.getAuthenticatedUser();
      
      if (authError || !user) {
        const errorMsg = `Authentication failed: ${authError || 'User not found'}`;
        console.error('🔐 [SAVE-DRAFT] Auth failed:', errorMsg);
        return { success: false, error: errorMsg };
      }

      console.log('🔐 [SAVE-DRAFT] Auth successful:', {
        userId: user.id,
        userEmail: user.email
      });

      // Test database connectivity with better error handling
      const { error: connectivityError } = await supabase
        .from('workflow_drafts')
        .select('count', { count: 'exact', head: true })
        .limit(1);
      
      if (connectivityError) {
        console.error('🔌 [SAVE-DRAFT] Database connectivity failed:', connectivityError);
        return { 
          success: false, 
          error: `Database error: ${connectivityError.message}` 
        };
      }

      // Test RLS permissions
      const { error: rlsError } = await supabase
        .from('workflow_drafts')
        .select('id')
        .eq('user_id', user.id)
        .limit(1);
      
      if (rlsError) {
        console.error('🛡️ [SAVE-DRAFT] RLS permission test failed:', rlsError);
        return { 
          success: false, 
          error: `Permission error: ${rlsError.message}` 
        };
      }

      // Prepare and validate data
      const saveData = {
        id: workflow.id,
        user_id: user.id,
        name: workflow.name || 'Untitled Workflow',
        description: workflow.description || '',
        data: {
          steps: workflow.steps || [],
          agents: workflow.agents || [],
          connections: workflow.connections || [],
          status: workflow.status || 'draft',
          testResults: workflow.testResults || null
        },
        auto_saved_at: new Date().toISOString()
      };

      // Ensure we have a valid UUID for the ID
      if (!saveData.id || !this.isValidUUID(saveData.id)) {
        saveData.id = this.generateUUID();
        console.log('🔄 [SAVE-DRAFT] Generated new UUID:', saveData.id);
      }

      // Validate data size (Supabase has limits)
      const dataSize = JSON.stringify(saveData).length;
      if (dataSize > 1000000) { // 1MB limit
        console.warn('⚠️ [SAVE-DRAFT] Data size large:', dataSize);
      }
      
      console.log('📝 [SAVE-DRAFT] Attempting upsert:', {
        id: saveData.id,
        userId: saveData.user_id,
        name: saveData.name,
        dataSize,
        stepsCount: saveData.data.steps.length,
        agentsCount: saveData.data.agents.length
      });

      // Perform the upsert with timeout
      const upsertPromise = supabase
        .from('workflow_drafts')
        .upsert(saveData, {
          onConflict: 'id'
        })
        .select('id')
        .single();

      // Add timeout to prevent hanging
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Save operation timed out')), 30000)
      );

      const { data, error } = await Promise.race([upsertPromise, timeoutPromise]) as any;

      if (error) {
        console.error('❌ [SAVE-DRAFT] Upsert failed:', {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code
        });
        
        // Provide more specific error messages
        let userFriendlyError = error.message;
        if (error.code === '23505') {
          userFriendlyError = 'Conflict: This workflow ID already exists';
        } else if (error.code === '42501') {
          userFriendlyError = 'Permission denied: Please check your login status';
        } else if (error.message.includes('row-level security')) {
          userFriendlyError = 'Security policy violation: Unable to save workflow';
        }
        
        return { success: false, error: userFriendlyError };
      }

      console.log('✅ [SAVE-DRAFT] Save successful:', data);
      
      // Update the workflow object with the correct ID if it was regenerated
      if (workflow.id !== saveData.id) {
        workflow.id = saveData.id;
      }
      
      return { success: true, draftId: data.id };
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      console.error('💥 [SAVE-DRAFT] Unexpected error:', {
        error,
        message: errorMessage,
        stack: error instanceof Error ? error.stack : undefined
      });
      
      // Handle specific error types
      if (errorMessage.includes('timeout')) {
        return { success: false, error: 'Save operation timed out. Please try again.' };
      } else if (errorMessage.includes('network')) {
        return { success: false, error: 'Network error. Please check your connection.' };
      }
      
      return { 
        success: false, 
        error: errorMessage 
      };
    }
  }

  static async loadDraft(draftId: string): Promise<WorkflowData | null> {
    try {
      const { data, error } = await supabase
        .from('workflow_drafts')
        .select('*')
        .eq('id', draftId)
        .single();

      if (error) throw error;

      return {
        id: data.id,
        userId: data.user_id,
        name: data.name,
        description: data.description,
        steps: data.data.steps || [],
        agents: data.data.agents || [],
        connections: data.data.connections || [],
        status: data.data.status || 'draft',
        testResults: data.data.testResults,
        createdAt: new Date(data.created_at),
        updatedAt: new Date(data.auto_saved_at)
      };
    } catch (error) {
      console.error('Failed to load draft:', error);
      return null;
    }
  }

  static async getUserDrafts(userId?: string): Promise<WorkflowData[]> {
    try {
      let targetUserId = userId;
      
      if (!targetUserId) {
        const { user } = await this.getAuthenticatedUser();
        if (!user) return [];
        targetUserId = user.id;
      }

      const { data, error } = await supabase
        .from('workflow_drafts')
        .select('*')
        .eq('user_id', targetUserId)
        .order('auto_saved_at', { ascending: false });

      if (error) throw error;

      return data.map(draft => ({
        id: draft.id,
        userId: draft.user_id,
        name: draft.name,
        description: draft.description,
        steps: draft.data.steps || [],
        agents: draft.data.agents || [],
        connections: draft.data.connections || [],
        status: draft.data.status || 'draft',
        testResults: draft.data.testResults,
        createdAt: new Date(draft.created_at),
        updatedAt: new Date(draft.auto_saved_at)
      }));
    } catch (error) {
      console.error('Failed to load user drafts:', error);
      return [];
    }
  }

  static async deleteDraft(draftId: string): Promise<{ success: boolean }> {
    try {
      const { error } = await supabase
        .from('workflow_drafts')
        .delete()
        .eq('id', draftId);

      if (error) throw error;

      return { success: true };
    } catch (error) {
      console.error('Failed to delete draft:', error);
      return { success: false };
    }
  }

  /**
   * TESTING OPERATIONS (Memory + Results Storage)
   */
  static async testWorkflow(workflow: WorkflowData): Promise<{
    success: boolean;
    results: Record<string, TestResult>;
    overallStatus: 'passed' | 'failed' | 'warning';
  }> {
    console.log(`[WORKFLOW-TEST] Starting test for workflow: ${workflow.name}`);
    
    const results: Record<string, TestResult> = {};
    let overallStatus: 'passed' | 'failed' | 'warning' = 'passed';

    // Test each step
    for (const step of workflow.steps) {
      try {
        console.log(`[WORKFLOW-TEST] Testing step: ${step.name}`);
        
        // Find the agent for this step
        const agent = workflow.agents.find(a => a.id === step.agentId);
        
        // Generate test inputs based on step connections
        const testInputs = this.generateStepInputs(step, workflow.connections, results);
        
        // Run the test
        const testResult = await simulateStepTest(step, testInputs, {
          testMode: agent?.executor ? 'real-agent' : 'mock',
          includeValidation: true
        });

        results[step.id] = testResult;

        // Update overall status
        if (!testResult.success) {
          overallStatus = 'failed';
        } else if (testResult.testDetails?.outputValidation.score && testResult.testDetails.outputValidation.score < 80) {
          if (overallStatus === 'passed') overallStatus = 'warning';
        }

      } catch (error) {
        console.error(`[WORKFLOW-TEST] Step ${step.name} failed:`, error);
        results[step.id] = {
          success: false,
          outputs: {},
          executionTime: 0,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
        overallStatus = 'failed';
      }
    }

    // Update workflow with test results
    workflow.testResults = results;
    workflow.lastTested = new Date();
    workflow.status = overallStatus === 'passed' ? 'validated' : 'draft';

    // Save updated draft with test results
    await this.saveDraft(workflow);

    console.log(`[WORKFLOW-TEST] Workflow test completed. Status: ${overallStatus}`);
    
    return {
      success: overallStatus !== 'failed',
      results,
      overallStatus
    };
  }

  private static generateStepInputs(
    step: WorkflowStep,
    connections: StepConnection[],
    previousResults: Record<string, TestResult>
  ): Record<string, any> {
    const inputs: Record<string, any> = {};

    step.inputs.forEach(input => {
      if (input.source === 'previous_step' && input.sourceStepId && input.sourceOutputName) {
        // Get output from previous step
        const previousResult = previousResults[input.sourceStepId];
        if (previousResult?.outputs[input.sourceOutputName]) {
          inputs[input.name] = previousResult.outputs[input.sourceOutputName];
        } else {
          // Generate mock data if previous step output not available
          inputs[input.name] = this.generateMockInputValue(input.type);
        }
      } else {
        // Generate test data for user inputs
        inputs[input.name] = this.generateMockInputValue(input.type);
      }
    });

    return inputs;
  }

  private static generateMockInputValue(type: string): any {
    switch (type.toLowerCase()) {
      case 'string':
      case 'text':
        return `test-${Math.random().toString(36).substring(7)}`;
      case 'number':
      case 'integer':
        return Math.floor(Math.random() * 1000);
      case 'boolean':
        return Math.random() > 0.5;
      case 'array':
        return ['item1', 'item2', 'item3'];
      case 'object':
      case 'json':
        return { test: 'data', timestamp: Date.now() };
      default:
        return `mock-${type}-value`;
    }
  }

  /**
   * PRODUCTION OPERATIONS (Tested and Validated)
   */
  static async deployWorkflow(workflow: WorkflowData): Promise<{ success: boolean; workflowId?: string }> {
    if (workflow.status !== 'validated') {
      throw new Error('Workflow must be tested and validated before deployment');
    }

    try {
      const { user } = await this.getAuthenticatedUser();
      if (!user) {
        throw new Error('User not authenticated');
      }

      const { data, error } = await supabase
        .from('workflows')
        .insert({
          draft_id: workflow.id,
          user_id: user.id,
          name: workflow.name,
          description: workflow.description,
          steps: workflow.steps,
          agents: workflow.agents,
          connections: workflow.connections,
          test_results: workflow.testResults,
          status: 'active',
          deployed_at: new Date().toISOString()
        })
        .select('id')
        .single();

      if (error) throw error;

      console.log(`[DEPLOY] Workflow "${workflow.name}" deployed successfully`);
      
      return { success: true, workflowId: data.id };
    } catch (error) {
      console.error('Failed to deploy workflow:', error);
      return { success: false };
    }
  }

  static async getActiveWorkflows(userId?: string): Promise<WorkflowData[]> {
    try {
      let targetUserId = userId;
      
      if (!targetUserId) {
        const { user } = await this.getAuthenticatedUser();
        if (!user) return [];
        targetUserId = user.id;
      }

      const { data, error } = await supabase
        .from('workflows')
        .select('*')
        .eq('user_id', targetUserId)
        .eq('status', 'active')
        .order('deployed_at', { ascending: false });

      if (error) throw error;

      return data.map(workflow => ({
        id: workflow.id,
        userId: workflow.user_id,
        name: workflow.name,
        description: workflow.description,
        steps: workflow.steps,
        agents: workflow.agents,
        connections: workflow.connections,
        status: 'active',
        testResults: workflow.test_results,
        createdAt: new Date(workflow.created_at),
        updatedAt: new Date(workflow.updated_at)
      }));
    } catch (error) {
      console.error('Failed to load active workflows:', error);
      return [];
    }
  }

  static async getWorkflowById(workflowId: string): Promise<WorkflowData | null> {
    try {
      const { data, error } = await supabase
        .from('workflows')
        .select('*')
        .eq('id', workflowId)
        .single();

      if (error) throw error;

      return {
        id: data.id,
        userId: data.user_id,
        name: data.name,
        description: data.description,
        steps: data.steps,
        agents: data.agents,
        connections: data.connections,
        status: data.status,
        testResults: data.test_results,
        createdAt: new Date(data.created_at),
        updatedAt: new Date(data.updated_at)
      };
    } catch (error) {
      console.error('Failed to load workflow:', error);
      return null;
    }
  }

  /**
   * EXECUTION OPERATIONS (Running Production Workflows)
   */
  static async executeWorkflow(workflowId: string, userInputs?: Record<string, any>): Promise<{
    success: boolean;
    executionId?: string;
    results?: Record<string, any>;
    error?: string;
  }> {
    try {
      const { user } = await this.getAuthenticatedUser();
      if (!user) {
        throw new Error('User not authenticated');
      }

      // Load the workflow
      const workflow = await this.getWorkflowById(workflowId);
      if (!workflow) {
        throw new Error('Workflow not found');
      }

      console.log(`[EXECUTE] Starting workflow execution: ${workflow.name}`);

      // Create execution record
      const { data: execution, error: execError } = await supabase
        .from('workflow_executions')
        .insert({
          workflow_id: workflowId,
          user_id: user.id,
          status: 'running',
          input_data: userInputs || {},
          total_steps: workflow.steps.length
        })
        .select('id')
        .single();

      if (execError) throw execError;

      // Execute the workflow steps
      const stepResults: Record<string, any> = {};
      let stepsCompleted = 0;
      
      for (const step of workflow.steps) {
        try {
          const agent = workflow.agents.find(a => a.id === step.agentId);
          const stepInputs = this.generateStepInputs(step, workflow.connections, stepResults);
          
          // Log step execution start
          const { data: stepExecution } = await supabase
            .from('step_executions')
            .insert({
              execution_id: execution.id,
              step_id: step.id,
              step_name: step.name,
              agent_id: agent?.id,
              agent_name: agent?.name,
              inputs: stepInputs,
              step_order: workflow.steps.indexOf(step),
              status: 'running'
            })
            .select('id')
            .single();

          let stepResult;
          if (agent?.executor) {
            stepResult = await agent.executor.execute(stepInputs, agent.configuration);
          } else {
            // Fallback to mock execution
            stepResult = await simulateStepTest(step, stepInputs, { testMode: 'mock' });
          }

          stepResults[step.id] = stepResult;
          stepsCompleted++;

          // Update step execution
          if (stepExecution) {
            await supabase
              .from('step_executions')
              .update({
                status: 'completed',
                outputs: stepResult.outputs || stepResult,
                completed_at: new Date().toISOString()
              })
              .eq('id', stepExecution.id);
          }

        } catch (stepError) {
          console.error(`[EXECUTE] Step ${step.name} failed:`, stepError);
          
          // Log step failure
          await supabase
            .from('step_executions')
            .update({
              status: 'failed',
              error_message: stepError instanceof Error ? stepError.message : 'Unknown error',
              completed_at: new Date().toISOString()
            });

          throw stepError;
        }
      }

      // Update execution record
      await supabase
        .from('workflow_executions')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          results: stepResults,
          steps_completed: stepsCompleted
        })
        .eq('id', execution.id);

      console.log(`[EXECUTE] Workflow execution completed: ${execution.id}`);

      return {
        success: true,
        executionId: execution.id,
        results: stepResults
      };

    } catch (error) {
      console.error('Workflow execution failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  static async getWorkflowExecutions(workflowId: string): Promise<WorkflowExecution[]> {
    try {
      const { data, error } = await supabase
        .from('workflow_executions')
        .select('*')
        .eq('workflow_id', workflowId)
        .order('started_at', { ascending: false });

      if (error) throw error;

      return data.map(exec => ({
        id: exec.id,
        workflowId: exec.workflow_id,
        userId: exec.user_id,
        status: exec.status,
        startedAt: new Date(exec.started_at),
        completedAt: exec.completed_at ? new Date(exec.completed_at) : undefined,
        results: exec.results,
        errorMessage: exec.error_message,
        executionTimeMs: exec.execution_time_ms
      }));
    } catch (error) {
      console.error('Failed to load workflow executions:', error);
      return [];
    }
  }

  /**
   * UTILITY FUNCTIONS
   */
  static async getUserStats(userId?: string): Promise<{
    totalDrafts: number;
    totalWorkflows: number;
    activeWorkflows: number;
    totalExecutions: number;
    successfulExecutions: number;
  }> {
    try {
      let targetUserId = userId;
      
      if (!targetUserId) {
        const { user } = await this.getAuthenticatedUser();
        if (!user) {
          return {
            totalDrafts: 0,
            totalWorkflows: 0,
            activeWorkflows: 0,
            totalExecutions: 0,
            successfulExecutions: 0
          };
        }
        targetUserId = user.id;
      }

      const { data, error } = await supabase
        .rpc('get_user_workflow_stats', { target_user_id: targetUserId });

      if (error) throw error;

      return data[0] || {
        totalDrafts: 0,
        totalWorkflows: 0,
        activeWorkflows: 0,
        totalExecutions: 0,
        successfulExecutions: 0
      };
    } catch (error) {
      console.error('Failed to get user stats:', error);
      return {
        totalDrafts: 0,
        totalWorkflows: 0,
        activeWorkflows: 0,
        totalExecutions: 0,
        successfulExecutions: 0
      };
    }
  }
}

/**
 * REACT HOOK FOR WORKFLOW MANAGEMENT
 */
export function useWorkflowBuilder(initialWorkflow?: Partial<WorkflowData>) {
  const [workflow, setWorkflow] = useState<WorkflowData>({
    id: initialWorkflow?.id || WorkflowService.generateUUID(),
    name: initialWorkflow?.name || 'Untitled Workflow',
    description: initialWorkflow?.description || '',
    steps: initialWorkflow?.steps || [],
    agents: initialWorkflow?.agents || [],
    connections: initialWorkflow?.connections || [],
    status: 'draft',
    createdAt: new Date(),
    updatedAt: new Date()
  });

  const [autoSaveStatus, setAutoSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Start auto-save when component mounts
  useEffect(() => {
    // Create a stable callback function
    const handleAutoSave = (success: boolean) => {
      try {
        setAutoSaveStatus(success ? 'saved' : 'error');
        if (success) {
          setHasUnsavedChanges(false);
        }
      } catch (error) {
        console.error('[HOOK] Auto-save callback error:', error);
      }
    };

    // Add a small delay to ensure component is fully mounted
    const timer = setTimeout(() => {
      try {
        WorkflowService.startAutoSave(workflow, handleAutoSave);
      } catch (error) {
        console.error('[HOOK] Failed to start auto-save:', error);
      }
    }, 100);

    return () => {
      clearTimeout(timer);
      WorkflowService.stopAutoSave();
    };
  }, []); // Only run on mount/unmount

  // Track changes to workflow
  useEffect(() => {
    setHasUnsavedChanges(true);
    setAutoSaveStatus('saving');
  }, [workflow]);

  const updateWorkflow = (updates: Partial<WorkflowData>) => {
    setWorkflow(prev => ({ ...prev, ...updates, updatedAt: new Date() }));
  };

  const testWorkflow = async () => {
    setWorkflow(prev => ({ ...prev, status: 'testing' }));
    return await WorkflowService.testWorkflow(workflow);
  };

  const deployWorkflow = async () => {
    if (workflow.status !== 'validated') {
      throw new Error('Workflow must be tested first');
    }
    return await WorkflowService.deployWorkflow(workflow);
  };

  const saveManually = async () => {
    try {
      setAutoSaveStatus('saving');
      const result = await WorkflowService.saveDraft(workflow);
      if (result.success) {
        setHasUnsavedChanges(false);
        setAutoSaveStatus('saved');
      } else {
        setAutoSaveStatus('error');
      }
      return result;
    } catch (error) {
      setAutoSaveStatus('error');
      throw error;
    }
  };

  return {
    workflow,
    updateWorkflow,
    testWorkflow,
    deployWorkflow,
    saveManually,
    autoSaveStatus,
    hasUnsavedChanges
  };
}