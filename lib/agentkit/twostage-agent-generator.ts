/**
 * Two-Stage Agent Generator
 *
 * Orchestrates Stage 1 (Workflow Designer) and Stage 2 (Parameter Filler)
 * with comprehensive validation gates between stages
 *
 * Pipeline:
 * 1. Stage 1: Design workflow structure → Validate structure → Gate
 * 2. Stage 2: Fill parameters → Validate parameters → Gate
 * 3. Semantic validation → Gate
 * 4. Return complete, validated agent
 *
 * Target Success Rate: 95%+ simple, 90%+ complex
 * Cost: ~$0.028 per generation
 * Latency: 4-6 seconds
 */

import {
  designWorkflowStructure,
  Stage1WorkflowDesign
} from './stage1-workflow-designer';
import {
  fillParameterValues,
  Stage2CompleteWorkflow
} from './stage2-parameter-filler';
import { validateWorkflowStructure } from '../pilot/schema/runtime-validator';
import { PluginManagerV2 } from '../server/plugin-manager-v2';

/**
 * Validation gate result
 */
interface ValidationGate {
  passed: boolean;
  errors: string[];
  warnings: string[];
  fixes_applied?: string[];
}

/**
 * Complete agent generation result
 */
export interface TwoStageAgentResult {
  success: boolean;

  // Agent data (if successful)
  agent?: {
    agent_name: string;
    agent_description: string;
    workflow_type: string;
    workflow_steps: any[];
    required_inputs: any[];
    suggested_plugins: string[];
    confidence: number;
    reasoning: string;
  };

  // Validation details
  validation?: {
    stage1_validation: ValidationGate;
    stage2_validation: ValidationGate;
    semantic_validation: ValidationGate;
  };

  // Errors (if failed)
  error?: string;
  stage_failed?: 'stage1' | 'stage2' | 'validation';

  // Metadata
  tokensUsed?: {
    stage1: { input: number; output: number };
    stage2: { input: number; output: number };
    total: number;
  };
  latency_ms?: number;
}

/**
 * Generate agent using 2-stage pipeline
 */
