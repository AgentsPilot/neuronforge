# Workflow Generation Fix: Complete System Analysis and Implementation Plan

## Executive Summary

The AI workflow generation system has a **fundamental architectural flaw** that causes inconsistent and failing workflows. The problem originates in the **Clarification Questions phase** and cascades through the entire system.

**Impact**: Same user request generates working workflows on one build, failing workflows on another build.

**Root Cause**: AI asks users to "identify outputs" and "define data structures" BEFORE seeing what plugins actually output, causing it to guess incorrectly during workflow generation.

---

## Problem Flow Diagram

```
❌ CURRENT (BROKEN) FLOW:

1. User: "Find unique sales people in my spreadsheet"

2. Clarification AI: "What output format do you want?"
   User: ??? (doesn't know plugin output structure)

3. Enhanced Prompt: Creates vague execution plan

4. Stage 1 Workflow AI: Only sees field NAMES ['values', 'row_count']
   → Guesses 'values' structure (array of objects? 2D array?)
   → Creates: field: "Sales Person" (assumes objects)

5. Execution: FAILS
   → Actual data: [["Name", "Sales Person"], ["John", "Alice"]]
   → Tried to access: item['Sales Person']
   → Result: undefined

✅ CORRECT FLOW (AFTER FIX):

1. User: "Find unique sales people in my spreadsheet"

2. Clarification AI: "Which column contains sales person names?"
   User: "Sales Person"

3. Enhanced Prompt: "For each row, use the 'Sales Person' column"

4. Stage 1 Workflow AI: Sees 'values: array<array>' type hint
   → Knows it's a 2D array
   → Creates: column: "{{input.column_name}}"
   → Asks user via required_inputs

5. Execution: SUCCESS
   → User provides: {column_name: "Sales Person"}
   → Runtime converts: "Sales Person" → index 1
   → Accesses: row[1]
```

---

## Three-Phase Fix Strategy

### Phase 1: Fix Clarification Questions (PRIORITY 1)
**Responsibility**: Developer handling conversational flow
**Files**: `app/api/prompt-templates/Clarification-Questions-Agent.txt`

### Phase 2: Enhance Enhanced Prompt (PRIORITY 1)
**Responsibility**: Developer handling conversational flow
**Files**: `app/api/enhance-prompt/route.ts`

### Phase 3: Enhance Stage 1 Workflow Designer (PRIORITY 2)
**Responsibility**: Different developer (workflow generation)
**Files**:
- `lib/server/plugin-manager-v2.ts`
- `lib/agentkit/stage1-workflow-designer.ts`
- `lib/agentkit/stage2-parameter-filler.ts`
- `lib/pilot/StepExecutor.ts`

---

## PHASE 1 & 2: Clarification/Enhancement (FOR CONVERSATIONAL FLOW DEVELOPER)

### Phase 1: Fix Clarification Questions Prompt

**File**: `/app/api/prompt-templates/Clarification-Questions-Agent.txt`

**Problem Identification** (Lines 31-50):

```markdown
❌ CURRENT PROBLEMATIC SECTION:

**Data & Input Sources (data_input)**
- What specific data does the automation need?
- Which connected plugins contain this data?
- Any filters, criteria, or timeframes needed?

**Processing & Logic (processing_logic)**
- What operations should be performed?
- What format should outputs take?  ← WRONG: Asks user to define output
- Any conditional rules or decision points?

**Output & Actions (output_actions)** ← WRONG: Asks about structure before seeing plugin output
- How should results be delivered?
- Where should results go using connected plugins?
- What delivery method should be used?
```

**Why This Is Wrong**:
- AI asks user "what format should outputs take?" but user doesn't know plugin internals
- AI asks about output structure before knowing what the plugin actually outputs
- Forces user to make technical decisions about data structures
- Results in guessing during workflow generation

**The Fix** - Replace lines 31-50 with:

