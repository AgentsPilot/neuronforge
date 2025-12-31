# Phase 4 Correction Mini-Cycle Implementation

## Overview

This document describes the implementation plan for adding a feedback correction loop to Phase 4 (Technical Workflow Generation), similar to the existing Phase 2 mini-cycle pattern used for user input refinement.

**Goal**: Allow Phase 4 to receive feedback about issues in the technical workflow and self-correct before passing to the DSL generator.

---

## Current vs. Proposed Flow

### Current Flow (Phase 4 Not Wired)

```
Phase 3 (enhanced_prompt) → generate-agent-v4 → DSL → Agent Created
```

### Proposed Flow with Phase 4 Correction Cycle

```
Phase 3 (enhanced_prompt) → Phase 4 (technical_workflow)
                                    │
                        ┌───────────┴───────────┐
                        ▼                       ▼
                   Issues Found           Ready to Execute
                        │                       │
                        ▼                       ▼
                   Phase 4 Mini-Cycle    generate-agent-v4 → DSL
                        │
                        ▼
                   User/System Feedback
                        │
                        ▼
                   Re-run Phase 4
                        │
                        ▼
                   (Loop until resolved or max attempts)
```

---

## Three Types of Phase 4 Feedback

### 1. Validation/Feasibility Feedback (Automatic)

Triggered when Phase 4 returns issues from schema validation or feasibility check.

**Trigger Conditions:**
- `feasibility.blocking_issues.length > 0`
- `technical_inputs_required.length > 0` (unresolved)
- Schema validation errors

**Frontend Implementation:**

```typescript
// In page.tsx after processPhase4()
if (phase4Response.feasibility.blocking_issues.length > 0 ||
    phase4Response.technical_inputs_required.length > 0) {

  // Enter Phase 4 mini-cycle
  setIsInPhase4MiniCycle(true);
  setPendingTechnicalWorkflow(phase4Response.technical_workflow);

  // Re-run Phase 4 with feedback
  await processPhase4({
    thread_id: threadId,
    phase: 4,
    technical_feedback: {
      blocking_issues: phase4Response.feasibility.blocking_issues,
      missing_inputs: phase4Response.technical_inputs_required,
      action: 'resolve_issues'
    },
    enhanced_prompt: enhancedPromptData,
    previous_technical_workflow: phase4Response.technical_workflow
  });
}
```

---

### 2. User Correction Feedback (Manual Review)

Allow users to review technical steps and request changes before DSL generation.

**UI Pattern:** Similar to "Need changes" button in Phase 3 approval.

**Frontend Implementation:**

```typescript
// Handler for "Need changes" on technical workflow card
const handleTechnicalWorkflowEdit = () => {
  setIsAwaitingTechnicalFeedback(true);
  addAIMessage("What changes would you like to the technical workflow?");
};

// On user feedback submission
const handleTechnicalFeedback = async (feedback: string) => {
  setIsAwaitingTechnicalFeedback(false);

  await processPhase4({
    thread_id: threadId,
    phase: 4,
    user_feedback: feedback,  // Free-form correction request
    enhanced_prompt: enhancedPromptData,
    previous_technical_workflow: technicalWorkflow
  });
};
```

---

### 3. DSL/Execution Error Feedback (Post-Generation)

Feed back errors from DSL builder or agent execution to Phase 4 for correction.

**Trigger Conditions:**
- `generate-agent-v4` returns `success: false`
- `generate-agent-v4` returns warnings that indicate workflow issues
- Agent execution fails with step-specific errors

**Frontend Implementation:**

```typescript
// After generate-agent-v4 fails or returns warnings
const generateResult = await fetch('/api/generate-agent-v4', { ... });

if (!generateResult.success || generateResult.warnings?.length > 0) {
  // Feed errors back to Phase 4 for correction
  await processPhase4({
    thread_id: threadId,
    phase: 4,
    technical_feedback: {
      dsl_errors: generateResult.errors,
      dsl_warnings: generateResult.warnings,
      action: 'fix_dsl_issues'
    },
    enhanced_prompt: enhancedPromptData,
    previous_technical_workflow: technicalWorkflow
  });
}
```

---

## API Schema Changes

### New Request Fields for Phase 4 Mini-Cycle

Add to `ProcessMessageRequest` in `components/agent-creation/types/agent-prompt-threads.ts`:

