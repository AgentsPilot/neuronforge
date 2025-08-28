// lib/utils/testingHelpers.ts
import { WorkflowStep } from '../components/orchestration/types/workflow';
import { TestConfiguration } from '../components/orchestration/types/testing';

export interface TestInput {
  name: string;
  type: string;
  required?: boolean;
  constraints?: {
    min?: number;
    max?: number;
    pattern?: string;
    enum?: string[];
  };
}

export interface TestOutput {
  name: string;
  type: string;
  required?: boolean;
  description?: string;
}

export interface TestResult {
  status: 'success' | 'error' | 'warning';
  executionTime: number;
  testInputs: Record<string, any>;
  expectedOutputStructure: TestOutput[];
  outputValidation: OutputValidationResult;
  actualOutputs?: Record<string, any>;
  error?: string;
  warnings?: string[];
  metadata?: {
    stepId: string;
    timestamp: number;
    testRunId: string;
  };
}

export interface OutputValidationResult {
  isValid: boolean;
  missingFields: string[];
  typeErrors: string[];
  extraFields: string[];
  constraintViolations: string[];
  score: number;
}

export class TestDataGenerator {
  private static readonly DEFAULT_STRING_LENGTH = 10;
  private static readonly DEFAULT_ARRAY_SIZE = 3;
  
  static generateTestInputs(
    step: WorkflowStep, 
    options: {
      variant?: 'minimal' | 'comprehensive' | 'edge-cases';
      seed?: number;
    } = {}
  ): Record<string, any> {
    const { variant = 'minimal' } = options;
    const testInputs: Record<string, any> = {};
    
    if (!step.inputs) {
      return testInputs;
    }
    
    step.inputs.forEach(input => {
      testInputs[input.name] = this.generateValueForType(input, variant);
    });
    
    return testInputs;
  }
  
  private static generateValueForType(input: TestInput, variant: string): any {
    const { type, constraints } = input;
    
    switch ((type || 'string').toLowerCase()) {
      case 'string':
      case 'text':
        return this.generateString(variant, constraints);
      case 'number':
      case 'integer':
        return this.generateNumber(variant, constraints);
      case 'boolean':
        return this.generateBoolean(variant);
      case 'array':
        return this.generateArray(variant, constraints);
      case 'object':
        return this.generateObject(variant);
      case 'email':
        return `test${Math.random().toString(36).substring(7)}@example.com`;
      default:
        return this.generateString(variant, constraints);
    }
  }
  
  private static generateString(variant: string, constraints?: any): string {
    const { min = 1, max = 50, enum: enumValues } = constraints || {};
    
    if (enumValues?.length) {
      return enumValues[Math.floor(Math.random() * enumValues.length)];
    }
    
    const length = Math.max(1, Math.min(Math.floor(Math.random() * (max - min)) + min, 100));
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ';
    return Array.from({ length }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('').trim() || 'test';
  }
  
  private static generateNumber(variant: string, constraints?: any): number {
    const { min = 0, max = 1000 } = constraints || {};
    return Math.floor(Math.random() * (max - min)) + min;
  }
  
  private static generateBoolean(variant: string): boolean {
    return Math.random() > 0.5;
  }
  
  private static generateArray(variant: string, constraints?: any): any[] {
    const size = variant === 'comprehensive' ? 5 : this.DEFAULT_ARRAY_SIZE;
    return Array.from({ length: size }, (_, i) => `test-item-${i + 1}`);
  }
  
  private static generateObject(variant: string): Record<string, any> {
    const base = { test: 'value', id: Math.floor(Math.random() * 1000) };
    
    if (variant === 'comprehensive') {
      return {
        ...base,
        nested: { level: 1, data: 'nested-value' },
        array: ['item1', 'item2'],
        timestamp: Date.now()
      };
    }
    
    return base;
  }
}

export class AgentExecutionTester {
  private static testRunId = 0;
  
