# Agent-Creation-Flow RCA Runbook

> **Last Updated**: 2026-07-01

## Overview

A methodical, repeatable procedure for diagnosing **why the V2 thread-based agent-creation flow produced a bad agent** — a wrong/guessed/missing value, a dropped constraint, a mis-asked or skipped clarification — and driving it to a defensible root cause **before** any fix is proposed. This is the **upstream** counterpart to the [Calibration RCA Runbook](../Calibration/CALIBRATION_RCA_RUNBOOK.md): calibration RCA tells you *a value was wrong*; this runbook tells you *which creation phase authored it and why*.

**Scope:** the chat flow at `/v2/agents/new` — Phase 1 (diagnostic narrative), Phase 2 (single-question loop), Phase 3 (Enhanced-Prompt production), driven by the v16 prompt. The primary evidence is the **turn-by-turn conversation** in `agent_prompt_threads.metadata.iterations[]`.

**Out of scope (different owners):** the V6 IntentContract→IR→DSL pipeline (`v6-pipeline` skill), the calibration detection/repair loop (`calibration` / `calibration-rca`), the plugin executors. This runbook *names* which of those owns a fix; it doesn't fix them.

**Golden rule:** conclude the RCA — **which phase authored the defect, why, and which surface owns the fix** — before discussing fixes. A creation-flow defect is almost always authored in exactly one phase's LLM response; find that turn first.

**Doc map for the `3fc703fd` "Sheet1" cycle** (the names are easy to confuse — they are *different scopes*, not duplicates):

| Doc | Scope |
|---|---|
| `EP_PRODUCTION_RCA_CONCLUSION_sheets-range.md` | **This runbook's worked example** — the chat-flow / EP-production RCA (why Phase 3 fabricated `"Sheet1"`). The canonical conclusion. |
| `EP_PRODUCTION_RCA_HANDOFF_sheets-range.md` | The kickoff brief for that RCA. ✅ Superseded by the conclusion above — kept for provenance. |
| `AGENT_CREATION_RCA_CONCLUSION_sheets-range.md` | The **V6 / downstream** conclusion (why V6 propagated the value + "Defect B"). Despite the name, this is *not* the chat-flow RCA. |
| `AGENT_CREATION_RCA_HANDOFF_sheets-range.md` | The original ask + the calibration-RCA summary that pointed upstream. |

## Table of Contents

