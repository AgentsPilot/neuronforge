// lib/agentkit/analyzePrompt-v3-direct.ts
// OPTION 3: Direct AgentKit Prompt Injection - Simplest approach

import { openai, AGENTKIT_CONFIG } from './agentkitClient';
import { convertPluginsToTools, getPluginContextPrompt } from './convertPlugins';
import { PILOT_DSL_SCHEMA } from '@/lib/pilot/schema';

export interface AnalyzedWorkflowStep {
  id: string;
  operation: string;
  type: 'plugin_action' | 'ai_processing' | 'conditional' | 'loop' | 'switch' | 'scatter_gather' | 'enrichment' | 'transform' | 'human_approval' | 'parallel_group' | 'sub_workflow' | 'delay' | 'validation' | 'comparison';
  plugin?: string;
  plugin_action?: string;
  params?: Record<string, any>; // Parameters to pass to plugin action
  dependencies: string[];
  reasoning: string;

  // Conditional-specific fields
  condition?: {
    field: string;
    operator: string;
    value: any;
  };

  // Conditional execution (for steps within branches)
  executeIf?: {
    field: string;
    operator: string;
    value: any;
  };

  // Loop-specific fields
  iterateOver?: string;  // Variable reference to array to iterate over (e.g., "{{step1.data.customers}}")
  maxIterations?: number;  // Safety limit for loops
  loopSteps?: AnalyzedWorkflowStep[];  // Nested steps to execute in loop

  // Switch-specific fields
  evaluate?: string;  // Expression to evaluate for switch
  cases?: Record<string, string[]>;  // Map of case values to step IDs
  default?: string[];  // Default case step IDs

  // Scatter-gather specific
  scatter?: {
    input: string;
    steps: AnalyzedWorkflowStep[];
    maxConcurrency?: number;
  };
  gather?: {
    operation: 'collect' | 'merge' | 'reduce';
    mergeStrategy?: string;
  };

  // Enrichment specific
  source?: string;
  enrichWith?: {
    plugin: string;
    action: string;
    lookupField: string;
    returnFields: string[];
  };
}

export interface AnalyzedInput {
  name: string;
  type: 'text' | 'email' | 'number' | 'file' | 'select' | 'url' | 'date' | 'textarea';
  label?: string;
  required: boolean;
  description: string;
  placeholder?: string;
  reasoning: string;
}

export interface AnalyzedOutput {
  name: string;
  type: 'SummaryBlock' | 'EmailDraft' | 'PluginAction' | 'Alert';
  category: 'human-facing' | 'machine-facing';
  description: string;
  format?: 'table' | 'list' | 'markdown' | 'html' | 'json' | 'text';
  plugin?: string;  // For PluginAction outputs
  reasoning: string;
}

export interface PromptAnalysisResult {
  agent_name: string;
  description: string;
  system_prompt: string;  // AgentKit execution system prompt
  workflow_type: 'pure_ai' | 'data_retrieval_ai' | 'ai_external_actions';
  suggested_plugins: string[];
  required_inputs: AnalyzedInput[];
  workflow_steps: AnalyzedWorkflowStep[];
  suggested_outputs: AnalyzedOutput[];  // NEW: Output suggestions from SDK
  reasoning: string;
  confidence: number;
  tokensUsed?: {
    prompt: number;
    completion: number;
    total: number;
  };
}

/**
 * Generates an execution-optimized system prompt for AgentKit function calling
 * This prompt guides the agent during actual execution with function calls
 */