export async function generateAgentTwoStage(
  userId: string,
  userPrompt: string,
  connectedPlugins: string[]
): Promise<TwoStageAgentResult> {

  const startTime = Date.now();
  console.log('🚀 [TwoStage Generator] Starting 2-stage agent generation...');

  try {
    // ========================================
    // STAGE 1: WORKFLOW STRUCTURE DESIGN
    // ========================================
    console.log('📐 [Stage 1] Designing workflow structure...');

    let stage1Design;
    try {
      stage1Design = await designWorkflowStructure(
        userId,
        userPrompt,
        connectedPlugins
      );
    } catch (stage1Error: any) {
      console.error('❌ [Stage 1] Failed:', stage1Error.message);
      return {
        success: false,
        error: `Stage 1 failed: ${stage1Error.message}`,
        stage_failed: 'stage1',
        latency_ms: Date.now() - startTime
      };
    }

    // ========================================
    // GATE 1: STRUCTURE VALIDATION
    // ========================================
    console.log('🚧 [Gate 1] Validating workflow structure...');

    const gate1 = await validateStage1Structure(stage1Design, connectedPlugins);

    if (!gate1.passed) {
      console.error('❌ [Gate 1] Structure validation FAILED:', gate1.errors);
      return {
        success: false,
        error: `Stage 1 validation failed: ${gate1.errors.join(', ')}`,
        stage_failed: 'stage1',
        validation: {
          stage1_validation: gate1,
          stage2_validation: { passed: false, errors: [], warnings: [] },
          semantic_validation: { passed: false, errors: [], warnings: [] }
        },
        latency_ms: Date.now() - startTime
      };
    }

    if (gate1.warnings.length > 0) {
      console.warn('⚠️ [Gate 1] Warnings:', gate1.warnings);
    }

    console.log('✅ [Gate 1] Structure validation PASSED');

    // ========================================
    // STAGE 2: PARAMETER FILLING
    // ========================================
    console.log('🔧 [Stage 2] Filling parameter values...');

    let stage2Complete;
    try {
      stage2Complete = await fillParameterValues(
        stage1Design,
        userPrompt,
        connectedPlugins
      );
    } catch (stage2Error: any) {
      console.error('❌ [Stage 2] Failed:', stage2Error.message);
      return {
        success: false,
        error: `Stage 2 failed: ${stage2Error.message}`,
        stage_failed: 'stage2',
        validation: {
          stage1_validation: gate1,
          stage2_validation: { passed: false, errors: [stage2Error.message], warnings: [] },
          semantic_validation: { passed: false, errors: [], warnings: [] }
        },
        latency_ms: Date.now() - startTime
      };
    }

    // ========================================
    // GATE 2: PARAMETER VALIDATION
    // ========================================
    console.log('🚧 [Gate 2] Validating parameters...');

    const gate2 = await validateStage2Parameters(stage2Complete, connectedPlugins);

    if (!gate2.passed) {
      console.error('❌ [Gate 2] Parameter validation FAILED:', gate2.errors);
      return {
        success: false,
        error: `Stage 2 validation failed: ${gate2.errors.join(', ')}`,
        stage_failed: 'stage2',
        validation: {
          stage1_validation: gate1,
          stage2_validation: gate2,
          semantic_validation: { passed: false, errors: [], warnings: [] }
        },
        latency_ms: Date.now() - startTime
      };
    }

    if (gate2.warnings.length > 0) {
      console.warn('⚠️ [Gate 2] Warnings:', gate2.warnings);
    }

    console.log('✅ [Gate 2] Parameter validation PASSED');

    // ========================================
    // GATE 3: SEMANTIC VALIDATION
    // ========================================
    console.log('🚧 [Gate 3] Semantic validation...');

    const gate3 = await validateSemantics(stage2Complete, userPrompt);

    if (!gate3.passed) {
      console.error('❌ [Gate 3] Semantic validation FAILED:', gate3.errors);
      return {
        success: false,
        error: `Semantic validation failed: ${gate3.errors.join(', ')}`,
        stage_failed: 'validation',
        validation: {
          stage1_validation: gate1,
          stage2_validation: gate2,
          semantic_validation: gate3
        },
        latency_ms: Date.now() - startTime
      };
    }

    console.log('✅ [Gate 3] Semantic validation PASSED');

    // ========================================
    // SUCCESS - ALL GATES PASSED
    // ========================================

    const totalTokens =
      (stage1Design.tokensUsed?.input || 0) +
      (stage1Design.tokensUsed?.output || 0) +
      (stage2Complete.tokensUsed?.input || 0) +
      (stage2Complete.tokensUsed?.output || 0);

    const latency = Date.now() - startTime;

    console.log('🎉 [TwoStage Generator] SUCCESS!', {
      tokens: totalTokens,
      latency: `${latency}ms`,
      confidence: stage2Complete.confidence
    });

    return {
      success: true,
      agent: {
        agent_name: stage2Complete.agent_name,
        agent_description: stage2Complete.agent_description,
        workflow_type: stage2Complete.workflow_type,
        workflow_steps: stage2Complete.workflow_steps,
        required_inputs: stage2Complete.required_inputs,
        suggested_plugins: stage2Complete.suggested_plugins,
        confidence: stage2Complete.confidence,
        reasoning: stage2Complete.reasoning
      },
      validation: {
        stage1_validation: gate1,
        stage2_validation: gate2,
        semantic_validation: gate3
      },
      tokensUsed: {
        stage1: {
          input: stage1Design.tokensUsed?.input || 0,
          output: stage1Design.tokensUsed?.output || 0
        },
        stage2: {
          input: stage2Complete.tokensUsed?.input || 0,
          output: stage2Complete.tokensUsed?.output || 0
        },
        total: totalTokens
      },
      latency_ms: latency
    };

  } catch (error: any) {
    console.error('💥 [TwoStage Generator] FATAL ERROR:', error);
    return {
      success: false,
      error: error.message,
      stage_failed: 'stage1',
      latency_ms: Date.now() - startTime
    };
  }
}

/**
 * Gate 1: Validate Stage 1 structure
 */
