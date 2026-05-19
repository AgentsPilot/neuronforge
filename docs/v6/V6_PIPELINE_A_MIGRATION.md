# V6 Pipeline A Migration — V2 UI to the Regression-Tested Pipeline

> **Last Updated**: 2026-05-20
> **Branch**: `feature/v6-v2-integration`
> **Status**: ✅ Complete (P1–P6) — V2 UI runs unconditionally on Pipeline A; rollout flag retired
> **Parent**: [V6_AGENT_CREATION_INTEGRATION_PLAN.md](./V6_AGENT_CREATION_INTEGRATION_PLAN.md)

## Overview

The V2 UI agent-creation flow currently calls `/api/v6/generate-ir-semantic` (Pipeline B). All 10 V6 regression scenarios + WP-1 through WP-38 fixes were validated against Pipeline A, a different code path that has no HTTP endpoint today. This document plans the migration of the V2 UI from Pipeline B to Pipeline A so the production flow runs through the regression-tested code path.

**User decision (2026-05-17):** expose Pipeline A as a new HTTP endpoint, switch the V2 UI fetch call to it, leave Pipeline B endpoints in place for now (other consumers TBD, audited in Stage P1).

## The two pipelines

| Aspect | Pipeline A (regression-tested) | Pipeline B (V2 UI today) |
|---|---|---|
| Entry function | `generateGenericIntentContractV1` | `SemanticPlanGenerator.generate()` |
| LLM calls | 1 (IntentContract generation) | 2 (semantic plan + IR formalization) |
| Authoring prompt | `lib/agentkit/v6/intent/intent-system-prompt-v2.ts` (TypeScript template, includes WP-28 named-keys + html_body guidance accumulated over time) | `lib/agentkit/v6/semantic-plan/prompts/semantic-plan-system.md` + `formalization-system-v4.md` (Markdown files, fewer accumulated fidelity hints) |
| Phase 2 | `CapabilityBinderV2.bind()` (deterministic) | `GroundingEngine` (deterministic + plugin-schema validation) |
| Phase 3 | `IntentToIRConverter` (deterministic) | `IRFormalizer` (LLM-driven) |
| Phase 4 | `ExecutionGraphCompiler` (shared) | `ExecutionGraphCompiler` (shared) |
| HTTP endpoint | **None** — only `scripts/test-complete-pipeline-with-vocabulary.ts` | `/api/v6/generate-ir-semantic/route.ts` (called by V2 UI) + `/api/v6/formalize-to-ir`, `/api/v6/generate-ir-fast-path`, `/api/v6/generate-semantic-grounded`, `/api/v6/generate-semantic-plan`, `/api/v6/generate-workflow-validated`, `/api/v6/ground-semantic-plan` |
| Known runtime cost | Single LLM call (~30s) | Two LLM calls (~70s) — 2-3× slower |

**Why the gap exists:** Git history (commits `aa2df32` "Changing the V6 pipeline to skip semantic and grounding" and `8a9b720` "V6 new agent generation using semantic, grounding, IR and compilar") shows Pipeline B was added *alongside* Pipeline A as an experimental alternative. The V2 UI shipped against Pipeline B because that was the first HTTP-exposed V6 endpoint when V2 UI integration started. The regression suite stayed on Pipeline A. The two pipelines diverged in prompts and behavior, but both downstream-share `ExecutionGraphCompiler` and the PILOT runtime. WP-39 through WP-43 (fixed in commit `33474bb`) hardened that shared layer; WP-44 is a Pipeline-B-prompt-only gap.

## Goals and non-goals

**In scope:**
- New HTTP endpoint that runs Pipeline A end-to-end (LLM call + binding + IR conversion + compilation) and returns the same response shape the V2 UI already consumes.
- V2 UI fetch call points to the new endpoint (feature-flagged for rollback).
- Live verification on `gantt-urgent-tasks` prompt: HTML body + correct task extraction.
- Lock a new regression scenario `gantt-urgent-tasks-v2ui-pipeline-a/` to capture Pipeline A's V2-UI output.

