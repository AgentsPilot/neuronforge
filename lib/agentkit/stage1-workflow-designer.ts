/**
 * Stage 1: Workflow Designer
 *
 * Uses Claude Sonnet 4 to design workflow structure
 *
 * Focus: High-level workflow design with PERFECT structure
 * - Intent analysis
 * - Plugin selection
 * - Step sequencing
 * - Conditional logic
 * - Loop structures
 * - Variable flow with {{input.X}} and {{stepN.field}} references
 *
 * Output: Structured workflow with {{input.X}} references for user inputs
 * Next: Stage 2 scans for {{input.X}} references and builds input schema
 *
 * Cost: ~$0.012 per generation (Claude Sonnet 4 with optimized prompts)
 * Latency: 2-4s
 * Success Rate Target: 95%+ on simple, 90%+ on complex workflows
 */

import Anthropic from '@anthropic-ai/sdk';
import { PILOT_DSL_SCHEMA } from '../pilot/schema/pilot-dsl-schema';
import { PluginManagerV2 } from '../server/plugin-manager-v2';

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY,
});

/**
 * Stage 1 Output: Workflow structure with parameter placeholders
 */
export interface Stage1WorkflowDesign {
  // Basic agent info
  agent_name: string;
  agent_description: string;
  workflow_type: 'simple_linear' | 'conditional' | 'loop' | 'parallel' | 'complex';

  // Workflow structure
  workflow_steps: Stage1WorkflowStep[];

  // Required inputs (with placeholders)
  required_inputs: Stage1RequiredInput[];

  // Suggested plugins
  suggested_plugins: string[];

  // Confidence score
  confidence: number;

  // Reasoning
  reasoning: string;

  // Metadata
  tokensUsed?: {
    input: number;
    output: number;
  };
}

/**
 * Stage 1 Workflow Step
 * Parameters use {{input.X}} or {{stepN.field}} references (NOT placeholders)
 */
export interface Stage1WorkflowStep {
  id: string;
  name: string; // Human-readable name (REQUIRED)
  type: string;
  plugin?: string;
  action?: string; // Action name (for type="action")
  params?: Record<string, any>; // Values are {{input.X}} or {{stepN.field}} or literals
  operation?: string; // For transform steps
  input?: string; // For transform steps
  config?: any; // For transform steps
  condition?: any;
  title?: string;
  next?: string;
  on_success?: string;
  on_failure?: string;
  loopSteps?: Stage1WorkflowStep[]; // Nested steps for loops
  maxIterations?: number; // Safety limit for loops
  iterateOver?: string; // Variable reference for loops
}

/**
 * Stage 1 Required Input
 * Basic structure, no validation rules yet
 */
export interface Stage1RequiredInput {
  name: string;
  type: 'text' | 'number' | 'email' | 'url' | 'select' | 'multi_select' | 'file' | 'json';
  label: string;
  required: boolean;
  description: string;
  reasoning: string;
}

/**
 * Stage 1: Design workflow structure using Claude Sonnet 4 with strict mode
 */
export async function designWorkflowStructure(
  userId: string,
  userPrompt: string,
  connectedPlugins: string[]
): Promise<Stage1WorkflowDesign> {

  console.log('🎨 [Stage 1] Designing workflow structure with Claude Sonnet 4...');

  // Get CONDENSED plugin summaries for token optimization (73% reduction)
  // Full definitions: ~1,500 tokens → Summaries: ~400 tokens
  const pluginManager = await PluginManagerV2.getInstance();
  const pluginSummaries = pluginManager.getPluginSummariesForStage1(connectedPlugins);

  console.log(`📊 [Stage 1] Using ${Object.keys(pluginSummaries).length} plugin summaries (token optimized)`);

  // Build system prompt for Stage 1
  const systemPrompt = buildStage1SystemPrompt(pluginSummaries);

  // Build user message
  const userMessage = `Design a workflow for the following task:\n\n${userPrompt}\n\nAvailable plugins: ${connectedPlugins.join(', ')}`;

  try {
    console.log('🔄 [Stage 1] Calling Claude Sonnet 4 API...');

    // Create timeout promise (60 seconds)
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Stage 1 API timeout after 60 seconds')), 60000);
    });

    // Call Claude Sonnet 4 with STRICT mode
    const responsePromise = anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      temperature: 0.3, // Low temperature for consistency
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: userMessage
        }
      ],
      tools: [
        {
          name: 'workflow_designer',
          description: 'Design a workflow structure with parameter placeholders',
          input_schema: buildStage1ToolSchema()
        }
      ],
      tool_choice: {
        type: 'tool',
        name: 'workflow_designer'
      }
    });

    // Race between API call and timeout
    const response = await Promise.race([responsePromise, timeoutPromise]) as Anthropic.Message;

    // Extract tool use from response
    const toolUse = response.content.find((block): block is Anthropic.ToolUseBlock =>
      block.type === 'tool_use' && block.name === 'workflow_designer'
    );

    if (!toolUse) {
      throw new Error('No workflow design returned from Claude');
    }

    const design = toolUse.input as any;

    // Add token usage
    const tokensUsed = {
      input: response.usage.input_tokens,
      output: response.usage.output_tokens
    };

    console.log('✅ [Stage 1] Workflow structure designed:', {
      name: design.agent_name,
      type: design.workflow_type,
      steps: design.workflow_steps?.length || 0,
      inputs: design.required_inputs?.length || 0,
      tokens: tokensUsed
    });

    // Ensure required fields exist (defensive programming)
    return {
      ...design,
      workflow_steps: design.workflow_steps || [],
      required_inputs: design.required_inputs || [],
      suggested_plugins: design.suggested_plugins || [],
      tokensUsed
    };

  } catch (error: any) {
    console.error('❌ [Stage 1] Workflow design failed:', error.message);
    throw new Error(`Stage 1 workflow design failed: ${error.message}`);
  }
}

