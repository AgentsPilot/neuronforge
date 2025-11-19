# Phase 3 Schema Validation - Complete Documentation

## Overview

As of **v9**, Phase 3 responses in the thread-based agent creation flow are **strictly validated** using Zod schemas. This ensures runtime type safety and catches malformed LLM responses before they reach the frontend.

**Key Benefits:**
- ✅ Runtime type safety (not just TypeScript compile-time)
- ✅ Clear validation error messages with field paths
- ✅ No silent failures from malformed LLM output
- ✅ Consistent structure across all Phase 3 responses
- ✅ Backward compatible (Phase 1 & 2 unchanged)

---

## What Changed (v8 → v9)

| Aspect | Before (v8 and earlier) | After (v9 with validation) |
|--------|-------------------------|----------------------------|
| **Validation** | ❌ None (any JSON accepted) | ✅ Strict Zod validation at runtime |
| **Sections Type** | `string` (single paragraph) | `string[]` (array of bullet points) |
| **Metadata** | Allows `[key: string]: any` | Strictly typed `Phase3Metadata`, no arbitrary keys |
| **Error Detection** | Silent failures | Clear validation errors with field paths |
| **Type Safety** | TypeScript only (compile-time) | TypeScript + Zod (runtime enforcement) |
| **processing_steps** | Not supported in v8 | ✅ Supported (optional, v7 compatibility) |
| **trigger/error_handling** | Required | ✅ Optional in Phase 3 (v9.1 update) |
| **ready_for_generation** | Both top-level & metadata | ✅ Only in metadata (v9.1 update) |

---

## Important Schema Notes (v9.1)

### Why are `trigger` and `error_handling` optional?

In Phase 3, the v9 prompt explicitly instructs the LLM:
- **Trigger/Timing**: "Do not generate timing or error-handling logic" - managed externally by the orchestration layer
- **Error Handling**: Similarly managed at the system level, not in the enhanced prompt

Therefore, while these fields are **required in Phase 1** (for initial analysis), they are **optional in Phase 3** because:
1. The LLM is not instructed to include them
2. They're handled by the orchestration system, not the agent plan
3. Making them required would cause validation failures on legitimate Phase 3 responses

### Why is `ready_for_generation` only in metadata?

The `ready_for_generation` flag indicates whether the plan is ready for agent creation. This is a **metadata field** that describes the state of the plan, not part of the plan itself.

**Correct Usage:**
```typescript
// ✅ Read from metadata
if (response.metadata?.ready_for_generation) {
  // Proceed to agent creation
}
```

**Incorrect Usage:**
```typescript
// ❌ Don't read from top-level (field doesn't exist)
if (response.ready_for_generation) {
  // This will be undefined
}
```

---

## Implementation Files

### 1. Zod Validation Schemas
**File:** [lib/validation/phase3-schema.ts](../lib/validation/phase3-schema.ts)

Contains all Zod schemas for Phase 3 validation:
- `DimensionStatusSchema` - Validates status values ('clear'|'partial'|'missing')
- `AnalysisDimensionSchema` - Validates individual dimension analysis
- `AnalysisObjectSchema` - Validates complete analysis object
- `EnhancedPromptSectionsSchema` - Validates sections as **string arrays**
- `EnhancedPromptSchema` - Validates entire enhanced prompt
- `Phase3MetadataSchema` - Validates metadata (strictly typed)
- `Phase3ResponseSchema` - Complete Phase 3 response validation
- `validatePhase3Response()` - Helper function with formatted errors

### 2. TypeScript Type Definitions
**File:** [components/agent-creation/types/agent-prompt-threads.ts](../components/agent-creation/types/agent-prompt-threads.ts)

Updated types:
- `DimensionStatus` - Type for status values
- `AnalysisDimension` - Dimension analysis structure
- `EnhancedPromptSections` - **Now string arrays** (was strings)
- `EnhancedPromptSpecifics` - Services and required inputs
- `EnhancedPrompt` - Complete enhanced prompt structure
- `Phase3Metadata` - **Strictly typed** (no `[key: string]: any`)
- `ProcessMessageResponse` - Updated to use `Phase3Metadata`