**Out of scope (for this pivot):**
- Removing any Pipeline B endpoints (kept as code; not used by V2 UI). Audited and possibly retired in a separate cleanup PR.
- Re-running Stage 1.4 / 1.5 (other EP prompts). Deferred until pivot lands.
- Phase 3 prompt-fidelity audit (WP-43 Option A + WP-44 Option A). Tracked separately; the Pipeline A switch may sidestep WP-43/44 entirely (Pipeline A's prompt has the required guidance).

## Open questions — resolved during Stage P1

| # | Question | Status | Answer |
|---|---|---|---|
| Q1 | Exact response shape of `/api/v6/generate-ir-semantic`? | ✅ Resolved | Inline shape (no exported TS type). Top-level fields: `success`, `workflow.{workflow_steps, suggested_plugins}`, `validation.{valid, issues, autoFixed, issueCount}`, `metadata.{architecture, provider, model, total_time_ms, phase_times_ms{}, grounding_confidence, steps_generated, plugins_used[]}`, `pipeline_context.{semantic_plan, grounded_facts, formalization_metadata}`, `ir: DeclarativeLogicalIRv4` (debug), optional `intermediate_results.semantic_plan` (when client passes `return_intermediate_results: true`), optional `validation_details`, optional `grounding_errors`. Source: `app/api/v6/generate-ir-semantic/route.ts:925-996`. |
| Q2 | What does the V2 UI consume? | ✅ Resolved | V2 UI reads: `v6Data.success` (gate), `v6Data.workflow` (passed to `mapV6ResponseToAgent`), `v6Data.metadata.{steps_generated, phase_times_ms, plugins_used}`, `v6Data.intermediate_results?.semantic_plan` (fallback for agent name/description via `semanticPlan.goal`). `mapV6ResponseToAgent` then extracts `workflow.suggested_plugins ‖ metadata.plugins_used`, `workflow.workflow_steps` → both `workflow_steps` and `pilot_steps`, `metadata.grounding_confidence ‖ 0.8`, `metadata.total_time_ms` (display only), `semanticPlan?.goal` (display fallback). Source: `app/v2/agents/new/page.tsx:185-267, 1028-1042`. |
| Q3 | Pipeline A's natural output shapes? | ✅ Resolved | `generateGenericIntentContractV1()` returns `Promise<{intent: IntentContractV1, rawText: string}>`. `CapabilityBinderV2.bind()` returns `BoundIntentContract` (extends `IntentContractV1` with `steps[].plugin_key`, `steps[].action`, `data_schema`). `IntentToIRConverter.convert()` returns `ConversionResult{success, ir?: DeclarativeLogicalIRv4, errors[], warnings[]}`. `ExecutionGraphCompiler.compile()` is shared with Pipeline B, returns `{success, workflow[], plugins_used[], errors[]}`. |
| Q4 | Does `IntentToIRConverter` emit IR v4.0? | ✅ Resolved | YES. Emits `DeclarativeLogicalIRv4` literally with `ir_version: '4.0'` at `IntentToIRConverter.ts:175-179`. Same shape `ExecutionGraphCompiler` consumes. **No upgrade step needed.** |
| Q5 | Does Pipeline A support all transform / step types our scenarios need? | ✅ Resolved (with one nuance) | Pipeline A supports `map`, `filter`, `with_fields`, `project_column`, `set_difference`, `flatten`, `deduplicate`, `reduce`. **Conditionals:** Pipeline A uses `decide` step (`step.decide.then[]` + `step.decide.else[]`) which `convertDecide()` (line 675) translates to IR `choice` nodes with merge points — semantically equivalent to Pipeline B's `conditional` w/ `else_steps[]`. The output IR will look different (decide → choice nodes; if-style explicit elsesteps absent in IC grammar) but the downstream compiled DSL works the same way. *No blocker.* |
| Q6 | Pipeline B endpoint consumers? | ✅ Resolved | Production callers of Pipeline B: only **V2 UI → `/api/v6/generate-ir-semantic`** (`app/v2/agents/new/page.tsx:1005`). Test/dev callers: `public/test-v6-declarative.html` (test page) → `/api/v6/generate-ir-semantic` + `/api/v6/generate-workflow-validated`; `app/test-plugins-v2/page.tsx:1820` → `/api/v6/generate-semantic-grounded`. Doc-only references in `docs/v6/V6_DEVELOPER_GUIDE.md` for `/api/v6/generate-semantic-plan`, `/api/v6/ground-semantic-plan`, `/api/v6/formalize-to-ir`. `/api/v6/generate-ir-fast-path` has zero callers. **Implication:** retiring Pipeline B from production traffic only requires switching the V2 UI; test pages remain on Pipeline B until separately migrated. |
| Q7 | What does Pipeline B's Phase 5 do, and does Pipeline A need it? | ✅ Resolved | `PilotNormalizer.stableResponseEnvelope()` (`PilotNormalizer.ts:500-519`) — cosmetic envelope normalization: ensures `workflow_steps` is array, adds legacy `workflow` alias, preserves intermediate fields, defaults empty validation. **Recommendation:** include the same call in the Pipeline A endpoint for response-contract parity and future-proofing. Source: `generate-ir-semantic/route.ts:890-914`. |
| Q8 | Auth + audit pattern in Pipeline B? | ✅ Resolved (with caveat) | Pipeline B does NOT call `getUser()`, does NOT call `AuditTrailService`, does NOT validate `x-user-id`. Headers (`x-user-id`, `x-session-id`, `x-agent-id`) are passed by the V2 UI but the route trusts them. This is an existing security gap that's out of scope for this pivot. **Recommendation:** mirror Pipeline B's current behaviour in the new endpoint (no auth check, accept headers); flag the gap for a separate security review session. |
| Q9 | New endpoint name? | ✅ Decided | `/api/v6/generate-ir-intent-contract` — descriptive, parallels `/api/v6/generate-ir-semantic`. |
| Q10 | Feature flag name? | ✅ Decided | `NEXT_PUBLIC_USE_V6_PIPELINE_A` — defaults to `false`. Flip to `true` in `.env.local` after Stage P4 verification. |
| Q11 | How does Pipeline A bridge `intermediate_results.semantic_plan` (Pipeline-B-only concept)? | ✅ Resolved | The V2 UI uses `semanticPlan?.goal` as a fallback for `agent_name`/`description` when `enhancedPromptData.plan_title` is missing. Pipeline A's `IntentContractV1` has its own top-level `goal` field with the same role. **Bridge in the new endpoint's response:** populate `intermediate_results.semantic_plan = { goal: intentContract.goal }` (synthetic — only the field the V2 UI actually reads). No client change required. |
| Q12 | How does Pipeline A populate `grounding_confidence`? | ✅ Resolved | Pipeline A has no grounding phase, so no genuine confidence score. V2 UI's fallback (`metadata.grounding_confidence \|\| 0.8`) handles missing values. **Endpoint behaviour:** omit the field (or set to `null`); the V2 UI's `\|\| 0.8` short-circuits. No client change required. |

## Stages

### Stage P1 — Investigation (read-only)

**Goal:** establish the exact contract between V2 UI and `/api/v6/generate-ir-semantic`, map Pipeline A's natural emission, identify gaps that the new endpoint must bridge.

**Tasks:**
1. Read `/api/v6/generate-ir-semantic/route.ts` end-to-end. Document the response shape (`V6GenerateResponse` type) — every field name + semantic.
2. Read `app/v2/agents/new/page.tsx` around line 1005. Document which response fields the V2 UI actually consumes (likely `data.pilot_steps`, `data.workflow_config`, plus metadata for agent naming).
3. Read `mapV6ResponseToAgent` (if it exists). Document the mapping from V6 response → agent DB record fields.
4. Read `scripts/test-complete-pipeline-with-vocabulary.ts` end-to-end. Document each phase's input/output shape — that's Pipeline A's natural emission.
5. Read `lib/agentkit/v6/intent/generate-intent.ts` (`generateGenericIntentContractV1`) — signature, args, return type.
6. Read `lib/agentkit/v6/capability-binding/CapabilityBinderV2.ts` — does it produce a `BoundIntent` shape that flows into `IntentToIRConverter`?
7. Read `lib/agentkit/v6/intent-to-ir/IntentToIRConverter.ts` (or wherever it lives) — does it emit IR v4.0? Same shape that `ExecutionGraphCompiler` consumes today?
8. Grep for other callers of `/api/v6/generate-ir-semantic`, `/api/v6/formalize-to-ir`, etc. — who else uses Pipeline B? Test page? Other UI?
9. Compute the response-shape delta + write findings into this doc.

**Deliverable:** all 8 questions above answered, decisions made on Q7/Q8, plan refined.

**Status:** ✅ Complete (2026-05-17). All 12 questions resolved (8 original + Q9-Q12 added during investigation). Findings recorded in the table above and consolidated into the Response Contract section below.

---

## Response Contract for the New Endpoint (derived from P1 findings)

The new `/api/v6/generate-ir-intent-contract` endpoint must return exactly this shape so the V2 UI's existing consumer code (`mapV6ResponseToAgent`) works unchanged:

```typescript
{
  success: true,
  workflow: {
    workflow_steps: <DSL steps array from ExecutionGraphCompiler.compile()>,
    suggested_plugins: <plugins_used from compilation>
  },
  validation: {
    valid: true,
    issues: [],
    autoFixed: false,
    issueCount: 0
  },
  metadata: {
    architecture: "intent_contract_pipeline_a",  // new value distinguishing Pipeline A
    provider: "openai",                            // or whatever IC LLM call used
    model: "<model name>",
    total_time_ms: <number>,
    phase_times_ms: {
      vocabulary: <number>,
      intent_generation: <number>,
      capability_binding: <number>,
      ir_conversion: <number>,
      compilation: <number>
    },
    grounding_confidence: null,                    // Pipeline A has no grounding; V2 UI falls back to 0.8
    steps_generated: <workflow.length>,
    plugins_used: <plugins_used from compilation>
  },
  pipeline_context: {
    semantic_plan: null,                           // Pipeline A has no semantic plan; populate intermediate_results instead
    grounded_facts: null,
    formalization_metadata: null
  },
  ir: <DeclarativeLogicalIRv4 from IntentToIRConverter — for debugging>,
  intermediate_results: {                          // ONLY if request body has `config.return_intermediate_results: true`
    semantic_plan: {
      goal: <intentContract.goal>                  // SYNTHETIC: derived from IC, gives V2 UI its agent-name fallback
    }
    // Other intermediate_results fields omitted — V2 UI only reads .semantic_plan.goal
  }
}
```

Errors: same envelope as Pipeline B — `{ success: false, error: <user-friendly>, details: <dev-only>, phase: <which-phase> }` with appropriate HTTP status code.

## Request Contract

The V2 UI sends:

```typescript
POST /api/v6/generate-ir-intent-contract
Headers:
  Content-Type: application/json
  x-user-id: <auth user id>
  x-session-id: <session id>
  x-agent-id: <agent id>
Body:
{
  enhanced_prompt: <EnhancedPrompt object>,        // sections{}, specifics.{services_involved, resolved_user_inputs}
  userId: <auth user id>,                          // duplicated in body (matches Pipeline B convention)
  config: {
    return_intermediate_results: true,             // V2 UI sends this — populates intermediate_results.semantic_plan
    provider: "openai"                             // or "anthropic" — Pipeline A respects this for the IC LLM call
  }
}
```

The new endpoint must accept this exact shape (Zod-validate, but tolerate extra fields).

---

### Stage P2 — Build the new endpoint

**Goal:** `/api/v6/generate-ir-intent-contract` accepts the request shape documented above and returns the response shape documented above.

**Concrete skeleton (per CLAUDE.md API pattern + Pipeline B reference pattern):**

```typescript
// app/api/v6/generate-ir-intent-contract/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logger'
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2'
import { PluginVocabularyExtractor } from '@/lib/agentkit/v6/vocabulary/PluginVocabularyExtractor'
import { generateGenericIntentContractV1 } from '@/lib/agentkit/v6/intent/generate-intent'
import { CapabilityBinderV2 } from '@/lib/agentkit/v6/capability-binding/CapabilityBinderV2'
import { IntentToIRConverter } from '@/lib/agentkit/v6/compiler/IntentToIRConverter'
import { ExecutionGraphCompiler } from '@/lib/agentkit/v6/compiler/ExecutionGraphCompiler'
import { PilotNormalizer } from '@/lib/pilot/PilotNormalizer'   // for stableResponseEnvelope

const logger = createLogger({ module: 'V6PipelineA' })

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID()
  const requestLogger = logger.child({ correlationId })
  const startedAt = Date.now()

  // Headers (mirror Pipeline B — no auth enforcement, just pass-through)
  const userId = request.headers.get('x-user-id') || undefined
  const sessionId = request.headers.get('x-session-id') || undefined
  const agentId = request.headers.get('x-agent-id') || undefined

  try {
    const body = await request.json()
    const { enhanced_prompt: enhancedPrompt, config = {} } = body
    if (!enhancedPrompt) {
      return NextResponse.json({ success: false, error: 'enhanced_prompt required' }, { status: 400 })
    }

    // === Phase 0: Vocabulary (deterministic, cheap) ===
    // CONFIRMED via grep: `new PluginVocabularyExtractor(pluginManager).extract(userId, {servicesInvolved})`
    const phase0Start = Date.now()
    const pluginManager = await PluginManagerV2.getInstance()
    const vocabularyExtractor = new PluginVocabularyExtractor(pluginManager)
    const vocabulary = await vocabularyExtractor.extract(
      userId || '',
      { servicesInvolved: enhancedPrompt.specifics?.services_involved || [] }
    )
    if (enhancedPrompt.specifics?.resolved_user_inputs?.length) {
      vocabulary.userContext = enhancedPrompt.specifics.resolved_user_inputs
    }
    const phase0Time = Date.now() - phase0Start

    // === Phase 1: IntentContract generation (1 LLM call) ===
    const phase1Start = Date.now()
    const icResult = await generateGenericIntentContractV1({ enhancedPrompt, vocabulary })
    const intentContract = icResult.intent
    const phase1Time = Date.now() - phase1Start
    requestLogger.info({ phase1Time, goal: intentContract.goal, steps: intentContract.steps.length },
      'Phase 1 complete — IntentContract generated')

    // === Phase 2: Capability binding (deterministic) ===
    const phase2Start = Date.now()
    const binder = new CapabilityBinderV2(pluginManager)
    const boundIntent = await binder.bind(intentContract, userId || '')
    const phase2Time = Date.now() - phase2Start

    // === Phase 3: IR conversion (deterministic) ===
    const phase3Start = Date.now()
    const converter = new IntentToIRConverter(pluginManager)
    const conversionResult = await converter.convert(boundIntent)
    if (!conversionResult.success || !conversionResult.ir) {
      return NextResponse.json({
        success: false,
        error: 'IR conversion failed',
        details: conversionResult.errors,
        phase: 'ir_conversion'
      }, { status: 500 })
    }
    const phase3Time = Date.now() - phase3Start

    // === Phase 4: Compilation (shared with Pipeline B) ===
    const phase4Start = Date.now()
    const compiler = new ExecutionGraphCompiler(pluginManager)
    const compilationResult = await compiler.compile(conversionResult.ir)
    if (!compilationResult.success) {
      return NextResponse.json({
        success: false,
        error: 'Compilation failed',
        details: compilationResult.errors,
        phase: 'compilation'
      }, { status: 500 })
    }
    const phase4Time = Date.now() - phase4Start

    // === Phase 5: Response envelope normalization (cosmetic, same as Pipeline B) ===
    const totalTime = Date.now() - startedAt
    const responseBody: any = {
      success: true,
      workflow: {
        workflow_steps: compilationResult.workflow,
        suggested_plugins: compilationResult.plugins_used || []
      },
      validation: { valid: true, issues: [], autoFixed: false, issueCount: 0 },
      metadata: {
        architecture: 'intent_contract_pipeline_a',
        provider: config.provider || 'openai',
        model: '<resolved model>',                              // from generateGenericIntentContractV1 if exposed
        total_time_ms: totalTime,
        phase_times_ms: {
          vocabulary: phase0Time,
          intent_generation: phase1Time,
          capability_binding: phase2Time,
          ir_conversion: phase3Time,
          compilation: phase4Time
        },
        grounding_confidence: null,
        steps_generated: compilationResult.workflow.length,
        plugins_used: compilationResult.plugins_used || []
      },
      pipeline_context: { semantic_plan: null, grounded_facts: null, formalization_metadata: null },
      ir: conversionResult.ir
    }
    if (config.return_intermediate_results) {
      responseBody.intermediate_results = {
        semantic_plan: { goal: intentContract.goal }            // V2 UI's agent-name fallback bridge
      }
    }

    requestLogger.info({ totalTime, stepsGenerated: compilationResult.workflow.length },
      'Pipeline A completed successfully')
    return NextResponse.json(responseBody)

  } catch (error: any) {
    requestLogger.error({ err: error }, 'Pipeline A endpoint error')
    return NextResponse.json({
      success: false,
      error: error?.message || 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error?.stack : undefined
    }, { status: 500 })
  }
}
```

**Tasks:**
1. Create the route file with the skeleton above.
2. ✅ Import paths verified: `PluginVocabularyExtractor` at `lib/agentkit/v6/vocabulary/PluginVocabularyExtractor.ts` (instantiated with `new`, not static).
3. ✅ `CapabilityBinderV2` constructor: `constructor(private pluginManager: PluginManagerV2)` (positional).
4. ✅ `IntentToIRConverter` constructor: `constructor(pluginManager?: PluginManagerV2)` (positional, optional).
5. ✅ `ExecutionGraphCompiler.compile()` is shared with Pipeline B — same return shape.
6. Add Zod validation for the request body (`enhanced_prompt` required, `config` optional). Defer if the existing Pipeline B doesn't validate (it doesn't) — mirror its laxity for parity; tighten in a follow-up if needed.
7. Add the standard correlation-ID logging at each phase boundary.
8. Mirror Pipeline B's error envelope shape so the V2 UI error path works.