```markdown
**Data & Input Sources (data_input)**
- What specific data does the automation need?
- Which connected plugins contain this data?
- CRITICAL: If data comes from structured sources (sheets, databases, CRMs):
  * Ask: "Which column/field contains [the data you need]?"
  * Example: "Which column has the customer emails?"
  * Example: "Which field identifies the contact status?"
  * DO NOT ask for column indices, positions, or data structures
- Any filters, criteria, or timeframes needed?

**Processing & Logic (processing_logic)**
- What operations should be performed on the data?
- Any conditional rules or decision points?
- ❌ NEVER ASK: "What format should outputs take?" - this is determined by plugins
- ❌ NEVER ASK: "What structure should data have?" - this comes from plugin schemas

**Output & Actions (output_actions)**
- How should FINAL RESULTS be delivered? (email, message, notification)
- Where should results go? (which service/person to send TO)
- ❌ DO NOT ASK about intermediate data formats - determined by plugin outputs
- ❌ DO NOT ASK user to "identify the output structure"
```

**Add New Section** (After line 50, before "QUESTION GENERATION RULES"):

```markdown
## CRITICAL DATA STRUCTURE HANDLING RULES

When generating questions for different plugin types:

### 1. Spreadsheets (Google Sheets, Excel, CSV)
**Plugin Output**: 2D arrays like `[["Header1", "Header2"], ["Data1", "Data2"]]`

**CORRECT Questions**:
- "Which column contains the [data you need]?"
- "What column has the sales person names?"
- "Which column should I use to identify duplicates?"

**WRONG Questions** (NEVER ask these):
- ❌ "What is the column index?" (too technical)
- ❌ "Provide the 0-based column number" (developer jargon)
- ❌ "What output structure do you want?" (user doesn't know)
- ❌ "Define the data schema" (meaningless to users)

### 2. CRMs and Databases (Airtable, HubSpot, Salesforce)
**Plugin Output**: Arrays of objects like `[{fields: {Name: "John", Email: "..."}}, ...]`

**CORRECT Questions**:
- "Which field should I check for [condition]?"
- "What field identifies duplicate contacts?"
- "Which property contains the deal amount?"

**WRONG Questions**:
- ❌ "What is the field path?" (too technical)
- ❌ "Provide the object accessor" (developer jargon)

### 3. Lists and Arrays (Email, Messages, Files)
**Plugin Output**: Arrays of items with known structure

**CORRECT Questions**:
- "What should I do with each [email/message/file]?"
- "Should I process all items or filter them?"

**WRONG Questions**:
- ❌ "What array structure do you want?" (determined by plugin)

### 4. AI and Single Results (ChatGPT, Summaries)
**Plugin Output**: Simple objects with fixed fields like `{summary: "...", key_points: [...]}`

**CORRECT Questions**:
- "What should I do with the summary?"
- "Where should I send the analysis?"

**WRONG Questions**:
- ❌ "What output format?" (fixed by plugin definition)

## NEVER Ask Users To:
1. "Identify the output structure"
2. "Specify the output format"
3. "Define the data schema"
4. "Provide column indices or field positions"
5. "Describe the data structure"

## ALWAYS Ask Users To:
1. "Which column/field contains [the specific data]?" (by NAME)
2. "What should I do with [the results]?" (action)
3. "Where should I send [the output]?" (destination)
4. "How should I filter [the data]?" (criteria)
```

**Update Reference Examples** (Lines 82-154):

Replace the "analyze customer feedback" example with:

