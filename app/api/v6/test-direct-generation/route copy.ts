/**
 * TEST: Direct Workflow Generation
 *
 * Simple test: Give LLM 3 things and ask it to build perfect workflow steps:
 * 1. Enhanced Prompt (user requirements with exact details)
 * 2. Plugin Schemas (for services_involved from Enhanced Prompt)
 * 3. Full PILOT DSL Schema (all step types and structure)
 */

import { NextRequest, NextResponse } from 'next/server';
import { PILOT_DSL_SCHEMA } from '@/lib/pilot/schema/pilot-dsl-schema';
import OpenAI from 'openai';
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';
import { WorkflowPostValidator } from '@/lib/agentkit/v6/compiler/WorkflowPostValidator';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ============================================================================
// Helper Functions (from V6 IRToDSLCompiler)
// ============================================================================

/**
 * Fix variable references to unwrap nested plugin outputs
 * Example: {{step1.data}} → {{step1.data.emails}} if step1 outputs {emails: [...]}
 */
function fixVariableReferences(workflow: any[], availablePlugins: Record<string, any>): any[] {
  // Build map of step outputs (id → primary array field name)
  const stepOutputFields = new Map<string, string>();

  workflow.forEach(step => {
    if (step.type === 'action' && step.plugin && step.action) {
      const pluginDef = availablePlugins[step.plugin];
      if (!pluginDef?.actions?.[step.action]) return;

      const outputSchema = pluginDef.actions[step.action].output_schema;
      if (outputSchema?.properties) {
        // Find the first array field in the output
        const arrayField = Object.entries(outputSchema.properties).find(
          ([_, schema]: [string, any]) => schema.type === 'array'
        );

        if (arrayField) {
          stepOutputFields.set(step.id, arrayField[0]);
          console.log(`[TEST-DIRECT] Detected ${step.id} output array field: ${arrayField[0]}`);
        }
      }
    }
  });

  // Fix variable references in steps
  return workflow.map(step => {
    if (step.type === 'transform' && step.input) {
      const fixed = unwrapVariableReference(step.input, stepOutputFields);
      if (fixed !== step.input) {
        console.log(`[TEST-DIRECT] Fixed transform input: ${step.input} → ${fixed}`);
        return { ...step, input: fixed };
      }
    }

    if (step.type === 'loop' && step.iterateOver) {
      const fixed = unwrapVariableReference(step.iterateOver, stepOutputFields);
      if (fixed !== step.iterateOver) {
        console.log(`[TEST-DIRECT] Fixed loop iterateOver: ${step.iterateOver} → ${fixed}`);
        return { ...step, iterateOver: fixed };
      }
    }

    if (step.type === 'scatter_gather' && step.scatter?.input) {
      const fixed = unwrapVariableReference(step.scatter.input, stepOutputFields);
      if (fixed !== step.scatter.input) {
        console.log(`[TEST-DIRECT] Fixed scatter input: ${step.scatter.input} → ${fixed}`);
        return { ...step, scatter: { ...step.scatter, input: fixed } };
      }
    }

    return step;
  });
}

/**
 * Unwrap a variable reference if it points to a plugin output with nested array
 */
function unwrapVariableReference(ref: string, stepOutputFields: Map<string, string>): string {
  const matchDirect = ref.match(/^\{\{(step\d+)\}\}$/);
  const matchData = ref.match(/^\{\{(step\d+)\.data\}\}$/);

  const match = matchDirect || matchData;
  if (!match) return ref;

  const stepId = match[1];
  const arrayField = stepOutputFields.get(stepId);

  if (arrayField) {
    return `{{${stepId}.data.${arrayField}}}`;
  }

  return ref;
}

/**
 * Renumber steps sequentially (step1, step2, step3...)
 */
