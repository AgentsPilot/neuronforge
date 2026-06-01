---
name: agent-creation-flow
description: Loads the architecture + constraint context for the V2 thread-based agent-creation flow at /v2/agents/new — Phase 1 (diagnostic narrative), Phase 2 (single-question loop), Phase 3 (enhanced prompt) — and the v16 prompt template that drives them. Use whenever the user asks to add, change, debug, or extend ANYTHING in the new agent-creation flow: page UI, the process-message API route, the v16 prompt, the Phase 2/3 Zod schemas, telemetry, hints/opening, the running question number, the create-agent route, or the handoff into the V6 IntentContract generation pipeline. The V6 IntentContract pipeline itself is OUT OF SCOPE here (its own skill, not yet built). Cycle-specific workplans/requirements live in `docs/workplans/` and `docs/requirements/` — they're not loaded here; this skill captures the durable architecture + constraints, not any one cycle's audit trail.
---

# agent-creation-flow

Load this context **before** writing or changing code that touches the V2 thread-based agent-creation flow. It's the durable source of truth for what the flow does today, where each piece lives, and what must not be broken — independent of which cycle's workplan introduced each piece.

> **First read**: `docs/V2_Thread-Based-Agent-Creation-Flow.md` — the canonical architectural overview with the end-to-end diagram, API call sequence, state-variable tables, and the testing checklist. Kept up-to-date alongside this skill. **This skill assumes you've read it (or are about to).**

> The user's primary entry point is **`/v2/agents/new`** — served by **`app/v2/agents/new/page.tsx`**. Other agent-creation surfaces (`components/agent-creation/conversational/`, legacy `useConversationalBuilder.ts`, `/agents/new/chat`) are **deprecated** (marked `@deprecated`) — do not modify them in this flow; do not copy their patterns.

---

## 1. The flow at a glance

```
User prompt
   ↓
Phase 1 — Diagnostic narrative          (one LLM call)
   ↓
Phase 2 — Single-question loop          (N LLM calls, one question per turn)
   ↓                                     up to 10 questions per session, server-side cap
   ↓                                     mini-cycles allowed (Phase 3 → user_inputs_required → back into Phase 2)
Phase 3 — Enhanced prompt               (one LLM call, plus optional E2 corrective retry)
   ↓
User reviews "Your Agent Plan" + "Agent Draft" cards, clicks Approve
   ↓
V6 IntentContract pipeline              ← SEPARATE SKILL (NOT YET BUILT). Do not touch /api/v6/* from this skill.
   ↓
/api/create-agent                       (E9: now also inline-saves agent_configurations)
   ↓
router.push(`/agents/${id}`)            (300 ms timer after success message)
```

**Phase 2 is the centre of gravity** — it's where the recent feature cycle landed most of its work. Every change here is governed by FR4 (strict contract), FR5 (cap), FR7 (UX), FR8 (telemetry). See § 4.

---

## 2. Source-of-truth files

**Code:**

| File | What |
|---|---|
| `app/v2/agents/new/page.tsx` | The PRIMARY UI surface. Renders messages, drives `processPhase1` → `processPhase2` → `processPhase3` → `executeAgentCreation`. Holds the answer/hint/Q# refs. |
| `app/api/agent-creation/process-message/route.ts` | The phase-routing API. Builds the userMessage per phase, calls OpenAI, validates, drives the Phase 2 loop controller, emits Pino logs. |
| `app/api/prompt-templates/Workflow-Agent-Creation-Prompt-v16-chatgpt.txt` | The active system prompt (v16). v16 = v15 + ONLY justified divergences (see § 4). Do NOT silently drift Phase 3 away from v15 without documenting why. |
| `lib/validation/phase2-schema.ts` | Strict Zod schema for Phase 2 responses (`{ question, phase2_done, ai_reasoning? }`). |
| `lib/validation/phase3-schema.ts` | Zod schema + normalizer for Phase 3 responses. |
| `lib/agent-creation/phase2-loop-controller.ts` | Pure state machine for the Phase 2 cap + termination. **No I/O — keep it pure.** |
| `lib/agent-creation/phase2-done-detector.ts` | Done-keyword short-circuit ("build it", "that's enough", etc.). |
| `app/api/create-agent/route.ts` | Final POST that inserts the agent + inline-saves `agent_configurations`. |
| `hooks/useAgentBuilderMessages.ts` | Message types + helpers (`addAIMessage`, `addAIQuestion`, etc.). |
| `lib/ui/thinking-words-dictionary.json` + `lib/ui/thinking-words-loader.ts` | `clarification_hints` category + `excludeFromGeneric` flag — the client-side hint copy lives here. |

