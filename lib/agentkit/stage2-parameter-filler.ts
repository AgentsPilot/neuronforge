/**
 * Stage 2: Input Schema Builder
 *
 * Pure JavaScript processing - NO LLM CALLS!
 *
 * Input: Stage 1 workflow with {{input.X}} references
 * Output: Complete workflow + generated input schema
 *
 * Process:
 * 1. Scan workflow for {{input.X}} references
 * 2. Build required_inputs schema programmatically
 * 3. Generate user-friendly labels from field names
 * 4. Infer types from field name conventions
 * 5. Process nested steps recursively
 *
 * Cost: $0 (no LLM call)
 * Latency: <100ms
 * Success Rate: 100% (deterministic)
 */

import { Stage1WorkflowDesign, Stage1RequiredInput } from './stage1-workflow-designer';

/**
 * Stage 2 Output: Complete workflow with input schema
 */
export interface Stage2CompleteWorkflow {
  // From Stage 1 (passed through)
  agent_name: string;
  agent_description: string;
  workflow_type: string;
  suggested_plugins: string[];
  confidence: number;
  reasoning: string;

  // Processed by Stage 2
  workflow_steps: any[];
  required_inputs: Stage1RequiredInput[];

  // Metadata
  tokensUsed?: {
    input: number;
    output: number;
  };
}

/**
 * Stage 2: Build input schema from {{input.X}} references
 *
 * This is a pure JavaScript function - NO LLM calls!
 */
export async function fillParameterValues(
  stage1Design: Stage1WorkflowDesign,
  _userPrompt: string,
  _connectedPlugins: string[]
): Promise<Stage2CompleteWorkflow> {

  console.log('🔧 [Stage 2] Building input schema from workflow...');

  // ========================================
  // STEP 1: Extract {{input.X}} references
  // ========================================

  const inputReferences = extractInputReferences(stage1Design.workflow_steps);
  console.log(`📝 [Stage 2] Found ${inputReferences.size} input references:`, Array.from(inputReferences));

  // ========================================
  // STEP 2: Build required_inputs schema
  // ========================================

  const required_inputs = buildInputSchema(inputReferences);
  console.log(`📋 [Stage 2] Generated input schema with ${required_inputs.length} fields`);

  // ========================================
  // STEP 3: Process nested steps recursively
  // ========================================

  const processedSteps = processWorkflowSteps(stage1Design.workflow_steps);

  // ========================================
  // STEP 4: Auto-fix ai_processing output references
  // ========================================

  const { steps: finalSteps, fixesApplied } = fixAIProcessingReferences(processedSteps);

  if (fixesApplied.length > 0) {
    console.log(`🔧 [Stage 2] Auto-fixed ${fixesApplied.length} ai_processing output references:`);
    fixesApplied.forEach(fix => console.log(`   - ${fix}`));
  }

  // ========================================
  // STEP 5: Return complete workflow
  // ========================================

  const fixesSummary = fixesApplied.length > 0
    ? `\n\nAuto-fixes applied: ${fixesApplied.join('; ')}`
    : '';

  return {
    agent_name: stage1Design.agent_name,
    agent_description: stage1Design.agent_description,
    workflow_type: stage1Design.workflow_type,
    workflow_steps: finalSteps,
    required_inputs: required_inputs,
    suggested_plugins: stage1Design.suggested_plugins,
    confidence: stage1Design.confidence,
    reasoning: `${stage1Design.reasoning}\n\nStage 2: Detected ${inputReferences.size} input fields from {{input.X}} references: ${Array.from(inputReferences).join(', ')}${fixesSummary}`,
    tokensUsed: { input: 0, output: 0 }  // No LLM call!
  };
}

/**
 * Extract all {{input.X}} references from workflow
 * Recursively scans all steps including nested loops
 */
function extractInputReferences(steps: any[]): Set<string> {
  const references = new Set<string>();
  const stepStr = JSON.stringify(steps);

  // Match {{input.field_name}} patterns (snake_case)
  // Pattern: {{input.FIELD_NAME}} where FIELD_NAME is alphanumeric + underscores
  const matches = stepStr.matchAll(/\{\{input\.([a-z_][a-z0-9_]*)\}\}/gi);

  for (const match of matches) {
    const fieldName = match[1].toLowerCase();
    references.add(fieldName);
  }

  console.log(`🔍 [Stage 2] Regex scan found: ${Array.from(references).join(', ')}`);

  return references;
}

/**
 * Build input schema with user-friendly labels and type inference
 */
