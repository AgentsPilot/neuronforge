// components/orchestration/components/testing/WorkflowTester.tsx
// Updated to work with WorkflowService

import React, { useState, useEffect } from 'react';
import { WorkflowService, WorkflowData, WorkflowStep, AgentInstance } from '../../../../lib/services/workflowService';
import { StepTestRunner } from './StepTestRunner';

interface WorkflowTesterProps {
  workflow: WorkflowData;
  onTestComplete?: (result: any) => void;
  onWorkflowUpdate?: (workflow: WorkflowData) => void;
}

export const WorkflowTester: React.FC<WorkflowTesterProps> = ({
  workflow,
  onTestComplete,
  onWorkflowUpdate
}) => {
  const [isTestingWorkflow, setIsTestingWorkflow] = useState(false);
  const [testResults, setTestResults] = useState<any>(null);
  const [currentTestingStep, setCurrentTestingStep] = useState<string | null>(null);
  const [stepResults, setStepResults] = useState<Record<string, any>>({});
  const [testMode, setTestMode] = useState<'sequential' | 'parallel' | 'individual'>('sequential');

  // Test individual step
  const testStep = async (stepId: string) => {
    const step = workflow.steps.find(s => s.id === stepId);
    const agent = workflow.agents.find(a => a.id === step?.agentId);
    
    if (!step) return;

    setCurrentTestingStep(stepId);
    
    try {
      // Create a mini-workflow with just this step for testing
      const miniWorkflow: WorkflowData = {
        ...workflow,
        steps: [step],
        agents: agent ? [agent] : [],
        connections: workflow.connections.filter(c => 
          c.fromStepId === stepId || c.toStepId === stepId
        )
      };

      const result = await WorkflowService.testWorkflow(miniWorkflow);
      
      setStepResults(prev => ({
        ...prev,
        [stepId]: result
      }));

      return result;
    } catch (error) {
      const errorResult = {
        success: false,
        results: {},
        overallStatus: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
      
      setStepResults(prev => ({
        ...prev,
        [stepId]: errorResult
      }));

      return errorResult;
    } finally {
      setCurrentTestingStep(null);
    }
  };

  // Test entire workflow
  const testEntireWorkflow = async () => {
    setIsTestingWorkflow(true);
    setTestResults(null);
    setStepResults({});
    
    try {
      console.log('[WORKFLOW-TESTER] Starting complete workflow test');
      
      if (testMode === 'individual') {
        // Test each step individually
        const results: Record<string, any> = {};
        
        for (const step of workflow.steps) {
          setCurrentTestingStep(step.id);
          const stepResult = await testStep(step.id);
          results[step.id] = stepResult;
          
          // Short delay between steps for UI feedback
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        // Aggregate results
        const overallStatus = Object.values(results).every((r: any) => r.success) ? 'passed' :
                            Object.values(results).some((r: any) => r.success) ? 'warning' : 'failed';
        
        const finalResult = {
          success: overallStatus !== 'failed',
          results,
          overallStatus,
          testMode: 'individual'
        };
        
        setTestResults(finalResult);
        onTestComplete?.(finalResult);
        
      } else {
        // Test entire workflow as a unit
        const result = await WorkflowService.testWorkflow(workflow);
        
        setTestResults(result);
        onTestComplete?.(result);
        
        // Update workflow status based on test results
        if (result.overallStatus === 'passed') {
          const updatedWorkflow = { ...workflow, status: 'validated' as const };
          onWorkflowUpdate?.(updatedWorkflow);
        }
      }
      
    } catch (error) {
      console.error('[WORKFLOW-TESTER] Test failed:', error);
      
      const errorResult = {
        success: false,
        results: {},
        overallStatus: 'failed',
        error: error instanceof Error ? error.message : 'Workflow test failed'
      };
      
      setTestResults(errorResult);
      onTestComplete?.(errorResult);
      
    } finally {
      setIsTestingWorkflow(false);
      setCurrentTestingStep(null);
    }
  };

  // Get step status for UI
  const getStepStatus = (stepId: string) => {
    if (currentTestingStep === stepId) return 'testing';
    if (stepResults[stepId]) {
      return stepResults[stepId].success ? 'passed' : 'failed';
    }
    if (testResults?.results?.[stepId]) {
      return testResults.results[stepId].success ? 'passed' : 'failed';
    }
    return 'pending';
  };

  const getStepStatusColor = (status: string) => {
    switch (status) {
      case 'testing': return 'border-blue-300 bg-blue-50';
      case 'passed': return 'border-green-300 bg-green-50';
      case 'failed': return 'border-red-300 bg-red-50';
      default: return 'border-gray-200 bg-white';
    }
  };

  const getStepStatusIcon = (status: string) => {
    switch (status) {
      case 'testing': return '🔄';
      case 'passed': return '✅';
      case 'failed': return '❌';
      default: return '⏳';
    }
  };

  // Validate workflow before testing
  const validateWorkflow = () => {
    const issues = [];
    
    if (workflow.steps.length === 0) {
      issues.push('Workflow has no steps');
    }
    
    if (workflow.agents.length === 0) {
      issues.push('Workflow has no agents');
    }
    
    // Check if all steps have agents
    const stepsWithoutAgents = workflow.steps.filter(step => 
      !workflow.agents.find(agent => agent.id === step.agentId)
    );
    
    if (stepsWithoutAgents.length > 0) {
      issues.push(`${stepsWithoutAgents.length} step(s) missing agents`);
    }
    
    // Check for disconnected steps (except first step)
    const connectedStepIds = new Set(workflow.connections.map(c => c.toStepId));
    const disconnectedSteps = workflow.steps.slice(1).filter(step => 
      !connectedStepIds.has(step.id)
    );
    
    if (disconnectedSteps.length > 0) {
      issues.push(`${disconnectedSteps.length} step(s) are not connected`);
    }
    
    return issues;
  };

  const validationIssues = validateWorkflow();
  const canTest = validationIssues.length === 0;

  return (
    <div className="workflow-tester space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h2 className="text-2xl font-bold">Workflow Testing</h2>
          <p className="text-gray-600 mt-1">
            Test your workflow to validate functionality before deployment
          </p>
        </div>
        
        <div className="flex items-center gap-4">
          {/* Test Mode Selector */}
          <select
            value={testMode}
            onChange={(e) => setTestMode(e.target.value as any)}
            className="border rounded-lg px-3 py-2"
            disabled={isTestingWorkflow}
          >
            <option value="sequential">Sequential Test</option>
            <option value="individual">Individual Steps</option>
            <option value="parallel">Parallel Test</option>
          </select>
          
          {/* Test Workflow Button */}
          <button
            onClick={testEntireWorkflow}
            disabled={!canTest || isTestingWorkflow}
            className={`px-6 py-3 rounded-lg font-medium transition-colors ${
              !canTest || isTestingWorkflow
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            {isTestingWorkflow ? 'Testing...' : 'Test Entire Workflow'}
          </button>
        </div>
      </div>

      {/* Validation Issues */}
      {validationIssues.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h3 className="font-semibold text-red-800 mb-2">
            ⚠️ Workflow Validation Issues
          </h3>
          <ul className="list-disc list-inside space-y-1 text-red-700 text-sm">
            {validationIssues.map((issue, i) => (
              <li key={i}>{issue}</li>
            ))}
          </ul>
          <p className="text-red-600 text-sm mt-2">
            Please fix these issues before testing the workflow.
          </p>
        </div>
      )}

      {/* Workflow Overview */}
      <div className="bg-gray-50 rounded-lg p-4">
        <h3 className="font-semibold mb-3">Workflow Overview</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
          <div>
            <div className="text-2xl font-bold text-blue-600">{workflow.steps.length}</div>
            <div className="text-sm text-gray-600">Steps</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-green-600">{workflow.agents.length}</div>
            <div className="text-sm text-gray-600">Agents</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-purple-600">{workflow.connections.length}</div>
            <div className="text-sm text-gray-600">Connections</div>
          </div>
          <div>
            <div className={`text-2xl font-bold ${
              workflow.status === 'validated' ? 'text-green-600' :
              workflow.status === 'draft' ? 'text-gray-600' : 'text-yellow-600'
            }`}>
              {workflow.status.toUpperCase()}
            </div>
            <div className="text-sm text-gray-600">Status</div>
          </div>
        </div>
      </div>

      {/* Test Progress */}
      {(isTestingWorkflow || testResults) && (
        <div className="bg-white border rounded-lg p-6">
          <h3 className="font-semibold mb-4">Test Progress</h3>
          
          {/* Progress Bar */}
          {isTestingWorkflow && (
            <div className="mb-4">
              <div className="flex justify-between text-sm text-gray-600 mb-1">
                <span>Testing workflow steps...</span>
                <span>
                  {Object.keys(stepResults).length} / {workflow.steps.length}
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ 
                    width: `${(Object.keys(stepResults).length / workflow.steps.length) * 100}%` 
                  }}
                ></div>
              </div>
            </div>
          )}

          {/* Step Status List */}
          <div className="space-y-2">
            {workflow.steps.map((step, index) => {
              const status = getStepStatus(step.id);
              const agent = workflow.agents.find(a => a.id === step.agentId);
              
              return (
                <div 
                  key={step.id}
                  className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${getStepStatusColor(status)}`}
                >
                  <div className="text-xl">{getStepStatusIcon(status)}</div>
                  
                  <div className="flex-1">
                    <div className="font-medium">{step.name}</div>
                    <div className="text-sm text-gray-600">
                      Agent: {agent?.name || 'No agent assigned'}
                    </div>
                  </div>
                  
                  <div className="text-right">
                    <div className={`text-sm font-medium ${
                      status === 'passed' ? 'text-green-600' :
                      status === 'failed' ? 'text-red-600' :
                      status === 'testing' ? 'text-blue-600' : 'text-gray-500'
                    }`}>
                      {status.toUpperCase()}
                    </div>
                    
                    {(stepResults[step.id] || testResults?.results?.[step.id]) && (
                      <div className="text-xs text-gray-500">
                        {(stepResults[step.id]?.results?.[step.id]?.executionTime || 
                          testResults?.results?.[step.id]?.executionTime || 0)}ms
                      </div>
                    )}
                  </div>
                  
                  {/* Individual Test Button */}
                  <button
                    onClick={() => testStep(step.id)}
                    disabled={isTestingWorkflow || currentTestingStep === step.id}
                    className="px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {currentTestingStep === step.id ? 'Testing...' : 'Test'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Overall Test Results */}
      {testResults && (
        <div className={`border rounded-lg p-6 ${
          testResults.overallStatus === 'passed' ? 'border-green-200 bg-green-50' :
          testResults.overallStatus === 'warning' ? 'border-yellow-200 bg-yellow-50' :
          'border-red-200 bg-red-50'
        }`}>
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold">Test Results Summary</h3>
            <div className={`px-4 py-2 rounded-full text-sm font-medium ${
              testResults.overallStatus === 'passed' ? 'bg-green-200 text-green-800' :
              testResults.overallStatus === 'warning' ? 'bg-yellow-200 text-yellow-800' :
              'bg-red-200 text-red-800'
            }`}>
              {testResults.overallStatus.toUpperCase()}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div className="text-center">
              <div className="text-2xl font-bold">{Object.keys(testResults.results).length}</div>
              <div className="text-sm text-gray-600">Total Tests</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">
                {Object.values(testResults.results).filter((r: any) => r.success).length}
              </div>
              <div className="text-sm text-gray-600">Passed</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-600">
                {Object.values(testResults.results).filter((r: any) => !r.success).length}
              </div>
              <div className="text-sm text-gray-600">Failed</div>
            </div>
          </div>

          {/* Status-specific messages */}
          {testResults.overallStatus === 'passed' && (
            <div className="bg-green-100 border border-green-200 rounded p-4">
              <h4 className="font-semibold text-green-800 mb-2">
                🎉 Workflow Ready for Deployment
              </h4>
              <p className="text-green-700 text-sm">
                All tests passed successfully! Your workflow is validated and ready to be deployed to production.
              </p>
            </div>
          )}

          {testResults.overallStatus === 'warning' && (
            <div className="bg-yellow-100 border border-yellow-200 rounded p-4">
              <h4 className="font-semibold text-yellow-800 mb-2">
                ⚠️ Workflow Has Issues
              </h4>
              <p className="text-yellow-700 text-sm">
                Some tests passed with warnings. Review the step details below and consider fixing issues before deployment.
              </p>
            </div>
          )}

          {testResults.overallStatus === 'failed' && (
            <div className="bg-red-100 border border-red-200 rounded p-4">
              <h4 className="font-semibold text-red-800 mb-2">
                ❌ Workflow Tests Failed
              </h4>
              <p className="text-red-700 text-sm">
                Some tests failed. Please review and fix the issues below before proceeding with deployment.
              </p>
            </div>
          )}

          {testResults.error && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded">
              <div className="font-semibold text-red-800">Error Details:</div>
              <div className="text-red-700 text-sm">{testResults.error}</div>
            </div>
          )}
        </div>
      )}

      {/* Individual Step Testing Section */}
      {testMode === 'individual' && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">Individual Step Testing</h3>
          <p className="text-gray-600 text-sm">
            Test each step individually to debug issues and validate specific functionality.
          </p>
          
          {workflow.steps.map((step) => {
            const agent = workflow.agents.find(a => a.id === step.agentId);
            return (
              <StepTestRunner
                key={step.id}
                step={step}
                agent={agent}
                workflow={{
                  connections: workflow.connections,
                  previousResults: stepResults
                }}
                onTestComplete={(result) => {
                  setStepResults(prev => ({
                    ...prev,
                    [step.id]: { results: { [step.id]: result }, success: result.success }
                  }));
                }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};