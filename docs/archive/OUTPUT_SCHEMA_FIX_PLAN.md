# Output Schema Fix - Implementation Plan

## 🎯 Goal
Fix output generation to:
1. Use AgentKit SDK to infer outputs from user prompt
2. Respect clarification answers (email_me vs alert_me for notifications)
3. Always include smart defaults (Email/Alert, SummaryBlock, Metadata)
4. NOT break existing agents

---

## 🔍 Current Flow Analysis

### Clarification Question (Already Working)
Location: `/app/api/generate-clarification-questions/route.ts` (lines 51-78)

```typescript
{
  id: 'error_handling_standard',
  question: 'If something goes wrong, how should I be notified?',
  type: 'select',
  options: [
    { value: 'email_me', label: 'Email me' },
    { value: 'alert_me', label: 'Alert me' },
    { value: 'retry_once', label: 'Retry (one time)' }
  ]
}
```

User's answer stored in: `clarificationAnswers.error_handling_standard`

### Current Output Generation (BROKEN)
Location: `/app/api/generate-agent-v2/route.ts` (line 156-161)

```typescript
// ❌ PROBLEM: Uses enhanceOutputInference() which ignores clarificationAnswers
const outputInference = enhanceOutputInference(
  prompt,
  clarificationAnswers || {},  // ← Passed but NOT USED inside!
  analysis.suggested_plugins,
  analysis.workflow_steps
)
```

Location: `/lib/outputInference.ts` (lines 99-109)

```typescript
// ❌ PROBLEM: Hardcodes outputs, ignores clarificationAnswers parameter
outputs.push({
  name: 'Execution Summary',
  type: 'string',
  description: '...',
  category: 'human-facing'
})
```

---

## 🛠️ Implementation Plan

### Phase 1: Extend AgentKit SDK to Generate Outputs ✅

**File**: `/lib/agentkit/analyzePrompt-v3-direct.ts`

**Changes**:

1. **Add to TypeScript interface** (line 23):
```typescript
export interface PromptAnalysisResult {
  agent_name: string;
  description: string;
  workflow_type: 'pure_ai' | 'data_retrieval_ai' | 'ai_external_actions';
  suggested_plugins: string[];
  required_inputs: AnalyzedInput[];
  workflow_steps: AnalyzedWorkflowStep[];

  // NEW: Output suggestions
  suggested_outputs: AnalyzedOutput[];

  reasoning: string;
  confidence: number;
  tokensUsed?: { ... };
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
```

2. **Update system prompt** (line 82-120) to include output examples:
```typescript
# Response Format:
Return a JSON object with:
{
  "agent_name": "...",
  "suggested_plugins": [...],
  "workflow_steps": [...],

  // NEW: Output configuration
  "suggested_outputs": [
    {
      "name": "Research Report",
      "type": "SummaryBlock",
      "category": "human-facing",
      "description": "AI research results",
      "format": "table",  // ← CRITICAL: Detect format from prompt!
      "reasoning": "User mentioned 'table format' in prompt"
    },
    {
      "name": "Gmail Delivery",
      "type": "PluginAction",
      "category": "human-facing",
      "plugin": "google-mail",
      "description": "Send results via email",
      "reasoning": "User wants to email the results"
    }
  ],
  "reasoning": "...",
  "confidence": 0.95
}

# Output Format Detection Rules:
- If prompt mentions "table", "spreadsheet", "rows/columns" → format: "table"
- If prompt mentions "list", "bullet points" → format: "list"
- If prompt mentions "markdown", "formatted text" → format: "markdown"
- If prompt mentions "JSON", "data structure" → format: "json"
- Default → format: "text"
```

3. **Parse and return** suggested_outputs (line 148):
```typescript
const analysis = JSON.parse(rawResponse);

return {
  agent_name: analysis.agent_name,
  description: analysis.description,
  workflow_type: analysis.workflow_type,
  suggested_plugins: analysis.suggested_plugins,
  required_inputs: analysis.required_inputs,
  workflow_steps: analysis.workflow_steps,
  suggested_outputs: analysis.suggested_outputs || [],  // NEW
  reasoning: analysis.reasoning,
  confidence: analysis.confidence,
  tokensUsed: { ... }
};
```