**Architectural docs (durable, kept current):**

| File | What |
|---|---|
| `docs/V2_Thread-Based-Agent-Creation-Flow.md` | The canonical end-to-end diagram + state-variable tables + testing checklist. Read this FIRST. |
| `docs/THINKING_WORDS.md` | The dictionary + `excludeFromGeneric` flag — relevant when changing the `clarification_hints` category. |
| `CLAUDE.md` § Platform Design Principles | "No hardcoding in system prompts", "Fix at the root cause". |
| `docs/SYSTEM_LOGGING_GUIDELINES.md` | Pino + `correlationId` conventions for any new logs. |

**Cycle-specific docs (snapshots — not load-bearing):**

The flow has been built up by several requirement/workplan cycles (R1 Phase 4 cleanup, the Phase 2 single-question cycle, others). Each cycle has its own pair of MDs under `docs/requirements/` and `docs/workplans/`. These are **historical audit trails**, not the source of truth for current behaviour — the current behaviour is in § 4–6 of this skill plus the architectural doc above. If you're investigating *why* a specific piece exists, `grep -l` across `docs/workplans/` is faster than memorising filenames. If you're starting a NEW cycle of work, create a new requirement + workplan pair for it.

---

## 3. The Phase 2 single-question contract (FR4)

Per-turn response shape, server-side `.strict()` Zod:

```ts
{
  question: ClarificationQuestion | null,   // null iff phase2_done is true
  phase2_done: boolean,
  ai_reasoning?: string                     // 1–3 sentences (E6, server-side telemetry, NEVER returned to UI)
}
```

`ClarificationQuestion`:

```ts
{
  id: string,                               // GLOBALLY unique across the entire thread (E5 hard rule)
  question: string,
  type: 'select' | 'multi_select' | 'text', // EXACTLY these three — no email/number/etc.
  options?: [{ value, label, description? }],
  allowCustom?: boolean,
  theme?: 'Inputs' | 'Processing' | 'Outputs' | 'Delivery'
}
```

**Strict schema accepts ONLY** `question`, `phase2_done`, `ai_reasoning`. Adding a new top-level field requires: schema update + v16 carve-out + an FR4 amendment in the requirement.

---

## 4. Constraints any new code MUST respect

### From the FRs

