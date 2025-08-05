import { TestResult, WorkflowStep } from '../../components/orchestration/types/workflow'

/**
 * Simulate step test execution
 */
export const simulateStepTest = async (
  step: WorkflowStep, 
  stepIndex: number
): Promise<TestResult> => {
  const startTime = Date.now()
  
  const result: TestResult = {
    stepId: step.id.toString(),
    stepName: step.selectedAgent?.name || `Step ${stepIndex + 1}`,
    status: 'running',
    message: 'Testing step configuration...',
    timestamp: new Date()
  }
  
  // Simulate test execution delay
  await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 3000))
  
  // Determine success based on configuration completeness
  const hasRequiredConfig = step.configurationComplete && step.configurationData
  const isSuccess = hasRequiredConfig && Math.random() > 0.2 // 80% success rate if configured
  
  return {
    ...result,
    status: isSuccess ? 'success' : 'error',
    message: isSuccess 
      ? '✅ Step executed successfully! Ready for production.'
      : '❌ Configuration incomplete or connection failed.',
    duration: Date.now() - startTime,
    output: isSuccess ? {
      processed: Math.floor(Math.random() * 50) + 1,
      created: Math.floor(Math.random() * 20) + 1,
      status: 'completed'
    } : null,
    error: !isSuccess ? 'Please check your plugin connections and configuration.' : undefined
  }
}

/**
 * Simulate workflow execution
 */
export const simulateWorkflowExecution = async (
  steps: WorkflowStep[],
  onStepUpdate?: (stepIndex: number, status: 'running' | 'success' | 'error', message: string) => void
): Promise<TestResult[]> => {
  const results: TestResult[] = []
  const configuredSteps = steps.filter(step => step.selectedAgent && step.configurationComplete)
  
  for (let i = 0; i < configuredSteps.length; i++) {
    const step = configuredSteps[i]
    const stepIndex = steps.findIndex(s => s.id === step.id)
    
    onStepUpdate?.(stepIndex, 'running', `Executing ${step.selectedAgent?.name}...`)
    
    // Simulate step execution
    await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 2000))
    
    const success = Math.random() > 0.1 // 90% success rate
    const result: TestResult = {
      stepId: step.id.toString(),
      stepName: step.selectedAgent?.name || `Step ${stepIndex + 1}`,
      status: success ? 'success' : 'error',
      message: success 
        ? `✅ ${step.selectedAgent?.name} completed successfully`
        : `❌ ${step.selectedAgent?.name} failed`,
      timestamp: new Date(),
      duration: Math.floor(Math.random() * 3000) + 500,
      output: success ? {
        processed: Math.floor(Math.random() * 20) + 1,
        duration: Math.floor(Math.random() * 3000) + 500
      } : null,
      error: !success ? 'Execution failed - check configuration' : undefined
    }
    
    results.push(result)
    onStepUpdate?.(stepIndex, result.status, result.message)
    
    if (!success) break // Stop on failure
  }
  
  return results
}

/**
 * Generate test data for a step
 */
export const generateTestData = (step: WorkflowStep): any => {
  const inputs = step.selectedAgent?.inputs || []
  const testData: any = {}
  
  inputs.forEach((input: any) => {
    const inputName = typeof input === 'object' ? input.name : input
    const inputType = typeof input === 'object' ? input.type : 'data'
    
    switch (inputType) {
      case 'email_list':
        testData[inputName] = [
          { subject: 'Invoice #12345', from: 'billing@company.com', attachments: ['invoice.pdf'] },
          { subject: 'Payment Due', from: 'accounts@vendor.com', attachments: ['statement.pdf'] }
        ]
        break
      case 'file_list':
        testData[inputName] = ['invoice1.pdf', 'invoice2.pdf', 'receipt.jpg']
        break
      case 'structured_data':
        testData[inputName] = {
          invoiceNumber: 'INV-12345',
          amount: 1250.00,
          vendor: 'Acme Corp',
          dueDate: '2025-02-15'
        }
        break
      default:
        testData[inputName] = `Test data for ${inputName}`
    }
  })
  
  return testData
}

/**
 * Validate test results
 */
export const validateTestResults = (results: TestResult[]): {
  totalTests: number
  passed: number
  failed: number
  successRate: number
  averageDuration: number
} => {
  const totalTests = results.length
  const passed = results.filter(r => r.status === 'success').length
  const failed = results.filter(r => r.status === 'error').length
  const successRate = totalTests > 0 ? (passed / totalTests) * 100 : 0
  const averageDuration = results.reduce((sum, r) => sum + (r.duration || 0), 0) / totalTests
  
  return {
    totalTests,
    passed,
    failed,
    successRate,
    averageDuration
  }
}

/**
 * Format test duration
 */
export const formatDuration = (milliseconds: number): string => {
  if (milliseconds < 1000) {
    return `${milliseconds}ms`
  } else if (milliseconds < 60000) {
    return `${(milliseconds / 1000).toFixed(1)}s`
  } else {
    const minutes = Math.floor(milliseconds / 60000)
    const seconds = Math.floor((milliseconds % 60000) / 1000)
    return `${minutes}m ${seconds}s`
  }
}