**Pre-implementation verification still pending:**
- Confirm `PluginVocabularyExtractor.extract()` accepts an empty `userId` string (since Pipeline B doesn't auth, we don't always have one). If it rejects empty, may need to use a sentinel like `'anonymous'`.
- Confirm what `IntentToIRConverter.convert()` returns when binding fails partially — does it propagate `errors` to its `ConversionResult`?

**Status:** 📝 Drafted in this doc; not yet written to `app/api/v6/generate-ir-intent-contract/route.ts`.

---

### Stage P3 — Switch the V2 UI

**Goal:** V2 UI fetches from the new endpoint, gated by a feature flag.

**Tasks:**
1. Add feature flag: `NEXT_PUBLIC_USE_V6_PIPELINE_A` (default `false`).
2. In `app/v2/agents/new/page.tsx`, change the fetch URL based on the flag: `flag ? '/api/v6/generate-ir-intent-contract' : '/api/v6/generate-ir-semantic'`.
3. Document the flag in `docs/feature_flags.md`.
4. Add a Progress Log entry to INTEGRATION_PLAN.

**Status:** ⬜ Not started.

---

### Stage P4 — Live verification

**Goal:** drive the same gantt-urgent-tasks EP through V2 UI → new endpoint → DB → Phase E, confirm:
- HTML email body delivered (proves WP-44 was Pipeline-B-only; Pipeline A's prompt preserves `html_body`)
- AI step extracts tasks correctly (proves WP-43's runtime preamble is defensive but Pipeline A wouldn't need it because the IC prompt teaches the LLM to use named keys)
- All 7-9 DSL steps run cleanly
- Real email arrives with correct HTML content

**Tasks:**
1. Flip the feature flag in `.env.local`.
2. Restart dev server.
3. Run the gantt-urgent-tasks prompt through V2 UI.
4. Capture the new agent ID + dev.log range.
5. Run Phase E live: `npx tsx --import ./scripts/env-preload.ts scripts/test-live-agent-execution.ts --agent-id <UUID> --use-db-dsl`.
6. Inspect the delivered email + step5 output + step9 params.

**Tasks if any failures:**
- Same triage approach as Stage 1.2 — diagnose, document as WP-N, decide commit-now vs fix-first.

**Status:** ⬜ Not started.

---

### Stage P5 — Lock as regression scenario

**Goal:** capture Pipeline A's V2-UI output as a permanent regression seed.

**Tasks:**
1. Create `tests/v6-regression/scenarios/gantt-urgent-tasks-v2ui-pipeline-a/`.
2. Save enhanced-prompt.json (same as Pipeline B scenario, lock for diff comparison).
3. Save intent-contract.json (Pipeline A's LLM output — NEW snapshot file specific to this pipeline).
4. Save phase4-pilot-dsl-steps.json + phase4-workflow-config.json (Pipeline A's compiler output).
5. Save scenario.json metadata with `phase_e_success: true` + execution ID + timestamp.
6. Cross-reference both scenarios so future readers see the Pipeline A vs B comparison.

**Status:** ⬜ Not started.

---

### Stage P6 — Retire the rollout flag (post-success cleanup)

**Goal:** once Pipeline A is verified end-to-end and trusted, remove the temporary `NEXT_PUBLIC_USE_V6_PIPELINE_A` flag so V6 = Pipeline A unconditionally. `NEXT_PUBLIC_USE_V6_AGENT_GENERATION` continues to gate V4 vs V6 (its original purpose); the V2 UI no longer needs a per-pipeline toggle once Pipeline B is no longer reachable from production.

**Prerequisites:**
- ✅ Stages P2–P5 complete and verified live
- ✅ At least one full regression cycle has run with Pipeline A as the default (e.g., the gantt scenario plus at least Stage 1.4 / 1.5 prompts)
- ✅ No Pipeline-A-specific regression has surfaced for some agreed-on cooling-off window (e.g., 1–2 weeks of normal usage)

**Tasks:**
1. **Code path collapse** — In `app/v2/agents/new/page.tsx`, remove the `useV6PipelineA()` check and the Pipeline B branch. The V6 fetch unconditionally targets `/api/v6/generate-ir-intent-contract`. The `useV6AgentGeneration()` flag keeps its original V4 vs V6 role.
2. **Remove the helper** — Delete `useV6PipelineA()` from `lib/utils/featureFlags.ts` and its import in the V2 UI page.
3. **Remove the flag** — Strip `NEXT_PUBLIC_USE_V6_PIPELINE_A` from `.env.local` (user action) and from `docs/feature_flags.md` (table + Section 2). Renumber the remaining `### N.` sections back to the original numbering.
4. **Decide Pipeline B endpoint fate** — At this point Pipeline B's `/api/v6/generate-ir-semantic` (+ siblings) has no production callers. Audit any remaining test-page / docs references and either: (a) migrate them to Pipeline A too, or (b) delete the Pipeline B endpoints entirely (smaller surface area, less drift between the two pipelines' prompts). The latter is preferred unless a specific test surface still needs them.
5. **Sunset the Pipeline B `IRFormalizer` + `SemanticPlanGenerator` if no callers remain** — same audit/delete pass for the supporting library code if all consumers have moved. Otherwise leave in place and note the deprecation in code comments.
6. **Documentation pass** — Update `V6_PIPELINE_A_MIGRATION.md`'s Status Summary to mark P6 done; archive or merge this doc into `V6_AGENT_CREATION_INTEGRATION_PLAN.md` as a "history of how V2 UI ended up on Pipeline A" entry. Update `V6_OPEN_ITEMS.md` and `V6_DOCS_INDEX.md` accordingly.
7. **Clean up Pipeline-B-only WPs** — WP-40 (IRFormalizer blind-guess) and WP-44 (formalization HTML drop) only mattered for Pipeline B. After P6 they become historical. Either mark them "✅ Resolved by P6 (Pipeline B retired)" or fold them into a "retired pipeline" footnote in WEAK_POINTS.

**Risks of premature P6 execution:**
- Pipeline A discovers a previously unseen gap that Pipeline B handled gracefully → no rollback path without the flag.
- Other consumers we missed in the Stage P1 audit (e.g., a hidden test surface) lose their endpoint.

*Mitigation:* don't run P6 until P4/P5 have been observed under real usage for the agreed window. Treat P6 as a separate session.

**Status:** ⬜ Not started — blocked on P4 + P5 + cooling-off window.

## Risks

Tracked and updated as investigation completes.

1. **Pipeline A's LLM step is stochastic — same fidelity risks as Pipeline B's, just different prompts.** WP-39 (compiler `select` alias) + WP-41 (`select` runtime semantics) apply if Pipeline A's LLM happens to emit `transform.type: "select"`. WP-43 runtime preamble applies if it emits column-letter wording in `ai_processing.instruction`. The runtime hardening from commit `33474bb` is the safety net. *Mitigation:* runtime hardening is already in place; verify in Stage P4.
2. **IntentToIRConverter may not emit IR v4.0 directly.** The regression suite's phase3 file is named `phase3-execution-graph-ir-v4.json` — strongly suggesting IR v4.0. But if `IntentToIRConverter` emits an older shape and a separate upgrade step exists, the new endpoint needs to call that too. *Mitigation:* answered in Stage P1 task #7.
3. **Pipeline A's grammar may lack something modern.** W2 expressions, `with_fields`, `set_difference`, etc. were added through WP-16/WP-22/WP-32. If they live in `IntentToIRConverter` they're fine. If they only live in `IRFormalizer`, Pipeline A may not support them and scenarios using those features would break. *Mitigation:* Stage P1 task #4 audits this.
4. **CapabilityBinderV2 + IntentToIRConverter haven't been exercised against fresh LLM output recently.** The regression suite uses committed `intent-contract.json` snapshots. Fresh LLM output may expose dormant bugs in these layers (binding edge cases, IR conversion gaps, etc.). *Mitigation:* expected during Stage P4; triage same as any new WP discovery.
5. **Speed regression risk.** Pipeline A is one LLM call vs Pipeline B's two — Pipeline A is *expected* to be faster (~30s vs ~70s). But if Pipeline A's prompt is bigger / model is heavier, the delta could shrink. *Mitigation:* measure in Stage P4.
6. **Auth / correlation ID / audit trail patterns.** The new endpoint must implement the standard API patterns (per CLAUDE.md §API Route Pattern). Copy-paste from `/api/v6/generate-ir-semantic` should suffice but worth a checklist. *Mitigation:* explicit task in Stage P2.

## Decision log

Decisions made during planning/investigation are recorded here so future readers see the why.

| Date | Decision | Reason |
|------|----------|--------|
| 2026-05-17 | Pivot V2 UI to Pipeline A | Pipeline B's prompts are missing fidelity guidance (WP-28 named-keys, html_body preservation) that Pipeline A's prompts have accumulated. All regression validation is on Pipeline A. Aligning V2 UI with the regression-tested path eliminates a class of "works in tests, fails in production" gaps. |
| 2026-05-17 | Keep Pipeline B endpoints in code (not used by V2 UI) | Lower-risk pivot. Audit other consumers in Stage P1 before deciding whether to remove. |
| 2026-05-17 | Feature-flag the V2 UI switch | Standard rollout safety; lets the user revert to Pipeline B without code revert if Pipeline A regresses on something we haven't tested. |

## Status Summary

| Stage | Status | Notes |
|---|---|---|
| P1 — Investigation | ✅ Complete (2026-05-17) | 12 questions resolved; response/request contracts documented |
| P2 — Build endpoint | ✅ Complete (2026-05-17) | `/api/v6/generate-ir-intent-contract/route.ts` written; typecheck clean |
| P3 — Switch V2 UI | ✅ Complete (2026-05-17) | `useV6PipelineA()` flag added; V2 UI fetch URL switched based on flag; documented in `feature_flags.md` |
| P4 — Live verify | ✅ Complete (2026-05-17) | Pipeline A end-to-end on `gantt-urgent-tasks-v2ui-pipeline-a`: 12/12 steps, 3 real tasks, HTML email delivered. Surfaced + fixed WP-45 (`ConditionalEvaluator` date+ref) and WP-46 (`with_fields` constants-only singleton). 2,602 tokens vs Pipeline B's 5,375 (52% reduction). |
| P5 — Lock scenario | ✅ Complete (2026-05-17) | `tests/v6-regression/scenarios/gantt-urgent-tasks-v2ui-pipeline-a/` created with 4 files: enhanced-prompt.json, phase4-pilot-dsl-steps.json (11 steps), phase4-workflow-config.json (10 keys), scenario.json (with side-by-side Pipeline A vs B comparison metadata + 3 known_weaknesses entries for WP-45/46 + test-script-id-bug) |
| P6 — Retire rollout flag | ✅ Complete (2026-05-20, conservative scope) | V2 UI fetch collapsed to Pipeline A unconditionally; `useV6PipelineA()` helper + `NEXT_PUBLIC_USE_V6_PIPELINE_A` flag removed from `lib/utils/featureFlags.ts` and `docs/FEATURE_FLAGS.md` (section 2 removed, sections 3-6 renumbered to 2-5). Pipeline B endpoints (`/api/v6/generate-ir-semantic` et al.) + library code (`SemanticPlanGenerator`, `IRFormalizer`, `GroundingEngine`) intentionally kept — still used by `app/test-plugins-v2/page.tsx` and `public/test-v6-declarative.html` as diagnostic surfaces. **Deferred to a future cleanup pass:** full Pipeline B endpoint deletion (only valuable once the test pages migrate or are themselves retired). |

## Plan Readiness Checklist (before implementation)

- ✅ Pipeline A vs B mapped with concrete file references
- ✅ Response contract specified field-by-field (what V2 UI reads vs what Pipeline A naturally emits)
- ✅ Request contract specified
- ✅ All 12 open questions resolved
- ✅ Import paths + constructor signatures verified by grep
- ✅ Pipeline B endpoint consumers audited (only V2 UI in prod; test pages remain on B)
- ✅ Risks enumerated with mitigations
- ✅ Decision log captured
- ⬜ User approval to begin P2 implementation

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-05-17 | Initial draft | Planning document created after the pivot decision in commit `33474bb`. 8 open questions queued for Stage P1 investigation. |
| 2026-05-17 | P1 investigation complete | All 8 original questions answered; 4 additional questions surfaced + resolved (Q9-Q12: endpoint name, feature flag name, semantic_plan bridging, grounding_confidence handling). Response/request contracts documented. P2 skeleton drafted with verified import paths + class signatures. Plan ready for user approval. |
| 2026-05-17 | P2 + P3 implementation landed | Created `app/api/v6/generate-ir-intent-contract/route.ts` (5-phase Pipeline A endpoint). Added `useV6PipelineA()` helper in `lib/utils/featureFlags.ts` (defaults to false). Switched V2 UI fetch URL in `app/v2/agents/new/page.tsx` based on the new flag. Documented the flag in `docs/feature_flags.md`. Typecheck clean on all changes. |
| 2026-05-17 | P6 stage added per user direction | Added Stage P6 (retire rollout flag) to the plan. After Pipeline A is verified end-to-end and trusted, collapse the dual-pipeline branch so V6 = Pipeline A unconditionally; remove `NEXT_PUBLIC_USE_V6_PIPELINE_A` from code + env + docs. `NEXT_PUBLIC_USE_V6_AGENT_GENERATION` keeps its original V4-vs-V6 gating role. Optionally retire Pipeline B endpoints entirely. |
| 2026-05-17 | P4 verified end-to-end on Pipeline A | Drove the same gantt-urgent-tasks prompt through V2 UI → Pipeline A endpoint → DB → Phase E. 12/12 steps, 3 correct tasks extracted, real HTML email delivered with proper styling + `content.html_body` parameter. Pipeline A confirmed structurally better than Pipeline B: 11 deterministic steps (vs B's 6 with AI-heavy filter), 2,602 tokens (vs B's 5,375 — 52% reduction), WP-44 format-fidelity issue does NOT apply (Pipeline A's prompt preserves HTML). Surfaced + fixed 2 new shared-runtime bugs along the way: WP-45 (`ConditionalEvaluator` bare-ref + date-aware comparisons) and WP-46 (`with_fields` constants-only singleton). Both fixes are in shared runtime code that benefits Pipeline B too (defensive). Also fixed a pre-existing test script bug: `test-live-agent-execution.ts` E6 inserted into `agent_configurations` without an `id`, silently wiping the table on every `--use-db-dsl` run. |
| 2026-05-17 | P5 scenario locked | Captured `tests/v6-regression/scenarios/gantt-urgent-tasks-v2ui-pipeline-a/` from the live Pipeline A agent (4c74a248). 4 files: enhanced-prompt.json, phase4-pilot-dsl-steps.json (11 steps), phase4-workflow-config.json (10 config keys), scenario.json (with a side-by-side `comparison_with_pipeline_b` block — 52% token reduction, 11 vs 6 steps, HTML vs plain-text, deterministic vs AI-heavy filtering — and 3 known_weaknesses entries pointing at WP-45 / WP-46 / the test-script id bug). Pipeline A migration ready to commit. |
| 2026-05-19 | P5 — two additional regression scenarios locked | `leads-qualified-stage4-v2ui-pipeline-a/` (5 steps, two AI calls for notes summarisation + email body, multi-recipient send) and `contracts-expiring-v2ui-pipeline-a/` (9 steps with sort + reduce + per-item with_fields). Both phase_e_success: true. Bench coverage is now 3 V2-UI + Pipeline A scenarios across different transform-chain shapes. |
| 2026-05-20 | P6 — rollout flag retired (conservative scope) | User chose to skip the cooling-off window after 3 successful end-to-end runs. Changes: (1) `app/v2/agents/new/page.tsx` — fetch URL unconditionally points to `/api/v6/generate-ir-intent-contract`; the `useV6PipelineA()` import + ternary + Pipeline-B-mention comment block all removed. JSDoc comments on the V6 response type / `mapV6ResponseToAgent` updated to reference the new endpoint name. (2) `lib/utils/featureFlags.ts` — `useV6PipelineA()` helper deleted; replaced with a comment pointing at this doc § P6 for the retirement context. (3) `docs/FEATURE_FLAGS.md` — table row and Section 2 ("V6 Pipeline A (IntentContract)") removed; Sections 3-6 renumbered to 2-5. (4) User action: `NEXT_PUBLIC_USE_V6_PIPELINE_A` should be removed from `.env.local` (no-op now — the code doesn't read it — but cleans up the env file). **Intentionally kept:** Pipeline B endpoints (`/api/v6/generate-ir-semantic` et al.) and library code (`SemanticPlanGenerator`, `IRFormalizer`, `GroundingEngine`, `formalization-system-v4.md`) still serve the diagnostic test pages (`app/test-plugins-v2/page.tsx`, `public/test-v6-declarative.html`). Full Pipeline B deletion deferred — would require migrating or retiring those test pages first. |