- **FR5.12 — Cap is up to 10 questions inclusive, PER SESSION.** Mini-cycles get their own fresh budget (per-session reset, see F2). The hard cap is NEVER mentioned to the LLM or the user.
- **FR7.19a (E4) — Running "Question N" indicator is allowed.** Numerator only. Never "of M". The number is thread-wide and continues across mini-cycles (don't reset).
- **FR7.20 — No progress bar / no denominator / no cap reference.** Hints stay qualitative ("a few more"), never quantitative ("3 of 10").
- **FR8 — Telemetry: one Pino termination log per session + per-turn `Phase 2 turn decision` breadcrumb (E6).** `ai_reasoning` is server-side only. Don't return it to the UI.
- **FR9 — `/v2/agents/new` is the only UI surface in scope.** Don't refactor the legacy conversational builders; they're @deprecated.
- **FR10 — NO new feature flags.** The single-question behaviour is unconditional. Rollback is `git revert`.
- **FR12 — Live dev-server smoke test is MANDATORY** before declaring any change shipped. Source-inspection review alone has repeatedly missed UX bugs (the lesson from R2/R3 rollback).

### v16 prompt HARD RULES (E5 + OI1)

Located at the top of Phase 2 `### Behavior rules`. Any change to question-selection logic touches v16, NOT code:

1. **DO NOT RE-ASK A QUESTION ALREADY ANSWERED.** Scan the thread; if the user gave any answer for a topic (text, label/value match, any meaningful content) the topic is RESOLVED. No re-asking under any rewording or different qid.
2. **QUESTION ID UNIQUENESS — ENTIRE THREAD.** `id` must be unique across the whole run. Increment from the highest existing id; reusing one overwrites the prior answer in `clarification_answers` and confuses Phase 3.
3. **PACING & CONVERGENCE — STOP EARLY WHEN POSSIBLE.** Default bias is STOP. Only ask if the gap is essential AND cannot be sensibly defaulted. Target 3–6 questions for routine flows. Once core inputs are clear, emit `phase2_done: true`.

### Phase 3 contract (v16 = v15 + justified divergences)

v16's Phase 3 is byte-identical to v15 EXCEPT three deliberate, JUSTIFIED divergences. Do not silently add more. The three:

| Divergence | Why it stays |
|---|---|
| `processing_steps` REQUIRED (was optional in v15) | V6 pipeline crashes without it (see Side fix 2026-05-28) |
| `RESPONSE SHAPE (critical)` block at the top of Phase 3 | E2: prevents entrenchment — model sometimes returns a Phase-2-shaped payload on a phase:3 request after a long Phase 2; corrective retry handles the rest |
| Rule #9 "include conversationalSummary in every phase" carved out to exclude Phase 2 single-question turns | T2 — Phase 2 single-question is strict-only; the UI handles the framing client-side via the opening message |

If you find yourself adding a 4th Phase 3 divergence, **document why and update the workplan** — drift here has bitten us repeatedly.

---

## 5. Current behaviour — invariants any new code must NOT regress

The flow has accumulated a set of invariants through several cycles of work. Each row below is a current-behaviour fact you can rely on AND must not break. The labels (E1, F2, etc.) are stable references — if you need the full diagnosis of *why* something works the way it does, `grep` `docs/workplans/` for that label; the diagnosis is in whichever cycle's workplan introduced it.

| Ref | Current behaviour (do not regress) |
|---|---|
| **E1** | Mid-loop Phase 2 turns now OMIT the heavy `plugin_action_summary` + `connected_services` — they're already in the thread from Phase 1 + first Phase 2 turn. Drives O(N²) growth otherwise. |
| **E2** | Phase 3 entrenchment: after many Phase 2 turns the model would return a `{question, phase2_done}` payload on a phase:3 request. Two layers: (1) `RESPONSE SHAPE` v16 block; (2) corrective-retry turn in the route. |
| **E3 / E3.5** | Phase 2 inter-question hints moved to client-side `thinking-words` infra (new `clarification_hints` category, `excludeFromGeneric` loader flag). Rendered as **AI bubbles** (Bot icon), as lead-ins BEFORE the question, not as the old centred system pill. Resolves T2 (the missing opening message). |
| **E4** | Running "Question N" pill on each question bubble — numerator only, thread-wide running total (continues across mini-cycles, doesn't reset). State on the message via `questionNumber?: number` on the Message type. |
| **E5** | The two HARD RULES in v16 § 4 above — no re-asking; qID uniqueness across entire thread. |
| **E6** | `ai_reasoning` per-turn telemetry — required in v16, optional in schema (degraded-passthrough on miss), Pino `Phase 2 turn decision` breadcrumb in the route, **stripped from the client response**. |
| **E7** | `/api/process-message` Phase 3 calls now OMIT `plugin_action_summary` + `connected_services` when `connected_services_signature` matches the one in thread metadata (saves ~1k–3k tokens on mini-cycle Phase 3 turns). Sends when signature differs (post-OAuth, post-decline). |
| **E8** | Agent Draft card: Configuration block + "How it works" steps are collapsible accordions, default COLLAPSED. Mirrors the chat-side "Your Agent Plan" pattern. |
| **E9** | `/api/create-agent` now accepts an optional `input_values` field and inline-saves `agent_configurations` in the same call. Eliminates the prior ~1.5 s sequential round-trip AND the race where the V1 agent edit page would briefly show "not configured." Post-success setTimeout trimmed 1000 → 300 ms. Standalone `/api/agent-configurations/save-inputs` is still wired for post-creation edits. |
| **F1** | React state-staleness race: the LAST Phase 2 answer was dropped from `clarification_answers` on Phase 3 transition (page closure captured pre-answer `builderState`). Fixed by `clarificationAnswersRef` written synchronously in `submitPhase2Answer`, merged in `processPhase3`. |
| **F2** | `phase2_loop_state.iteration_count` was thread-global. After a long first session a mini-cycle inherited near-cap count and capped instantly without asking → Phase 3 → mini-cycle → forever. Fixed by per-session reset: when `phase2_user_answer` is null/absent (initial entry OR mini-cycle start), use INITIAL_LOOP_STATE. |
| **C1** | Cap raised from "< 10" to "≤ 10 inclusive" per user request. Both pre-call (route) and step() (controller) compare `iteration_count >= MAX_ITERATIONS` symmetrically. |
| **F3** | Phase 3 retry hardening. (L1) Normalizer absorbs `null` / `boolean` / non-array `object` values on `resolved_user_inputs[*].value` (drop null rows, coerce bool to string, JSON.stringify objects). Each touch logs a debug breadcrumb. (L2) Corrective-nudge text is context-aware: branches on `looksLikePhase2` so non-entrenchment failures get a generic schema-violation nudge that interpolates `validation.errors.join('; ')`. |
| **OI1** (resolved) | Phase 2 over-asking. Resolved via the PACING & CONVERGENCE hard rule in v16 (§ 4) + the E6 telemetry to calibrate it against real reasoning logs. |
| **T2** (resolved) | `conversationalSummary "every phase"` (rule #9) vs Phase 2 strict contract. Resolved via E3's client-side opening message + the rule #9 carve-out. |

---

## 6. Decision guide — where to make different kinds of changes

| You want to… | Touch this | Don't touch |
|---|---|---|
| Change WHEN the LLM asks vs stops (pacing, question-selection logic) | **v16 prompt** | the controller, the schema |
| Add a new Phase 2 response field | Phase2ResponseSchema + v16 (carve out the strict rule) + route (extract) + page (consume) | — |
| Add Phase 2 telemetry | Use the existing E6 `Phase 2 turn decision` breadcrumb pattern | Don't add per-turn DB writes (FR8) |
| Reduce LLM token cost in any phase | Look at E1 (Phase 2 mid-loop) + E7 (Phase 3 by signature) patterns | Don't strip context the prompt needs to read from thread |
| Change Phase 2 question rendering (hints, opening, indicator) | `app/v2/agents/new/page.tsx` only | The contract or the route — those are stable |
| Phase 3 retry behaviour | Respect F3's two-layer design (normalizer + context-aware nudge) | Don't widen the entrenchment-only nudge to all cases |
| Add a question count or progress bar to UI | **STOP** — FR7.20 forbids it. E4's running "Question N" is the only allowed counter. |
| Add a feature flag | **STOP** — FR10 forbids it. Rollback is `git revert`. |
| Modify the conversational builders / SmartAgentBuilder / `/agents/new/chat` | **STOP** — they're @deprecated. Confirm with the user before touching legacy. |

---

## 7. Out of scope (separate skills / future work)

- **V6 IntentContract pipeline** (`/api/v6/generate-ir-intent-contract` and `lib/agentkit/v6/`). The Approve button hands off to it; this skill does NOT cover its internals. **This is the next skill to build** — the user has stated it explicitly. Until that skill exists, V6 work follows `docs/v6/V6_DOCS_INDEX.md` + `docs/v6/V6_DESIGN_PRINCIPLES.md` directly.
- The V1 agent edit page at `app/(protected)/agents/[id]/page.tsx` — only relevant here insofar as `checkAgentConfiguration` reads `agent_configurations` on mount (the F2/E9 race motivation).
- `/api/agent-configurations/save-inputs` — the standalone route is the post-creation update path. Creation now goes through `/api/create-agent` with `input_values` inline (E9).
- The legacy V4/V5 workflow generators (`lib/agentkit/v4/`) — dormant fallback path when `NEXT_PUBLIC_USE_V6_AGENT_GENERATION` is off. The `USE_AGENT_GENERATION_ENHANCED_TECHNICAL_WORKFLOW_REVIEW` flag that toggled them is RETIRED.

---

## 8. Anti-patterns to refuse

If the user asks for any of these in the agent-creation flow, push back with the alternative:

| ❌ Anti-pattern | ✅ Correct |
|---|---|
| "Add a feature flag for this new Phase 2 behaviour" | FR10 forbids new flags. Rollback is `git revert`. |
| "Show how many questions are left / 'Question N of M' / a progress bar" | FR7.20 forbids it. E4's bare "Question N" (numerator only, no total) is the boundary. |
| "Loosen the Phase 2 strict schema to allow `<extra field>` for convenience" | Either justify it (FR4 amendment + v16 carve-out + workplan entry), or solve the underlying need without contract change. |
| "Reset the running Question N on a mini-cycle" | No — E4 is explicit: thread-wide running total, continues across sessions. |
| "Drop the per-turn `ai_reasoning` breadcrumb to save tokens" | E6 is the calibration signal for OI1's pacing rule. If you must trim, gate it behind a config, never silently remove. |
| "Make Phase 3 always send `plugin_action_summary` again (E7 broke X)" | First confirm X is real — E7 only omits when signature matches. If a legit mismatch exists, fix the signature path. |
| "Re-add `console.log` for debugging" | Use the existing `requestLogger` (Pino, has `correlationId` via `.child()`). |
| "Touch `useConversationalBuilder.ts` / `useConversationalFlow.ts` / `ConversationalAgentBuilder*.tsx`" | Those are @deprecated. Confirm with the user before any changes. |
| "Add a Phase 3 prompt rule [non-justified divergence from v15]" | v16's Phase 3 has exactly THREE justified divergences (§ 4). Adding a fourth requires explicit justification + workplan documentation. |
| "Hardcode plugin or action names in the v16 prompt" | Plugin schemas are the source of truth — the LLM reasons from `plugin_action_summary` (CLAUDE.md § Platform Design Principles). |

---

## 9. When you've finished work in this area

- Run `npx tsc --noEmit` — clean on touched files.
- Run `npx jest lib/validation lib/agent-creation lib/ui/__tests__/thinking-words.test.ts` — should remain green.
- **FR12 live smoke test at `/v2/agents/new` — mandatory.** Confirm: Q1 has the opening AI message; Q2+ have a hint AI bubble lead-in; "Question N" pill present on each question bubble; no qID reuse; if you triggered a mini-cycle, it asked instead of insta-capping; if Phase 3 retried, the retry succeeded.
- Document what you changed in the **appropriate cycle workplan** under `docs/workplans/` — either appending an entry to the workplan for the cycle the work belongs to, or creating a new requirement + workplan pair if it's a new cycle of work. Do NOT update the cycle-specific workplans of unrelated past cycles; they're historical snapshots.
- If your change updates the architectural picture (new state variable, new top-level field, new endpoint, new top-level UI section), also update `docs/V2_Thread-Based-Agent-Creation-Flow.md` — that's the durable architectural doc this skill anchors to.
- Tail `dev.log` and grep for `Phase 2 turn decision` to spot-check the `ai_reasoning` values against the PACING & CONVERGENCE rule — if the model is justifying questions that could clearly be defaulted, the rule needs tightening.

---

## 10. Related docs (read these when the change is non-trivial)

**Durable / cross-cycle:**
- `docs/V2_Thread-Based-Agent-Creation-Flow.md` — canonical architectural overview (end-to-end diagram, state-variable tables, testing checklist). **The first doc to read.**
- `docs/THINKING_WORDS.md` — the dictionary + `excludeFromGeneric` flag (relevant for hint/opening copy).
- `docs/SYSTEM_LOGGING_GUIDELINES.md` — Pino + correlation ID conventions for any new logs.
- `CLAUDE.md` § Platform Design Principles — "no hardcoding in system prompts", "fix issues at the root cause".
- `docs/v6/V6_DOCS_INDEX.md` — index for V6 IntentContract pipeline work (out-of-scope here; its own skill).

**Cycle-specific snapshots** (not load-bearing — search only if investigating *why* a specific labelled item exists, e.g. "what was the diagnosis behind F2?"):
- `docs/requirements/` — requirement MDs by cycle slug.
- `docs/workplans/` — workplan MDs by cycle slug. Each captures one cycle's diagnoses + decisions and goes stale once the cycle ships.