```typescript
interface Phase4MiniCycleRequest {
  thread_id: string;
  phase: 4;
  enhanced_prompt: EnhancedPrompt;

  // Mini-cycle specific fields
  previous_technical_workflow?: TechnicalWorkflowStep[];  // From previous Phase 4 run
  technical_feedback?: {
    blocking_issues?: BlockingIssue[];
    missing_inputs?: TechnicalInputRequired[];
    dsl_errors?: string[];
    dsl_warnings?: string[];
    action: 'resolve_issues' | 'fix_dsl_issues' | 'user_correction';
  };
  user_feedback?: string;  // Free-form user corrections
  technical_inputs_collected?: Record<string, string>;  // Resolved inputs
}
```

### New Response Metadata Fields

Add to `Phase4Metadata` in `lib/validation/phase4-schema.ts`:

```typescript
interface Phase4Metadata {
  // Existing fields
  can_execute: boolean;
  needs_technical_inputs: boolean;
  needs_user_feedback: boolean;

  // New fields for mini-cycle
  is_correction_cycle: boolean;       // True if this is a correction iteration
  correction_attempt: number;         // 1, 2, 3... (max 3 recommended)
  issues_resolved: string[];          // What was fixed this iteration
  remaining_issues: string[];         // Still needs attention
  correction_confidence: number;      // 0-1 confidence in the fix
}
```

---

## Frontend State Variables

Add to `app/v2/agents/new/page.tsx`:

```typescript
// Phase 4 mini-cycle state
const [isInPhase4MiniCycle, setIsInPhase4MiniCycle] = useState(false);
const [pendingTechnicalWorkflow, setPendingTechnicalWorkflow] = useState<TechnicalWorkflowStep[] | null>(null);
const [technicalFeedback, setTechnicalFeedback] = useState<TechnicalFeedback | null>(null);
const [isAwaitingTechnicalFeedback, setIsAwaitingTechnicalFeedback] = useState(false);
const [phase4CorrectionAttempt, setPhase4CorrectionAttempt] = useState(0);

// Max correction attempts before requiring user intervention
const MAX_PHASE4_CORRECTIONS = 3;
```

---

## Backend Handler Changes

Update `app/api/agent-creation/process-message/route.ts` to handle Phase 4 corrections:

```typescript
// In Phase 4 handling section
if (phase === 4) {
  const {
    enhanced_prompt,
    previous_technical_workflow,
    technical_feedback,
    user_feedback,
    technical_inputs_collected
  } = body;

  // Determine if this is a correction cycle
  const isCorrectionCycle = !!(previous_technical_workflow || technical_feedback || user_feedback);

  // Build Phase 4 user message with correction context
  const phase4UserMessage = {
    phase: 4,
    enhanced_prompt,
    schema_services,  // Auto-generated

    // Correction cycle fields
    ...(isCorrectionCycle && {
      is_correction_cycle: true,
      previous_technical_workflow,
      technical_feedback,
      user_feedback,
      technical_inputs_collected
    })
  };

  // Call LLM with correction context
  const aiResponse = await callAIProvider(phase4UserMessage);

  // Validate response with correction-aware schema
  const validatedResponse = validatePhase4Response(aiResponse, { isCorrectionCycle });

  // Store iteration in thread metadata
  await storeIteration(threadId, phase, phase4UserMessage, validatedResponse);

  return NextResponse.json(validatedResponse);
}
```

---

## LLM Prompt Additions

Add to `app/api/prompt-templates/Workflow-Agent-Creation-Prompt-v15-chatgpt.txt`:

```markdown
## PHASE 4 CORRECTION MODE

When you receive a Phase 4 request with `is_correction_cycle: true`:

### Input Context
- `previous_technical_workflow`: The workflow from your previous attempt
- `technical_feedback`: Structured feedback about what went wrong
- `user_feedback`: Free-form user correction request

### Correction Process

1. **Analyze the Feedback**
   - For `blocking_issues`: Identify which steps caused the issue and why
   - For `dsl_errors`: Map errors to specific workflow steps by step ID
   - For `missing_inputs`: Determine if inputs can be inferred or must be collected
   - For `user_feedback`: Parse the requested changes

2. **Generate Corrected Workflow**
   - PRESERVE working steps from `previous_technical_workflow` (don't regenerate everything)
   - FIX or REPLACE only the problematic steps
   - MAINTAIN step ID references for traceability (step1_v2, step2_v2, etc.)
   - ENSURE all step references (from_step) point to valid steps

3. **Document Corrections**
   - `metadata.issues_resolved`: List what was fixed (e.g., "Fixed missing slack channel input")
   - `metadata.remaining_issues`: List what couldn't be resolved automatically
   - `metadata.correction_attempt`: Increment from previous attempt
   - `metadata.correction_confidence`: Your confidence in the fix (0-1)

4. **Escalation Rules**
   - If you cannot fix an issue after 2 attempts, set `needs_user_feedback: true`
   - If the issue requires plugin capabilities you don't have, add to `blocking_issues`
   - If the user's request contradicts the enhanced_prompt, ask for clarification

### Example Correction Response

```json
{
  "technical_workflow": [
    // ... corrected steps ...
  ],
  "technical_inputs_required": [],
  "feasibility": {
    "can_execute": true,
    "blocking_issues": [],
    "warnings": []
  },
  "metadata": {
    "ready_for_generation": true,
    "phase4": {
      "can_execute": true,
      "needs_technical_inputs": false,
      "needs_user_feedback": false,
      "is_correction_cycle": true,
      "correction_attempt": 2,
      "issues_resolved": [
        "Fixed invalid action reference 'sendEmail' -> 'send' for google-mail plugin",
        "Added missing 'channel_id' input for slack.postMessage"
      ],
      "remaining_issues": [],
      "correction_confidence": 0.95
    }
  },
  "conversationalSummary": "I've corrected the workflow. The email action now uses the correct 'send' method, and I've added the Slack channel input. Ready for generation."
}
```
```

---

## Zod Schema Updates

Add to `lib/validation/phase4-schema.ts`:

```typescript
// Correction-specific metadata schema
const Phase4CorrectionMetadataSchema = z.object({
  is_correction_cycle: z.boolean(),
  correction_attempt: z.number().min(1).max(5),
  issues_resolved: z.array(z.string()),
  remaining_issues: z.array(z.string()),
  correction_confidence: z.number().min(0).max(1)
});

// Extended Phase 4 metadata with optional correction fields
const Phase4MetadataSchemaV2 = Phase4MetadataSchema.extend({
  is_correction_cycle: z.boolean().optional().default(false),
  correction_attempt: z.number().optional().default(0),
  issues_resolved: z.array(z.string()).optional().default([]),
  remaining_issues: z.array(z.string()).optional().default([]),
  correction_confidence: z.number().optional()
});

// Technical feedback schema for requests
const TechnicalFeedbackSchema = z.object({
  blocking_issues: z.array(BlockingIssueSchema).optional(),
  missing_inputs: z.array(TechnicalInputRequiredSchema).optional(),
  dsl_errors: z.array(z.string()).optional(),
  dsl_warnings: z.array(z.string()).optional(),
  action: z.enum(['resolve_issues', 'fix_dsl_issues', 'user_correction'])
});
```

---

## Implementation Files

| Component | File | Changes Required |
|-----------|------|------------------|
| Frontend State | `app/v2/agents/new/page.tsx` | Add Phase 4 mini-cycle state variables |
| Process Phase 4 | `app/v2/agents/new/page.tsx` | Add `processPhase4()` function with correction support |
| Backend Handler | `app/api/agent-creation/process-message/route.ts` | Handle `technical_feedback` and `previous_technical_workflow` |
| TypeScript Types | `components/agent-creation/types/agent-prompt-threads.ts` | Add Phase 4 correction types |
| Validation Schema | `lib/validation/phase4-schema.ts` | Add correction metadata and feedback schemas |
| LLM Prompt | `app/api/prompt-templates/Workflow-Agent-Creation-Prompt-v15-chatgpt.txt` | Add Phase 4 correction instructions |
| UI Component | `components/agent-creation/TechnicalWorkflowCard.tsx` | New component for reviewing technical steps |

---

## Suggested Implementation Order

### Phase 1: Wire Phase 4 into Frontend
1. Add `processPhase4()` function to `page.tsx`
2. Add Phase 4 state variables
3. Call Phase 4 after Phase 3 approval (before generate-agent-v4)
4. Display technical workflow for user review

### Phase 2: Add Correction Loop Infrastructure
1. Update `process-message/route.ts` to handle correction parameters
2. Add Zod schemas for correction metadata and feedback
3. Update TypeScript types

### Phase 3: Implement Automatic Corrections
1. Add feasibility/validation error detection
2. Implement automatic re-run with `technical_feedback`
3. Add max attempts limit and escalation to user

### Phase 4: Implement User Corrections
1. Add "Need changes" button to technical workflow card
2. Implement `handleTechnicalFeedback()` flow
3. Add feedback input UI

