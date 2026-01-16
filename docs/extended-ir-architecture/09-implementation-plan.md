# Implementation Plan

## 8-Week Roadmap

### Phase 1: Core IR System (Weeks 1-3)

**Goal:** Build IR generation and compilation infrastructure

**Week 1: IR Schema & Validation**
- [ ] Day 1-2: Create `extended-ir-schema.ts` (JSON Schema for LLM)
- [ ] Day 3: Create `extended-ir-validation.ts` (Zod schemas)
- [ ] Day 4: Create `extended-ir-types.ts` (TypeScript interfaces)
- [ ] Day 5: Unit tests for schema validation

**Deliverables:**
- `lib/agentkit/v6/logical-ir/schemas/` (3 files)
- 90%+ test coverage

**Week 2: IR Generation & Compiler Framework**
- [ ] Day 1-2: Create `EnhancedPromptToIRGenerator.ts`
- [ ] Day 2-3: Write LLM system prompt for IR generation
- [ ] Day 4: Create `LogicalIRCompiler.ts` framework
- [ ] Day 5: Create `CompilerRule.ts` interface

**Deliverables:**
- `lib/agentkit/v6/generation/` (2 files)
- `lib/agentkit/v6/compiler/` (2 files)

**Week 3: Compiler Rules & Resolvers**
- [ ] Day 1: `TabularGroupedDeliveryRule.ts` 
- [ ] Day 2: `EventTriggeredRule.ts` + `SingleActionRule.ts`
- [ ] Day 3: All 6 resolvers (DataSource, Transform, AI, Conditional, Loop, Delivery)
- [ ] Day 4: Integration tests (IR → DSL compilation)
- [ ] Day 5: Error handling & IR repair loop

**Deliverables:**
- `lib/agentkit/v6/compiler/rules/` (5 files)
- `lib/agentkit/v6/compiler/resolvers/` (6 files)
- Compilation success rate: 85%+

---

### Phase 2: Natural Language UX (Weeks 4-5)

**Goal:** Build user-facing preview and correction system

**Week 4: Translation & UI Components**
- [ ] Day 1-2: Create `IRToNaturalLanguageTranslator.ts`
- [ ] Day 3: Create `NaturalLanguageCorrectionHandler.ts`
- [ ] Day 4-5: Create `WorkflowPlanPreview.tsx` component

**Deliverables:**
- `lib/agentkit/v6/translation/` (2 files)
- `components/agent-creation/WorkflowPlanPreview.tsx`

**Week 5: Integration & API Endpoints**
- [ ] Day 1: Create `/api/generate-workflow-plan`
- [ ] Day 2: Create `/api/compile-workflow`
- [ ] Day 3: Create `/api/update-workflow-plan`
- [ ] Day 4: Modify `AgentBuilderParent.tsx`
- [ ] Day 5: Add feature flag + testing

**Deliverables:**
- 3 new API endpoints
- Modified `AgentBuilderParent.tsx`
- Feature flag system

---

### Phase 3: Execution Observability (Week 6)

**Goal:** Real-time execution updates in plain English

**Week 6: Progress UI & Streaming**
- [ ] Day 1-2: Enhance `StepExecutor.ts` with event emitters
- [ ] Day 3: Create SSE endpoint for real-time updates
- [ ] Day 4: Create/enhance `ExecutionProgressUI.tsx`
- [ ] Day 5: Integration testing

**Deliverables:**
- Modified `StepExecutor.ts`
- `/api/execute-workflow/stream` endpoint
- `ExecutionProgressUI.tsx`

---

### Phase 4: Extended Compiler Rules (Week 7)

**Goal:** Support more workflow patterns

**Week 7: Additional Rules & AI Operations**
- [ ] Day 1: `ConditionalBranchRule.ts`
- [ ] Day 2: `AgentChainRule.ts`
- [ ] Day 3: `AIOperationResolver.ts` + `ai_operations` schema
- [ ] Day 4: Add `loops` and `conditionals` to IR schema
- [ ] Day 5: Integration tests for new patterns

**Deliverables:**
- 2 new compiler rules
- Extended IR schema with ai_operations, loops, conditionals
- Coverage: 60% → 85% of workflows