---

### Phase 2: Update Output Inference to Respect Clarifications ✅

**File**: `/lib/outputInference.ts`

**Changes**:

1. **Update function signature** (line 18):
```typescript
export function enhanceOutputInference(
  prompt: string,
  clarificationAnswers: Record<string, any>,  // ← Actually USE this now!
  connectedPluginKeys: string[],
  workflowSteps?: any[],
  sdkSuggestedOutputs?: any[]  // NEW: From AgentKit SDK
): OutputInference
```

2. **NEW function to build smart defaults** (add after line 441):
```typescript
function buildSmartDefaults(
  clarificationAnswers: Record<string, any>,
  userEmail: string
): OutputSchema[] {
  const defaults: OutputSchema[] = [];

  // 1. Notification based on clarification answer
  const errorHandling = clarificationAnswers.error_handling_standard;

  if (errorHandling === 'email_me') {
    defaults.push({
      name: 'Error Notification',
      type: 'EmailDraft',
      category: 'system',
      description: 'Email notification when execution fails',
      config: {
        recipient: userEmail,
        subject: 'Agent Execution Failed',
        trigger: 'on_error'
      }
    });
  } else if (errorHandling === 'alert_me') {
    defaults.push({
      name: 'Error Alert',
      type: 'Alert',
      category: 'system',
      description: 'Dashboard alert when execution fails',
      config: {
        trigger: 'on_error'
      }
    });
  } else {
    // Default if no clarification answer (backward compatibility)
    defaults.push({
      name: 'Error Notification',
      type: 'EmailDraft',
      category: 'system',
      description: 'Email notification when execution fails',
      config: {
        recipient: userEmail,
        subject: 'Agent Execution Failed',
        trigger: 'on_error'
      }
    });
  }

  // 2. Always add SummaryBlock
  defaults.push({
    name: 'Execution Summary',
    type: 'SummaryBlock',
    category: 'human-facing',
    description: 'Complete status with success/failure details and important notes',
    examples: [
      'Successfully completed all tasks',
      'Completed with 1 warning',
      'Failed at step 3 - check configuration'
    ]
  });

  // 3. Always add Process Metadata
  defaults.push({
    name: 'Process Metadata',
    type: 'object',
    category: 'machine-facing',
    description: 'Technical details about execution including timing, counts, and performance data'
  });

  return defaults;
}
```

3. **Update main function** (lines 24-72):
```typescript
export function enhanceOutputInference(
  prompt: string,
  clarificationAnswers: Record<string, any>,
  connectedPluginKeys: string[],
  workflowSteps?: any[],
  sdkSuggestedOutputs?: any[],
  userEmail?: string
): OutputInference {
  try {
    console.log('🎯 Building output schema from SDK + smart defaults...');

    const outputs: OutputSchema[] = [];

    // 1. START WITH SDK-SUGGESTED OUTPUTS
    if (sdkSuggestedOutputs && sdkSuggestedOutputs.length > 0) {
      console.log(`📦 Adding ${sdkSuggestedOutputs.length} outputs from AgentKit SDK`);
      outputs.push(...sdkSuggestedOutputs.map(o => ({
        name: o.name,
        type: o.type,
        category: o.category,
        description: o.description,
        examples: o.examples || [],
        format: o.format,
        plugin: o.plugin
      })));
    } else {
      // Fallback: Generate from plugins if SDK didn't provide outputs
      console.log('📦 SDK provided no outputs, generating from plugins...');
      const pluginOutputs = generateOutputsFromRegistry(prompt, workflowSteps, connectedPluginKeys);
      outputs.push(...pluginOutputs);
    }

    // 2. ADD SMART DEFAULTS (respecting clarifications)
    const defaults = buildSmartDefaults(clarificationAnswers, userEmail || 'user@email.com');
    console.log(`📋 Adding ${defaults.length} smart defaults`);
    outputs.push(...defaults);

    return {
      outputs,
      confidence: 0.9,
      reasoning: `Generated ${outputs.length} outputs: ${sdkSuggestedOutputs?.length || 0} from SDK + ${defaults.length} defaults`
    };

  } catch (error) {
    console.error('❌ Output inference failed:', error);

    // Safe fallback
    return {
      outputs: buildSmartDefaults(clarificationAnswers, userEmail || 'user@email.com'),
      confidence: 0.5,
      reasoning: 'Using fallback defaults due to error'
    };
  }
}
```