function generateExecutionSystemPrompt(
  userPrompt: string,
  workflowType: string,
  workflowSteps: AnalyzedWorkflowStep[],
  suggestedPlugins: string[]
): string {
  // Extract clean objective - detect enhanced prompts and extract from steps instead
  let objective = userPrompt.substring(0, 150);

  if (userPrompt.includes('**Data Source:**') || userPrompt.includes('**Processing Steps:**')) {
    // This is an enhanced prompt - extract clean goal from workflow steps
    const stepDescriptions = workflowSteps
      .filter(s => s.plugin !== 'ai_processing')
      .map(s => s.operation || (s as any).name || 'process')
      .join(', then ');

    if (stepDescriptions) {
      objective = stepDescriptions;
    }
  }

  // Build workflow overview from steps
  const workflowOverview = workflowSteps.map((step, idx) => {
    // Handle both analysis format (operation/plugin_action) and pilot format (name/action)
    const operation = step.operation || (step as any).name || 'Process step';
    const action = step.plugin_action || (step as any).action || '';
    const plugin = step.plugin || '';

    // Clean up redundant text in operation
    let cleanOperation = operation
      .replace(new RegExp(`using ${plugin}`, 'gi'), '')
      .replace(new RegExp(`with ${plugin}`, 'gi'), '')
      .replace(new RegExp(action, 'gi'), '')
      .trim();

    const actionLabel = action ? `.${action}` : '';
    return `${idx + 1}. ${cleanOperation}${plugin ? ` (${plugin}${actionLabel})` : ''}`;
  }).join('\n');

  // Build rich system prompt for execution
  return `You are executing ${workflowType.replace(/_/g, ' ')} automation.

OBJECTIVE:
${objective}

WORKFLOW:
${workflowOverview}

AVAILABLE SERVICES:
${suggestedPlugins.join(', ')}

EXECUTION RULES:
1. Follow the workflow steps in sequence
2. Use function calls ONLY to retrieve or save data to external services
3. Use your built-in AI for all data processing, analysis, and summarization
4. Handle errors gracefully and report them
5. Return structured results

EFFICIENCY - CRITICAL:
You are a powerful AI with built-in capabilities for:
- Text summarization (any length, any amount)
- Data analysis and processing
- Information extraction and formatting
- Content generation and transformation

🚫 PROHIBITED PATTERNS (will waste resources):
- Calling summarize/process functions in loops (e.g., for each email/item/row)
- Making the same function call multiple times with different data
- Using external functions for tasks you can do natively with your AI

✅ REQUIRED PATTERNS (efficient execution):
- Retrieve all data in ONE function call
- Process/analyze/summarize ALL data using your AI brain (NO function calls)
- Send/save final results in ONE function call

EXAMPLES:
Task: "Summarize 10 emails"
❌ WRONG: search_emails → summarize_content (x10) → send_email (12 calls)
✅ RIGHT: search_emails → [AI summarizes all 10] → send_email (2 calls)

Task: "Analyze data from sheet and send to Slack"
❌ WRONG: read_sheet → process_row (x100) → send_slack (102 calls)
✅ RIGHT: read_sheet → [AI analyzes all rows] → send_slack (2 calls)

Task: "Research 3 topics and create report"
✅ RIGHT: research(topic1) → research(topic2) → research(topic3) → [AI combines] → save_report (4 calls)
Note: Multiple research calls are OK because each retrieves DIFFERENT external data

RULE OF THUMB:
- Count of function calls should be: (# of data sources) + (# of destinations) + small constant
- NOT proportional to number of items being processed
- Most tasks: 2-5 function calls total, regardless of data volume`;
}

/**
 * OPTION 3: Direct AgentKit prompt injection
 *
 * Simple approach: Give AgentKit the prompt, available plugins, and clear instructions.
 * Let AgentKit's native intelligence figure out the rest.
 */
