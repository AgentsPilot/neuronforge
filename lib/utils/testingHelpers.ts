// utils/testingHelpers.ts
import { WorkflowStep } from '../types/workflow';

// Simple types for immediate use - you can enhance these later
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

export class TestDataGenerator {
  static generateForField(fieldName: string, fieldType: string, isRequired: boolean = false): any {
    const generators: Record<string, () => any> = {
      'text': () => `test_${fieldName}_${Date.now()}`,
      'email': () => `test.${fieldName}@example.com`,
      'number': () => Math.floor(Math.random() * 1000),
      'boolean': () => Math.random() > 0.5,
      'json': () => ({ 
        [fieldName]: `sample_data_${Date.now()}`, 
        items: [1, 2, 3],
        metadata: { generated: true }
      }),
      'array': () => [`item1_${fieldName}`, `item2_${fieldName}`, `item3_${fieldName}`],
      'date': () => new Date().toISOString(),
      'url': () => `https://example.com/${fieldName}`,
      'file': () => ({ 
        name: `test_${fieldName}.txt`, 
        size: 1024, 
        type: 'text/plain',
        content: 'Test file content'
      })
    };

    const generator = generators[fieldType.toLowerCase()] || generators['text'];
    return generator();
  }

  static generateTestInputs(step: WorkflowStep): Record<string, any> {
    const testInputs: Record<string, any> = {};
    
    if (!step.inputs) return testInputs;

    step.inputs.forEach(input => {
      const fieldName = this.getFieldName(input);
      const fieldType = this.getFieldType(input);
      const isRequired = this.isFieldRequired(input);
      
      if (fieldName && fieldName !== 'unknown') {
        testInputs[fieldName] = this.generateForField(fieldName, fieldType, isRequired);
      }
    });

    return testInputs;
  }

  static getFieldName(field: any): string {
    if (typeof field === 'string') return field;
    if (field && typeof field === 'object') {
      return field.name || field.displayName || field.label || field.id || 'unknown';
    }
    return 'unknown';
  }

  static getFieldType(field: any): string {
    if (typeof field === 'string') return 'text';
    if (field && typeof field === 'object') {
      return field.type || field.fieldType || field.dataType || 'text';
    }
    return 'text';
  }

  static isFieldRequired(field: any): boolean {
    if (typeof field === 'string') return false;
    if (field && typeof field === 'object') {
      return field.required || false;
    }
    return false;
  }
}

export class OutputValidator {
  static validateOutputStructure(
    actualOutputs: Record<string, any>, 
    expectedOutputs: any[]
  ): {
    isValid: boolean;
    missingFields: string[];
    typeErrors: string[];
    extraFields: string[];
  } {
    const result = {
      isValid: true,
      missingFields: [] as string[],
      typeErrors: [] as string[],
      extraFields: [] as string[]
    };

    if (!expectedOutputs || expectedOutputs.length === 0) {
      return result;
    }

    // Check for missing required fields
    expectedOutputs.forEach(expectedOutput => {
      const fieldName = TestDataGenerator.getFieldName(expectedOutput);
      const expectedType = TestDataGenerator.getFieldType(expectedOutput);
      const isRequired = TestDataGenerator.isFieldRequired(expectedOutput);

      if (isRequired && !(fieldName in actualOutputs)) {
        result.missingFields.push(fieldName);
        result.isValid = false;
      }

      if (fieldName in actualOutputs) {
        const actualValue = actualOutputs[fieldName];
        const actualType = this.getActualType(actualValue);
        
        if (!this.typesMatch(actualType, expectedType)) {
          result.typeErrors.push(`${fieldName}: expected ${expectedType}, got ${actualType}`);
          result.isValid = false;
        }
      }
    });

    // Check for extra fields
    const expectedFieldNames = expectedOutputs.map(output => TestDataGenerator.getFieldName(output));
    Object.keys(actualOutputs).forEach(actualField => {
      if (!expectedFieldNames.includes(actualField)) {
        result.extraFields.push(actualField);
      }
    });

    return result;
  }

  private static getActualType(value: any): string {
    if (value === null || value === undefined) return 'null';
    if (Array.isArray(value)) return 'array';
    if (typeof value === 'object') return 'json';
    if (typeof value === 'string' && value.includes('@')) return 'email';
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return 'date';
    return typeof value;
  }

  private static typesMatch(actualType: string, expectedType: string): boolean {
    const typeAliases: Record<string, string[]> = {
      'text': ['string', 'text'],
      'string': ['text', 'string'],
      'json': ['object', 'json'],
      'object': ['json', 'object'],
      'number': ['number', 'integer', 'float'],
      'boolean': ['boolean', 'bool'],
      'array': ['array', 'list']
    };

    const actualAliases = typeAliases[actualType.toLowerCase()] || [actualType.toLowerCase()];
    const expectedAliases = typeAliases[expectedType.toLowerCase()] || [expectedType.toLowerCase()];

    return actualAliases.some(alias => expectedAliases.includes(alias));
  }
}

export class AgentExecutionTester {
  static async executeStep(
    step: WorkflowStep, 
    testInputs: Record<string, any>,
    config: TestConfiguration
  ): Promise<TestResult['executionTest']> {
    if (!step.selectedAgent) {
      return {
        status: 'error',
        executionTime: 0,
        testInputs,
        expectedOutputStructure: step.outputs || [],
        outputValidation: {
          isValid: false,
          missingFields: [],
          typeErrors: ['No agent selected'],
          extraFields: []
        },
        error: 'No agent selected for this step'
      };
    }

    const startTime = Date.now();

    try {
      // Simulate execution time
      await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
      
      // Generate mock outputs based on step definition
      const mockOutputs: Record<string, any> = {};
      (step.outputs || []).forEach(output => {
        const fieldName = TestDataGenerator.getFieldName(output);
        const fieldType = TestDataGenerator.getFieldType(output);
        mockOutputs[fieldName] = TestDataGenerator.generateForField(fieldName, fieldType);
      });

      // Validate outputs
      const outputValidation = OutputValidator.validateOutputStructure(
        mockOutputs,
        step.outputs || []
      );

      return {
        status: 'success',
        executionTime: Date.now() - startTime,
        testInputs,
        actualOutputs: mockOutputs,
        expectedOutputStructure: step.outputs || [],
        outputValidation
      };

    } catch (error) {
      return {
        status: 'error',
        executionTime: Date.now() - startTime,
        testInputs,
        expectedOutputStructure: step.outputs || [],
        outputValidation: {
          isValid: false,
          missingFields: [],
          typeErrors: ['Execution failed'],
          extraFields: []
        },
        error: error.message,
        stackTrace: error.stack
      };
    }
  }
}

export class IntegrationTester {
  static async testConnectivity(
    step: WorkflowStep,
    config: TestConfiguration
  ): Promise<TestResult['integrationTest']> {
    if (!step.configurationData || !step.configurationData.pluginKey) {
      return {
        status: 'skipped',
        connectedIntegrations: [],
        failedIntegrations: []
      };
    }

    try {
      // Simulate integration test
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Mock successful connection
      return {
        status: 'success',
        connectedIntegrations: [step.configurationData.pluginKey],
        failedIntegrations: []
      };

    } catch (error) {
      return {
        status: 'error',
        connectedIntegrations: [],
        failedIntegrations: [step.configurationData.pluginKey]
      };
    }
  }
}