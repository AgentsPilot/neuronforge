# V6 Pure Declarative Architecture - Testing Guide

## Overview

This guide explains how to test the complete V6 Pure Declarative pipeline end-to-end, matching the real production flow.

## Production Flow

```
┌─────────────────────────────────────────────┐
│ USER INPUT                                  │
│ Enhanced Prompt (from Agent Enhancement)   │
│ - Natural language sections                │
│ - Business requirements only                │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│ STEP 1: LLM GENERATION                     │
│ EnhancedPromptToDeclarativeIRGenerator     │
│ - Uses declarative-ir-system.md prompt     │
│ - Outputs PURE declarative IR              │
│ - NO IDs, NO loops, NO execution tokens    │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│ VALIDATION                                  │
│ DeclarativeIRValidator                     │
│ - Forbidden token check                    │
│ - JSON schema validation                   │
│ - Semantic validation                      │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│ STEP 2: SMART COMPILATION                  │
│ DeclarativeCompiler                        │
│ - Infers loops from delivery_rules         │
│ - Generates all step IDs                   │
│ - Auto-injects missing transforms          │
│ - Manages variable flow                    │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│ OUTPUT                                      │
│ Executable PILOT DSL Workflow              │
│ - Perfect steps with IDs                   │
│ - Correct variable flow                    │
│ - Ready to execute                         │
└─────────────────────────────────────────────┘
```

## Testing URL

```
http://localhost:3000/test-v6-declarative.html
```

## What You Need

**INPUT:** An Enhanced Prompt (JSON format)

This is what you get from the Agent Enhancement phase in production. It contains:
- `sections.data` - Data source requirements
- `sections.actions` - Business actions to perform
- `sections.output` - Output format requirements
- `sections.delivery` - Delivery rules

## Test Workflows

### Test 1: Leads Workflow (Pre-filled)

The page comes pre-filled with a leads workflow example:
- **Goal:** Send stage 4 leads to each salesperson
- **Pattern:** Per-group delivery
- **Expected Results:**
  - IR validation: ✓ PASSED (no forbidden tokens)
  - Pattern detected: `per_group_delivery`
  - Steps generated: 6-7 steps
  - Loop inferred: Scatter-gather over sales person groups

**Click:** "Run Complete Production Flow"

### Test 2: Expense Workflow

Replace the Enhanced Prompt with:

```json
{
  "sections": {
    "data": [
      "- Search Gmail for emails from the last 7 days where the subject contains 'expenses' OR 'receipt'.",
      "- From each matching email, collect all PDF attachments."
    ],
    "actions": [
      "- For each PDF attachment, read the receipt content and extract expense line items.",
      "- For each extracted row, populate: date&time, vendor, amount, expense type.",
      "- Mark uncertain fields as 'need review'."
    ],
    "output": [
      "- Generate a combined table with columns: date&time, vendor, amount, expense type."
    ],
    "delivery": [
      "- Send an email to offir.omer@gmail.com with the embedded table."
    ]
  }
}
```

**Expected Results:**
- IR validation: ✓ PASSED
- Patterns: `summary_delivery`, `auto_injection`
- Compiler log: "✓ Auto-injected PDF extraction transform"
- Steps generated: ~7 steps including auto-injected PDF extraction

## What to Observe

### Success Indicators

1. **Step 1 Validation:**
   - ✅ "Validation: PASSED (No IDs, No loops, No execution tokens)"
   - This proves LLM generated pure declarative IR

2. **Step 2 Intelligence:**
   - Pattern detection shows compiler understood intent
   - Compiler logs show inference decisions
   - Generated steps show loop structure

3. **Output Quality:**
   - All steps have IDs (compiler generated)
   - Variable flow is correct
   - Loops are properly structured

### Failure Indicators

If you see:
- ❌ "Forbidden token found: `"id":`" → LLM leaked execution details
- ❌ "Forbidden token found: `"loops"`" → LLM prescribed execution instead of describing intent

This means the system prompt needs strengthening or model needs adjustment.

## Testing Both Buttons

### Button 1: "Run Complete Production Flow"
- **What it does:** Runs BOTH steps (Enhanced Prompt → IR → DSL)
- **When to use:** Normal testing, see complete pipeline
- **Output:** Shows full pipeline execution with both steps

### Button 2: "Debug: Generate IR Only"
- **What it does:** Only runs Step 1 (Enhanced Prompt → IR)
- **When to use:** Debug LLM output, inspect declarative IR before compilation
- **Output:** Shows just the IR generation and validation

## Understanding the Results

### Pipeline Summary Box

Shows the complete flow visually:
```
📝 INPUT: Enhanced Prompt
    ⬇
🤖 STEP 1: LLM Generation (Declarative IR)
    ⬇
🔧 STEP 2: Smart Compiler (PILOT DSL)
    ⬇
⚙️ OUTPUT: Executable Workflow
```

### Compiler Intelligence Logs

Shows what the compiler inferred:
- "Compiling data source..."
- "Detected pattern: Per-Group Delivery → Will create partition + group + loop"
- "✓ Auto-injected PDF extraction transform"
- "Created scatter-gather loop over groups"

### Detailed Outputs (Expandable)

1. **View Declarative IR** - Shows the LLM output (Step 1)
2. **View Generated Workflow** - Shows compiler output (Step 2)

## Comparing with Old V6

### Old V6 (Extended IR)
```
Enhanced Prompt → LLM generates prescriptive IR (with IDs, loops)
                → Compiler is "dumb mapper"
                → Output
```

**Problem:** LLM hallucinates IDs, loops, variable names

### New V6 (Pure Declarative)
```
Enhanced Prompt → LLM generates declarative IR (ONLY intent)
                → Compiler infers loops, generates IDs
                → Output
```

**Benefit:** LLM can't hallucinate execution details, compiler is deterministic

## Success Criteria

A successful test run shows:

1. ✅ **IR Validation Passed** - No forbidden tokens
2. ✅ **Pattern Detection** - Compiler identified delivery pattern
3. ✅ **Loop Inference** - Compiler created loops where needed
4. ✅ **Step Generation** - Correct number of steps with proper IDs
5. ✅ **Variable Flow** - Each step references correct previous variables

## Architecture Files

**LLM Generation:**
- `/lib/agentkit/v6/generation/EnhancedPromptToDeclarativeIRGenerator.ts`
- `/lib/agentkit/v6/generation/prompts/declarative-ir-system.md`
- `/app/api/v6/generate-declarative-ir/route.ts`

**Validation:**
- `/lib/agentkit/v6/logical-ir/validation/DeclarativeIRValidator.ts`
- `/lib/agentkit/v6/logical-ir/schemas/declarative-ir-schema.ts`

**Compilation:**
- `/lib/agentkit/v6/compiler/DeclarativeCompiler.ts`
- `/app/api/v6/compile-declarative/route.ts`

**Testing:**
- `/public/test-v6-declarative.html` (E2E flow)
- `/public/test-v6.html` (Manual IR testing)

## Next Steps

After verifying the declarative pipeline works:

1. **Integration:** Wire this flow into the main agent creation UI
2. **Production:** Replace old Extended IR generator with Declarative IR generator
3. **Monitoring:** Track forbidden token violations in production
4. **Iteration:** Strengthen system prompt based on real-world failures
