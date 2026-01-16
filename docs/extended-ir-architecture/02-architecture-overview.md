# Architecture Overview

## System Design

The Extended IR Architecture consists of 4 main stages that transform user intent into executable workflows.

## Complete Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    USER INPUT LAYER                             │
├─────────────────────────────────────────────────────────────────┤
│ User creates agent via conversational UI                       │
│   ↓                                                             │
│ AI asks clarification questions                                │
│   ↓                                                             │
│ Enhanced Prompt Generated (existing Phase 3)                   │
│   {                                                             │
│     sections: {                                                 │
│       data: [...],                                              │
│       actions: [...],                                           │
│       output: [...],                                            │
│       delivery: [...]                                           │
│     }                                                            │
│   }                                                              │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│              STAGE 1: IR GENERATION (LLM)                       │
├─────────────────────────────────────────────────────────────────┤
│ Component: EnhancedPromptToIRGenerator                         │
│ Model: GPT-4o or Claude Sonnet 4                               │
│                                                                 │
│ Task: Convert Enhanced Prompt → Logical IR                     │
│                                                                 │
│ Categorization Rules:                                          │
│  • data section → data_sources                                 │
│  • "filter", "group", "sort" → transforms                      │
│  • "summarize", "classify" → ai_operations                     │
│  • "if", "when" → conditionals                                 │
│  • output section → rendering                                  │
│  • delivery section → delivery_rules                           │
│                                                                 │
│ Output: Logical IR JSON (hidden from user)                     │
│   {                                                             │
│     goal: "...",                                                │
│     data_sources: [...],                                        │
│     filters: [...],                                             │
│     transforms: [...],                                          │
│     ai_operations: [...],                                       │
│     conditionals: [...],                                        │
│     loops: [...],                                               │
│     delivery: [...]                                             │
│   }                                                              │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│         STAGE 2: NATURAL LANGUAGE TRANSLATION                   │
├─────────────────────────────────────────────────────────────────┤
│ Component: IRToNaturalLanguageTranslator                       │
│ NO LLM - Template-based translation                            │
│                                                                 │
│ Task: IR → Plain English Plan                                  │
│                                                                 │
│ Translation Rules:                                             │
│  • data_sources → "📊 Read data from X"                        │
│  • filters → "🔍 Filter to rows where Y"                       │
│  • ai_operations → "🤖 [instruction]"                          │
│  • delivery → "📧 Send via [method]"                           │
│                                                                 │
│ Output: Natural Language Plan                                  │
│   {                                                             │
│     goal: "Send stage 4 leads to sales people",                │
│     steps: [                                                    │
│       {                                                         │
│         icon: "📊",                                             │
│         title: "Read lead data",                               │
│         details: ["From Google Sheet: MyLeads", ...]           │
│       },                                                        │
│       ...                                                       │
│     ],                                                          │
│     edgeCases: [...],                                           │
│     estimation: { emails: "~5", time: "~30s", cost: "$0.02" }  │
│   }                                                              │
│                                                                 │
│ ┌─────────────────────────────────────────┐                   │
│ │  WorkflowPlanPreview.tsx (React)        │                   │
│ │  Shows plan to user                     │                   │
│ │  [✏️ Edit Request] [✓ Approve & Continue]│                   │
│ └─────────────────────────────────────────┘                   │
│                                                                 │
│ If user edits:                                                 │
│   ↓                                                             │
│ NaturalLanguageCorrectionHandler                               │
│   • Extract correction intent (LLM)                            │
│   • Update IR fields                                           │
│   • Re-translate to English                                    │
│   • Show updated plan                                          │
└─────────────────────────────────────────────────────────────────┘
                              ↓
                      User approves plan
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│           STAGE 3: DETERMINISTIC COMPILATION                    │
├─────────────────────────────────────────────────────────────────┤
│ Component: LogicalIRCompiler                                   │
│ NO LLM - 100% Rule-based                                       │
│                                                                 │
│ Task: IR → PILOT_DSL Workflow                                  │
│                                                                 │
│ Compiler Process:                                              │
│  1. Load IR and plugin context                                 │
│  2. Iterate through compiler rules                             │
│  3. First matching rule compiles IR                            │
│  4. Generate optimized workflow_steps                          │
│                                                                 │
│ Compiler Rules (5 core):                                       │
│  • TabularGroupedDeliveryRule                                  │
│  • EventTriggeredRule                                          │
│  • ConditionalBranchRule                                       │
│  • AgentChainRule                                              │
│  • SingleActionRule                                            │
│                                                                 │
│ Resolvers (deterministic mapping):                             │
│  • DataSourceResolver: data_sources → action steps             │
│  • TransformResolver: filters/transforms → transform steps     │
│  • AIOperationResolver: ai_operations → ai_processing steps    │
│  • ConditionalResolver: conditionals → conditional steps       │
│  • LoopResolver: loops → scatter_gather steps                  │
│  • DeliveryResolver: delivery → action steps                   │
│                                                                 │
│ Output: PILOT_DSL Workflow                                     │
│   {                                                             │
│     workflow_steps: [                                           │
│       { step_id: "step1", type: "action", plugin: "...", ... },│
│       { step_id: "step2", type: "transform", operation: "..." },│
│       { step_id: "step3", type: "ai_processing", ... },        │
│       ...                                                       │
│     ]                                                           │
│   }                                                              │
│                                                                 │
│ Validation & Error Handling:                                   │
│  • If no rule supports IR → return compilation error           │
│  • If plugin not found → suggest alternatives                  │
│  • Invoke IRRepairLoop if errors                               │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│              STAGE 4: EXECUTION                                 │
├─────────────────────────────────────────────────────────────────┤
│ Component: StepExecutor (existing)                             │
│                                                                 │
│ Task: Execute workflow_steps                                   │
│                                                                 │
│ Execution Engine:                                              │
│  • action → PluginExecuterV2                                   │
│  • transform → DataOperations (pure functions)                 │
│  • ai_processing → runAgentKit (LLM with contracts)            │
│  • conditional → ConditionalEvaluator                          │
│  • scatter_gather → ParallelExecutor                           │
│                                                                 │
│ Observability:                                                 │
│  • Real-time step progress                                     │
│  • Plain English status updates                                │
│  • Execution metrics (time, cost, outputs)                     │
│                                                                 │
│ ┌─────────────────────────────────────────┐                   │
│ │  ExecutionProgressUI.tsx (React)        │                   │
│ │  ✅ Step 1: Read data (200 rows)        │                   │
│ │  ✅ Step 2: Filtered to 45 leads        │                   │
│ │  ⏳ Step 3: Sending emails...            │                   │
│ └─────────────────────────────────────────┘                   │
└─────────────────────────────────────────────────────────────────┘
```

## Component Architecture

### Backend Components

```
lib/agentkit/v6/
├── logical-ir/
│   ├── schemas/
│   │   ├── extended-ir-schema.ts          # JSON Schema for OpenAI
│   │   ├── extended-ir-validation.ts      # Zod validation
│   │   └── extended-ir-types.ts           # TypeScript interfaces
│   │
├── generation/
│   ├── EnhancedPromptToIRGenerator.ts     # Stage 1: LLM
│   └── prompts/
│       └── enhanced-to-ir-system.md       # LLM system prompt
│
├── compiler/
│   ├── LogicalIRCompiler.ts               # Main orchestrator
│   ├── rules/
│   │   ├── CompilerRule.ts                # Interface
│   │   ├── TabularGroupedDeliveryRule.ts  # Rule 1
│   │   ├── EventTriggeredRule.ts          # Rule 2
│   │   ├── ConditionalBranchRule.ts       # Rule 3
│   │   ├── AgentChainRule.ts              # Rule 4
│   │   └── SingleActionRule.ts            # Rule 5
│   └── resolvers/
│       ├── DataSourceResolver.ts
│       ├── TransformResolver.ts
│       ├── AIOperationResolver.ts
│       ├── ConditionalResolver.ts
│       ├── LoopResolver.ts
│       └── DeliveryResolver.ts
│
├── translation/
│   ├── IRToNaturalLanguageTranslator.ts   # Stage 2: IR → English
│   ├── NaturalLanguageCorrectionHandler.ts # User edits
│   └── templates/
│       └── plan-templates.ts              # English phrases
│
├── repair/
│   └── IRRepairLoop.ts                    # Error correction
│
└── v6-generator.ts                         # Main orchestrator
```

### Frontend Components

```
components/agent-creation/
├── AgentBuilderParent.tsx                  # Modified: add IR phase
├── WorkflowPlanPreview.tsx                 # New: shows natural language plan
└── ExecutionProgressUI.tsx                 # New: real-time execution updates
```

### API Endpoints

```
app/api/
├── generate-workflow-plan/
│   └── route.ts                            # Enhanced Prompt → IR → English
├── compile-workflow/
│   └── route.ts                            # IR → PILOT_DSL
└── update-workflow-plan/
    └── route.ts                            # Handle user corrections
