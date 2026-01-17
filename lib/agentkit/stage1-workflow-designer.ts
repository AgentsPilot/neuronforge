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
import { PluginManagerV2 } from '../server/plugin-manager-v2';

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY,
});

/**
 * Stage 1 Output: Workflow structure with parameter placeholders
 * Aligned with PILOT_DSL_SCHEMA
 */
export interface Stage1WorkflowDesign {
  // Basic agent info
  agent_name: string;
  description: string;
  system_prompt: string;
  workflow_type: 'pure_ai' | 'data_retrieval_ai' | 'ai_external_actions';

  // Workflow structure
  workflow_steps: Stage1WorkflowStep[];

  // Required inputs (with placeholders)
  required_inputs: Stage1RequiredInput[];

  // Suggested plugins
  suggested_plugins: string[];

  // Suggested outputs
  suggested_outputs: Array<{
    name: string;
    type: 'SummaryBlock' | 'EmailDraft' | 'PluginAction' | 'Alert';
    category: 'human-facing' | 'machine-facing';
    description: string;
    format?: 'table' | 'list' | 'markdown' | 'html' | 'json' | 'text';
    plugin?: string;
    reasoning: string;
  }>;

  // Confidence score (0-1, aligned with PILOT_DSL_SCHEMA)
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
 * Basic structure, aligned with PILOT_DSL_SCHEMA
 */
export interface Stage1RequiredInput {
  name: string;
  type: 'text' | 'email' | 'number' | 'file' | 'select' | 'url' | 'date' | 'textarea';
  label: string;
  required: boolean;
  description: string;
  placeholder?: string;
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

  // Log full prompt for debugging
  console.log('\n' + '='.repeat(80));
  console.log('📝 [Stage 1] FULL SYSTEM PROMPT SENT TO LLM:');
  console.log('='.repeat(80));
  console.log(systemPrompt);
  console.log('='.repeat(80));
  console.log('📝 [Stage 1] USER MESSAGE:');
  console.log('='.repeat(80));
  console.log(userMessage);
  console.log('='.repeat(80) + '\n');

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
      suggested_outputs: design.suggested_outputs || [],
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
  // Build plugin list with required_params and output_fields (compressed format)
  const pluginList = Object.entries(availablePlugins).map(([key, plugin]) => {
    const actions = plugin.actions.map((action: any) => {
      const params = action.required_params?.length > 0
        ? `(${action.required_params.join(', ')})`
        : '()';
      const fields = action.output_fields?.length > 0
        ? ` → {${action.output_fields.slice(0, 3).join(', ')}${action.output_fields.length > 3 ? `, +${action.output_fields.length - 3}` : ''}}`
        : '';
      return `  • ${key}.${action.name}${params}${fields}`;
    }).join('\n');
    return `${key}: ${plugin.description}\n${actions}`;
  }).join('\n\n');

  // ========================================
  // MINIMAL EFFECTIVE PROMPT (1,350 tokens)
  // Empirically optimized for 95%+ success rate
  // ========================================