```markdown
### EXAMPLE 1: "Find unique sales people in my spreadsheet"

CORRECT Questions:
[
  {
    "id": "spreadsheet_source",
    "dimension": "data_input",
    "question": "Which spreadsheet should I analyze?",
    "type": "select",
    "options": [
      {"value": "recent_uploads", "label": "Most recently uploaded spreadsheet", "description": "Use the latest uploaded file"},
      {"value": "specific_file", "label": "A specific spreadsheet", "description": "Choose a particular file"},
      {"value": "shared_folder", "label": "From a shared folder", "description": "Pick from a Drive folder"}
    ],
    "allowCustom": true,
    "required": true
  },
  {
    "id": "sales_person_column",
    "dimension": "data_input",
    "question": "Which column contains the sales person names?",
    "type": "select",
    "options": [
      {"value": "Sales Person", "label": "Sales Person", "description": "Column named 'Sales Person'"},
      {"value": "Rep Name", "label": "Rep Name", "description": "Column named 'Rep Name'"},
      {"value": "Agent", "label": "Agent", "description": "Column named 'Agent'"}
    ],
    "allowCustom": true,
    "required": true
  },
  {
    "id": "unique_list_delivery",
    "dimension": "output_actions",
    "question": "How should I send you the list of unique sales people?",
    "type": "select",
    "options": [
      {"value": "email_me", "label": "Email me the list", "description": "Send as email"},
      {"value": "save_sheet", "label": "Save to a new spreadsheet", "description": "Create new sheet"},
      {"value": "slack_message", "label": "Post in Slack", "description": "Send to Slack channel"}
    ],
    "allowCustom": false,
    "required": true
  }
]

KEY POINTS:
- ✅ Asks "which column?" by NAME (user-friendly)
- ✅ Never asks for column index or structure
- ✅ Asks about delivery method (output action)
- ✅ Doesn't ask user to define data formats
```

**Testing Phase 1**:
```bash
# Test with: "Find unique sales people in my spreadsheet"
# Should generate questions like:
# - "Which column contains sales person names?"
# Should NOT generate questions like:
# - "What output format do you want?"
# - "Identify the output structure"
```

---

### Phase 2: Enhance Enhanced Prompt Generation

**File**: `/app/api/enhance-prompt/route.ts`

**Problem** (Lines 111-151):

Currently, the plugin context only shows capabilities:
```typescript
pluginContext = `
  CONNECTED SERVICES WITH CAPABILITIES:
  ${Object.entries(pluginsByCategory)
    .map(([category, plugins]) =>
      `${category.toUpperCase()}: ${plugins.map(p =>
        `${p.displayName} (${p.capabilities.join(', ')})`
      ).join('; ')}`
    ).join('\n')}
```

**Result**: AI knows user has Google Sheets, but doesn't know it outputs 2D arrays

**The Fix** - Replace lines 111-151:

```typescript
// Add at top of function (after line 100):
const pluginManager = await PluginManagerV2.getInstance();

// Replace pluginContext building (lines 111-151) with:
let pluginContext = '';

