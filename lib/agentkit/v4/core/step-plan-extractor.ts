/**
 * V4 Step Plan Extractor (OpenAI Stage 1)
 *
 * LLM outputs a SIMPLE, TEXT-BASED step plan.
 * NOT JSON. NOT DSL. Just plain numbered steps.
 *
 * Example output:
 * 1. Fetch emails using gmail.fetch_recent_emails(limit=10)
 * 2. Summarize the emails using ai_processing
 * 3. Create a HubSpot contact using hubspot.contacts.create()
 * 4. Send an email using gmail.send_email()
 *
 * No JSON. No transforms. No loops. No nested structures.
 * Just a clean, simple list that humans can read.
 */

import { IPluginContext } from '@/lib/types/plugin-definition-context';
import { AnthropicProvider, ANTHROPIC_MODELS } from '@/lib/ai/providers/anthropicProvider';
import { buildPluginContextForLLM } from '../utils/plugin-helpers';

export interface StepPlanLine {
  stepNumber: number;
  description: string;
  suggestedPlugin?: string;
  suggestedAction?: string;
  rawLine: string;
  // New fields for conditional/loop support
  indentLevel: number;
  controlFlowKeyword?: 'if' | 'otherwise' | 'for_each';
  isCondition?: boolean;
  isLoop?: boolean;
}

export interface StepPlan {
  goal: string; // Kept for backward compatibility (will be set to agentName)
  agentName: string;
  description: string;
  steps: StepPlanLine[];
  rawOutput: string;
  // Token metrics from LLM call
  tokensUsed?: {
    input: number;
    output: number;
    total: number;
  };
  cost?: number;
  // Resolved inputs from enhanced prompt (e.g., slack_channel, google_sheet_id)
  resolvedInputs?: Record<string, string>;
}

export interface StepPlanExtractorOptions {
  connectedPlugins: IPluginContext[];
  userId?: string;
  anthropicApiKey: string;
  aiAnalytics?: any;
}

export class StepPlanExtractor {
  private connectedPlugins: IPluginContext[];
  private anthropicProvider: AnthropicProvider;
  private userId?: string;

  constructor(options: StepPlanExtractorOptions) {
    this.connectedPlugins = options.connectedPlugins;
    this.userId = options.userId;
    this.anthropicProvider = new AnthropicProvider(
      options.anthropicApiKey,
      options.aiAnalytics
    );
  }

  /**
   * Extract simple text-based step plan from enhanced prompt
   * Stage 1: LLM outputs plain text list with conditional/loop support
   */
  async extractStepPlan(enhancedPrompt: string): Promise<StepPlan> {
    // Validate input
    if (!enhancedPrompt || enhancedPrompt.trim().length === 0) {
      throw new Error('Enhanced prompt is empty or invalid');
    }

    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt(enhancedPrompt);

    console.log('[Step Plan Extractor] Calling Claude Sonnet to extract step plan with conditional/loop support...');

    let response;
    try {
      response = await this.anthropicProvider.chatCompletion(
        {
          model: ANTHROPIC_MODELS.CLAUDE_4_SONNET,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.1,
          max_tokens: 2000,
        },
        {
          userId: this.userId || 'system',
          feature: 'step_plan_extraction',
          component: 'v4-step-plan-extractor',
          workflow_step: 'extract_step_plan',
        }
      );
    } catch (error: any) {
      console.error('[Step Plan Extractor] LLM API call failed:', error);
      throw new Error(`Failed to call Claude API: ${error.message || 'Unknown error'}`);
    }

    const content = response.choices[0]?.message?.content;
    if (!content || content.trim().length === 0) {
      throw new Error('Empty response from LLM step plan extraction');
    }

    console.log('[Step Plan Extractor] Raw Claude output:\n', content);

    // Capture token metrics from response
    const tokensUsed = {
      input: response.usage?.prompt_tokens || 0,
      output: response.usage?.completion_tokens || 0,
      total: response.usage?.total_tokens || 0,
    };

    const cost = (response as any)._cost || 0;

    console.log('[Step Plan Extractor] Token usage:', tokensUsed, 'Cost:', cost);

    try {
      const stepPlan = this.parseStepPlan(content);

      // Add token metrics to step plan
      stepPlan.tokensUsed = tokensUsed;
      stepPlan.cost = cost;

      // Extract resolved inputs from enhanced prompt
      stepPlan.resolvedInputs = this.extractResolvedInputs(enhancedPrompt);

      return stepPlan;
    } catch (error: any) {
      console.error('[Step Plan Extractor] Failed to parse LLM output:', error);
      throw new Error(`Failed to parse step plan: ${error.message}. Raw output: ${content.substring(0, 200)}...`);
    }
  }

