# Claude Development Principles

## Core Principle: No Hardcoding

**NEVER add hardcoded rules, patterns, or specific plugin knowledge to system prompts.**

### Why This Matters

The platform is designed for **non-technical users** building workflows with **any plugin**. Hardcoding specific patterns doesn't scale:

- ❌ Hardcoding "use find_or_create_folder for Google Drive" → what about Dropbox? OneDrive? Custom plugins?
- ❌ Hardcoding "don't use AI for data restructuring" → what if a custom plugin requires AI for that use case?
- ❌ Hardcoding specific field names or API patterns → breaks when plugins change

### The Right Approach

**Let the LLM learn from:**
1. **Plugin schemas** - The source of truth for what operations are available and how to use them
2. **Examples** - Generic patterns that apply to ALL plugins (loops, conditionals, data flow)
3. **Error feedback** - When something fails, the validation/compilation error guides the fix

**System prompts should:**
- ✅ Explain the IR schema structure (nodes, edges, variables)
- ✅ Provide generic patterns (how to create loops, how to pass data between nodes)
- ✅ Reference plugin schemas as the source of truth for operation specifics
- ❌ Never say "for Google Drive, do X" or "when using Gmail, do Y"

### Example: The Right Way to Handle Folder Creation

**Wrong approach (hardcoded):**
```
When creating folders in Google Drive, use find_or_create_folder action to avoid errors.
```

**Right approach (schema-driven):**
```
Read the plugin schema to find the appropriate action for creating resources.
If a plugin offers both create_X and find_or_create_X actions, prefer find_or_create_X
as it handles idempotency (won't fail if resource already exists).
```

The LLM learns the **principle** (idempotency) not the **hardcoded solution** (specific action name).

### Current Issues to Fix

1. **AI overuse** - LLM is generating extra AI steps for simple data transformation
   - **Problem**: Workflows have unnecessary AI steps that just reformat already-structured data
   - **Example**: After `deterministic_extract` returns `{date, vendor, amount}`, LLM adds ANOTHER AI step to "create complete record" by merging these fields
   - **Solution**: The compiler should detect and optimize these patterns automatically
   - **Implementation**: Add post-compilation optimization pass that removes redundant AI merge operations (see `ExecutionGraphCompiler.optimizeWorkflow()` - already partially implemented!)

2. **Variable scoping** - Variables from outer loops not accessible in inner loops
   - **Problem**: Nested scatter_gather loops may not have access to outer loop variables
   - **Solution**: Compiler should validate scope and provide clear error messages, NOT via prompt rules
   - **Implementation**: Add scope validation in compiler that checks variable references across loop boundaries

3. **Folder/resource existence handling** - Operations fail on second run
   - **Problem**: Using `create_folder` fails if folder already exists (not idempotent)
   - **Solution**: Plugin schemas should indicate which operations are idempotent, compiler can suggest alternatives
   - **Implementation**: Add `idempotent: boolean` field to plugin action schemas, compiler warns if non-idempotent action used without existence check

## Semantic Determinism Principle

**System prompts must guide toward compiler-deterministic patterns without hardcoding use cases.**

### The Challenge

Even when contracts are schema-valid, they can be semantically ambiguous, forcing the compiler to "guess":

- ❌ `TransformStep` with `op: "group"` and vague description → compiler doesn't know output structure
- ❌ `DeliverStep` without `destination` → compiler must infer from options (ambiguous)
- ❌ Use-case-specific examples like "high_value_transactions" → doesn't generalize

### The Solution

**Guide LLM toward patterns that create explicit symbolic refs:**

✅ **Use AggregateStep with subset outputs** instead of TransformStep with group
```typescript
// Deterministic: creates named refs "subset_a" and "subset_b"
aggregate: {
  outputs: [
    { name: "subset_a", type: "subset", where: Condition },
    { name: "subset_b", type: "subset", where: Condition }
  ]
}

// Ambiguous: compiler must parse description to understand structure
transform: {
  op: "group",
  description: "split into subset_a and subset_b"
}
```

✅ **Use ArtifactStep + destination ref** for persistent targets
```typescript
// Step 1: Create artifact with symbolic output
{ kind: "artifact", output: "target_sheet", artifact: {...} }

// Step 2: Reference it explicitly
{ kind: "deliver", deliver: { destination: "target_sheet" } }
```

✅ **Use generic examples** in prompts
```
// Good: generic field names
"filtered_subset_a", "filtered_subset_b", "items", "value"

// Bad: use-case specific names
"high_value_transactions", "low_value_transactions", "amount"
```

### Where to Enforce

1. **System prompt**: Guide toward deterministic patterns (prefer X over Y when...)
2. **Schema**: Make ambiguous fields required if needed (`destination` could be required for certain intents)
3. **Compiler**: Validate symbolic ref existence, reject ambiguous patterns with clear errors

## Fix Issues at the Root Cause

**ALWAYS fix issues at the phase/component responsible for the problem, not downstream.**

### The Principle

When you identify an issue in the pipeline output (e.g., PILOT DSL), trace it back to its root cause:

1. **Is it an LLM generation issue?** → Fix the prompt in IntentContract generation
2. **Is it a binding issue?** → Fix CapabilityBinderV2 logic
3. **Is it a conversion issue?** → Fix IntentToIRConverter
4. **Is it a compilation issue?** → Fix ExecutionGraphCompiler

**ONLY implement deterministic fixes in downstream phases if:**
- ✅ The fix can scale to ANY plugin/operation (schema-driven, no hardcoding)
- ✅ It's genuinely a compiler optimization (e.g., removing redundant steps)
- ✅ The root cause phase cannot reasonably handle it

### Example: Attachment Download Step

**Problem**: Gmail `search_emails` returns attachment metadata (no bytes), but Drive `upload_file` needs bytes.

**Wrong approach**: Add hardcoded logic in ExecutionGraphCompiler to detect Gmail attachments and insert download steps.
- ❌ Doesn't scale to other email providers (Outlook, custom plugins)
- ❌ Hardcodes plugin-specific knowledge
- ❌ Makes compiler more complex

**Right approach**: Fix the IntentContract generation prompt to recognize this pattern.
- ✅ LLM already has plugin schemas showing what each action returns
- ✅ LLM can reason: "search returns metadata → need download step → then upload"
- ✅ Scales to ANY plugin combination
- ✅ Keeps deterministic pipeline clean and generic

### When Deterministic Fixes ARE Appropriate

Compiler optimizations that scale generically:
- ✅ Removing redundant AI merge operations (already implemented)
- ✅ Auto-unwrapping response arrays (e.g., `emails.emails` → `emails`)
- ✅ Parameter name normalization via schema fuzzy matching
- ✅ Variable reference normalization (`{{var}}` wrapping)

These are **not plugin-specific** - they apply to any plugin that follows the schema patterns.

## Bottom Line

**If you find yourself adding specific instructions for specific plugins or patterns → STOP.**

Instead, ask:
- **Which phase is responsible for this?** Fix it there, not downstream
- Can the plugin schema provide this information?
- Can the compiler detect and fix this automatically **in a scalable way**?
- Can validation provide better error messages to guide the LLM?
- Does this create semantic ambiguity for the compiler?

The platform should be **self-documenting** through schemas and **self-correcting** through validation, NOT dependent on an ever-growing prompt with hardcoded rules or plugin-specific logic in the deterministic pipeline.