1. [When this fires](#when-this-fires)
2. [The 6-step method](#the-6-step-method)
3. [Evidence: the thread and the creation context](#evidence-the-thread-and-the-creation-context)
4. [The phase model — who can author what](#the-phase-model--who-can-author-what)
5. [Classifying the root-cause layer](#classifying-the-root-cause-layer)
6. [Traps & gotchas](#traps--gotchas)
7. [Worked example — `3fc703fd` (the "Sheet1" fabrication)](#worked-example--3fc703fd-the-sheet1-fabrication)
8. [Change History](#change-history)

---

## When this fires

- "Agent `<id>` was created with a wrong/guessed/missing value — where did the chat flow introduce it?"
- "A downstream (V6 / calibration) RCA proved a value originated in the Enhanced Prompt — RCA the EP production."
- "Phase 2 asked a bad question / skipped one / re-asked / over-asked — why?"
- "The narrative says X but the structured `resolved_user_inputs` says Y — which is authoritative and why do they diverge?"

Works for **any** agent (production or sandbox) — the conversation is persisted in the DB; you almost never need a live reproduction (and shouldn't, given non-determinism — see traps).

---

## The 6-step method

### 1. Gather evidence (DB-first)
```bash
npx tsx scripts/dump-agent-thread.ts <agent_id> [suspect_value]   # thread iterations[] + ai_context + clarification_answers (+ RCA hint)
npx tsx scripts/dump-agent.ts        <agent_id>                    # the saved agent: pilot_steps, input_schema, user_prompt (the EP)
```
`dump-agent-thread.ts` writes `c:/tmp/agent-<prefix>-{thread,aictx,creation-metadata}.json`, prints a per-iteration phase table, and — if you pass a `suspect_value` (e.g. `"Sheet1"`) — traces its **first appearance** and names the authoring iteration/phase. Start there.

### 2. Establish the ground truth of what the user actually said
Before blaming a phase, know the inputs:
- `agents.created_from_prompt` column — the raw prompt (often missing the identifier in question). *(Canonical since the A2 de-dup; `ai_context.original_prompt` is no longer written on new agents. `getAgentAiContextView` reads column-first.)*
- `creation_metadata.clarification_answers` — the Phase 2 answers keyed `q1…qN` (this is where a URL/identifier usually enters).
- Read the answer that carried the disputed value **verbatim**. A `gid=0` URL, a "me", an "all" — the user's literal words are the yardstick for "did the flow honor the input or invent something."

### 3. Find the authoring turn (walk `iterations[]`)
Each iteration = `{ phase, request, response, timestamp }`. Walk them **in order**. The **first `response` containing the bad value** is the authoring turn; its `phase` names the responsible prompt logic. Distinguish:
- value in a **request** = it was *carried in* from a prior turn (context), not authored here;
- value in a **response** = *authored* here.
A value that first appears in a Phase-3 response is an **EP-production** defect; one that first appears in a Phase-2 question is a **question-authoring** defect; one already wrong in the Phase-1 narrative is a **Phase-1 extraction** defect.

### 4. Check prose-vs-structured divergence (the signature move)
Phase 3 emits both a **narrative** (`enhanced_prompt.sections.*`, free prose) and a **structured** part (`enhanced_prompt.specifics.resolved_user_inputs`, schema-constrained `[{key,value}]`). Compare them for the disputed value:
- **Narrative correct, structured wrong** → the model *knew* the truth but couldn't represent it in the constrained slot, so it **guessed/collapsed** it. This is the classic **EP-production gap** (see the worked example). The fix is to give the model a faithful structured option (a name-less form, a carried id, or `user_inputs_required`), not to "try harder."
- **Both wrong** → the misunderstanding is upstream (Phase 1/2 or the user input itself).
- **Both correct** → the defect is downstream of creation (V6/calibration/executor) — hand off.

### 5. Explain the *why* from the prompt + the injected context
Open `Workflow-Agent-Creation-Prompt-v16-chatgpt.txt` and the **injected `plugin_action_summary`** (visible in the relevant iteration's request). Root causes almost always come from one of:
- a **prompt framing** that mischaracterizes a parameter (e.g. calling a `range` "a single sheet tab name" when it's A1 notation);
- a **priming example** in the prompt or plugin schema (e.g. `Sheet1!A1:D10` as the leading example);
- a **mandate** rule that forces a concrete value (e.g. "you MUST add every resource identifier to `resolved_user_inputs`") with **no escape hatch** for "unknowable at chat time";
- a **pacing** rule that made Phase 2 stop/skip a question (correctly or not);
- a **missing rule** for the exact situation (e.g. "user gave an opaque id/URL fragment, not a name").
Quote the exact lines. Name whether the driver is v16 (prompt), the plugin definition JSON (the schema hint), or the route (`process-message`).

### 6. Conclude, then stop
State: **authoring phase/turn** → **prose-vs-structured verdict** → **why** (exact prompt/schema lines) → **layer / fix-owner** → **general class or one-off**. Only then propose fixes (and only if asked). Write the conclusion to `docs/investigations/` (mirror the `EP_PRODUCTION_RCA_CONCLUSION_*` format).

---

## Evidence: the thread and the creation context

| Object | Path | Use |
|---|---|---|
| **The conversation** | `agent_prompt_threads.metadata.iterations[]` | The turn-by-turn `{phase, request, response}` log. **Primary evidence.** |
| Thread meta | `agent_prompt_threads.metadata.{phase2_loop_state, plugin_context_signature, phase1_*_services}` | Loop state (cap/iteration), which turns re-sent `plugin_action_summary`. |
| Original prompt | `agents.created_from_prompt` column (canonical) | What the user first asked (often lacks the identifier). `ai_context.original_prompt` no longer written on new agents — use the column or `getAgentAiContextView`. |
| Enhanced Prompt | `agents.user_prompt` column (canonical, structured) | The saved EP — narrative + `resolved_user_inputs`. `ai_context.enhanced_prompt` no longer written; `getAgentAiContextView(agent).enhanced_prompt` renders the flat form. |
| Clarification answers | `agents.agent_config.creation_metadata.clarification_answers` | The Phase 2 answers `q1…qN` (where identifiers/URLs enter). *(Unchanged.)* |
| Confidence | `agents.ai_confidence` column (canonical) | Phase-3 self-confidence (0.8 default). `ai_context.confidence` no longer written on new agents. |

**Iteration shape (Phase 3 response):** `{ phase:3, enhanced_prompt:{ sections:{data,output,actions,delivery,processing_steps}, specifics:{ services_involved, resolved_user_inputs:[{key,value}], user_inputs_required } }, analysis, conversationalSummary, … }`.
**Iteration shape (Phase 2 response):** `{ phase:2, question:{id,type,question,options?,allowCustom?,theme?}|null, phase2_done, ai_reasoning? }`.
**`resolved_user_inputs` key format:** `{plugin}__{capability}__{param}` when `plugin_action_summary` is present (e.g. `google-sheets__table/get__range`); plain machine keys otherwise. The capability namespace can **vary between two Phase-3 calls** in the same thread — match on plugin+param stem, not the exact key.

---

## The phase model — who can author what

| Phase | Emits | Can author a bad value by… |
|---|---|---|
| **1 — narrative** | `workflow_draft`, `*_detected`, `ambiguities`, `user_inputs_required`, seed `resolved_user_inputs` | Mis-extracting an identifier from the prompt; failing to queue an ambiguity. It also *seeds* the open-questions list Phase 2 works from. |
| **2 — questions** | one `question` per turn, or `phase2_done` | Asking a wrong/leading question; **skipping** a queued question (pacing/no-re-ask); over-asking; a bad option set. Phase 2 rarely authors the final *value* — it collects answers. |
| **3 — EP production** | the Enhanced Prompt (narrative + `resolved_user_inputs`) | **The usual culprit for a bad value.** Materializing a known fact into the wrong structured value (fabrication/collapse); dropping a narrative constraint from the structured part; wrong key/namespace. |

**Mini-cycles:** after Phase 3, user feedback can re-enter Phase 2 (`user_feedback` set), then re-run Phase 3. The mini-cycle's Phase 2/3 **requests carry the prior EP back in** — so a bad value authored in the first Phase 3 will *reappear in later requests* without being re-authored. The `suspect_value` trace flags this (value in later requests, authored in the earliest response).

---

## Classifying the root-cause layer

Ask in order:

| # | Question | If yes → layer / owner |
|---|---|---|
| 1 | Did the user actually supply the correct info (verbatim answer / prompt)? | If **no**, the flow can't be blamed — it's a genuine missing input (should surface in `user_inputs_required`, not be invented). |
| 2 | Is the value wrong only in the **structured** part while the **narrative** is right? | **EP-production gap** — v16 Phase 3 (owner: `agent-creation-flow`). The fix gives the model a faithful structured option. |
| 3 | Is the value wrong in the **narrative too**? | Phase 1/2 misunderstanding (owner: `agent-creation-flow`, but a different phase's rules). |
| 4 | Are narrative **and** structure both correct, but the compiled DSL/step is wrong? | **V6 generation** (owner: `v6-pipeline`). Hand off — not a creation-flow defect. |
| 5 | Is the EP correct, but the **saved agent's `input_schema`** has duplicate / mismatched / unfilled fields (e.g. a clean `sheet_range` **and** a namespaced `google-sheets__table/get__range`, only one carrying the value)? | **V2 UI schema builder** — `extractInputSchema()` in `app/v2/agents/new/page.tsx` merges two key namespaces (step-scanned `{{input.X}}` refs + EP `resolved_user_inputs`) deduped by *exact name only*, so logically-identical inputs both surface; the runtime `reconcileInputsToDsl` (WP-57) bridges them by plugin+param stem. Owner: `agent-creation-flow` (`page.tsx`), **not V6**. This is "Defect B" from the `3fc703fd` cycle. |
| 6 | Is everything in the EP correct and the failure is at execution? | **Runtime / executor / external API** (owner: plugin executor). Hand off. |

**Common combo:** the value is wrong *because Phase 3 had no faithful way to encode a known-but-unnameable fact* (an opaque id, a positional reference). Name the class ("don't fabricate human-readable names from opaque ids"), not just the instance.

---

## Traps & gotchas

- **Prose-vs-structured masking.** The narrative can look perfect and reassure you the flow "got it" — while the schema-constrained `resolved_user_inputs` carries the real defect. Always diff the two for the disputed value. The narrative is unconstrained prose; the structured slot is where the model is *forced* to guess.
- **Carried-in ≠ authored.** A value in iter N's **request** was carried from an earlier turn (context/EP replay in a mini-cycle). Only a value in a **response** was authored there. Don't blame the mini-cycle for a value the first Phase 3 authored.
- **Key-namespace drift.** The same value can appear under `…__read_range__range` in one Phase-3 call and `…__table/get__range` in another. Match on plugin+param stem, not the literal key, or you'll think the value "changed."
- **`ai_reasoning` may be empty.** The E6 per-turn telemetry (`ai_reasoning`) is optional in the schema and can be `(none)` for an entire thread. When absent, reason from the prompt rules + the observed outcome — don't assume the model's justification is recoverable.
- **`plugin_action_summary` is only sent on some turns.** Per E1/E7, it's sent on Phase 1 + first Phase 2 turn (and when `connected_services` changes), and omitted from most mid-loop and Phase-3 turns to save tokens — but remains **authoritative** thread-wide. To read the param hint the model used, look at the turn where it *was* sent (usually iter 0/1), not the authoring turn.
- **Non-determinism — don't re-generate to diagnose.** Phase 1 and Phase 3 are LLM calls; re-running `/v2/agents/new` may not reproduce the defect. Use the **persisted** `iterations[]`. A live re-run is only for **testing a prompt fix**, never for establishing what happened.
- **Phase 2 "skipping" a question is often correct.** The PACING/no-re-ask hard rules make Phase 2 fold a queued ambiguity into a safe default when a prior answer resolved it. A skipped question is a defect only if the info was genuinely still needed *and* couldn't be defaulted — verify against the answers before blaming Phase 2.
- **The plugin schema can be the culprit, not the prompt.** A misleading example or constraint in `lib/plugins/definitions/{plugin}-plugin-v2.json` gets injected verbatim into `plugin_action_summary`. Check the plugin JSON when the model's guess mirrors a schema example (e.g. it emitted `Sheet1` and the schema's leading example is `'Sheet1!A1:D10'`).
- **A "bad value" can be a UI schema-build artifact, not a chat-flow authoring defect.** If the EP's `resolved_user_inputs` is correct but the *saved agent's* `input_schema` shows duplicate/mismatched fields (a clean `{{input.X}}` key and a namespaced `{plugin}__{cap}__{param}` key for the same thing, only one holding the value), the defect is in `extractInputSchema()` (`app/v2/agents/new/page.tsx`), which merges the two namespaces deduped by exact name — **not** in the chat flow. The runtime `reconcileInputsToDsl` (WP-57) usually masks it by bridging value→ref at execution, so it won't show up as a run failure. Don't chase it through `iterations[]` — it's authored *after* the thread, in the UI. (See classification row 5.)

---

## Worked example — `3fc703fd` (the "Sheet1" fabrication)

**Symptom:** calibration failed with `Unable to parse range: Sheet1`; a prior calibration + V6 RCA proved `range="Sheet1"` originated in the Enhanced Prompt. Task: RCA the EP production.

1. **Evidence:** `npx tsx scripts/dump-agent-thread.ts 3fc703fd-… "Sheet1"` → 11 iterations; trace says **authored in iter 7 (phase 3) RESPONSE**, recurs in iter 10 (the saved EP).
2. **Ground truth:** `clarification_answers.q1 = "…/edit?gid=0#gid=0"` — the user gave the tab as a **gid**, never a name. Original prompt had no URL at all.
3. **Authoring turn:** iter 7, Phase 3. `resolved_user_inputs[range] = "Sheet1"` — first appearance in any response.
4. **Prose-vs-structured:** narrative said *"the sheet tab represented by gid=0 (the first tab in the provided link)"* ✅ — structured said `"Sheet1"` ✗. **Divergence → EP-production gap.** The model *knew* it was gid=0/first tab; it fabricated a name for the constrained slot.
5. **Why:** three reinforcing pressures + a missing rule — (a) v16 **L275** mis-frames `range` as *"a single sheet tab name"*; (b) the injected plugin hint leads with `'Sheet1!A1:D10'` (`google-sheets-plugin-v2.json:81`); (c) **L495–499 / L697** *mandate* a concrete resolved value for every identifier — with **no rule** that a `gid` is an opaque id, that the flow has no Sheets API to resolve it, or that a **name-less range** (`A:Z`) reads the first tab. Phase 2 correctly did **not** re-ask (PACING + no-re-ask: `gid=0` answered "which tab").
6. **Conclusion:** EP-production gap in v16 Phase 3; **general class** ("don't fabricate human-readable names from opaque ids"); fix = a name-less range for gid-only tabs + correcting the L275 framing; durable belt-and-suspenders = executor `gid→title` resolution (plugin-executor, separate cycle). Full write-up: [EP_PRODUCTION_RCA_CONCLUSION_sheets-range.md](./EP_PRODUCTION_RCA_CONCLUSION_sheets-range.md).

**Lesson distilled into this runbook:** the narrative lied by omission — it looked right, so the defect hid in the structured slot. Step 4 (prose-vs-structured diff) is what turns "the EP has a bad value" into "Phase 3 fabricated it because it had no faithful way to encode gid=0."

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-07-01 | Created | Initial runbook + `scripts/dump-agent-thread.ts`, distilled from the `3fc703fd` "Sheet1" EP-production RCA. |
