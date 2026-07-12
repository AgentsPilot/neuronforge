# RCA Conclusion — Agent-Creation "Sheet1" range failure

> **Created**: 2026-06-30
> **Agent**: `3fc703fd-9834-420d-af5b-026f62e25cbe` ("High-Qualified Leads Email Summary Agent")
> **Companion**: [AGENT_CREATION_RCA_HANDOFF_sheets-range.md](./AGENT_CREATION_RCA_HANDOFF_sheets-range.md) (the ask) · [CALIBRATION_RCA_RUNBOOK.md](../Calibration/CALIBRATION_RCA_RUNBOOK.md) (downstream, already concluded)
> **Status**: RCA concluded. Fix direction decided. **No code changed** (per the handoff: conclude before fixing).

---

## TL;DR

`range = "Sheet1"` was **not** introduced by the V6 pipeline. It was **authored by the agent-creation Phase 3 (the v16 Enhanced-Prompt prompt)** and sat in the EP's `specifics.resolved_user_inputs` as `{"key":"google-sheets__table/get__range","value":"Sheet1"}` **before V6 ever ran**. V6 and the V2 UI faithfully propagated that value to the step.

→ **Defect A is an EP-*production* gap, not an EP-fidelity miss and not a V6-phase emission bug.** The chat flow *did* convert the URL into a range — it just produced the wrong one: it treated `range` as "a single sheet tab name," saw a `gid=0` URL with no explicit title, and **hallucinated Google's default tab name "Sheet1."** The v16 prompt has zero handling for the "user gave a `gid`, not a tab title" case.

→ **Defect B (duplicate input fields) lives in `extractInputSchema()` in [app/v2/agents/new/page.tsx](../../app/v2/agents/new/page.tsx)** — it merges two key namespaces (clean `{{input.X}}` refs + namespaced `resolved_user_inputs` keys) deduped by *exact name only*, so `sheet_range` and `google-sheets__table/get__range` both surface as separate fields. The runtime `reconcileInputsToDsl` (WP-57) is what bridges them, which is why the `"Sheet1"` value still reached the step.

---

## Evidence chain (where `"Sheet1"` actually comes from)

1. **Original user prompt** (`agent_config.ai_context.original_prompt`) — *no spreadsheet URL at all*:
   > "I need a summary table of all high-qualified leads from my spreadsheet. Once filtered, please ensure the results are sent out to the end users using email channel."
   The URL `…/d/1pM8…/edit?gid=0#gid=0` was supplied during the Phase 2 question loop.

2. **Enhanced Prompt** (`ai_context.enhanced_prompt`, identical to `agents.user_prompt`) — the narrative is *correct*, the structured value is *guessed*:
   - `sections.data`: *"Read the lead table from the sheet tab represented by gid=0 (the first tab in the provided link)."* ✅ truth preserved
   - `specifics.resolved_user_inputs`:
     ```json
     { "key": "google-sheets__table/get__spreadsheet_id", "value": "1pM8WbXtPgaYqokHn_spgQAfR7SBuql3JUtE1ugDtOpc" },
     { "key": "google-sheets__table/get__range",          "value": "Sheet1" }   ← the guess
     ```
   The EP parsed the URL's *file id* correctly but resolved `gid=0` → `"Sheet1"`.

3. **V6 + V2 UI propagation** — `extractInputSchema()` Source 2 copies `resolved_user_inputs` verbatim into an input field (`placeholder: "Sheet1"`); the compiled step references `{{input.sheet_range}}`.

4. **Runtime** — `reconcileInputsToDsl` (WP-57) routes the namespaced value `google-sheets__table/get__range="Sheet1"` onto the step's `{{input.sheet_range}}` (match by `step.plugin === "google-sheets"`, stem `range ≡ range`). `"Sheet1"` reaches the Sheets API → `Unable to parse range: Sheet1` → calibration `parameter_error` (0.95).

**WP-55 fingerprint note:** this agent predates WP-55 persistence — `agent_config.ai_context.intent_contract` and `.data_schema` are `null`. The IntentContract's own emission could not be inspected directly, but it is **not the value source**: the value provably originates in the EP's `resolved_user_inputs` (step 2) and flows through the V2 UI's `extractInputSchema` Source 2 + runtime reconciliation, independent of whatever default Phase 1 attached to its `sheet_range` config key.

---

## Defect A — root cause: the v16 prompt models `range` as a tab *name* and guesses when given a `gid`

**Locus:** [app/api/prompt-templates/Workflow-Agent-Creation-Prompt-v16-chatgpt.txt](../../app/api/prompt-templates/Workflow-Agent-Creation-Prompt-v16-chatgpt.txt) (the agent-creation Phase 3 / EP producer). Owner skill: **agent-creation-flow**.

What the prompt does today:
- It extracts external resource identifiers (sheet names, tab names) from the user prompt and resolves them into `resolved_user_inputs` (lines ~158–164, ~268, ~305).
- It explicitly frames `range` as a **single sheet tab name** (line 275: ``range (string — single sheet tab name)``) and pushes the LLM to elicit/produce *one concrete tab name* (lines 273–277).

What it lacks — the gap:
- **No rule for parsing a spreadsheet URL into `spreadsheet_id` + `gid`** (it got the id right, the gid wrong).
- **No rule that a `gid` is a numeric tab *id*, not a tab *title*** — and that the title is *unknowable at chat time* (no Sheets API access during EP production).
- So the LLM, told to fill a "tab name" slot and lacking a real title, **defaults to Google's first-tab name "Sheet1."** A guess that breaks the moment the tab is renamed (which it was here).

