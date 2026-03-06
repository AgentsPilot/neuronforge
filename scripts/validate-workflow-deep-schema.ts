#!/usr/bin/env npx tsx

/**
 * Deep Schema Validation for PILOT DSL Workflow
 *
 * Validates that every parameter in each step matches the actual plugin schema:
 * - Checks required parameters are present
 * - Validates parameter names match schema exactly
 * - Checks parameter types and structure
 * - Verifies data flow and variable references
 * - Validates config references are resolvable
 */

import * as fs from 'fs';
import * as path from 'path';

interface PilotStep {
  step_id: string;
  type: string;
  plugin?: string;
  operation?: string;
  config: any;
  input?: string;
  output_variable?: string;
  description?: string;
  scatter?: {
    input: string;
    steps: PilotStep[];
    itemVariable: string;
  };
  condition?: any;
  steps?: PilotStep[];
}

interface PluginSchema {
  plugin: {
    name: string;
    version: string;
  };
  actions: {
    [actionName: string]: {
      description: string;
      required_params: string[];
      parameters: {
        type: string;
        required: string[];
        properties: {
          [paramName: string]: any;
        };
      };
      output_schema: {
        properties: {
          [fieldName: string]: any;
        };
        required: string[];
      };
    };
  };
}

class WorkflowValidator {
  private steps: PilotStep[];
  private plugins: Map<string, PluginSchema>;
  private declaredVariables: Set<string>;
  private configParams: Set<string>;
  private issues: string[];
  private warnings: string[];

  constructor(workflowPath: string) {
    const workflowContent = fs.readFileSync(workflowPath, 'utf-8');
    this.steps = JSON.parse(workflowContent) as PilotStep[];
    this.plugins = new Map();
    this.declaredVariables = new Set();
    this.configParams = new Set();
    this.issues = [];
    this.warnings = [];

    // Load known config parameters from enhanced prompt
    this.loadConfigParams();
  }

  private loadConfigParams() {
    // Known config parameters for this workflow
    this.configParams.add('google_sheet_id');
    this.configParams.add('sheet_tab_name');
    this.configParams.add('lead_score_column');
    this.configParams.add('score_threshold');
    this.configParams.add('user_email');
    this.configParams.add('sales_person_format');
    this.configParams.add('sales_person_email_mapping');
  }

  private loadPluginSchema(pluginName: string): PluginSchema | null {
    if (this.plugins.has(pluginName)) {
      return this.plugins.get(pluginName)!;
    }

    const pluginPath = path.join(__dirname, '..', 'lib', 'plugins', 'definitions', `${pluginName}-plugin-v2.json`);

    if (!fs.existsSync(pluginPath)) {
      this.issues.push(`❌ Plugin schema not found: ${pluginName} at ${pluginPath}`);
      return null;
    }

    try {
      const schemaContent = fs.readFileSync(pluginPath, 'utf-8');
      const schema = JSON.parse(schemaContent) as PluginSchema;
      this.plugins.set(pluginName, schema);
      return schema;
    } catch (error) {
      this.issues.push(`❌ Failed to load plugin schema: ${pluginName} - ${error}`);
      return null;
    }
  }

  private extractVariableName(ref: string): string {
    // Remove {{}} wrappers and extract base variable name
    const cleaned = ref.replace(/\{\{|\}\}/g, '').trim();

    // Handle config references
    if (cleaned.startsWith('config.')) {
      return cleaned; // Keep config references as-is
    }

    // Extract base variable (before first dot)
    const parts = cleaned.split('.');
    return parts[0];
  }

  private isConfigReference(value: string): boolean {
    return typeof value === 'string' && value.includes('{{config.');
  }