### 3. Route Handler with Validation
**File:** [app/api/agent-creation/process-message/route.ts](../app/api/agent-creation/process-message/route.ts)

**Lines 396-416:** Phase 3 validation logic

```typescript
// Strict validation for Phase 3 responses
if (phase === 3) {
  console.log('🔍 Validating Phase 3 response structure...');

  const validation = validatePhase3Response(parsedJson);

  if (!validation.success) {
    console.error('❌ Phase 3 response validation failed:', validation.errors);
    return NextResponse.json(
      {
        success: false,
        error: 'Invalid Phase 3 response structure from AI',
        phase,
        details: validation.errors?.join('; ') || 'Unknown validation error'
      } as ThreadErrorResponse,
      { status: 500 }
    );
  }

  console.log('✅ Phase 3 response validated successfully');
  aiResponse = validation.data as ProcessMessageResponse;
}
```

### 4. LLM Prompt Instructions
**File:** [app/api/prompt-templates/Workflow-Agent-Creation-Prompt-v9-chatgpt.txt](../app/api/prompt-templates/Workflow-Agent-Creation-Prompt-v9-chatgpt.txt)

**Lines 182-183, 332-333:** Instructions for array format

```
7. The `enhanced_prompt.sections.{data,actions,output,delivery}` fields must be
   formatted as **arrays of strings**, not freeform paragraphs or single strings.
   Each array item should describe a single deterministic step or rule
   (e.g., ["- item1", "- item2", "- item3"]).

8. Optionally include `processing_steps` as an array if you need to enumerate
   intermediate workflow steps explicitly (v7 compatibility).
```

---

## Complete Schema Structure

### Phase 3 Response Schema

```typescript
{
  analysis: {
    data: {
      status: 'clear' | 'partial' | 'missing',
      confidence: number, // 0-1
      detected: string // Non-empty
    },
    actions: { ... },
    output: { ... },
    delivery: { ... },
    trigger?: { ... },              // ✅ OPTIONAL in Phase 3
    error_handling?: { ... }        // ✅ OPTIONAL in Phase 3
  },

  requiredServices: string[],
  missingPlugins: string[],
  pluginWarning: Record<string, string>, // Changed from Record<string, any>
  clarityScore: number, // 0-100

  enhanced_prompt: {
    plan_title: string, // Non-empty
    plan_description: string, // Non-empty
    sections: {
      data: string[],              // ✅ Array of bullet points
      actions: string[],           // ✅ Array of bullet points
      output: string[],            // ✅ Array of bullet points
      delivery: string[],          // ✅ Array of bullet points
      processing_steps?: string[]  // ✅ Optional (v7 compatibility)
    },
    specifics: {
      services_involved: string[],
      user_inputs_required: string[]
    }
  },

  metadata: {
    all_clarifications_applied: boolean,
    ready_for_generation: boolean,  // ✅ Lives HERE (not at top-level!)
    confirmation_needed: boolean,
    implicit_services_detected: string[],
    provenance_checked: boolean,
    resolved_contacts: Record<string, string>, // {"user": "email@example.com"}
    provenance_note?: string,
    declined_plugins_blocking?: string[],
    oauth_required?: boolean,
    oauth_message?: string,
    plugins_adjusted?: string[],
    adjustment_reason?: string,
    reason?: string
    // ❌ NO [key: string]: any escape hatch!
  },

  conversationalSummary: string, // Non-empty
  // ❌ ready_for_generation REMOVED from top-level (only in metadata!)
  needsClarification?: boolean,
  error?: string
}
```

---

## Example Valid Response

