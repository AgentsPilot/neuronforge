---
name: agent-creation-rca
description: A methodical, repeatable procedure for diagnosing WHY the V2 thread-based agent-creation flow (/v2/agents/new, v16 prompt, Phases 1-3) produced a bad agent — a wrong/guessed/missing value, a dropped constraint, a mis-asked or skipped clarification — and driving it to a defensible root cause. Use whenever the user gives an agent ID (or an Enhanced Prompt / creation result) and asks to debug / investigate / RCA the CREATION side — "the chat flow guessed a value", "the Enhanced Prompt has a wrong value", "why did Phase 2 skip/ask this question", "the narrative says X but resolved_user_inputs says Y", or a downstream (V6/calibration) RCA that proved a value originated in EP production and needs the upstream cause. It loads the 6-step method (gather thread evidence → establish what the user actually said → find the authoring turn in metadata.iterations[] → check prose-vs-structured divergence → explain the why from the v16 prompt + injected plugin_action_summary → conclude), the evidence script (scripts/dump-agent-thread.ts), the agent_prompt_threads.metadata.iterations[] / ai_context / clarification_answers data model, and the recurring traps (prose-vs-structured masking, carried-in vs authored, key-namespace drift, empty ai_reasoning, non-deterministic re-generation, plugin-schema priming). This skill is DIAGNOSTIC ONLY — it concludes RCA and names the fix-owner; it does not change code. For CHANGING the chat flow / v16 prompt / route use the `agent-creation-flow` skill; for the downstream calibration RCA use `calibration-rca`; for the V6 generation pipeline use `v6-pipeline`. Full detail: docs/investigations/AGENT_CREATION_RCA_RUNBOOK.md.
---

# agent-creation-rca

Load this context **before** investigating why the agent-creation *chat flow* produced a bad agent. It's the durable, repeatable method for going from an **agent ID** to a defensible root cause — *which creation phase authored the defect, why, and which surface owns the fix* — **before** any fix is proposed.

> **First read**: [`docs/investigations/AGENT_CREATION_RCA_RUNBOOK.md`](../../../docs/investigations/AGENT_CREATION_RCA_RUNBOOK.md) — the full methodology, data-model reference, traps, and worked example. This skill is the working summary; the runbook is the source of truth.

> **Scope**: DIAGNOSTIC ONLY. You produce an RCA and name the fix-owner — you do **not** change code here. Changing the chat flow / v16 prompt / `process-message` route → `agent-creation-flow` skill. The downstream calibration RCA → `calibration-rca`. The V6 generation pipeline → `v6-pipeline`.

> **Golden rule**: conclude the RCA — authoring phase → why → layer → fix-owner — **before** discussing fixes. A creation-flow defect is almost always authored in exactly one phase's LLM response; find that turn first.

---

## Where this sits (three RCA skills, one chain)

`agent-creation-rca` (this) — **upstream**: the chat flow authored a bad value → **which phase, why**.
`v6-pipeline` — **middle**: the generator turned a fine EP into a wrong DSL.
`calibration-rca` — **downstream**: the run failed → *which step, which layer*. Calibration RCA often ends "…the value came from the Enhanced Prompt" — that's the handoff **into** this skill.

If a downstream RCA already proved the value originated in EP production, start at step 3 here.

---

## When this skill fires

- "Agent `<id>`: the chat flow guessed/invented a value (a range, a name, an id) — where did it come from?"
- "The Enhanced Prompt has a wrong/missing value — which phase authored it?"
- "Phase 2 asked a bad question / skipped one / re-asked / over-asked — why?"
- "The narrative says X but `resolved_user_inputs` says Y — which wins and why do they diverge?"
- A `calibration-rca` / `v6-pipeline` conclusion that points the finger upstream at EP production.