---

### Phase 3: Update Agent Generation API ✅

**File**: `/app/api/generate-agent-v2/route.ts`

**Changes** (line 54-161):

```typescript
// Get current user for email
const { data: { user }, error: authError } = await supabase.auth.getUser()
if (authError || !user) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

// ... existing code ...

// Line 156-161: REPLACE enhanceOutputInference call
const outputInference = enhanceOutputInference(
  prompt,
  clarificationAnswers || {},
  analysis.suggested_plugins,
  analysis.workflow_steps,
  analysis.suggested_outputs || [],  // NEW: Pass SDK outputs
  user.email  // NEW: Pass user email for notifications
)

// Rest stays the same
const agentData = {
  // ...
  output_schema: outputInference.outputs,  // Now includes SDK + smart defaults
  // ...
}
```

---

### Phase 4: Use Output Schema in Agent Execution ✅

**File**: `/lib/agentkit/runAgentKit.ts`

**Changes** (lines 136-164):

**REPLACE** hardcoded delivery logic:
```typescript
// ❌ OLD CODE (lines 137-153)
const triggerConfig = agent.trigger_condintion?.error_handling || {};
const deliveryMethod = triggerConfig.on_failure || 'alert';

let deliveryInstructions = '';
if (deliveryMethod === 'email') {
  deliveryInstructions = `\n\n## IMPORTANT: Result Delivery...`;
} else {
  deliveryInstructions = `\n\n## IMPORTANT: Result Delivery...`;
}
```

**WITH** schema-driven instructions:
```typescript
// ✅ NEW CODE
const outputInstructions = generateOutputInstructions(agent.output_schema);

function generateOutputInstructions(outputs: any[]): string {
  if (!outputs || outputs.length === 0) {
    return `\n\n## Output Instructions:\n- Return results for dashboard display`;
  }

  // Filter out error-only outputs
  const activeOutputs = outputs.filter(o => o.config?.trigger !== 'on_error');

  if (activeOutputs.length === 0) {
    return `\n\n## Output Instructions:\n- Return results for dashboard display`;
  }

  const instructions = activeOutputs.map(output => {
    switch (output.type) {
      case 'EmailDraft':
        return `- Send results via email${output.config?.recipient ? ` to ${output.config.recipient}` : ''}`;

      case 'SummaryBlock':
        const format = output.format || 'text';
        if (format === 'table') {
          return `- Format results as an HTML table with clear columns and rows`;
        } else if (format === 'list') {
          return `- Format results as a bulleted or numbered list`;
        } else if (format === 'markdown') {
          return `- Format results using markdown formatting`;
        } else {
          return `- Provide a clear summary of results`;
        }

      case 'PluginAction':
        return `- Save results using ${output.plugin || 'the appropriate plugin'}`;

      case 'Alert':
        return `- Return results for dashboard display`;

      default:
        return `- ${output.description}`;
    }
  }).join('\n');

  return `\n\n## Output Requirements:\n${instructions}`;
}

