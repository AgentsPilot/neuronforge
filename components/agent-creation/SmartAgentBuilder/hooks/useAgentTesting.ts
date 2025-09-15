// components/agent-creation/SmartAgentBuilder/hooks/useAgentTesting.ts

import { useState } from 'react';
import { Agent, TestResult } from '../types/agent';

export const useAgentTesting = () => {
  const [isTesting, setIsTesting] = useState(false);
  const [testResults, setTestResults] = useState<TestResult | null>(null);

  const generateTestData = (agent: Agent): Record<string, string> => {
    return agent.input_schema.reduce((acc, field) => {
      switch (field.type) {
        case 'email':
          acc[field.name] = 'test@example.com';
          break;
        case 'number':
          acc[field.name] = '5';
          break;
        case 'date':
          acc[field.name] = '2024-01-15';
          break;
        case 'select':
          acc[field.name] = field.enum?.[0] || 'Option 1';
          break;
        case 'textarea':
          acc[field.name] = `Sample ${field.name} content with multiple lines.\nThis is a test input for the agent.`;
          break;
        default:
          acc[field.name] = `Sample ${field.name}`;
      }
      return acc;
    }, {} as Record<string, string>);
  };

  const testAgent = async (agent: Agent): Promise<TestResult> => {
    setIsTesting(true);
    
    try {
      console.log('Testing agent:', agent.agent_name);
      
      // Generate sample test data based on input schema
      const testData = generateTestData(agent);
      console.log('Generated test data:', testData);

      // For now, simulate the test with a delay
      // In a real implementation, you would call your agent execution API
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Mock successful test result
      const result: TestResult = {
        success: true,
        executionTime: Math.floor(Math.random() * 2000) + 500,
        output: {
          message: 'Test completed successfully',
          agentName: agent.agent_name,
          inputData: testData,
          processedAt: new Date().toISOString(),
          // Mock some agent-specific output
          summary: agent.plugins_required.length > 0 
            ? `Agent used ${agent.plugins_required.length} plugin(s): ${agent.plugins_required.join(', ')}`
            : 'Agent completed without external plugins',
          results: {
            status: 'completed',
            fieldsProcessed: agent.input_schema.length,
            timestamp: Date.now()
          }
        }
      };

      console.log('Test result:', result);
      setTestResults(result);
      return result;

    } catch (err) {
      console.error('Test failed:', err);
      const errorResult: TestResult = {
        success: false,
        error: err instanceof Error ? err.message : 'Test execution failed'
      };
      setTestResults(errorResult);
      return errorResult;
    } finally {
      setIsTesting(false);
    }
  };

  const clearTestResults = () => {
    setTestResults(null);
  };

  return {
    testAgent,
    isTesting,
    testResults,
    clearTestResults
  };
};