# Workplan: V2 Agent Creation — Phase 2 Single-Question Mode for Non-Technical Users

**Developer:** Dev
**Requirement:** [V2_AGENT_CREATION_PHASE2_SINGLE_QUESTION_REQUIREMENT.md](/docs/requirements/V2_AGENT_CREATION_PHASE2_SINGLE_QUESTION_REQUIREMENT.md)
**Date:** 2026-05-27
**Branch:** `feature/v2-agent-creation-r2r3-toned-single-question` (created from baseline `a5a7971`)
**Status:** Approved — SA review passed (2026-05-27) with revisions applied; ready for Dev implementation

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
| `components/agent-creation/conversational/hooks/useConversationalFlow.ts` | modify | Phase 2 branch rewritten for per-turn round-trips. Each user reply fires `processMessageInThread(2, ..., { phase2_user_answer })`. Renders one question per iteration. |
| `components/agent-creation/conversational/hooks/useThreadManagement.ts` | modify | Add `phase2UserAnswer?: string` parameter to `processMessageInThread()`; forward to API |
| `components/agent-creation/conversational/components/messages/Phase2DisclosureBanner.tsx` | **create** | Soft banner for the `cap_hit` terminal path. |
| `components/agent-creation/conversational/components/messages/AIMessage.tsx` | modify | Two new `messageType` branches: `phase2_question` and `phase2_disclosure_banner` |
| `components/agent-creation/conversational/types.ts` | modify | Extend `messageType` union with the two new values |
| `components/agent-creation/types/agent-prompt-threads.ts` | modify | Add response fields (`question`, `phase2_done`, `inline_hint`, `disclosure_banner`, `termination_reason`) to `ProcessMessageResponse`; add `phase2_user_answer` to `ProcessMessageRequest` |
| Chat input component (V2 UI) | modify | Verify (or add) `disabled` on send button when input is empty/whitespace-only. Path identified at Step 1. |
| `components/agent-creation/AgentBuilderParent.tsx` | modify | Hardcode V2 conversational builder. Remove `useNewAgentCreationUI()` import + call. |
| `lib/utils/featureFlags.ts` | modify | Delete `useNewAgentCreationUI()` helper; remove from `getFeatureFlags()` |
| `docs/FEATURE_FLAGS.md` | modify | Remove `NEXT_PUBLIC_USE_NEW_AGENT_CREATION_UI` table row + section |
| `CLAUDE.md` | modify | Remove the row referencing `NEXT_PUBLIC_USE_NEW_AGENT_CREATION_UI` from the Feature Flags table |
| `docs/requirements/archive/` | **move** | Move prior Phase 2 prompt-related requirement MDs here |
| `tests/v6-regression/scenarios/phase2-single-question-v2ui-pipeline-a/` | **create** | One phase-2-only scenario covering happy path + explicit "build it" variants |

### V6 / Plugin work? No.

This workplan does NOT touch `lib/agentkit/v6/`, `lib/pilot/`, `lib/plugins/`, `lib/server/`. No V6 docs need updating.

---

## Risk register

| Risk | Mitigation |
|---|---|
| **Wrong UI hook gets wired** | Step 1 (live audit) confirms current selection logic. **Step 4 is the structural fix** — `AgentBuilderParent.tsx` is hardcoded so there's only one path. Step 10 (live smoke matrix) is the verification that the hardcoded path actually renders. Without Step 4, Step 10 could pass through the wrong path; without Step 10, Step 4 could miss a latent regression. Both layers required (SA OS-4). |
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
- [ ] Confirm current branch: `git branch --show-current` → `feature/v2-agent-creation-r2r3-toned-single-question`
- [ ] Confirm HEAD: `git log --oneline -1` → `a5a7971`
- [ ] Confirm only the v15 prompt is present: `ls app/api/prompt-templates/Workflow-Agent-Creation-Prompt-*.txt` shows v15 only
- [ ] Read `.env.local` → confirm no `NEXT_PUBLIC_USE_PHASE2_SINGLE_QUESTION_MODE` line and no `NEXT_PUBLIC_USE_NEW_AGENT_CREATION_UI` line. If either exists, **stop and ask the user to remove them and restart the dev server** before continuing.
- [ ] Open `components/agent-creation/AgentBuilderParent.tsx` and note the current selection logic around the `useNewAgentCreationUI()` call (around line 507). Record the line numbers for Step 4.
- [ ] **Locate the V2 chat input component** that owns the "send" button — trace from `ConversationalAgentBuilderV2` through `useConversationalFlow.ts` to find the actual input element. Record the file path and current `disabled`-prop logic for Step 9.
- [ ] Document the audit findings as a sub-section at the top of this workplan ("Step 1 — audit results") before moving on.