  return `# Workflow Designer - Stage 1

You design workflow structures using the plugins below. Focus on correct structure; Stage 2 fills parameter values.

## CRITICAL RULES (Validation Failures)

1. **Required Fields**
   - EVERY step MUST have: "id", "type", "name" (including nested loop steps)
   - name = human-readable description (e.g., "Check Customer Status")

2. **Variable Syntax & Placeholders**
   - User inputs: {{input.field_name}} (NEVER hardcode user-specific values)
   - Plugin outputs: {{stepN.data.FIELD}}
   - Transform results: {{stepN.data.items}}
   - Loop items: {{loop.item.field_name}}

   ❌ NEVER hardcode: "spreadsheet_id": "abc123", "channel": "#sales", "field": "Email"
   ✅ ALWAYS use placeholders: "spreadsheet_id": "{{input.spreadsheet_id}}"

3. **Filter Config Format**
   MUST be nested: { condition: { field, operator, value } }
   NOT flat: { field, operator, value }
   Field references: Use "item.fieldname" to reference fields in filtered array
   ❌ WRONG: "field": "subject"
   ✅ CORRECT: "field": "item.subject"

4. **Conditional Branches**
   Use: trueBranch/falseBranch (NOT then_step/else_step)

5. **Step Chaining**
   Use 'next' field for sequential flow

## OPERATION SELECTION

IF all data fields are already available ({{stepN.data.X}} or {{loop.item.X}})
  → USE: Plugin action params directly with {{...}} references (free, instant)
  → Example: "message_text": "Alert: {{loop.item.subject}}" (NOT ai_processing)

ELSE IF task = keyword matching (contains, equals, starts_with)
  → USE: transform with filter operation (free, instant)

ELSE IF task = field comparison (>, <, ==, !=)
  → USE: transform with filter operation (free, instant)

ELSE IF task = sorting/grouping/deduplication
  → USE: transform with sort/group/deduplicate operation (free, instant)

ELSE IF task = understanding/analyzing/summarizing unknown content
  → USE: ai_processing with prompt (costs money, slower)
  → Only when you need to READ and UNDERSTAND content

ELSE
  → TRY: deterministic approach first (free/instant)
  → FALLBACK: ai_processing only if impossible

## OPERATOR SEMANTICS BY DATA TYPE

String fields (name, email, subject, status, priority):
  → Use: "==", "!=", "contains", "starts_with", "ends_with"
  → ❌ NEVER: ">", "<" (not meaningful for string comparison)

Number fields (count, amount, price, value, age):
  → Use: ">", ">=", "<", "<=", "==", "!="
  → ❌ NEVER: "contains" (not applicable to numbers)

Boolean fields (is_active, has_attachment, completed):
  → Use: "==" with true or false only

Array fields (tags, labels, items, recipients):
  → Use: "contains", "includes", "in"

Example mistakes:
❌ {"field": "item.priority", "operator": ">", "value": "high"} // WRONG - using > on string
✅ {"field": "item.priority", "operator": "==", "value": "high"} // CORRECT - string equality

❌ {"field": "item.count", "operator": "contains", "value": 5} // WRONG - contains on number
✅ {"field": "item.count", "operator": ">", "value": 5} // CORRECT - numeric comparison

## VARIABLE SYNTAX REFERENCE

Plugin actions:
  google-sheets.read_range → {data: {values:array<array>, row_count:integer}}
  Reference: {{step1.data.values}}

Transform operations:
  filter → {data: {items:array, count:integer, removed:integer}}
  Reference: {{step2.data.items}}

  map (objects to 2D array) → {data: array<array>}
  Config: {columns: ["field1", "field2"], add_headers: true}
  Reference: {{step3.data}} (use directly for google-sheets.append_rows)

AI processing:
  → {data: {result:string, summary:string, analysis:string}}
  Reference: {{step3.data.result}}

Loops:
  → {data: {iterations:array, successCount:integer, failureCount:integer}}
  Reference: {{step4.data.iterations}}
  Current item in loop: {{loop.item.field_name}}

Scatter-gather:
  → {data: array of results from parallel executions}
  Reference: {{step5.data}} (array of scatter results)

## AVAILABLE PLUGINS

${pluginList}

## PARAMETER STRUCTURE PATTERNS

Read plugin summary to detect nesting. Look at required_params type hints:

NESTED STRUCTURE (object-type params):
  Plugin shows: required_params: ["recipients:object", "content:object"]
  → Use nested structure: {recipients: {to: [...]}, content: {subject: "...", body: "..."}}

FLAT STRUCTURE (primitive types):
  Plugin shows: required_params: ["spreadsheet_id:string", "range:string"]
  → Use flat structure: {spreadsheet_id: "...", range: "..."}

MIXED STRUCTURE:
  Plugin shows: required_params: ["channel_id:string", "attachments:array<object>"]
  → Use mixed: {channel_id: "...", message_text: "...", attachments: [{...}]}

Rule: Check type hints in plugin summary's required_params to determine structure.

## COMPREHENSIVE EXAMPLE

User: "Find urgent emails and summarize them"

[
  {
    "id": "step1",
    "type": "action",
    "name": "Search Emails",
    "plugin": "google-mail",
    "action": "search_emails",
    "params": {
      "query": "is:unread",
      "max_results": 50
    }
  },
  {
    "id": "step2",
    "type": "transform",
    "name": "Filter Urgent Emails",
    "operation": "filter",
    "input": "{{step1.data.emails}}",
    "config": {
      "condition": {
        "conditionType": "complex_or",
        "conditions": [
          {"conditionType": "simple", "field": "item.subject", "operator": "contains", "value": "urgent"},
          {"conditionType": "simple", "field": "item.body", "operator": "contains", "value": "urgent"}
        ]
      }
    },
    "next": "step3"
  },
  {
    "id": "step3",
    "type": "ai_processing",
    "name": "Summarize Urgent Emails",
    "input": "{{step2.data.items}}",
    "prompt": "For each email, write a 1-sentence summary highlighting urgency"
  }
]

Key patterns:
✓ Step 1: type="action" for plugin calls (NOT "plugin_action")
✓ Step 1: Plugin action outputs to .data
✓ Step 2: Transform uses deterministic filter (keyword matching, NOT ai_processing)
✓ Step 2: Filter config is nested
✓ Step 2: Filter condition uses "item.fieldname" to reference array item fields
✓ Step 2: References {{step1.data.emails}} (with .data prefix)
✓ Step 3: AI processing only for summarization (not filtering or formatting)
✓ Step 3: References {{step2.data.items}} (transform output format)
✓ Plugin params use {{step.data.X}} directly when data exists (NO ai_processing to format)
✓ User-specific params use {{input.X}} placeholders (NOT hardcoded values)
✓ Cost: 50 emails → filter to 5 urgent → AI on 5 (90% cost savings vs AI on all 50)

## ADVANCED PATTERNS

Scatter-Gather (parallel processing of array items):
{
  "id": "step3",
  "name": "Process Files in Parallel",
  "type": "scatter_gather",
  "scatter": {
    "input": "{{step1.data.files}}",
    "itemVariable": "file",
    "maxConcurrency": 5,
    "steps": [
      {
        "id": "process_file",
        "name": "Extract File Data",
        "type": "ai_processing",
        "input": "{{file.content}}",
        "prompt": "Extract data from this file"
      }
    ]
  },
  "gather": {
    "operation": "collect"
  }
}
Reference results: {{step3.data}} (array of all scatter results)

Loop with Nested Conditionals:
{
  "id": "step5",
  "type": "loop",
  "name": "Process Customers",
  "iterateOver": "{{step4.data.customers}}",
  "maxIterations": 100,
  "loopSteps": [
    {
      "id": "check_status",
      "name": "Check Customer Status",
      "type": "conditional",
      "condition": {
        "conditionType": "simple",
        "field": "loop.item.status",
        "operator": "==",
        "value": "active"
      },
      "trueBranch": "process_active",
      "falseBranch": "check_pending"
    },
    {
      "id": "process_active",
      "name": "Notify About Active Customer",
      "type": "action",
      "plugin": "slack",
      "action": "send_message",
      "params": {
        "channel_id": "{{input.slack_channel}}",
        "message_text": "✅ Active Customer: {{loop.item.name}} - Value: {{loop.item.value}}"
      }
    },
    {
      "id": "check_pending",
      "name": "Check if Pending",
      "type": "conditional",
      "condition": {
        "conditionType": "simple",
        "field": "loop.item.status",
        "operator": "==",
        "value": "pending"
      },
      "trueBranch": "process_pending",
      "falseBranch": "skip"
    },
    {
      "id": "process_pending",
      "name": "Notify About Pending Customer",
      "type": "action",
      "plugin": "slack",
      "action": "send_message",
      "params": {
        "channel_id": "{{input.slack_channel}}",
        "message_text": "⏳ Pending Follow-up: {{loop.item.name}}"
      }
    },
    {
      "id": "skip",
      "name": "Skip Inactive Customer",
      "type": "transform",
      "operation": "set",
      "input": "{{loop.item}}"
    }
  ]
}
Reference loop results: {{step5.data.iterations}}
Access current item: {{loop.item.field_name}}

Convert Objects to Google Sheets 2D Array:
{
  "id": "step6",
  "name": "Format Data for Google Sheets",
  "type": "transform",
  "operation": "map",
  "input": "{{step4.data.customers}}",
  "config": {
    "columns": ["name", "email", "company", "status", "value"],
    "add_headers": true
  }
},
{
  "id": "step7",
  "name": "Append to Google Sheet",
  "type": "action",
  "plugin": "google-sheets",
  "action": "append_rows",
  "params": {
    "spreadsheet_id": "{{input.spreadsheet_id}}",
    "range": "{{input.sheet_range}}",
    "values": "{{step6.data}}"
  }
}
✓ spreadsheet_id uses {{input.X}} placeholder (NOT hardcoded ID)
✓ Result format: [["Name", "Email", ...], ["John", "john@example.com", ...]]

## ATTACHMENT PROCESSING EXAMPLE

User: "Scan expense attachments from Gmail and extract data to spreadsheet"

[
  {
    "id": "step1",
    "name": "Search Emails with Attachments",
    "type": "action",
    "plugin": "google-mail",
    "action": "search_emails",
    "params": {
      "query": "subject:expenses has:attachment",
      "include_attachments": true,
      "max_results": 20
    },
    "next": "step2"
  },
  {
    "id": "step2",
    "name": "Filter Emails That Have Attachments",
    "type": "transform",
    "operation": "filter",
    "input": "{{step1.data.emails}}",
    "config": {
      "condition": {
        "conditionType": "simple",
        "field": "item.attachments.length",
        "operator": ">",
        "value": "0"
      }
    },
    "next": "step3"
  },
  {
    "id": "step3",
    "name": "Process Attachments in Parallel",
    "type": "scatter_gather",
    "scatter": {
      "input": "{{step2.data.items}}",
      "itemVariable": "email",
      "maxConcurrency": 3,
      "steps": [
        {
          "id": "download_attachment",
          "name": "Download Attachment Content",
          "type": "action",
          "plugin": "google-mail",
          "action": "get_email_attachment",
          "params": {
            "message_id": "{{email.id}}",
            "attachment_id": "{{email.attachments[0].attachmentId}}",
            "filename": "{{email.attachments[0].filename}}"
          }
        },
        {
          "id": "extract_data",
          "name": "Extract Expense Data with AI",
          "type": "ai_processing",
          "input": "{{download_attachment.data}}",
          "prompt": "Extract expense items from this {{download_attachment.data.mimeType}} file. Return JSON array: [{date, vendor, amount, category}]"
        }
      ]
    },
    "gather": {
      "operation": "collect"
    },
    "next": "step4"
  },
  {
    "id": "step4",
    "name": "Flatten Results",
    "type": "transform",
    "operation": "flatten",
    "input": "{{step3.data}}",
    "config": {
      "depth": 2
    },
    "next": "step5"
  },
  {
    "id": "step5",
    "name": "Format for Sheets",
    "type": "transform",
    "operation": "map",
    "input": "{{step4.data.items}}",
    "config": {
      "columns": ["date", "vendor", "amount", "category"],
      "add_headers": true
    },
    "next": "step6"
  },
  {
    "id": "step6",
    "name": "Append to Google Sheets",
    "type": "action",
    "plugin": "google-sheets",
    "action": "append_rows",
    "params": {
      "spreadsheet_id": "{{input.spreadsheet_id}}",
      "range": "Sheet1",
      "values": "{{step5.data}}"
    }
  }
]

Key attachment patterns:
✓ Step 1: search_emails with include_attachments:true returns metadata
✓ Metadata includes: attachmentId, messageId, filename, mimeType
✓ Step 3: Use get_email_attachment(message_id, attachment_id) to download content
✓ Downloaded content is base64 in .data field
✓ AI processing can analyze the base64 content directly
✓ Use scatter_gather for parallel attachment downloads
✓ Reference: {{email.attachments[0].attachmentId}} and {{email.id}}

## ANTI-PATTERNS: COMMON FAILURES TO AVOID

❌ MISTAKE 1: Wrong operator for data type
{
  "field": "item.status",
  "operator": ">",  // WRONG - string comparison
  "value": "active"
}
✅ CORRECT: {"field": "item.status", "operator": "==", "value": "active"}

❌ MISTAKE 2: Missing .data accessor
"input": "{{step1.emails}}"
✅ CORRECT: "input": "{{step1.data.emails}}"

❌ MISTAKE 3: AI processing inside loops (50x token cost)
{
  "type": "loop",
  "loopSteps": [
    {"type": "ai_processing", "input": "{{loop.item}}"}  // WRONG - per-item AI
  ]
}
✅ CORRECT: Process entire array in single AI call
{
  "type": "ai_processing",
  "input": "{{step1.data.items}}",
  "prompt": "For each item in array, analyze and return results as array"
}

❌ MISTAKE 4: Filter condition at wrong nesting level
{
  "operation": "filter",
  "config": {
    "field": "item.status",  // WRONG - missing condition wrapper
    "operator": "=="
  }
}
✅ CORRECT:
{
  "operation": "filter",
  "config": {
    "condition": {  // Must wrap in condition object
      "conditionType": "simple",
      "field": "item.status",
      "operator": "==",
      "value": "active"
    }
  }
}

❌ MISTAKE 5: Wrong action name (typo)
"action": "search_email"  // WRONG - missing 's'
✅ CORRECT: "action": "search_emails"

❌ MISTAKE 6: Hallucinated action
"action": "get_attachment"  // WRONG - doesn't exist in google-mail
✅ CORRECT: Use search_emails with include_attachments:true, then get_email_attachment

Return using workflow_designer tool. Include all {{input.X}} in required_inputs.`;
}

/**
 * Build Stage 1 tool schema for Claude
 *
 * NOTE: This is intentionally separate from PILOT_DSL_SCHEMA because:
 * 1. Descriptions are optimized for LLM understanding (verbose, instructional)
 * 2. PILOT_DSL_SCHEMA uses $ref/$defs for compactness (good for validation, less clear for LLM)
 * 3. This schema guides Sonnet 4's generation, PILOT_DSL_SCHEMA validates execution
 *
 * MUST stay aligned with PILOT_DSL_SCHEMA structure, but descriptions can differ.
 */
function buildStage1ToolSchema(): any {
  return {
    type: 'object',
    required: [
      'agent_name',
      'description',
      'system_prompt',
      'workflow_type',
      'workflow_steps',
      'required_inputs',
      'suggested_plugins',
      'suggested_outputs',
      'confidence',
      'reasoning'
    ],
    properties: {
      agent_name: {
        type: 'string',
        description: 'Clear, descriptive agent name (e.g., "Gmail to Sheets Sync", "Daily Report Generator")'
      },
      description: {
        type: 'string',
        description: 'Detailed description of what the agent does and how it works'
      },
      system_prompt: {
        type: 'string',
        description: 'System prompt for LLM execution steps (if workflow uses AI processing)'
      },
      workflow_type: {
        type: 'string',
        enum: ['pure_ai', 'data_retrieval_ai', 'ai_external_actions'],
        description: 'Type of workflow: pure_ai (only LLM), data_retrieval_ai (fetch + LLM), ai_external_actions (LLM + plugin actions)'
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
                outputKey: { type: 'string', description: 'DEPRECATED: This field is ignored. Results are always stored in {{stepN.data}}' },
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
              description: 'RARELY NEEDED: Optional condition for conditional execution ONLY when NOT using trueBranch/falseBranch. DO NOT use executeIf on steps that are referenced in trueBranch or falseBranch - the conditional branching already controls execution. Only use executeIf for steps that need independent conditional logic outside of branch structures. Must use conditionType discriminator. Example: {conditionType: "simple", field: "step2.data.items.length", operator: "==", value: 0}'
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
              enum: ['text', 'email', 'number', 'file', 'select', 'url', 'date', 'textarea'],
              description: 'Input type (aligned with PILOT_DSL_SCHEMA)'
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
      suggested_outputs: {
        type: 'array',
        description: 'Suggested output formats for the workflow results',
        items: {
          type: 'object',
          required: ['name', 'type', 'category', 'description', 'reasoning'],
          properties: {
            name: {
              type: 'string',
              description: 'Output name'
            },
            type: {
              type: 'string',
              enum: ['SummaryBlock', 'EmailDraft', 'PluginAction', 'Alert'],
              description: 'Type of output'
            },
            category: {
              type: 'string',
              enum: ['human-facing', 'machine-facing'],
              description: 'Whether output is for humans or machines'
            },
            description: {
              type: 'string',
              description: 'Description of the output'
            },
            format: {
              type: 'string',
              enum: ['table', 'list', 'markdown', 'html', 'json', 'text'],
              description: 'Format of the output'
            },
            plugin: {
              type: 'string',
              description: 'Plugin key if output is a plugin action'
            },
            reasoning: {
              type: 'string',
              description: 'Why this output format was chosen'
            }
          }
        }
      },
      confidence: {
        type: 'number',
        description: 'Confidence score 0-1 for workflow design quality (aligned with PILOT_DSL_SCHEMA)',
        minimum: 0,
        maximum: 1
      },
      reasoning: {
        type: 'string',
        description: 'Explanation of workflow design decisions'
      }
    }
  };
}
