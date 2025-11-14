# Agent Creation and Execution Flow - Complete Walkthrough

**Date**: 2025-11-02
**Example**: Gmail → CRM → Slack → Google Drive Agent

---

## Your Example Agent

**User Prompt**:
> "Fetch emails from Gmail, check the data against my CRM, send the summary to Slack only if some threshold is defined, and create a summary report in Google Drive"

Let's trace through **exactly** how this agent is created and executed.

---

## Phase 1: Agent Creation (Smart Agent Builder)

### Step 1.1: User Submits Prompt

**Frontend**: User types prompt in Smart Agent Builder
**API Call**: `POST /api/generate-agent-v2`

```typescript
{
  prompt: "Fetch emails from Gmail, check the data against my CRM, send the summary to Slack only if some threshold is defined, and create a summary report in Google Drive",
  sessionId: "session-abc123"
}
```

---

### Step 1.2: Get User's Connected Plugins

**File**: [/app/api/generate-agent-v2/route.ts:92-102](../app/api/generate-agent-v2/route.ts#L92-L102)

```typescript
// Query user's plugin connections from database
const { data: pluginRows } = await supabase
  .from('plugin_connections')
  .select('plugin_key')
  .eq('user_id', user.id)

const connectedPluginKeys = pluginRows?.map(p => p.plugin_key) || []
// Example: ['google-mail', 'hubspot', 'slack', 'google-drive']

// Add platform plugins that don't need OAuth
const platformPlugins = ['chatgpt-research']
const allAvailablePlugins = [...connectedPluginKeys, ...platformPlugins]
```

**Result**: `['google-mail', 'hubspot', 'slack', 'google-drive', 'chatgpt-research']`

---

### Step 1.3: AgentKit Analyzes Prompt

**File**: [/lib/agentkit/analyzePrompt-v3-direct.ts:149-364](../lib/agentkit/analyzePrompt-v3-direct.ts#L149-L364)

**What Happens**: OpenAI GPT-4o analyzes the prompt with AgentKit intelligence

```typescript
const analysis = await analyzePromptDirectAgentKit(
  user.id,
  prompt,
  allAvailablePlugins
)
```

**AgentKit's System Prompt** includes:
1. List of all connected plugins with their available actions
2. Instructions to detect required inputs
3. Instructions to build workflow steps
4. Rules for plugin selection (don't add unnecessary plugins)
5. Output format requirements

**AgentKit Returns**:
```json
{
  "agent_name": "Email CRM Sync & Report Generator",
  "description": "Fetches emails from Gmail, enriches with CRM data, conditionally alerts via Slack, and creates Google Drive report",
  "workflow_type": "ai_external_actions",
  "suggested_plugins": [
    "google-mail",
    "hubspot",
    "slack",
    "google-drive"
  ],
  "required_inputs": [
    {
      "name": "threshold",
      "type": "number",
      "required": true,
      "description": "Threshold value for sending Slack alert",
      "placeholder": "Enter threshold (e.g., 5)",
      "reasoning": "User mentioned 'only if some threshold is defined'"
    },
    {
      "name": "email_query",
      "type": "text",
      "required": false,
      "description": "Gmail search query",
      "placeholder": "is:unread after:2025/01/01",
      "reasoning": "Optional filter for email search"
    }
  ],
  "workflow_steps": [
    {
      "operation": "Fetch recent emails from Gmail",
      "plugin": "google-mail",
      "plugin_action": "search_emails",
      "reasoning": "User wants to fetch emails from Gmail"
    },
    {
      "operation": "Check email senders against CRM",
      "plugin": "hubspot",
      "plugin_action": "get_contact_by_email",
      "reasoning": "User wants to check data against CRM"
    },
    {
      "operation": "Analyze and determine if threshold is met",
      "plugin": "ai_processing",
      "plugin_action": "process",
      "reasoning": "AI needs to evaluate if threshold condition is met"
    },
    {
      "operation": "Send summary to Slack if threshold met",
      "plugin": "slack",
      "plugin_action": "send_message",
      "reasoning": "User wants conditional Slack notification"
    },
    {
      "operation": "Create summary report in Google Drive",
      "plugin": "google-drive",
      "plugin_action": "create_file",
      "reasoning": "User wants to create a summary report"
    }
  ],
  "suggested_outputs": [
    {
      "name": "Email Summary Report",
      "type": "SummaryBlock",
      "category": "human-facing",
      "description": "Summary of emails checked against CRM",
      "format": "table",
      "reasoning": "User wants to see results"
    },
    {
      "name": "Google Drive Report",
      "type": "PluginAction",
      "category": "human-facing",
      "plugin": "google-drive",
      "description": "Link to created Google Drive document",
      "reasoning": "User wants report saved to Drive"
    }
  ],
  "reasoning": "This workflow requires fetching emails, enriching with CRM data, conditional logic for Slack alerts, and Drive report creation. All plugins are connected.",
  "confidence": 0.95,
  "tokensUsed": {
    "prompt": 1500,
    "completion": 800,
    "total": 2300
  }
}
```

**How AgentKit Determined This**:
- **Prompt analysis**: Identified 4 distinct actions (fetch, check, send, create)
- **Plugin detection**: Matched "Gmail" → `google-mail`, "CRM" → `hubspot`, "Slack" → `slack`, "Google Drive" → `google-drive`
- **Missing input detection**: Noticed "threshold" mentioned but value not provided → added to `required_inputs`
- **Conditional logic**: Detected "only if" → created `ai_processing` step for evaluation
- **Output inference**: User wants report → added SummaryBlock output

---

### Step 1.4: Generate System Prompt for Execution

**File**: [/lib/agentkit/analyzePrompt-v3-direct.ts:55-141](../lib/agentkit/analyzePrompt-v3-direct.ts#L55-L141)

**What It Does**: Creates an execution-optimized system prompt that will be used when the agent runs

```typescript
function generateExecutionSystemPrompt(
  userPrompt: string,
  workflowType: string,
  workflowSteps: AnalyzedWorkflowStep[],
  suggestedPlugins: string[]
): string
```

**Generated System Prompt** (stored in `agent.system_prompt`):
```
You are executing ai_external_actions automation.

OBJECTIVE:
Fetch emails from Gmail, check the data against my CRM, send the summary to Slack only if some threshold is defined, and create a summary report in Google Drive

WORKFLOW:
1. Fetch recent emails from Gmail (google-mail.search_emails)
2. Check email senders against CRM (hubspot.get_contact_by_email)
3. Analyze and determine if threshold is met (ai_processing.process)
4. Send summary to Slack if threshold met (slack.send_message)
5. Create summary report in Google Drive (google-drive.create_file)

AVAILABLE SERVICES:
google-mail, hubspot, slack, google-drive

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

RULE OF THUMB:
- Count of function calls should be: (# of data sources) + (# of destinations) + small constant
- NOT proportional to number of items being processed
- Most tasks: 2-5 function calls total, regardless of data volume
```

**Why This Matters**: When the agent executes via AgentKit, this system prompt guides the LLM to:
- Follow the workflow order
- Use function calls efficiently (no loops)
- Handle all AI processing natively
- Return structured results

---

### Step 1.5: Build Agent Record

**File**: [/app/api/generate-agent-v2/route.ts:166-236](../app/api/generate-agent-v2/route.ts#L166-L236)

**What It Does**: Transforms AgentKit's analysis into database-ready agent record

```typescript
const agentData = {
  user_id: user.id,
  agent_name: "Email CRM Sync & Report Generator",
  user_prompt: "Fetch emails from Gmail...",
  system_prompt: "You are executing ai_external_actions automation...", // From Step 1.4
  description: "Fetches emails from Gmail, enriches with CRM data...",

  // Plugins detected by AgentKit
  plugins_required: ["google-mail", "hubspot", "slack", "google-drive"],
  connected_plugins: ["google-mail", "hubspot", "slack", "google-drive"],

  // Inputs detected by AgentKit
  input_schema: [
    {
      name: "threshold",
      type: "number",
      required: true,
      description: "Threshold value for sending Slack alert",
      placeholder: "Enter threshold (e.g., 5)"
    },
    {
      name: "email_query",
      type: "text",
      required: false,
      description: "Gmail search query",
      placeholder: "is:unread after:2025/01/01"
    }
  ],

  // Outputs inferred from workflow
  output_schema: [
    {
      name: "Email Summary Report",
      type: "SummaryBlock",
      category: "human-facing",
      description: "Summary of emails checked against CRM",
      format: "table"
    },
    {
      name: "Google Drive Report",
      type: "PluginAction",
      category: "human-facing",
      plugin: "google-drive",
      description: "Link to created Google Drive document"
    }
  ],

  // ⚠️ CRITICAL: Workflow steps in LEGACY FORMAT
  // (Smart Agent Builder uses old format, Orchestrator converts it)
  workflow_steps: [
    {
      operation: "Fetch recent emails from Gmail",
      plugin: "google-mail",
      plugin_action: "search_emails",
      validated: true,
      type: "plugin_action"  // Legacy format
    },
    {
      operation: "Check email senders against CRM",
      plugin: "hubspot",
      plugin_action: "get_contact_by_email",
      validated: true,
      type: "plugin_action"  // Legacy format
    },
    {
      operation: "Analyze and determine if threshold is met",
      plugin: "ai_processing",
      plugin_action: "process",
      validated: true,
      type: "ai_processing"  // Legacy format
    },
    {
      operation: "Send summary to Slack if threshold met",
      plugin: "slack",
      plugin_action: "send_message",
      validated: true,
      type: "plugin_action"  // Legacy format
    },
    {
      operation: "Create summary report in Google Drive",
      plugin: "google-drive",
      plugin_action: "create_file",
      validated: true,
      type: "plugin_action"  // Legacy format
    }
  ],

  status: 'draft',
  mode: 'on_demand',
  created_from_prompt: "Fetch emails from Gmail...",
  ai_reasoning: "This workflow requires fetching emails, enriching with CRM data...",
  ai_confidence: 95,
  ai_generated_at: "2025-11-02T12:00:00Z"
}
```

---

### Step 1.6: Return to User (Not Saved Yet)

**API Response**: Returns agent preview to frontend for user confirmation

```json
{
  "agent": { /* agentData from above */ },
  "sessionId": "session-abc123",
  "message": "Agent generated successfully"
}
```

**User sees**:
- Agent name: "Email CRM Sync & Report Generator"
- Plugins: Gmail, HubSpot, Slack, Google Drive
- Required inputs: threshold, email_query (optional)
- 5 workflow steps preview
- Outputs: Summary table, Google Drive link

**User clicks "Create Agent"** → Saves to database

---

## Phase 2: Agent Execution (Workflow Orchestrator)

### Step 2.1: User Triggers Agent

**Frontend**: User fills in input form and clicks "Run"

```json
{
  "threshold": 10,
  "email_query": "is:unread after:2025/11/01"
}
```

**API Call**: `POST /api/run-agent`

```typescript
{
  agentId: "agent-abc123",
  userInput: "Run email sync",
  inputValues: {
    threshold: 10,
    email_query: "is:unread after:2025/11/01"
  }
}
```

---

### Step 2.2: Route to Orchestrator

**File**: [/app/api/run-agent/route.ts:123-140](../app/api/run-agent/route.ts#L123-L140)

```typescript
// Check if agent has workflow_steps
const workflowSteps = agent.workflow_steps || []

if (workflowSteps.length > 0 && orchestratorEnabled) {
  // ✅ Execute via Workflow Orchestrator
  console.log('🎯 Using Workflow Orchestrator')

  const orchestrator = new WorkflowOrchestrator(supabase)
  executionResult = await orchestrator.execute(
    agent,
    user.id,
    userInput,
    inputValues,
    sessionId
  )

  executionType = 'orchestrator'
}
```

**Decision**: Agent has 5 workflow steps → Use Orchestrator!

---

### Step 2.3: Orchestrator Initializes Execution

**File**: [/lib/orchestrator/WorkflowOrchestrator.ts:78-170](../lib/orchestrator/WorkflowOrchestrator.ts#L78-L170)

#### 2.3a: Check Orchestrator Enabled

```typescript
const orchestratorEnabled = await SystemConfigService.getBoolean(
  this.supabase,
  'workflow_orchestrator_enabled',
  false
)

if (!orchestratorEnabled) {
  throw new ExecutionError('Workflow orchestrator is disabled')
}
```

#### 2.3b: Parse Workflow Steps

**File**: [/lib/orchestrator/WorkflowParser.ts:101-144](../lib/orchestrator/WorkflowParser.ts#L101-L144)

**What It Does**: Converts legacy format to new format and builds dependency graph

```typescript
const executionPlan = this.parser.parse(workflowSteps)
```

**Input** (legacy format from Smart Agent Builder):
```json
[
  { "type": "plugin_action", "operation": "Fetch recent emails...", "plugin": "google-mail", ... },
  { "type": "plugin_action", "operation": "Check email senders...", "plugin": "hubspot", ... },
  { "type": "ai_processing", "operation": "Analyze and determine...", "plugin": "ai_processing", ... },
  { "type": "plugin_action", "operation": "Send summary to Slack...", "plugin": "slack", ... },
  { "type": "plugin_action", "operation": "Create summary report...", "plugin": "google-drive", ... }
]
```

**WorkflowParser.normalizeSteps()** converts to:
```json
[
  {
    "id": "step1",
    "type": "action",
    "name": "Fetch recent emails from Gmail",
    "plugin": "google-mail",
    "action": "search_emails",
    "params": {},
    "dependencies": []
  },
  {
    "id": "step2",
    "type": "action",
    "name": "Check email senders against CRM",
    "plugin": "hubspot",
    "action": "get_contact_by_email",
    "params": {},
    "dependencies": ["step1"]  // Should depend on step1 (but Smart Agent Builder doesn't add this yet)
  },
  {
    "id": "step3",
    "type": "ai_processing",
    "name": "Analyze and determine if threshold is met",
    "prompt": "Analyze and determine if threshold is met",
    "params": {},
    "dependencies": ["step1", "step2"]  // Should depend on both (not added by builder)
  },
  {
    "id": "step4",
    "type": "action",
    "name": "Send summary to Slack if threshold met",
    "plugin": "slack",
    "action": "send_message",
    "params": {},
    "dependencies": ["step3"]  // Should depend on step3 (not added by builder)
  },
  {
    "id": "step5",
    "type": "action",
    "name": "Create summary report in Google Drive",
    "plugin": "google-drive",
    "action": "create_file",
    "params": {},
    "dependencies": ["step3"]  // Should depend on step3 (not added by builder)
  }
]
```

**⚠️ Current Limitation**: Smart Agent Builder doesn't add `dependencies` field yet, so steps execute in parallel instead of sequentially. This is a known issue documented in [SMART_AGENT_BUILDER_ORCHESTRATOR_INTEGRATION.md](SMART_AGENT_BUILDER_ORCHESTRATOR_INTEGRATION.md#issue-2-missing-dependencies).

**ExecutionPlan** built:
```json
{
  "steps": [
    {
      "stepId": "step1",
      "stepDefinition": { /* step1 object */ },
      "dependencies": [],
      "level": 0,  // No dependencies = level 0
      "canRunInParallel": true
    },
    {
      "stepId": "step2",
      "stepDefinition": { /* step2 object */ },
      "dependencies": [],  // ⚠️ Should be ["step1"]
      "level": 0,  // ⚠️ Should be level 1
      "canRunInParallel": true
    },
    {
      "stepId": "step3",
      "stepDefinition": { /* step3 object */ },
      "dependencies": [],  // ⚠️ Should be ["step1", "step2"]
      "level": 0,  // ⚠️ Should be level 2
      "canRunInParallel": true
    },
    {
      "stepId": "step4",
      "stepDefinition": { /* step4 object */ },
      "dependencies": [],  // ⚠️ Should be ["step3"]
      "level": 0,  // ⚠️ Should be level 3
      "canRunInParallel": true
    },
    {
      "stepId": "step5",
      "stepDefinition": { /* step5 object */ },
      "dependencies": [],  // ⚠️ Should be ["step3"]
      "level": 0,  // ⚠️ Should be level 3
      "canRunInParallel": true
    }
  ],
  "parallelGroups": [],
  "totalSteps": 5,
  "estimatedDuration": 15000
}
```

#### 2.3c: Create workflow_executions Record

**File**: [/lib/orchestrator/StateManager.ts:31-73](../lib/orchestrator/StateManager.ts#L31-L73)

```typescript
const executionId = await this.stateManager.createExecution(
  agent,
  userId,
  sessionId,
  executionPlan,
  inputValues
)
```

**Database Insert** to `workflow_executions`:
```json
{
  "id": "exec-xyz789",
  "agent_id": "agent-abc123",
  "user_id": "user-123",
  "session_id": "session-abc123",
  "status": "running",
  "total_steps": 5,
  "execution_plan": {
    "steps": [ /* from executionPlan */ ],
    "parallelGroups": [],
    "totalSteps": 5,
    "estimatedDuration": 15000
  },
  "input_values": {
    "threshold": 10,
    "email_query": "is:unread after:2025/11/01"
  },
  "started_at": "2025-11-02T12:00:00Z"
}
```

#### 2.3d: Initialize ExecutionContext

**File**: [/lib/orchestrator/ExecutionContext.ts](../lib/orchestrator/ExecutionContext.ts)

**In-Memory State Object**:
```typescript
const context = new ExecutionContext(
  executionId,
  agent,
  userId,
  sessionId,
  inputValues
)
```

**Context Properties**:
```typescript
{
  executionId: "exec-xyz789",
  agent: { /* full agent object */ },
  userId: "user-123",
  sessionId: "session-abc123",
  inputValues: { threshold: 10, email_query: "is:unread after:2025/11/01" },

  // Step tracking (updated during execution)
  stepOutputs: Map(),  // Stores result of each step
  completedSteps: [],
  failedSteps: [],
  skippedSteps: [],
  currentStep: null,

  // Metrics
  totalTokensUsed: 0,
  totalExecutionTime: 0,
  startedAt: Date,

  // Memory context (loaded from past runs)
  memoryContext: null
}
```

#### 2.3e: Load Memory Context (Optional)

**File**: [/lib/orchestrator/WorkflowOrchestrator.ts:158-170](../lib/orchestrator/WorkflowOrchestrator.ts#L158-L170)

```typescript
const memoryInjector = new MemoryInjector(this.supabase)
const memoryContext = await memoryInjector.buildMemoryContext(
  agent.id,
  userId,
  { userInput, inputValues }
)
context.memoryContext = memoryContext
```

**Memory Context** (if past runs exist):
```json
{
  "summary": "Based on 3 past runs, this agent typically finds 15-20 emails and identifies 8-10 CRM matches",
  "token_count": 150,
  "memories": [
    { "run_number": 1, "summary": "...", "outcome": "success" },
    { "run_number": 2, "summary": "...", "outcome": "success" }
  ]
}
```

---

### Step 2.4: Execute Workflow Steps

**File**: [/lib/orchestrator/WorkflowOrchestrator.ts:289-317](../lib/orchestrator/WorkflowOrchestrator.ts#L289-L317)

**Flow**:
```typescript
const stepsByLevel = this.groupStepsByLevel(plan.steps)
// Level 0: [step1, step2, step3, step4, step5]  ⚠️ All level 0 due to missing dependencies

for (const [level, steps] of stepsByLevel.entries()) {
  for (const step of steps) {
    await this.executeSingleStep(step, context)
  }
}
```

**⚠️ Current Behavior**: All steps execute in parallel at level 0 (WRONG!)
**✅ Should Be**: Execute sequentially based on dependencies

Let me trace through what SHOULD happen (assuming dependencies were correct):

#### Level 0: Step 1 - Fetch Emails

**File**: [/lib/orchestrator/StepExecutor.ts:45-125](../lib/orchestrator/StepExecutor.ts#L45-L125)

```typescript
await this.stepExecutor.execute(step1, context)
```

**Step Definition**:
```json
{
  "id": "step1",
  "type": "action",
  "name": "Fetch recent emails from Gmail",
  "plugin": "google-mail",
  "action": "search_emails",
  "params": {}
}
```

**Resolve Parameters** ([StepExecutor.ts:171-178](../lib/orchestrator/StepExecutor.ts#L171-L178)):
```typescript
// Resolve {{input.email_query}} → "is:unread after:2025/11/01"
const resolvedParams = {
  query: "is:unread after:2025/11/01",
  maxResults: 20
}
```

**Execute via PluginExecuterV2** ([StepExecutor.ts:204-221](../lib/orchestrator/StepExecutor.ts#L204-L221)):
```typescript
const pluginExecuter = await PluginExecuterV2.getInstance()
const result = await pluginExecuter.execute(
  context.userId,
  'google-mail',
  'search_emails',
  resolvedParams
)
```

**PluginExecuterV2** ([/lib/server/plugin-executer-v2.ts](../lib/server/plugin-executer-v2.ts)):
1. Loads `google-mail` plugin definition
2. Validates `search_emails` action exists
3. Gets OAuth token from database
4. Makes API call to Gmail API
5. Returns formatted result

**Result**:
```json
{
  "success": true,
  "data": [
    {
      "id": "msg-1",
      "from": "john@example.com",
      "subject": "Meeting Request",
      "snippet": "Can we schedule a meeting?",
      "date": "2025-11-02T10:00:00Z"
    },
    {
      "id": "msg-2",
      "from": "jane@example.com",
      "subject": "Project Update",
      "snippet": "Here's the latest status...",
      "date": "2025-11-02T11:00:00Z"
    }
    // ... 18 more emails
  ]
}
```

**Store Output**:
```typescript
const stepOutput = {
  stepId: "step1",
  plugin: "google-mail",
  action: "search_emails",
  data: result.data,  // Array of 20 emails
  metadata: {
    success: true,
    executedAt: "2025-11-02T12:00:05Z",
    executionTime: 1234,
    tokensUsed: 0,
    itemCount: 20
  }
}

context.setStepOutput("step1", stepOutput)
```

**Checkpoint** ([StateManager.ts:78-108](../lib/orchestrator/StateManager.ts#L78-L108)):
```typescript
await this.stateManager.checkpoint(context)
```

**Database Update** to `workflow_executions`:
```json
{
  "id": "exec-xyz789",
  "status": "running",
  "current_step": "step2",
  "completed_steps_count": 1,
  "execution_trace": {
    "completedSteps": ["step1"],
    "stepExecutions": [
      {
        "stepId": "step1",
        "plugin": "google-mail",
        "action": "search_emails",
        "metadata": {
          "success": true,
          "executionTime": 1234,
          "itemCount": 20
        }
      }
    ]
  },
  "updated_at": "2025-11-02T12:00:05Z"
}
```

---

#### Level 1: Step 2 - Check CRM

**Step Definition**:
```json
{
  "id": "step2",
  "type": "action",
  "name": "Check email senders against CRM",
  "plugin": "hubspot",
  "action": "get_contact_by_email",
  "params": {}
}
```

**Resolve Parameters**:
```typescript
// Need to resolve {{step1.data[*].from}}
// This should extract all "from" emails from step1 result

const emails = context.resolveVariable("{{step1.data[*].from}}")
// → ["john@example.com", "jane@example.com", ...]
```

**⚠️ Loop Detected!** Need to call CRM for each email.

**File**: [/lib/orchestrator/ParallelExecutor.ts](../lib/orchestrator/ParallelExecutor.ts)

```typescript
// ParallelExecutor detects array → executes loop
const results = await this.parallelExecutor.executeLoop(step2, context)
```

**Executes in Parallel** (up to max 3 concurrent):
```typescript
for (const email of emails) {
  const result = await pluginExecuter.execute(
    context.userId,
    'hubspot',
    'get_contact_by_email',
    { email }
  )
  results.push(result)
}
```

**Results** (20 CRM lookups):
```json
[
  {
    "email": "john@example.com",
    "name": "John Smith",
    "company": "Acme Corp",
    "priority": "high",
    "deal_value": 50000
  },
  {
    "email": "jane@example.com",
    "name": "Jane Doe",
    "company": "TechCo",
    "priority": "medium",
    "deal_value": 25000
  },
  // ... 18 more contacts
]
```

**Store Output**:
```typescript
const stepOutput = {
  stepId: "step2",
  plugin: "hubspot",
  action: "get_contact_by_email",
  data: results,  // Array of 20 CRM contacts
  metadata: {
    success: true,
    executedAt: "2025-11-02T12:00:10Z",
    executionTime: 5000,  // 5 seconds for 20 API calls
    itemCount: 20
  }
}

context.setStepOutput("step2", stepOutput)
```

**Checkpoint** → Updates `workflow_executions`

---

#### Level 2: Step 3 - AI Decision (Threshold Check)

**Step Definition**:
```json
{
  "id": "step3",
  "type": "ai_processing",
  "name": "Analyze and determine if threshold is met",
  "prompt": "Analyze and determine if threshold is met",
  "params": {}
}
```

**Execute via AgentKit** ([StepExecutor.ts:227-250](../lib/orchestrator/StepExecutor.ts#L227-L250)):

```typescript
const llmResult = await this.executeLLMDecision(step3, params, context)
```

**Build Prompt with Context**:
```typescript
const prompt = `
Analyze and determine if threshold is met.

Available data:
- step1.data: [20 emails from Gmail]
- step2.data: [20 CRM contacts]
- input.threshold: 10

Context:
${context.memoryContext?.summary || 'No memory'}

Task: Determine if the number of high-priority CRM matches exceeds the threshold.
`
```

**Call AgentKit** ([StepExecutor.ts:237-250](../lib/orchestrator/StepExecutor.ts#L237-L250)):
```typescript
const agentKitResult = await runAgentKit(
  context.userId,
  {
    id: 'ai_decision_step',
    agent_name: 'Threshold Analyzer',
    system_prompt: 'You analyze data and make decisions',
    user_prompt: prompt,
    plugins_required: []
  },
  prompt,
  {},
  context.sessionId
)
```

**AgentKit Returns**:
```json
{
  "success": true,
  "response": "Analysis complete: Found 12 high-priority contacts out of 20 emails. Threshold of 10 is EXCEEDED.",
  "executionTime": 2000,
  "tokensUsed": {
    "prompt": 500,
    "completion": 100,
    "total": 600
  },
  "iterations": 1,
  "toolCalls": []
}
```

**Store Output**:
```typescript
const stepOutput = {
  stepId: "step3",
  plugin: "system",
  action: "ai_processing",
  data: {
    decision: "threshold_exceeded",
    reasoning: "Found 12 high-priority contacts, threshold is 10",
    should_alert: true,
    high_priority_count: 12
  },
  metadata: {
    success: true,
    executedAt: "2025-11-02T12:00:12Z",
    executionTime: 2000,
    tokensUsed: 600
  }
}

context.setStepOutput("step3", stepOutput)
context.totalTokensUsed += 600
```

**Checkpoint** → Updates `workflow_executions`

---

#### Level 3: Step 4 - Send Slack Alert (Conditional)

**Step Definition**:
```json
{
  "id": "step4",
  "type": "action",
  "name": "Send summary to Slack if threshold met",
  "plugin": "slack",
  "action": "send_message",
  "params": {},
  "executeIf": "{{step3.data.should_alert}}"  // ⚠️ Not added by builder yet
}
```

**Check Condition** ([WorkflowOrchestrator.ts:331-342](../lib/orchestrator/WorkflowOrchestrator.ts#L331-L342)):
```typescript
if (step.executeIf) {
  const shouldExecute = this.conditionalEvaluator.evaluate(
    step.executeIf,
    context
  )

  if (!shouldExecute) {
    context.markStepSkipped("step4")
    return
  }
}
```

**Condition Resolves**:
```typescript
// {{step3.data.should_alert}} → true
// Condition passes! Execute step.
```

**Resolve Parameters**:
```typescript
const resolvedParams = {
  channel: "#alerts",
  message: context.resolveVariable(`
    🚨 High-Priority Email Alert

    Found {{step3.data.high_priority_count}} high-priority contacts (threshold: {{input.threshold}})

    Top contacts:
    {{step2.data[0].name}} - {{step2.data[0].company}} (${{step2.data[0].deal_value}})
    {{step2.data[1].name}} - {{step2.data[1].company}} (${{step2.data[1].deal_value}})

    View full report in Google Drive (link will be generated)
  `)
}
```

**Resolved Message**:
```
🚨 High-Priority Email Alert

Found 12 high-priority contacts (threshold: 10)

Top contacts:
John Smith - Acme Corp ($50,000)
Jane Doe - TechCo ($25,000)

View full report in Google Drive (link will be generated)
```

**Execute via PluginExecuterV2**:
```typescript
const result = await pluginExecuter.execute(
  context.userId,
  'slack',
  'send_message',
  resolvedParams
)
```

**Result**:
```json
{
  "success": true,
  "data": {
    "messageId": "1234567890.123456",
    "channel": "C01234567",
    "timestamp": "1730563200.123456"
  }
}
```

**Store Output** → **Checkpoint**

---

#### Level 3: Step 5 - Create Google Drive Report

**Step Definition**:
```json
{
  "id": "step5",
  "type": "action",
  "name": "Create summary report in Google Drive",
  "plugin": "google-drive",
  "action": "create_file",
  "params": {}
}
```

**Resolve Parameters**:
```typescript
const resolvedParams = {
  name: `Email CRM Report - ${new Date().toISOString().split('T')[0]}`,
  mimeType: "application/vnd.google-apps.document",
  content: context.resolveVariable(`
    # Email CRM Sync Report
    **Date**: ${new Date().toLocaleDateString()}
    **Threshold**: {{input.threshold}}

    ## Summary
    - Total Emails: {{step1.data.length}}
    - CRM Matches: {{step2.data.length}}
    - High-Priority: {{step3.data.high_priority_count}}
    - Threshold: {{step3.data.decision}}

    ## Details
    ${generateTable(step1.data, step2.data)}
  `)
}
```

**Execute via PluginExecuterV2**:
```typescript
const result = await pluginExecuter.execute(
  context.userId,
  'google-drive',
  'create_file',
  resolvedParams
)
```

**Result**:
```json
{
  "success": true,
  "data": {
    "fileId": "1abcdefghijklmnop",
    "name": "Email CRM Report - 2025-11-02",
    "webViewLink": "https://docs.google.com/document/d/1abcdefghijklmnop/edit",
    "createdTime": "2025-11-02T12:00:15Z"
  }
}
```

**Store Output** → **Checkpoint**

---

### Step 2.5: Build Final Output

**File**: [/lib/orchestrator/WorkflowOrchestrator.ts:448-478](../lib/orchestrator/WorkflowOrchestrator.ts#L448-L478)

```typescript
const finalOutput = this.buildFinalOutput(context, agent.output_schema)
```

**Output Schema** (from agent definition):
```json
[
  {
    "name": "Email Summary Report",
    "type": "SummaryBlock",
    "source": "step3.data"  // ⚠️ Not added by builder yet
  },
  {
    "name": "Google Drive Report",
    "type": "PluginAction",
    "source": "step5.data.webViewLink"  // ⚠️ Not added by builder yet
  }
]
```

**Final Output**:
```json
{
  "Email Summary Report": {
    "decision": "threshold_exceeded",
    "reasoning": "Found 12 high-priority contacts, threshold is 10",
    "high_priority_count": 12
  },
  "Google Drive Report": "https://docs.google.com/document/d/1abcdefghijklmnop/edit"
}
```

---

### Step 2.6: Complete Execution

**File**: [/lib/orchestrator/StateManager.ts:113-143](../lib/orchestrator/StateManager.ts#L113-L143)

```typescript
await this.stateManager.completeExecution(executionId, finalOutput, context)
```

**Database Update** to `workflow_executions`:
```json
{
  "id": "exec-xyz789",
  "status": "completed",
  "completed_at": "2025-11-02T12:00:15Z",
  "final_output": {
    "Email Summary Report": { /* ... */ },
    "Google Drive Report": "https://docs.google.com/..."
  },
  "completed_steps_count": 5,
  "failed_steps_count": 0,
  "skipped_steps_count": 0,
  "execution_trace": {
    "completedSteps": ["step1", "step2", "step3", "step4", "step5"],
    "stepExecutions": [ /* all 5 steps with metadata */ ]
  },
  "total_tokens_used": 600,
  "total_execution_time_ms": 13234
}
```

---

### Step 2.7: Post-Execution Tasks (Async)

#### Update AIS Metrics

**File**: [/lib/orchestrator/WorkflowOrchestrator.ts:524-548](../lib/orchestrator/WorkflowOrchestrator.ts#L524-L548)

```typescript
await updateAgentIntensityMetrics(this.supabase, {
  agent_id: agent.id,
  execution_id: context.executionId,
  status: 'success',
  duration_ms: 13234,
  tokens_used: 600,
  plugin_calls: 4,  // step1, step2 (x20), step4, step5
  workflow_steps_executed: 5,
  iterations: 1,
  model_used: 'workflow',
  provider: 'orchestrator'
})
```

#### Summarize for Memory

**File**: [/lib/orchestrator/WorkflowOrchestrator.ts:553-590](../lib/orchestrator/WorkflowOrchestrator.ts#L553-L590)

```typescript
const memorySummarizer = new MemorySummarizer(this.supabase)
await memorySummarizer.summarizeExecution({
  execution_id: executionId,
  agent_id: agent.id,
  user_id: userId,
  run_number: 4,  // 4th run
  agent_name: "Email CRM Sync & Report Generator",
  input: { threshold: 10, email_query: "..." },
  output: finalOutput,
  status: 'success',
  execution_time_ms: 13234
})
```

**Memory Saved** to `run_memories`:
```json
{
  "agent_id": "agent-abc123",
  "user_id": "user-123",
  "run_number": 4,
  "summary": "Successfully synced 20 emails with CRM. Found 12 high-priority contacts (above threshold of 10). Sent Slack alert and created Google Drive report.",
  "outcome": "success",
  "key_insights": [
    "High-priority contacts exceeded threshold",
    "20 emails processed",
    "12 CRM matches found"
  ]
}
```

---

## Phase 3: Return Results to User

### Step 3.1: Orchestrator Returns Result

**File**: [/lib/orchestrator/WorkflowOrchestrator.ts:238-247](../lib/orchestrator/WorkflowOrchestrator.ts#L238-L247)

```typescript
return {
  success: true,
  executionId: "exec-xyz789",
  output: finalOutput,
  stepsCompleted: 5,
  stepsFailed: 0,
  stepsSkipped: 0,
  totalExecutionTime: 13234,
  totalTokensUsed: 600
}
```

---

### Step 3.2: API Route Logs to agent_logs

**File**: [/app/api/run-agent/route.ts:319-370](../app/api/run-agent/route.ts#L319-L370)

```typescript
await supabase.from('agent_logs').insert({
  agent_id: agent.id,
  user_id: user.id,
  run_output: JSON.stringify({
    success: true,
    orchestrator: true,
    stepsCompleted: 5,
    tokensUsed: 600,
    executionTimeMs: 13234
  }),
  full_output: {
    orchestrator_metadata: {
      executionId: "exec-xyz789",
      stepsCompleted: 5,
      stepsFailed: 0,
      tokensUsed: 600
    }
  },
  status: "✅ Orchestrator execution completed successfully",
  created_at: "2025-11-02T12:00:15Z"
})
```

---

### Step 3.3: API Route Returns to Frontend

```json
{
  "success": true,
  "message": "Successfully synced 20 emails with CRM. Found 12 high-priority contacts.",
  "data": {
    "execution_id": "exec-xyz789",
    "steps_completed": 5,
    "total_execution_time_ms": 13234,
    "total_tokens_used": 600,
    "outputs": {
      "Email Summary Report": {
        "decision": "threshold_exceeded",
        "high_priority_count": 12
      },
      "Google Drive Report": "https://docs.google.com/document/d/1abcdefghijklmnop/edit"
    }
  },
  "orchestrator": true
}
```

---

### Step 3.4: User Sees Results

**Frontend displays**:
- ✅ Agent execution completed successfully
- 📊 Summary: 12 high-priority contacts found (threshold: 10)
- 📄 View report: [Link to Google Drive document]
- 📧 Slack notification sent to #alerts
- ⏱️ Execution time: 13.2 seconds
- 🔢 Credits used: 1 (600 tokens ÷ 1000)

---

## Summary

### How Steps Are Created

1. **User prompt** → Smart Agent Builder
2. **AgentKit analyzes** prompt with connected plugins context
3. **AgentKit generates** workflow steps in legacy format:
   - `type: "plugin_action"` or `type: "ai_processing"`
   - `operation` (description)
   - `plugin` + `plugin_action`
4. **Steps saved** to `agent.workflow_steps` JSONB field

### How Steps Are Handled

1. **WorkflowParser** converts legacy format to new format:
   - Auto-generates `id` (step1, step2, etc.)
   - Converts `operation` → `name`
   - Converts `plugin_action` → `action`
   - Adds `dependencies: []` (should be detected but not yet implemented)

2. **Execution Plan** builds dependency graph:
   - Groups steps by level (based on dependencies)
   - Detects parallel execution opportunities
   - ⚠️ Currently all steps are level 0 due to missing dependencies

3. **StepExecutor** routes each step:
   - `type: "action"` → PluginExecuterV2 (external API call)
   - `type: "ai_processing"` → AgentKit (LLM decision)
   - `type: "conditional"` → ConditionalEvaluator
   - `type: "loop"` → ParallelExecutor

4. **ExecutionContext** manages state:
   - Stores output of each step in memory
   - Enables variable resolution: `{{step1.data.field}}`
   - Tracks metrics (tokens, time)

5. **StateManager** persists to database:
   - Creates `workflow_executions` record at start
   - Checkpoints after each step
   - Stores sanitized execution trace

### Current Limitations

1. **❌ Missing Dependencies**: Smart Agent Builder doesn't add `dependencies` field
   - **Impact**: Steps execute in parallel instead of sequentially
   - **Fix**: Update `analyzePrompt-v3-direct.ts` to detect dependencies

2. **❌ Missing Parameter References**: Steps don't reference previous step outputs
   - **Impact**: Parameters are empty, execution fails
   - **Fix**: Add parameter mapping like `{{step1.data[*].from}}`

3. **❌ Missing executeIf Conditions**: Conditional execution not configured
   - **Impact**: Steps always execute (no true conditional logic)
   - **Fix**: Add `executeIf` field based on conditions

4. **❌ workflow_step_executions Not Populated**: Individual step logging not implemented
   - **Impact**: No detailed step timeline
   - **Fix**: Inject StateManager into StepExecutor

### What Works Today

✅ Agent creation via AgentKit intelligence
✅ Workflow step generation
✅ Legacy format conversion
✅ Orchestrator execution
✅ Plugin action execution
✅ AI processing via AgentKit
✅ High-level workflow tracking
✅ Unified logging to agent_logs
✅ AIS intensity tracking
✅ Memory summarization

---

## Next Steps

Would you like me to fix any of these issues?

1. **Add dependencies detection** to Smart Agent Builder
2. **Add parameter mapping** to workflow steps
3. **Implement step-level logging** to workflow_step_executions table
4. **Add conditional execution** support
