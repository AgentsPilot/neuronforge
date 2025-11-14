// components/orchestration/components/testing/StepTestRunner.tsx
import React, { useState, useCallback } from 'react';
import { WorkflowService, WorkflowStep, AgentInstance } from '../../../../lib/services/workflowService';
import { simulateStepTest } from '../../../../lib/utils/testingHelpers';

interface AgentConfig {
  type: 'openai' | 'anthropic' | 'webhook' | 'custom';
  apiKey?: string;
  endpoint?: string;
  model?: string;
  parameters?: Record<string, any>;
}

interface StepTestRunnerProps {
  step: WorkflowStep;
  agent?: AgentInstance;
  workflow?: {
    connections: any[];
    previousResults?: Record<string, any>;
  };
  testEnvironment?: 'development' | 'staging' | 'production';
  onTestComplete?: (result: any) => void;
}

export const StepTestRunner: React.FC<StepTestRunnerProps> = ({
  step,
  agent,
  workflow,
  testEnvironment = 'development',
  onTestComplete
}) => {
  const [isRunning, setIsRunning] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [testMode, setTestMode] = useState<'mock' | 'sandbox' | 'real-agent'>('mock');
  const [customInputs, setCustomInputs] = useState<Record<string, any>>({});
  const [agentConfig, setAgentConfig] = useState<AgentConfig | null>(null);
  const [showAgentConfig, setShowAgentConfig] = useState(false);

  // Generate test inputs based on step definition and connections
  const generateTestInputs = useCallback(() => {
    const inputs: Record<string, any> = {};
    
    step.inputs?.forEach(input => {
      if (input.source === 'previous_step' && workflow?.previousResults) {
        const previousResult = workflow.previousResults[input.sourceStepId!];
        if (previousResult?.outputs?.[input.sourceOutputName!]) {
          inputs[input.name] = previousResult.outputs[input.sourceOutputName!];
        } else {
          inputs[input.name] = generateTypedTestValue(input.type);
        }
      } else {
        inputs[input.name] = customInputs[input.name] || generateTypedTestValue(input.type);
      }
    });
    
    return inputs;
  }, [step, workflow, customInputs]);

  const generateTypedTestValue = (type: string) => {
    const now = new Date().toISOString();
    
    switch (type?.toLowerCase()) {
      case 'email':
        return `test-${Date.now()}@example.com`;
      case 'string':
      case 'text':
        return `test-${Math.random().toString(36).substring(7)}`;
      case 'number':
      case 'integer':
        return Math.floor(Math.random() * 1000);
      case 'boolean':
        return Math.random() > 0.5;
      case 'array':
        return ['test-item-1', 'test-item-2'];
      case 'object':
      case 'json':
        return { test: 'data', timestamp: now, id: Math.random().toString(36) };
      case 'date':
        return now;
      case 'url':
        return `https://example.com/test/${Date.now()}`;
      default:
        return `test-value-${Date.now()}`;
    }
  };

  const runTest = async () => {
    setIsRunning(true);
    
    try {
      const testInputs = generateTestInputs();
      let result;
      
      if (testMode === 'real-agent') {
        result = await runRealAgentTest(testInputs);
      } else if (testMode === 'sandbox') {
        result = await runSandboxTest(testInputs);
      } else {
        result = await runMockTest(testInputs);
      }

      setTestResult(result);
      onTestComplete?.(result);
      
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
          recommendations: ['Check step and agent configuration']
        }
      };
      
      setTestResult(errorResult);
      onTestComplete?.(errorResult);
    } finally {
      setIsRunning(false);
    }
  };

  const runRealAgentTest = async (testInputs: Record<string, any>) => {
    if (!agentConfig) {
      throw new Error('Agent configuration required for real agent testing');
    }

    const startTime = Date.now();
    
    try {
      // Simulate real agent call - replace with actual implementation
      const mockApiCall = async () => {
        await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
        
        // Simulate API response based on agent type
        if (agentConfig.type === 'openai') {
          return {
            choices: [{
              message: {
                content: JSON.stringify({
                  result: 'OpenAI agent processed the inputs successfully',
                  processed_inputs: Object.keys(testInputs),
                  agent_type: 'openai',
                  model: agentConfig.model || 'gpt-3.5-turbo'
                })
              }
            }],
            usage: { total_tokens: 150 }
          };
        } else if (agentConfig.type === 'anthropic') {
          return {
            content: [{
              text: JSON.stringify({
                result: 'Anthropic agent processed the inputs successfully',
                processed_inputs: Object.keys(testInputs),
                agent_type: 'anthropic',
                model: agentConfig.model || 'claude-3-sonnet'
              })
            }],
            usage: { input_tokens: 50, output_tokens: 100 }
          };
        } else {
          return {
            success: true,
            outputs: {
              result: 'Custom agent processed the inputs successfully',
              processed_inputs: Object.keys(testInputs)
            }
          };
        }
      };

      const apiResponse = await mockApiCall();
      
      let outputs: Record<string, any> = {};
      let metadata: any = {};

      if (agentConfig.type === 'openai') {
        outputs = JSON.parse(apiResponse.choices[0].message.content);
        metadata = {
          tokensUsed: apiResponse.usage.total_tokens,
          model: agentConfig.model,
          provider: 'openai'
        };
      } else if (agentConfig.type === 'anthropic') {
        outputs = JSON.parse(apiResponse.content[0].text);
        metadata = {
          tokensUsed: apiResponse.usage.input_tokens + apiResponse.usage.output_tokens,
          model: agentConfig.model,
          provider: 'anthropic'
        };
      } else {
        outputs = apiResponse.outputs || apiResponse;
        metadata = { provider: 'custom' };
      }

      return {
        success: true,
        outputs,
        executionTime: Date.now() - startTime,
        testDetails: {
          testMode: 'real-agent',
          inputValidation: { isValid: true, errors: [] },
          outputValidation: { isValid: true, score: 100, issues: [] },
          recommendations: ['Real agent executed successfully'],
          metadata
        }
      };

    } catch (error) {
      return {
        success: false,
        outputs: {},
        executionTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Real agent execution failed',
        testDetails: {
          testMode: 'real-agent',
          inputValidation: { isValid: true, errors: [] },
          outputValidation: { isValid: false, score: 0, issues: [error instanceof Error ? error.message : 'Unknown error'] },
          recommendations: ['Check agent configuration, API credentials, and network connectivity']
        }
      };
    }
  };

  const runSandboxTest = async (testInputs: Record<string, any>) => {
    const startTime = Date.now();
    
    // Simulate sandbox delay
    await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 1500));
    
    const outputs: Record<string, any> = {};
    
    // Generate contextual outputs based on step configuration
    if (step.outputs && step.outputs.length > 0) {
      step.outputs.forEach((output, index) => {
        const outputName = output.name?.trim() || `output_${index}`;
        outputs[outputName] = generateContextualOutput(output.type || 'string', outputName, testInputs);
      });
    } else {
      outputs['result'] = {
        status: 'completed',
        processed_inputs: Object.keys(testInputs),
        sandbox_execution: true,
        timestamp: new Date().toISOString()
      };
    }

    const warnings = [];
    if (Math.random() < 0.3) {
      warnings.push('Sandbox environment detected - results may differ in production');
    }

    return {
      success: true,
      outputs,
      executionTime: Date.now() - startTime,
      testDetails: {
        testMode: 'sandbox',
        inputValidation: { isValid: true, errors: [] },
        outputValidation: { isValid: true, score: 85, issues: [] },
        recommendations: warnings.length > 0 ? warnings : ['Sandbox execution completed successfully']
      }
    };
  };

  const runMockTest = async (testInputs: Record<string, any>) => {
    return await simulateStepTest(step, testInputs, {
      testMode: 'mock',
      includeValidation: true,
      generateRealistic: true
    });
  };

  const generateContextualOutput = (type: string, name: string, inputs: Record<string, any>): any => {
    const lowerName = name.toLowerCase();
    const normalizedType = type.toLowerCase();
    
    if (lowerName.includes('email') && normalizedType.includes('array')) {
      return [
        { id: 1, subject: 'Invoice #12345', from: 'billing@company.com', hasAttachment: true },
        { id: 2, subject: 'Receipt for payment', from: 'payments@vendor.com', hasAttachment: false }
      ];
    }
    
    if (lowerName.includes('count') || lowerName.includes('total')) {
      return Math.floor(Math.random() * 50) + 1;
    }
    
    if (lowerName.includes('status')) {
      return Math.random() > 0.8 ? 'warning' : 'success';
    }
    
    if (lowerName.includes('result') && normalizedType === 'object') {
      return {
        processed: true,
        items_found: Math.floor(Math.random() * 10),
        execution_time: Math.floor(Math.random() * 1000),
        input_summary: Object.keys(inputs).join(', ')
      };
    }
    
    switch (normalizedType) {
      case 'string':
      case 'text':
        return `Generated ${name}: ${Math.random().toString(36).substring(7)}`;
      case 'number':
      case 'integer':
        return Math.floor(Math.random() * 1000);
      case 'boolean':
        return Math.random() > 0.3;
      case 'array':
        return Array.from({ length: 3 }, (_, i) => `${name}_item_${i + 1}`);
      case 'object':
      case 'json':
        return {
          id: Math.random().toString(36).substring(7),
          name: `Generated ${name}`,
          timestamp: new Date().toISOString()
        };
      default:
        return `mock_${name}_${Date.now()}`;
    }
  };

  const handleCustomInputChange = (inputName: string, value: any) => {
    setCustomInputs(prev => ({
      ...prev,
      [inputName]: value
    }));
  };

  const getStatusColor = () => {
    if (!testResult) return 'border-gray-200';
    
    if (testResult.success) {
      const score = testResult.testDetails?.outputValidation?.score || 100;
      if (score >= 90) return 'border-green-200 bg-green-50';
      if (score >= 70) return 'border-yellow-200 bg-yellow-50';
    }
    return 'border-red-200 bg-red-50';
  };

  const getStatusIcon = () => {
    if (!testResult) return null;
    if (testResult.success) {
      const score = testResult.testDetails?.outputValidation?.score || 100;
      if (score >= 90) return '✅';
      if (score >= 70) return '⚠️';
    }
    return '❌';
  };

  const canRunRealAgent = agentConfig && (agentConfig.apiKey || agentConfig.endpoint);

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
            disabled={isRunning}
          >
            <option value="mock">Mock Test</option>
            <option value="sandbox">Sandbox Test</option>
            <option value="real-agent" disabled={!canRunRealAgent}>
              Real Agent {!canRunRealAgent ? '(Configure First)' : ''}
            </option>
          </select>
          
          {/* Agent Config Button */}
          <button
            onClick={() => setShowAgentConfig(!showAgentConfig)}
            className="px-3 py-1 text-sm border rounded hover:bg-gray-50"
            disabled={isRunning}
          >
            Configure Agent
          </button>
          
          {/* Run Test Button */}
          <button
            onClick={runTest}
            disabled={isRunning || (testMode === 'real-agent' && !canRunRealAgent)}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              isRunning || (testMode === 'real-agent' && !canRunRealAgent)
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            {isRunning ? 'Testing...' : 'Run Test'}
          </button>
        </div>
      </div>

      {/* Agent Configuration Panel */}
      {showAgentConfig && (
        <div className="mb-6 p-4 bg-gray-50 rounded-lg">
          <h4 className="font-semibold mb-3">Agent Configuration</h4>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Agent Type</label>
              <select
                value={agentConfig?.type || 'openai'}
                onChange={(e) => setAgentConfig(prev => ({ ...prev, type: e.target.value as any }))}
                className="w-full border rounded px-3 py-2"
              >
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="webhook">Webhook</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-1">Model</label>
              <input
                type="text"
                value={agentConfig?.model || ''}
                onChange={(e) => setAgentConfig(prev => ({ ...prev, model: e.target.value }))}
                placeholder="gpt-3.5-turbo, claude-3-sonnet, etc."
                className="w-full border rounded px-3 py-2"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-1">API Key</label>
              <input
                type="password"
                value={agentConfig?.apiKey || ''}
                onChange={(e) => setAgentConfig(prev => ({ ...prev, apiKey: e.target.value }))}
                placeholder="Enter your API key"
                className="w-full border rounded px-3 py-2"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-1">Endpoint (for webhook/custom)</label>
              <input
                type="url"
                value={agentConfig?.endpoint || ''}
                onChange={(e) => setAgentConfig(prev => ({ ...prev, endpoint: e.target.value }))}
                placeholder="https://api.example.com/agent"
                className="w-full border rounded px-3 py-2"
              />
            </div>
          </div>
        </div>
      )}

      {/* Test Environment Indicator */}
      <div className="mb-4 p-2 bg-blue-50 rounded text-sm">
        <strong>Environment:</strong> {testEnvironment} | 
        <strong> Mode:</strong> {testMode} |
        <strong> Ready for Real Testing:</strong> {canRunRealAgent ? 'Yes' : 'No (configure agent first)'}
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
                    <div className="text-sm text-gray-500 italic">
                      From: {input.sourceStepId} → {input.sourceOutputName}
                    </div>
                  ) : (
                    <input
                      type={input.type === 'number' ? 'number' : 'text'}
                      value={customInputs[input.name] || ''}
                      onChange={(e) => handleCustomInputChange(input.name, 
                        input.type === 'number' ? Number(e.target.value) : e.target.value
                      )}
                      placeholder={`Enter ${input.type || 'text'} value`}
                      className="w-full border rounded px-3 py-1 text-sm"
                    />
                  )}
                </div>
                
                <span className="text-xs text-gray-500 w-16">{input.type || 'string'}</span>
              </div>
            ))}
          </div>
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
                <div className="text-xs text-gray-500">Score</div>
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
              <div className="font-semibold text-red-800">Error</div>
              <div className="text-red-700 text-sm">{testResult.error}</div>
            </div>
          )}

          {/* Metadata for Real Agent Tests */}
          {testResult.testDetails?.metadata && (
            <div className="bg-blue-50 border border-blue-200 rounded p-3 mb-4">
              <div className="font-semibold text-blue-800">Execution Metadata</div>
              <div className="text-blue-700 text-sm space-y-1">
                {testResult.testDetails.metadata.tokensUsed && (
                  <div>Tokens Used: {testResult.testDetails.metadata.tokensUsed}</div>
                )}
                {testResult.testDetails.metadata.cost && (
                  <div>Estimated Cost: ${testResult.testDetails.metadata.cost}</div>
                )}
                {testResult.testDetails.metadata.model && (
                  <div>Model: {testResult.testDetails.metadata.model}</div>
                )}
                {testResult.testDetails.metadata.provider && (
                  <div>Provider: {testResult.testDetails.metadata.provider}</div>
                )}
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
              <h5 className="font-medium mb-2">Recommendations</h5>
              <ul className="list-disc list-inside space-y-1 text-sm text-gray-700">
                {testResult.testDetails.recommendations.map((rec, i) => (
                  <li key={i}>{rec}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
};