function renumberSteps(workflow: any[]): any[] {
  const stepIdMap = new Map<string, string>();
  let globalCounter = 1;

  // Collect all step IDs (including nested)
  const collectStepIds = (steps: any[]) => {
    if (!Array.isArray(steps)) return;

    steps.forEach(step => {
      if (step.id) {
        const newId = `step${globalCounter++}`;
        stepIdMap.set(step.id, newId);
      }
      if (step.scatter?.steps && Array.isArray(step.scatter.steps)) {
        collectStepIds(step.scatter.steps);
      }
      if (step.loopSteps && Array.isArray(step.loopSteps)) {
        collectStepIds(step.loopSteps);
      }
      if (step.trueBranch && Array.isArray(step.trueBranch)) {
        collectStepIds(step.trueBranch);
      }
      if (step.falseBranch && Array.isArray(step.falseBranch)) {
        collectStepIds(step.falseBranch);
      }
    });
  };

  collectStepIds(workflow);

  // Debug: Log the step ID mapping
  console.log('[TEST-DIRECT] Step ID mapping:');
  stepIdMap.forEach((newId, oldId) => {
    console.log(`  ${oldId} → ${newId}`);
  });

  // Update step IDs and references
  const updateStepIds = (steps: any[]): any[] => {
    return steps.map(step => {
      const newStep = { ...step };

      // Debug: Check if this step has problematic references before updating
      const stepStr = JSON.stringify(newStep);
      const hasSemanticRef = stepStr.match(/step\d+_\d+_\w+/);
      if (hasSemanticRef && newStep.id && newStep.id.includes('loop')) {
        console.log(`[renumberSteps] Processing ${step.id}, found semantic refs in nested steps`);
      }

      if (newStep.id && stepIdMap.has(newStep.id)) {
        newStep.id = stepIdMap.get(newStep.id);
      }

      // Update variable references in common fields
      ['input', 'iterateOver', 'condition', 'description', 'left', 'right', 'executeIf', 'trueBranch', 'falseBranch'].forEach(field => {
        if (newStep[field]) {
          if (typeof newStep[field] === 'string') {
            newStep[field] = updateStepReferences(newStep[field], stepIdMap);
          } else if (typeof newStep[field] === 'object' && !Array.isArray(newStep[field])) {
            // Handle complex condition objects
            newStep[field] = updateObjectReferences(newStep[field], stepIdMap);
          }
        }
      });

      // Update params
      if (newStep.params) {
        const oldParams = JSON.stringify(newStep.params);
        newStep.params = updateObjectReferences(newStep.params, stepIdMap);
        const newParams = JSON.stringify(newStep.params);
        if (oldParams !== newParams && oldParams.includes('step5_1_')) {
          console.log(`[renumberSteps] Updated params in ${newStep.id}:\n  OLD: ${oldParams.substring(0, 150)}\n  NEW: ${newParams.substring(0, 150)}`);
        }
      }

      // Update config (transform steps and others may have this)
      if (newStep.config) {
        newStep.config = updateObjectReferences(newStep.config, stepIdMap);
      }

      // Update dependencies
      if (newStep.dependencies) {
        newStep.dependencies = newStep.dependencies.map((dep: string) =>
          stepIdMap.get(dep) || dep
        );
      }

      // Recursively update nested steps
      if (newStep.scatter?.steps && Array.isArray(newStep.scatter.steps)) {
        newStep.scatter.steps = updateStepIds(newStep.scatter.steps);
      }
      if (newStep.loopSteps && Array.isArray(newStep.loopSteps)) {
        console.log(`[renumberSteps] Recursively updating ${newStep.loopSteps.length} nested loop steps in ${newStep.id}`);
        newStep.loopSteps = updateStepIds(newStep.loopSteps);
      }
      if (newStep.trueBranch && Array.isArray(newStep.trueBranch)) {
        newStep.trueBranch = updateStepIds(newStep.trueBranch);
      }
      if (newStep.falseBranch && Array.isArray(newStep.falseBranch)) {
        newStep.falseBranch = updateStepIds(newStep.falseBranch);
      }

      return newStep;
    });
  };

  return updateStepIds(workflow);
}