if (connectedPluginsMetaData.length > 0) {
  // Group plugins by category
  const pluginsByCategory = connectedPluginsMetaData.reduce((acc, plugin) => {
    const category = plugin.category;
    if (!acc[category]) acc[category] = [];
    acc[category].push(plugin);
    return acc;
  }, {} as Record<string, IPluginContext[]>);

  // Build enhanced context with OUTPUT TYPE INFORMATION
  const pluginDetails = Object.entries(pluginsByCategory).map(([category, plugins]) => {
    const categoryPlugins = plugins.map(plugin => {
      // Get actual plugin definition to access output schemas
      const pluginDef = pluginManager.getPlugin(plugin.key);

      if (!pluginDef) {
        return `${plugin.displayName} (${plugin.capabilities.join(', ')})`;
      }

      // For each capability, extract output type hints
      const capabilitiesWithTypes = plugin.capabilities.map(capability => {
        // Find matching action in plugin definition
        const action = Object.values(pluginDef.actions).find((a: any) =>
          a.description?.toLowerCase().includes(capability.toLowerCase()) ||
          capability.toLowerCase().includes(a.description?.toLowerCase())
        );

        if (!action || !action.output_schema?.properties) {
          return capability;
        }

        // Extract top output fields with type hints
        const outputFields = Object.entries(action.output_schema.properties)
          .slice(0, 2)
          .map(([fieldName, fieldSchema]: [string, any]) => {
            // Detect data structure patterns
            if (fieldSchema.type === 'array' && fieldSchema.items?.type === 'array') {
              return `${fieldName}:2D_array`;  // Google Sheets pattern
            } else if (fieldSchema.type === 'array' && fieldSchema.items?.properties) {
              return `${fieldName}:array<object>`;  // Airtable/CRM pattern
            } else if (fieldSchema.type === 'array') {
              return `${fieldName}:array<${fieldSchema.items?.type || 'any'}>`;
            } else if (fieldSchema.type === 'object') {
              return `${fieldName}:object`;
            } else {
              return `${fieldName}:${fieldSchema.type}`;
            }
          })
          .join(', ');

        return `${capability} [outputs: ${outputFields}]`;
      }).join('; ');

      return `${plugin.displayName}: ${capabilitiesWithTypes}`;
    }).join('\n    ');

    return `${category.toUpperCase()}:\n    ${categoryPlugins}`;
  }).join('\n\n');

  pluginContext = `
CONNECTED SERVICES WITH CAPABILITIES AND OUTPUT STRUCTURES:
${pluginDetails}

${finalMissingPlugins.length > 0 ? `\nMISSING SERVICES: User mentioned these unavailable services: ${finalMissingPlugins.join(', ')}` : ''}

CRITICAL INSTRUCTIONS FOR CREATING THE ENHANCED PROMPT:

1. **Use Placeholders for User-Specified Data**:
   - When user needs to specify a column: "[column_name from user]"
   - When user needs to specify a field: "[field_name from user]"
   - Example: "Look at the [Sales Person column] in each row"
   - Example: "Check the [Status field] for each contact"

2. **Respect Plugin Output Structures**:
   - When you see "2D_array" output: This is table data (rows and columns)
     → Write: "For each row in the data, use the column specified by user"
   - When you see "array<object>" output: This is record data (like database rows)
     → Write: "For each record, check the field specified by user"
   - When you see simple types: Use them directly
     → Write: "Use the summary to create the report"

3. **Never Assume Field/Column Names**:
   - ❌ BAD: "Look at the 'Sales Person' column" (assumes column exists)
   - ✅ GOOD: "Look at the [sales person column] provided by user"
   - ❌ BAD: "Filter by status field = 'Active'" (hardcoded field)
   - ✅ GOOD: "Filter by the [status field] that matches [user's criteria]"

4. **Reference Services Appropriately**:
   - Use SPECIFIC service names ONLY when relevant AND available
   - For unavailable services, suggest alternatives:
     → "use your available note-taking service" instead of "use Notion"
   - Only mention services actually needed for the task
   - Don't force all connected services into the workflow

5. **User-Friendly Language**:
   - Write like explaining to a friend, not a computer
   - Use "you" and "your" throughout
   - Simple action words: "check", "read", "create", "send"
   - Avoid technical jargon completely
`;

} else {
  pluginContext = `
NO CONNECTED SERVICES: User has no specific services connected
- Use friendly generic terms like "email system", "storage folder", "messaging app"
- Don't assume any specific service names
- Keep instructions generic but actionable
`;
}
```

**Update Enhancement Prompt** (Lines 174-222):

Add after "REQUIRED EXECUTION PLAN FORMAT:" section:

```markdown
**CRITICAL: Working with Structured Data Sources**

When the enhanced prompt references data from spreadsheets or databases:

