// components/orchestration/components/testing/OrchestrationStepTestRunner.tsx
// Separate test runner for orchestration - doesn't interfere with standalone agent testing

import React, { useState, useCallback, useEffect } from 'react'
import { WorkflowStep, AgentInstance } from '../../../../lib/services/workflowService'
import { OrchestrationExecutor } from '../../../../lib/orchestration/OrchestrationExecutor'
import { simulateStepTest } from '../../../../lib/utils/testingHelpers'

interface OrchestrationStepTestRunnerProps {
  step: WorkflowStep
  agent?: AgentInstance
  workflow?: {
    connections: any[]
    previousResults?: Record<string, any>
  }
  onTestComplete?: (result: any) => void
}

export const OrchestrationStepTestRunner: React.FC<OrchestrationStepTestRunnerProps> = ({
  step,
  agent,
  workflow,
  onTestComplete
}) => {
  const [isRunning, setIsRunning] = useState(false)
  const [testResult, setTestResult] = useState<any>(null)
  const [testMode, setTestMode] = useState<'mock' | 'sandbox' | 'orchestration'>('mock')
  const [customInputs, setCustomInputs] = useState<Record<string, any>>({})
  const [orchestrationReady, setOrchestrationReady] = useState<{ready: boolean, issues: string[]}>({ ready: false, issues: [] })
  const [checkingHealth, setCheckingHealth] = useState(true)

  // Check if orchestration system is ready
  useEffect(() => {
    const checkOrchestrationHealth = async () => {
      const executor = OrchestrationExecutor.getInstance()
      const health = await executor.validateOrchestrationReady()
      setOrchestrationReady(health)
      setCheckingHealth(false)
      
      // Auto-enable orchestration mode if ready
      if (health.ready) {
        setTestMode('orchestration')
      }
    }

    checkOrchestrationHealth()
  }, [])

  const generateTestInputs = useCallback(() => {
    const inputs: Record<string, any> = {}
    
    step.inputs?.forEach(input => {
      if (input.source === 'previous_step' && workflow?.previousResults) {
        const previousResult = workflow.previousResults[input.sourceStepId!]
        if (previousResult?.outputs?.[input.sourceOutputName!]) {
          inputs[input.name] = previousResult.outputs[input.sourceOutputName!]
        } else {
          inputs[input.name] = generateBusinessTestValue(input.type, step.name)
        }
      } else {
        inputs[input.name] = customInputs[input.name] || generateBusinessTestValue(input.type, step.name)
      }
    })
    
    // If no specific inputs, generate contextual test data
    if (Object.keys(inputs).length === 0) {
      const executor = OrchestrationExecutor.getInstance()
      return executor.generateTestData(step.name)
    }
    
    return inputs
  }, [step, workflow, customInputs])

  const generateBusinessTestValue = (type: string, stepName?: string) => {
    const stepContext = (stepName || '').toLowerCase()
    
    switch (type?.toLowerCase()) {
      case 'email':
        return `business.user.${Date.now()}@company.com`
      case 'string':
      case 'text':
        if (stepContext.includes('invoice')) return 'INV-2024-001'
        if (stepContext.includes('email')) return 'Q4 Financial Report'
        return `Business data for ${stepName || 'processing'}`
      case 'number':
      case 'integer':
        if (stepContext.includes('amount') || stepContext.includes('cost')) return 2500.00
        return Math.floor(Math.random() * 1000) + 100
      case 'boolean':
        return true
      case 'array':
        if (stepContext.includes('email')) {
          return [
            { subject: 'Invoice Due', priority: 'high' },
            { subject: 'Report Ready', priority: 'medium' }
          ]
        }
        return ['Business Item 1', 'Business Item 2', 'Business Item 3']
      case 'object':
      case 'json':
        return {
          id: `BUS_${Math.random().toString(36).substring(7).toUpperCase()}`,
          name: `Business ${stepName || 'Object'}`,
          status: 'active',
          created_date: new Date().toISOString().split('T')[0]
        }
      case 'date':
        return new Date().toISOString()
      case 'url':
        return `https://company.com/resource/${Date.now()}`
      default:
        return `Sample ${type || 'data'} for business processing`
    }
  }

  const runTest = async () => {
    setIsRunning(true)
    
    try {
      const testInputs = generateTestInputs()
      let result

      if (testMode === 'orchestration' && orchestrationReady.ready) {
        result = await runOrchestrationTest(testInputs)
      } else if (testMode === 'sandbox') {
        result = await runSandboxTest(testInputs)
      } else {
        result = await runMockTest(testInputs)
      }

      setTestResult(result)
      onTestComplete?.(result)
      
    } catch (error) {
      const errorResult = {
        success: false,
        outputs: {},
        executionTime: 0,
        error: error instanceof Error ? error.message : 'Test execution failed',
        testDetails: {
          testMode,
          inputValidation: { isValid: false, errors: ['Test execution failed'] },
          outputValidation: { isValid: false, score: 0, issues: ['Test execution failed'] },
          recommendations: ['Please check the configuration and try again']
        }
      }
      
      setTestResult(errorResult)
      onTestComplete?.(errorResult)
    } finally {
      setIsRunning(false)
    }
  }

  const runOrchestrationTest = async (testInputs: Record<string, any>) => {
    const executor = OrchestrationExecutor.getInstance()
    
    try {
      const result = await executor.executeStep({
        stepId: step.id!,
        stepName: step.name!,
        stepDescription: step.description,
        workflowId: 'test-workflow',
        inputs: testInputs,
        expectedOutputs: step.outputs,
        previousResults: workflow?.previousResults
      })

      return {
        success: result.success,
        outputs: result.outputs,
        executionTime: result.executionTime,
        error: result.error,
        testDetails: {
          testMode: 'orchestration',
          inputValidation: { isValid: true, errors: [] },
          outputValidation: { 
            isValid: result.success, 
            score: result.success ? 100 : 0, 
            issues: result.error ? [result.error] : [] 
          },
          recommendations: result.success 
            ? ['Orchestration AI processing completed successfully'] 
            : ['AI processing encountered an issue - check the logs for details'],
          metadata: result.metadata
        }
      }
    } catch (error) {
      return {
        success: false,
        outputs: {},
        executionTime: 0,
        error: error instanceof Error ? error.message : 'Orchestration execution failed',
        testDetails: {
          testMode: 'orchestration',
          inputValidation: { isValid: true, errors: [] },
          outputValidation: { isValid: false, score: 0, issues: ['Orchestration system error'] },
          recommendations: ['System issue detected - support has been notified']
        }
      }
    }
  }

  const runSandboxTest = async (testInputs: Record<string, any>) => {
    const startTime = Date.now()
    
    // Simulate realistic processing time
    await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 1500))
    
    const outputs: Record<string, any> = {}
    
    // Generate business-context outputs
    if (step.outputs && step.outputs.length > 0) {
      step.outputs.forEach((output, index) => {
        const outputName = output.name?.trim() || `output_${index}`
        outputs[outputName] = generateBusinessOutput(output.type || 'string', outputName, testInputs, step.name)
      })
    } else {
      outputs.result = {
        status: 'completed',
        message: `Successfully processed ${step.name} in sandbox environment`,
        processed_inputs: Object.keys(testInputs),
        timestamp: new Date().toISOString(),
        workflow_context: 'sandbox_testing'
      }
    }

    return {
      success: true,
      outputs,
      executionTime: Date.now() - startTime,
      testDetails: {
        testMode: 'sandbox',
        inputValidation: { isValid: true, errors: [] },
        outputValidation: { isValid: true, score: 90, issues: [] },
        recommendations: ['Sandbox test completed with realistic business simulation']
      }
    }
  }

  const runMockTest = async (testInputs: Record<string, any>) => {
    return await simulateStepTest(step, testInputs, {
      testMode: 'mock',
      includeValidation: true,
      generateRealistic: true
    })
  }

  const generateBusinessOutput = (type: string, name: string, inputs: Record<string, any>, stepName?: string): any => {
    const lowerName = name.toLowerCase()
    const lowerStepName = (stepName || '').toLowerCase()
    
    // Business-context aware generation
    if (lowerStepName.includes('email') || lowerName.includes('email')) {
      if (type.toLowerCase().includes('array')) {
        return [
          { id: 'email_001', subject: 'Q4 Invoice - Payment Due', priority: 'high', processed: true },
          { id: 'email_002', subject: 'Monthly Financial Report', priority: 'medium', processed: true },
          { id: 'email_003', subject: 'Vendor Contract Update', priority: 'low', processed: true }
        ]
      }
      return { id: 'email_processed', status: 'analyzed', insights: 'Business communication processed' }
    }
    
    if (lowerStepName.includes('invoice') || lowerName.includes('invoice')) {
      return {
        invoice_number: 'INV-2024-001',
        amount: 2500.00,
        due_date: '2024-12-31',
        vendor: 'Business Solutions Inc',
        status: 'processed',
        extracted_fields: ['amount', 'due_date', 'vendor_name']
      }
    }

    if (lowerName.includes('count') || lowerName.includes('total')) {
      return Math.floor(Math.random() * 50) + 10
    }
    
    if (lowerName.includes('status') || lowerName.includes('result')) {
      return Math.random() > 0.85 ? 'requires_review' : 'completed'
    }
    
    // Type-based fallbacks with business context
    switch (type.toLowerCase()) {
      case 'string':
      case 'text':
        return `Processed: ${name} - Business workflow result`
      case 'number':
      case 'integer':
        return Math.floor(Math.random() * 1000) + 100
      case 'boolean':
        return Math.random() > 0.15 // High success rate for business processes
      case 'array':
        return [
          `${name} result 1 - High priority`,
          `${name} result 2 - Medium priority`,
          `${name} result 3 - Completed`
        ]
      case 'object':
      case 'json':
        return {
          id: `BUS_${Math.random().toString(36).substring(7).toUpperCase()}`,
          name: `Business ${name}`,
          status: 'active',
          processed_date: new Date().toISOString().split('T')[0],
          business_unit: 'Workflow Orchestration'
        }
      default:
        return `Business result: ${name} processed successfully`
    }
  }

  const handleCustomInputChange = (inputName: string, value: any) => {
    setCustomInputs(prev => ({
      ...prev,
      [inputName]: value
    }))
  }

  const getStatusColor = () => {
    if (!testResult) return 'border-gray-200'
    
    if (testResult.success) {
      const score = testResult.testDetails?.outputValidation?.score || 100
      if (score >= 90) return 'border-green-200 bg-green-50'
      if (score >= 70) return 'border-yellow-200 bg-yellow-50'
    }
    return 'border-red-200 bg-red-50'
  }

  const getStatusIcon = () => {
    if (!testResult) return null
    if (testResult.success) {
      const score = testResult.testDetails?.outputValidation?.score || 100
      if (score >= 90) return '✅'
      if (score >= 70) return '⚠️'
    }
    return '❌'
  }

  const getTestModeLabel = (mode: string) => {
    switch (mode) {
      case 'mock':
        return 'Quick Test'
      case 'sandbox':
        return 'Business Simulation'
      case 'orchestration':
        return 'AI Orchestration'
      default:
        return mode
    }
  }

  const getTestModeDescription = (mode: string) => {
    switch (mode) {
      case 'mock':
        return 'Fast validation with sample data'
      case 'sandbox':
        return 'Realistic business scenario simulation'
      case 'orchestration':
        return 'Full AI processing with workflow context'
      default:
        return ''
    }
  }

  return (
    <div className={`border rounded-lg p-6 transition-colors ${getStatusColor()}`}>
      {/* Header */}
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            {step.name}
            {getStatusIcon()}
          </h3>
          <p className="text-gray-600 text-sm">{step.description}</p>
          {agent && (
            <p className="text-blue-600 text-sm mt-1">
              Agent: {agent.name} ({agent.type})
            </p>
          )}
        </div>
        
        <div className="flex items-center gap-4">
          {/* Test Mode Selector */}
          <select
            value={testMode}
            onChange={(e) => setTestMode(e.target.value as any)}
            className="border rounded px-3 py-1 text-sm"
            disabled={isRunning || checkingHealth}
          >
            <option value="mock">{getTestModeLabel('mock')}</option>
            <option value="sandbox">{getTestModeLabel('sandbox')}</option>
            <option value="orchestration" disabled={!orchestrationReady.ready}>
              {getTestModeLabel('orchestration')} {!orchestrationReady.ready ? '(Setting up...)' : ''}
            </option>
          </select>
          
          {/* Run Test Button */}
          <button
            onClick={runTest}
            disabled={isRunning || checkingHealth}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              isRunning || checkingHealth
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            {isRunning ? 'Processing...' : checkingHealth ? 'Checking...' : 'Run Test'}
          </button>
        </div>
      </div>

      {/* Orchestration Status */}
      {!orchestrationReady.ready && !checkingHealth && (
        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 bg-yellow-500 rounded-full"></div>
            <span className="font-medium text-yellow-800">AI Orchestration Setup in Progress</span>
          </div>
          <div className="text-sm text-yellow-700">
            <p>AI workflow processing is being configured. Quick Test and Business Simulation are available.</p>
            {orchestrationReady.issues.length > 0 && (
              <ul className="mt-1 list-disc list-inside">
                {orchestrationReady.issues.map((issue, index) => (
                  <li key={index}>{issue}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Test Mode Info */}
      <div className="mb-4 p-2 bg-blue-50 rounded text-sm">
        <strong>Test Mode:</strong> {getTestModeLabel(testMode)}
        <span className="text-gray-600 ml-2">- {getTestModeDescription(testMode)}</span>
      </div>

      {/* Input Configuration */}
      {step.inputs && step.inputs.length > 0 && (
        <div className="mb-6">
          <h4 className="font-semibold mb-3">Test Inputs</h4>
          <div className="grid gap-3">
            {step.inputs.map((input, index) => (
              <div key={input.name || index} className="flex items-center gap-3">
                <label className="w-32 text-sm font-medium text-gray-700">
                  {input.name}
                  {input.required && <span className="text-red-500 ml-1">*</span>}
                </label>
                
                <div className="flex-1">
                  {input.source === 'previous_step' ? (
                    <div className="text-sm text-gray-500 italic p-2 bg-gray-50 rounded">
                      Connected from: {input.sourceStepId} → {input.sourceOutputName}
                    </div>
                  ) : (
                    <input
                      type={input.type === 'number' ? 'number' : 'text'}
                      value={customInputs[input.name] || ''}
                      onChange={(e) => handleCustomInputChange(input.name, 
                        input.type === 'number' ? Number(e.target.value) : e.target.value
                      )}
                      placeholder={`Enter ${input.type || 'text'} value (optional - will use business sample data)`}
                      className="w-full border rounded px-3 py-2 text-sm"
                    />
                  )}
                </div>
                
                <span className="text-xs text-gray-500 w-20">{input.type || 'text'}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Leave inputs empty to use contextual business sample data
          </p>
        </div>
      )}

      {/* Test Results */}
      {testResult && (
        <div className="border-t pt-4">
          <h4 className="font-semibold mb-3">Test Results</h4>
          
          {/* Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div className="text-center">
              <div className={`text-lg font-bold ${testResult.success ? 'text-green-600' : 'text-red-600'}`}>
                {testResult.success ? 'PASS' : 'FAIL'}
              </div>
              <div className="text-xs text-gray-500">Status</div>
            </div>
            
            <div className="text-center">
              <div className="text-lg font-bold">{testResult.executionTime || 0}ms</div>
              <div className="text-xs text-gray-500">Duration</div>
            </div>
            
            {testResult.testDetails?.outputValidation && (
              <div className="text-center">
                <div className={`text-lg font-bold ${
                  testResult.testDetails.outputValidation.score >= 80 ? 'text-green-600' : 
                  testResult.testDetails.outputValidation.score >= 60 ? 'text-yellow-600' : 'text-red-600'
                }`}>
                  {testResult.testDetails.outputValidation.score}%
                </div>
                <div className="text-xs text-gray-500">Quality</div>
              </div>
            )}
            
            <div className="text-center">
              <div className="text-lg font-bold">{Object.keys(testResult.outputs || {}).length}</div>
              <div className="text-xs text-gray-500">Outputs</div>
            </div>
          </div>

          {/* Error Message */}
          {testResult.error && (
            <div className="bg-red-50 border border-red-200 rounded p-3 mb-4">
              <div className="font-semibold text-red-800">Processing Issue</div>
              <div className="text-red-700 text-sm">{testResult.error}</div>
            </div>
          )}

          {/* Success Message for Orchestration */}
          {testResult.success && testMode === 'orchestration' && (
            <div className="bg-green-50 border border-green-200 rounded p-3 mb-4">
              <div className="font-semibold text-green-800">AI Orchestration Successful</div>
              <div className="text-green-700 text-sm">
                Your workflow step was processed with full AI orchestration context
              </div>
            </div>
          )}

          {/* Orchestration Metadata */}
          {testResult.testDetails?.metadata && testMode === 'orchestration' && (
            <div className="bg-blue-50 border border-blue-200 rounded p-3 mb-4">
              <div className="font-semibold text-blue-800">Orchestration Details</div>
              <div className="text-blue-700 text-sm grid grid-cols-2 gap-2">
                {testResult.testDetails.metadata.tokensUsed && (
                  <div>Tokens Used: {testResult.testDetails.metadata.tokensUsed}</div>
                )}
                {testResult.testDetails.metadata.model && (
                  <div>Model: {testResult.testDetails.metadata.model}</div>
                )}
                <div>Step ID: {testResult.testDetails.metadata.stepId}</div>
                <div>Workflow ID: {testResult.testDetails.metadata.workflowId}</div>
              </div>
            </div>
          )}

          {/* Outputs */}
          {testResult.outputs && Object.keys(testResult.outputs).length > 0 && (
            <div className="mb-4">
              <h5 className="font-medium mb-2">Generated Outputs</h5>
              <div className="bg-gray-50 rounded p-3 text-sm font-mono max-h-64 overflow-auto">
                <pre className="whitespace-pre-wrap">
                  {JSON.stringify(testResult.outputs, null, 2)}
                </pre>
              </div>
            </div>
          )}

          {/* Recommendations */}
          {testResult.testDetails?.recommendations && testResult.testDetails.recommendations.length > 0 && (
            <div>
              <h5 className="font-medium mb-2">Notes</h5>
              <ul className="list-disc list-inside space-y-1 text-sm text-gray-700">
                {testResult.testDetails.recommendations.map((rec, i) => (
                  <li key={i}>{rec}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Help Text */}
      <div className="mt-4 pt-4 border-t text-xs text-gray-500">
        <p><strong>Orchestration Test Modes:</strong></p>
        <ul className="mt-1 space-y-1">
          <li><strong>Quick Test:</strong> Instant validation for development</li>
          <li><strong>Business Simulation:</strong> Realistic business scenarios</li>
          <li><strong>AI Orchestration:</strong> Full AI processing with workflow context</li>
        </ul>
      </div>
    </div>
  )
}