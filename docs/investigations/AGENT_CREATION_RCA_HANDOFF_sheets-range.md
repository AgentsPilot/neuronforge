# Handoff — Agent-Creation RCA for the "Sheet1" range failure

> **Created**: 2026-06-30
> **Purpose**: Self-contained context to start a NEW session investigating the **agent-creation / V6 generation** root cause behind a faulty agent. The downstream **calibration** RCA is already concluded (below); this handoff is to drive the *upstream* RCA — why generation produced the broken workflow in the first place.
> **Load these skills at the start of the new session**: `v6-pipeline` (generation), `agent-creation-flow` (the Enhanced Prompt that feeds generation), and `calibration-rca` (for the already-done downstream RCA + the evidence scripts).

---

## 1. The problem (one paragraph)

Agent `3fc703fd-9834-420d-af5b-026f62e25cbe` — **"High-Qualified Leads Email Summary Agent"** — was created on the Vercel sandbox and **failed calibration**. It reads a Google Sheet, filters leads to `stage == 4`, builds an HTML table, and emails it. At calibration, **step 1 (`google-sheets.read_range`) failed** because the `range` value was `"Sheet1"`, which the Sheets API rejected with **`Unable to parse range: Sheet1`** — i.e. the spreadsheet's first tab (the user gave a `gid=0` URL) is **not named "Sheet1."** Steps 2–4 then cascaded ("no input data"). The workflow runs, but never reads any data. **The agent was generated with a guessed sheet name instead of one derived from the user's input.**

---

## 2. The calibration RCA (already concluded — context only)

Done in the prior session; do not redo. Full method/runbook: `docs/Calibration/CALIBRATION_RCA_RUNBOOK.md`. Summary:

- **Earliest failing step:** `step1 google-sheets.read_range` (the rest cascade).
- **Why:** `range = "Sheet1"` → Sheets API `Unable to parse range: Sheet1`. High-confidence calibration `parameter_error` (confidence 0.95) with a `suggestedFix`.
- **Cascade:** step2 (rows_to_objects), step3 (filter), step4 (count) all failed with *"has no input data"*; step5–6 ran on empty → **the dry-run actually sent a real "no leads" email** (`execution_summary.data_written`).
- **Calibration behaved correctly:** honest `needs_review`, accurate fix hint. So "calibration failed" = "calibration correctly caught a real generation defect."
- **Layer classification:** *input/data symptom with a V6-generation root cause* → **this handoff.**

Evidence rows (DB): session `93aacae1-95b1-46b1-a0a7-2680c7b9a9ec`, history `05d2cc34-3f11-4ac1-ab64-fd0b3c846a2b`.

---

## 3. What to investigate (the agent-creation RCA ask)

**Drive RCA on WHY V6 generation produced `range: "Sheet1"`** (and the secondary smell below). The user's prompt *explicitly* gave the tab as `gid=0` ("the first tab in the provided link"), so the information to do better was present in the Enhanced Prompt — yet generation emitted the literal default name "Sheet1." Pin **which phase is responsible** and why.

Two distinct defects to root-cause:

### Defect A (primary) — the sheet range/name was guessed, not derived
- The EP `data` section says: *"Read the lead table from the sheet tab represented by gid=0 (the first tab in the provided link)."* The spreadsheet URL is `…/d/1pM8WbXtPgaYqokHn_spgQAfR7SBuql3JUtE1ugDtOpc/edit?gid=0`.
- Generation produced `range = "Sheet1"` (and surfaced it as the input `google-sheets__table/get__range` placeholder `"Sheet1"`). "Sheet1" is just Google's *default* tab name — a guess that breaks whenever the tab is renamed.
- **Questions to answer:**
  1. Where does `"Sheet1"` get introduced — Phase 1 IntentContract emission, the capability binder, the input-schema/EP-key-hints builder, or the compiler?
  2. Why wasn't the `gid=0` honored? A `gid` is a numeric tab id; the Sheets `values.get` range needs the *tab title* (or no sheet name → reads the first tab). Should generation (a) resolve `gid → title` via spreadsheet metadata, (b) emit a sheet-name-less range (reads the first tab), or (c) something else? This is the candidate fix decision.
  3. Is this an **EP-fidelity** miss (the EP carried `gid=0` but it was dropped) or an EP-*production* gap (the chat flow never turned the URL/gid into a usable range)? Check both the EP (agent-creation-flow) and the IntentContract (v6-pipeline).

