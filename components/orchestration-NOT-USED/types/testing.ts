// types/testing.ts
export interface TestResult {
  status: 'success' | 'error' | 'running' | 'pending';
  stepIndex: number;
  stepTitle: string;
  timestamp: Date;
  
  configurationTest: {
    hasAgent: boolean;
    hasRequiredInputs: boolean;
    hasExpectedOutputs: boolean;
    isConfigured: boolean;
    configurationScore: number;
  };
  
  executionTest?: {
    status: 'success' | 'error' | 'skipped';
    executionTime: number;
    testInputs: Record<string, any>;
    actualOutputs?: Record<string, any>;
    expectedOutputStructure: any[];
    outputValidation: {
      isValid: boolean;
      missingFields: string[];
      typeErrors: string[];
      extraFields: string[];
    };
    error?: string;
    stackTrace?: string;
  };
  
  integrationTest?: {
    status: 'success' | 'error' | 'skipped';
    connectedIntegrations: string[];
    failedIntegrations: string[];
  };
  
  performanceTest?: {
    averageExecutionTime: number;
    successRate: number;
    memoryUsage?: number;
    iterations: number;
  };
  
  overallScore: number;
  recommendations: string[];
  warnings: string[];
}

export interface TestConfiguration {
  testMode: 'mock' | 'sandbox' | 'live';
  includePerformanceTests: boolean;
  includeIntegrationTests: boolean;
  includeDataFlowTests: boolean;
  maxExecutionTime: number;
  testIterations: number;
  generateTestData: boolean;
  customTestData?: Record<string, any>;
}