---

### Phase 5: Testing & Refinement (Week 8)

**Goal:** A/B testing, performance optimization, production readiness

**Week 8: Testing & Rollout Prep**
- [ ] Day 1: A/B testing framework
- [ ] Day 2: Test with 50 real user prompts
- [ ] Day 3: Performance optimization
- [ ] Day 4: Documentation updates
- [ ] Day 5: Production deployment prep

**Deliverables:**
- A/B test results (V4 vs V6)
- Performance benchmarks
- Production deployment guide

---

## File Creation Checklist

### Backend (20 files)

**Schemas (3 files):**
- [ ] `lib/agentkit/v6/logical-ir/schemas/extended-ir-schema.ts`
- [ ] `lib/agentkit/v6/logical-ir/schemas/extended-ir-validation.ts`
- [ ] `lib/agentkit/v6/logical-ir/schemas/extended-ir-types.ts`

**Generation (2 files):**
- [ ] `lib/agentkit/v6/generation/EnhancedPromptToIRGenerator.ts`
- [ ] `lib/agentkit/v6/generation/prompts/enhanced-to-ir-system.md`

**Compiler (8 files):**
- [ ] `lib/agentkit/v6/compiler/LogicalIRCompiler.ts`
- [ ] `lib/agentkit/v6/compiler/rules/CompilerRule.ts`
- [ ] `lib/agentkit/v6/compiler/rules/TabularGroupedDeliveryRule.ts`
- [ ] `lib/agentkit/v6/compiler/rules/EventTriggeredRule.ts`
- [ ] `lib/agentkit/v6/compiler/rules/ConditionalBranchRule.ts`
- [ ] `lib/agentkit/v6/compiler/rules/AgentChainRule.ts`
- [ ] `lib/agentkit/v6/compiler/rules/SingleActionRule.ts`
- [ ] `lib/agentkit/v6/compiler/resolvers/` (6 files)

**Translation (3 files):**
- [ ] `lib/agentkit/v6/translation/IRToNaturalLanguageTranslator.ts`
- [ ] `lib/agentkit/v6/translation/NaturalLanguageCorrectionHandler.ts`
- [ ] `lib/agentkit/v6/translation/templates/plan-templates.ts`

**Repair (1 file):**
- [ ] `lib/agentkit/v6/repair/IRRepairLoop.ts`

**Orchestrator (1 file):**
- [ ] `lib/agentkit/v6/v6-generator.ts`

**Utils (2 files):**
- [ ] `lib/feature-flags.ts` (add IR flag)
- [ ] `lib/agentkit/v6/utils/validation-helpers.ts`

### Frontend (2 files)

- [ ] `components/agent-creation/WorkflowPlanPreview.tsx`
- [ ] `components/agent-creation/ExecutionProgressUI.tsx`

### API (3 files)

- [ ] `app/api/generate-workflow-plan/route.ts`
- [ ] `app/api/compile-workflow/route.ts`
- [ ] `app/api/update-workflow-plan/route.ts`

### Modified (3 files)

- [ ] `components/agent-creation/AgentBuilderParent.tsx`
- [ ] `app/api/generate-agent-v4/route.ts`
- [ ] `lib/pilot/StepExecutor.ts`

---

## Success Criteria Per Phase

**Phase 1:**
- ✅ IR schema validates 90%+ of enhanced prompts
- ✅ Compiler compiles 85%+ of valid IRs
- ✅ Zero ai_processing steps for deterministic operations

**Phase 2:**
- ✅ Natural language plans understandable (95%+ user comprehension test)
- ✅ Corrections work on first try (90%+ success rate)
- ✅ UI integrated without breaking V4 path

**Phase 3:**
- ✅ Real-time progress updates working
- ✅ Execution metrics accurate (time, cost)

**Phase 4:**
- ✅ 85%+ workflow coverage (up from 60%)
- ✅ AI operations compile correctly

**Phase 5:**
- ✅ V6 outperforms V4 on speed (3-5x faster)
- ✅ V6 outperforms V4 on cost (10-50x cheaper)
- ✅ V6 matches/exceeds V4 on correctness (90%+)

---

Next: [Code Examples](./10-code-examples.md)