### Defect B (secondary smell) — duplicate / mismatched input fields
- `input_schema` carries **two** sets for the same data:
  - the names the step references: `{{input.spreadsheet_id}}`, `{{input.sheet_range}}` (no defaults), AND
  - the EP-key-hint names that hold the resolved values: `google-sheets__table/get__spreadsheet_id` (`1pM8…`), `google-sheets__table/get__range` (`"Sheet1"`).
- Result: 8 inputs where 5 are real, ambiguity about which actually feeds `step1`. Likely an EP_KEY_HINTS ↔ step-reference wiring inconsistency (see `docs/v6/V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_INTENT_CONTRACT_EP_KEY_HINTS.md`). Didn't directly cause the failure (the value `"Sheet1"` reached the step) but it's a generation correctness bug worth pinning.

---

## 4. How to start (evidence + pointers)

```bash
# The workflow + the WP-55 generation fingerprint (Phase 1 emission + data_schema):
npx tsx scripts/dump-agent.ts 3fc703fd-9834-420d-af5b-026f62e25cbe   # → c:/tmp/agent-3fc703fd.json
# The calibration evidence (already analyzed; for reference):
npx tsx scripts/dump-calibration.ts 3fc703fd-9834-420d-af5b-026f62e25cbe
```

- **Key file to read first:** `c:/tmp/agent-3fc703fd.json` — `user_prompt` (the Enhanced Prompt, with the `gid=0` data section + `resolved_user_inputs`), `pilot_steps` step1 (`range: "{{input.sheet_range}}"`), and `input_schema` (the duplicate fields).
- **WP-55 fingerprint:** check `agents.agent_config.ai_context.intent_contract` (and `.data_schema`) — the Phase 1 emission that authored the range. If null (pre-WP-55 / sandbox), you may need to re-run the EP through `/api/v6/generate-ir-intent-contract` to capture it (non-deterministic — see the v6-pipeline skill's diagnosis notes).
- **Code anchors (per v6-pipeline skill):** `lib/agentkit/v6/intent/intent-system-prompt-v2.ts` (§ 5.5 EP FIDELITY, § 6.1 DATA_SOURCE), `CapabilityBinderV2`, the input-schema / EP_KEY_HINTS builder, `google-sheets-plugin-v2.json` (`read_range` param schema + `x-*` annotations).
- **Note on `read_range` robustness:** separately confirm whether the `google-sheets` executor *could* tolerate a missing/over-broad range by falling back to the first sheet — that's a runtime-layer mitigation option, distinct from the generation fix.

---

## 5. The overall goal

Make **agent creation generate a Sheets read that works without the user hand-correcting the tab name** — i.e. derive the correct range/tab from the user-provided URL+`gid` (or use a sheet-name-less range that targets the first tab), and **eliminate the duplicate input fields**. The success criterion: a fresh agent built from the same prompt reads the sheet on the first try, so **calibration has nothing to catch.** Per CLAUDE.md "fix at the root cause," the durable fix belongs in the V6 pipeline (and/or the EP that feeds it), not in calibration.

> **Parallel track (other session, already in progress):** a *calibration-side* improvement so that, IF this class still slips through generation, calibration can auto-repair the range (it already detects it at confidence 0.95). That mitigates; this handoff is the root-cause fix.

---

## 6. TL;DR for the new session

> Investigate why V6 agent creation emitted `range: "Sheet1"` for agent `3fc703fd` when the Enhanced Prompt explicitly specified the tab as `gid=0`. The Sheets API rejected `"Sheet1"` (tab not named that), failing calibration. Find the responsible phase (Phase 1 emission / binder / EP-key-hints / EP production), conclude the RCA, and decide the fix (resolve gid→title, or emit a sheet-name-less range). Also pin the secondary defect: duplicate input fields (`sheet_range` vs `google-sheets__table/get__range`). Goal: future agents read the sheet correctly with no calibration intervention. Start by reading `c:/tmp/agent-3fc703fd.json` and loading the `v6-pipeline` + `agent-creation-flow` skills.
