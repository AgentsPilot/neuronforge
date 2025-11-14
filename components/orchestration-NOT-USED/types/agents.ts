// types/agents.ts - Enhanced version of your existing agents.ts
export interface AgentLibraryItem {
  id: string;
  name: string;
  description: string;
  type: 'smart' | 'ai-generated' | 'custom';
  category: string;
  tags: string[];
  inputs: FieldDefinition[];
  outputs: FieldDefinition[];
  requiredIntegrations: string[];
  configurationSchema?: ConfigurationField[];
  
  // New execution capabilities
  executor?: AgentExecutor;
  mockExecutor?: MockAgentExecutor;
  testingConfig?: AgentTestingConfig;
}

export interface FieldDefinition {
  name: string;
  displayName?: string;
  type: string;
  required: boolean;
  description?: string;
  validation?: FieldValidation;
}

export interface FieldValidation {
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  allowedValues?: any[];
}

export interface ConfigurationField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'boolean' | 'select' | 'multiselect';
  required: boolean;
  options?: { value: string; label: string }[];
  defaultValue?: any;
  helpText?: string;
}

export interface AgentExecutor {
  execute(inputs: Record<string, any>, configuration?: any): Promise<AgentExecutionResult>;
  validateInputs(inputs: Record<string, any>): Promise<InputValidationResult>;
  getRequiredIntegrations(): string[];
  healthCheck(configuration?: any): Promise<HealthCheckResult>;
}

export interface MockAgentExecutor extends AgentExecutor {
  setMockOutputs(outputs: Record<string, any>): void;
  setMockDelay(milliseconds: number): void;
  setMockError(error: Error | null): void;
  generateRealisticOutputs(inputs: Record<string, any>): Record<string, any>;
}

export interface AgentExecutionResult {
  success: boolean;
  outputs: Record<string, any>;
  executionTime: number;
  integrationsCalled: string[];
  metadata?: {
    recordsProcessed?: number;
    apiCallsMade?: number;
    dataSize?: number;
  };
  error?: string;
  warnings?: string[];
}

export interface InputValidationResult {
  isValid: boolean;
  errors: {
    field: string;
    message: string;
    code: string;
  }[];
  warnings?: {
    field: string;
    message: string;
  }[];
}

export interface HealthCheckResult {
  healthy: boolean;
  issues: {
    severity: 'error' | 'warning' | 'info';
    message: string;
    component: string;
  }[];
  integrationStatus: Record<string, {
    connected: boolean;
    lastChecked: Date;
    error?: string;
  }>;
}

export interface AgentTestingConfig {
  defaultTestInputs: Record<string, any>;
  expectedExecutionTime: {
    min: number;
    max: number;
    average: number;
  };
  supportedTestModes: ('mock' | 'sandbox' | 'live')[];
  testCases: AgentTestCase[];
}

export interface AgentTestCase {
  name: string;
  description: string;
  inputs: Record<string, any>;
  expectedOutputs: Record<string, any>;
  expectedIntegrations: string[];
  shouldSucceed: boolean;
}

// Enhanced smart agent library with execution capabilities
export const createExecutableSmartAgent = (
  baseAgent: Omit<AgentLibraryItem, 'executor' | 'mockExecutor' | 'testingConfig'>,
  executorFactory: (agent: AgentLibraryItem) => AgentExecutor
): AgentLibraryItem => {
  const agent: AgentLibraryItem = {
    ...baseAgent,
    executor: undefined,
    mockExecutor: undefined,
    testingConfig: {
      defaultTestInputs: {},
      expectedExecutionTime: {
        min: 500,
        max: 5000,
        average: 2000
      },
      supportedTestModes: ['mock', 'sandbox'],
      testCases: []
    }
  };

  // Create executors
  agent.executor = executorFactory(agent);
  agent.mockExecutor = createMockExecutor(agent);

  return agent;
};

