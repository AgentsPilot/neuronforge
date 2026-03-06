# IntentContract System Prompt Improvements

**Date:** 2026-03-05
**File Modified:** `lib/agentkit/v6/intent/intent-system-prompt-v2.ts`
**Purpose:** Guide LLM to generate executable, deterministic IntentContracts

## Problem Statement

Previous test runs revealed that LLM was generating IntentContracts with:
1. **Wrong step types** - Using `classify` for field comparisons when `filter` should be used
2. **Non-executable transforms** - Transform steps with only description strings, no structured config
3. **Missing required fields** - Group operations without group_by field, filters without where conditions

These issues caused workflows to compile to PILOT DSL that the runtime cannot execute.

## Changes Made

### 1. Added Section 4.5: Data Flow Analysis & Reasoning

**Location:** After section 4 (Data Flow), before section 5 (Step Structure)

**Purpose:** Teach LLM to analyze data availability before choosing step types

**Key Content:**
- **Step Planning Questions** - 5-question checklist before creating each step:
  1. What data do I have available?
  2. What fields exist in that data?
  3. What operation do I need?
  4. Can I express this declaratively?
  5. If not, how can I decompose it?

- **Choosing the Right Step Kind** - Decision tree with 5 ordered questions:
  1. Does the field exist? → TRANSFORM
  2. Is this comparison? → TRANSFORM filter
  3. Is this deterministic? → TRANSFORM map or decompose
  4. Requires content analysis? → CLASSIFY/EXTRACT/GENERATE
  5. Fetching data? → DATA_SOURCE

- **Example Decision Processes** - Three scenarios showing how to apply the questions

**Why This Helps:**
- Forces LLM to check data source schemas before choosing step types
- Prevents using expensive AI operations (CLASSIFY) for deterministic operations (FILTER)
- Guides toward decomposition when declarative expression isn't possible

---

### 2. Enhanced Section 6.3: Transform Executability Requirements

**Location:** In TRANSFORM step documentation (section 6.3)

**Purpose:** Make it clear that transforms MUST have executable configuration

**Key Content:**
- **CRITICAL header** - "Transform Operations Must Be EXECUTABLE"
- **REQUIRED for each operation:**
  - **FILTER** - Must include structured "where" condition (not just description)
  - **GROUP** - Must specify grouping field (not just description)
  - **MAP** - Two valid approaches:
    - Simple: Use "select" with field list
    - Complex: Break into primitives OR use GENERATE
  - **REDUCE** - Must specify reduction type (sum, count, avg, etc.)

- **General Rule** - If cannot express declaratively, must either:
  1. Decompose into simpler primitive operations (preferred)
  2. Use GENERATE step with clear instruction (for complex cases)

- **When to Decompose vs Use GENERATE** - Guidelines for choosing approach

**Why This Helps:**
- Prevents description-only transforms like "group by field_x" (not executable)
- Forces explicit configuration: `{"group_by": "field_x"}` (executable)
- Guides LLM toward decomposition strategy when needed
- Makes GENERATE a valid escape hatch for truly complex transformations

---

### 3. Added Section After 6.5: When to Use CLASSIFY vs FILTER

**Location:** After CLASSIFY documentation (section 6.5), before SUMMARIZE (6.6)

**Purpose:** Prevent LLM from using expensive AI classification for simple field comparisons

**Key Content:**
- **CRITICAL header** - "When to Use CLASSIFY vs FILTER"
- **Decision question** - "Does the field I need already exist in the data?"

- **Use CLASSIFY when:**
  - Field does NOT exist and requires analyzing unstructured content
  - Requires semantic understanding, sentiment, context
  - Examples: sentiment analysis, topic detection, urgency assessment

- **Use TRANSFORM filter when:**
  - Field ALREADY EXISTS in data source
  - Comparing field values against thresholds/conditions
  - Operation is deterministic (no AI interpretation)
  - Examples: filtering by numeric thresholds, status values, dates

- **Decision Process:**
  1. Check data source output schema - does field exist?
  2. If YES → TRANSFORM with op="filter"
  3. If NO and requires content analysis → CLASSIFY
  4. If NO but deterministic → TRANSFORM with op="map"

- **Example Pattern** - Shows correct decision-making for "categorize items where field_x meets condition_y"

**Why This Helps:**
- Prevents expensive AI operations when simple filter would work
- Forces LLM to check data source schemas first
- Saves tokens, time, and cost by using deterministic operations
- Example: "filter leads where Stage >= 4" now generates filter, not classify

---

## Design Principles Maintained