```

## Data Flow

### IR Generation Flow

```
Enhanced Prompt
{
  sections: {
    data: [
      "Read from Google Sheet MyLeads tab Leads",
      "Column 'stage' = qualification indicator"
    ],
    actions: [
      "Filter rows where stage = 4",
      "Group by Sales Person column"
    ],
    delivery: [
      "Send one email per salesperson",
      "CC Barak on all emails"
    ]
  }
}
        ↓
EnhancedPromptToIRGenerator (LLM)
        ↓
Logical IR
{
  goal: "Send stage 4 leads to sales people",
  data_sources: [{
    id: "leads_data",
    type: "tabular",
    source: "google_sheets",
    location: "MyLeads",
    tab: "Leads"
  }],
  filters: [{
    field: "stage",
    operator: "equals",
    value: 4
  }],
  partitions: [{
    field: "Sales Person",
    split_by: "value"
  }],
  delivery_rules: {
    per_group_delivery: {
      recipient_source: "group_key",
      cc: ["meiribarak@gmail.com"]
    }
  }
}
```

### Compilation Flow

```
Logical IR
        ↓
LogicalIRCompiler.compile(ir)
        ↓
Rule Selection:
  for (const rule of this.rules) {
    if (rule.supports(ir)) {
      return rule.compile(ir)
    }
  }
        ↓