  /**
   * Build system prompt for LLM
   */
  private buildSystemPrompt(): string {
    const pluginContext = buildPluginContextForLLM(this.connectedPlugins);

    return `You are a workflow architect creating step plans for a DETERMINISTIC execution engine.

CRITICAL MINDSET:
- The engine CANNOT make decisions - you must specify ALL logic explicitly using If/Otherwise
- Structured data (spreadsheets, APIs, databases) has NAMED FIELDS - reference them directly as {object.field}
- Do NOT use AI to "extract", "filter", or "get" fields from structured data - they're already accessible!
- Loops process ALL items - use conditionals INSIDE loops for filtering, NOT AI steps

CONNECTED SERVICES AVAILABLE:
${pluginContext}

YOUR TASK:
Convert the execution plan below into a NUMBERED LIST of steps that the deterministic engine can execute.

OUTPUT FORMAT - MANDATORY:
1. Output PLAIN TEXT only - NO JSON, NO code blocks, NO markdown
2. Each line starts with a number: "1. ", "2. ", "3. "
3. Each step is ONE clear action
4. Use format: "Do X using service.action" or "Do X using ai_processing"
5. For conditionals, use "If [condition]:" and "Otherwise:"
6. For loops, use "For each [item-type]:" where [item-type] is a SINGULAR NOUN (lead, row, email, contact, deal - NOT adjectives like "high" or "urgent")
7. Use 2-space indentation to show nesting
8. COMBINE related AI operations into single steps
9. For multi-plugin workflows, clearly specify which service handles each action
10. ALWAYS reference the CONNECTED SERVICES list above - DO NOT hallucinate service names
11. Loop variables MUST describe the THING being iterated, not its properties (✓ "For each lead" NOT ✗ "For each high-ranking lead")

SUPPORTED CONTROL FLOW:

1. CONDITIONALS (If/Otherwise):
   - Use for routing logic based on data conditions
   - Support unlimited nesting depth (If → If → If → ...)
   - Multiple sibling conditionals at same level are allowed
   - Example: "If exists:", "If matches:", "If critical:", "Otherwise:"

2. LOOPS (For each):
   - Use for processing collections/arrays fetched by the PREVIOUS step
   - Loop variable describes ONE item from the data source (the collection returned by step N-1)
   - Loop variable MUST be a singular noun that describes ONE item (the entity type, not a filter criteria)
   - ✓ CORRECT: "For each lead:", "For each row:", "For each contact:", "For each email:", "For each deal:"
   - ✗ WRONG: "For each high:", "For each urgent:", "For each high-ranking lead:" (use conditionals INSIDE the loop for filtering)
   - ✗ WRONG: Looping over extracted/filtered subsets before the main data loop (loop over the SOURCE data first, filter INSIDE)
   - Can contain nested conditionals and loops
   - Put filtering logic INSIDE loops using If/Otherwise, NOT in the loop variable name
   - PRINCIPLE: Loop over the PRIMARY data source, use conditions to filter WITHIN the loop

========================================
KEY ARCHITECTURE PRINCIPLES
========================================

The DSL Builder expects you to reference data fields directly using {object.field} syntax.

CRITICAL CONCEPT: Field References
- When a plugin returns structured data (spreadsheet rows, API responses, database records), those fields are ACCESSIBLE BY NAME
- You reference them as: {object_name.field_name}
- Examples: {lead.email}, {row.rank}, {customer.status}, {event.title}

DO NOT describe "extracting" or "getting" these fields - they're ALREADY accessible!

LOGIC PATTERNS (Prioritized by Frequency):

PATTERN 1: Loop with Conditional (Most Common - 70% of workflows)
1. Fetch data using service.list_action
2. For each item:
  3. If {item.field} matches_condition:
    4. Execute service.action_on_item

PATTERN 2: Batch AI then Conditional Loop (When AI genuinely needed)
1. Fetch all items using service_a.list_action
2. Analyze ALL items using ai_processing
3. For each analyzed_item:
  4. If {analyzed_item.category} equals value:
    5. Execute service_b.action

PATTERN 3: Multi-Plugin Orchestration
1. Fetch from service_a.fetch_action
2. For each item:
  3. Create in service_b.create_action
  4. Notify via service_c.notify_action

PATTERN 4: Nested Conditionals (Complex Routing)
1. Fetch data using service.fetch_action
2. For each item:
  3. If {item.status} equals active:
    4. If {item.priority} > 5:
      5. Execute service.urgent_action
    6. Otherwise:
      7. Execute service.normal_action

ACTION SELECTION RULES:
- MANDATORY: ONLY use actions from the CONNECTED SERVICES list at the top of this prompt
- Use "using [service-name].[action-name]" for plugin actions FIRST (always prefer plugins over AI)
- Use "using ai_processing" ONLY for genuinely intelligent tasks (semantic analysis, unstructured text, complex reasoning)
- If user mentions a service not in CONNECTED SERVICES, use the closest available service

========================================
CRITICAL: WHEN TO USE AI (AND WHEN NOT TO)
========================================

**FUNDAMENTAL RULE: Structured data (spreadsheets, databases, APIs) has NAMED FIELDS that are DIRECTLY ACCESSIBLE.**

You do NOT need AI to "extract", "get", "find", or "filter" structured data. Fields are already there!

✅ ONLY use "ai_processing" for:
1. **Semantic understanding**: sentiment, tone, intent, categorization of UNSTRUCTURED text
2. **Content generation**: Writing personalized emails, summaries, reports
3. **Unstructured parsing**: Extracting info from paragraphs, documents without clear fields

❌ NEVER use "ai_processing" for:

1. **"Extracting" or "getting" fields from structured sources**
   Sources with fields: Spreadsheets (columns), APIs (JSON properties), Databases (fields), Calendar (event properties)

   ❌ WRONG: "Extract email from sheet using ai_processing"
   ✅ CORRECT: Reference field directly in action: "Send to {row.email} using google-mail.send_email"

2. **Filtering or comparing structured data values**
   ❌ WRONG: "Filter high-rank leads using ai_processing"
   ✅ CORRECT: "For each lead: If {lead.rank} > 7: ..."

3. **Determining what to do based on field values**
   ❌ WRONG: "Check if customer is active using ai_processing"
   ✅ CORRECT: "If {customer.status} equals active: ..."

4. **Formatting or transforming field values**
   ❌ WRONG: "Format date field using ai_processing"
   ✅ CORRECT: Plugin parameters handle formatting automatically

DECISION TREE (Use this EVERY time you consider ai_processing):
1. Is the data from a spreadsheet/database/API? → YES = NO AI, use field references
2. Does the operation involve understanding meaning/sentiment? → NO = NO AI, use conditionals
3. Are you "extracting" or "getting" a field value? → YES = NO AI, fields are already accessible
4. Can a conditional (If/Otherwise) handle this? → YES = NO AI, use conditionals

**If you answered YES to questions 1, 3, or 4, or NO to question 2, DO NOT USE AI.**

========================================
CRITICAL: AI BATCHING (COST OPTIMIZATION)
========================================

AI can process MULTIPLE items in ONE call (saves 50-90% cost vs loops).

✅ CORRECT PATTERN:
1. Read all leads from google-sheets.read_range
2. For each lead:
  3. If {lead.rank} > 7:
    4. Send email to {lead.sales_person_email} using google-mail.send_email

✅ ALSO CORRECT (when AI genuinely needed):
1. Fetch all customer messages from slack.list_messages
2. Analyze sentiment and urgency for ALL messages using ai_processing
3. For each analyzed_message:
  4. If urgent:
    5. Create ticket in hubspot.create_ticket

❌ WRONG (AI inside loop - 10-50x cost waste!):
1. Read leads from google-sheets.read_range
2. For each lead:
  3. Classify priority using ai_processing  ← ❌ WASTEFUL!
  4. Send email using google-mail.send_email

❌ WRONG (unnecessary AI for structured data):
1. Read leads from google-sheets.read_range
2. Filter high-rank leads using ai_processing  ← ❌ SPREADSHEETS HAVE COLUMNS!
3. For each high_rank_lead: ...

GOLDEN RULE: Process ALL items with AI in ONE step BEFORE looping. Loops are ONLY for per-item plugin actions (send, create, update) or conditional routing.

ERROR HANDLING & MULTI-PLUGIN ORCHESTRATION:
- Anticipate common failures (not_found, invalid_data, quota_exceeded, timeout)
- Use conditionals to check for error states with fallback paths (If validation_passed: → save, Otherwise: → log_error + alert)
- Clearly specify which service performs each action (don't assume services can "talk to each other")
- Use AI as the "glue" between incompatible services (extract data from service_a format → AI transform → service_b format)

========================================
COMPLETE EXAMPLES (Study These Carefully)
========================================

EXAMPLE 1: Spreadsheet Workflow (NO AI NEEDED)
Request: "Email high-rank leads to their sales people"
Data source: Google Sheets with columns: name, email, rank, sales_person_email

✅ CORRECT OUTPUT:
Name: High-Rank Lead Notifier
Description: Sends email notifications for high-value leads to assigned sales people

1. Read lead data from google-sheets.read_range
2. For each lead:
  3. If {lead.rank} > 7:
    4. Send email to {lead.sales_person_email} using google-mail.send_email

Why this works:
- NO AI steps (spreadsheet has rank column - just compare it!)
- Field references: {lead.rank}, {lead.sales_person_email}
- Conditional inside loop for filtering

❌ WRONG OUTPUT (What NOT to do):
1. Read leads from google-sheets.read_range
2. Filter and extract high-rank leads using ai_processing  ← NO! rank is a column!
3. For each high_rank_lead:
  4. Get sales person email using ai_processing  ← NO! sales_person_email is a column!
  5. Format email using ai_processing  ← Unnecessary unless personalizing content
  6. Send email using google-mail.send_email

Why this fails:
- AI used for filtering (rank column exists - use If {lead.rank} > 7)
- AI used to "get email" (email is a column - reference {lead.sales_person_email})
- AI inside loop (wasteful - breaks batching principle)

EXAMPLE 2: Unstructured Text Analysis (AI IS NEEDED)
Request: "Respond to urgent customer support messages"
Data source: Slack messages (unstructured text - no "urgency" field!)

✅ CORRECT OUTPUT:
1. Fetch all messages from slack.list_messages
2. Analyze urgency and draft replies for ALL messages using ai_processing
3. For each analyzed_message:
  4. If {analyzed_message.is_urgent} equals true:
    5. Send reply to {analyzed_message.channel} using slack.send_message
    6. Create ticket in hubspot.create_ticket

Why this works:
- AI used BEFORE loop (batch processing ALL messages at once)
- AI appropriate (message text has no "urgency" field - needs semantic analysis)
- Conditional routing based on AI results

========================================
FINAL CHECKLIST - REVIEW YOUR OUTPUT
========================================

Before submitting, verify:

1. ✅ Is data from a spreadsheet/database/API?
   → Then NO AI for filtering/extracting fields (use If/Otherwise + direct field references)

2. ✅ Is there AI inside a "For each" loop?
   → If yes, move it BEFORE the loop to process ALL items at once

3. ✅ Did I use field names like {row.email}, {lead.rank}, {item.status}?
   → If not, you may be using unnecessary AI

4. ✅ Are ALL service names from CONNECTED SERVICES list?
   → If not, you hallucinated a service - fix it

5. ✅ Is output PLAIN TEXT with numbered steps?
   → No JSON, no markdown, no code blocks

6. ✅ Did I use 2-space indentation for nested steps?

If any check fails, revise your step plan before submitting.

========================================
REMEMBER: You are designing for a DETERMINISTIC ENGINE
========================================

The execution engine will:
✅ Execute plugin actions
✅ Reference data fields directly ({object.field})
✅ Evaluate conditionals (If {field} equals value)
✅ Iterate over arrays (For each item)

The execution engine will NOT:
❌ "Extract" or "get" fields (they're already there!)
❌ Make decisions (you specify logic with If/Otherwise)
❌ Use AI for filtering (conditionals handle this)

OUTPUT: Numbered steps with 2-space indentation. Use "If/Otherwise/For each" keywords. Reference CONNECTED SERVICES only.`;
  }