All changes follow CLAUDE.md principles:

### ✅ Plugin-Agnostic
- No specific plugin names or patterns mentioned
- All examples use generic field names: "field_x", "status_field", "items"
- Guidance applies to ANY plugin that follows schema patterns

### ✅ Scalable
- No hardcoded values or specific use cases
- Decision trees work for any workflow domain
- Examples show patterns, not specific business logic

### ✅ Schema-Driven
- Emphasizes checking data source output schemas
- Teaches LLM to use plugin schemas as source of truth
- No assumptions about what fields exist

### ✅ Deterministic-First
- Prioritizes deterministic operations over AI operations
- Guides toward executable primitive operations
- Makes decomposition the preferred strategy

---

## Expected Impact

### On Lead Sales Follow-up Workflow

**Before:**
```json
{
  "kind": "classify",
  "summary": "Classify leads as high-quality based on score threshold",
  "classify": {"labels": ["high_quality", "low_quality"]}
}
```
→ Compiles to expensive AI classification step

**After (Expected):**
```json
{
  "kind": "transform",
  "summary": "Filter leads where Stage >= 4",
  "transform": {
    "op": "filter",
    "where": {
      "op": "test",
      "left": {"kind": "ref", "ref": "leads", "field": "Stage"},
      "comparator": "gte",
      "right": {"kind": "literal", "value": 4}
    }
  }
}
```
→ Compiles to deterministic filter operation (fast, cheap, executable)

### On Transform Executability

**Before:**
```json
{
  "kind": "transform",
  "transform": {
    "op": "group",
    "description": "Group leads by resolved_email field"
  }
}
```
→ Compiles to non-executable PILOT with custom_code

**After (Expected Option 1 - If schema supports):**
```json
{
  "kind": "transform",
  "transform": {
    "op": "group",
    "group_by": "resolved_email"
  }
}
```
→ Compiles to executable PILOT with explicit group_by

**After (Expected Option 2 - If decomposition needed):**
```json
// Step 1: Use GENERATE to add resolved_email field
{
  "kind": "generate",
  "generate": {
    "instruction": "Add resolved_email field to each lead..."
  }
}
// Step 2: Group by the new field
{
  "kind": "transform",
  "transform": {"op": "group", "group_by": "resolved_email"}
}
```

---

## Testing Plan

### Phase 1: Re-test Lead Sales Follow-up
Run the test with current enhanced prompt (unchanged) to verify:
- [ ] LLM now generates filter instead of classify for Stage >= 4
- [ ] Transform steps have executable configuration
- [ ] No custom_code descriptions in PILOT DSL

### Phase 2: Re-test All Previous Workflows
Run tests for all 4 workflows:
1. [ ] Invoice extraction
2. [ ] Expense extractor
3. [ ] Complaint logger
4. [ ] Lead sales followup

Compare before/after:
- Number of AI operations (should decrease)
- Number of transform steps with custom_code (should decrease to zero)
- Executability rate (should improve to 100%)

### Phase 3: Monitor for Regressions
Check if new instructions cause any:
- [ ] Valid AI classifications to be skipped
- [ ] Complex transforms to fail instead of using GENERATE
- [ ] Performance degradation in LLM generation time

---

## Success Metrics

### Immediate Success Criteria
1. **Zero custom_code transforms** - All transforms have explicit configuration
2. **Correct step type selection** - Filters use filter, not classify
3. **100% executability** - All PILOT DSL steps can execute

### Quality Improvement Metrics
1. **Reduced AI operations** - Fewer unnecessary AI steps
2. **Faster workflows** - Deterministic operations instead of AI calls
3. **Lower cost** - Fewer LLM token usage during execution

### Scalability Validation
1. **Works across domains** - Not specific to lead/email/sheet workflows
2. **No hardcoded patterns** - Generic guidance applies to any plugin
3. **Schema-driven** - LLM checks schemas, not assumptions

---

## Rollback Plan

If new instructions cause issues:

1. **Immediate rollback** - Revert changes to intent-system-prompt-v2.ts
2. **Analyze failures** - Identify which guidance caused problems
3. **Refine approach** - Adjust wording to be more nuanced
4. **Incremental re-deployment** - Add one section at a time

Changes are isolated to system prompt, so rollback is clean with no data migration needed.

---

## Notes

- All changes maintain CLAUDE.md principles (no hardcoding, plugin-agnostic, scalable)
- Changes are additive - no existing functionality removed
- LLM can still use AI operations when genuinely needed
- Decomposition is guided, not forced - GENERATE is still available as escape hatch
