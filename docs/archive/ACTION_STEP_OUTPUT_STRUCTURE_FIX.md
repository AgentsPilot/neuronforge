# Action Step Output Reference Fix

**Date:** December 3, 2025
**Issue:** ai_processing steps receiving empty data from action steps
**Root Cause:** Incorrect output field references for action steps
**Status:** 🔍 INVESTIGATION COMPLETE - FIX IN PROGRESS

---

## Problem Description

After implementing the auto-fix for ai_processing output references, discovered a new issue:
- Auto-fix successfully corrected step3's reference to step2 (ai_processing): `{{step2.html_table}}` → `{{step2.data.result}}` ✅
- But step2 (ai_processing) is receiving empty input from step1 (action step)
- The workflow uses: `"input": "{{step1.data.results}}"` ❌
- But `results` field doesn't exist in the chatgpt-research plugin output

### Example of Broken Reference

**User Request:** "Research top 10 AI app release blogs and send me an HTML table via email"

**Generated Workflow:**
```json
[
  {
    "id": "step1",
    "type": "action",
    "plugin": "chatgpt-research",
    "action": "research_topic",
    "params": {
      "topic": "top 10 AI app releases",
      "depth": "standard"
    }
  },
  {
    "id": "step2",
    "type": "ai_processing",
    "input": "{{step1.data.results}}",  // ❌ WRONG - field doesn't exist
    "prompt": "Convert to HTML table..."
  },
  {
    "id": "step3",
    "type": "action",
    "action": "send_email",
    "params": {
      "content": {
        "html_body": "{{step2.data.result}}"  // ✅ CORRECT (auto-fixed)
      }
    }
  }
]
```

**Execution Result:**
- step1 executes successfully, returns research data
- step2 receives undefined/empty input → AI says "no verified facts provided"
- step3 sends email with empty body (because step2 had no input)

---

## Root Cause Analysis

### Action Step Output Structure