async function validateStage1Structure(
  design: Stage1WorkflowDesign,
  _connectedPlugins: string[]
): Promise<ValidationGate> {

  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Check basic fields
  if (!design.agent_name || design.agent_name.length === 0) {
    errors.push('Missing agent_name');
  }
  if (!design.workflow_steps || design.workflow_steps.length === 0) {
    errors.push('No workflow steps defined');
  }

  // 2. Validate plugin references
  const pluginManager = await PluginManagerV2.getInstance();
  const availablePlugins = pluginManager.getAvailablePlugins();

  for (const step of design.workflow_steps || []) {
    if (step.type === 'action') {
      if (!step.plugin) {
        errors.push(`Step ${step.id}: action step missing plugin field`);
        continue;
      }
      if (!step.action) {
        errors.push(`Step ${step.id}: action step missing action field`);
        continue;
      }

      // Check plugin exists
      const pluginDef = availablePlugins[step.plugin];
      if (!pluginDef) {
        errors.push(`Step ${step.id}: Plugin "${step.plugin}" not found`);
        continue;
      }

      // Check action exists
      const actionDef = pluginDef.actions[step.action];
      if (!actionDef) {
        errors.push(`Step ${step.id}: Action "${step.action}" not found in plugin "${step.plugin}"`);
      }
    }
  }

  // 3. Check for FORBIDDEN $PLACEHOLDER values (should use {{input.X}} instead)
  const workflowStr = JSON.stringify(design.workflow_steps);
  const placeholderMatches = workflowStr.match(/"\$[A-Z_0-9]+"/g);

  if (placeholderMatches && placeholderMatches.length > 0) {
    const uniquePlaceholders = Array.from(new Set(placeholderMatches));
    errors.push(`Found FORBIDDEN $PLACEHOLDER values: ${uniquePlaceholders.join(', ')}. Use {{input.field_name}} instead.`);
  }

  // 4. Validate {{input.X}} format (should be snake_case)
  const inputRefMatches = workflowStr.matchAll(/\{\{input\.([^}]+)\}\}/g);
  for (const match of inputRefMatches) {
    const fieldName = match[1];
    if (!/^[a-z_][a-z0-9_]*$/i.test(fieldName)) {
      warnings.push(`Input reference "{{input.${fieldName}}}" should use snake_case format`);
    }
  }

  // 5. Validate step IDs are unique
  const stepIds = new Set<string>();
  for (const step of design.workflow_steps || []) {
    if (stepIds.has(step.id)) {
      errors.push(`Duplicate step ID: ${step.id}`);
    }
    stepIds.add(step.id);
  }

  // 6. Validate step references exist
  for (const step of design.workflow_steps || []) {
    if (step.next && !stepIds.has(step.next)) {
      errors.push(`Step ${step.id}: next="${step.next}" does not exist`);
    }
    if (step.on_success && !stepIds.has(step.on_success)) {
      errors.push(`Step ${step.id}: on_success="${step.on_success}" does not exist`);
    }
    if (step.on_failure && !stepIds.has(step.on_failure)) {
      errors.push(`Step ${step.id}: on_failure="${step.on_failure}" does not exist`);
    }
  }

  return {
    passed: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Gate 2: Validate Stage 2 parameters
 */
async function validateStage2Parameters(
  complete: Stage2CompleteWorkflow,
  _connectedPlugins: string[]
): Promise<ValidationGate> {

  const errors: string[] = [];
  const warnings: string[] = [];
  const fixes: string[] = [];

  // 1. Validate field structures by step type
  for (const step of complete.workflow_steps || []) {
    if (step.type === 'transform') {
      // Transform steps should have operation/input/config at top level
      if (!step.operation) {
        errors.push(`Step ${step.id}: Transform step missing 'operation' field at top level`);
      }
      if (!step.input) {
        errors.push(`Step ${step.id}: Transform step missing 'input' field at top level`);
      }
      // Transform steps should NOT have params
      if (step.params) {
        warnings.push(`Step ${step.id}: Transform step has 'params' - should use operation/input/config at top level`);
      }
    }

    if (step.type === 'action') {
      if (!step.plugin) errors.push(`Step ${step.id}: Action missing 'plugin'`);
      if (!step.action) errors.push(`Step ${step.id}: Action missing 'action'`);
      // Actions should have params object
      if (!step.params) {
        warnings.push(`Step ${step.id}: Action step missing 'params' object`);
      }
    }

    if (step.type === 'loop') {
      if (!step.iterateOver) errors.push(`Step ${step.id}: Loop missing 'iterateOver'`);
      if (!step.loopSteps) errors.push(`Step ${step.id}: Loop missing 'loopSteps'`);
      if (!step.maxIterations) warnings.push(`Step ${step.id}: Loop missing 'maxIterations' safety limit`);
    }
  }

  // 2. Check for ANY remaining $PLACEHOLDER values (should never happen after Stage 2)
  const workflowStr = JSON.stringify(complete.workflow_steps);
  const placeholderMatches = workflowStr.match(/"\$[A-Z_0-9]+"/g);

  if (placeholderMatches && placeholderMatches.length > 0) {
    const uniquePlaceholders = Array.from(new Set(placeholderMatches));
    errors.push(`Stage 2 failed to process $PLACEHOLDER values: ${uniquePlaceholders.join(', ')}`);
  }

  // 3. Validate required parameters exist
  const pluginManager = await PluginManagerV2.getInstance();
  const availablePlugins = pluginManager.getAvailablePlugins();

  for (const step of complete.workflow_steps || []) {
    if (step.type === 'action' && step.plugin && step.action) {
      const pluginDef = availablePlugins[step.plugin];
      const actionDef = pluginDef?.actions[step.action];
      const requiredParams = actionDef?.parameters?.required || [];

      for (const param of requiredParams) {
        if (!step.params || step.params[param] === undefined) {
          errors.push(`Step ${step.id}: Missing required parameter "${param}" for ${step.plugin}.${step.action}`);
        }
      }
    }
  }

  // 4. Validate variable references {{...}} are valid
  const declaredInputs = new Set(complete.required_inputs.map(i => i.name));
  const stepIds = new Set(complete.workflow_steps.map(s => s.id));

  // Track which steps are ai_processing for output validation
  const aiProcessingSteps = new Set(
    complete.workflow_steps
      .filter(s => s.type === 'ai_processing' || s.type === 'llm_decision')
      .map(s => s.id)
  );

  for (const step of complete.workflow_steps || []) {
    const stepStr = JSON.stringify(step);
    const varRefs = stepStr.matchAll(/\{\{([^}]+)\}\}/g);

    for (const match of varRefs) {
      const ref = match[1];

      // Check input references
      if (ref.startsWith('input.')) {
        const inputName = ref.substring(6);
        if (!declaredInputs.has(inputName)) {
          errors.push(`Step ${step.id}: References undefined input "{{${ref}}}"`);
        }
      }

      // Check step references
      if (ref.match(/^step\d+\./)) {
        const stepId = ref.split('.')[0];
        if (!stepIds.has(stepId)) {
          errors.push(`Step ${step.id}: References undefined step "{{${ref}}}"`);
        }

        // Check if referencing ai_processing step without .data
        // NOTE: Stage 2 auto-fixes these, so this is just a warning for monitoring
        if (aiProcessingSteps.has(stepId)) {
          const refPattern = ref.substring(stepId.length + 1); // Remove "stepN."

          // Valid patterns: data.result, data.response, data.output, data.summary, etc.
          if (!refPattern.startsWith('data.')) {
            warnings.push(
              `Step ${step.id}: Reference "{{${ref}}}" should use {{${stepId}.data.result}} (Stage 2 should have auto-fixed this)`
            );
          }
        }
      }
    }
  }

  // 5. Use existing validateWorkflowStructure from runtime-validator
  try {
    const validationResult = validateWorkflowStructure(complete.workflow_steps);

    if (!validationResult.valid) {
      errors.push(...validationResult.errors);
    }
  } catch (error: any) {
    errors.push(`Runtime validation failed: ${error.message}`);
  }

  return {
    passed: errors.length === 0,
    errors,
    warnings,
    fixes_applied: fixes
  };
}

