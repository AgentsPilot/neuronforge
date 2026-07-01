# EP-Production RCA Conclusion — the "Sheet1" range fabrication

> **Created**: 2026-07-01
> **Agent**: `3fc703fd-9834-420d-af5b-206be912e5df` ("High-Qualified Leads Email Summary Agent")
> **Scope**: The V2 thread-based agent-creation flow (`/v2/agents/new`, v16 prompt Phases 1→2→3). Why the chat flow turned a `gid=0` spreadsheet URL into the guessed tab name `"Sheet1"`.
> **Companions**: [EP_PRODUCTION_RCA_HANDOFF_sheets-range.md](./EP_PRODUCTION_RCA_HANDOFF_sheets-range.md) (the ask) · [AGENT_CREATION_RCA_CONCLUSION_sheets-range.md](./AGENT_CREATION_RCA_CONCLUSION_sheets-range.md) (the concluded V6/downstream RCA — not re-done here).
> **Status**: RCA concluded. Fix direction decided. **No code changed** (conclude-before-implement discipline).

---

## TL;DR

`range = "Sheet1"` was authored by **Phase 3 (Enhanced-Prompt production)** of the v16 agent-creation prompt. The thread's `metadata.iterations[]` proves it: the **first appearance of `"Sheet1"` anywhere** is the Phase-3 *response* in **iter 7**, and it recurs identically in the second Phase-3 production (**iter 10**, the saved EP). In **the same response** that fabricated `"Sheet1"`, the model wrote the *truth* in prose — `"Read the lead table from the sheet tab represented by gid=0 (the first tab in the provided link)."` So the model **knew** it was `gid=0` / first tab; it fabricated a name only when forced to emit a concrete value into the schema-constrained `resolved_user_inputs`.

The fabrication is **systematic, not a one-off** — it happened independently on both Phase-3 calls. The root cause is a **prompt/design gap**, driven by three reinforcing pressures and one missing rule.

---

## Evidence chain (thread `08c05035-…`, `metadata.iterations[]`)

| Iter | Phase | What happened | `Sheet1`? | `gid`? |
|---|---|---|---|---|
| 0 | 1 | Diagnostic narrative. Original prompt has **no URL**. | — | — |
| 1 | 2 | First clarification question (q1 asks for the sheet). | — | — |
| 2 | 2 | **User answers q1 with the URL** `…/edit?gid=0#gid=0`. Flow consumes it, asks q2 (qualification). **Never asks for a tab name.** | — | ✅ (req) |
| 3–6 | 2 | q3–q5 (column, scope, recipients). No tab-name question. | — | — |
| **7** | **3** | **First EP production. `"Sheet1"` first appears — in `resolved_user_inputs`, while prose says `gid=0 (first tab)`.** | ✅ **(res)** | ✅ |
| 8–9 | 2 | Mini-cycle (user feedback "stage = 4"). Requests carry the **already-authored** EP with `"Sheet1"` back in. `phase2_done`. | ✅ (carried) | ✅ |
| 10 | 3 | **Second EP production (the saved agent). `"Sheet1"` again**, key now `google-sheets__table/get__range`. | ✅ **(res)** | ✅ |

- **First authoring point:** iter 7, Phase 3 response, `resolved_user_inputs[key="google-sheets__read_range__range"].value = "Sheet1"`.
- **Saved value:** iter 10, Phase 3 response, `resolved_user_inputs[key="google-sheets__table/get__range"].value = "Sheet1"` (key-namespace variant, same fabricated value).
- **The signal survived in prose, was fabricated in structure:** every Phase-3 `sections.data` bullet correctly says `gid=0 (the first tab in the provided link)`. Only the machine-readable slot became `"Sheet1"`.
- **Phase 2 never asked for a tab name** — correctly, per the PACING rule (the info to read the first tab was already present as `gid=0`). The defect is entirely in how Phase 3 *materialized* that known fact into a value.

---

## Root cause — why Phase 3 felt entitled to invent a tab name

Three reinforcing pressures pushed the model to fill the range slot with a name, and one missing rule left fabrication as the only path:

### Pressure 1 — the prompt mis-frames `range` as "a single sheet tab name"
`Workflow-Agent-Creation-Prompt-v16-chatgpt.txt` **L275**:
> `If a parameter has a constraint (e.g., `range (string — single sheet tab name)`), phrase the question to elicit that specific format.`

This is **factually wrong about the parameter**. Google Sheets `range` is **A1 notation**, and the sheet name is **optional** — `'B2:E5'` (no sheet) reads the default/first tab. The "single sheet tab name" mischaracterization originates in the EP-Key-Hints design ([EP_KEY_HINTS.md](../v6/V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_INTENT_CONTRACT_EP_KEY_HINTS.md) L29, L159, L161, L172, L290). It teaches the model: *range = a tab name* → so, lacking a real title, it emits a bare tab name (`"Sheet1"`), not A1 notation.

### Pressure 2 — the real plugin hint leads with `Sheet1!`
The actual injected `plugin_action_summary` (iter 8 request) is correct A1 notation but **primes the token**:
> `*range (string — e.g., 'Sheet1!A1:D10', 'Data!A:C', or 'B2:E5')`

Sourced from [google-sheets-plugin-v2.json](../../lib/plugins/definitions/google-sheets-plugin-v2.json) L81. `Sheet1` is the first, most salient example — the statistically-obvious default when the model must invent one.