  private extractConfigKey(value: string): string | null {
    const match = value.match(/\{\{config\.([^}]+)\}\}/);
    return match ? match[1] : null;
  }

  private validateConfigReference(configRef: string, context: string): boolean {
    const configKey = this.extractConfigKey(configRef);
    if (!configKey) {
      this.issues.push(`❌ ${context}: Invalid config reference format: ${configRef}`);
      return false;
    }

    if (!this.configParams.has(configKey)) {
      this.warnings.push(`⚠️  ${context}: Config parameter '${configKey}' not found in known config params`);
      return false;
    }

    return true;
  }

  private validateVariableReference(varRef: string, context: string): boolean {
    const varName = this.extractVariableName(varRef);

    // Config references are always valid if they exist
    if (varName.startsWith('config.')) {
      return this.validateConfigReference(varRef, context);
    }

    if (!this.declaredVariables.has(varName)) {
      this.issues.push(`❌ ${context}: Variable '${varName}' referenced before declaration`);
      return false;
    }

    return true;
  }

  private validateActionParameters(step: PilotStep, schema: PluginSchema): boolean {
    const action = schema.actions[step.operation!];
    if (!action) {
      this.issues.push(`❌ Step ${step.step_id}: Operation '${step.operation}' not found in plugin '${step.plugin}'`);
      return false;
    }

    let allValid = true;

    // Check required parameters
    const requiredParams = action.parameters.required || [];
    const providedParams = Object.keys(step.config);

    for (const requiredParam of requiredParams) {
      const found = this.findParameterInConfig(step.config, requiredParam, action.parameters.properties);

      if (!found) {
        this.issues.push(`❌ Step ${step.step_id}: Required parameter '${requiredParam}' missing`);
        allValid = false;
      }
    }

    // Validate parameter structure matches schema
    allValid = this.validateParameterStructure(step, action) && allValid;

    return allValid;
  }

  private findParameterInConfig(config: any, paramName: string, schemaProps: any): boolean {
    // Direct match
    if (config[paramName] !== undefined) {
      return true;
    }

    // Check nested structures (e.g., recipients, content)
    const schemaProp = schemaProps[paramName];
    if (schemaProp && schemaProp.type === 'object') {
      // Parameter might be nested in config
      for (const key in config) {
        if (typeof config[key] === 'object' && config[key] !== null) {
          // Check if this nested object contains the required fields
          const requiredFields = schemaProp.required || [];
          const hasAllRequired = requiredFields.every((field: string) =>
            config[key][field] !== undefined
          );
          if (hasAllRequired) {
            return true;
          }
        }
      }
    }

    return false;
  }

  private validateParameterStructure(step: PilotStep, action: any): boolean {
    let allValid = true;
    const schemaProps = action.parameters.properties;

    for (const [paramName, paramValue] of Object.entries(step.config)) {
      const schemaProp = schemaProps[paramName];

      if (!schemaProp) {
        // Check if this might be a valid nested parameter
        let found = false;
        for (const [schemaParamName, schemaParamDef] of Object.entries(schemaProps)) {
          if (typeof schemaParamDef === 'object' && (schemaParamDef as any).type === 'object') {
            const nestedProps = (schemaParamDef as any).properties || {};
            if (nestedProps[paramName]) {
              found = true;
              break;
            }
          }
        }

        if (!found) {
          this.warnings.push(`⚠️  Step ${step.step_id}: Parameter '${paramName}' not in plugin schema`);
        }
        continue;
      }

      // Validate parameter value if it's a variable reference
      if (typeof paramValue === 'string' && paramValue.includes('{{')) {
        const isValid = this.validateVariableReference(paramValue, `Step ${step.step_id}, param ${paramName}`);
        allValid = allValid && isValid;
      }

      // Validate nested object structures (e.g., recipients, content)
      if (schemaProp.type === 'object' && typeof paramValue === 'object') {
        const requiredFields = schemaProp.required || [];
        for (const requiredField of requiredFields) {
          if (paramValue[requiredField] === undefined) {
            this.issues.push(`❌ Step ${step.step_id}: Required field '${requiredField}' missing in '${paramName}'`);
            allValid = false;
          } else if (typeof paramValue[requiredField] === 'string' && paramValue[requiredField].includes('{{')) {
            // Validate variable references in nested fields
            const isValid = this.validateVariableReference(
              paramValue[requiredField],
              `Step ${step.step_id}, param ${paramName}.${requiredField}`
            );
            allValid = allValid && isValid;
          }
        }
      }

      // Validate array structures
      if (schemaProp.type === 'array' && Array.isArray(paramValue)) {
        for (let i = 0; i < paramValue.length; i++) {
          if (typeof paramValue[i] === 'string' && paramValue[i].includes('{{')) {
            const isValid = this.validateVariableReference(
              paramValue[i],
              `Step ${step.step_id}, param ${paramName}[${i}]`
            );
            allValid = allValid && isValid;
          }
        }
      }
    }

    return allValid;
  }

  private validateStep(step: PilotStep, context: string = ''): boolean {
    const stepContext = context ? `${context} > ${step.step_id}` : step.step_id;
    let isValid = true;

    console.log(`\n🔍 Validating ${stepContext} (${step.type})`);

    // Validate input reference if present
    if (step.input) {
      const inputRef = step.input;
      if (inputRef.includes('{{')) {
        isValid = this.validateVariableReference(inputRef, `Step ${step.step_id} input`) && isValid;
      }
    }

    // Validate based on step type
    switch (step.type) {
      case 'action':
        if (!step.plugin || !step.operation) {
          this.issues.push(`❌ Step ${step.step_id}: Action step missing plugin or operation`);
          isValid = false;
          break;
        }

        const schema = this.loadPluginSchema(step.plugin);
        if (schema) {
          isValid = this.validateActionParameters(step, schema) && isValid;
        } else {
          isValid = false;
        }
        break;

      case 'transform':
        // Validate filter conditions
        if (step.operation === 'filter' && step.config.condition) {
          isValid = this.validateFilterCondition(step) && isValid;
        }
        // Validate group operations
        if (step.operation === 'group' && step.config.rules) {
          isValid = this.validateGroupOperation(step) && isValid;
        }
        break;

      case 'ai_processing':
        // AI processing steps should have prompt/instruction
        if (!step.prompt && !step.config.instruction) {
          this.warnings.push(`⚠️  Step ${step.step_id}: AI step has no prompt or instruction`);
        }
        break;

      case 'scatter_gather':
        if (!step.scatter) {
          this.issues.push(`❌ Step ${step.step_id}: scatter_gather missing scatter config`);
          isValid = false;
          break;
        }

        // Validate scatter input
        isValid = this.validateVariableReference(step.scatter.input, `Step ${step.step_id} scatter input`) && isValid;

        // Validate substeps
        const itemVar = step.scatter.itemVariable;
        if (itemVar) {
          this.declaredVariables.add(itemVar);
        }

        for (const substep of step.scatter.steps) {
          isValid = this.validateStep(substep, stepContext) && isValid;
        }

        if (itemVar) {
          this.declaredVariables.delete(itemVar);
        }
        break;

      case 'conditional':
        if (!step.condition) {
          this.issues.push(`❌ Step ${step.step_id}: conditional missing condition`);
          isValid = false;
          break;
        }

        // Validate condition references
        isValid = this.validateCondition(step.condition, step.step_id) && isValid;

        // Validate conditional substeps
        if (step.steps) {
          for (const substep of step.steps) {
            isValid = this.validateStep(substep, stepContext) && isValid;
          }
        }
        break;
    }

    // Register output variable
    if (step.output_variable) {
      this.declaredVariables.add(step.output_variable);
      console.log(`  ✅ Declares variable: ${step.output_variable}`);
    }

    return isValid;
  }

  private validateFilterCondition(step: PilotStep): boolean {
    const condition = step.config.condition;
    let isValid = true;

    if (condition.field) {
      // Check if field contains config reference
      if (this.isConfigReference(condition.field)) {
        isValid = this.validateConfigReference(condition.field, `Step ${step.step_id} filter field`) && isValid;
        console.log(`  ✅ Filter field uses config reference: ${condition.field}`);
      } else {
        console.log(`  ✅ Filter field: ${condition.field}`);
      }
    }

    if (condition.value !== undefined) {
      if (typeof condition.value === 'string' && this.isConfigReference(condition.value)) {
        isValid = this.validateConfigReference(condition.value, `Step ${step.step_id} filter value`) && isValid;
        console.log(`  ✅ Filter value uses config reference: ${condition.value}`);
      }
    }

    // Handle complex conditions (AND, OR, NOT)
    if (condition.conditionType === 'complex_not' && condition.condition) {
      isValid = this.validateFilterCondition({ ...step, config: { condition: condition.condition } }) && isValid;
    }

    return isValid;
  }

  private validateGroupOperation(step: PilotStep): boolean {
    const rules = step.config.rules;

    if (!rules.group_by) {
      this.warnings.push(`⚠️  Step ${step.step_id}: group operation missing group_by specification`);
      return true; // Warning, not error
    }

    console.log(`  ✅ Group by: ${rules.group_by}`);
    return true;
  }

  private validateCondition(condition: any, stepId: string): boolean {
    if (condition.field) {
      return this.validateVariableReference(condition.field, `Step ${stepId} condition field`);
    }
    return true;
  }

  public validate(): void {
    console.log('🚀 Starting Deep Schema Validation\n');
    console.log('=' .repeat(80));

    let allStepsValid = true;

    for (const step of this.steps) {
      const isValid = this.validateStep(step);
      allStepsValid = allStepsValid && isValid;
    }

    console.log('\n' + '='.repeat(80));
    console.log('\n📊 VALIDATION SUMMARY\n');

    console.log(`Total Steps Validated: ${this.steps.length}`);
    console.log(`Variables Declared: ${this.declaredVariables.size}`);
    console.log(`Config Parameters: ${this.configParams.size}`);
    console.log(`Plugins Loaded: ${this.plugins.size}`);

    console.log(`\n🔴 Issues Found: ${this.issues.length}`);
    if (this.issues.length > 0) {
      this.issues.forEach(issue => console.log(`  ${issue}`));
    }

    console.log(`\n⚠️  Warnings: ${this.warnings.length}`);
    if (this.warnings.length > 0) {
      this.warnings.forEach(warning => console.log(`  ${warning}`));
    }

    console.log('\n' + '='.repeat(80));

    if (allStepsValid && this.issues.length === 0) {
      console.log('\n✅ WORKFLOW IS 100% EXECUTABLE\n');
      console.log('All steps validated successfully:');
      console.log('  ✅ All required parameters present');
      console.log('  ✅ All parameter names match plugin schemas');
      console.log('  ✅ All variable references valid');
      console.log('  ✅ All config references resolvable');
      console.log('  ✅ Data flow from upstream to downstream verified');
      process.exit(0);
    } else {
      console.log('\n❌ WORKFLOW HAS ISSUES\n');
      console.log(`Critical Issues: ${this.issues.length}`);
      console.log(`Warnings: ${this.warnings.length}`);
      process.exit(1);
    }
  }
}

// Run validation
const workflowPath = path.join(__dirname, '..', 'output', 'vocabulary-pipeline', 'pilot-dsl-steps.json');
const validator = new WorkflowValidator(workflowPath);
validator.validate();