**File:** [lib/pilot/StepExecutor.ts:463-466](../lib/pilot/StepExecutor.ts#L463-L466)

Action steps return:
```typescript
return {
  data: result.data,  // Plugin's result wrapped in data property
  pluginTokens: pluginTokens
};
```

### ChatGPT Research Plugin Output

**File:** [lib/plugins/definitions/chatgpt-research-plugin-v2.json:85-109](../lib/plugins/definitions/chatgpt-research-plugin-v2.json#L85-L109)

The `research_topic` action returns:
```typescript
{
  summary: string,           // Comprehensive research summary
  key_points: string[],      // Key findings
  sources: array,            // Web sources
  source_count: number,
  research_depth: string,
  focus: string
}
```

**File:** [lib/server/chatgpt-research-plugin-executor.ts:77-88](../lib/server/chatgpt-research-plugin-executor.ts#L77-L88)

Executor returns:
```typescript
return {
  summary: summary.text,
  key_points: summary.key_points,
  sources: searchResults.map(r => ({
    title: r.title,
    url: r.url,
    snippet: r.snippet
  })),
  source_count: searchResults.length,
  research_depth: depth,
  focus: focus
};
```

### Complete Output Structure

When step1 (chatgpt-research.research_topic) executes, it returns:
```typescript
{
  data: {
    summary: "Based on analysis of multiple sources...",  // ✅ This exists
    key_points: ["Finding 1", "Finding 2", ...],
    sources: [...],
    source_count: 5,
    research_depth: "standard",
    focus: "general"
  }
}
```

**Correct References:**
- `{{step1.data.summary}}` - The comprehensive research summary ✅
- `{{step1.data.key_points}}` - Array of key findings ✅
- `{{step1.data.sources}}` - Array of web sources ✅

**Incorrect References:**
- `{{step1.data.results}}` - ❌ Doesn't exist
- `{{step1.data.output}}` - ❌ Doesn't exist
- `{{step1.data.result}}` - ❌ Doesn't exist (this is for ai_processing only)

---

## The Fix Strategy

We have two approaches:

### Option 1: Extend Auto-Fix to Handle Action Steps (RECOMMENDED)

Extend the auto-fix in Stage 2 to understand plugin output schemas and fix incorrect field references.

**Pros:**
- 100% reliable, deterministic
- Works for all plugins, all scenarios
- Self-healing system
- No prompt maintenance

**Cons:**
- Requires plugin schema metadata
- More complex logic
- May need heuristics for generic fixes

### Option 2: Enhanced Stage 1 Guidance

Add explicit guidance about common plugin output structures to Stage 1 prompt.

**Pros:**
- Teaches LLM correct patterns
- Reduces frequency of errors

**Cons:**
- Not 100% reliable (probabilistic)
- Cannot cover all plugin combinations
- Requires ongoing maintenance
- Same scalability issues as before

---

## Recommended Solution: Hybrid Approach

**Two-Layer Defense:**

### Layer 1: Enhanced Stage 1 Guidance
Add specific guidance for chatgpt-research plugin (most commonly used):

```typescript
**chatgpt-research plugin outputs:**
- research_topic action → {{stepN.data.summary}} (comprehensive research text)
  - Also available: .key_points, .sources, .source_count
- summarize_content action → {{stepN.data.summary}}
- answer_question action → {{stepN.data.answer}}

❌ WRONG: {{step1.data.results}} (field doesn't exist)
✅ CORRECT: {{step1.data.summary}} (for research_topic)
```

### Layer 2: Smart Auto-Fix with Field Mapping

Extend Stage 2 auto-fix to detect common incorrect field references and map them to correct ones:

**Common Incorrect → Correct Mappings:**
- `{{stepN.data.results}}` → `{{stepN.data.summary}}` (for chatgpt-research.research_topic)
- `{{stepN.data.output}}` → `{{stepN.data.summary}}` (for chatgpt-research)
- `{{stepN.data.content}}` → Action-specific correct field

**Algorithm:**
```typescript
function fixActionStepReferences(steps: any[]): { steps: any[]; fixes: string[] } {
  // 1. Identify all action steps and their plugins/actions
  // 2. Load output schema for each plugin action
  // 3. Scan for references to action steps
  // 4. Check if referenced field exists in output schema
  // 5. If not, map to most likely correct field:
  //    - For research/search: map to .summary
  //    - For list operations: map to .items or .results
  //    - For single item: map to .data or first field
  // 6. Log all fixes applied
}
```

---

## Implementation Plan

### Phase 1: Quick Fix (Stage 1 Guidance Only)
**Time:** 10 minutes
**Coverage:** ~70-80% of chatgpt-research cases

1. Update Stage 1 prompt with chatgpt-research output examples
2. Add to quality checklist
3. Test with research agent generation

### Phase 2: Smart Auto-Fix (Full Solution)
**Time:** 1-2 hours
**Coverage:** 100% of all action steps

1. Design field mapping heuristics
2. Implement `fixActionStepReferences()` in Stage 2
3. Add logging and transparency
4. Update Gate 2 validation
5. Comprehensive testing

---

## Testing Plan

**Test Case:** "Research top 10 AI app release blogs and send me an HTML table via email"

**Expected Before Fix:**
```json
"input": "{{step1.data.results}}"  // ❌ Incorrect
```

**Expected After Fix:**
```json
"input": "{{step1.data.summary}}"  // ✅ Auto-fixed or correctly generated
```

**Success Criteria:**
1. ✅ step1 executes and returns research data
2. ✅ step2 receives full research summary (not empty)
3. ✅ step2 generates HTML table successfully
4. ✅ step3 sends email with populated body

---

## Related Files

### To Modify:
1. [lib/agentkit/stage1-workflow-designer.ts](../lib/agentkit/stage1-workflow-designer.ts) - Add chatgpt-research guidance
2. [lib/agentkit/stage2-parameter-filler.ts](../lib/agentkit/stage2-parameter-filler.ts) - Add action step auto-fix

### Reference Files:
1. [lib/pilot/StepExecutor.ts](../lib/pilot/StepExecutor.ts) - Action step output structure
2. [lib/plugins/definitions/chatgpt-research-plugin-v2.json](../lib/plugins/definitions/chatgpt-research-plugin-v2.json) - Plugin schema
3. [lib/server/chatgpt-research-plugin-executor.ts](../lib/server/chatgpt-research-plugin-executor.ts) - Executor logic

---

## Next Steps

1. Implement Phase 1 (Quick Fix) immediately
2. Test with user's workflow
3. Plan Phase 2 implementation
4. Consider extending to other frequently-used plugins (Google Drive, Gmail, etc.)
