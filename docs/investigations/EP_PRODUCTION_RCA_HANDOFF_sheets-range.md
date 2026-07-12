# Handoff — EP-Production / Agent-Creation-Flow RCA for the "Sheet1" range failure

> ✅ **RESOLVED 2026-07-01 — this handoff has been carried out. Conclusion: [EP_PRODUCTION_RCA_CONCLUSION_sheets-range.md](./EP_PRODUCTION_RCA_CONCLUSION_sheets-range.md).** The RCA method it describes was also distilled into the `agent-creation-rca` skill + [AGENT_CREATION_RCA_RUNBOOK.md](./AGENT_CREATION_RCA_RUNBOOK.md) and the `scripts/dump-agent-thread.ts` evidence script. Kept for provenance; start from the conclusion, not here.
>
> **Created**: 2026-07-01
> **Purpose**: Self-contained context to start a NEW session investigating the **Enhanced Prompt (EP) production** root cause — i.e. the **V2 thread-based agent-creation flow** (`/v2/agents/new`, Phases 1→2→3). The **V6-generation RCA** and the **calibration RCA** are already concluded (below). This handoff drives the *most upstream* RCA: **why the chat flow turned a `gid=0` spreadsheet URL into a guessed tab name `"Sheet1"` instead of capturing a usable range.**
> **Load these skills at the start of the new session**: `agent-creation-flow` (PRIMARY — the flow being investigated), and `v6-pipeline` (context for what the EP feeds into).
> **Read first**: this doc, then [AGENT_CREATION_RCA_CONCLUSION_sheets-range.md](./AGENT_CREATION_RCA_CONCLUSION_sheets-range.md) (the concluded V6/downstream RCA), then [AGENT_CREATION_RCA_HANDOFF_sheets-range.md](./AGENT_CREATION_RCA_HANDOFF_sheets-range.md) (the original ask + calibration summary).

---

## 1. The problem (one paragraph)