1. **For Spreadsheet Data (2D arrays)**:
   - Write: "For each row in your [spreadsheet], look at the [column_name] column"
   - Write: "Use the value from the [user-specified column]"
   - NEVER write specific column names like "Sales Person" column
   - Always use placeholders: [column_name], [user's column], [specified column]

2. **For Database/CRM Data (array of objects)**:
   - Write: "For each record in [service], check the [field_name] field"
   - Write: "Filter records where [user-specified field] matches [criteria]"
   - NEVER write specific field names like "Status" field
   - Always use placeholders: [field_name], [user's field], [specified field]

3. **For Simple Outputs**:
   - Write: "Use the summary to create..."
   - Write: "Take the analysis results and send them to..."
   - These have fixed outputs, reference them directly

**Example Transformation**:

User request: "Find unique sales people in my spreadsheet"
Connected services: Google Sheets [read_sheet outputs: values:2D_array]

CORRECT Enhanced Prompt:
```
**Data Source:**
• Read data from your Google Sheets spreadsheet
• Look at the rows in the [sheet you specify]

**Processing Steps:**
• For each row, extract the value from the [sales person column]
• Identify unique values (remove duplicates)
• Create a clean list of all unique sales people

**Output Creation:**
• Generate a simple list showing each unique sales person name
• Count how many unique sales people were found

**Delivery Method:**
• Send the list to you via [your preferred method]
```

WRONG Enhanced Prompt (DO NOT DO THIS):
```
**Data Source:**
• Read data from Google Sheets
• Access the 'Sales Person' column  ❌ Assumes column name

**Processing Steps:**
• Get column index 2  ❌ Too technical
• Parse the data structure  ❌ Unnecessary detail
```
```

**Testing Phase 2**:
```javascript
// Test input:
{
  prompt: "Find unique sales people in my spreadsheet",
  clarificationAnswers: {
    sales_person_column: "Sales Person",
    delivery_method: "email_me"
  },
  connectedPlugins: ["google-sheets"]
}

// Expected enhanced prompt should contain:
// ✅ "[sales person column]" or "[user-specified column]" (placeholder)
// ✅ "For each row in the data"
// ❌ Should NOT contain: "Sales Person" (hardcoded column name)
// ❌ Should NOT contain: "column index" or technical terms
```

---

## Phase 1 & 2 Testing Checklist

### Test Case 1: Spreadsheet Deduplication
**Input**: "Find unique sales people in my spreadsheet"

**Phase 1 - Clarification Questions Should Ask**:
- ✅ "Which column contains the sales person names?"
- ✅ "How should I send you the results?"
- ❌ Should NOT ask: "What output format?"
- ❌ Should NOT ask: "Define the data structure"

**Phase 2 - Enhanced Prompt Should Contain**:
- ✅ "For each row in the data"
- ✅ "look at the [sales person column]" (placeholder)
- ✅ "value from the [user-specified column]"
- ❌ Should NOT contain: "Sales Person" (hardcoded)
- ❌ Should NOT contain: "column index"

### Test Case 2: CRM Contact Processing
**Input**: "Send email to contacts with status 'Active'"

**Phase 1 - Clarification Questions Should Ask**:
- ✅ "Which field contains the contact status?"
- ✅ "Which field has the email addresses?"
- ❌ Should NOT ask: "What is the data structure?"

**Phase 2 - Enhanced Prompt Should Contain**:
- ✅ "For each record, check the [status field]"
- ✅ "where [user-specified field] equals 'Active'"
- ❌ Should NOT contain: "fields.status" (hardcoded path)

### Test Case 3: Email Summarization
**Input**: "Summarize my emails and send to manager"

**Phase 1 - Clarification Questions Should Ask**:
- ✅ "Which emails should I summarize?"
- ✅ "Who should I send the summary to?"
- ❌ Should NOT ask: "What summary format?"

**Phase 2 - Enhanced Prompt Should Contain**:
- ✅ "Use the email summary"
- ✅ "send to your manager"
- ❌ Should NOT contain technical field accessors

---

## Success Criteria for Phase 1 & 2

### Phase 1 Success Metrics:
1. **NO technical questions**: Zero questions asking for "indices", "structure", "schema", "format"
2. **User-friendly language**: All questions use plain English column/field names
3. **Appropriate scope**: Questions ask WHAT user wants, not HOW to structure it
4. **Example count**: At least 3 updated examples showing correct question patterns

### Phase 2 Success Metrics:
1. **Placeholders used**: 100% of column/field references use placeholders like "[column_name]"
2. **Type awareness**: Enhanced prompts adapt language based on output types (2D arrays vs objects)
3. **No hardcoding**: Zero specific column or field names in enhanced prompts
4. **User language**: Plain English, no technical jargon

---

## Integration with Phase 3

Once Phase 1 & 2 are complete, Phase 3 will handle:
- Reading the placeholders from enhanced prompts
- Converting them to {{input.X}} in workflow steps
- Generating proper required_inputs schema
- Runtime conversion of user-friendly names to technical accessors

**Handoff Requirements**:
Phase 1 & 2 must deliver:
1. ✅ Clarification answers with user-friendly column/field names
2. ✅ Enhanced prompts with consistent placeholder format: `[column_name]`, `[field_name]`
3. ✅ Plugin context with output type hints: `values:2D_array`, `records:array<object>`

Phase 3 will consume:
1. Enhanced prompt with placeholders
2. Clarification answers
3. Plugin definitions with output schemas

---

## Implementation Timeline

### Week 1: Phase 1 & 2 (Conversational Flow Developer)
- **Day 1-2**: Update Clarification-Questions-Agent.txt prompt
- **Day 3-4**: Update enhance-prompt/route.ts with output type detection
- **Day 5**: Testing and validation of Phase 1 & 2

### Week 2: Phase 3 (Workflow Generation Developer)
- Separate implementation plan provided
- Depends on Phase 1 & 2 completion

---

## Files to Modify (Phase 1 & 2 Only)

### Phase 1:
1. `/app/api/prompt-templates/Clarification-Questions-Agent.txt`
   - Lines 31-50: Replace with new data structure handling rules
   - Lines 82-154: Update reference examples
   - Add new section: "CRITICAL DATA STRUCTURE HANDLING RULES"

### Phase 2:
1. `/app/api/enhance-prompt/route.ts`
   - Lines 100-151: Add plugin manager integration and output type detection
   - Lines 174-222: Add structured data handling instructions to enhancement prompt

---

## Risk Mitigation

### Breaking Changes:
- **None**: These are prompt enhancements, not code interface changes
- Existing workflows continue to work
- Only affects NEW workflow generation

### Rollback Plan:
- Git revert of prompt file changes
- Previous prompts stored in git history
- No database migrations needed

### Testing Before Production:
1. Test with 5 common user requests
2. Verify clarification questions are user-friendly
3. Verify enhanced prompts use placeholders
4. Test with multiple plugin types (sheets, CRMs, email)

---

## Questions for Implementation Team

1. **Current Testing**: Do we have automated tests for clarification question generation?
2. **Prompt Versioning**: Should we version the prompt files (v1, v2)?
3. **Analytics**: Should we track "questions asked" to measure improvement?
4. **User Feedback**: Should we add "Was this question clear?" feedback mechanism?

---

## Appendix: Before/After Comparison

### Before (Current Broken Behavior):

**User**: "Find unique sales people in my spreadsheet"

**Clarification Question**: "What output format should I use?"
**User Answers**: ??? (confused)

**Enhanced Prompt**: "Process spreadsheet data and format output appropriately"

**Generated Workflow**:
```json
{
  "type": "transform",
  "operation": "deduplicate",
  "config": {
    "field": "Sales Person"  ← ❌ Hardcoded guess
  }
}
```

**Execution**: ❌ FAILS - data is 2D array, not objects with 'Sales Person' field

---

### After (Fixed Behavior):

**User**: "Find unique sales people in my spreadsheet"

**Clarification Question**: "Which column contains the sales person names?"
**User Answers**: "Sales Person"

**Enhanced Prompt**: "For each row in your spreadsheet, look at the [sales person column] and identify unique values"

**Generated Workflow** (Phase 3):
```json
{
  "type": "transform",
  "operation": "deduplicate",
  "config": {
    "column": "{{input.column_name}}"  ← ✅ User provides value
  }
}
```

**Execution**: ✅ SUCCESS - runtime converts "Sales Person" → column index → correct access

---

## Contact and Coordination

**Phase 1 & 2 Developer**: Focus on conversational flow (clarification + enhancement)
**Phase 3 Developer**: Focus on workflow generation (Stage 1, 2, execution)

**Critical Coordination Point**: Enhanced prompt placeholder format
- Must be consistent: `[column_name]`, `[field_name]`
- Phase 3 must parse these to create `{{input.X}}`

**Review Checkpoint**: After Phase 1 & 2 complete, review enhanced prompts before starting Phase 3

---

**Last Updated**: 2025-12-04
**Author**: AI Agent Analysis
**Status**: Ready for Implementation