  /**
   * Build user prompt with enhanced prompt content
   */
  private buildUserPrompt(enhancedPrompt: string): string {
    return `Convert this execution plan into a workflow with name, description, and steps.

OUTPUT FORMAT:
Name: [Clear, short agent name - e.g., "LinkedIn HubSpot Sync Agent"]
Description: [1-2 sentences in simple language explaining what this agent does for the user]

Then the numbered steps:

${enhancedPrompt}

Remember:
- First line: "Name: [agent name]"
- Second line: "Description: [1-2 sentence summary]"
- Then numbered steps using "Do X using service.action" format
- Use 2-space indentation for nested steps`;
  }

  /**
   * Parse LLM output into structured StepPlan with conditional/loop detection
   */
  private parseStepPlan(rawOutput: string): StepPlan {
    // DEBUG: Log first 500 chars of raw output to verify indentation is present
    console.log('[Indent Debug] Raw output preview (first 500 chars):', JSON.stringify(rawOutput.substring(0, 500)));

    const lines = rawOutput.trim().split('\n');
    const steps: StepPlanLine[] = [];
    let agentName = '';
    let agentDescription = '';

    for (const line of lines) {
      if (!line || line.trim() === '') continue;

      const trimmed = line.trim();

      // Match numbered steps: "1. " or "1) "
      const stepMatch = trimmed.match(/^(\d+)[\.)]\s+(.+)$/);

      if (stepMatch) {
        const stepNumber = parseInt(stepMatch[1], 10);
        let description = stepMatch[2];

        // Calculate indentation level by counting LEADING spaces from the original line
        // The LLM puts spaces BEFORE the step number, not after the period
        // Example: "1. Read contacts" → 0 leading spaces → indent 0
        // Example: "  3. Look up contact" → 2 leading spaces → indent 1
        // Example: "    5. If contact exists" → 4 leading spaces → indent 2
        const leadingSpaces = line.length - trimmed.length;
        const indentLevel = Math.floor(leadingSpaces / 2); // 2 spaces per indent

        // DEBUG: Log indentation calculation for first 10 steps
        if (stepNumber <= 10) {
          console.log(`[Indent Debug] Step ${stepNumber}:`, {
            originalLine: JSON.stringify(line),
            trimmedLine: JSON.stringify(trimmed),
            originalLength: line.length,
            trimmedLength: trimmed.length,
            leadingSpaces,
            indentLevel,
            description: description.substring(0, 50)
          });
        }

        // Detect control flow keywords
        let controlFlowKeyword: 'if' | 'otherwise' | 'for_each' | undefined;
        let isCondition = false;
        let isLoop = false;

        const lowerDesc = description.toLowerCase();

        // Check for "If [condition]:"
        if (lowerDesc.startsWith('if ') && description.endsWith(':')) {
          controlFlowKeyword = 'if';
          isCondition = true;
          // Remove the colon from description
          description = description.slice(0, -1);
        }
        // Check for "Otherwise:"
        else if (lowerDesc === 'otherwise:') {
          controlFlowKeyword = 'otherwise';
          isCondition = true;
          description = 'Otherwise';
        }
        // Check for "For each [item]:"
        else if (lowerDesc.startsWith('for each ') && description.endsWith(':')) {
          controlFlowKeyword = 'for_each';
          isLoop = true;
          // Remove the colon from description
          description = description.slice(0, -1);
        }

        // Try to extract plugin.action if mentioned
        const actionMatch = description.match(/using\s+([a-z0-9_-]+)\.([a-z0-9_]+)/i);
        let suggestedPlugin: string | undefined;
        let suggestedAction: string | undefined;

        if (actionMatch) {
          suggestedPlugin = actionMatch[1];
          suggestedAction = actionMatch[2];
        } else {
          // Try simpler format: "using service_name" or "using ai_processing"
          const serviceMatch = description.match(/using\s+([a-z0-9_-]+)/i);
          if (serviceMatch) {
            const service = serviceMatch[1];
            if (service === 'ai_processing') {
              suggestedPlugin = 'ai_processing';
            } else {
              suggestedPlugin = service;
            }
          }
        }

        steps.push({
          stepNumber,
          description,
          suggestedPlugin,
          suggestedAction,
          rawLine: line, // Keep original line with indentation
          indentLevel,
          controlFlowKeyword,
          isCondition,
          isLoop,
        });
      } else if (steps.length === 0) {
        // Before steps start, look for Name: and Description: lines
        if (trimmed.startsWith('Name:')) {
          agentName = trimmed.substring(5).trim();
        } else if (trimmed.startsWith('Description:')) {
          agentDescription = trimmed.substring(12).trim();
        }
      }
    }