```json
{
  "analysis": {
    "data": {
      "status": "clear",
      "confidence": 1.0,
      "detected": "Gmail emails from today"
    },
    "actions": {
      "status": "clear",
      "confidence": 1.0,
      "detected": "Format and send to Slack"
    },
    "output": {
      "status": "clear",
      "confidence": 1.0,
      "detected": "Formatted Slack message"
    },
    "delivery": {
      "status": "clear",
      "confidence": 1.0,
      "detected": "Post to #general channel"
    }
    // Note: trigger and error_handling are OPTIONAL in Phase 3
    // LLM may include them if relevant, but not required
  },
  "requiredServices": ["google-mail", "slack"],
  "missingPlugins": [],
  "pluginWarning": {},
  "clarityScore": 100,
  "enhanced_prompt": {
    "plan_title": "Daily Gmail to Slack Automation",
    "plan_description": "Send today's Gmail emails to Slack #general channel daily at 9am",
    "sections": {
      "data": [
        "- Fetch emails from Gmail inbox",
        "- Filter by date (today only)",
        "- Extract subject and body content"
      ],
      "actions": [
        "- Format email content as Slack message",
        "- Truncate body if over 2000 characters"
      ],
      "output": [
        "- Formatted Slack message with email subject as title",
        "- Email body as message content"
      ],
      "delivery": [
        "- Post to Slack #general channel",
        "- Schedule daily at 9am"
      ],
      "processing_steps": [
        "- Authenticate with Gmail API",
        "- Query emails with date filter",
        "- Transform to Slack format",
        "- Post via Slack webhook"
      ]
    },
    "specifics": {
      "services_involved": ["google-mail", "slack"],
      "user_inputs_required": []
    }
  },
  "metadata": {
    "all_clarifications_applied": true,
    "ready_for_generation": true,
    "confirmation_needed": false,
    "implicit_services_detected": [],
    "provenance_checked": true,
    "resolved_contacts": {
      "user": "alice@company.com"
    }
  },
  "conversationalSummary": "Your agent is fully defined and ready to create!"
  // Note: ready_for_generation is ONLY in metadata, not at top-level!
}
```

---

## Validation Error Examples

### Example 1: Wrong Type for Sections

**Invalid Response:**
```json
{
  "enhanced_prompt": {
    "sections": {
      "data": "Fetch emails from Gmail" // ❌ String instead of array
    }
  }
}
```

**Validation Error:**
```
enhanced_prompt.sections.data: Expected array, received string
```

### Example 2: Missing Required Field

**Invalid Response:**
```json
{
  "metadata": {
    "ready_for_generation": true
    // ❌ Missing required field: all_clarifications_applied
  }
}
```

**Validation Error:**
```
metadata.all_clarifications_applied: Required
```

### Example 3: Invalid Confidence Value

**Invalid Response:**
```json
{
  "analysis": {
    "data": {
      "status": "clear",
      "confidence": 1.5 // ❌ Must be 0-1
    }
  }
}
```

**Validation Error:**
```
analysis.data.confidence: Number must be less than or equal to 1
```

---

## Frontend Integration

### Handling Phase 3 Responses

```typescript
const processPhase3 = async () => {
  try {
    const res = await fetch('/api/agent-creation/process-message', {
      method: 'POST',
      body: JSON.stringify({
        thread_id: threadId,
        phase: 3,
        clarification_answers: answers
      })
    })

    if (!res.ok) {
      // ❌ Validation failed on backend
      const error = await res.json()
      console.error('❌ Phase 3 validation failed:', error.details)

      // Show user-friendly error
      addAIMessage(
        "I encountered an error generating your plan. " +
        "This has been logged for review. Please try again."
      )
      return
    }

    // ✅ Response is validated and safe to use
    const data = await res.json()
    console.log('✅ Phase 3 response (validated):', data)

    // Access sections as arrays (guaranteed by validation)
    setEnhancedPromptData(data.enhanced_prompt)

  } catch (error) {
    console.error('❌ Phase 3 error:', error)
  }
}
```

### Rendering Sections as Arrays

```tsx
// ✅ Correct: Render sections as bullet lists
<div className="space-y-4">
  <div>
    <h4 className="font-semibold">Data</h4>
    <ul className="list-disc list-inside">
      {enhancedPrompt.sections.data.map((item, idx) => (
        <li key={idx}>{item}</li>
      ))}
    </ul>
  </div>

  <div>
    <h4 className="font-semibold">Actions</h4>
    <ul className="list-disc list-inside">
      {enhancedPrompt.sections.actions.map((item, idx) => (
        <li key={idx}>{item}</li>
      ))}
    </ul>
  </div>

  {/* Optional: Processing Steps */}
  {enhancedPrompt.sections.processing_steps && (
    <div>
      <h4 className="font-semibold">Processing Steps</h4>
      <ul className="list-disc list-inside">
        {enhancedPrompt.sections.processing_steps.map((item, idx) => (
          <li key={idx}>{item}</li>
        ))}
      </ul>
    </div>
  )}
</div>
```