export async function analyzePromptDirectAgentKit(
  userId: string,
  userPrompt: string,
  availablePlugins: string[]
): Promise<PromptAnalysisResult> {
  console.log(`🎯 AgentKit Direct: Analyzing prompt with native intelligence`);
  console.log(`📦 Available plugins: ${availablePlugins.join(', ')}`);

  try {
    // Get tools and plugin context (same as execution)
    const tools = await convertPluginsToTools(userId, availablePlugins);
    const pluginContext = await getPluginContextPrompt(userId, availablePlugins);

    console.log(`🔧 AgentKit Direct: Loaded ${tools.length} available actions`);

    // DEBUG: Log the plugin context that will be shown to AI
    if (process.env.NODE_ENV === 'development') {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`🔍 [DEBUG] Plugin Context for AI:`);
      console.log(`${'='.repeat(80)}`);
      console.log(pluginContext);
      console.log(`${'='.repeat(80)}\n`);
    }

    // CRITICAL: Very clear instructions to AgentKit
    const systemPrompt = `You are an intelligent agent builder. Your job is to analyze a user's request and create a complete agent specification.

# Your Task:
Analyze the user's request and return a JSON object with the agent specification.

# Connected Services Available:
${pluginContext}

# CRITICAL RULES:
1. **ONLY use plugins that are EXPLICITLY mentioned or clearly needed**
2. **NEVER add plugins "just in case" or as defaults**
3. **Identify ALL required inputs** - check each plugin action's parameters
4. **If a parameter is missing, add it as a required input**
5. **DO NOT use chatgpt-research for basic summarization - use ai_processing instead**
6. **ONLY use chatgpt-research when user asks to "research" or "find information about" topics**
7. **ALWAYS provide user-friendly labels for input fields** - see Label Generation Rules below
8. **PARAMETER NAMES MUST MATCH EXACTLY** - see Parameter Name Rules below

# ⚠️ PARAMETER STRUCTURE RULES (CRITICAL - EXECUTION WILL FAIL IF WRONG):
When generating workflow_steps params, you MUST use the EXACT parameter structure from the plugin schema.
DO NOT invent or guess parameter names. Check the "Connected Services Available" section above for the EXACT structure.

**CRITICAL: Some plugins have NESTED parameter structures!**

Example - google-mail.send_email requires NESTED objects:
✅ CORRECT:
{
  "recipients": { "to": ["{{input.recipient_email}}"] },
  "content": { "subject": "My Subject", "body": "Email body here" }
}

❌ WRONG (flat structure will FAIL):
{
  "recipient_email": "...",
  "subject": "...",
  "message": "..."
}

**Other common mistakes to AVOID:**
- chatgpt-research.research_topic requires "topic" (NOT "query", NOT "search_term")
- google-mail.search_emails requires "query" (this one IS "query")
- google-sheets.append_rows requires "spreadsheet_id", "values" (NOT "sheet_id", "data")

**How to find correct parameter structure:**
1. Look at the "Connected Services Available" section above
2. Each action shows its REQUIRED params and Parameter structure
3. If it says "type: object, properties: [...]" you MUST use nested structure
4. Match the EXACT structure shown in the schema

# Plugin Selection Examples:
- "Summarize my emails" → google-mail ONLY (ai_processing handles summary)
- "Analyze data and email results" → google-mail ONLY (ai_processing handles analysis)
- "Email me results" → google-mail + need recipient_email input
- "Send to my sheet" → google-sheets + need spreadsheet_id and range inputs
- "Research AI trends and email report" → chatgpt-research + google-mail (actual research task)
- "Find information about quantum computing" → chatgpt-research (web research needed)

# When to use ai_processing vs chatgpt-research:
- Summarize, analyze, process existing data → ai_processing (NO plugin needed)
- Research topics, find information online → chatgpt-research plugin

# Label Generation Rules (REQUIRED for all input fields):
Each input field MUST have a user-friendly "label" that non-technical users can understand.

**Label Conversion Rules:**
- "spreadsheet_id" → "Spreadsheet ID"
- "database_id" → "Database ID"
- "folder_id" → "Folder ID"
- "recipient_email" → "Recipient Email"
- "sender_email" → "Sender Email"
- "range" → "Cell Range"
- "sheet_name" → "Sheet Name"
- "file_name" → "File Name"
- "query" → "Search Query"
- "subject" → "Email Subject"
- "message" → "Message"
- "workspace_id" → "Workspace ID"
- "channel_id" → "Channel ID"

**General Rules:**
1. Convert underscores/hyphens to spaces: "user_name" → "User Name"
2. Capitalize each word: "email address" → "Email Address"
3. Keep "ID" uppercase: "spreadsheet_id" → "Spreadsheet ID" (NOT "Spreadsheet Id")
4. Make labels descriptive and clear for non-technical users
5. Keep labels concise (2-4 words maximum)

# Response Format:
Return a JSON object with:
{
  "agent_name": "Short descriptive name",
  "description": "What the agent does (1 sentence)",
  "workflow_type": "pure_ai|data_retrieval_ai|ai_external_actions",
  "suggested_plugins": ["plugin1", "plugin2"],
  "required_inputs": [
    {
      "name": "spreadsheet_id",
      "type": "text",
      "label": "Spreadsheet ID",
      "required": true,
      "description": "Google Sheet ID to write to",
      "placeholder": "Enter spreadsheet ID or URL",
      "reasoning": "Required by google-sheets append_rows action"
    }
  ],
  "workflow_steps": [
    {
      "id": "step1",
      "operation": "Read last 10 emails",
      "type": "plugin_action",
      "plugin": "google-mail",
      "plugin_action": "search_emails",
      "params": {
        "query": "in:inbox",
        "max_results": 10
      },
      "dependencies": [],
      "reasoning": "User requested last 10 emails"
    },
    {
      "id": "step2",
      "operation": "Summarize email content",
      "type": "ai_processing",
      "plugin": "ai_processing",
      "plugin_action": "process",
      "params": {
        "prompt": "Summarize these emails: {{step1.data.emails}}",
        "output_format": "summary"
      },
      "dependencies": ["step1"],
      "reasoning": "Summarization is AI processing"
    },
    {
      "id": "step3",
      "operation": "Append summary to Google Sheet",
      "type": "plugin_action",
      "plugin": "google-sheets",
      "plugin_action": "append_rows",
      "params": {
        "spreadsheet_id": "{{input.spreadsheet_id}}",
        "values": [[
          "{{step2.data.summary}}"
        ]]
      },
      "dependencies": ["step2"],
      "reasoning": "User wants to send to sheet"
    },
    {
      "id": "step4",
      "operation": "Send summary via email",
      "type": "plugin_action",
      "plugin": "google-mail",
      "plugin_action": "send_email",
      "params": {
        "recipients": {
          "to": ["{{input.recipient_email}}"]
        },
        "content": {
          "subject": "Your Summary Report",
          "body": "{{step2.data.summary}}"
        }
      },
      "dependencies": ["step2"],
      "reasoning": "User wants to email results - NOTE: google-mail uses NESTED structure with recipients.to and content.subject/body"
    }
  ],
  "suggested_outputs": [
    {
      "name": "Research Report",
      "type": "SummaryBlock",
      "category": "human-facing",
      "description": "AI research results",
      "format": "table",
      "reasoning": "User mentioned 'table' in prompt"
    },
    {
      "name": "Email Delivery",
      "type": "PluginAction",
      "category": "human-facing",
      "plugin": "google-mail",
      "description": "Send results via email",
      "reasoning": "User wants to email the results"
    }
  ],
  "reasoning": "Explain your analysis",
  "confidence": 0.95
}

# ⚡ CONDITIONAL WORKFLOWS - WHEN TO USE ⚡
Use conditional branching when the workflow has DECISION POINTS based on data:

**WHEN TO USE CONDITIONALS:**
- "If customer is VIP, do X, otherwise do Y"
- "Check if field exists, then process accordingly"
- "Route based on priority/status/type"
- "Different actions for new vs existing records"

**CONDITIONAL STEP FORMAT:**
{
  "id": "check_vip",
  "operation": "Check if customer is VIP",
  "type": "conditional",
  "condition": {
    "field": "step1.data.is_vip",
    "operator": "==",
    "value": true
  },
  "dependencies": ["step1"],
  "reasoning": "Decision point based on VIP status"
}

**CONDITIONAL EXECUTION (executeIf):**
Steps that should only run when a condition is true must include "executeIf":
{
  "id": "step_vip",
  "operation": "Create VIP task",
  "type": "plugin_action",
  "plugin": "google-drive",
  "plugin_action": "create_document",
  "executeIf": {
    "field": "check_vip.data.result",
    "operator": "==",
    "value": true
  },
  "dependencies": ["check_vip"],
  "reasoning": "Only for VIP customers"
}

**EXAMPLE - Customer Order Workflow:**
[
  {"id": "step1", "operation": "Extract order data", "type": "ai_processing", "dependencies": []},
  {"id": "step2", "operation": "Lookup customer info", "type": "plugin_action", "plugin": "database", "plugin_action": "query", "dependencies": ["step1"]},
  {"id": "check_vip", "operation": "Check if VIP", "type": "conditional", "condition": {"field": "step2.data.is_vip", "operator": "==", "value": true}, "dependencies": ["step2"]},
  {"id": "step3_vip", "operation": "Create VIP priority task", "type": "plugin_action", "plugin": "google-drive", "plugin_action": "create_document", "executeIf": {"field": "check_vip.data.result", "operator": "==", "value": true}, "dependencies": ["check_vip"]},
  {"id": "step3_normal", "operation": "Create standard task", "type": "plugin_action", "plugin": "google-drive", "plugin_action": "create_document", "executeIf": {"field": "check_vip.data.result", "operator": "==", "value": false}, "dependencies": ["check_vip"]}
]

**IMPORTANT STEP RULES:**
1. Every step MUST have "id", "operation", "type", "dependencies"
2. Use "type": "conditional" for decision points
3. Use "executeIf" on steps that should only run when conditions are met
4. Available operators: "==", "!=", ">", "<", ">=", "<=", "contains", "not_contains"
5. Sequential steps should have dependencies on previous step (e.g., step2 depends on step1)
6. Conditional branches should depend on the conditional step

# ⚡ ULTRA-CRITICAL - OPERATION DECISION TREE ⚡
🚫 AVOID AI LOOPS AT ALL COSTS - Follow this decision tree EXACTLY:

**STEP 0: SCAN FOR CONDITIONAL KEYWORDS (DO THIS FIRST!):**
If user says ANY of these, you MUST add conditional/switch steps:
- "if", "when", "check if", "compare and", "match and", "different actions for"
- "classify", "categorize", "route based on", "depending on", "priority"
- "upgrade opportunity", "mismatch", "risk", "urgent vs normal"
- "for customers who exist/don't exist", "new vs existing"

**STEP 1: Is this operation deterministic (fixed rules)?**
  ✅ YES → Use deterministic operations (0 AI calls):
    - Match/compare data? → type: "comparison" (left/right/operation at TOP LEVEL!)
    - Filter by criteria? → type: "transform" with operation: "filter"
    - Map/reshape data? → type: "transform" with operation: "map"
    - Sort/group/count? → type: "transform" with operation: "sort"|"group"|"aggregate"
    - Validate schema/rules? → type: "validation"

  ❌ NO → Requires AI reasoning:
    **STEP 2: Is processing UNIFORM across all items?**
      ✅ YES → BATCH AI (1 call): type: "ai_processing" with prompt referencing ALL items
        Examples: "Summarize all emails", "Extract from all documents", "Categorize these customers"

      ❌ NO → Loop with AI (N calls): type: "loop" with loopSteps containing ai_processing
        Examples: "Write PERSONALIZED email for each customer", "Each document needs UNIQUE analysis"

**STEP 3: Does workflow have DECISION POINTS? (CHECK STEP 0 KEYWORDS!)**
  - "If X then Y, else Z" → Add type: "conditional" step + executeIf on dependent steps
  - "Route based on status/priority/type" → Add type: "switch" step with cases
  - Different actions for new vs existing → Use comparison step + executeIf
  - After comparison, ALWAYS add conditional to check results
  - After AI classification, ALWAYS add switch to route by category

**⚠️ CRITICAL ANTI-PATTERNS - NEVER DO THIS:**
❌ Loop → AI process each item → summarize (100 AI calls!)
✅ AI process all items at once → batch summary (1 AI call!)

❌ AI to match/filter/compare data (wasted AI calls!)
✅ Use comparison/transform steps (0 AI calls!)

# ⚡ COMPREHENSIVE EXAMPLE - CUSTOMER ONBOARDING AUDIT ⚡
This example shows ALL patterns working together (study this carefully!):

**User Request:** "Audit customer onboarding: List contracts from Drive, extract customer data from each, get support emails, match customers, flag mismatches, summarize issues, filter urgent, classify and route."

**Generated Workflow:**
[
  {
    "id": "s1",
    "operation": "List customer contracts from Drive",
    "type": "action",
    "plugin": "google-drive",
    "plugin_action": "list_files",
    "params": {"folder_id": "{{input.contracts_folder}}", "query": "name contains 'contract'"},
    "dependencies": [],
    "reasoning": "Fetch all contract files"
  },
  {
    "id": "s2",
    "operation": "Extract customer data from all contracts",
    "type": "ai_processing",
    "plugin": "ai_processing",
    "plugin_action": "process",
    "params": {
      "prompt": "For EACH contract file in {{s1.data.files}}, extract: customer_name, email, package_tier, start_date. Return as JSON array."
    },
    "dependencies": ["s1"],
    "reasoning": "BATCH AI EXTRACTION - 1 call for ALL contracts (not loop with N calls!)"
  },
  {
    "id": "s3",
    "operation": "Get support emails for all customers",
    "type": "action",
    "plugin": "google-mail",
    "plugin_action": "search_emails",
    "params": {"query": "from:({{s2.data.customers.*.email}})", "max_results": 100},
    "dependencies": ["s2"],
    "reasoning": "Fetch all customer support emails"
  },
  {
    "id": "s4",
    "operation": "Summarize issues from all emails",
    "type": "ai_processing",
    "plugin": "ai_processing",
    "plugin_action": "process",
    "params": {
      "prompt": "For each customer email in {{s3.data}}, extract: customer_email, issue_summary, urgency_level. Return as JSON array."
    },
    "dependencies": ["s3"],
    "reasoning": "BATCH AI SUMMARIZATION - 1 call for ALL emails (not loop!)"
  },
  {
    "id": "s5",
    "operation": "Get database customer records",
    "type": "action",
    "plugin": "database",
    "plugin_action": "query",
    "params": {"query": "SELECT email, package_tier, status FROM customers WHERE active = true"},
    "dependencies": [],
    "reasoning": "Fetch current customer records from database"
  },
  {
    "id": "s6",
    "name": "Match contract vs database customers",
    "type": "comparison",
    "left": "{{s2.data.customers}}",
    "right": "{{s5.data}}",
    "operation": "diff",
    "outputFormat": "detailed",
    "dependencies": ["s2", "s5"],
    "reasoning": "DETERMINISTIC MATCHING - 0 AI calls! Find customers in contracts but not in DB"
  },
  {
    "id": "s7",
    "operation": "Check if mismatches exist",
    "type": "conditional",
    "condition": {
      "field": "s6.data.added",
      "operator": "!=",
      "value": []
    },
    "dependencies": ["s6"],
    "reasoning": "Decision point - only alert if mismatches found"
  },
  {
    "id": "s8",
    "operation": "Classify each mismatch urgency",
    "type": "ai_processing",
    "plugin": "ai_processing",
    "plugin_action": "process",
    "params": {
      "prompt": "For each customer in {{s6.data.added}}, classify urgency: 'Upgrade Opportunity' if high-tier package, 'Billing Risk' if missing payment info, 'Standard Onboarding' otherwise. Return JSON array with email and classification."
    },
    "dependencies": ["s6"],
    "executeIf": {
      "field": "s7.data.result",
      "operator": "==",
      "value": true
    },
    "reasoning": "BATCH AI CLASSIFICATION - 1 call for ALL mismatches, only if they exist"
  },
  {
    "id": "s9",
    "name": "Filter urgent customer issues",
    "operation": "filter",
    "type": "transform",
    "input": "{{s4.data}}",
    "config": {
      "condition": {
        "field": "urgency_level",
        "operator": "matches",
        "value": ".*(urgent|high|blocked|cannot login).*"
      }
    },
    "dependencies": ["s4"],
    "reasoning": "DETERMINISTIC FILTER - 0 AI calls! Extract urgent issues using regex"
  },
  {
    "id": "s10",
    "operation": "Route by classification",
    "type": "switch",
    "evaluate": "{{s8.data.classification}}",
    "cases": {
      "Upgrade Opportunity": ["s11"],
      "Billing Risk": ["s12"],
      "Standard Onboarding": ["s13"]
    },
    "dependencies": ["s8"],
    "reasoning": "Multi-way routing based on AI classification"
  },
  {
    "id": "s11",
    "operation": "Create upgrade opportunity tasks",
    "type": "action",
    "plugin": "google-sheets",
    "plugin_action": "append_rows",
    "params": {
      "spreadsheet_id": "{{input.sales_sheet}}",
      "values": "{{s8.data}}"
    },
    "executeIf": {
      "field": "s10.data.matched_case",
      "operator": "==",
      "value": "Upgrade Opportunity"
    },
    "dependencies": ["s10"],
    "reasoning": "Only execute if routed to Upgrade case"
  },
  {
    "id": "s12",
    "operation": "Alert billing team about risks",
    "type": "action",
    "plugin": "slack",
    "plugin_action": "post_message",
    "params": {
      "channel": "billing-alerts",
      "text": "⚠️ Billing risk detected for {{s8.data.length}} customers: {{s8.data}}"
    },
    "executeIf": {
      "field": "s10.data.matched_case",
      "operator": "==",
      "value": "Billing Risk"
    },
    "dependencies": ["s10"],
    "reasoning": "Only execute if routed to Billing Risk case"
  },
  {
    "id": "s13",
    "operation": "Send urgent issues summary",
    "type": "action",
    "plugin": "google-mail",
    "plugin_action": "send_email",
    "params": {
      "recipients": {"to": ["{{input.manager_email}}"]},
      "content": {
        "subject": "Customer Onboarding Audit Results",
        "body": "Urgent Issues: {{s9.data.length}} found\n\nMismatches: {{s6.data.added.length}}\n\nDetails: {{s9.data}}"
      }
    },
    "dependencies": ["s9", "s6"],
    "reasoning": "Final summary with all findings"
  }
]

**Key Patterns Demonstrated:**
✅ Batch AI extraction (s2): 1 call for ALL contracts (NOT loop with N calls!)
✅ Batch AI summarization (s4): 1 call for ALL emails (NOT loop!)
✅ Batch AI classification (s8): 1 call for ALL mismatches (NOT loop!)
✅ Deterministic comparison (s6): Match datasets - 0 AI calls!
✅ Deterministic filter (s9): Extract urgent items - 0 AI calls!
✅ Conditional execution (s7, executeIf): Only run steps when needed
✅ Switch routing (s10): Multi-way branching by classification

**Token Efficiency:**
- WITHOUT optimization: ~150+ AI calls (1 per contract + 1 per email + 1 per mismatch)
- WITH optimization: ~3 AI calls total (batch extraction + batch summary + batch classification)
- Savings: 98% reduction in AI calls!

# ⚡ CRITICAL PATTERN RULES ⚡

**1. CONDITIONAL LOGIC - ALWAYS CHECK BEFORE ACTING:**
When workflow says "check if", "if exists", "match and update", "new vs existing":
- Step 1: Use type: "comparison" to match datasets (0 AI calls!)
- Step 2: Add type: "conditional" to check comparison result
- Step 3: Add executeIf to steps that depend on the condition

**Example - Check if customer exists before creating:**
[
  {"id": "s1", "operation": "Search for existing contact", "type": "action", "plugin": "crm", "plugin_action": "search_contact", "params": {"email": "{{input.email}}"}, "dependencies": []},
  {"id": "s2", "operation": "Check if customer is new", "type": "conditional", "condition": {"field": "s1.data.found", "operator": "==", "value": false}, "dependencies": ["s1"], "reasoning": "Check if customer is new"},
  {"id": "s3", "operation": "Create new contact", "type": "action", "plugin": "crm", "plugin_action": "create_contact", "params": {"email": "{{input.email}}"}, "executeIf": {"field": "s2.data.result", "operator": "==", "value": true}, "dependencies": ["s2"], "reasoning": "Only create if new"},
  {"id": "s4", "operation": "Update existing contact", "type": "action", "plugin": "crm", "plugin_action": "update_contact", "params": {"email": "{{input.email}}"}, "executeIf": {"field": "s2.data.result", "operator": "==", "value": false}, "dependencies": ["s2"], "reasoning": "Only update if exists"}
]

**2. AI PROCESSING - PARAMS STRUCTURE (CRITICAL!):**
AI processing steps MUST have params object with prompt inside:
✅ CORRECT: {"type": "ai_processing", "params": {"prompt": "Extract data from {{s1.data}}"}}
❌ WRONG: {"type": "ai_processing", "prompt": "Extract data from {{s1.data}}"}

**3. COMPARISON - TOP LEVEL FIELDS (CRITICAL!):**
Comparison steps MUST have left/right/operation at TOP level (all 3 required!):
✅ CORRECT: {"type": "comparison", "left": "{{s1.data}}", "right": "{{s2.data}}", "operation": "diff", "outputFormat": "detailed"}
❌ WRONG: {"type": "comparison", "left": "{{s1.data}}", "right": "{{s2.data}}"} (missing operation!)
❌ WRONG: {"type": "comparison", "params": {"left": "{{s1.data}}", "right": "{{s2.data}}"}}"}}
Valid operations: "equals", "deep_equals", "diff", "contains", "subset"

**4. TRANSFORM - STRUCTURE (CRITICAL!):**
Transform steps have operation at TOP level (NOT in params!):
Valid operations: "filter", "map", "reduce", "sort", "group", "aggregate"
✅ CORRECT: {"type": "transform", "operation": "filter", "input": "{{s1.data}}", "config": {"condition": {...}}}
❌ WRONG: {"type": "transform", "params": {"operation": "filter", ...}} (operation goes at top level!)
❌ WRONG: {"type": "transform", "operation": "match", ...} (use type: "comparison" instead!)

**5. SWITCH - MULTI-WAY ROUTING:**
When routing by category/status/priority (more than 2 outcomes):
{"id": "route", "type": "switch", "evaluate": "{{s1.data.priority}}", "cases": {"high": ["s2"], "medium": ["s3"], "low": ["s4"]}, "dependencies": ["s1"]}
Then add executeIf to each case step:
{"id": "s2", "executeIf": {"field": "route.data.matched_case", "operator": "==", "value": "high"}, "dependencies": ["route"]}

# ⚡ MINIMAL REFERENCE SNIPPETS ⚡

**LOOP (ONLY for personalized/unique AI per item):**
{"id": "s1", "type": "loop", "iterateOver": "{{step1.data.items}}", "maxIterations": 100, "loopSteps": [{"id": "s1_process", "type": "ai_processing", "params": {"prompt": "Personalized analysis for {{item.name}} with history {{item.context}}"}, "dependencies": []}], "dependencies": ["step1"], "reasoning": "Each item needs UNIQUE context-aware analysis"}

**CONDITIONAL (if/else decision points):**
{"id": "check", "operation": "Check condition", "type": "conditional", "condition": {"field": "step1.data.exists", "operator": "==", "value": true}, "dependencies": ["step1"]}
{"id": "if_true", "operation": "Action if true", "type": "action", "plugin": "x", "plugin_action": "y", "params": {}, "executeIf": {"field": "check.data.result", "operator": "==", "value": true}, "dependencies": ["check"]}
{"id": "if_false", "operation": "Action if false", "type": "action", "plugin": "x", "plugin_action": "z", "params": {}, "executeIf": {"field": "check.data.result", "operator": "==", "value": false}, "dependencies": ["check"]}

**COMPARISON (match/diff datasets - 0 AI calls!):**
{"id": "match", "name": "Match customers", "type": "comparison", "left": "{{s1.data}}", "right": "{{s2.data}}", "operation": "diff", "outputFormat": "detailed", "dependencies": ["s1", "s2"]}

**TRANSFORM (filter/map/group - 0 AI calls!):**
Filter: {"id": "s1", "operation": "filter", "type": "transform", "input": "{{s1.data}}", "config": {"condition": {"field": "status", "operator": "==", "value": "active"}}, "dependencies": ["s1"]}
Map: {"id": "s2", "operation": "map", "type": "transform", "input": "{{s1.data}}", "config": {"template": {"email": "{{item.email}}", "name": "{{item.name}}"}}, "dependencies": ["s1"]}
Group: {"id": "s3", "operation": "group", "type": "transform", "input": "{{s1.data}}", "config": {"groupBy": "category"}, "dependencies": ["s1"]}

**VALIDATION (schema checking):**
{"id": "validate", "type": "validation", "params": {"data": "{{s1.data}}", "schema": {"type": "object", "required": ["email"]}, "rules": [{"field": "email", "condition": {"operator": "matches", "value": ".*@.*"}}]}, "dependencies": ["s1"]}

# ⚡ CRITICAL - ALWAYS DETECT OUTPUT FORMAT ⚡
EVERY SummaryBlock output MUST have a "format" field. Analyze the user's prompt and detect their desired format:

**SCAN THE PROMPT FOR THESE KEYWORDS:**
- "table", "spreadsheet", "rows", "columns" → ADD: "format": "table"
- "list", "bullet points", "numbered", "bullets" → ADD: "format": "list"
- "markdown", "formatted text" → ADD: "format": "markdown"
- "JSON", "data structure", "API" → ADD: "format": "json"
- "HTML", "web page" → ADD: "format": "html"
- NO keywords → ADD: "format": "text"

**EXAMPLE:**
User says: "Create a detailed table with results"
→ You MUST add: "format": "table" to the SummaryBlock output

**EXAMPLE:**
User says: "Send me bullet points"
→ You MUST add: "format": "list" to the SummaryBlock output

# Output Type Rules:
- If workflow generates content for user → type: "SummaryBlock" with REQUIRED format field
- If workflow saves/sends to a plugin → type: "PluginAction" with plugin name
- DO NOT create error notification outputs - these are added automatically by the system
- Focus on the main deliverable outputs only

# IMPORTANT - Input Detection & Parameter Mapping:
For each plugin action in workflow_steps:
1. Check what parameters it requires (see Connected Services above)
2. Add a "params" field that maps inputs and previous step outputs to plugin parameters
3. If parameter value is NOT in the user's prompt, add it to required_inputs
4. Use variable interpolation syntax:
   - {{input.field_name}} for user inputs
   - {{step1.data.field_name}} for previous step outputs (plugin actions)
   - {{step2.data.X}} for AI processing results (see below for available fields)

Example: append_rows needs "spreadsheet_id", "range", "values"
   - "values" comes from AI summary → "params": {"values": [[{{step2.data.summary}}]]}
   - "spreadsheet_id" NOT in prompt → add to required_inputs + use {{input.spreadsheet_id}} in params
   - "range" → use {{input.range}} or default value in params

AI PROCESSING STEPS - FLEXIBLE OUTPUT REFERENCES:
AI processing steps return the same result under MULTIPLE field names for flexibility.
Choose the most semantic field name based on what the AI is doing:

Common field names (all contain the same value):
- {{stepX.data.result}} - Generic, always works for any AI processing task
- {{stepX.data.summary}} - Use for summarization tasks (most intuitive)
- {{stepX.data.analysis}} - Use for analysis tasks
- {{stepX.data.decision}} - Use for decision-making tasks
- {{stepX.data.classification}} - Use for classification tasks
- {{stepX.data.response}} - Raw AI response

Example workflows:
- Summarize emails → reference as {{step2.data.summary}}
- Analyze data → reference as {{step3.data.analysis}}
- Make decision → reference as {{step1.data.decision}}

The "prompt" in params should include variable references: "Summarize these: {{step1.data.emails}}"

CRITICAL: Every plugin_action step MUST have a "params" field with proper variable mapping!`;

    // DEBUG: Log the full system prompt
    if (process.env.NODE_ENV === 'development') {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`🔍 [DEBUG] Full System Prompt for AI (${systemPrompt.length} chars):`);
      console.log(`${'='.repeat(80)}`);
      console.log(systemPrompt);
      console.log(`${'='.repeat(80)}\n`);
    }

    // CRITICAL: For structured outputs with strict JSON schema mode, we MUST use gpt-4o
    // gpt-4o-mini and other models don't support strict mode
    const modelToUse = 'gpt-4o';
    console.log(`🔍 [DEBUG] Using model: ${modelToUse} (forced for strict JSON schema support)`);

    const completion = await openai.chat.completions.create({
      model: modelToUse,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Analyze this request and create an agent specification:\n\n"${userPrompt}"\n\nReturn ONLY the JSON object, nothing else.`
        }
      ],
      temperature: 0.1,
      max_tokens: 3000,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'pilot_workflow',
          strict: false,  // Disabled strict mode due to union type limitations (Condition definition)
          schema: PILOT_DSL_SCHEMA
        }
      }
    });

    const rawResponse = completion.choices[0].message.content || '{}';
    console.log('\n📊 AGENTKIT DIRECT - RAW RESPONSE:\n', rawResponse);

    const analysis = JSON.parse(rawResponse);

    // Extract token usage for analytics
    const tokensUsed = {
      prompt: completion.usage?.prompt_tokens || 0,
      completion: completion.usage?.completion_tokens || 0,
      total: completion.usage?.total_tokens || 0
    };

    // Validate suggested plugins exist
    const validPlugins = (analysis.suggested_plugins || []).filter((p: string) =>
      availablePlugins.includes(p)
    );

    if (validPlugins.length !== (analysis.suggested_plugins || []).length) {
      console.warn(`⚠️ AgentKit Direct: Some suggested plugins not available:`,
        (analysis.suggested_plugins || []).filter((p: string) => !availablePlugins.includes(p))
      );
    }

    // Prepare workflow steps (with fallback)
    const workflowSteps = analysis.workflow_steps || [{
      operation: 'Process request',
      plugin: 'ai_processing',
      plugin_action: 'process',
      reasoning: 'Default AI processing'
    }];

    // Generate execution-optimized system prompt
    const executionSystemPrompt = generateExecutionSystemPrompt(
      userPrompt,
      analysis.workflow_type || 'pure_ai',
      workflowSteps,
      validPlugins
    );

    const result: PromptAnalysisResult = {
      agent_name: analysis.agent_name || 'Custom Agent',
      description: analysis.description || userPrompt.substring(0, 100),
      system_prompt: executionSystemPrompt,
      workflow_type: analysis.workflow_type || 'pure_ai',
      suggested_plugins: validPlugins,
      required_inputs: analysis.required_inputs || [],
      workflow_steps: workflowSteps,
      suggested_outputs: analysis.suggested_outputs || [],  // NEW: Parse outputs from SDK
      reasoning: analysis.reasoning || 'Direct AgentKit analysis',
      confidence: analysis.confidence || 0.85,
      tokensUsed: tokensUsed
    };

    console.log('\n✅ AGENTKIT DIRECT ANALYSIS RESULT:', {
      agent_name: result.agent_name,
      workflow_type: result.workflow_type,
      suggested_plugins: result.suggested_plugins,
      input_count: result.required_inputs.length,
      step_count: result.workflow_steps.length,
      output_count: result.suggested_outputs.length,  // NEW: Log output count
      confidence: result.confidence
    });

    return result;

  } catch (error: any) {
    console.error('❌ AgentKit Direct: Analysis failed:', error);

    // Fallback workflow steps
    const fallbackSteps: AnalyzedWorkflowStep[] = [{
      id: 'step1',
      operation: 'Process user request',
      type: 'ai_processing',
      plugin: 'ai_processing',
      plugin_action: 'process',
      dependencies: [],
      reasoning: 'Fallback due to analysis error'
    }];

    // Generate fallback system prompt
    const fallbackSystemPrompt = generateExecutionSystemPrompt(
      userPrompt,
      'pure_ai',
      fallbackSteps,
      []
    );

    // Fallback
    return {
      agent_name: 'Custom Agent',
      description: 'AI-powered automation agent',
      system_prompt: fallbackSystemPrompt,
      workflow_type: 'pure_ai',
      suggested_plugins: [],
      required_inputs: [],
      workflow_steps: fallbackSteps,
      suggested_outputs: [],  // NEW: Empty outputs for fallback
      reasoning: `Analysis failed: ${error.message}. Using fallback.`,
      confidence: 0.5
    };
  }
}