/**
 * Build Stage 1 system prompt
 * Focus: Workflow structure, plugin selection, step sequencing
 */
function buildStage1SystemPrompt(availablePlugins: Record<string, any>): string {
  return `You are a workflow structure designer. Your job is to design the HIGH-LEVEL STRUCTURE of a workflow.

**IMPORTANT RULES:**

1. **FOCUS ON STRUCTURE, NOT VALUES**
   - Design the step sequence, conditionals, loops
   - Select appropriate plugins and actions
   - Use PLACEHOLDERS for all parameter values
   - Example: Use "$USER_EMAIL" instead of actual email

2. **PARAMETER PLACEHOLDERS**
   - ALL parameter values MUST be placeholders starting with $
   - Use descriptive names: "$SEARCH_QUERY", "$EMAIL_ADDRESS", "$SPREADSHEET_ID"
   - Do NOT guess actual values
   - Stage 2 will fill in the real values

3. **WORKFLOW TYPES**
   - simple_linear: Sequential steps, no branching (1-5 steps)
   - conditional: Has if/else logic
   - loop: Iterates over data
   - parallel: Multiple independent paths
   - complex: Combinations of above (10+ steps, nested logic)

4. **AVAILABLE PLUGINS** (Condensed summaries for token optimization)
${Object.entries(availablePlugins).map(([key, plugin]) => {
  const actionsList = plugin.actions.map((action: any) => {
    const paramStr = action.required_params.length > 0
      ? `(${action.required_params.join(', ')})`
      : '';
    const outputStr = action.output_fields && action.output_fields.length > 0
      ? ` → outputs: {${action.output_fields.join(', ')}}`
      : '';
    return `${action.name}${paramStr}: ${action.description}${outputStr}`;
  }).join('\n     - ');
  return `   - ${key}: ${plugin.description}\n     - ${actionsList}`;
}).join('\n')}

5. **CORE PRINCIPLE: NEVER GUESS - ALWAYS ASK**

   When designing workflows:
   1. **Analyze output_fields type hints** from plugin actions (see section 4)
   2. **If data structure is ambiguous or user needs to specify a field/column** → Create {{input.X}} placeholder and add to required_inputs
   3. **If user needs to specify which field/column to use** → Always ask via {{input.field_name}} or {{input.column_name}}
   4. **Never hardcode field names** unless they're explicitly documented in the plugin's output_fields

   Examples:
   - ❌ BAD: "field": "Sales Person" (assumes field exists in data)
   - ✅ GOOD: "field": "{{input.column_name}}" (asks user which column via required_inputs)

6. **DATA STRUCTURE PATTERNS** (from output_fields type hints)

   When you see these type hints in plugin output_fields:

   **Pattern A: array<array> (2D Arrays - Table Data)**
   - **Example**: google-sheets.read_sheet → outputs: {values:array<array>, row_count:integer}
   - **What it is**: Rows and columns like [["Header1", "Header2"], ["Data1", "Data2"]]
   - **How to access**: By row and column index, or lookup by header name
   - **What to ask user**: "Which column?" → {{input.column_name}}
   - **How to use**: Create transform step with column lookup helper

   Example workflow for 2D array:
   {
     "type": "action",
     "plugin": "google-sheets",
     "action": "read_sheet",
     "params": { "spreadsheet_id": "{{input.spreadsheet_id}}", "range": "{{input.sheet_name}}" }
   },
   {
     "type": "transform",
     "operation": "deduplicate",
     "input": "{{step1.values}}",
     "config": { "column": "{{input.column_name}}" }  // User provides column name like "Sales Person"
   }

   **Pattern B: array<object> (Record Arrays - Structured Data)**
   - **Example**: airtable.list_records → outputs: {records:array<object>, record_count:integer}
   - **Example**: gmail.search_emails → outputs: {emails:array<object>, total_found:integer}
   - **What it is**: Array of objects like [{fields: {Name: "John", Email: "..."}}, ...]
   - **How to access**: Dot notation {{item.fields.FieldName}} or bracket {{item['fields']['Field Name']}}
   - **What to ask user**: "Which field name?" → {{input.field_name}}
   - **How to use**: Loop with {{loop.item.fields[input.field_name]}}

   Example workflow for array<object>:
   {
     "type": "action",
     "plugin": "airtable",
     "action": "list_records",
     "params": { "base_id": "{{input.base_id}}", "table_name": "{{input.table_name}}" }
   },
   {
     "type": "loop",
     "iterateOver": "{{step1.records}}",
     "loopSteps": [{
       "type": "conditional",
       "condition": {
         "field": "loop.item.fields[{{input.field_name}}]",  // User specifies which field
         "operator": "==",
         "value": "{{input.field_value}}"
       }
     }]
   }

   **Pattern C: object (Single Result - Simple Data)**
   - **Example**: chatgpt-research.research_topic → outputs: {summary:string, key_points:array<string>, sources:array<object>}
   - **What it is**: Single object with fixed fields like {summary: "...", key_points: [...]}
   - **How to access**: Direct reference {{step1.summary}}, {{step1.key_points}}
   - **What to ask user**: Nothing about structure - use documented field names directly
   - **How to use**: Reference fields by name from output_fields

   Example workflow for simple object:
   {
     "type": "action",
     "plugin": "chatgpt-research",
     "action": "research_topic",
     "params": { "topic": "{{input.research_topic}}", "depth": "standard" }
   },
   {
     "type": "action",
     "plugin": "google-mail",
     "action": "send_email",
     "params": {
       "recipients": { "to": ["{{input.recipient_email}}"] },
       "content": {
         "subject": "Research Results",
         "body": "{{step1.summary}}"  // Direct field access - no user input needed
       }
     }
   }

   **Pattern D: Nested object with arrays (Complex Responses)**
   - **Example**: hubspot.search_contacts → outputs: {data:object, total_count:integer}
   - **What it is**: Nested structure like {data: {contacts: [{properties: {...}}]}}
   - **How to access**: Path navigation {{step1.data.contacts}}
   - **What to ask user**: Depends on what they need from nested structure
   - **How to use**: Check plugin's sample_output for exact structure

7. **STEP TYPES**
   - action: Call a plugin action (Gmail, Slack, Sheets, etc.) - use "plugin" and "action" fields
   - ai_processing: Use AI to analyze/transform data
   - llm_decision: LLM makes a decision
   - conditional: If/else logic (use trueBranch/falseBranch to jump to specific steps)
   - loop: Iterate over items - use "loopSteps" array for nested steps
   - parallel_group: Run multiple steps in parallel
   - switch: Multi-way branching
   - scatter_gather: Split work and gather results
   - transform: Transform data structure
   - delay: Wait for time period
   - enrichment: Enrich data with additional info
   - validation: Validate data
   - comparison: Compare values
   - sub_workflow: Call another workflow
   - human_approval: Wait for human input

6. **CONDITIONAL EXECUTION PATTERNS**

   **Pattern 1: Branching with 'conditional' step type** (use for if/else with different step sequences)
   {
     "type": "conditional",
     "condition": { "field": "step2.data.items.length", "operator": ">", "value": 0, "conditionType": "simple" },
     "trueBranch": "step4",   // Jump to step4 if true
     "falseBranch": "step8"   // Jump to step8 if false
   }

   **Pattern 2: Skip step with 'executeIf' field** (use to conditionally skip individual steps)
   {
     "type": "action",
     "action": "send_email",
     "executeIf": { "field": "step2.data.items.length", "operator": "==", "value": 0, "conditionType": "simple" },
     "params": { ... }
   }
   // Step only executes if condition is true, otherwise skipped

   ⚠️ **CRITICAL**: When using trueBranch/falseBranch, steps after the branch are STILL EXECUTED unless you use executeIf!

   Example problem:
   Step 3: conditional (trueBranch: step4, falseBranch: step8)
   Step 4-7: Process qualified leads
   Step 8: Send "no leads" email

   ❌ WRONG: Step 8 runs even when leads exist (workflow continues sequentially)
   ✅ CORRECT: Add executeIf to step 8 to only run when no leads:
   {
     "id": "step8",
     "executeIf": { "field": "step2.data.items.length", "operator": "==", "value": 0, "conditionType": "simple" }
   }

**CRITICAL: Loop vs Batch Processing Rules**

⚠️ **NEVER put ai_processing inside a loop!** This causes massive token waste.

❌ BAD (100 LLM calls):
loop over customers → ai_processing (extract data) → done

✅ GOOD (1 LLM call):
get all customers → ai_processing (extract ALL at once) → transform results

**When to use loops:**
- Simple data transformations (NO AI inside)
- Plugin actions that must be done individually (e.g., create_task per customer)
- Small datasets (<10 items)

**When to use batch processing (scatter_gather or ai_processing with arrays):**
- AI analysis of multiple items (extract, summarize, classify)
- Data aggregation across many items
- Large datasets (>10 items)

**Example: Processing 100 customer folders**

❌ WRONG Architecture (400 LLM calls):
  loop over 100 folders:
    - ai_processing: extract customer data from PDF
    - ai_processing: summarize emails
    - ai_processing: classify package mismatch
    - ai_processing: check for urgent issues

✅ CORRECT Architecture (4 LLM calls):
  1. action: get all folders (100 folders)
  2. action: get all PDFs from folders (batch)
  3. ai_processing: extract customer data from ALL PDFs at once (1 call, returns array)
  4. action: search emails for ALL customers (batch)
  5. ai_processing: summarize ALL email threads at once (1 call, returns array)
  6. action: lookup ALL customers in sheet (batch)
  7. transform: compare packages for all (pure data)
  8. ai_processing: classify ALL mismatches at once (1 call, returns array)
  9. loop over classification results:
       conditional: check mismatch type
         - action: create_task (must be individual)
         - action: create_deal (must be individual)
  10. ai_processing: generate final report from ALL results (1 call)
  11. action: send email

6. **CONDITIONALS**
   Use these condition formats with conditionType discriminator (DSL schema format):
   - Simple: { conditionType: "simple", field: "step1.status", operator: "==", value: "success" }
   - Complex AND: { conditionType: "complex_and", conditions: [{ conditionType: "simple", field: "...", operator: "...", value: "..." }, {...}] }
   - Complex OR: { conditionType: "complex_or", conditions: [{ conditionType: "simple", field: "...", operator: "...", value: "..." }, {...}] }
   - Complex NOT: { conditionType: "complex_not", condition: { conditionType: "simple", field: "...", operator: "...", value: "..." } }

   **Operators**: ==, !=, >, <, >=, <=, contains, startsWith, endsWith, exists, not_exists, in, not_in, is_empty, is_not_empty

7. **VARIABLE REFERENCES**
   - Input variables: {{input.field_name}} - values from user
   - Step output: {{step1.data.field}} - output from step1
   - Previous step: {{prev.data}} - output from last step
   - Loop current item: {{loop.item.field}} - current iteration item
   - Loop index: {{loop.index}} - current iteration number (0-based)

   **IMPORTANT: Variable Reference Syntax Rules:**

   **1. Step outputs** (from action steps):
   - Simple fields: {{step1.fieldName}} or {{step1.data.fieldName}}
   - Fields with dashes/spaces: {{step1['field-name']}} or {{step1.data['field with spaces']}}
   - Nested paths: {{step1.data.contacts[0].email}}

   **2. Loop items**:
   - For objects: {{loop.item.fieldName}} or {{loop.item['field with spaces']}}
   - For arrays: {{loop.item[0]}} (by index)
   - For 2D arrays: {{loop.item[column_index]}} where column_index comes from user input
   - Loop index: {{loop.index}} (0-based iteration number)

   **3. User inputs** (from required_inputs):
   - {{input.fieldName}} - Always use camelCase for input field names
   - Example: {{input.columnName}}, {{input.spreadsheetId}}, {{input.recipientEmail}}

   **4. Dynamic field access** (when user specifies field/column name):
   - For 2D arrays: Use transform operation with column lookup (don't use bracket notation directly)
   - For objects: {{loop.item.fields[{{input.fieldName}}]}} (nested bracket notation)

   **KEY RULE**: Only use bracket notation for:
   - Fields with spaces/dashes/special characters (e.g., {{item['Sales Person']}})
   - Dynamic index access (e.g., {{item[{{input.columnIndex}}]}})
   - NOT for assuming field names exist in data without checking output_fields

   **CRITICAL: ai_processing step outputs**
   ai_processing and llm_decision steps return data in {{stepN.data.result}} format:
   - {{stepN.data.result}} - ALWAYS works (use this as default)
   - {{stepN.data.response}} - also works (alias)
   - {{stepN.data.output}} - also works (alias)
   - {{stepN.data.summary}} - for summarization tasks
   - {{stepN.data.analysis}} - for analysis tasks

   ❌ WRONG: {{step3.html_table}} (field doesn't exist)
   ✅ CORRECT: {{step3.data.result}} (always use .data.result for ai_processing)

   **CRITICAL: Action (plugin) step outputs**
   Action steps return data based on the plugin's output_fields (see section 4 for each plugin).
   ALWAYS use the exact field names from the plugin's "outputs:" specification.

   Examples:
   - chatgpt-research.research_topic → outputs: {summary, key_points, sources, source_count}
     ✅ CORRECT: {{step1.data.summary}} (the comprehensive research text)
     ✅ CORRECT: {{step1.data.key_points}} (array of key findings)
     ❌ WRONG: {{step1.data.results}} (this field doesn't exist)
     ❌ WRONG: {{step1.data.result}} (this is for ai_processing only)

   - google-sheets.read_sheet → outputs: {rows, headers, row_count}
     ✅ CORRECT: {{step1.data.rows}} (array of row data)
     ❌ WRONG: {{step1.data.data}} (this field doesn't exist)

   **Rule: ALWAYS check the plugin's output_fields before referencing a step!**

   🚨 **CRITICAL RULES - THESE WILL CAUSE VALIDATION FAILURES:**

   ❌ **NEVER EVER use $PLACEHOLDER format** like $EMAIL, $QUERY, $SPREADSHEET_ID, $VALUE
      This format is FORBIDDEN and will cause immediate validation failure!

      **INSTEAD: Always use the two-step process:**

      STEP 1: Add user-provided values to required_inputs array:
        - name: "spreadsheet_id", type: "text", label: "Spreadsheet ID", required: true
        - name: "upgrade_value", type: "text", label: "Upgrade Value", required: true

      STEP 2: Reference in workflow using {{input.field_name}}:
        - ❌ WRONG: "spreadsheet_id": "$SPREADSHEET_ID"
        - ✅ CORRECT: "spreadsheet_id": "{{input.spreadsheet_id}}"
        - ❌ WRONG: "value": "$UPGRADE_VALUE"
        - ✅ CORRECT: "value": "{{input.upgrade_value}}"

   ❌ **NEVER use next="end" or any non-existent step IDs**
      The workflow ends automatically after the last step. Do NOT add next="end".

   ✅ ALWAYS add user-provided values to required_inputs first
   ✅ ALWAYS use {{input.field_name}} to reference required_inputs
   ✅ ALWAYS use {{stepN.data.result}} for ai_processing outputs
   ✅ ALWAYS use {{stepN.data.<exact_field_name>}} for action step outputs (check output_fields!)
   ✅ Use literals only for hardcoded constants
   ✅ next/on_success/on_failure must reference actual step IDs or be omitted

8. **COMPLETE WORKFLOW EXAMPLE: Customer Onboarding Audit (10 Steps)**

   This example demonstrates ALL key patterns: batch AI processing, conditionals, scatter-gather, transforms, and correct variable references.

   **USER REQUEST:** "Audit our customer onboarding process: research best practices, analyze our current docs, identify gaps, create tasks for each gap, and send me a comprehensive report"

   **GENERATED WORKFLOW:**

   [
     {
       "id": "step1",
       "type": "action",
       "plugin": "chatgpt-research",
       "action": "research_topic",
       "params": {
         "topic": "customer onboarding best practices SaaS 2024",
         "depth": "comprehensive"
       }
     },
     {
       "id": "step2",
       "type": "action",
       "plugin": "google-drive",
       "action": "list_files",
       "params": {
         "folder_name": "Onboarding Documentation",
         "file_type": "all"
       }
     },
     {
       "id": "step3",
       "type": "ai_processing",
       "input": "{{step1.data.summary}}",
       "prompt": "Extract the top 10 best practices from this research as a structured list with: practice_name, description, priority (high/medium/low)"
     },
     {
       "id": "step4",
       "type": "scatter_gather",
       "scatter": {
         "input": "{{step2.data.files}}",
         "steps": [
           {
             "id": "read_doc",
             "type": "action",
             "plugin": "google-drive",
             "action": "read_file",
             "params": {
               "file_id": "{{item.id}}"
             }
           },
           {
             "id": "analyze_doc",
             "type": "ai_processing",
             "input": "{{read_doc.data.content}}",
             "prompt": "Analyze this onboarding document. Extract: topics_covered (array), quality_score (1-10), gaps (array of missing elements)"
           }
         ],
         "maxConcurrency": 3,
         "itemVariable": "item"
       },
       "gather": {
         "operation": "collect",
         "outputKey": "all_analyses"
       }
     },
     {
       "id": "step5",
       "type": "ai_processing",
       "input": "Best Practices: {{step3.data.result}}\n\nCurrent Documentation Analysis: {{step4.data.all_analyses}}",
       "prompt": "Compare best practices against our current documentation. For EACH best practice, identify if it's: covered (yes/no), gap_severity (critical/high/medium/low), recommended_action. Return as structured array."
     },
     {
       "id": "step6",
       "type": "transform",
       "operation": "filter",
       "input": "{{step5.data.result}}",
       "config": {
         "condition": "item.covered === false && (item.gap_severity === 'critical' || item.gap_severity === 'high')"
       }
     },
     {
       "id": "step7",
       "type": "conditional",
       "condition": {
         "conditionType": "complex_and",
         "conditions": [
           {
             "conditionType": "simple",
             "field": "step6.data.items.length",
             "operator": ">",
             "value": "0"
           },
           {
             "conditionType": "simple",
             "field": "step6.status",
             "operator": "==",
             "value": "success"
           }
         ]
       },
       "then_step": "step8",
       "else_step": "step10"
     },
     {
       "id": "step8",
       "type": "loop",
       "iterateOver": "{{step6.data.items}}",
       "loopSteps": [
         {
           "id": "create_gap_task",
           "type": "action",
           "plugin": "linear",
           "action": "create_issue",
           "params": {
             "title": "Onboarding Gap: {{loop.item.practice_name}}",
             "description": "Gap Severity: {{loop.item.gap_severity}}\n\nRecommended Action: {{loop.item.recommended_action}}",
             "priority": "{{loop.item.gap_severity}}"
           }
         }
       ],
       "maxIterations": 50
     },
     {
       "id": "step9",
       "type": "ai_processing",
       "input": "{{step8.data.results}}",
       "prompt": "Summarize all created tasks: total count, breakdown by severity, estimated effort"
     },
     {
       "id": "step10",
       "type": "ai_processing",
       "input": "Research: {{step1.data.summary}}\n\nBest Practices: {{step3.data.result}}\n\nGap Analysis: {{step5.data.result}}\n\nCritical Gaps: {{step6.data.items}}\n\nTasks Created: {{step9.data.result}}",
       "prompt": "Generate comprehensive executive summary report in HTML format with sections: 1) Research Findings, 2) Current State Assessment, 3) Gap Analysis, 4) Action Items Created, 5) Recommendations"
     },
     {
       "id": "step11",
       "type": "action",
       "plugin": "gmail",
       "action": "send_email",
       "params": {
         "to": "{{input.user_email}}",
         "subject": "Customer Onboarding Audit - Complete Report",
         "html_body": "{{step10.data.result}}"
       }
     }
   ]

   **KEY PATTERNS DEMONSTRATED:**

   ✅ **Batch AI Processing (NOT loops!):**
   - step3: Process ALL best practices in ONE ai_processing call
   - step5: Compare ALL practices vs ALL docs in ONE ai_processing call
   - step10: Aggregate ALL data into ONE comprehensive report

   ✅ **Scatter-Gather Pattern (step4):**
   - Scatter over files array ({{step2.data.files}})
   - Execute 2 sub-steps for each file (read + analyze)
   - Gather results into {{step4.data.all_analyses}}
   - Use maxConcurrency: 3 for performance
   - Reference current item with {{item.id}} (itemVariable: "item")

   ✅ **Correct Variable References:**
   - Action step output: {{step1.data.summary}} (exact field from output_fields)
   - ai_processing output: {{step3.data.result}} (always .data.result)
   - Transform output: {{step6.data.items}} (filtered array)
   - Loop item: {{loop.item.practice_name}} (current iteration)
   - Input variable: {{input.user_email}} (user-provided)

   ✅ **Conditionals with conditionType:**
   - step7: Uses conditionType: "complex_and"
   - Checks array length AND step status
   - Routes to step8 (tasks) or step10 (report)

   ✅ **Loop for Individual Actions (step8):**
   - Loops over critical gaps only
   - Creates ONE Linear task per gap (must be individual)
   - References loop item: {{loop.item.practice_name}}

   ✅ **Transform for Filtering (step6):**
   - operation: "filter"
   - input: {{step5.data.result}}
   - config.condition: JavaScript expression

   ❌ **WRONG PATTERNS TO AVOID:**
   - **CRITICAL**: NEVER put AI steps (ai_processing, llm_decision, summarize, extract, generate) inside loops!
     AI is EXPENSIVE ($$$) and must process items in BATCH, not one-by-one.
     ✅ Correct: Single ai_processing step BEFORE loop that processes all items
     ❌ Wrong: ai_processing step INSIDE loop (costs multiply by item count!)
   - Guessing field names: {{step1.data.results}} (check output_fields!)
   - Missing conditionType in conditionals
   - Using $PLACEHOLDER format instead of {{input.field}}

9. **CRITICAL FIELD STRUCTURES**

   **Action steps** - Parameters in nested params object:
   {
     "type": "action",
     "plugin": "google-mail",
     "action": "send_email",
     "params": {
       "recipients": { "to": ["{{input.recipient_email}}"] },
       "content": { "subject": "Hello" }
     }
   }

   **ai_processing steps** - Use input and prompt fields:
   {
     "type": "ai_processing",
     "name": "Generate HTML Report",
     "input": "{{step1.data.summary}}",  // ✅ Use exact field from plugin's output_fields
     "prompt": "Convert the research summary into an HTML table..."
   }
   // Output: Access via {{step2.data.result}} NOT {{step2.html_table}}

   **Transform steps** - Fields at TOP LEVEL (no params):
   {
     "type": "transform",
     "operation": "filter",
     "input": "{{step1.data.items}}",
     "config": {
       "condition": { "field": "status", "operator": "==", "value": "{{input.target_status}}" }
     }
   }

   **Loop steps** - Use {{loop.item.X}} for current item:
   {
     "type": "loop",
     "iterateOver": "{{step2.data.customers}}",
     "maxIterations": 100,
     "loopSteps": [
       {
         "type": "action",  // ✅ Only actions, conditionals, transforms in loops
         "plugin": "google-mail",
         "action": "send_email",
         "params": {
           "recipients": { "to": ["{{loop.item.email}}"] },
           "content": { "subject": "Hello {{loop.item.name}}" }
         }
       }
     ]
   }

   **🚨 CRITICAL EXAMPLE - Sending personalized emails (BATCH vs LOOP):**

   ❌ WRONG - AI inside loop (expensive!):
   Step 1: Filter leads → {{step1.data.items}} (5 items)
   Step 2: Loop over leads {
     Step 2a: ai_processing "Generate email for {{loop.item}}"  // ❌ AI called 5 times! Costs $$$
     Step 2b: send_email
   }

   ✅ CORRECT - AI processes batch, loop uses enriched data:
   Step 1: Filter leads → {{step1.data.items}} (5 items: [{name, email, score}, ...])
   Step 2: ai_processing "Generate personalized email content for these 5 leads: {{step1.data.items}}"
          → Returns: {enriched_items: [{name, email, score, email_content}, ...]}
   Step 3: Loop over {{step2.data.enriched_items}} {
     Step 3a: send_email to {{loop.item.email}} with content: {{loop.item.email_content}}  // ✅ AI called once!
   }

   **KEY PATTERN**: AI step enriches the array with new fields, then loop uses {{loop.item.X}} to access them.
   ⚠️ NOTE: System does NOT support variable array indexing like {{array[loop.index]}} - only literals like {{array[0]}}

   **COMPLETE EXAMPLE - Email with AI-generated content:**
   Step 1 (action): chatgpt-research.research_topic → outputs: {summary, key_points, sources, source_count}
   Step 2 (ai_processing): "Generate HTML", input: "{{step1.data.summary}}" → output: {{step2.data.result}}
   Step 3 (action): send_email with html_body: "{{step2.data.result}}" ✅

   WRONG examples:
   - Step 1 output: "{{step1.data.results}}" ❌ (field doesn't exist, should be .summary)
   - Step 2 output: "{{step2.html_content}}" ❌ (field doesn't exist, should be .data.result)

9. **QUALITY CHECKLIST**
   ✓ Every step has id, type, AND name fields
   ✓ Use type="action" for plugin calls (NOT "plugin_action")
   ✓ Action steps: params is nested object
   ✓ Transform steps: operation/input/config at TOP LEVEL (no params)
   ✓ Loop steps use "loopSteps" array with {{loop.item.X}} syntax
   ✓ 🚨 **Use bracket notation ['...'] for field names with spaces or special characters**
   ✓ NO ai_processing steps inside loops (use batch processing instead)
   ✓ AI processes arrays in single calls, not loops
   ✓ 🚨 **NO $PLACEHOLDER format anywhere** (use required_inputs + {{input.field_name}})
   ✓ 🚨 **All user values added to required_inputs array FIRST**
   ✓ Use {{input.field_name}} for user inputs (NEVER $PLACEHOLDER)
   ✓ Use {{stepN.data.result}} for ai_processing outputs (NOT custom field names)
   ✓ **CRITICAL: Check plugin's output_fields in section 4 before referencing action steps!**
   ✓ Use exact field names from output_fields (e.g., .summary not .results)
   ✓ Steps are in logical order
   ✓ All plugins exist in available list
   ✓ Conditionals use correct {field, operator, value} format
   ✓ Loops have maxIterations safeguard
   ✓ 🚨 **NO next="end"** - workflow ends automatically after last step
   ✓ next/on_success/on_failure only reference actual step IDs

**YOUR OUTPUT:**
Return a complete workflow design using the workflow_designer tool.
Be thorough but concise. Focus on structure correctness.`;
}