TabularGroupedDeliveryRule matches
        ↓
Resolvers generate steps:
  1. DataSourceResolver → action step (Google Sheets read)
  2. TransformResolver → transform step (filter)
  3. TransformResolver → transform step (partition)
  4. LoopResolver → scatter_gather step
  5. DeliveryResolver → action steps (Gmail send)
        ↓
PILOT_DSL Workflow
{
  workflow_steps: [
    { step_id: "step1", type: "action", plugin: "google-sheets", ... },
    { step_id: "step2", type: "transform", operation: "filter", ... },
    { step_id: "step3", type: "scatter_gather", ... }
  ]
}
```

## Key Design Decisions

### 1. Separation of Concerns

**Principle:** Intent generation (LLM) is separate from execution planning (compiler)

**Why:**
- LLMs are good at understanding user intent
- LLMs are bad at consistent execution planning
- Compilers are deterministic and testable

**Result:** Predictable, reliable workflows

### 2. Natural Language UX Layer

**Principle:** Hide technical complexity from non-technical users

**Why:**
- Platform targets non-technical users
- JSON/IR is intimidating
- Plain English builds trust

**Result:** Users understand and approve plans confidently

### 3. Explicit AI Operations

**Principle:** IR explicitly declares when AI processing is needed

**Why:**
- Prevents AI overuse (V4's 60% problem)
- Makes AI usage intentional, not accidental
- Compiler maps deterministically

**Result:** 70-80% of steps are deterministic (vs 40% in V4)

### 4. Deterministic Compilation

**Principle:** Compiler never calls LLM, uses pattern matching

**Why:**
- Same IR → same workflow (predictable)
- Fast compilation (no LLM latency)
- Testable and auditable

**Result:** Reliable, consistent agent generation

### 5. Rule-Based Compiler

**Principle:** Explicit compiler rules for workflow patterns

**Why:**
- Clear, documented decision logic
- Extensible (add new rules for new patterns)
- Maintainable (no black box)

**Result:** Scalable architecture

### 6. Error Repair Loop

**Principle:** If compilation fails, LLM repairs IR

**Why:**
- LLM-generated IR may be invalid
- Compilation errors are specific and actionable
- LLM can fix structural issues

**Result:** High success rate (90%+)

## Comparison with V4

| Aspect | V4 Architecture | Extended IR Architecture |
|--------|----------------|-------------------------|
| **LLM Stages** | 2 (Stage 1 + fallback) | 1 (IR generation only) |
| **LLM Role** | Generates execution steps | Generates intent only |
| **Compilation** | Heuristic (DSL Builder) | Rule-based (Compiler) |
| **User Preview** | Technical workflow steps | Plain English plan |
| **Corrections** | Regenerate (unpredictable) | Update IR (predictable) |
| **AI Steps** | 60% (overused) | 20-30% (optimized) |
| **Determinism** | Low (LLM varies) | High (compiler consistent) |
| **Trust Score** | 23/50 | 55/60 |

## Integration Points

### With Existing Systems

**Reused Components:**
- ✅ ConversationalAgentBuilderV2 - No changes
- ✅ Enhanced Prompt Generation - No changes
- ✅ SmartAgentBuilder - No changes
- ✅ StepExecutor - No changes
- ✅ PluginManagerV2 - No changes
- ✅ Existing PILOT_DSL schema - No changes

**New Components:**
- WorkflowPlanPreview (UI)
- IR Generator (backend)
- Compiler & Rules (backend)
- Natural Language Translator (backend)

**Modified Components:**
- AgentBuilderParent (add IR phase)
- generate-agent-v4 route (add V6 path)

### Coexistence with V4

```typescript
// Feature flag controls which path
if (useExtendedIRArchitecture()) {
  // V6 Path: Enhanced Prompt → IR → Compiler → DSL
  const ir = await generateLogicalIR(enhancedPrompt)
  const plan = translateToEnglish(ir)
  // Show plan preview...
  const workflow = await compileIR(ir)
} else {
  // V4 Path: Enhanced Prompt → Stage 1 → DSL Builder → DSL
  const stepPlan = await extractStepPlan(enhancedPrompt)
  const workflow = buildDSL(stepPlan)
}
```

Both paths produce the same PILOT_DSL format → execution is identical.

## Scalability

### Adding New Workflow Patterns

```typescript
// 1. Extend IR schema
interface ExtendedLogicalIR {
  // ... existing fields
  new_pattern: NewPatternConfig[]  // Add new field
}

// 2. Create new compiler rule
class NewPatternRule implements CompilerRule {
  supports(ir: ExtendedLogicalIR): boolean {
    return ir.new_pattern !== undefined
  }

  compile(ir: ExtendedLogicalIR): CompilerResult {
    // Map new_pattern → workflow_steps
  }
}

// 3. Register rule
compiler.addRule(new NewPatternRule())
```

**No changes to:**
- LLM prompts (auto-categorizes)
- Natural language translator (template-based)
- Execution layer (uses existing step types)

### Adding New Step Types

```typescript
// 1. Add to PILOT_DSL schema (existing)
// 2. Add resolver
class NewStepResolver {
  resolve(irField: any): WorkflowStep {
    return { type: 'new_step_type', ... }
  }
}

// 3. Add executor (existing StepExecutor)
```

**Extensible at every layer.**

---

**Next:** [Trust Analysis](./03-trust-analysis.md) - Detailed scoring and comparison