---

## Migration Guide (v8 → v9)

### 1. Update Type Expectations

**Before (v8):**
```typescript
// Sections were strings
const dataSection: string = enhancedPrompt.sections.data
```

**After (v9):**
```typescript
// Sections are string arrays
const dataSection: string[] = enhancedPrompt.sections.data
```

### 2. Update UI Rendering

**Before (v8):**
```tsx
<p>{enhancedPrompt.sections.data}</p>
```

**After (v9):**
```tsx
<ul>
  {enhancedPrompt.sections.data.map((item, idx) => (
    <li key={idx}>{item}</li>
  ))}
</ul>
```

### 3. Handle processing_steps (Optional)

**New in v9:**
```typescript
// Optional field for v7 compatibility
if (enhancedPrompt.sections.processing_steps) {
  // Render processing steps
  processingSteps.map(step => /* ... */)
}
```

---

## Testing Validation

### 1. Normal Flow (Valid Response)
- Create agent with Phase 1 → Phase 2 → Phase 3
- Check backend logs for:
  ```
  🔍 Validating Phase 3 response structure...
  ✅ Phase 3 response validated successfully
  ```
- Verify enhanced prompt renders correctly with bullet lists

### 2. Invalid Response (Error Handling)
- Temporarily modify LLM prompt to return wrong format
- Example: Change sections to strings instead of arrays
- Expected backend response:
  ```json
  {
    "success": false,
    "error": "Invalid Phase 3 response structure from AI",
    "phase": 3,
    "details": "enhanced_prompt.sections.data: Expected array, received string"
  }
  ```
- Verify frontend shows user-friendly error message

### 3. Missing Required Field
- Remove a required field from LLM response
- Expected error with field path in details

---

## Debugging

### Enable Verbose Logging

Check backend logs for:
- `🔍 Validating Phase 3 response structure...`
- `✅ Phase 3 response validated successfully`
- `❌ Phase 3 response validation failed: [details]`

### Common Issues

1. **"Expected array, received string"**
   - LLM returned old v8 format
   - Check prompt template instructions (lines 332-333)

2. **"Required field missing"**
   - LLM omitted a required metadata field
   - Check `Phase3MetadataSchema` for required fields

3. **"Number must be less than or equal to 1"**
   - Confidence value > 1.0
   - LLM used percentage (e.g., 95 instead of 0.95)

---

## Benefits Summary

✅ **Runtime Type Safety** - Catches errors before reaching frontend
✅ **Clear Error Messages** - Exact field paths for debugging
✅ **No Silent Failures** - All schema violations are caught
✅ **Backward Compatible** - Phase 1 & 2 unchanged
✅ **v7 Compatibility** - Supports optional `processing_steps`
✅ **Strictly Typed Metadata** - No arbitrary keys allowed
✅ **Consistent Structure** - All Phase 3 responses match schema

---

## Related Documentation

- **Main Flow:** [thread-based-agent-creation-flow.md](thread-based-agent-creation-flow.md)
- **V2 Implementation:** [V2_AGENT_CREATION_AND_SAVE_IMPLEMENTATION.md](V2_AGENT_CREATION_AND_SAVE_IMPLEMENTATION.md)
- **UI Components:** [CONVERSATIONAL_UI_NEW_V2_COMPLETE.md](CONVERSATIONAL_UI_NEW_V2_COMPLETE.md)
- **Legacy Flow:** [LEGACY_CONVERSATIONAL_AGENT_CREATION_SEQUENCE.md](LEGACY_CONVERSATIONAL_AGENT_CREATION_SEQUENCE.md)

---

**Document Version**: 1.1
**Created**: 2025-01-19
**Last Updated**: 2025-01-19 (v9.1 schema adjustments)
**Author**: Development Team
**Status**: Complete - Ready for Reference

**v9.1 Changes:**
- Made `analysis.trigger` and `analysis.error_handling` optional (not required by v9 prompt)
- Removed top-level `ready_for_generation` field (now only in `metadata.ready_for_generation`)
- Updated all examples and code snippets to reflect these changes