/**
 * Build Stage 1 tool schema for Claude
 * This is the structure validation schema
 */
function buildStage1ToolSchema(): any {
  return {
    type: 'object',
    required: [
      'agent_name',
      'agent_description',
      'workflow_type',
      'workflow_steps',
      'required_inputs',
      'suggested_plugins',
      'confidence',
      'reasoning'
    ],
    properties: {
      agent_name: {
        type: 'string',
        description: 'Clear, descriptive agent name (e.g., "Gmail to Sheets Sync", "Daily Report Generator")'
      },
      agent_description: {
        type: 'string',
        description: 'Detailed description of what the agent does and how it works'
      },
      workflow_type: {
        type: 'string',
        enum: ['simple_linear', 'conditional', 'loop', 'parallel', 'complex'],
        description: 'Type of workflow based on complexity'
      },
      workflow_steps: {
        type: 'array',
        description: 'Array of workflow steps with {{input.X}} and {{stepN.field}} references',
        items: {
          type: 'object',
          required: ['id', 'type', 'name'],
          properties: {
            id: {
              type: 'string',
              description: 'Unique step ID (step1, step2, etc.)'
            },
            type: {
              type: 'string',
              enum: [
                'action',
                'ai_processing',
                'llm_decision',
                'conditional',
                'loop',
                'parallel_group',
                'switch',
                'scatter_gather',
                'transform',
                'delay',
                'enrichment',
                'validation',
                'comparison',
                'sub_workflow',
                'human_approval'
              ],
              description: 'Type of step (use "action" for plugin actions)'
            },
            name: {
              type: 'string',
              description: 'Human-readable name for this step (REQUIRED)'
            },
            plugin: {
              type: 'string',
              description: 'Plugin key (REQUIRED for type="action" steps)'
            },
            action: {
              type: 'string',
              description: 'Action name within plugin (REQUIRED for type="action" steps)'
            },
            params: {
              type: 'object',
              description: 'Parameters with {{input.X}} or {{stepN.field}} references or literal values. For action steps only.',
              additionalProperties: true
            },
            prompt: {
              type: 'string',
              description: 'Prompt for AI processing with variable references. REQUIRED for ai_processing/llm_decision steps. Use together with input field.'
            },
            title: {
              type: 'string',
              description: 'Human-readable step title'
            },
            condition: {
              description: 'Condition for conditional steps. Use conditionType discriminator: Simple: {conditionType: "simple", field, operator, value}. Complex AND: {conditionType: "complex_and", conditions: [...]}. Complex OR: {conditionType: "complex_or", conditions: [...]}. Complex NOT: {conditionType: "complex_not", condition: {...}}'
            },
            trueBranch: {
              type: 'string',
              description: 'Step ID to execute if condition is true (for conditional steps)'
            },
            falseBranch: {
              type: 'string',
              description: 'Step ID to execute if condition is false (for conditional steps)'
            },
            iterateOver: {
              type: 'string',
              description: 'Variable reference to iterate over (REQUIRED for loop steps, e.g., "{{step1.files}}")'
            },
            loopSteps: {
              type: 'array',
              description: 'Nested steps to execute in loop (REQUIRED for loop steps)',
              items: { type: 'object' }
            },
            maxIterations: {
              type: 'number',
              description: 'Safety limit for loop iterations (REQUIRED for loop steps)'
            },
            evaluate: {
              type: 'string',
              description: 'Expression to evaluate for switch statement (REQUIRED for switch steps)'
            },
            cases: {
              type: 'object',
              description: 'Map of case values to arrays of step IDs (REQUIRED for switch steps, e.g., {"pending": ["step2", "step3"], "active": ["step4"]})',
              additionalProperties: {
                type: 'array',
                items: { type: 'string' }
              }
            },
            defaultCase: {
              type: 'string',
              description: 'Default step ID if no cases match (for switch steps)'
            },
            scatter: {
              type: 'object',
              description: 'Scatter configuration for parallel processing (REQUIRED for scatter_gather steps)',
              properties: {
                input: { type: 'string', description: 'Array to scatter over (e.g., "{{step1.data.items}}")' },
                steps: { type: 'array', description: 'Steps to execute for each item', items: { type: 'object' } },
                maxConcurrency: { type: 'number', description: 'Max parallel executions (1-10, default 5)' },
                itemVariable: { type: 'string', description: 'Variable name for current item (default: "item")' }
              }
            },
            gather: {
              type: 'object',
              description: 'Gather configuration for scatter_gather steps (REQUIRED for scatter_gather steps)',
              properties: {
                operation: { type: 'string', description: 'Gather operation: collect, merge, reduce', enum: ['collect', 'merge', 'reduce'] },
                outputKey: { type: 'string', description: 'Key to store gathered results' },
                reduceExpression: { type: 'string', description: 'Expression for reduce operation' }
              }
            },
            operation: {
              type: 'string',
              description: 'Operation type (REQUIRED for transform/comparison steps). For transform: map, filter, reduce, sort, group, aggregate, join, match, deduplicate. For comparison: equals, deep_equals, diff, contains, subset'
            },
            input: {
              type: 'string',
              description: 'Input data reference. REQUIRED for transform steps (e.g., "{{step1.data.items}}") and ai_processing/llm_decision steps (e.g., "{{step1.data.summary}}")'
            },
            config: {
              type: 'object',
              description: 'Configuration for transform operation (REQUIRED for transform steps)',
              additionalProperties: true
            },
            left: {
              type: 'string',
              description: 'Left value for comparison (REQUIRED for comparison steps, e.g., "{{step1.count}}")'
            },
            right: {
              type: 'string',
              description: 'Right value for comparison (REQUIRED for comparison steps, e.g., "10")'
            },
            executeIf: {
              description: 'CRITICAL: Optional condition for conditional execution of ANY step type. Step only runs if this evaluates to true, otherwise skipped. Use to prevent duplicate execution when using trueBranch/falseBranch. Must use conditionType discriminator. Example: {conditionType: "simple", field: "step2.data.items.length", operator: "==", value: 0}'
            },
            next: { type: 'string', description: 'Next step ID' },
            on_success: { type: 'string', description: 'Step ID on success' },
            on_failure: { type: 'string', description: 'Step ID on failure' }
          }
        }
      },
      required_inputs: {
        type: 'array',
        description: 'Inputs needed from user at runtime',
        items: {
          type: 'object',
          required: ['name', 'type', 'label', 'required', 'description', 'reasoning'],
          properties: {
            name: {
              type: 'string',
              description: 'Input parameter name (snake_case)'
            },
            type: {
              type: 'string',
              enum: ['text', 'number', 'email', 'url', 'select', 'multi_select', 'file', 'json'],
              description: 'Input type'
            },
            label: {
              type: 'string',
              description: 'User-friendly label'
            },
            required: {
              type: 'boolean',
              description: 'Whether input is required'
            },
            description: {
              type: 'string',
              description: 'Help text for user'
            },
            reasoning: {
              type: 'string',
              description: 'Why this input is needed'
            }
          }
        }
      },
      suggested_plugins: {
        type: 'array',
        description: 'List of plugin keys used in workflow',
        items: { type: 'string' }
      },
      confidence: {
        type: 'number',
        description: 'Confidence score 0-100 for workflow design quality',
        minimum: 0,
        maximum: 100
      },
      reasoning: {
        type: 'string',
        description: 'Explanation of workflow design decisions'
      }
    }
  };
}