### Step 2 — Archive the superseded requirement MDs
- [ ] `mkdir -p docs/requirements/archive`
- [ ] `git mv docs/requirements/V2_AGENT_CREATION_R2_PROMPT_TONE_DOWN_REQUIREMENT.md docs/requirements/archive/`
- [ ] `git mv docs/requirements/V2_AGENT_CREATION_R3_SINGLE_QUESTION_MODE_REQUIREMENT.md docs/requirements/archive/`
- [ ] Prepend a 1-line header to each archived file: `> **Status:** Superseded by [V2_AGENT_CREATION_PHASE2_SINGLE_QUESTION_REQUIREMENT.md](/docs/requirements/V2_AGENT_CREATION_PHASE2_SINGLE_QUESTION_REQUIREMENT.md). Kept for historical reference.`
- [ ] **DO NOT move** `V2_AGENT_CREATION_R1_PHASE4_CLEANUP_REQUIREMENT.md` (SA Comment 8) — R1 is already shipped on `main` and the requirement MD is kept for historical reference, not superseded by this work.

> The references to those filenames are unavoidable here — they're the actual on-disk filenames being moved. After this step, neither name appears in active requirements.

### Step 3 — Create v16 prompt (minimal diff from v15)

This step is deliberately constrained. `v16` is `v15` plus exactly two named inserts. NOTHING else changes.

