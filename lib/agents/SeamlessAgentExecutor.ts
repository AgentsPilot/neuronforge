// lib/agents/SeamlessAgentExecutor.ts
export interface ExecutionContext {
  stepId: string;
  stepName: string;
  stepDescription?: string;
  workflowId: string;
  userId: string;
  inputs: Record<string, any>;
  expectedOutputs?: Array<{name: string, type: string, description?: string}>;
  previousResults?: Record<string, any>;
  metadata?: Record<string, any>;
}

export interface ExecutionResult {
  success: boolean;
  outputs: Record<string, any>;
  executionTime: number;
  error?: string;
  metadata?: {
    tokensUsed?: number;
    cost?: number;
    model?: string;
    requestId?: string;
  };
}

export class SeamlessAgentExecutor {
  private static instance: SeamlessAgentExecutor;
  
  private constructor() {}
  
  static getInstance(): SeamlessAgentExecutor {
    if (!SeamlessAgentExecutor.instance) {
      SeamlessAgentExecutor.instance = new SeamlessAgentExecutor();
    }
    return SeamlessAgentExecutor.instance;
  }

  async execute(context: ExecutionContext): Promise<ExecutionResult> {
    const startTime = Date.now();
    
    try {
      console.log(`[SEAMLESS-AGENT] Executing step: ${context.stepName}`);
      
      // Make API call to your backend endpoint that handles OpenAI
      const response = await fetch('/api/agents/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          stepId: context.stepId,
          stepName: context.stepName,
          stepDescription: context.stepDescription,
          workflowId: context.workflowId,
          userId: context.userId,
          inputs: context.inputs,
          expectedOutputs: context.expectedOutputs,
          previousResults: context.previousResults,
          metadata: context.metadata
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API call failed: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      
      return {
        success: data.success !== false,
        outputs: data.outputs || {},
        executionTime: Date.now() - startTime,
        error: data.error,
        metadata: {
          tokensUsed: data.metadata?.tokensUsed,
          cost: data.metadata?.cost,
          model: data.metadata?.model || 'gpt-3.5-turbo',
          requestId: data.metadata?.requestId
        }
      };
      
    } catch (error) {
      console.error(`[SEAMLESS-AGENT] Execution failed:`, error);
      
      return {
        success: false,
        outputs: {},
        executionTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown execution error'
      };
    }
  }

  // Helper method to validate if the platform is ready for real agent execution
  async validatePlatformReady(): Promise<{ready: boolean, issues: string[]}> {
    const issues: string[] = [];
    
    try {
      const response = await fetch('/api/agents/health-check', {
        method: 'GET'
      });
      
      if (!response.ok) {
        issues.push('Backend agent service is not available');
      } else {
        const data = await response.json();
        if (!data.openaiConfigured) {
          issues.push('OpenAI API is not properly configured');
        }
        if (!data.databaseConnected) {
          issues.push('Database connection is not available');
        }
      }
    } catch (error) {
      issues.push('Cannot connect to agent execution service');
    }
    
    return {
      ready: issues.length === 0,
      issues
    };
  }
}