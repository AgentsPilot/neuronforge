# Workplan: V2 Agent Creation — Phase 2 Single-Question Mode for Non-Technical Users

**Developer:** Dev
**Requirement:** [V2_AGENT_CREATION_PHASE2_SINGLE_QUESTION_REQUIREMENT.md](/docs/requirements/V2_AGENT_CREATION_PHASE2_SINGLE_QUESTION_REQUIREMENT.md)
**Date:** 2026-05-27
**Branch:** `feature/v2-agent-creation-r2r3-toned-single-question` (created from baseline `a5a7971`)
**Status:** 🔁 Recovery in progress (2026-05-28). Backend (Steps 3,5,6,7,8) DONE and verified. UI work was mis-targeted and reverted — Step 9 re-scoped to the real page `app/v2/agents/new/page.tsx`. See Recovery Status below.

---

## ⚠️ Recovery Status (2026-05-28) — entry-point gap

**What went wrong:** The first implementation wired the single-question UI into `components/agent-creation/conversational/hooks/useConversationalFlow.ts` (`ConversationalAgentBuilderV2`, reached via `/agents/new/chat` → `AgentBuilderParent`). The Step 1 audit named that component from a prior investigation instead of confirming the URL users actually open.

**The real entry point** is **`/v2/agents/new`**, served by **`app/v2/agents/new/page.tsx`** — a separate implementation using the batch `questionsSequence` model. Live testing showed Phase 2 jumping straight to the plugin gate: that page reads `data.questionsSequence` (empty in the new response) and auto-advances to Phase 3 via `setTimeout(() => processPhase3(tid), 1500)` ([page.tsx:683-692](app/v2/agents/new/page.tsx#L683)).

**Recovery decision (user-approved):** targeted fix-forward.

| Area | Status |
|---|---|
| Backend: v16 prompt, `init-thread`, `process-message` Phase 2 branch, `phase2-schema.ts`, `phase2-done-detector.ts`, `phase2-loop-controller.ts` + tests, `agent-prompt-threads.ts` types | ✅ **KEPT** — proven correct by dev.log (server returns `{question, phase2_done, inline_hint}`); 62/62 unit tests pass; tsc clean |
| Mis-targeted UI: `useConversationalFlow.ts`, `useThreadManagement.ts`, `AIMessage.tsx`, `conversational/types.ts`, `Phase2DisclosureBanner.tsx`, `AgentBuilderParent.tsx`, `featureFlags.ts`, `docs/FEATURE_FLAGS.md`, `CLAUDE.md` | ↩️ **REVERTED** to baseline |
| Step 9 (UI) | 🔁 **RE-SCOPED** to `app/v2/agents/new/page.tsx` (see below) |
| Step 4 (flag removal) | ❌ **DROPPED** — `/v2/agents/new` never used `useNewAgentCreationUI`; no flag work needed |
| Step 1 (audit) | 🔁 **HARDENED** — must verify entry point by the real URL |

---

## ⚠️ Structured-question contract correction (2026-05-28, second live test)

After the UI was retargeted to `app/v2/agents/new/page.tsx`, live testing surfaced a second defect: Phase 2 rendered plain-text "pick a number (1/2/3)" questions instead of v15's `select`/`multi_select` option buttons. **Root cause:** the single-question contract collapsed `question` to a plain `string`, and v16's Insert B explicitly forbade `type`/`options` — contradicting v15's still-present question-type rules.

**Fix (user-approved), across three layers — supersedes the earlier "plain string" contract:**

| Layer | Correction |
|---|---|
| **v16 prompt Insert B** | `question` is ONE **structured** question object per turn (v15's `ClarificationQuestion` shape): `{ id, question, type, options?, allowCustom?, theme? }`. `type` restricted to `select` \| `multi_select` \| `text` (nothing else). Remove the "no `type`, no `options`" line; reconcile with v15's preserved rules (lines 227-296). |
| **`lib/validation/phase2-schema.ts`** | `question` becomes the structured object schema (nullable), `type` = `z.enum(['select','multi_select','text'])`, optional `options[]` (`{value,label,description}`), `allowCustom`, `theme`. Keep the `phase2_done=true ⇒ question=null` refine + `.strict()`. Update the schema unit tests. |
| **`app/v2/agents/new/page.tsx`** | Render the single structured question through the **existing** `questionsSequence`/`currentQuestionIndex` option-button UI (push the one incoming question into `questionsSequence`, let the existing render + option-button JSX fire) instead of `addAIQuestion(plainText)`. On answer, resolve the selection/text and send as `phase2_user_answer`, then fetch next. The batch auto-advance `useEffect` stays inert (it requires `workflowPhase==='enhancement'` + `currentQuestionIndex===-1`, which the loop never sets mid-flight). |

The backend route, done-detector, loop-controller, and cap are **unchanged** — they're agnostic to the question's shape.

**Follow-on fix (2026-05-28, third live test) — recognize answered inputs; mini-cycle restored as a safety net; Phase 3 crash hardened.** Live testing showed duplicate questions and a Phase 3 schema-validation crash. The duplicate was the tell: the user PROVIDED the AliExpress sender email during the loop, yet Phase 3 returned `user_inputs_required: ["AliExpress sender email address to filter on"]` (resolved_user_inputs had the recipient + time window but not the sender email) — so the mini-cycle re-asked it, and the Phase 2 churn left the LLM in Phase 2 mode → a later `phase: 3` call returned a Phase 2 payload → crash. **Real root cause:** Phase 2 answers were keyed `phase2_turn_N` as plain strings, with no link to the input they resolve, so Phase 3 (which resolves via `clarification_answers[qId]`) couldn't recognise them as answered. **Three-part fix (no Phase 3 prompt changes):** (1) `submitPhase2Answer` keys answers by the question's `id`, restoring the exact v15 `clarification_answers[qId]` contract that v15's intact Phase 3 resolution already handles; (2) the Phase 3 → mini-cycle re-trigger is **restored** as a safety net (`!isInMiniCycle` guard → fires at most once, only for genuinely-missing inputs, soft non-technical message); (3) the route retries the Phase 3 completion once on a wrong-shaped response instead of 500-ing. **Verified by diff that v16's Phase 3 section is byte-identical to v15** — no core Phase 3 element changed. Two interim Phase 3 *prompt* additions (response-shape + resolve-from-conversation reminders) were reverted, since they only compensated for the keying regression. The initial "delete the mini-cycle" reaction was also reverted once the real cause (answer-keying) was found.

---

## Goal

Ship one cohesive Phase 2 behavior: **single question per turn, LLM aware of non-technical audience, otherwise question-selection logic unchanged from v15**. One new prompt, one code path, V2 UI only, no feature flags.

## What "done" looks like

A user types a vague prompt in the V2 agent creation UI. Phase 2 asks one question. User answers. Phase 2 asks the next. After 1–N turns, the LLM emits `phase2_done: true` with `question: null`, the UI advances to Phase 3. The user never sees jargon, never sees a question count, never sees the cap. Dev has personally walked through this in a browser before SA review begins.

## What this is NOT

- NOT a change to Phase 2 question-selection logic (priority, allowlists, enumeration rules, etc.) — all that stays as v15.
- NOT introducing any new feature flag.
- NOT touching the legacy V1 conversational builder.
- NOT handling "skip" / "dismiss" / off-topic / gibberish replies server-side — those are forwarded to the LLM and handled in the conversation naturally.

---

## Files Touched

| File | Action | Why |
|---|---|---|
| `app/api/prompt-templates/Workflow-Agent-Creation-Prompt-v16-chatgpt.txt` | **create** | Byte-for-byte copy of v15 + 2 inserts: audience banner at top + interaction-process block in Phase 2 section. Nothing else changes. |
| `app/api/agent-creation/init-thread/route.ts` | modify | Flip the hardcoded prompt-template name from `v15-chatgpt` to `v16-chatgpt` (single line, no flag) |
| `app/api/agent-creation/process-message/route.ts` | modify | Phase 2 branch reworked: short-circuit on "done"-keyword match (no LLM call), otherwise snapshot raw JSON BEFORE existing mutation, Zod-validate snapshot, advance controller, emit Pino termination log |
| `lib/validation/phase2-schema.ts` | **create** | Zod schema for `{ question, phase2_done }` contract with `.strict()` + `.refine()` — parallels existing `phase3-schema.ts` naming. No version number in any symbol. |
| `lib/validation/__tests__/phase2-schema.test.ts` | **create** | Unit tests for schema (valid shapes + `phase2_done=true` requires `question=null` + extra-key rejection) |
| `lib/agent-creation/phase2-done-detector.ts` | **create** | ~15-line helper: `DONE_KEYWORDS` array + `isDoneIntent(text: string): boolean` keyword check. Nothing more. |
| `lib/agent-creation/__tests__/phase2-done-detector.test.ts` | **create** | Unit tests covering each keyword (positive cases) + a handful of negatives (substantive answers must not match) |
| `lib/agent-creation/phase2-loop-controller.ts` | **create** | Pure state machine. 2 termination reasons: `phase2_done`, `cap_hit`. |
| `lib/agent-creation/__tests__/phase2-loop-controller.test.ts` | **create** | Unit tests for cap boundary + both termination reasons |
| **`app/v2/agents/new/page.tsx`** | modify | **THE UI surface (re-scoped).** Rework `processPhase2()` + the question-render `useEffect` + the answer handler + the auto-advance `useEffect`: detect `{ question, phase2_done }`, render ONE question, wait for the answer, send it back via a fresh `phase: 2` fetch with `phase2_user_answer`, render the next question, advance to `processPhase3` ONLY on `phase2_done: true`. Render the `cap_hit` disclosure banner before advancing. Remove the batch `data.questionsSequence`-empty auto-advance for the initial (non-mini-cycle) flow. |
| V2 chat input (within the `/v2/agents/new` tree) | verify | Confirm send button is `disabled` on empty/whitespace input. Path identified in Step 1 audit. No change expected if already guarded. |
| `components/agent-creation/types/agent-prompt-threads.ts` | modify (DONE) | Additive optional response fields (`question`, `phase2_done`, `inline_hint`, `disclosure_banner`, `termination_reason`) + `phase2_user_answer` request field. Already applied; kept. |
| `docs/requirements/archive/` | **move** (DONE) | Prior Phase 2 prompt-related requirement MDs moved here. |
| `tests/v6-regression/scenarios/phase2-single-question-v2ui-pipeline-a/` | **create** | One phase-2-only scenario covering happy path + explicit "build it" variants |
| `components/agent-creation/conversational/ConversationalAgentBuilderV2.tsx` + `hooks/useConversationalFlow.ts`, `components/agent-creation/ConversationalAgentBuilder.tsx` + `useConversationalBuilder.ts`, `components/agent-creation/AgentBuilderParent.tsx` | **`@deprecated` comment only** (Step 9b) | Logic reverted to baseline. Add a top-of-file `@deprecated` JSDoc pointing to `app/v2/agents/new/page.tsx` so no one wires agent-creation changes into the wrong (non-primary) surface again. No logic change. |
| `lib/utils/featureFlags.ts`, `docs/FEATURE_FLAGS.md`, `CLAUDE.md` | **NOT touched** | Reverted to baseline. No flag added or removed. |

### V6 / Plugin work? No.

This workplan does NOT touch `lib/agentkit/v6/`, `lib/pilot/`, `lib/plugins/`, `lib/server/`. No V6 docs need updating.

---

## Risk register

| Risk | Mitigation |
|---|---|
| **Wrong UI surface gets wired (this already happened once)** | Step 1 (live audit) MUST confirm the entry point by opening the real URL `/v2/agents/new`, tracing routing to `app/v2/agents/new/page.tsx`, and naming the exact Phase 2 functions — NOT from memory. Step 10 (live smoke matrix at `/v2/agents/new`) is the verification. The first attempt skipped the URL check and wired the wrong file. |
| **Route mutates `parsedJson` before Zod validation** | Step 7 is the route fix and explicitly snapshots `parsedJson` before any mutation. |
| **v16 accidentally drifts from v15's question-selection logic** | Step 3 is `cp v15 v16` followed by 2 named inserts ONLY. Sanity-grep verifies v15's question-logic sections appear verbatim in v16. |
| **LLM ignores the one-question-per-turn contract** | Zod `.strict()` rejects the violation. Defensive Pino warn. No retry — the next turn will likely produce a valid shape. If the LLM never recovers, the cap eventually fires. |
| **"Done" keyword false-positive on a substantive answer** | Keyword list is intentionally conservative ("build it", "that's enough", etc. — phrases users wouldn't naturally include in an answer). Negative-case tests cover common substantive answers. False positive = early termination; user can re-do Phase 3 if needed. False negative = user types "done" but is treated as an answer; minor UX inconvenience. |
| **Loop never terminates** | Two terminators: `phase2_done` (LLM-emitted or done-keyword match) and `cap_hit`. Both reachable in unit tests. |
| **Empty input reaches the server** | UI guard: send button `disabled` when input is empty/whitespace. Step 9 explicitly verifies this on the actual chat component (path identified at Step 1). |
| **Smoke matrix skipped under deadline pressure** | The workplan structurally cannot be marked Code Complete without Step 10's evidence pasted in. SA review checks for the evidence block. |
| **`useNewAgentCreationUI()` referenced from somewhere we missed** | Step 4 includes a grep across the codebase. Only `AgentBuilderParent.tsx` should reference it in production code. |

---

## Order of operations

### Step 1 — Live-environment audit (before any code) ⚠️ **first**
- [x] Confirm current branch: `git branch --show-current` → `feature/v2-agent-creation-r2r3-toned-single-question` ✅
- [x] Confirm HEAD: `git log --oneline -1` → `2621c51` (kickoff commit, ahead of baseline `a5a7971`) ✅
- [x] Confirm only the v15 prompt is present: `ls app/api/prompt-templates/Workflow-Agent-Creation-Prompt-*.txt` shows v10..v15 (latest is v15, no v16 yet) ✅
- [x] Read `.env.local` → `NEXT_PUBLIC_USE_NEW_AGENT_CREATION_UI` is present on line 72 but **COMMENTED OUT** (`#NEXT_PUBLIC_USE_NEW_AGENT_CREATION_UI=true`). No `NEXT_PUBLIC_USE_PHASE2_SINGLE_QUESTION_MODE` line. Effectively no flag in effect. The commented line will be cleaned up by user when flag is deleted in Step 4 (Dev does NOT edit `.env.local`).
- [x] `AgentBuilderParent.tsx`: import at line 8 (`import { useNewAgentCreationUI } from '@/lib/utils/featureFlags';`), call at line 507 (`const useNewUI = useNewAgentCreationUI();`), ternary at lines 509-526 (V2 vs V1 branch).
- [x] V2 chat input is `components/agent-creation/conversational/components/ChatInput.tsx`:
  - Line 11: `if (!value.trim() || disabled) return;` (form-level guard)
  - Line 54: `disabled={!value.trim() || disabled}` (button-level guard)
  - Empty-input guard already present — no code change required (SA Comment 6 confirmed).

**Step 1 — audit results (SUPERSEDED — audited the wrong entry point):** This audit traced `/agents/new/chat` → `AgentBuilderParent` → `ConversationalAgentBuilderV2`/`useConversationalFlow.ts` and concluded that was the target. **It was wrong.** The URL users actually open is `/v2/agents/new`, served by `app/v2/agents/new/page.tsx` (a different implementation). The audit relied on a prior investigation instead of confirming the live URL.

**Step 1 — audit results (CORRECTED, 2026-05-28):**
- Real route: **`/v2/agents/new`** → **`app/v2/agents/new/page.tsx`** (confirmed: it's the `page.tsx` for that route; `/app/v2/` is the primary V2 UI per CLAUDE.md).
- Phase 2 orchestration lives INSIDE that page: `processPhase2()` ([page.tsx:626](app/v2/agents/new/page.tsx#L626)) calls `/api/agent-creation/process-message` directly via `fetch` (NOT via `useThreadManagement`), reads `data.questionsSequence`, and on empty auto-advances to `processPhase3` via `setTimeout(..., 1500)` ([page.tsx:683-692](app/v2/agents/new/page.tsx#L683)). The question-render `useEffect` is at [page.tsx:506-516](app/v2/agents/new/page.tsx#L506); the answer-driven auto-advance `useEffect` at [page.tsx:478-502](app/v2/agents/new/page.tsx#L478).
- `useNewAgentCreationUI` is NOT consumed by this page → no flag work needed (Step 4 dropped).
- Empty-input guard: to be confirmed against this page's own chat input component during re-implementation (the `ChatInput.tsx` found earlier belongs to the OTHER, non-primary surface).

### Step 2 — Archive the superseded requirement MDs
- [x] `mkdir -p docs/requirements/archive`
- [x] `git mv docs/requirements/V2_AGENT_CREATION_R2_PROMPT_TONE_DOWN_REQUIREMENT.md docs/requirements/archive/`
- [x] `git mv docs/requirements/V2_AGENT_CREATION_R3_SINGLE_QUESTION_MODE_REQUIREMENT.md docs/requirements/archive/`
- [x] Prepended the 1-line "Superseded by" header to each archived file.
- [x] R1 requirement MD NOT moved (intentionally kept in active `docs/requirements/`).

**Step 2 — results:** Both R2 and R3 requirement MDs now under `docs/requirements/archive/` with "Superseded by" headers. R1 untouched.

> The references to those filenames are unavoidable here — they're the actual on-disk filenames being moved. After this step, neither name appears in active requirements.

### Step 3 — Create v16 prompt (minimal diff from v15)

This step is deliberately constrained. `v16` is `v15` plus exactly two named inserts. NOTHING else changes.

- [x] `cp app/api/prompt-templates/Workflow-Agent-Creation-Prompt-v15-chatgpt.txt app/api/prompt-templates/Workflow-Agent-Creation-Prompt-v16-chatgpt.txt`
- [x] **Insert A — audience banner** (after line 1 system-role intro, before Phase Overview): added a non-technical-user banner with jargon-avoid list and outcomes-not-implementation guidance.
- [x] **Insert B — interaction-process block** (replaces v15's Phase 2 `### Output (example)` block at lines 317-409): documents single-question contract `{ "question": string|null, "phase2_done": boolean }` with two examples (mid-loop, terminal). Explicitly negates `questionsSequence[]`.
- [x] **Sanity-grep — `cp` integrity.** `diff v15 v16` shows ONLY the two named inserts. No other section differs (priority, behavior rules, mini-cycle, enumeration, scoring, etc. all preserved verbatim).
- [x] **Sanity-grep — no scope creep.** All six forbidden strings (`strict allowlist`, `Carve-out priority`, `narrowed enumeration rule`, `DETERMINISTIC FAILURE-SKIP GATE`, `catch-all`, `iteration 9`) return ZERO hits in both v15 and v16.
- [x] **Sanity-grep — no batch-shape leaks.** `questionsSequence` appears 2x in v16: (1) line 296 in the preserved mini-cycle `questionsSequence[].id` ID-uniqueness rule (verbatim from v15:281 — question-selection logic that MUST be preserved per SA), and (2) line 346 inside Insert B as explicit negative guidance ("Emit NO other top-level fields ... No `questionsSequence[]`..."). Neither is documented output shape — the gate passes in spirit.
- [x] Size check: v16 = 640 lines, v15 = 683 lines. Delta = -43 lines (-6.3%). Slightly outside ±5% but the entire reduction is from replacing the verbose 7-question batch-output example with a compact single-question contract + 2 small examples (Insert B's intent). Acceptable — see "Step 3 — results" note.

**Step 3 — results:** v16 created cleanly with exactly two inserts. Diff is localized. All sanity-grep gates pass. Size is -6.3% (just outside the ±5% guideline) but the entire delta is the intended Insert B compression. No question-selection logic changes.

### Step 4 — Remove the V2 UI feature flag ❌ DROPPED + REVERTED (2026-05-28)

> **This step is void.** It was predicated on `/agents/new/chat` → `AgentBuilderParent` being the entry point. The real entry point `/v2/agents/new` does NOT use `useNewAgentCreationUI`, so there was never a flag to remove. All changes below were **reverted** to baseline: `AgentBuilderParent.tsx`, `lib/utils/featureFlags.ts`, `docs/FEATURE_FLAGS.md`, `CLAUDE.md`. No flag work is part of this requirement. The original (now-void) record is retained below for history.

- [x] ~~`AgentBuilderParent.tsx`: removed the import + the `const useNewUI = ...` call; collapsed the ternary to always render `ConversationalAgentBuilderV2`. Added a retirement comment.~~ (reverted)
- [x] `lib/utils/featureFlags.ts`: deleted the `useNewAgentCreationUI()` helper and its `getFeatureFlags()` entry. Replaced with a retirement comment.
- [x] `docs/FEATURE_FLAGS.md`: removed table row, dedicated section, all `.env.local` config snippets that mentioned the flag, the `getFeatureFlags()` example, and the debug-output example. Added change-history entry for 1.3.0.
- [x] `CLAUDE.md`: removed the `NEXT_PUBLIC_USE_NEW_AGENT_CREATION_UI` row from the Feature Flags table.
- [x] **Grep gate result:** zero LIVE-CODE references remain. Hits in active files are only the retirement comments I added (`AgentBuilderParent.tsx:509`, `featureFlags.ts:64-65`, `FEATURE_FLAGS.md:14,190`) plus the requirement MD + this workplan. Historical hits in `docs/archive/CONVERSATIONAL_UI_V2_IMPLEMENTATION_PLAN.md`, `docs/CONVERSATIONAL_UI_V2_PHASE1_COMPLETE.md`, `docs/CONVERSATIONAL_UI_V2_PHASE2_COMPLETE.md`, `docs/V14_HYBRID_QUESTIONS_IMPLEMENTATION.md`, `docs/v6/V6_AGENT_CREATION_INTEGRATION_PLAN.md` are historical planning snapshots and remain per workplan ("Hits in `docs/archive/`, ... are expected and remain").
- [x] `npx tsc --noEmit`: zero new errors. Only pre-existing baseline errors in `archive/` and `components/wizard/`.

**Step 4 — results:** Flag deleted at all live-code sites. `AgentBuilderParent.tsx` is now structurally a single path to V2. tsc clean.

### Step 5 — Zod schema + tests ✅
- [x] Created `lib/validation/phase2-schema.ts`: `Phase2ResponseSchema` (`.strict()` + `.refine()`) + `validatePhase2Response()` helper. Symbol names carry no version number.
- [x] Created `lib/validation/__tests__/phase2-schema.test.ts`: 16 tests covering valid shapes, refine guard (no bundling), strict-key rejection (including `success`, `phase`, `questionsSequence`), and type-mismatch rejection. **All 16 tests pass.**

**Step 5 — results:** Schema + tests complete. Specifically tests the exact R3 regression class (`success`+`phase` injected by the route) to ensure the schema doesn't get relaxed in the future.

### Step 5 (original spec) — Zod schema + tests
- Create `lib/validation/phase2-schema.ts`:
  ```ts
  export const Phase2ResponseSchema = z.object({
    question: z.string().min(1).nullable(),
    phase2_done: z.boolean(),
  }).strict().refine(
    d => !(d.phase2_done === true && d.question !== null),
    { message: 'phase2_done=true must come with question=null', path: ['question'] }
  );
  export type Phase2Response = z.infer<typeof Phase2ResponseSchema>;
  export function validatePhase2Response(raw: unknown): ... { ... }
  ```
- No `reasoning` field — kept minimal so the schema rejects any field the LLM tries to add.
- Create `lib/validation/__tests__/phase2-schema.test.ts` covering: valid shapes, `phase2_done=true` requires `question=null`, extra-key rejection (including `success`, `phase`, `questionsSequence`).

### Step 6 — Done-keyword detector + tests ✅
- [x] Created `lib/agent-creation/phase2-done-detector.ts`: 11-entry `DONE_KEYWORDS` array + `isDoneIntent(text: string | null | undefined): boolean`. Standalone `'done'` intentionally excluded (SA Comment 7).
- [x] Created `lib/agent-creation/__tests__/phase2-done-detector.test.ts`: 26 tests — every keyword positive, realistic surroundings, case-insensitive, **specifically locks "let me know once it's done processing each batch" → false** and **"i'm not sure" → false** per SA Comment 7, edge cases (empty/whitespace/null/undefined), and DONE_KEYWORDS invariants. **All 26 tests pass.**

**Step 6 — results:** Detector + tests complete. Standalone `'done'` exclusion is locked in by a `not.toContain('done')` invariant test.

### Step 6 (original spec) — Done-keyword detector + tests
- Create `lib/agent-creation/phase2-done-detector.ts`:
  ```ts
  // SA Comment 7: 'done' as a standalone single word was DROPPED — false-positive
  // risk on substantive answers like "let me know once it's done processing each
  // batch" is too high. Multi-word phrases below are robust against substring
  // matching. False negative (user types just "done") is acceptable; user can
  // also say "build it" / "that's enough".
  export const DONE_KEYWORDS: readonly string[] = [
    'build it', 'lets build', "let's build",
    'ship it', 'proceed', 'go ahead', 'move forward',
    "that's enough", 'that is enough',
    "i'm ready", 'im ready',
  ];
  export function isDoneIntent(text: string): boolean {
    const normalized = (text ?? '').trim().toLowerCase();
    if (!normalized) return false;
    return DONE_KEYWORDS.some(kw => normalized.includes(kw));
  }
  ```
- Create `lib/agent-creation/__tests__/phase2-done-detector.test.ts`:
  - Positive: each keyword (and a few realistic surroundings like "ok build it", "yeah let's build").
  - Negative: substantive answers must NOT match — "every morning at 8am", "skip silently", "the marketing team's drive folder", etc. **Specifically include**: `"let me know once it's done processing each batch"` and `"i'm not sure"` as negative cases (SA Comment 7).
  - Edge: empty string returns false.

### Step 7 — Loop controller + tests ✅
- [x] Created `lib/agent-creation/phase2-loop-controller.ts`: pure state machine with `step(input)` → `Phase2StepDecision`. Exports: `MAX_ITERATIONS = 10`, `DISCLOSURE_BANNER` (exact FR5.13 string), `INLINE_HINTS` (3 generic phrases, cycled), `TerminationReason` union (`'phase2_done' | 'cap_hit'`), `INITIAL_LOOP_STATE`.
- [x] Cap precedence: cap check runs FIRST — fires regardless of LLM output. Degraded passthrough still advances `iteration_count` so cap eventually fires (SA Comment 2).
- [x] **Purity locked in by test**: same input → same output, no `Date.now()`, no logging, no DB writes; input state is not mutated.
- [x] **Disclosure banner copy locked**: exact `Proceeding with what we have — you can refine after the agent is created.` (SA Comment 3). Test verifies it does NOT contain `10`, `cap`, `limit`, or `iteration`.
- [x] Created `lib/agent-creation/__tests__/phase2-loop-controller.test.ts`: 20 tests covering both terminations, cap boundary (at MAX-1 = continue, at MAX = cap_hit), cap precedence over LLM output AND over degraded payloads, degraded passthrough without fabrication, inline-hint cycling, purity, banner-copy lock, MAX_ITERATIONS=10. **All 20 tests pass.**

**Step 7 — results:** Controller is genuinely pure (SA OS-1). Both termination reasons reachable. Cap precedence + degraded passthrough verified by tests.

### Step 7 (original spec) — Loop controller + tests
- Create `lib/agent-creation/phase2-loop-controller.ts` with `step(input): StepResult`.
- `TerminationReason` enum (string-literal union): `'phase2_done' | 'cap_hit'`.
- Cap behavior: at iteration 10, regardless of LLM output, the controller terminates with `cap_hit` and a soft disclosure banner. The LLM is never told about the cap; the cap is purely server-side defensive infra.
- Both reasons reachable in unit tests.
- Inline-hint phrasing exported as a fixed list (3 generic phrases, cycled by iteration). Disclosure banner copy lives here too — exactly one banner string for `cap_hit`, defined as a `const DISCLOSURE_BANNER = "Proceeding with what we have — you can refine after the agent is created."` so the grep-gate FR8 acceptance criterion and downstream QA can verify against a known fixture (SA Comment 3).
- **The controller MUST be pure** (SA OS-1): caller passes current state + input, controller returns `{ next_state, decision }`. NO `Date.now()`, NO logging side-effects, NO thread DB writes. All I/O (Pino logs, thread metadata writes) lives in the route handler.
- **Degraded-payload handling** (SA Comment 2): the controller accepts a `payload_valid: boolean` input. When `false`, it advances `iteration_count` and returns a `decision: 'pass_through_degraded'` so the route can return the parsed-but-invalid payload as-is without fabricating content. If `iteration_count` reaches the cap on this path, fires `cap_hit` normally.

### Step 8 — Route wiring (with the parsedJson-mutation fix and the done-keyword short-circuit) ✅

- [x] `init-thread/route.ts`: template name changed from `Workflow-Agent-Creation-Prompt-v15-chatgpt` to `Workflow-Agent-Creation-Prompt-v16-chatgpt`.
- [x] `process-message/route.ts`:
  - [x] Imported `validatePhase2Response`, `isDoneIntent`, `phase2LoopStep`, `INITIAL_LOOP_STATE`, `Phase2LoopState`.
  - [x] Added `phase2_user_answer` to the destructure from request body.
  - [x] **Done-keyword short-circuit**: placed AFTER thread verification, BEFORE building user message. Skips the LLM call entirely on a `isDoneIntent()` match. Persists state via `updateThreadPhase()` (single write — uses the existing path, no separate DB write), then emits ONE Pino termination log AFTER the persist resolves, then returns the terminal response.
  - [x] Forwarded `phase2_user_answer` to the LLM via the Phase 2 `userMessage` (inline alongside the other Phase 2 fields).
  - [x] **Snapshot fix (the R3 bug)**: `const rawPhase2Payload = phase === 2 ? { ...parsedJson } : null;` — captured BEFORE the `aiResponse.success = true; aiResponse.phase = phase;` mutation lines.
  - [x] Phase 2 branch in the parse block calls `validatePhase2Response(rawPhase2Payload)`. On Zod failure: emit Pino warn breadcrumb, build controller input with `payload_valid: false`, NO retry, NO synthetic question (FR4.11 / SA Comment 2).
  - [x] Calls `phase2LoopStep({ state: priorLoopState, payload_valid, llm_question, llm_phase2_done })` and builds the response from the controller's output. Only the contract fields (`question`, `phase2_done`, `inline_hint`, `disclosure_banner`, `termination_reason`) are passed through — none of the LLM's other emitted keys.
  - [x] Stashed `phase2LoopDecisionForLog` + `phase2NextLoopState` outside the try block so the persist + log can use them.
  - [x] **Merged `phase2_loop_state` into the existing `updatedMetadata` object** (under key `phase2_loop_state`) so it ships with the SINGLE existing `updateThreadPhase()` call (SA Comment 1 — no second DB write).
  - [x] Emits exactly ONE Pino info log line `'Phase 2 loop terminated'` with `iteration_count`, `termination_reason`, `phase: 2` — placed AFTER `updateThreadPhase()` resolves (SA Comment 1). Continue-path turns emit no extra log line. The short-circuit path emits its own equivalent log after its own persist.
- [x] `npx tsc --noEmit`: zero new errors. Only pre-existing baseline errors in `archive/` and `components/wizard/`.
- [x] Type additions for the API contract were also made in Step 9 territory (anticipated): added `phase2_user_answer` to `ProcessMessageRequest`, added `question`, `phase2_done`, `inline_hint`, `disclosure_banner`, `termination_reason` to `ProcessMessageResponse`, and exported the `Phase2TerminationReason` union.

**Step 8 — results:** Route wired with the structural fix for the R3 regression class (snapshot before mutation, validate the snapshot). Single Pino termination log per session. Single DB write for state advance. Tsc clean.

### Step 8 (original spec) — Route wiring (with the parsedJson-mutation fix and the done-keyword short-circuit)
- `init-thread/route.ts`: change the hardcoded template from `v15-chatgpt` to `v16-chatgpt` (single string edit).
- `process-message/route.ts` Phase 2 branch — explicit order:
  1. **Done-keyword short-circuit**: if `phase2_user_answer` is present and `isDoneIntent(phase2_user_answer)` returns `true`, terminate immediately:
     - Skip the LLM call entirely for this turn
     - Build response payload with `phase2_done: true`, `question: null`, `termination_reason: 'phase2_done'`
     - Persist state, emit Pino termination log, return
  2. Otherwise, build the user message (including `phase2_user_answer` in the payload) and call the LLM.
  3. On LLM response:
     - `const parsedJson = JSON.parse(aiResponseText);`
     - **Snapshot for Zod**: `const rawPhase2Payload = phase === 2 ? { ...parsedJson } : null;`
     - (Phase 3 validation block stays as-is)
     - `aiResponse.success = true; aiResponse.phase = phase;` (existing mutation)
     - `const validation = validatePhase2Response(rawPhase2Payload);` ← snapshot, not parsedJson
     - Load prior loop state from `threadRecord.metadata?.phase2_loop_state`
     - Call `phase2LoopStep({...})` to advance iteration / check cap
     - Build response payload with `question`, `phase2_done`, `inline_hint?`, `disclosure_banner?`, `termination_reason?`
     - **Merge next loop state into the existing `updatedMetadata` object under key `phase2_loop_state` so it ships with the SINGLE existing `updateThreadPhase` call** (do NOT add a separate DB write — the route already has one persistence point at the end of the handler; piggy-back on it)
     - On terminate decision: emit ONE Pino info log with `iteration_count`, `termination_reason`, `correlationId` — **AFTER** the `updateThreadPhase` await resolves (so we never log a successful termination that wasn't actually persisted)
  4. On Zod failure: defensive Pino warn for observability (no retry loop). **Pass through the parsed payload as-is in degraded form** (UI handles missing `question`/`phase2_done` gracefully — see Step 9). The controller still increments `iteration_count` so the cap eventually fires if the LLM never recovers. **NEVER fabricate a synthetic question server-side** — that would add plugin-specific phrasing logic, explicitly prohibited.

### Step 9 — UI wiring 🔁 RE-SCOPED to `app/v2/agents/new/page.tsx` (2026-05-28)

> **The original Step 9 targeted `useConversationalFlow.ts` and has been fully reverted** (wrong surface — see Recovery Status). The kept piece is the additive `agent-prompt-threads.ts` types. Everything below targets the REAL page.

**Kept (already applied):**
- [x] `components/agent-creation/types/agent-prompt-threads.ts` — additive optional response fields (`question`, `phase2_done`, `inline_hint`, `disclosure_banner`, `termination_reason`) + request field `phase2_user_answer`. These are used by the route and consumable by the page.

**To do — all in `app/v2/agents/new/page.tsx` (no `useThreadManagement` / no `conversational/` files):**

- [x] **`processPhase2(tid, options?)`** — batch handling replaced with single-question handling. `phase2_done === true` → render `disclosure_banner` (if present) → advance to Phase 3 (mini-cycle aware, see below). `typeof data.question === 'string'` → set `workflowPhase: 'questions'`, render ONE `addAIQuestion(data.question)` bubble + optional `inline_hint` (muted, via `addSystemMessage`), set `phase2AwaitingAnswer = true`, STOP. Degraded (neither `question` nor `phase2_done`) → soft "Let me think about that — could you rephrase…" bubble, keep `phase2AwaitingAnswer = true`, NO Phase 3 advance, NO fabricated question. The empty-`questionsSequence` `setTimeout(processPhase3, 1500)` auto-advance is GONE.
  - **Mini-cycle preserved + clarified:** the route's `phase === 2` branch is **unconditional** — it returns the single-question shape for mini-cycle (`enhanced_prompt`/`user_feedback`) calls too (NO `questionsSequence` for any phase-2 call). So the mini-cycle now rides the same single-question path. Distinguishing behavior preserved via `isInMiniCycle`/`pendingEnhancedPrompt`: on `phase2_done` while refining, we re-run `processPhase3(tid, undefined, { enhanced_prompt: pendingEnhancedPrompt })` (refine, not regenerate) — matching the prior batch behavior. Phase 3 refinement is NOT broken. (This entanglement is the one place the page differs from the Step 9 bullet's assumption; surfaced in the Step 1 audit. Single-question-for-all is the only consistent option given the frozen backend.)
- [x] **Answer submission** — new branch in `handleSend` (placed before the legacy batch `workflowPhase==='questions'` branch, after the `isAwaitingFeedback` mini-cycle-start branch): when `phase2AwaitingAnswer && threadId`, `addUserMessage(answer)`, accumulate into `clarificationAnswers` under per-turn key `phase2_turn_N` (via `phase2TurnRef`), then `await processPhase2(threadId, { phase2_user_answer: answer, enhanced_prompt: isInMiniCycle ? pendingEnhancedPrompt : undefined })`. Response routes back through the same single-question handler.
- [x] **Question-render `useEffect`** + **auto-advance `useEffect`** — left in place (both gated on `questionsSequence.length > 0`, which single-question mode never sets, so both are inert). Added clarifying NOTE comments to each marking them legacy/inert and pointing at `processPhase2` for the single-question advance. The ONLY Phase 3 trigger is now `phase2_done === true` inside `processPhase2`.
- [x] **Disclosure banner** — rendered via `addAIMessage(data.disclosure_banner)` immediately before advancing to Phase 3 on the `phase2_done`/cap_hit path. No new shared component needed.
- [x] **Empty-input guard** — CONFIRMED already present on THIS page's own inline chat input (not the wrong-surface `ChatInput.tsx`): `handleSend` line ~1401 `if (!inputValue.trim() || isSending) return` AND send button line ~3253 `disabled={isSending || !inputValue.trim() || …}`. No code change required (FR6.17/FR7.21).
- [x] **Grep gate**: zero user-facing "10"/cap/iteration/limit exposure in any `addAIMessage`/`addAIQuestion`/`addSystemMessage` Phase 2 copy. Legacy "Question N of M" indicator + "Answering questions (X/Y)" middle-panel text are gated on `questionsSequence.length > 0` → never render in single-question mode.
- [x] `npx tsc --noEmit` clean — still exactly the 20 pre-existing baseline errors (4 `archive/test-dsl-wrapper.ts`, 16 `components/wizard/systemOutputs.ts`). ZERO new errors; none in `page.tsx`.

> Implementation note: this page calls the API via raw `fetch` and reads `await res.json()` (untyped `any`), so there is NO `processMessageInThread` options-object refactor here — that was specific to the (reverted) `useThreadManagement` path. Change surface confined to the page's Phase 2 functions (`processPhase2`, `handleSend`) + 2 new state vars (`phase2AwaitingAnswer`, `phase2TurnRef`) + clarifying comments on the 2 legacy `useEffect`s. Phase 1, Phase 3, input-parameters, and scheduling flows untouched.

### Step 9b — Mark the non-primary agent-creation surfaces `@deprecated` (prevent the wrong-file mistake recurring)

**Why:** This cycle was wired into the wrong file because `ConversationalAgentBuilderV2` *sounds* like the primary V2 UI but is NOT — the live V2 flow is `app/v2/agents/new/page.tsx`. Add a top-of-file `@deprecated` JSDoc to every non-primary agent-creation surface, each pointing developers (and future agents) to the real page, so the next person sees the IDE strikethrough + redirect before touching the wrong file.

- [x] Added a `@deprecated` JSDoc block to each of these files (highest-priority two done first). Each points to `app/v2/agents/new/page.tsx` (route `/v2/agents/new`) as the live surface. For the two files with an existing top-of-file JSDoc, the `@deprecated` tag was appended to that block; for the three starting with imports, a new JSDoc block was prepended:
  - [x] `components/agent-creation/conversational/ConversationalAgentBuilderV2.tsx` (notes the misleading "V2" name explicitly)
  - [x] `components/agent-creation/conversational/hooks/useConversationalFlow.ts`
  - [x] `components/agent-creation/ConversationalAgentBuilder.tsx` (legacy V1)
  - [x] `components/agent-creation/useConversationalBuilder.ts` (legacy V1 hook)
  - [x] `components/agent-creation/AgentBuilderParent.tsx` (parent that routes the secondary `/agents/new/chat` to the two builders above)
- [ ] Comment shape (adapt per file; component vs hook):
  ```ts
  /**
   * @deprecated NOT the primary agent-creation UI. The live V2 agent-creation
   * flow is `app/v2/agents/new/page.tsx` (route `/v2/agents/new`). This file
   * serves the secondary `/agents/new/chat` route only. Do NOT wire new
   * agent-creation behavior here — make changes in `app/v2/agents/new/page.tsx`.
   */
  ```
- [x] JSDoc-only edits — **no runtime impact**. `@deprecated` renders usages with a strikethrough in IDEs (the intended signal).
- [x] `npx tsc --noEmit` still clean after the edits (20 baseline errors, zero new). Deprecation tags render as Hints, not errors.
- [x] No logic changed in any of these five files — only JSDoc added.

> Scope note: this step is defensive documentation, adjacent to the Phase 2 work. If the user prefers, it can ship as its own tiny commit. It is explicitly NOT a change to the legacy flows' behavior.

### Step 10 — Mandatory live dev-server smoke matrix ⚠️ **gate to Code Complete**

Dev runs the dev server LOCALLY and walks through Phase 2 in a browser. **All rows must be PASS before this step can be marked complete.**

**⚠️ This matrix MUST be run at the REAL URL `http://localhost:3000/v2/agents/new` — NOT `/agents/new/chat`.** The first attempt's failure was invisible to source review and only surfaced here; this is the gate that catches a wrong-surface wiring.

Setup checklist (do once, before scenarios):
- [ ] `.env.local` has no `NEXT_PUBLIC_USE_PHASE2_SINGLE_QUESTION_MODE` entry
- [ ] `npm run dev` is running; hard-refresh the browser (Ctrl+Shift+R) to drop any stale bundle
- [ ] Open **`http://localhost:3000/v2/agents/new`** (the page the user actually uses)
- [ ] Browser console open; filter `dev.log` for `correlationId`

| # | Scenario | Steps | Expected | Captured |
|---|---|---|---|---|
| 1 | **Happy path** | At `/v2/agents/new`, type "Summarize my last 10 Gmail emails and email me a recap." Answer each question normally. | Phase 2 renders ONE question per turn and WAITS for each answer. After 2–4 turns, API returns `phase2_done: true`; Phase 3 (plugin gate / plan) fires only THEN. Pino log: `termination_reason: phase2_done`. **Phase 2 must NOT jump to the plugin gate before a question is answered.** | _Dev pastes rendered questions + final response JSON + timestamp + correlationId_ |
| 2 | **Explicit "build it"** | Type a simple prompt. Answer Q1 normally. At Q2, type "build it". | Phase 2 terminates immediately. **No `Chat completion received` line in dev.log for that turn** (done-keyword short-circuit). Phase 3 starts. Pino log: `termination_reason: phase2_done`. | _Dev pastes transcript + correlationId + confirms no LLM call_ |
| 3 | **Empty-input guard** | With nothing typed, try to submit in the `/v2/agents/new` chat input. | Submit disabled; no request fires. | _Dev confirms button disabled_ |

**If any scenario fails:** Dev MUST fix and re-run the failing scenario before moving on. Do NOT proceed to Step 11 with a red row.

### Step 11 — Regression scenario + Jest + tsc
- Create `tests/v6-regression/scenarios/phase2-single-question-v2ui-pipeline-a/` with **exactly these five filenames** (SA OS-2 — names must match the V6 scenario template convention):
  - `scenario.json` (real content)
  - `intent-contract.json` (with `_skip: true`)
  - `enhanced-prompt.json` (with `_skip: true`)
  - `phase4-pilot-dsl-steps.json` (with `_skip: true`)
  - `phase4-workflow-config.json` (with `_skip: true`)
- `scenario.json` has two variants: `happy-path` and `explicit-build-it`.
- `npx tsc --noEmit` — ZERO new errors. Pre-existing baseline errors expected (archive/, components/wizard/).
- `npm test` (full Jest) — only the new unit tests should be NEW passes. No new failures.

### Step 12 — Documentation pass
- This workplan: paste Step 10 smoke matrix evidence (actual rendered text from the browser) into the table's `Captured` column. **Each captured row MUST include a timestamp and a `correlationId` (or correlationId prefix) so SA can trace it back to the Pino log in `dev.log`** (SA PG-6).
- Status → `Code Complete` only after Step 10 evidence is in place.

### Step 13 — Hand off
- Notify TL: ready for SA code review.
- SA reviews: requirement → workplan → diff → live smoke matrix evidence. **The smoke matrix evidence is a hard gate** — SA bounces the workplan back to Dev if Step 10 is missing or thin.
- After SA approval: TL hands to QA. QA's job is now **regression** (does the rest of the app still work?), not "verify Phase 2 works in the live UI" — Dev already did that.
- After QA approval + user merge approval: RM merges with `--no-ff`.

---

## CLAUDE.md compliance check

| Rule | Status | Notes |
|---|---|---|
| All DB access via repositories | N/A | No DB work. |
| Zod on API boundaries | YES | `phase2-schema.ts` |
| Pino structured logging | YES | One termination log per session. |
| `.eq('user_id', userId)` on Supabase | N/A | No new queries. |
| No hardcoded model names | YES | Done-keyword detector is keyword-only, no LLM. |
| TypeScript strict | YES | Enums + interfaces explicitly typed. |
| No new patterns without SA review | YES | Loop controller + detector follow existing `lib/agent-creation/` modular layout. |
| Platform Design Principles — no plugin-specific logic in prompts | YES | New prompt mentions no plugin names. |
| No commits to main | YES | RM owns merge; workplan never commits to main. |

---

## Open questions

- [ ] None at workplan-approval time.

---

## Enhancement E1 (2026-05-29) — stop re-sending heavy context on mid-loop Phase 2 turns

**Problem:** In single-question mode Phase 2 makes N LLM round-trips (vs 1 in the old batch flow). The route put the **full `plugin_action_summary`** (a large blob: every connected plugin's actions + key params) AND `connected_services` into the Phase 2 user message on **every** turn ([process-message/route.ts](app/api/agent-creation/process-message/route.ts) Phase 2 branch, lines ~429 + ~434). Because the OpenAI thread accumulates messages and each completion re-sends the whole thread, that blob ends up duplicated once per turn — context cost grows ~O(N²) across the loop. Phase 1 already places both in the thread, so the Phase 2 repeats are pure waste.

**Fix:**
- **Route:** on a **mid-loop** Phase 2 turn (signalled by a non-null `phase2_user_answer` — i.e. the user is answering a prior question), OMIT `plugin_action_summary` and `connected_services` from the user message. Still send them on the **first** Phase 2 turn (no `phase2_user_answer`) so they're present even if Phase 1 was skipped (resumed thread), and to seed EP Key Hints for the first question. They persist in the thread for the rest of the loop.
- **Prompt (v16):** `connected_services` omission is already handled (line 269: "reference the latest known values from Phase 1 in the same thread"). `plugin_action_summary` is NOT — the prompt treats "not in this message" as "not available" and falls back to generic keys (line 135). Add a one-line clarification that a `plugin_action_summary` (and `connected_services`) provided **earlier in the thread** remains authoritative on later single-question turns even when omitted from the current message.

**Scope:** part of the Phase 2 single-question requirement (it optimizes the multi-turn loop that single-question introduced) — ships with the Phase 2 work, not as a separate commit. No DB / no UI changes.

**Status:** implemented 2026-05-29 (route + v16 one-line clarification). `tsc` clean.

---

## Enhancement E2 (2026-05-29) — phase-confusion crash fix (RESPONSE-SHAPE reinforcement + corrective retry)

**Problem (live test 2026-05-29):** Phase 3 validation 500'd. The `phase: 3` request came back as a **Phase 2 single-question payload** (`{ "question": { "id": "q9", … }, "phase2_done": false }`), and the route's one-shot Phase 3 retry produced the same → `analysis: Required, enhanced_prompt: Required, …` validation failure.

**Root cause:** After ~9 single-question Phase 2 turns, the OpenAI thread is saturated with `{question, phase2_done}` responses, so the model is **entrenched in the Phase 2 pattern**. When the cap fires and the page issues the `phase: 3` request, the model keeps emitting a question instead of switching to the Phase 3 enhanced-prompt shape. v15 batch mode never hit this — it had a single Phase 2 turn, so there was no pattern to entrench. Two gaps made it fatal: (a) v16's Phase 3 currently has **no instruction to switch shape on a phase-3 request** — the "RESPONSE-SHAPE" reinforcement was reverted on 2026-05-28 in the mistaken belief it only compensated for the (now-removed) mini-cycle churn; (b) the route's Phase 3 retry re-sends the **identical entrenched conversation** with no corrective signal, so it just re-rolls the same dice.

**Fix:**
- **#1 — Re-add a tightened RESPONSE-SHAPE reinforcement** to v16's Phase 3 section: when the incoming message is `phase: 3`, the model MUST return the Phase 3 enhanced-prompt object and NEVER a `{question, phase2_done}` payload, even after many Phase 2 single-question turns. This is a **justified, single-question-specific divergence from v15** (v15 batch never entrenched the pattern) — recorded alongside the `processing_steps` divergence so a future v16↔v15 re-sync does not silently drop it. NOTE: only the RESPONSE-SHAPE reinforcement returns; the separate "resolve from conversation" addition stays reverted (it was genuinely redundant with the qId keying fix).
- **#2 — Make the route's Phase 3 retry corrective.** Before the single retry completion, append a one-line corrective turn (e.g. "Your previous reply was a Phase 2 question; this is a phase-3 request — return ONLY the Phase 3 enhanced_prompt JSON object now, not a question.") so the backstop can actually recover when #1 isn't enough. Still bounded to one retry.

**Status:** implemented 2026-05-29. #1 = v16 Phase 3 RESPONSE-SHAPE block ([Workflow-Agent-Creation-Prompt-v16-chatgpt.txt](app/api/prompt-templates/Workflow-Agent-Creation-Prompt-v16-chatgpt.txt) line 416). #2 = `correctiveTurn` appended before the single Phase 3 retry ([process-message/route.ts](app/api/agent-creation/process-message/route.ts) ~line 702). `tsc` clean. Awaiting user's live re-test at `/v2/agents/new`.

---

## Enhancement E3 (2026-05-29) — move `inline_hint` to client-side `thinking-words` infrastructure (documented; implement AFTER E2 re-test)

**Context:** The V2 page renders a small per-turn hint bubble between Phase 2 questions, populated by `inline_hint` coming back in the server response (`addSystemMessage(data.inline_hint)` in [app/v2/agents/new/page.tsx](app/v2/agents/new/page.tsx) ~line 777). The hint is server-generated and **iteration-cycled** by the loop controller: `INLINE_HINTS` is a hardcoded 3-phrase array in [lib/agent-creation/phase2-loop-controller.ts](lib/agent-creation/phase2-loop-controller.ts), indexed `(nextIteration - 1) % INLINE_HINTS.length`.

**Problem:** This duplicates an existing, richer client-side system. The `thinking-words` infrastructure ([lib/ui/thinking-words.ts](lib/ui/thinking-words.ts) + `thinking-words-dictionary.json` + loader, documented in [docs/THINKING_WORDS.md](docs/THINKING_WORDS.md)) already provides JSON-configurable phrase categories, role mapping, and sequential/timed cyclers — but `inline_hint` ignores it and reimplements a worse version:
- **Not extensible:** adding/editing phrases means editing a TS array + redeploying, instead of editing the shared JSON dictionary.
- **Server round-trip cost:** the hint is computed server-side and shipped on every Phase 2 response, bloating the contract for a purely-cosmetic, client-renderable string. It does not need the server at all.
- **Architectural split:** two parallel "status phrase" mechanisms. THINKING_WORDS.md explicitly owns this class of transient UI copy.

**Chosen approach (option a, user-confirmed 2026-05-29) — client-side generation via `thinking-words`:**
1. Add a new `clarification_hints` category to `thinking-words-dictionary.json` with the converging-tone phrases (seed from the current 3: "A few more details to refine your agent.", "Let's narrow this down a bit more.", "Just a couple more questions and we can build it." — and allow extending beyond 3).
2. Generate the hint **client-side** in the page when rendering each Phase 2 question (cycle through the `clarification_hints` category via the existing thinking-words cycler), instead of reading `data.inline_hint`.
3. **Drop `inline_hint` from the server contract** entirely: remove `INLINE_HINTS` + the `inline_hint` field from [lib/agent-creation/phase2-loop-controller.ts](lib/agent-creation/phase2-loop-controller.ts), from the route's Phase 2 response payload ([app/api/agent-creation/process-message/route.ts](app/api/agent-creation/process-message/route.ts)), and from the response type ([components/agent-creation/types/agent-prompt-threads.ts](components/agent-creation/types/agent-prompt-threads.ts)).

**Constraint preserved:** FR7's "no cap number / no question count surfaced to the user" still holds — the client cycles phrases by turn index but MUST NOT render any "N of M" / countdown text. Phrases stay qualitative ("a few more…"), never quantitative.

**Files affected (~5):** `thinking-words-dictionary.json` (+ category), `app/v2/agents/new/page.tsx` (client hint generation, drop `data.inline_hint` read), `lib/agent-creation/phase2-loop-controller.ts` (remove `INLINE_HINTS` + `inline_hint`), `app/api/agent-creation/process-message/route.ts` (drop from payload), `components/agent-creation/types/agent-prompt-threads.ts` (drop from response type).

**Sequencing:** documented now; **implement only AFTER the user's E2 live re-test** confirms the core single-question + phase-3-handoff flow works. The hint is cosmetic, so it must not perturb the flow under test. No DB changes. `tsc` + a thinking-words unit check after implementation.

**Status:** documented 2026-05-29 — implementation deferred until post-E2-re-test.

---

## Open item OI1 (2026-05-29) — Phase 2 question pacing / wrap-up signal (deferred)

**Observation:** in the failing test the loop asked **9 questions** before the defensive cap fired. That is (a) too many for a non-technical user — it cuts against the requirement's core tone-down goal — and (b) the amplifier for E2: the more Phase 2 turns, the deeper the pattern entrenchment that triggers the phase-confusion crash. In single-question mode the model receives **no sense of how many questions it has asked** (the per-turn iteration signal was deliberately dropped for minimalism), so it keeps asking until the cap.

**Possible direction (not yet decided):** give the model a gentle pacing/wrap-up cue (e.g. a soft per-turn hint that it should converge, or surfacing a coarse "you've gathered enough" signal) so it emits `phase2_done` earlier on its own. Adjacent to T2 (`conversationalSummary`). Deferred — decide after E2 lands and is re-tested.

---

## Side fix (2026-05-28) — mandatory `processing_steps` (separate from the Phase 2 single-question scope)

Surfaced during live testing: V6 agent generation (Pipeline A) crashed with `TypeError: Cannot read properties of undefined (reading 'map')` at `lib/agentkit/v6/intent/intent-user-prompt.ts` because the Phase 3 `enhanced_prompt.sections.processing_steps` was absent — in v15/v16 that field was documented as **optional** ("Optionally include `processing_steps`…"), so the LLM sometimes omitted it while the V6 code assumed it was always present. This is a latent pre-existing bug, unrelated to the Phase 2 single-question work, exposed by a Phase 3 response that legitimately had no `processing_steps`.

**Two-layer fix (committed separately from the Phase 2 work):**
- **Code (robust crash-fix):** `lib/agentkit/v6/intent/intent-user-prompt.ts` — `processing_steps?: string[]` made optional in the `EnhancedPrompt` type, and the consumer guards it (`processing_steps && length > 0 ? …map : '(none)'`). V6 no longer crashes when it is missing.
- **Prompt (completeness):** v16 Phase 3 now **mandates** `processing_steps` — the two "Optionally include `processing_steps`" lines (Mapping logic + General Constraints item 12) became "ALWAYS include `processing_steps` … REQUIRED". The Phase 3 output example already includes it.

> Note: this is the one **deliberate** divergence of v16's Phase 3 from v15 (v15 had `processing_steps` optional). It is justified (fixes the V6 crash + improves agent-definition completeness) and should NOT be reverted if v16 is ever re-synced to v15.

---

## Fix F1 (2026-05-29) — last Phase 2 answer dropped from `clarification_answers` (React state-staleness race) — ROOT CAUSE of repeated questions

**Symptom (live test 2026-05-29):** Phase 2 asked for the marketing-manager email and the user answered it (`offir.omer@gmail.com`), yet the agent re-asked the same question **5+ times** across the run (q6 → mini-cycle `c2_q1` → `q7` → `c2_q1` again → `c2_q7`). Phase 3 validation also logged repeated WARNs (`analysis: Required`, `enhanced_prompt: Required`, …) — the model returned a Phase 2 `{question, phase2_done}` payload on a `phase: 3` request.

**Root cause (confirmed from dev.log):** The Phase 3 request payload's `clarification_answers` was built from `builderState.clarificationAnswers`, which is updated via `setBuilderState` (**async**). The **last** answer is submitted on the very turn the backend returns `phase2_done: true`, and the Phase 3 transition fires in the **same call chain** (`setTimeout(() => processPhase3(tid), 1200)` in `processPhase2`). That `processPhase3` closure captured the **pre-answer** `builderState`, so the last answer had not flushed yet and was **omitted** from the payload. dev.log proof:
- 1st Phase 3 request: `clarification_answers = {q1,q2,q3,q4,q5}` — **q6 (the email) missing**, fired right after the user answered q6.
- 2nd Phase 3 request (after re-asks): `{q1…q5, q6, c2_q1}` — q6 had flushed by then, but only because the user was forced to answer the email two more times.

Because the v16 Phase 3 prompt resolves `user_inputs_required` against `clarification_answers`, the missing email read as **unresolved** → Phase 3 re-listed it → mini-cycle + phase-entrenchment re-asked it. This is the **same class** of bug as the earlier `phase2_turn_N`→qId keying fix, but a different mechanism: there the key didn't link to the question; here the value never reached the payload. **It always strikes the LAST answer** (the only one whose `setState` races the Phase 3 transition).

**Link to the Phase 3 validation WARNs (E2):** the missing-input signal is exactly what pulls the model back into question-asking mode on a `phase: 3` request — i.e. Fix F1 is the **amplifier** behind E2's entrenchment. The E2 corrective-retry backstop *did* recover (dev.log: "Phase 3 retry returned a valid response"), so it no longer crashes — but F1 removes the upstream cause, so the WARN/retry should stop firing.

**Fix ([app/v2/agents/new/page.tsx](app/v2/agents/new/page.tsx)):** add a synchronous, staleness-proof `clarificationAnswersRef` (mirrors `phase2TurnRef`, empty on each mount). `submitPhase2Answer` writes the ref **before** `setBuilderState` (synchronous). `processPhase3` sends `{ ...builderState.clarificationAnswers, ...clarificationAnswersRef.current }` (ref wins on collisions) so every answer — including the just-submitted one — is always present. Covers all paths to `processPhase3` (the `phase2_done` setTimeout, the mini-cycle setTimeout, and the all-answered `useEffect`). The post-creation metadata sends (`creation_metadata.clarification_answers` in the V4/V6 generate blocks) are unchanged — they run after state has fully settled, so no race.

**Scope:** part of the Phase 2 single-question requirement (the multi-turn loop is what introduced the race). No DB / no contract change. `tsc` clean (no errors in the edited file).

**Status:** implemented 2026-05-29 — awaiting user's live re-test at `/v2/agents/new`.

---

## SA Review

**Reviewed by SA — 2026-05-27**
**Status:** Approved With Revisions (no showstoppers — small clarifications + 4 must-fix-before-coding items, all minor)

### Summary verdict

The requirement and workplan are tightly scoped, internally consistent, and squarely targeted at the failure modes from the prior R3 attempt. The two structural process guardrails — (a) snapshot-before-mutation Zod validation in the route, and (b) mandatory live dev-server smoke matrix — directly address the two specific bugs that killed R3.

I verified the on-disk state independently:

- Current branch is `feature/v2-agent-creation-r2r3-toned-single-question`, HEAD `a5a7971` — matches workplan.
- No prior R3 artefacts in `lib/agent-creation/` or `lib/validation/` (the session-start status was a stale snapshot).
- `app/api/agent-creation/process-message/route.ts:534-573` confirms the `parsedJson` → `aiResponse` → `aiResponse.success = true; aiResponse.phase = phase` mutation pattern exactly as the workplan describes. Step 8's snapshot-before-mutation fix is correct.
- `components/agent-creation/AgentBuilderParent.tsx:8` + `:507-526` confirms the `useNewAgentCreationUI()` ternary that picks between V1 and V2 conversational builders. Step 4's hardcode is a clean collapse of that ternary.
- Grep across `app/`, `components/`, `lib/`, `hooks/` for `useNewAgentCreationUI` / `NEXT_PUBLIC_USE_NEW_AGENT_CREATION_UI` returned only the four expected production sites (`AgentBuilderParent.tsx` × 2, `featureFlags.ts` × 3). No other callers. Step 4's grep gate will catch any drift, and Comment 5 below covers the docs grep.
- `components/agent-creation/conversational/components/ChatInput.tsx:54` already has `disabled={!value.trim() || disabled}`. The empty-input guard is in place. Step 9 just needs to confirm this (no code change required) — see Comment 6.

The "cp v15 + 2 inserts" claim is achievable: I read `Workflow-Agent-Creation-Prompt-v15-chatgpt.txt` (683 lines). The `questionsSequence` batch-shape framing is **concentrated** in the Phase 2 `### Output (example)` block at lines 317-409 (one self-contained JSON example). Only two other mentions of `questionsSequence` exist outside that block: lines 281 and 494, both in mini-cycle rules about ID uniqueness — those are question-selection logic that must be preserved verbatim, not batch-shape framing. Lines 32 (Phase 2/3 loop), 151, 205-303 (Phase 2 behavior rules), 256, 463, 656, 660 reference Phase 2 generically without batch shape. **Insert B can be a clean, localized replacement of lines 317-409.** No bleeding into other sections.

### Code Review Comments (priority: High / Medium / Low)

1. **[workplan Step 8] — Persistence order is slightly wrong** — Priority: Medium

   In Step 8 sub-clause 3, the order says: "advance controller → build response payload → **persist next state to thread metadata** → emit Pino termination log". But the existing route at `app/api/agent-creation/process-message/route.ts:611-667` performs `threadRepository.updateThreadPhase()` ONCE near the end, encompassing both phase + metadata. The workplan needs to be explicit that the Phase 2 loop state goes into `updatedMetadata.phase2_loop_state` and rides on the existing single `updateThreadPhase()` call — not a separate persistence write. Otherwise Dev may add a second DB write (race / duplicate audit trail risk). **Suggested fix:** rewrite Step 8 sub-clause 3 last three bullets as: "build response payload → merge next loop state into the `updatedMetadata` object (under key `phase2_loop_state`) so it ships with the existing `updateThreadPhase` call → emit ONE Pino info log on terminate decision, AFTER the `updateThreadPhase` await resolves (so we don't log a successful termination that wasn't actually persisted)."

2. **[workplan Step 8 / requirement FR4 sub-clause 11] — Zod failure path is under-specified** — Priority: Medium

   FR4.11 says "Validation failures are logged as a Pino warn breadcrumb; the loop does not retry the LLM call — if the LLM emits a bad shape, the next turn will see the same prompt and likely produce a valid shape." Step 8 sub-clause 4 echoes this. But the route still has to return SOMETHING to the UI on Zod failure for the current turn — what does it return? Three options, pick one and document it:

   - (a) Return HTTP 500 with `error: 'Phase 2 response shape invalid'`. UI shows generic error. User must re-send. (Bad — strands the loop.)
   - (b) Pass through the (invalid) parsed payload as a degraded `phase2_question` rendering, expecting the LLM to self-correct next turn. Loop iteration counter still advances (cap eventually fires). (Best — keeps loop alive.)
   - (c) Fabricate a synthetic "Could you clarify that?" question server-side. (No — adds plugin-specific phrasing logic.)

   My recommendation: **(b) with an additional small belt-and-braces — if the parsed payload has neither `question` nor `phase2_done`, the controller treats this turn as `cap_advance_only` (iteration_count++, no UI question), and lets the next round-trip recover.** The controller's existing cap will fire naturally if the LLM never recovers. Make this explicit in Step 7's loop controller spec and Step 8's "On Zod failure" branch.

3. **[workplan Step 7] — Disclosure banner copy needs review-locking** — Priority: Low

   Step 7 says "Disclosure banner copy lives here too — only one banner string (for `cap_hit`)." Good. The requirement FR5.13 prescribes the copy: `"Proceeding with what we have — you can refine after the agent is created."` Make sure this exact string is the constant in the loop controller (not paraphrased by Dev), so the grep-gate FR8 acceptance criterion ("the string '10' never appears") and downstream QA can verify against a known fixture.

4. **[workplan Step 9] — `processMessageInThread` signature widens — verify all existing callers still compile** — Priority: Medium

   `useThreadManagement.ts:101-108` currently has six positional parameters (`phase, userPrompt, clarificationAnswers, userContext, connectedServices, metadata`). Step 9 says "add `phase2UserAnswer?: string` parameter". Adding a 7th positional parameter is awkward and brittle — and existing callers at `useConversationalFlow.ts:126, 454, 644` already pass 4 / 5 / 6 positional args. **Strongly prefer: change the trailing args to a single options object** `processMessageInThread(phase, userPrompt, options?: { clarificationAnswers?, userContext?, connectedServices?, metadata?, phase2UserAnswer? })`. This is a touch larger refactor but eliminates positional-arg ordering hazards (which exactly match the class of bug R3 hit). If Dev pushes back on the refactor scope, an acceptable alternative is a 7th positional arg with a clear comment, BUT all three existing callsites must be updated in the same diff and a Jest snapshot test added. Pick one explicitly in the workplan before coding — don't decide in-flight.

5. **[workplan Step 4] — Grep gate is missing `docs/` scope and the `.env.example` file** — Priority: Low

   Step 4's grep at line 122 covers `app components lib` with `.ts*` extensions. But `docs/FEATURE_FLAGS.md` (which Step 4 also modifies) won't be caught, and any `.env.example`/`.env.sample` mentioning the flag won't either. **Suggested fix:** extend the grep to `grep -rn "useNewAgentCreationUI\|NEXT_PUBLIC_USE_NEW_AGENT_CREATION_UI" app components lib docs hooks --include="*.ts" --include="*.tsx" --include="*.md" --include="*.example" --include="*.sample"` and call out that `docs/archive/` and `.claude/worktrees/` hits are expected and may remain.

6. **[workplan Step 1 / Step 9] — Empty-input guard is ALREADY in place; reframe as "verify" not "add"** — Priority: Low

   I read `components/agent-creation/conversational/components/ChatInput.tsx` directly: line 54 already has `disabled={!value.trim() || disabled}` AND line 11 already has `if (!value.trim() || disabled) return;` in `handleSubmit`. The empty-input guard is already correct in the V2 chat input. Step 1's "Locate the V2 chat input component" task and Step 9's "Empty-input guard" bullet should be reframed from "add if missing" to "**confirm in the workplan that `ChatInput.tsx:54` already has the guard, no code change required**". The Step 10 smoke matrix scenario 3 still applies as a confirmation.

7. **[requirement FR6 + workplan Step 6] — Done-keyword detector has subtle false-positive risk** — Priority: Low

   The keyword list contains `'done'` as a standalone single word — flagged in the workplan comment ("most ambiguous"). A user answering Q1 of "How should the agent notify you?" with "let me know once it's done processing each batch" would trigger `isDoneIntent → true` because `.includes('done')` is substring-only. **Suggested fix:** for the single-word `'done'` only, use a word-boundary check (`/\bdone\b/i.test(normalized)` and exclude common interjection contexts like "once it's done", "when it's done") — or drop `'done'` from the list entirely since `'build it'`, `'that's enough'`, `'proceed'`, `'go ahead'`, `'move forward'`, `'ship it'`, `'lets build'`, `'i'm ready'` already cover the user-intent space. **Trade-off:** dropping `'done'` is the simpler, safer fix and one false negative (user types just "done", gets next question instead of termination) is much less harmful than one false positive (user mid-sentence containing "done" prematurely terminates Phase 2). Either way, make the test suite cover this exact "let me know once it's done processing each batch" string as a negative case.

8. **[workplan Step 2] — Pre-archive sanity check** — Priority: Low

   Step 2 moves `V2_AGENT_CREATION_R2_PROMPT_TONE_DOWN_REQUIREMENT.md` and `V2_AGENT_CREATION_R3_SINGLE_QUESTION_MODE_REQUIREMENT.md` to `archive/`. I confirmed both files exist on disk. But `V2_AGENT_CREATION_R1_PHASE4_CLEANUP_REQUIREMENT.md` is also present and Step 2 should NOT touch it (R1 is already shipped on `main` — kept for historical reference, not superseded by this requirement). Add an explicit "do not move R1" line to Step 2 to prevent over-zealous cleanup.

### Optimisation Suggestions (non-blocking)

- **OS-1:** Step 7's `phase2-loop-controller.ts` is described as a "pure state machine" — please make it genuinely pure (no `Date.now()`, no logging side-effects, no thread DB writes). Pure means caller passes in current state + input, controller returns `{ next_state, decision }`. Keep all I/O (Pino log, thread metadata write) in the route handler. This makes the controller trivially unit-testable and matches the rest of `lib/agent-creation/`. The workplan implies this but doesn't say it explicitly.

- **OS-2:** Step 11's regression scenario fixture: please name the JSON files exactly as the V6 scenario template prescribes (`scenario.json`, `intent-contract.json`, `enhanced-prompt.json`, `phase4-pilot-dsl-steps.json`, `phase4-workflow-config.json`) and set `_skip: true` on the four non-Phase-2 files. The workplan says this but didn't show the exact filenames — they vary across the codebase (some scenarios use `phase2.json`, some use `phase4-workflow-config.json`). Lock the names in the workplan to match `tests/v6-regression/scenarios/*/scenario.json` convention.

- **OS-3:** Consider exposing `iteration_count` in the response body on the terminating turn (debug-only). Not user-facing, but useful in browser devtools during Step 10's smoke matrix walkthrough. Trivial cost. Marked debug to make clear it's not for UI rendering.

- **OS-4:** The risk register row for "wrong UI hook" notes Step 9 (smoke matrix) catches what Step 1 misses. Worth also noting that **Step 4's `AgentBuilderParent.tsx` hardcode is what makes Step 9 catch it** — without the hardcode there are still two paths and the smoke matrix could pass through the wrong one. Tighten the risk-register row to mention Step 4 as the structural fix and Step 9 as the verification.

- **OS-5:** `useThreadManagement.ts` lines 18-50 define LOCAL interfaces `ProcessMessageRequest` and `ProcessMessageResponse` that shadow the exported ones in `components/agent-creation/types/agent-prompt-threads.ts`. Step 9 extends the latter but Dev will probably also need to extend the former (or, better, delete the local interfaces and import from the shared module). Flag this in Step 9.

### Process-guardrail assessment

The five Process Guardrails in the requirement (Step 1 live audit / parsedJson snapshot / smoke matrix / no flags / v15 logic preserved) are the right gates. Two small additions worth considering:

- **PG-6 (suggestion):** Add a guardrail that the workplan's Step 10 smoke-matrix evidence must be **timestamped + correlation-ID-annotated**, so SA can trace each row back to the Pino log in `dev.log`. This is a 1-line change to Step 12.
- **PG-7 (suggestion):** Add to the requirement's Out of Scope list: "altering the `processMessageInThread` signature in a way that breaks Phase 1 or Phase 3 callers". Step 9's signature widening (Comment 4) is in-scope but the constraint that it preserves Phase 1/3 behavior should be explicit. This is the kind of latent breakage that R3 was famous for.

### Showstoppers

**None.** Comments 1, 2, and 4 are must-resolve-before-coding because they're route/contract correctness issues, but each has a clear path forward and the workplan can be updated in a single editing pass (no new design work). Comments 5, 6, 7, 8 and all OS items are quick textual edits.

### Approval

- [x] Workplan approved to proceed to implementation **after Comments 1, 2, and 4 are addressed in the workplan body** (Medium-priority items). Comments 3, 5, 6, 7, 8 are nice-to-have but acceptable to roll into the implementation diffs as long as the smoke matrix proves them out. SA does NOT need a re-review of the updated workplan before Dev starts — TL can sign off on the three Medium-priority text edits directly.

### Suggested edits to the requirement MD (cross-referenced from workplan)

These are minor wording tightenings to the requirement, not behavioural changes. If user agrees, BA can apply them:

- **FR4.11**: append "On Zod failure the route returns the parsed payload as-is in degraded form (iteration_count still advances), and the cap will eventually fire if the LLM never recovers." (matches Comment 2 resolution path b)
- **FR6.15**: append "The `'done'` single-word keyword uses `\bdone\b` word-boundary matching to avoid substring false-positives on phrases like 'once it's done processing'." (matches Comment 7)
- **Out of Scope**: add bullet "Altering the `processMessageInThread` signature in a way that breaks Phase 1 or Phase 3 callers." (matches PG-7)
- **Process Guardrails**: append guardrail #6 — smoke matrix evidence must include timestamps and correlation IDs that resolve back to `dev.log`. (matches PG-6)


## SA Code Review (post-implementation) — 2026-05-29

**Verdict: Approved-with-fixes.** The feature is correct, well-scoped, and standards-compliant. All findings below are Medium/Low — none block the cycle. Safe to commit after the two Medium items are either fixed or explicitly accepted by TL/user. The 75 unit tests + live smoke matrix did their job; the structural fixes (snapshot-before-mutation, pure controller, qId keying, F1 ref) are all sound.

### What I verified independently

- **v16 Phase 3 divergence audit (the most important gate):** `diff v15 v16` confirms the ONLY Phase 3 differences are the two declared, justified ones — (a) mandatory `processing_steps` (prompt line 421 + General-Constraints item 12) and (b) the `RESPONSE SHAPE (critical)` reinforcement (line 416-417). No other Phase 3 drift. The audience banner (Insert A) and the E1 single-question context-authority note are in non-Phase-3 sections. **Clean — no unauthorized Phase 3 changes.**
- **Loop controller purity:** `lib/agent-creation/phase2-loop-controller.ts` `step()` is genuinely pure — no `Date.now()`, no logging, no IO; it does not mutate `input.state` (builds a fresh `next_state`). All side effects (Pino log, thread persist) live in the route. Confirmed.
- **Cap precedence:** cap check runs first and fires regardless of `payload_valid` or LLM output. Both termination reasons reachable. Degraded passthrough still advances `iteration_count` so the cap eventually fires. Correct.
- **Tests:** re-ran the 3 Phase 2 suites — 69/69 pass (schema 23, done-detector, controller). `tsc --noEmit` shows ZERO errors in any touched file.
- **No R3/v17/flag artifacts** in this branch's source: no `phase2-v17-schema`, no `phase2-intent-classifier`, no `USE_PHASE2_SINGLE_QUESTION_MODE`. (The `r3-*` scenarios / `v17` files in the session-start git snapshot belong to a different branch and are absent here.)
- **Standards:** Zod `.strict()` at the Phase 2 boundary (validated on the pre-mutation snapshot ✅); structured Pino via `requestLogger = logger.child({ correlationId })` so the single termination log inherits `correlationId` ✅; thread access via repository ✅ (the module-scope `createClient` at route line 31 is pre-existing, for `AIAnalyticsService` only, not introduced here); no hardcoded model names (done-detector is keyword-only) ✅.

### Findings — High

_None._

### Findings — Medium

1. **`app/api/agent-creation/process-message/route.ts:707` — Phase 3 corrective-retry uses `messages: [...conversationMessages, correctiveTurn]` but the corrective turn is never persisted to the OpenAI thread; the *bad* assistant message IS still in the thread.** On the retry the model sees: [...history including the bad Phase-2-shaped assistant reply] + a one-off user nudge. That's the intended design and it worked in the live test. But note an asymmetry: when the retry *succeeds* you `addMessageToThread(assistant, retryText)` (line 735) yet you do NOT add the `correctiveTurn` user message, so the thread now has `assistant(bad-question) → assistant(good-phase3)` with no intervening user turn — a malformed turn sequence that a *subsequent* mini-cycle/refine call will replay. **Suggested fix:** either (a) also persist the `correctiveTurn` user message before the assistant retry text, or (b) leave a one-line comment documenting that the bad assistant turn is intentionally left in the thread and the sequence anomaly is tolerated because Phase 3 is terminal (`newStatus = 'completed'`). Low blast radius given Phase 3 completes the thread, but document the intent.

2. **`lib/agent-creation/phase2-loop-controller.ts:160` — cap is reached on the 10th LLM round-trip, so the 10th LLM call still fires and its result is discarded.** When `iteration_count === 9`, the route makes the LLM call (the request is sent *before* `step()` runs), the LLM returns Q10, then `step()` computes `nextIteration = 10 >= MAX_ITERATIONS` and replaces it with `cap_hit`. Net: worst case = **10** LLM round-trips with the 10th wasted, and 9 questions surfaced. FR5.12 says "**< 10** LLM round-trips." This is a spec-literal off-by-one (a wasted call + token cost), not a safety bug — the loop always terminates. **Suggested fix (pick one):** (a) accept it and tighten FR5.12 wording to "at most 10 round-trips, max 9 questions surfaced"; or (b) change the guard to `nextIteration > MAX_ITERATIONS` / set `MAX_ITERATIONS = 9` only if you want the literal "< 10". Recommend (a) — the current behavior is safe and the test suite already locks `>= MAX_ITERATIONS`. Either way, reconcile the code comment ("terminates on the 10th iteration") with FR5.12's "< 10".

### Findings — Low

3. **`app/v2/agents/new/page.tsx:217-225` (degraded FR4.11 path) — stale option buttons remain visible on a degraded turn.** When the backend passes through a payload with neither `question` nor `phase2_done`, the page shows a "could you rephrase…" message and sets `phase2AwaitingAnswer = true`, but it does NOT clear the previous turn's single-question `questionsSequence`. Because the option-button render gate is `length === 1 ? phase2AwaitingAnswer : …`, the *prior* question's option buttons stay rendered and clickable beside the rephrase prompt. **Suggested fix:** on the degraded branch, `setQuestionsSequence([])` (or set `currentQuestionIndex: -1`) before the rephrase message so only the free-text input is offered. Degraded turns are rare (Zod failure), so Low.

4. **`app/v2/agents/new/page.tsx:171` — mini-cycle `phase2_done` with `refiningPlan === true` but `pendingEnhancedPrompt === null` silently regenerates from scratch.** The `user_feedback`-only edit flow (no `enhanced_prompt`) sets `isInMiniCycle` but may leave `pendingEnhancedPrompt` null; on `phase2_done` it falls to the `else` and calls `processPhase3(tid)` (regenerate) instead of refine. This matches the pre-existing batch fallback, so it's not a new regression — but the comment block (lines 171-186) implies refine is guaranteed when `refiningPlan`. **Suggested fix:** add a one-line comment that the `else` is the intentional regenerate fallback when no pending prompt exists, so a future reader doesn't treat it as a bug.

5. **`app/api/agent-creation/process-message/route.ts:707-714` — `retryParams: any` / `retryErr: any`.** Consistent with the pre-existing `completionParams: any` at line 571, so not a *new* anti-pattern, but neither is typed. Non-blocking; if the provider exposes a params type, prefer it. (Pre-existing debt — out of scope to fix here.)

6. **`app/v2/agents/new/page.tsx:362` — `pendingEnhancedPrompt: any`.** Pre-existing page convention (the page treats `EnhancedPrompt` as `any` throughout); not introduced by this feature. Noted only for completeness.

### Optimisation Suggestions (non-blocking)

- The E1 mid-loop context omission keys off `phase2_user_answer !== undefined && !== null`. The page always sends `phase2_user_answer: options?.phase2_user_answer ?? null` (page line ~714), so the *first* Phase 2 turn correctly sends `null` → heavy context included; mid-loop sends the answer string → omitted. Logic is correct, but it's load-bearing and implicit — a one-line invariant comment ("first turn ⇒ phase2_user_answer is null") at the route's `isMidLoopPhase2Turn` would harden it against a future page change that defaults the field differently.
- E3 (move `inline_hint` to client `thinking-words`) is correctly deferred; the current server-side `inline_hint` path is harmless and FR-compliant. No action needed this cycle.

### Code Approved for QA: Yes

The two Medium items are documentation/spec-reconciliation in nature (item 1 = comment or persist-symmetry; item 2 = spec wording vs a wasted call). Neither is a correctness or security defect. **Safe to commit.** Recommend TL accept items 1 & 2 as-is or apply the trivial fixes, then proceed to QA regression.

### Resolution (2026-05-29) — applied fixes (chose to fix, not just accept)

- **Medium 1 (retry thread symmetry) — FIXED** in [process-message/route.ts](app/api/agent-creation/process-message/route.ts). On a successful Phase 3 corrective retry the route now persists the corrective USER turn to the thread *before* the good assistant reply, so the sequence is `…→ assistant[bad] → user[corrective] → assistant[good]` (no two-consecutive-assistant anomaly for a later mini-cycle replay). Inaccurate "Replace the bad message" comment corrected.
- **Medium 2 (cap off-by-one / FR5.12) — FIXED** by enforcing the cap **PRE-CALL** in the route, merged into the existing done-keyword short-circuit (`if (phase === 2) { … capReachedPreCall || doneKeywordHit … }`). Once `MAX_ITERATIONS - 1` round-trips are done the route terminates `cap_hit` BEFORE making another LLM completion → true worst case is now **9 round-trips / 9 questions**, honoring FR5.12's "< 10" literally (no wasted 10th call, ~$0.07 saved per cap-fire). Cap takes precedence over the done-keyword. The loop controller's post-call `step()` cap is retained as a backstop (and is what the controller unit tests still exercise); its docstring was updated to say so.
- **Low 3 (stale option buttons on degraded turn) — FIXED** in [app/v2/agents/new/page.tsx](app/v2/agents/new/page.tsx): the FR4.11 degraded branch now `setQuestionsSequence([])` before the rephrase prompt, so the prior question's option buttons don't stay clickable.
- **Low 4 (regenerate-fallback) & E1-invariant optimisation — DOCUMENTED** with clarifying comments (page mini-cycle `else`; route `isMidLoopPhase2Turn`).
- **Low 5 & 6 (`any` types) — NOT changed**: pre-existing debt, out of scope per SA.
- **Verification:** `tsc --noEmit` zero errors in all edited files; 75/75 Phase 2 unit tests pass.

---

## QA Testing Report

_(QA writes here at QA pass time.)_

## Commit Info

_(RM writes here at merge time.)_