### Pressure 3 — Phase 3 rules MANDATE resolving every resource identifier to a concrete value
v16 **L495–499** and **L697 (rule #10)** force it:
> "you MUST add it to `resolved_user_inputs` even if it was never listed in `user_inputs_required`" … "If the identifier is used but missing from `resolved_user_inputs`, add it."

So the model is *required* to emit a concrete value for the tab/range slot — it cannot leave it blank.

### The missing rule (the actual gap)
Nowhere in v16 (or the plugin hint) is there a rule that:
- a `gid` (URL fragment) is an **opaque numeric id**, not a human-readable title;
- the title is **unknowable at chat time** (the flow has **no Sheets API** to resolve `gid → title`);
- a **sheet-name-less range** (`A:Z`) validly reads the first/default tab — the exact semantics of `gid=0`;
- therefore the model must **never fabricate a name** for a resource the user gave only as an opaque id.

Result: mandated to produce a value (P3), framed to produce a *name* (P1), primed with `Sheet1` (P2), and given no permission to emit a name-less range or defer — the model does the only thing left: it guesses Google's universal default tab name, **`"Sheet1"`**. It breaks the instant the tab is renamed, which it was.

---

## Answers to the handoff's explicit questions

1. **Which phase authored `"Sheet1"`?** **Phase 3 (EP production)**, iter 7 response, and again iter 10 (saved). Not a Phase 2 turn — Phase 2 only carried the raw URL. Confirmed against `iterations[]`.
2. **Why did the flow feel entitled to invent a tab name?** The v16 prompt (L275) mis-frames `range` as "a single sheet tab name", the injected plugin example leads with `Sheet1!`, and L495–499/L697 *mandate* a concrete resolved value — with **no rule** for "user gave a `gid`, not a title" and **no permission** to emit a name-less range or defer. So the model fabricated the default name.
3. **Ask, defer, or emit a name-less range?** **Emit a name-less range.** The correct value is present (`gid=0` = first tab); a sheet-name-less A1 range (`A:Z`) reads exactly that. Asking is wrong (PACING bias + info already present); deferring is unnecessary for `gid=0` (though right for a **non-zero** gid the model can't position-resolve).
4. **Sheets-specific or a general class?** **General class.** Any resource the user supplies as an opaque id / URL fragment (Drive file/folder ids, calendar ids, channel ids, a non-zero sheet `gid`) risks the same "guess a human name from an id" fabrication. The fix must be a general "don't fabricate names from opaque ids" rule, **not** hardcoded Sheets logic (CLAUDE.md § No Hardcoding).

---

## Fix direction (decided — NOT implemented; awaiting approval)

Root-cause-first, all in the **agent-creation-flow** surface (v16 prompt), plugin-agnostic, no hardcoding.

| # | Change | Rationale |
|---|---|---|
| **1 (root)** | **Add a general anti-fabrication rule to v16 Phase 3.** When a resource is identified only by an **opaque id or URL fragment** (a `gid`, a numeric/opaque file id, an id with no user-given human name), the EP must **not fabricate a human-readable name**. It must emit the form the target API accepts from an id/position, or leave the value in `user_inputs_required` for later — **never guess a default name**. For a range whose tab is known only by `gid`/position, emit a **sheet-name-less A1 range** (e.g. `A:Z`) so the API reads the first/default tab. | Kills the fabrication at its source; generalizes to all opaque-id resources; no plugin names hardcoded (keyed off "opaque id / no user-given name", which the model already reasons about). |
| **2 (framing fix)** | **Correct the L275 example** so `range` is described as **A1 notation with an optional sheet name** (matching the real plugin schema), not "a single sheet tab name". Mirror the correction in the EP-Key-Hints design doc. | The current example actively *teaches* the fabrication (range = a bare tab name). The runtime plugin hint is already correct A1 notation; the prompt's illustrative example contradicts it. |
| **3 (out of scope here — cross-reference)** | The concluded RCA's **executor-level durable guard** (resolve `gid → title` via `spreadsheets.get` in `google-sheets-plugin-executor.readRange`, fall back to first visible sheet) remains the belt-and-suspenders for **arbitrary non-zero gids**. That's a **plugin-executor** change, not EP production — noted, not owned by this session. | The chat flow has no Sheets API, so it can only do the `gid=0`/name-less case deterministically; non-zero gids ultimately need runtime resolution. |

**Recommendation:** ship #1 + #2 together (prompt-only, low-risk, addresses the exact failure and the class). #1 makes the model stop guessing; #2 removes the mis-teaching that caused the guess. Flag #3 to whoever owns the plugin executor as the durable arbitrary-gid guarantee.

**Guardrails honored:** no hardcoded plugin/action names in the prompt (CLAUDE.md); fix at the root cause (Phase 3, where the value is authored); no new Phase 3 schema field required (name-less range fits the existing `range` string). FR12 live smoke test at `/v2/agents/new` required before declaring shipped; non-deterministic, so re-run the same prompt + `gid=0` URL and confirm a name-less range (not "Sheet1") is emitted.

---

## Out of scope (unchanged from handoff)

- **Defect B** (`extractInputSchema` duplicate input fields) — owned by the concluded RCA's fix list.
- **V6 pipeline internals** and the **calibration** side — both concluded, behaved correctly.
- **Executor `gid → title` runtime resolution** — parallel durable mitigation (plugin-executor territory), cross-referenced above as fix #3.