// Use it in system prompt (line 155-164)
const systemPrompt = `${agent.system_prompt || agent.enhanced_prompt || agent.user_prompt}

${pluginContext}

## Instructions
- Use the available functions to accomplish the user's request
- Do NOT provide generic advice or suggestions - execute actual actions using the connected services
- If an action fails, try an alternative approach or inform the user clearly about what went wrong
- Provide specific results based on the actual data returned from function calls
- Always use the most appropriate function for the task${outputInstructions}`;
```

---

## 🧪 Testing Strategy

### Test 1: New Agent with Table Format
**Prompt**: "Research AI trends and send me a table summary via email"
**Expected**:
- SDK detects `format: "table"` from "table summary"
- Agent receives instruction: "Format results as an HTML table"
- Email contains actual HTML table ✅

### Test 2: Clarification Answer - Email
**Clarification**: `error_handling_standard: "email_me"`
**Expected**:
- output_schema includes `Error Notification` (EmailDraft)
- No error alert added ✅

### Test 3: Clarification Answer - Alert
**Clarification**: `error_handling_standard: "alert_me"`
**Expected**:
- output_schema includes `Error Alert` (Alert type)
- No error email added ✅

### Test 4: Existing Agent (Backward Compatibility)
**Agent**: Created before this fix
**Expected**:
- Still works with old `trigger_condintion` logic if `output_schema` is empty
- No breaking changes ✅

### Test 5: Multi-Output Agent
**Prompt**: "Research topic, save to Notion, and email me"
**Expected**:
- SDK suggests: Research output + Notion save + Email
- Smart defaults: Error notification + Summary + Metadata
- Total: 6 outputs ✅

---

## ⚠️ Safety Measures

### Backward Compatibility
```typescript
// In runAgentKit.ts - fallback logic
const outputInstructions = (agent.output_schema && agent.output_schema.length > 0)
  ? generateOutputInstructions(agent.output_schema)
  : generateLegacyInstructions(agent.trigger_condintion);  // Old behavior

function generateLegacyInstructions(triggerConfig: any): string {
  const deliveryMethod = triggerConfig?.error_handling?.on_failure || 'alert';
  // ... existing hardcoded logic for old agents
}
```

### Error Handling
- If SDK fails to generate outputs → Use plugin-based inference
- If plugin inference fails → Use smart defaults only
- Always have at least error notification + summary + metadata

### Validation
- Ensure `output_schema` is an array
- Validate each output has required fields (name, type, category)
- Default missing formats to 'text'

---

## 📋 Implementation Checklist

- [ ] Update `/lib/agentkit/analyzePrompt-v3-direct.ts`
  - [ ] Add `AnalyzedOutput` interface
  - [ ] Add `suggested_outputs` to `PromptAnalysisResult`
  - [ ] Update system prompt with output examples
  - [ ] Parse and return `suggested_outputs`

- [ ] Update `/lib/outputInference.ts`
  - [ ] Add `buildSmartDefaults()` function
  - [ ] Update `enhanceOutputInference()` signature
  - [ ] Accept and use `sdkSuggestedOutputs` parameter
  - [ ] Respect `clarificationAnswers.error_handling_standard`

- [ ] Update `/app/api/generate-agent-v2/route.ts`
  - [ ] Pass `analysis.suggested_outputs` to `enhanceOutputInference()`
  - [ ] Pass `user.email` for notification recipient

- [ ] Update `/lib/agentkit/runAgentKit.ts`
  - [ ] Add `generateOutputInstructions()` function
  - [ ] Replace hardcoded delivery logic with schema-driven
  - [ ] Add backward compatibility fallback

- [ ] Testing
  - [ ] Test new agent with table format
  - [ ] Test clarification: email_me
  - [ ] Test clarification: alert_me
  - [ ] Test existing agent (no breaking changes)
  - [ ] Test multi-output agent

---

## 🎯 Expected Outcome

**Before**:
- Outputs hardcoded, ignore clarifications
- Format always plain text/markdown
- Email vs Alert based on `trigger_condintion` only

**After**:
- Outputs from AgentKit SDK (detects format from prompt)
- Clarifications control error notifications (email vs alert)
- Smart defaults always included
- Backward compatible with existing agents ✅