Agent `3fc703fd-9834-420d-af5b-026f62e25cbe` ("High-Qualified Leads Email Summary Agent") **failed calibration** because step 1 (`google-sheets.read_range`) ran with `range = "Sheet1"`, which the Sheets API rejected: **`Unable to parse range: Sheet1`**. The user's spreadsheet tab isn't named "Sheet1" — they supplied it as a `gid=0` URL. The prior RCA proved the bad value `"Sheet1"` was **authored during EP production (the chat flow's Phase 3)** and sat in the Enhanced Prompt's `resolved_user_inputs` **before V6 ever ran**; V6 and the runtime faithfully propagated it. **This session's job: find WHY the thread-based flow produced `"Sheet1"` from a `gid=0` URL — and fix it at that root.**

---

## 2. What is already concluded (do NOT redo)

Full detail in [AGENT_CREATION_RCA_CONCLUSION_sheets-range.md](./AGENT_CREATION_RCA_CONCLUSION_sheets-range.md). Summary:

- **Downstream (calibration):** behaved correctly — caught the real defect at confidence 0.95 with a fix hint. Not a calibration bug.
- **V6 generation:** behaved correctly — it received `range="Sheet1"` as a concrete, schema-valid value in the EP's `resolved_user_inputs` and faithfully propagated it. V6 **raised no flag** (confidence 0.8 default, no ambiguities/warnings) because (a) the value looked legitimate, and (b) V6 grounding is **schema-only by design** — it never fetches the real spreadsheet, so it *cannot* know "Sheet1" doesn't exist. The first live check is the calibration dry-run.
- **Value provenance (proven):** `"Sheet1"` originates in the **chat flow Phase 3**, in the EP's `specifics.resolved_user_inputs[key="google-sheets__table/get__range"]`. → **This session investigates that authoring step.**
- **Secondary defect B (separate, do not conflate):** duplicate input fields from `extractInputSchema()` in `app/v2/agents/new/page.tsx` merging clean `{{input.X}}` keys with namespaced EP keys. That's a V2-UI/schema bug, **owned by the concluded RCA's fix list, not this session.** This session is only about *why the range value was wrong*.

---

## 3. What to investigate (the EP-production RCA ask)

**Root-cause WHY the thread-based flow captured `range = "Sheet1"` instead of a usable range for a `gid=0` URL.** The user gave the tab as a `gid`, not a name; the flow guessed Google's default tab name.

### The proven facts to start from

- The **original prompt had no spreadsheet URL at all**: *"I need a summary table of all high-qualified leads from my spreadsheet. Once filtered… sent out to the end users using email channel."* (`agent_config.ai_context.original_prompt`)
- The URL came in as the **Phase 2 answer to q1**. From `agent_config.creation_metadata.generated_plan.clarification_answers`:
  ```json
  {
    "q1": "https://docs.google.com/spreadsheets/d/1pM8WbXtPgaYqokHn_spgQAfR7SBuql3JUtE1ugDtOpc/edit?gid=0#gid=0",
    "q2": "Status is “High-qualified”",
    "q3": "stage",
    "q4": "all",
    "q5": "me and meiribarak@gmail.com",
    "q6": "Yes — stage = 4"
  }
  ```
- The chat **never asked for a tab/sheet name.** It parsed the URL's *file id* correctly (`1pM8…` → `spreadsheet_id`) but resolved `gid=0` → `"Sheet1"` in the EP.
- The EP **narrative preserved the truth** (`sections.data`: *"Read the lead table from the sheet tab represented by gid=0 (the first tab in the provided link)"*) while the **structured `resolved_user_inputs` value was the guess** (`"Sheet1"`). So the signal (gid) survived in prose but was **fabricated into a name** in the machine-readable field.

### The questions to answer

1. **Which phase authored `"Sheet1"`?** Phase 3 (EP assembly) is the prime suspect, but confirm against the thread iterations — did a Phase 2 turn already coin it, or did Phase 3's `resolved_user_inputs` construction do it? (See §5 for how to pull the full conversation.)
2. **Why did the flow feel entitled to invent a tab name?** The v16 prompt models `range` as *"a single sheet tab name"* and pushes the LLM to emit one concrete value (see §4 code anchors). It has **no rule** for: parsing a URL into `spreadsheet_id` + `gid`; recognizing a `gid` is a numeric tab *id* (not a title); or handling "user specified the tab by position/gid, not by name." Confirm this is the gap and locate the exact prompt lines responsible.
3. **Should the flow have asked, deferred, or emitted a name-less range?** The chat has **no Sheets API access**, so it cannot resolve `gid → title`. Decide the correct EP-production behavior:
   - (a) **Emit a sheet-name-less range** (e.g. `A:Z`) when the user specified the tab by `gid=0` — the Sheets API then reads the first/default tab, matching the narrative's own "first tab" intent. Valid A1 notation (`range` schema documents `'B2:E5'` with no sheet name).
   - (b) **Preserve the `gid` as structured data** (e.g. `range` left unresolved + a `gid`/`sheet_gid` hint) and defer `gid → title` resolution to a downstream resolver / the executor at runtime.
   - (c) **Ask a parameter-aware question** when only a gid is available and it matters — but note the flow's bias is to STOP asking (PACING rule), and the info to do (a) is already present, so asking may be unnecessary.
4. **Is this only a Sheets/gid issue, or a general class?** Any resource identified by an opaque id (Drive file/folder ids, calendar ids, etc.) risks the same "guess a human name from an id" failure. Decide whether the fix is Sheets-specific prompt guidance or a general "don't fabricate human-readable identifiers from opaque ids" rule. **Per CLAUDE.md, avoid hardcoding plugin-specific names in the prompt** — prefer a general rule keyed off the plugin action-summary parameter constraints.

---

## 4. Code anchors (agent-creation-flow surface)

| File | Why it matters |
|---|---|
| `app/api/prompt-templates/Workflow-Agent-Creation-Prompt-v16-chatgpt.txt` | **The active system prompt (Phases 1-3).** Prime suspect. Relevant lines already identified: **L275** frames `range (string — single sheet tab name)`; **L273-277** push the LLM to elicit ONE concrete tab name (BAD/GOOD examples); **L158-164, L268, L305-306** are the "extract external resource identifiers (sheet names, tab names)" rules. **None handle a `gid`/URL-position tab reference.** This is where the guessing behavior lives. |
| `app/api/agent-creation/process-message/route.ts` | The phase-routing API. Builds the per-phase user message, injects `plugin_action_summary` (the param hints incl. the `range` constraint), runs the Phase 2 loop + Phase 3 assembly. Trace how `resolved_user_inputs` is produced/validated here. |
| `lib/validation/phase3-schema.ts` | Zod schema + normalizer for the Phase 3 EP (`resolved_user_inputs` = `[{key,value}]`). Confirms nothing validates that a `range` value is a *real* tab (it can't) — but check whether a structured `gid` could be carried without a schema change. |
| `lib/agent-creation/phase2-loop-controller.ts` / `phase2-done-detector.ts` | Phase 2 cap/termination. Relevant only if you find the flow *should* have asked a tab question but stopped early. |
| `docs/v6/V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_INTENT_CONTRACT_EP_KEY_HINTS.md` | The EP-Key-Hints design (`{plugin}__{capability}__{param}` keys). **Its own sub-problem #4** is literally "the thread LLM should use the `range (string — single sheet tab name)` constraint to ask parameter-aware questions and avoid ambiguous/missing values." That design anticipated *ambiguity*, but not *a confidently-guessed default from a gid*. Read it to understand the intended contract before changing it. |

**Design principle guardrails (CLAUDE.md):** fix at the root cause; **no hardcoding plugin/action names in the prompt** — the LLM reasons from the injected `plugin_action_summary`. Any fix should generalize (e.g., "when a resource is specified by an opaque id/URL fragment rather than a name, do not fabricate a name") rather than "for Google Sheets gid, do X".

---

## 5. How to start (evidence + DB pointers)

All evidence for this agent is already dumped under `c:/tmp/` (regenerate with the scripts below if missing). **Agent id:** `3fc703fd-9834-420d-af5b-026f62e25cbe`.

### Files already captured (from the prior session)
| File | Contents |
|---|---|
| `c:/tmp/agent-3fc703fd.json` | The saved agent: `user_prompt` (= the EP JSON with the `"Sheet1"` guess), `pilot_steps`, `input_schema` (the 8 dup fields). |
| `c:/tmp/agent-3fc703fd-aictx.json` | `agent_config.ai_context`: `original_prompt` (no URL), `enhanced_prompt`, `reasoning`, `confidence` (0.8). |
| `c:/tmp/agent-3fc703fd-creation-metadata.json` | `agent_config.creation_metadata` incl. `generated_plan.clarification_answers` (q1 = the gid=0 URL). |
| `c:/tmp/agent-3fc703fd-thread.json` | **The full thread record** — `metadata.iterations[]` is the phase-by-phase request/response log. **This is the primary artifact: it shows exactly how each Phase 2/3 turn handled the URL and where `"Sheet1"` first appears.** |

### The thread (the conversation record)
- **Thread row id:** `08c05035-c598-4839-bbe7-206be912e5df` in table `agent_prompt_threads` (linked via `agent_id`).
- **OpenAI thread id:** `thread_eCEaZduHIe06GOTWKsR2hIaQ` (provider `openai`, model `gpt-5.2`) — likely expired on OpenAI's side, but **you don't need it**: the full turn-by-turn log is in the local `agent_prompt_threads.metadata.iterations[]` (already dumped to `c:/tmp/agent-3fc703fd-thread.json`).
- **What to do:** walk `metadata.iterations[]` in order. For each iteration note `phase`, the `request` (what context the LLM got), and the `response` (what it produced). Find the first turn where `range`/`"Sheet1"` / a sheet-name appears, and read the surrounding LLM reasoning (`ai_reasoning` per turn is server-side telemetry — E6 — and may be present).

### DB re-query recipe (if you need fresh data / other agents)
```ts
// scripts/_tmp-*.ts pattern (delete after use). Env: dotenv from ../.env.local; supabaseServer service role.
// 1) agent row + ai_context + creation_metadata:
supabase.from('agents').select('*').eq('id', '3fc703fd-9834-420d-af5b-026f62e25cbe').single()
//    → agent_config.ai_context.{original_prompt, enhanced_prompt, generated_plan}
//    → agent_config.creation_metadata.generated_plan.clarification_answers
// 2) thread + full conversation:
supabase.from('agent_prompt_threads').select('*').eq('id', '08c05035-c598-4839-bbe7-206be912e5df').single()
//    → metadata.iterations[]  (phase-by-phase request/response — THE conversation)
```
- **`agent_prompt_threads` columns:** `id, user_id, openai_thread_id, status, current_phase, agent_id, created_at, updated_at, expires_at, metadata, ai_provider, ai_model, user_prompt`.
- The prior session's throwaway query scripts were removed (they lived at `scripts/_tmp-*.ts`); re-create with the recipe above and delete when done.

### Reproduce the guess live (optional, non-deterministic)
Because Phase 3 is one LLM call, you can re-run the flow at `/v2/agents/new` with the same prompt + the same q1 URL to see if it reproduces `"Sheet1"` — but emissions are non-deterministic. Prefer the persisted `iterations[]` for the actual authored value; use a live re-run only to test a prompt fix.

---

## 6. The overall goal + the ask

**Goal:** make the thread-based agent-creation flow capture a **usable Sheets range** when the user supplies a `gid=0` URL — so the downstream EP carries a value that reads the sheet on the first try, and neither V6, calibration, nor the user has to correct it.

**The ask for this session:**
1. **Find the RCA** — pin the exact phase + prompt/route logic that authored `"Sheet1"`, and explain *why* (the missing "gid ≠ tab-name / don't fabricate names from opaque ids" handling). Use the thread `iterations[]` as primary evidence.
2. **Suggest a fix** — decide among: emit a sheet-name-less range for `gid=0`; carry the `gid` as structured data and resolve downstream; or ask a parameter-aware question. Prefer a **general, non-hardcoded** rule (CLAUDE.md). Note the flow has no Sheets API, so it cannot resolve `gid → title` itself.
3. **Conclude before implementing** (same discipline as the prior RCA) — then propose the concrete change (v16 prompt edit and/or route/schema change) for approval.

**Out of scope for this session:** Defect B (`extractInputSchema` dup fields — owned by the concluded RCA's fix list); the V6 pipeline internals; the calibration side; the runtime executor robustness fix (a separate, parallel mitigation — the executor could resolve `gid → title` via `spreadsheets.get`, but that's a plugin-executor change, not EP production).

---

## 7. TL;DR for the new session

> Investigate the **V2 thread-based agent-creation flow** (`/v2/agents/new`, v16 prompt + `process-message` route). The user gave a spreadsheet as a `gid=0` URL (Phase 2 answer q1); the flow parsed the file id correctly but **fabricated the tab name `"Sheet1"`** into `resolved_user_inputs.google-sheets__table/get__range`, which later broke calibration (`Unable to parse range: Sheet1`). The v16 prompt models `range` as "a single sheet tab name" (L275) and has no handling for a gid/URL-position tab reference, so the LLM guessed Google's default. Primary evidence: `agent_prompt_threads` id `08c05035-…` → `metadata.iterations[]` (dumped to `c:/tmp/agent-3fc703fd-thread.json`); clarification answers in `agent_config.creation_metadata`. Load skills `agent-creation-flow` + `v6-pipeline`. Find the exact authoring point, then propose a general (non-hardcoded) fix: emit a sheet-name-less range for `gid=0`, or carry the gid as structured data for downstream resolution. Conclude the RCA before implementing.