**Classification:** EP-production gap. EP-fidelity into the *narrative* was correct; the *structured* `resolved_user_inputs` value was fabricated. V6 generation behaved correctly (faithful propagation).

---

## Defect B — root cause: `extractInputSchema()` merges two key namespaces without reconciliation

**Locus:** [app/v2/agents/new/page.tsx](../../app/v2/agents/new/page.tsx) `extractInputSchema()` (lines 119–184).

It builds the top-level `input_schema` from two sources, deduped by **exact key name** (`seenNames`):
- **Source 1** — scans `workflow_steps` for `{{input.X}}` → clean keys the DSL actually references: `spreadsheet_id`, `sheet_range`, `qualification_match_value`, `qualification_column_name`, `email_subject` (all `placeholder: ''`, no value).
- **Source 2** — iterates `resolved_user_inputs` → namespaced keys that carry the resolved values: `google-sheets__table/get__spreadsheet_id`, `google-sheets__table/get__range` (`"Sheet1"`), `google-mail__email/send_message__recipients`.

Because `sheet_range` ≠ `google-sheets__table/get__range` as exact strings, both survive dedup → **8 fields where 5 are logically distinct** (the 2 plain keys `qualification_*` collide and dedup correctly; the 3 prefixed ones don't). The stale comment at line 146 ("V6 compiler hardcodes resolved values into steps, so `{{input.*}}` patterns won't exist") is the faulty assumption — the compiler emits `{{input.sheet_range}}`, so **both** sources fire.

This didn't cause the failure (WP-57's `reconcileInputsToDsl` still bridged the value), but it's a real correctness/UX smell: redundant fields, the value-bearing field is the namespaced one while the DSL references the clean one, and the clean field is surfaced `required: true` with no value.

---

## Fix direction (decided — not implemented)

### Defect A — two layers, root-cause-first

| Layer | Change | Why |
|---|---|---|
| **Root cause — v16 prompt (agent-creation Phase 3)** | When a spreadsheet URL carries a `gid` but **no explicit tab title**, the EP must **not fabricate a tab name**. For `gid=0` → emit a **sheet-name-less range** (e.g. `A:Z`) which the Sheets API resolves to the first/default tab — matching the narrative's own "first tab" semantics. For a non-zero `gid`, carry the `gid` through as structured data rather than guessing a title (resolution deferred to runtime). | Stops the bad value being authored at all. The chat LLM has no Sheets API, so it must never invent a title. Plugin-agnostic, no hardcoding — `range` already documents sheet-name-less A1 notation (`'B2:E5'`). |
| **Durable runtime guard — google-sheets executor** | In `readRange` ([lib/server/google-sheets-plugin-executor.ts](../../lib/server/google-sheets-plugin-executor.ts)), when `range` has a sheet-name prefix that fails to parse (or a `gid` is supplied), resolve it via `spreadsheets.get` metadata (the executor already enumerates sheets at L378 for `get_or_create_sheet`) and fall back to the first visible sheet. | Works for **any** `gid`, deterministic, plugin-scoped. Guarantees "reads on the first try" even if a future EP still slips a bad tab name. This is the belt-and-suspenders that makes calibration have nothing to catch. |

**Recommendation:** ship the prompt guard (prevents authoring) **and** the executor resolution (catches any residual). The executor change is the stronger single durable fix because it covers arbitrary `gid` and removes the LLM's need to guess.

> Note: this is **agent-creation-flow + plugin-executor** territory, *not* a V6-pipeline change. V6 did its job. Do **not** add sheet-specific logic to the V6 compiler/binder (CLAUDE.md "no hardcoding").

### Defect B — reconcile namespaces in `extractInputSchema`

Make Source 2 reconcile namespaced `resolved_user_inputs` keys against the Source-1 clean `{{input.X}}` refs using the **same WP-57 logic** (`parseNamespacedKey` + `stemOf` from [lib/pilot/reconcileInputsToDsl.ts](../../lib/pilot/reconcileInputsToDsl.ts)): when a namespaced input maps onto an existing clean field (same plugin/stem), **fill that field's default/placeholder** instead of adding a duplicate field. Delete/correct the stale line-146 comment. Result: 5 fields, each value-bearing, no namespace leakage into the UI.

---

## Answers to the handoff's explicit questions

1. **Where is `"Sheet1"` introduced?** In **EP production (agent-creation Phase 3, v16 prompt)** — it's in `resolved_user_inputs` before V6 runs. Not Phase 1 emission, not the binder, not the compiler.
2. **Why wasn't `gid=0` honored?** The v16 prompt models `range` as "a single sheet tab name" and has no rule for the `gid`-without-title case, so the LLM filled the slot with the default name "Sheet1." The Sheets `values.get` range needs a tab *title* (or no sheet name → first tab); a `gid` is a numeric id the chat LLM can't resolve to a title.
3. **EP-fidelity miss or EP-production gap?** **EP-production gap.** The narrative carried `gid=0` faithfully; the *structured* resolved value was a guess. V6 fidelity was fine.
4. **Defect B owner?** The V2 UI's `extractInputSchema()` (dedup-by-exact-name across two key namespaces). The runtime `reconcileInputsToDsl` masks it at execution time.