/**
 * Gate 3: Semantic validation
 * Check that the workflow makes sense for the user's intent
 */
async function validateSemantics(
  complete: Stage2CompleteWorkflow,
  _userPrompt: string
): Promise<ValidationGate> {

  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Check confidence score
  if (complete.confidence < 50) {
    warnings.push(`Low confidence score: ${complete.confidence}%`);
  }

  // 2. Check workflow complexity matches type
  const stepCount = complete.workflow_steps.length;
  const hasConditional = complete.workflow_steps.some(s => s.type === 'conditional');
  const hasLoop = complete.workflow_steps.some(s => s.type === 'loop');

  if (complete.workflow_type === 'simple_linear' && (hasConditional || hasLoop)) {
    warnings.push('Workflow type is simple_linear but contains conditionals/loops');
  }

  if (complete.workflow_type === 'complex' && stepCount < 5) {
    warnings.push('Workflow type is complex but only has few steps');
  }

  // 3. Check that suggested plugins are actually used
  const usedPlugins = new Set(
    complete.workflow_steps
      .filter(s => s.type === 'action' && s.plugin)
      .map(s => s.plugin!)
  );

  for (const suggested of complete.suggested_plugins) {
    if (!usedPlugins.has(suggested)) {
      warnings.push(`Suggested plugin "${suggested}" not used in workflow`);
    }
  }

  // 4. Check for suspicious patterns
  // - Loops without max_iterations
  for (const step of complete.workflow_steps) {
    if (step.type === 'loop' && step.loop && !step.loop.max_iterations) {
      warnings.push(`Step ${step.id}: Loop without max_iterations safety limit`);
    }
  }

  // - Steps with no next/on_success (except last step)
  const lastStep = complete.workflow_steps[complete.workflow_steps.length - 1];
  for (const step of complete.workflow_steps) {
    if (step !== lastStep && !step.next && !step.on_success && step.type !== 'conditional') {
      warnings.push(`Step ${step.id}: No next step defined (not last step)`);
    }
  }

  return {
    passed: errors.length === 0,
    errors,
    warnings
  };
}