Works for **any** agent (production or sandbox) — the conversation is persisted; you rarely need (and shouldn't attempt) a live reproduction.

---

## The 6-step method (summary)

### 1. Gather evidence (DB-first)
```bash
npx tsx scripts/dump-agent-thread.ts <agent_id> [suspect_value]   # thread iterations[] + ai_context + clarification_answers (+ RCA hint)
npx tsx scripts/dump-agent.ts        <agent_id>                    # saved agent: pilot_steps, input_schema, user_prompt (the EP)
```
Passing a `suspect_value` (e.g. `"Sheet1"`) traces its **first appearance** and names the authoring iteration/phase. Writes `c:/tmp/agent-<prefix>-{thread,aictx,creation-metadata}.json`.

### 2. Establish what the user actually said
Read `ai_context.original_prompt` and `creation_metadata.clarification_answers` (`q1…qN`) **verbatim**. The user's literal words are the yardstick for "honored the input vs invented something." Identifiers/URLs usually enter as a Phase-2 answer, not the original prompt.

### 3. Find the authoring turn (walk `iterations[]`)
Each iteration = `{phase, request, response}`. The **first `response`** containing the bad value is where it was authored; its `phase` names the responsible prompt logic. Value in a **request** = carried in from a prior turn (not authored here); value in a **response** = authored here.

### 4. Check prose-vs-structured divergence (the signature move)
Phase 3 emits a **narrative** (`enhanced_prompt.sections.*`, free prose) AND a **structured** part (`specifics.resolved_user_inputs`, schema-constrained). Diff the disputed value:
- **narrative right, structured wrong** → the model knew the truth but couldn't encode it in the constrained slot → it guessed/collapsed → **EP-production gap** (the classic case);
- **both wrong** → upstream Phase 1/2 or the user input;
- **both right** → defect is downstream (V6/calibration/executor) — hand off.

### 5. Explain the *why* from the prompt + injected context
Open `Workflow-Agent-Creation-Prompt-v16-chatgpt.txt` and the injected `plugin_action_summary` (in the relevant request). Root causes cluster into: a **mis-framing** of a parameter; a **priming example** (prompt or plugin JSON); a **mandate** to emit a concrete value with **no escape hatch**; a **pacing** rule that skipped a question; or a **missing rule** for the exact case. Quote exact lines; name the driver (v16 prompt vs plugin definition JSON vs `process-message` route).

### 6. Conclude, then stop
State: **authoring phase/turn → prose-vs-structured verdict → why (exact lines) → layer/fix-owner → general class or one-off.** Write it to `docs/investigations/` (mirror `EP_PRODUCTION_RCA_CONCLUSION_*`). Propose fixes only if asked.

---

## Classify the root-cause layer

| Question | → layer / owner |
|---|---|
| Did the user actually supply the correct info? | If **no** → genuine missing input (should surface in `user_inputs_required`, not be invented). |
| Value wrong only in the **structured** part, narrative right? | **EP-production gap** → `agent-creation-flow` (v16 Phase 3). |
| Value wrong in the **narrative too**? | Phase 1/2 misunderstanding → `agent-creation-flow` (different phase's rules). |
| EP fully correct, but compiled **DSL/step** wrong? | **V6 generation** → `v6-pipeline`. Hand off. |
| EP correct, but the **saved agent's `input_schema`** has duplicate/mismatched fields (clean `{{input.X}}` key **and** namespaced `{plugin}__{cap}__{param}` for the same input, only one holding the value)? | **V2 UI `extractInputSchema()`** (`app/v2/agents/new/page.tsx`) — merges step-scanned refs + EP `resolved_user_inputs` deduped by exact name; runtime `reconcileInputsToDsl` (WP-57) bridges them. Owner: `agent-creation-flow` (`page.tsx`), **not V6**. ("Defect B", `3fc703fd` cycle.) |
| EP correct, failure at **execution**? | **Runtime / executor / external API** → plugin executor. Hand off. |

**Common combo:** value wrong *because Phase 3 had no faithful way to encode a known-but-unnameable fact* (opaque id, positional ref). Name the **class** ("don't fabricate human-readable names from opaque ids"), not just the instance.

---

## Traps & gotchas (these bite every time)

- **Prose-vs-structured masking** — the narrative looks perfect and reassures you; the defect hides in the schema-constrained `resolved_user_inputs`. Always diff the two.
- **Carried-in ≠ authored** — a value in a *request* was carried from an earlier turn (mini-cycle EP replay). Only a *response* authors. Don't blame the mini-cycle.
- **Key-namespace drift** — the same value appears under `…__read_range__range` then `…__table/get__range`. Match on plugin+param stem, not the literal key.
- **`ai_reasoning` may be empty** — E6 telemetry is optional and often `(none)` for a whole thread. Reason from prompt rules + outcome.
- **`plugin_action_summary` only on some turns** — sent on Phase 1 + first Phase 2 turn (+ on `connected_services` change), omitted elsewhere but authoritative thread-wide (E1/E7). Read the param hint from the turn where it *was* sent (usually iter 0/1).
- **Non-determinism — don't re-generate to diagnose** — Phase 1 & 3 are LLM calls; a re-run may not reproduce. Use the persisted `iterations[]`. Live re-run is only for **testing a fix**.
- **Phase-2 "skipping" is often correct** — PACING + no-re-ask fold a queued ambiguity into a safe default once a prior answer resolves it. A skip is a defect only if the info was still needed AND couldn't be defaulted.
- **The plugin schema can be the culprit** — a misleading example/constraint in `lib/plugins/definitions/{plugin}-plugin-v2.json` is injected verbatim. Check it when the guess mirrors a schema example.
- **A "bad value" can be a UI schema-build artifact, not a chat-flow defect** — if the EP is correct but the *saved* `input_schema` has duplicate/mismatched fields, it's `extractInputSchema()` in `page.tsx` (namespace merge), masked at runtime by `reconcileInputsToDsl` (WP-57). Authored *after* the thread — don't chase it through `iterations[]`. See classification table.

---

## Data model (where the evidence lives)

| Object | Path | Use |
|---|---|---|
| **The conversation** | `agent_prompt_threads.metadata.iterations[]` | `{phase, request, response, timestamp}` per turn. **Primary evidence.** |
| Thread meta | `agent_prompt_threads.metadata.{phase2_loop_state, plugin_context_signature, phase1_*_services}` | Loop/cap state; which turns re-sent `plugin_action_summary`. |
| Original prompt | `agents.agent_config.ai_context.original_prompt` | What the user first asked. |
| Enhanced Prompt | `agents.agent_config.ai_context.enhanced_prompt` (== `agents.user_prompt`) | The saved EP: narrative + `resolved_user_inputs`. |
| Clarification answers | `agents.agent_config.creation_metadata.clarification_answers` | Phase-2 answers `q1…qN` (where identifiers enter). |

Phase-3 response shape: `{ enhanced_prompt:{ sections:{data,output,actions,delivery,processing_steps}, specifics:{ services_involved, resolved_user_inputs:[{key,value}], user_inputs_required } }, analysis, conversationalSummary }`. `resolved_user_inputs` keys: `{plugin}__{capability}__{param}` when `plugin_action_summary` present, else plain machine keys; capability namespace can vary between two Phase-3 calls.

---

## Related

- `agent-creation-flow` skill — the chat flow's architecture + constraints (use to *change* the v16 prompt / route / schemas).
- `calibration-rca` skill — the downstream RCA that hands off *into* this one.
- `v6-pipeline` skill — the generation pipeline (hand off when the EP is correct but the DSL is wrong).
- `docs/investigations/AGENT_CREATION_RCA_RUNBOOK.md` — full method + worked example (`3fc703fd` "Sheet1").
- `docs/investigations/EP_PRODUCTION_RCA_CONCLUSION_sheets-range.md` — the reference conclusion this runbook was distilled from.
