// lib/orchestration/OrchestrationExecutor.ts
// Separate executor only for workflow orchestration - doesn't touch standalone agents

export interface OrchestrationStepContext {
  stepId: string
  stepName: string
  stepDescription?: string
  workflowId: string
  inputs: Record<string, any>
  expectedOutputs?: Array<{name: string, type: string, description?: string}>
  previousResults?: Record<string, any>
}

export interface OrchestrationResult {
  success: boolean
  outputs: Record<string, any>
  executionTime: number
  error?: string
  metadata?: {
    stepId: string
    stepName: string
    workflowId: string
    tokensUsed?: number
    model?: string
    requestId?: string
    type: 'orchestration'
  }
}

export class OrchestrationExecutor {
  private static instance: OrchestrationExecutor
  
  private constructor() {}
  
  static getInstance(): OrchestrationExecutor {
    if (!OrchestrationExecutor.instance) {
      OrchestrationExecutor.instance = new OrchestrationExecutor()
    }
    return OrchestrationExecutor.instance
  }

  async executeStep(context: OrchestrationStepContext): Promise<OrchestrationResult> {
    const startTime = Date.now()
    
    try {
      console.log(`[ORCHESTRATION-EXECUTOR] Executing step: ${context.stepName}`)
      
      // Call the dedicated orchestration API endpoint
      const response = await fetch('/api/orchestration/run-step', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          stepId: context.stepId,
          stepName: context.stepName,
          stepDescription: context.stepDescription,
          workflowId: context.workflowId,
          inputs: context.inputs,
          expectedOutputs: context.expectedOutputs,
          previousResults: context.previousResults
        })
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(errorData.error || `HTTP ${response.status}`)
      }

      const data = await response.json()
      
      return {
        success: data.success,
        outputs: data.outputs || {},
        executionTime: data.executionTime || (Date.now() - startTime),
        error: data.error,
        metadata: data.metadata
      }
      
    } catch (error) {
      console.error(`[ORCHESTRATION-EXECUTOR] Failed to execute step:`, error)
      
      return {
        success: false,
        outputs: {},
        executionTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Orchestration execution failed'
      }
    }
  }

  // Check if orchestration system is ready
  async validateOrchestrationReady(): Promise<{ready: boolean, issues: string[]}> {
    const issues: string[] = []
    
    try {
      // Test call to orchestration endpoint
      const response = await fetch('/api/orchestration/run-step', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          stepId: 'health-check',
          stepName: 'System Health Check',
          workflowId: 'health-check',
          inputs: { test: 'ping' }
        })
      })
      
      if (response.status === 401) {
        issues.push('User authentication required')
      } else if (response.status >= 500) {
        issues.push('Orchestration service unavailable')
      } else if (response.status === 400) {
        // 400 is expected for incomplete test data
        // This means the endpoint exists and is working
      }
      
    } catch (error) {
      issues.push('Cannot connect to orchestration service')
    }
    
    return {
      ready: issues.length === 0,
      issues
    }
  }

  // Generate test data for orchestration testing
  generateTestData(stepName?: string): Record<string, any> {
    const baseData = {
      test_input: `Sample data for ${stepName || 'workflow step'}`,
      timestamp: new Date().toISOString(),
      test_mode: true
    }

    // Add contextual test data based on step name
    if (stepName) {
      const lowerStepName = stepName.toLowerCase()
      
      if (lowerStepName.includes('email')) {
        baseData.email_data = [
          { subject: 'Q4 Invoice Due', from: 'billing@vendor.com', priority: 'high' },
          { subject: 'Monthly Report', from: 'reports@company.com', priority: 'medium' }
        ]
      }
      
      if (lowerStepName.includes('invoice')) {
        baseData.invoice_info = {
          number: 'INV-2024-001',
          amount: 2500.00,
          due_date: '2024-12-31',
          vendor: 'Test Vendor Inc'
        }
      }
      
      if (lowerStepName.includes('scan') || lowerStepName.includes('process')) {
        baseData.documents = ['document1.pdf', 'document2.pdf']
        baseData.process_count = 2
      }
    }

    return baseData
  }
}