// Factory function to create mock executors
const createMockExecutor = (agent: AgentLibraryItem): MockAgentExecutor => {
  let mockOutputs: Record<string, any> | null = null;
  let mockDelay = 1000;
  let mockError: Error | null = null;

  return {
    async execute(inputs: Record<string, any>, configuration?: any): Promise<AgentExecutionResult> {
      // Simulate execution time
      await new Promise(resolve => setTimeout(resolve, mockDelay));

      // Throw mock error if set
      if (mockError) {
        throw mockError;
      }

      // Use mock outputs or generate realistic ones
      const outputs = mockOutputs || this.generateRealisticOutputs(inputs);

      return {
        success: true,
        outputs,
        executionTime: mockDelay,
        integrationsCalled: agent.requiredIntegrations || [],
        metadata: {
          recordsProcessed: Math.floor(Math.random() * 100),
          apiCallsMade: Math.floor(Math.random() * 10),
          dataSize: Object.keys(inputs).length * 1024
        }
      };
    },

    async validateInputs(inputs: Record<string, any>): Promise<InputValidationResult> {
      const errors: InputValidationResult['errors'] = [];
      const warnings: InputValidationResult['warnings'] = [];

      agent.inputs.forEach(inputDef => {
        const value = inputs[inputDef.name];
        
        if (inputDef.required && (value === undefined || value === null || value === '')) {
          errors.push({
            field: inputDef.name,
            message: `${inputDef.displayName || inputDef.name} is required`,
            code: 'REQUIRED_FIELD_MISSING'
          });
        }

        if (value !== undefined && inputDef.validation) {
          const validation = inputDef.validation;
          
          if (validation.minLength && typeof value === 'string' && value.length < validation.minLength) {
            errors.push({
              field: inputDef.name,
              message: `${inputDef.displayName || inputDef.name} must be at least ${validation.minLength} characters`,
              code: 'MIN_LENGTH_VIOLATION'
            });
          }

          if (validation.maxLength && typeof value === 'string' && value.length > validation.maxLength) {
            warnings?.push({
              field: inputDef.name,
              message: `${inputDef.displayName || inputDef.name} exceeds recommended length of ${validation.maxLength} characters`
            });
          }

          if (validation.allowedValues && !validation.allowedValues.includes(value)) {
            errors.push({
              field: inputDef.name,
              message: `${inputDef.displayName || inputDef.name} must be one of: ${validation.allowedValues.join(', ')}`,
              code: 'INVALID_VALUE'
            });
          }
        }
      });

      return {
        isValid: errors.length === 0,
        errors,
        warnings
      };
    },

    getRequiredIntegrations(): string[] {
      return agent.requiredIntegrations || [];
    },

    async healthCheck(configuration?: any): Promise<HealthCheckResult> {
      return {
        healthy: true,
        issues: [],
        integrationStatus: (agent.requiredIntegrations || []).reduce((acc, integration) => {
          acc[integration] = {
            connected: true,
            lastChecked: new Date()
          };
          return acc;
        }, {} as Record<string, any>)
      };
    },

    setMockOutputs(outputs: Record<string, any>): void {
      mockOutputs = outputs;
    },

    setMockDelay(milliseconds: number): void {
      mockDelay = milliseconds;
    },

    setMockError(error: Error | null): void {
      mockError = error;
    },

    generateRealisticOutputs(inputs: Record<string, any>): Record<string, any> {
      const outputs: Record<string, any> = {};

      agent.outputs.forEach(outputDef => {
        switch (outputDef.type.toLowerCase()) {
          case 'text':
          case 'string':
            outputs[outputDef.name] = `processed_${outputDef.name}_${Date.now()}`;
            break;
          case 'number':
          case 'integer':
            outputs[outputDef.name] = Math.floor(Math.random() * 1000);
            break;
          case 'boolean':
            outputs[outputDef.name] = Math.random() > 0.5;
            break;
          case 'json':
          case 'object':
            outputs[outputDef.name] = {
              processedData: inputs,
              timestamp: new Date().toISOString(),
              status: 'completed',
              itemCount: Math.floor(Math.random() * 50)
            };
            break;
          case 'array':
            outputs[outputDef.name] = [
              `result_1_${outputDef.name}`,
              `result_2_${outputDef.name}`,
              `result_3_${outputDef.name}`
            ];
            break;
          case 'email':
            outputs[outputDef.name] = `processed.${outputDef.name}@example.com`;
            break;
          case 'url':
            outputs[outputDef.name] = `https://example.com/results/${outputDef.name}`;
            break;
          default:
            outputs[outputDef.name] = `mock_${outputDef.name}_value`;
        }
      });

      return outputs;
    }
  };
};