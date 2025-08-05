// components/orchestration/components/testing/StepTestRunner.tsx
import React, { useState, useCallback } from 'react';
import { Play, CheckCircle, AlertTriangle, Clock, Settings, Zap, Eye, RotateCcw } from 'lucide-react';
import { WorkflowStep } from '../../types/workflow';
import { TestResult, TestConfiguration } from '../../types/testing';
import { TestDataGenerator, AgentExecutionTester, IntegrationTester } from '../../../../utils/testingHelpers';

interface StepTestRunnerProps {
  step: WorkflowStep;
  stepIndex: number;
  onTestComplete: (result: TestResult) => void;
}

export const StepTestRunner: React.FC<StepTestRunnerProps> = ({
  step,
  stepIndex,
  onTestComplete
}) => {
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [testConfig, setTestConfig] = useState<TestConfiguration>({
    testMode: 'mock',
    includePerformanceTests: false,
    includeIntegrationTests: true,
    includeDataFlowTests: false,
    maxExecutionTime: 30000,
    testIterations: 1,
    generateTestData: true,
    customTestData: undefined
  });

  // Test configuration validation
  const testConfiguration = useCallback(() => {
    const hasAgent = !!step.selectedAgent;
    const hasRequiredInputs = (step.inputs?.length || 0) > 0;
    const hasExpectedOutputs = (step.outputs?.length || 0) > 0;
    const isConfigured = step.configurationComplete || false;
    
    let score = 0;
    if (hasAgent) score += 40;
    if (hasRequiredInputs) score += 20;
    if (hasExpectedOutputs) score += 20;
    if (isConfigured) score += 20;

    return {
      hasAgent,
      hasRequiredInputs,
      hasExpectedOutputs,
      isConfigured,
      configurationScore: score
    };
  }, [step]);

  // Run complete test suite
  const runCompleteTest = useCallback(async () => {
    setIsRunning(true);
    
    const testStartTime = Date.now();
    const configTest = testConfiguration();

    // Initialize result
    let result: TestResult = {
      status: 'running',
      stepIndex,
      stepTitle: step.title || `Step ${stepIndex + 1}`,
      timestamp: new Date(),
      configurationTest: configTest,
      overallScore: 0,
      recommendations: [],
      warnings: []
    };

    setTestResult(result);

    try {
      // Step 1: Configuration validation
      if (!configTest.hasAgent) {
        throw new Error('No agent assigned to this step');
      }

      // Step 2: Integration testing (if enabled and configured)
      if (testConfig.includeIntegrationTests) {
        console.log('Running integration tests...');
        const integrationTest = await IntegrationTester.testConnectivity(step, testConfig);
        result.integrationTest = integrationTest;
      }

      // Step 3: Agent execution testing
      console.log('Running agent execution tests...');
      const testInputs = testConfig.generateTestData 
        ? TestDataGenerator.generateTestInputs(step)
        : testConfig.customTestData || {};

      const executionTest = await AgentExecutionTester.executeStep(step, testInputs, testConfig);
      result.executionTest = executionTest;

      // Step 4: Performance testing (if enabled)
      if (testConfig.includePerformanceTests && executionTest.status === 'success') {
        console.log('Running performance tests...');
        const performanceResults = [];
        
        for (let i = 0; i < testConfig.testIterations; i++) {
          const perfTest = await AgentExecutionTester.executeStep(step, testInputs, testConfig);
          if (perfTest.status === 'success') {
            performanceResults.push(perfTest.executionTime);
          }
        }

        if (performanceResults.length > 0) {
          result.performanceTest = {
            averageExecutionTime: performanceResults.reduce((a, b) => a + b, 0) / performanceResults.length,
            successRate: performanceResults.length / testConfig.testIterations,
            iterations: testConfig.testIterations
          };
        }
      }

      // Calculate overall score and status
      const { overallScore, status, recommendations, warnings } = calculateOverallResult(result);
      
      result = {
        ...result,
        status,
        overallScore,
        recommendations,
        warnings
      };

    } catch (error) {
      result = {
        ...result,
        status: 'error',
        executionTest: {
          status: 'error',
          executionTime: Date.now() - testStartTime,
          testInputs: {},
          expectedOutputStructure: step.outputs || [],
          outputValidation: {
            isValid: false,
            missingFields: [],
            typeErrors: ['Test execution failed'],
            extraFields: []
          },
          error: error.message
        },
        overallScore: 0,
        recommendations: ['Fix configuration issues before testing'],
        warnings: [error.message]
      };
    } finally {
      setTestResult(result);
      setIsRunning(false);
      onTestComplete(result);
    }
  }, [step, stepIndex, testConfig, testConfiguration, onTestComplete]);

  // Calculate overall test result
  const calculateOverallResult = (result: TestResult) => {
    let score = result.configurationTest.configurationScore;
    let status: TestResult['status'] = 'success';
    const recommendations: string[] = [];
    const warnings: string[] = [];

    // Factor in execution test
    if (result.executionTest) {
      if (result.executionTest.status === 'success') {
        score += 30;
        if (result.executionTest.outputValidation.isValid) {
          score += 20;
        } else {
          score += 10;
          warnings.push('Output validation failed');
        }
      } else {
        status = 'error';
        warnings.push('Agent execution failed');
      }
    }

    // Factor in integration test
    if (result.integrationTest) {
      if (result.integrationTest.status === 'success') {
        score += 10;
      } else if (result.integrationTest.status === 'error') {
        warnings.push('Integration connectivity issues detected');
      }
    }

    // Generate recommendations
    if (result.configurationTest.configurationScore < 100) {
      if (!result.configurationTest.hasAgent) {
        recommendations.push('Assign an agent to this step');
      }
      if (!result.configurationTest.isConfigured) {
        recommendations.push('Complete agent configuration');
      }
      if (!result.configurationTest.hasExpectedOutputs) {
        recommendations.push('Define expected outputs for validation');
      }
    }

    if (result.executionTest?.executionTime && result.executionTest.executionTime > 5000) {
      recommendations.push('Consider optimizing agent performance (slow execution)');
    }

    return {
      overallScore: Math.min(100, score),
      status: score >= 80 ? 'success' : 'error',
      recommendations,
      warnings
    };
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'success': return 'text-green-600 bg-green-50 border-green-200';
      case 'error': return 'text-red-600 bg-red-50 border-red-200';
      case 'running': return 'text-blue-600 bg-blue-50 border-blue-200';
      default: return 'text-slate-600 bg-slate-50 border-slate-200';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success': return <CheckCircle className="h-4 w-4" />;
      case 'error': return <AlertTriangle className="h-4 w-4" />;
      case 'running': return <Clock className="h-4 w-4 animate-spin" />;
      default: return <Play className="h-4 w-4" />;
    }
  };

  return (
    <div className="border border-slate-200 rounded-xl p-6 bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-sm font-semibold text-blue-700">
            {stepIndex + 1}
          </div>
          <div>
            <h3 className="font-semibold text-slate-900">
              {step.title || `Step ${stepIndex + 1}`}
            </h3>
            <p className="text-sm text-slate-600">
              {step.selectedAgent?.name || 'No agent assigned'}
            </p>
          </div>
        </div>
        
        {testResult && (
          <div className={`flex items-center gap-2 px-3 py-1 rounded-full border ${getStatusColor(testResult.status)}`}>
            {getStatusIcon(testResult.status)}
            <span className="text-sm font-medium capitalize">{testResult.status}</span>
            {testResult.overallScore > 0 && (
              <span className="text-xs">({testResult.overallScore}/100)</span>
            )}
          </div>
        )}
      </div>

      {/* Quick Status Indicators */}
      {testResult && (
        <div className="grid grid-cols-4 gap-2 mb-4">
          <div className={`text-center p-2 rounded-lg text-xs ${
            testResult.configurationTest.hasAgent ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
          }`}>
            <div className="font-medium">Agent</div>
            <div>{testResult.configurationTest.hasAgent ? '✓' : '✗'}</div>
          </div>
          
          <div className={`text-center p-2 rounded-lg text-xs ${
            testResult.executionTest?.status === 'success' ? 'bg-green-50 text-green-700' : 
            testResult.executionTest?.status === 'error' ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-gray-700'
          }`}>
            <div className="font-medium">Execution</div>
            <div>{testResult.executionTest?.status === 'success' ? '✓' : 
                   testResult.executionTest?.status === 'error' ? '✗' : '-'}</div>
          </div>
          
          <div className={`text-center p-2 rounded-lg text-xs ${
            testResult.integrationTest?.status === 'success' ? 'bg-green-50 text-green-700' : 
            testResult.integrationTest?.status === 'error' ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-gray-700'
          }`}>
            <div className="font-medium">Integration</div>
            <div>{testResult.integrationTest?.status === 'success' ? '✓' : 
                   testResult.integrationTest?.status === 'error' ? '✗' : '-'}</div>
          </div>
          
          <div className={`text-center p-2 rounded-lg text-xs ${
            testResult.executionTest?.outputValidation.isValid ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
          }`}>
            <div className="font-medium">Outputs</div>
            <div>{testResult.executionTest?.outputValidation.isValid ? '✓' : '✗'}</div>
          </div>
        </div>
      )}

      {/* Test Controls */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-slate-700">Mode:</label>
          <select
            value={testConfig.testMode}
            onChange={(e) => setTestConfig(prev => ({ ...prev, testMode: e.target.value as any }))}
            className="text-sm border border-slate-300 rounded px-2 py-1"
            disabled={isRunning}
          >
            <option value="mock">Mock</option>
            <option value="sandbox">Sandbox</option>
            <option value="live">Live (Careful!)</option>
          </select>
        </div>

        <button
          onClick={runCompleteTest}
          disabled={isRunning || !step.selectedAgent}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
            isRunning || !step.selectedAgent
              ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-700 text-white'
          }`}
        >
          {isRunning ? (
            <>
              <Clock className="h-4 w-4 animate-spin" />
              Testing...
            </>
          ) : (
            <>
              <Zap className="h-4 w-4" />
              Run Tests
            </>
          )}
        </button>

        {testResult && (
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="flex items-center gap-2 px-3 py-2 text-sm bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors"
          >
            <Eye className="h-4 w-4" />
            {showDetails ? 'Hide' : 'Show'} Details
          </button>
        )}
      </div>

      {/* Test Results */}
      {testResult && (
        <div className="space-y-4">
          {/* Recommendations & Warnings */}
          {(testResult.recommendations.length > 0 || testResult.warnings.length > 0) && (
            <div className="space-y-2">
              {testResult.recommendations.length > 0 && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <h4 className="text-sm font-medium text-blue-900 mb-1">Recommendations</h4>
                  <ul className="text-sm text-blue-800 space-y-1">
                    {testResult.recommendations.map((rec, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-blue-600">•</span>
                        <span>{rec}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              
              {testResult.warnings.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <h4 className="text-sm font-medium text-amber-900 mb-1">Warnings</h4>
                  <ul className="text-sm text-amber-800 space-y-1">
                    {testResult.warnings.map((warning, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <AlertTriangle className="h-3 w-3 text-amber-600 mt-0.5 flex-shrink-0" />
                        <span>{warning}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Detailed Results */}
          {showDetails && testResult.executionTest && (
            <div className="border border-slate-200 rounded-lg p-4 bg-slate-50">
              <h4 className="font-medium text-slate-900 mb-3">Execution Details</h4>
              
              <div className="space-y-3 text-sm">
                <div>
                  <strong>Status:</strong> 
                  <span className={`ml-1 ${testResult.executionTest.status === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                    {testResult.executionTest.status}
                  </span>
                </div>
                
                <div>
                  <strong>Execution Time:</strong> {testResult.executionTest.executionTime}ms
                </div>
                
                {testResult.executionTest.actualOutputs && (
                  <div>
                    <strong>Generated Outputs:</strong>
                    <pre className="mt-1 p-2 bg-white border rounded text-xs overflow-auto max-h-32">
                      {JSON.stringify(testResult.executionTest.actualOutputs, null, 2)}
                    </pre>
                  </div>
                )}
                
                {testResult.executionTest.error && (
                  <div>
                    <strong>Error:</strong> 
                    <span className="text-red-600 ml-1">{testResult.executionTest.error}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* No Agent Warning */}
      {!step.selectedAgent && (
        <div className="text-center py-6 text-slate-500">
          <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-slate-400" />
          <p className="text-sm">No agent assigned to this step</p>
          <p className="text-xs">Assign an agent to enable testing</p>
        </div>
      )}
    </div>
  );
};