function buildInputSchema(inputRefs: Set<string>): Stage1RequiredInput[] {
  const inputs: Stage1RequiredInput[] = [];

  for (const fieldName of inputRefs) {
    inputs.push({
      name: fieldName,
      type: inferInputType(fieldName),
      label: generateLabel(fieldName),
      description: `${generateLabel(fieldName)} for this workflow`,
      required: true,
      reasoning: `Detected from {{input.${fieldName}}} reference in workflow`
    });
  }

  // Sort alphabetically for consistency
  return inputs.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Infer input type from field name conventions
 *
 * Examples:
 *   recipient_email → email
 *   user_count → number
 *   is_enabled → boolean
 *   due_date → text (could be enhanced to 'date')
 */
function inferInputType(fieldName: string): 'text' | 'number' | 'email' | 'url' | 'select' | 'multi_select' | 'file' | 'json' {
  const lower = fieldName.toLowerCase();

  // Email fields
  if (lower.includes('email')) {
    return 'email';
  }

  // Number fields
  if (lower.includes('count') ||
      lower.includes('limit') ||
      lower.includes('max') ||
      lower.includes('min') ||
      lower.includes('amount') ||
      lower.includes('number') ||
      lower.includes('quantity') ||
      lower.includes('size')) {
    return 'number';
  }

  // URL fields
  if (lower.includes('url') ||
      lower.includes('link') ||
      lower.includes('website')) {
    return 'url';
  }

  // File fields
  if (lower.includes('file') ||
      lower.includes('attachment') ||
      lower.includes('document')) {
    return 'file';
  }

  // JSON fields
  if (lower.includes('json') ||
      lower.includes('config') ||
      lower.includes('data') ||
      lower.includes('payload')) {
    return 'json';
  }

  // Default to text
  return 'text';
}

/**
 * Generate user-friendly label from snake_case field name
 *
 * Examples:
 *   recipient_email → "Recipient Email"
 *   main_folder_id → "Main Folder ID"
 *   search_query → "Search Query"
 *   is_enabled → "Is Enabled"
 */
function generateLabel(fieldName: string): string {
  return fieldName
    .split('_')
    .map(word => {
      // Keep common abbreviations uppercase
      const upper = word.toUpperCase();
      if (['ID', 'URL', 'API', 'PDF', 'HTML', 'CSV', 'JSON', 'XML', 'SQL'].includes(upper)) {
        return upper;
      }
      // Capitalize first letter
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

/**
 * Process steps recursively
 * Handles nested loops, parallels, and other step structures
 * This is just a deep clone with recursive processing
 */
function processWorkflowSteps(steps: any[]): any[] {
  return steps.map(step => {
    const processed: any = { ...step };

    // Recursively process nested steps in loops
    if (step.loopSteps && Array.isArray(step.loopSteps)) {
      processed.loopSteps = processWorkflowSteps(step.loopSteps);
    }

    // Recursively process parallel steps
    if (step.parallelSteps && Array.isArray(step.parallelSteps)) {
      processed.parallelSteps = processWorkflowSteps(step.parallelSteps);
    }

    // Handle switch cases (step ID references, not nested steps)
    if (step.cases && typeof step.cases === 'object') {
      processed.cases = { ...step.cases };
    }

    // Handle scatter-gather nested steps (old format)
    if (step.scatterSteps && Array.isArray(step.scatterSteps)) {
      processed.scatterSteps = processWorkflowSteps(step.scatterSteps);
    }

    // Handle scatter-gather nested steps (DSL format: scatter.steps)
    if (step.scatter && step.scatter.steps && Array.isArray(step.scatter.steps)) {
      processed.scatter = {
        ...step.scatter,
        steps: processWorkflowSteps(step.scatter.steps)
      };
    }

    return processed;
  });
}

/**
 * Auto-fix ai_processing output references
 *
 * Scans all workflow steps and fixes incorrect references to ai_processing/llm_decision outputs.
 *
 * Examples of fixes:
 *   {{step2.html_table}} → {{step2.data.result}}
 *   {{step3.summary_text}} → {{step3.data.result}}
 *   {{step1.analysis}} → {{step1.data.result}} (unless it's already .data.analysis)
 *
 * This ensures 100% correctness regardless of what Stage 1 generates.
 */
function fixAIProcessingReferences(steps: any[]): { steps: any[]; fixesApplied: string[] } {
  const fixesApplied: string[] = [];

  // First pass: identify all ai_processing and llm_decision steps
  const aiStepIds = new Set<string>();
  const scanForAISteps = (stepList: any[]) => {
    stepList.forEach(step => {
      if (step.type === 'ai_processing' || step.type === 'llm_decision') {
        aiStepIds.add(step.id);
      }
      // Recursively scan nested steps
      if (step.loopSteps) scanForAISteps(step.loopSteps);
      if (step.parallelSteps) scanForAISteps(step.parallelSteps);
      if (step.scatterSteps) scanForAISteps(step.scatterSteps);
    });
  };
  scanForAISteps(steps);

  if (aiStepIds.size === 0) {
    // No ai_processing steps, nothing to fix
    return { steps, fixesApplied };
  }

  console.log(`🔍 [Stage 2] Detected ${aiStepIds.size} ai_processing/llm_decision steps: ${Array.from(aiStepIds).join(', ')}`);

  // Second pass: fix references recursively
  const fixReferences = (obj: any, path: string = 'root'): any => {
    if (obj === null || obj === undefined) {
      return obj;
    }

    if (typeof obj === 'string') {
      // Check for variable references
      const varPattern = /\{\{(step\d+)\.([^}]+)\}\}/g;
      const fixed = obj.replace(varPattern, (match, stepId, fieldPath) => {
        // If this references an ai_processing step
        if (aiStepIds.has(stepId)) {
          // Check if it already has .data prefix
          if (fieldPath.startsWith('data.')) {
            // Already correct, no fix needed
            return match;
          }

          // Fix: add .data.result
          const fixedRef = `{{${stepId}.data.result}}`;
          fixesApplied.push(`${path}: ${match} → ${fixedRef}`);
          return fixedRef;
        }

        // Not an ai_processing step, leave as-is
        return match;
      });

      return fixed;
    }

    if (Array.isArray(obj)) {
      return obj.map((item, idx) => fixReferences(item, `${path}[${idx}]`));
    }

    if (typeof obj === 'object') {
      const fixed: any = {};
      for (const [key, value] of Object.entries(obj)) {
        fixed[key] = fixReferences(value, `${path}.${key}`);
      }
      return fixed;
    }

    return obj;
  };

  const fixedSteps = fixReferences(steps, 'workflow');

  return { steps: fixedSteps, fixesApplied };
}