- [ ] `cp app/api/prompt-templates/Workflow-Agent-Creation-Prompt-v15-chatgpt.txt app/api/prompt-templates/Workflow-Agent-Creation-Prompt-v16-chatgpt.txt`
- [ ] **Insert A — audience banner** (top of file, before the first existing section): a short block stating the end-user is non-technical, prefer inference and sensible defaults, avoid jargon, ask about outcomes (not implementation).
- [ ] **Insert B — interaction-process block** (inside the Phase 2 section, replacing v15's batch-output framing): instructs the LLM to emit ONE question per response, pick the next-highest-priority question per v15's existing rules, and emit the response contract:
   ```json
   { "question": "string | null", "phase2_done": boolean }
   ```
   with `phase2_done: true` requiring `question: null`. Replaces v15's `questionsSequence[]` example output with two short single-question examples (one mid-loop, one terminal).
- [ ] **Sanity-grep — `cp` integrity.** After Insert A and Insert B, run:
   ```
   diff app/api/prompt-templates/Workflow-Agent-Creation-Prompt-v15-chatgpt.txt \
        app/api/prompt-templates/Workflow-Agent-Creation-Prompt-v16-chatgpt.txt | head -100
   ```
   The diff should ONLY show the audience banner addition and the Phase 2 interaction-block change. No other sections (priority, behavior rules, enumeration, failure-handling, theme coverage, etc.) should differ.
- [ ] **Sanity-grep — no scope creep.** v16 must NOT introduce strings like `strict allowlist`, `Carve-out priority`, `narrowed enumeration rule`, `DETERMINISTIC FAILURE-SKIP GATE`, `catch-all`, `iteration 9`, etc. unless those strings ALREADY existed verbatim in v15.
- [ ] **Sanity-grep — no batch-shape leaks.** v16 must NOT contain `questionsSequence[]` (or `questionsSequence: []`) as the documented output shape. The output shape in v16 is the new contract.
- [ ] Size check: v16 line count is within ±5% of v15 (small additive change).

### Step 4 — Remove the V2 UI feature flag
- [ ] Open `components/agent-creation/AgentBuilderParent.tsx`. Remove the `import { useNewAgentCreationUI } from '@/lib/utils/featureFlags';` line. Remove the `const useNewUI = useNewAgentCreationUI();` line. Hardcode the chat-creation path to render `ConversationalAgentBuilderV2` (collapse the existing ternary).
- [ ] Open `lib/utils/featureFlags.ts`. Delete `useNewAgentCreationUI()` (and its `console.log` line). Delete its entry from `getFeatureFlags()`.
- [ ] Open `docs/FEATURE_FLAGS.md`. Delete the `NEXT_PUBLIC_USE_NEW_AGENT_CREATION_UI` table row and its dedicated section.
- [ ] Open `CLAUDE.md`. Delete the `NEXT_PUBLIC_USE_NEW_AGENT_CREATION_UI` row from the Feature Flags table near line 510.
- [ ] Run `grep -rn "useNewAgentCreationUI\|NEXT_PUBLIC_USE_NEW_AGENT_CREATION_UI" app components lib docs hooks --include="*.ts" --include="*.tsx" --include="*.md" --include="*.example" --include="*.sample"` — must return ZERO production hits. Hits in `docs/archive/`, `.claude/worktrees/`, archived `CLAUDE_*` files, and `docs/archive/CONVERSATIONAL_UI_V2_IMPLEMENTATION_PLAN.md` are expected and remain (historical context).
- [ ] `npx tsc --noEmit` clean for the modified files.

### Step 5 — Zod schema + tests
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

### Step 6 — Done-keyword detector + tests
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

### Step 7 — Loop controller + tests
- Create `lib/agent-creation/phase2-loop-controller.ts` with `step(input): StepResult`.
- `TerminationReason` enum (string-literal union): `'phase2_done' | 'cap_hit'`.
- Cap behavior: at iteration 10, regardless of LLM output, the controller terminates with `cap_hit` and a soft disclosure banner. The LLM is never told about the cap; the cap is purely server-side defensive infra.
- Both reasons reachable in unit tests.
- Inline-hint phrasing exported as a fixed list (3 generic phrases, cycled by iteration). Disclosure banner copy lives here too — exactly one banner string for `cap_hit`, defined as a `const DISCLOSURE_BANNER = "Proceeding with what we have — you can refine after the agent is created."` so the grep-gate FR8 acceptance criterion and downstream QA can verify against a known fixture (SA Comment 3).
- **The controller MUST be pure** (SA OS-1): caller passes current state + input, controller returns `{ next_state, decision }`. NO `Date.now()`, NO logging side-effects, NO thread DB writes. All I/O (Pino logs, thread metadata writes) lives in the route handler.
- **Degraded-payload handling** (SA Comment 2): the controller accepts a `payload_valid: boolean` input. When `false`, it advances `iteration_count` and returns a `decision: 'pass_through_degraded'` so the route can return the parsed-but-invalid payload as-is without fabricating content. If `iteration_count` reaches the cap on this path, fires `cap_hit` normally.

### Step 8 — Route wiring (with the parsedJson-mutation fix and the done-keyword short-circuit)
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

### Step 9 — UI wiring (per-turn round-trips + empty-input guard)
- `components/agent-creation/types/agent-prompt-threads.ts`: add `phase2_user_answer` to `ProcessMessageRequest`; add `question`, `phase2_done`, `inline_hint`, `disclosure_banner`, `termination_reason` to `ProcessMessageResponse`. All TypeScript symbols use **no version number**.
- `useThreadManagement.ts` — **refactor `processMessageInThread()` from positional trailing args to a single options object** (SA Comment 4). New signature:
  ```ts
  processMessageInThread(
    phase: 1 | 2 | 3,
    userPrompt: string,
    options?: {
      clarificationAnswers?: Record<string, string>;
      userContext?: { full_name?: string; email?: string };
      connectedServices?: string[];
      metadata?: { declined_plugins?: string[]; [key: string]: any };
      phase2UserAnswer?: string;
    }
  ): Promise<ProcessMessageResponse>;
  ```
  All three existing callers in `useConversationalFlow.ts` (at lines 126, 454, 644 per SA findings) MUST be updated to use the options shape in the SAME diff. This is a small extra refactor but eliminates the positional-arg ordering hazard that was R3's exact class of bug. Forward `phase2UserAnswer` as `phase2_user_answer` in the request body.
- Also **delete the local `ProcessMessageRequest` / `ProcessMessageResponse` interfaces** at `useThreadManagement.ts:18-50` and import from the shared `components/agent-creation/types/agent-prompt-threads.ts` instead — they currently shadow the shared types and Step 9's field additions would otherwise need to be made in two places.
- `useConversationalFlow.ts` Phase 2 branch:
  - Detect by presence of `phase2_done` field on response.
  - `phase2_done === true`: if `disclosure_banner` present, render it; transition to Phase 3.
  - `phase2_done === false && question`: render one chat bubble with `messageType: 'phase2_question'`, attach `inline_hint`. Wait for the user's next message.
  - **Degraded-response handling** (Step 8 sub-clause 4): if the response has neither `question` nor `phase2_done` (Zod-failure passthrough), render a placeholder "Thinking..." bubble and let the next user turn re-trigger the LLM. The controller has already incremented `iteration_count`, so cap will eventually fire if the LLM keeps emitting garbage.
  - When the user replies mid-loop, fire `processMessageInThread(2, prompt, { phase2UserAnswer })` and recurse. Re-uses the existing send-message flow.
- Create `Phase2DisclosureBanner.tsx` — small presentational component, `bannerText: string` prop, uses existing design tokens.
- `AIMessage.tsx`: add the two new `messageType` branches: `phase2_question` and `phase2_disclosure_banner`.
- `components/agent-creation/conversational/types.ts`: extend the `messageType` union.
- **Empty-input guard**: ALREADY in place at `components/agent-creation/conversational/components/ChatInput.tsx:54` (`disabled={!value.trim() || disabled}`) per SA Comment 6. **No code change required.** Step 10 smoke matrix scenario 3 is the verification.
- **Grep gate** before declaring step done: `grep -rn "10" components/agent-creation/conversational/components/messages/Phase2DisclosureBanner.tsx components/agent-creation/conversational/hooks/useConversationalFlow.ts` — only token-budget / index references allowed; the hard cap must not appear in copy.

### Step 10 — Mandatory live dev-server smoke matrix ⚠️ **gate to Code Complete**

Dev runs the dev server LOCALLY and walks through Phase 2 in a browser. **All rows must be PASS before this step can be marked complete.**

Setup checklist (do once, before scenarios):
- [ ] `.env.local` has no `NEXT_PUBLIC_USE_PHASE2_SINGLE_QUESTION_MODE` and no `NEXT_PUBLIC_USE_NEW_AGENT_CREATION_UI` entries
- [ ] `npm run dev` is running
- [ ] Browser console open
- [ ] Filter `dev.log` for `correlationId` to track each request

| # | Scenario | Steps | Expected | Captured |
|---|---|---|---|---|
| 1 | **Happy path** | Type "Summarize my last 10 Gmail emails and email me a recap." Answer each question normally. | After a small number of turns (typically 2–4), API returns `phase2_done: true`. Phase 3 fires. Pino log: `termination_reason: phase2_done`. | _Dev pastes actual rendered questions + final response JSON_ |
| 2 | **Explicit "build it"** | Type a simple prompt. Answer Q1 normally. At Q2, type "build it". | Phase 2 terminates immediately. **No LLM call fires on this turn** (verify in dev.log — no `Chat completion received` line for this correlation ID). Phase 3 starts. Pino log: `termination_reason: phase2_done`. | _Dev pastes the conversation transcript + verifies no LLM call for the terminating turn_ |
| 3 | **Empty-input guard** | In the chat input, with no content typed, try to click the send button. | Send button is `disabled`; nothing happens. No request fires. | _Dev confirms the button is visibly disabled_ |

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


## QA Testing Report

_(QA writes here at QA pass time.)_

## Commit Info

_(RM writes here at merge time.)_