    if (steps.length === 0) {
      throw new Error('No valid steps found in LLM output');
    }

    // Use defaults if LLM didn't provide name/description
    if (!agentName) {
      agentName = 'Workflow Agent';
      console.warn('[Step Plan Extractor] No agent name found in LLM output, using default');
    }
    if (!agentDescription) {
      agentDescription = 'Executes a workflow to automate tasks';
      console.warn('[Step Plan Extractor] No agent description found in LLM output, using default');
    }

    console.log('[Step Plan Extractor] Parsed agent metadata:', {
      agentName,
      descriptionLength: agentDescription.length,
    });

    console.log('[Step Plan Extractor] Parsed steps with control flow:',
      steps.map(s => ({
        stepNum: s.stepNumber,
        indent: s.indentLevel,
        keyword: s.controlFlowKeyword,
        desc: s.description.substring(0, 50)
      }))
    );

    return {
      goal: agentName, // For backward compatibility
      agentName,
      description: agentDescription,
      steps,
      rawOutput,
    };
  }

  /**
   * Extract resolved user inputs from enhanced prompt
   * Enhanced prompt format: { "specifics": { "resolved_user_inputs": [{ "key": "...", "value": "..." }] } }
   */
  private extractResolvedInputs(enhancedPrompt: string): Record<string, string> {
    const resolvedInputs: Record<string, string> = {};

    try {
      // Try to parse as JSON
      const promptJson = JSON.parse(enhancedPrompt);

      // Extract from specifics.resolved_user_inputs array
      const resolved = promptJson?.specifics?.resolved_user_inputs;
      if (Array.isArray(resolved)) {
        for (const item of resolved) {
          if (item.key && item.value) {
            resolvedInputs[item.key] = item.value;
          }
        }
      }

      console.log('[Step Plan Extractor] Extracted resolved inputs:', resolvedInputs);
    } catch (error) {
      // Not JSON format, ignore
      console.log('[Step Plan Extractor] Enhanced prompt is not JSON, skipping resolved inputs extraction');
    }

    return resolvedInputs;
  }
}