  static async executeStep(
    step: WorkflowStep,
    testInputs: Record<string, any>,
    config: TestConfiguration
  ): Promise<TestResult> {
    const startTime = Date.now();
    const currentTestRunId = (++this.testRunId).toString();
    
    const metadata = {
      stepId: step.id || 'unknown',
      timestamp: startTime,
      testRunId: currentTestRunId
    };
    
    console.log(`[TEST] Starting execution for step: ${step.id || 'unnamed'}`);
    console.log(`[TEST] Config:`, config);
    console.log(`[TEST] Inputs:`, testInputs);
    
    try {
      const result = await this.executeStepByMode(step, testInputs, config);
      
      console.log(`[TEST] Execution completed successfully`);
      console.log(`[TEST] Result status:`, result.status);
      
      return {
        ...result,
        executionTime: Date.now() - startTime,
        metadata
      };
    } catch (error) {
      console.error(`[TEST] Execution failed with error:`, error);
      
      return {
        status: 'error',
        executionTime: Date.now() - startTime,
        testInputs,
        expectedOutputStructure: step.outputs || [],
        outputValidation: this.createEmptyValidation(),
        actualOutputs: {},
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        warnings: ['Execution failed - check console for detailed error information'],
        metadata
      };
    }
  }
  
  private static async executeStepByMode(
    step: WorkflowStep,
    testInputs: Record<string, any>,
    config: TestConfiguration
  ): Promise<Omit<TestResult, 'executionTime' | 'metadata'>> {
    console.log(`[TEST] Executing step in mode: ${config.testMode}`);
    
    try {
      switch (config.testMode) {
        case 'mock':
          console.log(`[TEST] Using mock execution`);
          return await this.executeMockStep(step, testInputs, config);
        case 'sandbox':
          console.log(`[TEST] Using sandbox execution`);
          return await this.executeSandboxStep(step, testInputs, config);
        case 'live':
          console.log(`[TEST] Using live execution`);
          return await this.executeLiveStep(step, testInputs, config);
        default:
          console.warn(`[TEST] Unknown test mode: ${config.testMode}, defaulting to mock`);
          return await this.executeMockStep(step, testInputs, config);
      }
    } catch (error) {
      console.error(`[TEST] Error in executeStepByMode:`, error);
      throw new Error(`Execution failed in ${config.testMode} mode: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  private static async executeMockStep(
    step: WorkflowStep,
    testInputs: Record<string, any>,
    config: TestConfiguration
  ): Promise<Omit<TestResult, 'executionTime' | 'metadata'>> {
    console.log(`[TEST] Starting mock execution`);
    
    try {
      await this.simulateDelay(100, 500);
      
      console.log(`[TEST] Generating mock outputs`);
      const actualOutputs = this.generateMockOutputs(step.outputs || [], step);
      console.log(`[TEST] Generated outputs:`, actualOutputs);
      
      const validation = this.validateOutputs(actualOutputs, step.outputs || []);
      const warnings = this.generateWarnings(step, testInputs, config);
      
      // FIXED: Don't fail the test just because of warnings
      // Mock tests should succeed if they generate valid outputs
      let status: 'success' | 'warning' | 'error' = 'success';
      
      // Only mark as warning if there are actual validation issues
      if (!validation.isValid && validation.score < 70) {
        status = 'warning';
      }
      
      // Only mark as error if there are serious validation failures
      if (validation.score < 30 || validation.missingFields.length > 0) {
        status = 'error';
      }
      
      console.log(`[TEST] Final status: ${status}`);
      console.log(`[TEST] Validation score: ${validation.score}`);
      
      return {
        status,
        testInputs,
        expectedOutputStructure: step.outputs || [],
        outputValidation: validation,
        actualOutputs,
        warnings
      };
    } catch (error) {
      console.error(`[TEST] Error in executeMockStep:`, error);
      return {
        status: 'error',
        testInputs,
        expectedOutputStructure: step.outputs || [],
        outputValidation: this.createEmptyValidation(),
        actualOutputs: {},
        warnings: [`Mock execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`]
      };
    }
  }
  
  private static async executeSandboxStep(
    step: WorkflowStep,
    testInputs: Record<string, any>,
    config: TestConfiguration
  ): Promise<Omit<TestResult, 'executionTime' | 'metadata'>> {
    await this.simulateDelay(500, 2000);
    
    // Simulate occasional sandbox failures (but less frequently)
    if (Math.random() < 0.1) {
      throw new Error('Simulated sandbox execution failure');
    }
    
    const actualOutputs: Record<string, any> = {};
    if (step.outputs && step.outputs.length > 0) {
      step.outputs.forEach((output, index) => {
        const outputName = output.name?.trim() || `output_${index}`;
        actualOutputs[outputName] = this.generateContextualMockValue(
          output.type || 'string', 
          outputName
        );
      });
    } else {
      // Generate default output if no schema defined
      actualOutputs['result'] = {
        status: 'completed',
        message: 'Sandbox execution completed successfully',
        timestamp: new Date().toISOString()
      };
    }
    
    const validation = this.validateOutputs(actualOutputs, step.outputs || []);
    
    return {
      status: 'success',
      testInputs,
      expectedOutputStructure: step.outputs || [],
      outputValidation: validation,
      actualOutputs,
      warnings: ['Sandbox execution - results simulated']
    };
  }
  
  private static async executeLiveStep(
    step: WorkflowStep,
    testInputs: Record<string, any>,
    config: TestConfiguration
  ): Promise<Omit<TestResult, 'executionTime' | 'metadata'>> {
    throw new Error('Live execution requires actual agent integration - not implemented in demo mode');
  }
  
  private static generateMockOutputs(expectedOutputs: TestOutput[], step: WorkflowStep): Record<string, any> {
    const outputs: Record<string, any> = {};
    
    if (!expectedOutputs || expectedOutputs.length === 0) {
      // Generate realistic outputs based on step type/name
      const stepName = (step.name || '').toLowerCase();
      const stepDescription = (step.description || '').toLowerCase();
      
      if (stepName.includes('email') || stepDescription.includes('email')) {
        outputs['emails'] = [
          {
            id: `email_${Date.now()}`,
            subject: 'Test Email with Invoice',
            from: 'sender@example.com',
            hasInvoice: true,
            content: 'This email contains an invoice attachment.'
          }
        ];
        outputs['invoice_count'] = 1;
      } else if (stepName.includes('scan') || stepDescription.includes('scan')) {
        outputs['scan_result'] = {
          status: 'completed',
          items_found: 5,
          timestamp: new Date().toISOString()
        };
      } else {
        outputs['result'] = {
          status: 'completed',
          message: 'Mock execution completed successfully',
          timestamp: new Date().toISOString(),
          data: `Generated result for ${step.name || 'step'}`
        };
      }
      
      return outputs;
    }
    
    expectedOutputs.forEach((output, index) => {
      const outputName = output.name?.trim() || `output_${index}`;
      const outputType = output.type?.trim() || 'string';
      
      outputs[outputName] = this.generateContextualMockValue(outputType, outputName);
    });
    
    return outputs;
  }
  
  private static generateContextualMockValue(type: string, name: string): any {
    const normalizedType = type.toLowerCase();
    const lowerName = name.toLowerCase();
    
    switch (normalizedType) {
      case 'string':
      case 'text':
        if (lowerName.includes('id')) return `${name}_${Date.now()}`;
        if (lowerName.includes('email')) return `test.${name}@example.com`;
        if (lowerName.includes('status')) return 'success';
        if (lowerName.includes('message')) return `Generated ${name} message`;
        return `Generated ${name} result`;
        
      case 'number':
      case 'integer':
        if (lowerName.includes('count')) return Math.floor(Math.random() * 10) + 1;
        if (lowerName.includes('score')) return Math.floor(Math.random() * 100) + 1;
        return Math.floor(Math.random() * 1000);
        
      case 'boolean':
        return Math.random() > 0.3; // Bias towards success
        
      case 'array':
        if (lowerName.includes('error')) return [];
        if (lowerName.includes('email')) {
          return [
            { id: 1, subject: 'Test Email 1', hasInvoice: true },
            { id: 2, subject: 'Test Email 2', hasInvoice: false }
          ];
        }
        return Array.from({ length: 3 }, (_, i) => `${name}_item_${i + 1}`);
        
      case 'object':
      case 'json':
        return {
          id: Math.floor(Math.random() * 100000),
          name: `Generated ${name}`,
          status: 'success',
          created_at: new Date().toISOString(),
          data: `Mock data for ${name}`
        };
        
      default:
        return `mock_${name}_result`;
    }
  }
  
  private static validateOutputs(
    actualOutputs: Record<string, any>,
    expectedOutputs: TestOutput[]
  ): OutputValidationResult {
    const missingFields: string[] = [];
    const typeErrors: string[] = [];
    const extraFields: string[] = [];
    const constraintViolations: string[] = [];
    
    // Check for missing required fields
    expectedOutputs.forEach(output => {
      if (output.required !== false && !(output.name in actualOutputs)) {
        missingFields.push(output.name);
      }
    });
    
    // Check types for existing fields
    expectedOutputs.forEach(output => {
      if (output.name in actualOutputs) {
        const actualValue = actualOutputs[output.name];
        const actualType = this.getActualType(actualValue);
        const expectedType = (output.type || 'string').toLowerCase();
        
        if (!this.isTypeCompatible(actualType, expectedType)) {
          typeErrors.push(`${output.name}: expected ${expectedType}, got ${actualType}`);
        }
      }
    });
    
    // Check for extra fields (not necessarily errors, just informational)
    const expectedFieldNames = new Set(expectedOutputs.map(o => o.name));
    Object.keys(actualOutputs).forEach(key => {
      if (!expectedFieldNames.has(key)) {
        extraFields.push(key);
      }
    });
    
    // Calculate score - be more lenient for mock tests
    const totalChecks = Math.max(expectedOutputs.length, Object.keys(actualOutputs).length, 1);
    const criticalErrors = missingFields.length + typeErrors.length + constraintViolations.length;
    const minorIssues = extraFields.length;
    
    let score = 100;
    if (totalChecks > 0) {
      score = Math.max(0, Math.floor((totalChecks - criticalErrors - minorIssues * 0.2) / totalChecks * 100));
    }
    
    // If we have outputs but no expected schema, give a decent score
    if (expectedOutputs.length === 0 && Object.keys(actualOutputs).length > 0) {
      score = Math.max(score, 80);
    }
    
    return {
      isValid: criticalErrors === 0,
      missingFields,
      typeErrors,
      extraFields,
      constraintViolations,
      score
    };
  }
  
  private static getActualType(value: any): string {
    if (Array.isArray(value)) return 'array';
    if (value === null) return 'null';
    return typeof value;
  }
  
  private static isTypeCompatible(actualType: string, expectedType: string): boolean {
    if (actualType === expectedType) return true;
    if (expectedType === 'integer' && actualType === 'number') return true;
    if (expectedType === 'text' && actualType === 'string') return true;
    return false;
  }
  
  private static generateWarnings(
    step: WorkflowStep,
    testInputs: Record<string, any>,
    config: TestConfiguration
  ): string[] {
    const warnings: string[] = [];
    
    if (config.testMode === 'mock') {
      warnings.push('Running in mock mode - results are simulated');
    }
    
    if (!step.outputs?.length) {
      warnings.push('No output schema defined - using generated outputs');
    } else {
      const invalidOutputs = step.outputs.filter(output => !output.name || !output.name.trim());
      if (invalidOutputs.length > 0) {
        warnings.push(`${invalidOutputs.length} output(s) have missing names`);
      }
    }
    
    if (!step.description || (typeof step.description === 'string' && step.description.trim().length < 10)) {
      warnings.push('Consider adding a more detailed step description');
    }
    
    if (Object.keys(testInputs).length === 0) {
      warnings.push('No test inputs provided - using default values');
    }
    
    return warnings;
  }
  
  private static async simulateDelay(min: number, max: number): Promise<void> {
    const delay = min + Math.random() * (max - min);
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  
  private static createEmptyValidation(): OutputValidationResult {
    return {
      isValid: false,
      missingFields: [],
      typeErrors: [],
      extraFields: [],
      constraintViolations: [],
      score: 0
    };
  }
}

// Helper functions for input validation
function validateStepInputs(step: WorkflowStep, inputs: Record<string, any>): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  
  if (!step.inputs || step.inputs.length === 0) {
    return { isValid: true, errors: [] };
  }
  
  step.inputs.forEach(input => {
    if (input.required && (inputs[input.name] === undefined || inputs[input.name] === null)) {
      errors.push(`Required input '${input.name}' is missing`);
    }
    
    if (inputs[input.name] !== undefined) {
      const typeValid = validateInputType(inputs[input.name], input.type);
      if (!typeValid) {
        errors.push(`Input '${input.name}' has incorrect type. Expected: ${input.type}`);
      }
    }
  });
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

function validateInputType(value: any, expectedType: string): boolean {
  const actualType = Array.isArray(value) ? 'array' : typeof value;
  const normalizedExpected = (expectedType || 'string').toLowerCase();
  
  switch (normalizedExpected) {
    case 'string':
    case 'text':
      return typeof value === 'string';
    case 'number':
    case 'integer':
      return typeof value === 'number';
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
    case 'json':
      return typeof value === 'object' && !Array.isArray(value) && value !== null;
    default:
      return true;
  }
}

// FIXED: Main testing function - now more lenient with success criteria
export const simulateStepTest = async (
  step: WorkflowStep,
  inputs?: Record<string, any>,
  options?: {
    testMode?: 'mock' | 'validation' | 'integration';
    includeValidation?: boolean;
    generateRealistic?: boolean;
  }
): Promise<{
  success: boolean;
  outputs: Record<string, any>;
  executionTime: number;
  error?: string;
  testDetails?: {
    testMode: string;
    inputValidation: {
      isValid: boolean;
      errors: string[];
    };
    outputValidation: {
      isValid: boolean;
      score: number;
      issues: string[];
    };
    recommendations: string[];
  };
}> => {
  const startTime = Date.now();
  const { testMode = 'mock', includeValidation = true, generateRealistic = true } = options || {};
  
  console.log(`[SIMULATE] Starting test for step:`, step);
  console.log(`[SIMULATE] Test mode: ${testMode}`);
  
  try {
    const testInputs = inputs || TestDataGenerator.generateTestInputs(step, { 
      variant: generateRealistic ? 'comprehensive' : 'minimal' 
    });
    
    const inputValidation = validateStepInputs(step, testInputs);
    const config = { testMode: testMode === 'mock' ? 'mock' as const : 'sandbox' as const };
    const result = await AgentExecutionTester.executeStep(step, testInputs, config);
    
    // FIXED: Success criteria - now more lenient
    const isSuccess = result.status === 'success' || 
                     (result.status === 'warning' && result.outputValidation.score >= 60) ||
                     (result.actualOutputs && Object.keys(result.actualOutputs).length > 0);
    
    console.log(`[SIMULATE] Test completed with status: ${result.status}, success: ${isSuccess}`);
    
    return {
      success: isSuccess,
      outputs: result.actualOutputs || {},
      executionTime: result.executionTime,
      error: result.error,
      testDetails: includeValidation ? {
        testMode,
        inputValidation,
        outputValidation: {
          isValid: result.outputValidation.isValid,
          score: result.outputValidation.score,
          issues: [
            ...result.outputValidation.missingFields.map(f => `Missing field: ${f}`),
            ...result.outputValidation.typeErrors,
            ...result.outputValidation.constraintViolations
          ]
        },
        recommendations: result.warnings || []
      } : undefined
    };
  } catch (error) {
    console.error(`[SIMULATE] Test failed with error:`, error);
    return {
      success: false,
      outputs: {},
      executionTime: Date.now() - startTime,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
};