### Phase 5: Integrate DSL Error Feedback
1. Capture errors from `generate-agent-v4`
2. Map errors back to technical workflow steps
3. Trigger correction cycle with DSL error context

---

## Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Phase 3 Complete (ready_for_generation: true)                          │
│  User clicks "Approve Plan"                                             │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Phase 4 - Initial Technical Workflow Generation                        │
│  ─────────────────────────────────────────────────────────────────────  │
│  POST /api/agent-creation/process-message                               │
│  Body: { phase: 4, enhanced_prompt, schema_services }                   │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
                    ┌────────────┴────────────┐
                    │   Evaluate Response     │
                    └────────────┬────────────┘
                                 │
         ┌───────────────────────┼───────────────────────┐
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ blocking_issues │    │ technical_inputs│    │ can_execute:    │
│ detected        │    │ _required > 0   │    │ true            │
└────────┬────────┘    └────────┬────────┘    └────────┬────────┘
         │                      │                      │
         ▼                      ▼                      ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ Auto-Correction │    │ Collect Inputs  │    │ Show Workflow   │
│ Cycle           │    │ from User       │    │ for Review      │
│                 │    │                 │    │                 │
│ Re-run Phase 4  │    │ Re-run Phase 4  │    │ [Approve][Edit] │
│ with feedback   │    │ with collected  │    │                 │
└────────┬────────┘    │ inputs          │    └────────┬────────┘
         │             └────────┬────────┘             │
         │                      │                      │
         └──────────────────────┼──────────────────────┤
                                │                      │
                                ▼                      │
                    ┌───────────────────────┐          │
                    │ Max Attempts Reached? │          │
                    └───────────┬───────────┘          │
                                │                      │
                    ┌───────────┴───────────┐          │
                    │                       │          │
                    ▼                       ▼          │
           ┌──────────────┐       ┌──────────────┐     │
           │ Yes: Escalate│       │ No: Continue │     │
           │ to User      │       │ Correction   │     │
           └──────┬───────┘       └──────────────┘     │
                  │                                    │
                  ▼                                    │
         ┌─────────────────┐                           │
         │ User Reviews &  │                           │
         │ Provides        │                           │
         │ Feedback        │◄──────────────────────────┤
         └────────┬────────┘         (Edit clicked)    │
                  │                                    │
                  ▼                                    │
         ┌─────────────────┐                           │
         │ Re-run Phase 4  │                           │
         │ with user_      │                           │
         │ feedback        │                           │
         └────────┬────────┘                           │
                  │                                    │
                  └────────────────────────────────────┤
                                                       │
                                                       ▼
                                          ┌────────────────────────┐
                                          │ User Approves Workflow │
                                          └───────────┬────────────┘
                                                      │
                                                      ▼
                                          ┌────────────────────────┐
                                          │ generate-agent-v4      │
                                          │ with technical_workflow│
                                          └───────────┬────────────┘
                                                      │
                                          ┌───────────┴───────────┐
                                          │                       │
                                          ▼                       ▼
                                   ┌────────────┐          ┌────────────┐
                                   │ DSL Errors │          │ Success    │
                                   └─────┬──────┘          └─────┬──────┘
                                         │                       │
                                         ▼                       ▼
                                   ┌────────────┐          ┌────────────┐
                                   │ Feed Back  │          │ Create     │
                                   │ to Phase 4 │          │ Agent      │
                                   └────────────┘          └────────────┘
```

---

## Success Criteria

1. **Automatic Correction**: Phase 4 can self-correct common issues without user intervention
2. **User Feedback Loop**: Users can request changes to technical workflow before DSL generation
3. **DSL Error Recovery**: Errors from generate-agent-v4 are fed back for correction
4. **Iteration Tracking**: All correction attempts are stored in thread metadata
5. **Max Attempts Limit**: System escalates to user after 3 failed correction attempts
6. **Audit Trail**: Full correction history available for debugging

---

## Related Documentation

- [V2_Thread-Based-Agent-Creation-Flow.md](./V2_Thread-Based-Agent-Creation-Flow.md) - Main flow documentation
- [PHASE3_SCHEMA_VALIDATION.md](./PHASE3_SCHEMA_VALIDATION.md) - Phase 3 validation patterns
- [V5_GENERATOR_ARCHITECTURE.md](./V5_GENERATOR_ARCHITECTURE.md) - V5 generator with LLM review

---

**Document Version**: 1.0
**Created**: 2025-12-31
**Author**: Development Team