/**
 * Update step references in a string ({{stepX}} → {{stepY}})
 * Handles both numeric (step1) and semantic (search_emails) step IDs
 */
function updateStepReferences(str: string, stepIdMap: Map<string, string>): string {
  // Build regex from actual step IDs in the map to avoid false matches
  const stepIds = Array.from(stepIdMap.keys());

  if (stepIds.length === 0) return str;

  // Sort by length descending to match longer IDs first (step5_1_extract before step5_1)
  stepIds.sort((a, b) => b.length - a.length);

  // Escape special regex characters and join with |
  const escapedIds = stepIds.map(id => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const stepIdPattern = escapedIds.join('|');

  // Replace {{stepId}} or {{stepId.path}} patterns
  const templateVarRegex = new RegExp(`\\{\\{(${stepIdPattern})(\\.[\\w.]+)?\\}\\}`, 'g');
  let replacementCount = 0;
  str = str.replace(templateVarRegex, (match, stepId, path) => {
    const newStepId = stepIdMap.get(stepId);
    if (newStepId) {
      replacementCount++;
      return `{{${newStepId}${path || ''}}}`;
    }
    return match;
  });

  // Also replace bare step references (without {{}}) followed by dot notation
  // Only match when followed by a dot to avoid matching random words
  const bareRefRegex = new RegExp(`\\b(${stepIdPattern})(\\.[\\w.]+)`, 'g');
  str = str.replace(bareRefRegex, (match, stepId, path) => {
    const newStepId = stepIdMap.get(stepId);
    if (newStepId) {
      replacementCount++;
      return `${newStepId}${path}`;
    }
    return match;
  });

  if (replacementCount > 0 && str.includes('step5_')) {
    console.log(`[updateStepReferences] Replaced ${replacementCount} references in string: ${str.substring(0, 200)}...`);
  }

  return str;
}

/**
 * Recursively update step references in an object
 */
function updateObjectReferences(obj: any, stepIdMap: Map<string, string>): any {
  if (typeof obj === 'string') {
    return updateStepReferences(obj, stepIdMap);
  }
  if (Array.isArray(obj)) {
    return obj.map(item => updateObjectReferences(item, stepIdMap));
  }
  if (obj && typeof obj === 'object') {
    const updated: any = {};
    for (const [key, value] of Object.entries(obj)) {
      updated[key] = updateObjectReferences(value, stepIdMap);
    }
    return updated;
  }
  return obj;
}

/**
 * Fix forward references by detecting step position in workflow
 * Example: step6 referencing step9 → find which earlier step has the data
 */
function fixForwardReferences(workflow: any[]): any[] {
  console.log('[TEST-DIRECT] Checking for forward references...');

  // Build position map: stepId → index in workflow array
  const stepPosition = new Map<string, number>();
  const flattenSteps = (steps: any[], parentIdx: number) => {
    steps.forEach((step, idx) => {
      if (step.id) {
        stepPosition.set(step.id, parentIdx);
      }
      // Nested steps have same position as parent
      if (step.scatter?.steps) {
        step.scatter.steps.forEach((nested: any) => {
          if (nested.id) stepPosition.set(nested.id, parentIdx);
        });
      }
      if (step.loopSteps) {
        step.loopSteps.forEach((nested: any) => {
          if (nested.id) stepPosition.set(nested.id, parentIdx);
        });
      }
    });
  };

  workflow.forEach((step, idx) => {
    flattenSteps([step], idx);
  });

  // Track detected forward refs
  let forwardRefsFixed = 0;

  const fixStepReferences = (step: any, currentPosition: number): any => {
    const stepStr = JSON.stringify(step);
    const regex = /\{\{(step\d+)(?:\.([^\}]+))?\}\}/g;
    let fixed = stepStr;
    let match;

    while ((match = regex.exec(stepStr)) !== null) {
      const refStepId = match[1];
      const refPath = match[2] || '';
      const refPosition = stepPosition.get(refStepId);

      // Forward reference detected!
      if (refPosition !== undefined && refPosition > currentPosition) {
        console.warn(`[TEST-DIRECT] ⚠️ Forward reference detected in ${step.id}: {{${refStepId}${refPath ? '.' + refPath : ''}}} (step at position ${refPosition} > current position ${currentPosition})`);

        // Find the step that should actually provide this data
        // Look backwards from current position for a step with matching output
        let replacementStepId = refStepId;
        for (let i = currentPosition - 1; i >= 0; i--) {
          const candidateStep = workflow[i];
          // Simple heuristic: if the reference path suggests what data we need,
          // find a previous step that might produce it
          if (refPath.includes('all_rows') && candidateStep.description?.includes('flatten') || candidateStep.description?.includes('Flatten')) {
            replacementStepId = candidateStep.id;
            break;
          }
          if (refPath.includes('final_rows') && candidateStep.description?.includes('review') || candidateStep.description?.includes('strip')) {
            replacementStepId = candidateStep.id;
            break;
          }
          if (refPath.includes('html_table') && candidateStep.description?.includes('HTML') || candidateStep.description?.includes('Render')) {
            replacementStepId = candidateStep.id;
            break;
          }
          if (refPath.includes('extracted_text') && candidateStep.type === 'action' && candidateStep.action === 'get_email_attachment') {
            replacementStepId = candidateStep.id;
            break;
          }
        }

        if (replacementStepId !== refStepId) {
          console.log(`[TEST-DIRECT] 🔧 Auto-fixing: {{${refStepId}${refPath ? '.' + refPath : ''}}} → {{${replacementStepId}${refPath ? '.' + refPath : ''}}}`);
          const oldRef = `{{${refStepId}${refPath ? '.' + refPath : ''}}}`;
          const newRef = `{{${replacementStepId}${refPath ? '.' + refPath : ''}}}`;
          fixed = fixed.replace(new RegExp(oldRef.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), newRef);
          forwardRefsFixed++;
        }
      }
    }

    return fixed === stepStr ? step : JSON.parse(fixed);
  };

  const fixedWorkflow = workflow.map((step, idx) => {
    let fixedStep = fixStepReferences(step, idx);

    // Also fix nested steps
    if (fixedStep.scatter?.steps) {
      fixedStep.scatter.steps = fixedStep.scatter.steps.map((nested: any) =>
        fixStepReferences(nested, idx)
      );
    }
    if (fixedStep.loopSteps) {
      fixedStep.loopSteps = fixedStep.loopSteps.map((nested: any) =>
        fixStepReferences(nested, idx)
      );
    }

    return fixedStep;
  });

  if (forwardRefsFixed > 0) {
    console.log(`[TEST-DIRECT] ✅ Fixed ${forwardRefsFixed} forward references`);
  }

  return fixedWorkflow;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { enhanced_prompt } = body;

    if (!enhanced_prompt) {
      return NextResponse.json(
        { error: 'enhanced_prompt is required' },
        { status: 400 }
      );
    }

    console.log('[TEST-DIRECT] Starting direct workflow generation...');

    // 1. Extract services_involved from Enhanced Prompt
    const servicesInvolved = enhanced_prompt.specifics?.services_involved || [];
    console.log('[TEST-DIRECT] Services involved:', servicesInvolved);

    // 2. Load plugin schemas for those services using PluginManagerV2
    const pluginManager = await PluginManagerV2.getInstance();
    const availablePlugins = pluginManager.getAvailablePlugins();

    // Build plugin schemas text (same as IRToDSLCompiler does)
    const pluginSchemasText = servicesInvolved
      .map((pluginKey: string) => {
        const pluginDef = availablePlugins[pluginKey];
        if (!pluginDef) {
          console.warn(`[TEST-DIRECT] Plugin not found: ${pluginKey}`);
          return null;
        }

        const actionsInfo = Object.entries(pluginDef.actions)
          .map(([actionName, actionDef]: [string, any]) => {
            const params = actionDef.parameters;
            const output = actionDef.output_schema;

            let actionInfo = `  - ${actionName}:\n`;

            if (params && params.properties) {
              actionInfo += `    Parameters:\n`;
              Object.entries(params.properties).forEach(([paramName, paramSchema]: [string, any]) => {
                const isReq = params?.required?.includes(paramName) ? ' (required)' : '';
                const type = paramSchema.type || 'any';
                const desc = paramSchema.description || '';
                actionInfo += `      • ${paramName} (${type})${isReq}: ${desc}\n`;
              });
            }

            if (output && output.properties) {
              actionInfo += `    Output:\n`;
              Object.entries(output.properties).forEach(([outName, outSchema]: [string, any]) => {
                const type = (outSchema as any).type || 'any';
                const desc = (outSchema as any).description || '';
                actionInfo += `      • ${outName} (${type}): ${desc}\n`;
              });
            }

            return actionInfo;
          })
          .join('\n');

        return `### ${pluginKey}\n\n${actionsInfo}`;
      })
      .filter(Boolean)
      .join('\n\n');

    // 3. Build simple prompt with 3 elements (natural language like ChatGPT)
    const userPrompt = `Please create the perfect workflow steps using these three elements:

**Enhanced Prompt (user requirements):**
${JSON.stringify(enhanced_prompt, null, 2)}

**Plugin Schemas (available actions - use the closest matching actions for the task):**
${pluginSchemasText}

**PILOT DSL Schema (structure to follow):**
${JSON.stringify(PILOT_DSL_SCHEMA, null, 2)}

Create a complete workflow that:
- Implements the exact requirements from the Enhanced Prompt
- Uses the workflow patterns from the DSL schema (loop, conditional, transform, action types)
- Use descriptive step IDs (e.g., "search_emails", "extract_pdfs") that clearly indicate what each step does
- This is critical to avoid data lose between steps. All data passed between steps must be explicitly referenced via the producing step's ID and concrete output path; do not infer, shortcut, or reuse data unless it is formally emitted by a prior step in the workflow graph
- IMPORTANT: Steps nested inside scatter_gather or loop blocks can ONLY reference:
  1) The iterator variable (e.g., {{pdf.field}} when itemVariable is "pdf")
  2) Previous top-level steps (steps that come BEFORE the scatter/loop parent)
  3) Other nested steps within the SAME scatter/loop block
  They CANNOT reference steps that come AFTER their parent scatter/loop block.
- CRITICAL DATA FLOW RULE: When referencing another step's output (using {{step_id.field}}), that step MUST have already executed. You can ONLY reference:
  1) Steps that appear BEFORE the current step in the workflow_steps array
  2) Within scatter/loop nested steps: the iterator variable OR other nested steps in the SAME block
  3) NEVER reference a step that comes AFTER the current step - data flows forward only!
  Example: If workflow_steps array is [search_emails, extract_pdfs, process_pdfs, send_email], then "process_pdfs" can reference {{search_emails.emails}} and {{extract_pdfs.pdfs}} but NOT {{send_email.result}}
- Chooses appropriate plugin actions that match the intent (even if names don't match exactly)

Output valid JSON with this structure:
{
  "agent_name": "...",
  "description": "...",
  "system_prompt": "...",
  "workflow_type": "ai_external_actions",
  "suggested_plugins": [...],
  "required_inputs": [],
  "workflow_steps": [...],
  "suggested_outputs": [...],
  "reasoning": "...",
  "confidence": 0.95
}`;

    console.log('[TEST-DIRECT] Calling LLM...');
    console.log('[TEST-DIRECT] Prompt length:', userPrompt.length);

    // ONE LLM call with gpt-5.2
    const completion = await openai.chat.completions.create({
      model: 'gpt-5.2',
      messages: [
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' }
    });

    const response = completion.choices[0]?.message?.content;
    if (!response) {
      throw new Error('No response from OpenAI');
    }

    console.log('[TEST-DIRECT] ✅ Got response from LLM');

    const generatedWorkflow = JSON.parse(response);

    // Apply V6-style post-processing to make workflow executable
    let workflow = generatedWorkflow.workflow_steps;

    // Log original step IDs before renumbering
    console.log('[TEST-DIRECT] Original step IDs from LLM:');
    workflow.forEach((step: any) => {
      console.log(`  Top-level: ${step.id}`);
      if (step.loopSteps) {
        step.loopSteps.forEach((nested: any) => {
          console.log(`    Nested in ${step.id}: ${nested.id}`);
        });
      }
    });

    // 1. Renumber steps sequentially (do this FIRST to get consistent IDs)
    console.log('[TEST-DIRECT] Renumbering steps...');

    // Debug: Dump a sample loop step BEFORE renumbering
    const sampleLoopBefore = workflow.find((s: any) => s.loopSteps);
    if (sampleLoopBefore) {
      console.log('[DEBUG] Sample loop step BEFORE renumbering:');
      console.log(JSON.stringify(sampleLoopBefore, null, 2).substring(0, 2000));
    }

    workflow = renumberSteps(workflow);

    // Debug: Dump the same loop step AFTER renumbering
    const sampleLoopAfter = workflow.find((s: any) => s.loopSteps);
    if (sampleLoopAfter) {
      console.log('[DEBUG] Sample loop step AFTER renumbering:');
      console.log(JSON.stringify(sampleLoopAfter, null, 2).substring(0, 2000));
    }

    // 2. Fix forward references (detect and auto-correct references to future steps)
    console.log('[TEST-DIRECT] Fixing forward references...');
    workflow = fixForwardReferences(workflow);

    // 3. Fix variable references (unwrap plugin outputs, now using new step IDs)
    console.log('[TEST-DIRECT] Fixing variable references...');
    workflow = fixVariableReferences(workflow, availablePlugins);

    // 4. Post-validation and auto-fix
    console.log('[TEST-DIRECT] Running post-validation...');
    const postValidator = new WorkflowPostValidator(availablePlugins);
    const postValidation = postValidator.validate({ workflow }, true); // autoFix=true

    let finalWorkflow = generatedWorkflow;
    finalWorkflow.workflow_steps = workflow;

    if (postValidation.autoFixed && postValidation.fixedWorkflow) {
      console.log('[TEST-DIRECT] ✅ Auto-fixed workflow issues:',
        postValidation.issues.filter(i => i.autoFixable).map(i => i.code));
      finalWorkflow.workflow_steps = postValidation.fixedWorkflow.workflow;
    }

    // Log validation issues
    if (postValidation.issues.length > 0) {
      console.warn('[TEST-DIRECT] ⚠️ Post-validation issues found:');
      postValidation.issues.forEach(issue => {
        console.warn(`  [${issue.severity.toUpperCase()}] ${issue.stepId}: ${issue.code} - ${issue.message}`);
      });
    }

    return NextResponse.json({
      success: true,
      workflow: finalWorkflow,
      validation: {
        valid: postValidation.valid,
        issues: postValidation.issues,
        autoFixed: postValidation.autoFixed,
        issueCount: postValidation.issues.length
      },
      method: 'direct_generation',
      model: 'gpt-5.2',
      prompt_length: userPrompt.length,
      services_used: servicesInvolved,
      debug: {
        original_workflow_step_count: generatedWorkflow.workflow_steps?.length || 0,
        final_workflow_step_count: finalWorkflow.workflow_steps?.length || 0
      }
    });

  } catch (error: any) {
    console.error('[TEST-DIRECT] ❌ Error:', error);
    return NextResponse.json(
      {
        error: error.message,
        stack: error.stack
      },
      { status: 500 }
    );
  }
}

