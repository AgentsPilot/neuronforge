# WP-57 — Google Drive → Document Extraction: Work Summary

> **Last Updated**: 2026-06-13
> **Branch**: `fix/v6-drive-extractor-flow`
> **Authoritative WP**: [V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md § WP-57](./v6/V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md)

## Overview

Working summary for the effort to make the **"Google Drive Invoice Summary Email Agent"**
(`6ef48513-f49c-4635-b0dc-bdd9bf2f80a6`) actually extract invoice/receipt data from files in
a Drive folder. The live agent failed: it emailed "Extraction failed: missing …" for every
file, and listed the wrong files entirely. Root-causing this surfaced **WP-57** plus an
adjacent folder-binding defect. This doc tracks what's done, what's verified, the targets,
and the remaining steps.

---

## The problem (root causes)

1. **No base64 byte source for `document-extractor`.** `document-extractor` needs the file's
   bytes (base64). Drive `list_files` returns metadata only (id/name/mimeType/link, no bytes),
   and `read_file_content` did `.text()` on binary files — decoding a PDF's bytes as UTF-8 and
   **corrupting** them. So whichever path the pipeline picked, extraction got garbage.
2. **Phase 1 routing.** The IR converter's WP-12 heuristic rerouted `document-extractor` to an
   AI step when the input "didn't look like a file" (a fragile field-name check), and Phase 1
   inconsistently chose `read_file_content → AI` vs the document-extractor path.
3. **Folder never reaches the listing as a usable ID (adjacent bug, WP-53/56 family).** Two
   layers: (a) the *binding placeholder* — the compiled `list_files` once had **empty params**;
   that is now fixed (the DSL binds `folder_id: "{{input.folder_id}}"`). (b) The **link-vs-ID
   mismatch that remains:** a human supplies the folder as a **link** (`…/folders/1Wszlm9…`),
   which lands in `folder_link` and is used only for the email footer. The `list_files` action
   consumes a bare **`folder_id`**, and the executor uses it raw — **it does not parse a URL**.
   Nothing derives the ID from the link, and no `folder_id` value is provided at runtime, so
   `{{input.folder_id}}` resolves to nothing → `list_files` lists the **Drive root** (per its
   schema: "if not provided, lists from root or recent files"). This is the real cause of the
   original *"listed the wrong files entirely"* symptom. *(See Next Steps 2B.)*

---

## What we did (committed on `fix/v6-drive-extractor-flow`)

| Commit | Change |
|--------|--------|
| `df26bd8` | **Doc** — filed WP-57 in WEAK_POINTS + OPEN_ITEMS. |
| `cb7545f` | **`google-drive.download_file`** — new action: downloads raw bytes (`arrayBuffer → base64`, never `.text()`), returns `{ content (base64), mimeType, filename, file_id }` with `x-semantic-type: file_attachment`. Mirrors the proven Gmail-attachment shape. |
| `0af2489` | **Converter honors `semantic_type`** — `inputLooksLikeFileAttachment` now treats a slot annotated `semantic_type: file_attachment` as a file (authoritative, over the field-name heuristic), so `document-extractor` is kept instead of rerouted to AI. |
| `d08698b` | **Pipeline produces `list_files → download_file → document-extractor`** — (A) deterministic compiler **auto-insert**: when an extract step bound to a file-input plugin is fed a file *reference* without bytes, insert a `download_file` on the file's producer plugin and rewire; producer tracked through `data_source → filter/sort/dedupe/flatten → loop`. (B) Phase 1 nudge to fetch bytes first. Plus field alignment (`download_file` bytes in `content` to match document-extractor's `from_file_object: "content"`). |
| `06eb63f` | **E2E chain test** — `download_file` (Drive mocked) base64 → real `DeterministicExtractor` extracts a real PDF (invoice #677931). |
| `166318d` | **#2: `read_file_content` real PDF text** — for `application/pdf`, extract the text layer via `pdf-parse` instead of `.text()`-ing the binary; `export_format` reports the actual format. Backward compatible (only `application/pdf` changes; Google Docs / text files / other binaries unchanged). |
| `b7d5270` | **Image-coverage test** — data-driven block over every fixture (incl. images) via Textract OCR; existing PDF assertions pinned to the free pdf-parse path. |
| `b449503` | **Image fixture** — `Image_Receipt_hotel.png`. |
| `63f6ef2` | **Firm Phase-1 nudge** — §6.4 IC guidance hardened from "prefer" to a rule: binary documents (PDF/image/scanned) MUST use an `extract`/`domain:document` step; adds a WRONG/RIGHT anti-pattern; native text sources remain the only exception. Plugin-agnostic. |
| `85d63bd` | **2B Part 1 — Drive URL→ID tolerance** — Drive executor normalises URL-shaped id params (`folder_id`/`file_id`/`parent_folder_id`) to bare IDs at the dispatch entry point: `extractDriveId()` handles `/folders/{id}`, `/d/{id}`, `?id={id}`; bare IDs and `root` pass through. Backward compatible. +3 unit tests (folder URL, `/file/d/<id>/view`, bare-ID passthrough). |
| _(uncommitted)_ | **2B Part 2 — execution-time input reconciliation** — new `lib/pilot/reconcileInputsToDsl.ts`, called once at the top of `WorkflowPilot.execute()` (after steps are parsed, before `createExecution`/`ExecutionContext`). For each action step's unmet `{{input.X}}`, routes a value under a step-tagged namespaced key (`{plugin}__{capability}__{param}`) into `X` — match by `step.plugin`, stem disambiguation (`folder_link`≡`folder_id`≡`folder`), **fills missing keys only** (backward-safe), walks nested blocks (`then/else_steps`, `loopSteps`, `steps`, `scatter.steps`). Part 1 then extracts the bare ID. Plugin-agnostic, pure (no mutation). +9 unit tests. |

**Held (uncommitted) in the working tree:**
- `intent-system-prompt-v2.ts` — a refined Phase-1 nudge ("prefer document extractor") — pending the **2A** decision.
- `scenarios/drive-invoice-summary-extractor/{enhanced-prompt,phase4-workflow-config}.json` — the user's agent-config updates (recipient → `meiribarak@gmail.com`, Receipts folder).

---

## Verification status

| Claim | Verified by | Status |
|---|---|---|
| `download_file` returns canonical base64 (round-trips) | unit test | ✅ |
| Auto-insert produces `list_files → download_file → document-extractor` | FIRE test (deterministic recompile) | ✅ |
| `download_file` base64 → `document-extractor` extracts a real PDF | e2e chain integration test | ✅ |
| `read_file_content` extracts **real** PDF text (not garbage) | unit test + **real receipts** via production path | ✅ |
| `document-extractor` supports **images** (Textract OCR) | real hotel-receipt PNG → `$232.96 / Feb 25 2026` | ✅ |
| Drive executor accepts a pasted folder/file **URL** (extracts bare ID) | unit tests (folder URL → query ID; `/file/d/<id>/view` → file ID; bare ID unchanged) | ✅ |
| Step-tagged `folder_link` is routed onto an unmet `{{input.folder_id}}` | unit tests (`reconcileInputsToDsl`, 9/9 incl. stem match, no-overwrite, nested, no-mutation) | ✅ |
| Integration suite passes on **all fixtures** incl. the image | `document-extractor-all-invoices` (10/10) | ✅ |
| No regression on existing extract scenarios | recompiled drive-invoice / expense-invoice / orders-po — no spurious inserts | ✅ |
| Phase 1 emits an `extract`/`domain:document` step | 2A nudge | ✅ (the strengthened nudge worked at the IC level) |
| **Compiled DSL reaches `download_file → document-extractor`** | 2A regen | ❌ **not yet** — the binder binds Phase 1's fetch step to `read_file_content` (text) → extract reroutes to AI → DSL is still `list_files → read_file_content → ai_processing`. See "2A outcome" below. |

---

## Targets

| # | Target | Status |
|---|--------|--------|
| T1 | `document-extractor` supports images; integration tests pass on all fixtures incl. the image | ✅ **Done** |
| T2 | Regenerate `scenarios/drive-invoice-summary-extractor` with the new IC + document-extractor and pass **Phase A, D, and E** | ⬜ In progress |

---

## Key findings & decisions

- **#2 likely makes the agent work for text-based PDFs** via the path Phase 1 already prefers
  (`read_file_content → AI`): real text now flows to the AI. The user's 3 Drive receipts are all
  text-based (clean text extracted).
- **#1 (document-extractor path) remains needed for scanned / image-only PDFs** — `pdf-parse`
  can't read them; only Textract OCR (via document-extractor) can.
- **2A outcome — the nudge worked, but the *binder* is the real bottleneck.** The strengthened
  §6.4 nudge made Phase 1 emit an `extract`/`domain:document` step (it wasn't before). But Phase 1
  also emits a `fetch_content` step before it, and the binder binds that to **`read_file_content`
  (text)** rather than `download_file` (bytes). So the extract consumes *text* → the converter
  reroutes it to `ai_processing`. Net DSL is still `list_files → read_file_content → ai_processing`.
- **Decision: pursue B (make document-extractor actually bind), not A (accept read+AI).** Reason:
  the read+AI path **fails for images / scanned PDFs** — `read_file_content` returns no text for
  those, so the AI gets nothing. A would leave the agent silently broken for exactly the
  image/scanned case Target 1 just enabled at the extractor level. B is the root-cause fix and
  covers both text and scanned/image. (A still works for text PDFs today via #2, so it remains the
  fallback if B proves too risky.)
- **The B rule (deterministic, plugin-agnostic):** when a `fetch_content` step's output is consumed
  by a document extractor, bind the fetch to the action whose **output is `x-semantic-type:
  file_attachment`** (bytes → `download_file`), not the text reader (`read_file_content`). Keys off
  the output annotation, no hardcoded plugin names. Likely a `CapabilityBinderV2` preference;
  converter is the fallback home.
- **Why the binder picks the text tool (root cause confirmed).** For a `fetch_content` step the binder
  finds **both** `read_file_content` and `download_file` as candidates and scores them **equally
  (1.0, exact match)** — a tie. The tie is broken by **definition order**: `read_file_content` is
  listed before `download_file` in the plugin JSON, so it wins. The choice is *non-semantic*.
  `bindStep` is single-step and explicitly has no downstream awareness (TODO at
  `CapabilityBinderV2.ts:322-324`: *"requires knowledge of next step's requirements"*). B fills that gap.
  Plain-English version: two tools both "get the file's content" — one returns text, one returns bytes —
  and the system grabs the text one just because it's listed first; the OCR tool needs bytes, so it loses.
- **2B Part 2 — the folder value never reaches the listing param (routing, not extraction).** The
  list step reads `{{input.folder_id}}`; at runtime that is a plain lookup of `inputValues.folder_id`
  ([ExecutionContext.ts:682](../lib/pilot/ExecutionContext.ts)). But the user's folder is delivered
  under a *different* label — `folder_link` / `google-drive__storage/list__folder_link` — so
  `inputValues.folder_id` is empty and `list_files` defaults to the Drive root. Part 1 (executor
  URL→ID) can't help because the value never arrives at `folder_id` in the first place. Extraction
  was already solved; **routing** is the gap.
  - **Why the compiler can't carry the fix.** `CompilationResult` does **not** return the merged
    config (the compiler's config merge is internal, exact-key-match only —
    [ExecutionGraphCompiler.ts:166-171](../lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts)). The
    saved `input_values` is **client/runtime-owned**: built from `resolved_user_inputs` (label
    `folder_link`), saved via `create-agent` / `save-inputs`, read back at run time
    (`run-agent`, `cron`, Phase E) as `agentConfig.input_values`. The DSL (`{{input.folder_id}}`)
    and the values (`folder_link`) only sit together **at execution time**.
  - **Fix (chosen): execution-time reconciliation — single chokepoint.** A plugin-agnostic helper
    `reconcileInputsToDsl(steps, inputValues)` in `lib/pilot/`, called once at the top of
    `WorkflowPilot.execute()` before `ExecutionContext` is built. For each step's unmet
    `{{input.X}}`, route a value **tagged for that same step** (the namespaced input key
    `{plugin}__{capability}__{param}` names the step) into `X`; Part 1 then extracts the bare ID.
    Primary match key = **the step** (`step.plugin`); a stem check (`stemOf('folder_id') ===
    stemOf('folder_link') === 'folder'`, stripping `_id`/`_link`/`_url`) disambiguates only when a
    step has more than one input. **Only fills MISSING keys** — exact-name matches are never
    overwritten, so every currently-working agent is byte-identical. Covers `run-agent`, `cron`,
    and the Phase E runner (all funnel through `execute()`), and repairs already-saved agents — no
    scenario-file patching, no per-plugin literals.
  - **Considered & rejected:** (a) rename the key in the scenario snapshot — deferral; the next
    generation re-emits `folder_link`. (b) Fix at agent-creation — the save path is client-driven
    and fragmented, and it wouldn't repair existing agents. (c) Compiler merge — can't carry the
    value to runtime (see above).
- **Phase 1 is non-deterministic / often wraps the flow in a `decide` (empty-folder handling)** —
  regen step counts look small but the real flow is nested in the `else` branch.
- **Backward compatibility:** all V6-pipeline changes are *generation-time* (don't touch existing
  agents' stored DSLs); `download_file` is additive; the `read_file_content` change only affects
  `application/pdf` (garbage → real text) and nothing relied on the garbage.
- **2C regen produced `download_file → document-extractor` WITHOUT the 2A′ binder fix.** The fresh
  regen (2026-06-15, `output/phase4-pilot-dsl-steps.json`) compiled `list_files → filter → decide →
  [scatter: download_file → document-extractor → with_fields] → aggregates → ai/generate →
  send_email`. The deterministic compiler auto-insert (`d08698b`) + the firmed §6.4 nudge (`63f6ef2`)
  got the extractor path on their own. **2A′ may be unnecessary** for this scenario — confirm on a
  couple more regens before closing it (Phase 1 is non-deterministic).
- **🔴 NEW (candidate WP-58) — multi-input AI/`generate` steps lose all but one input.** The email
  step (`compose_summary_email`) needs the invoice array **plus** the aggregates (`invoice_count`,
  `missing_vendor_invoices`, `missing_number_invoices`, `missing_total_invoices`) and `folder_link`.
  Traced through all phases:
  - **P1 IntentContract:** the `generate` step's `inputs` correctly lists the array + 4 aggregates,
    **but omits `folder_link`**.
  - **P3 IR (`node_12`):** node-level `inputs` carries all 5 (dependency tracking), **but the AI op
    binds only one** — `operation.ai.input: "extraction_results"` (a single scalar); the aggregates
    appear only as **prose** in `instruction`.
  - **P4 DSL (`step12`):** emitted as `ai_processing` with `input: {{extraction_results}}` only.
  - **Root cause A (grammar/converter/resolver):** `AIConfig` supports only `input?: string`
    ([declarative-ir-types-v4.ts:286-312](../lib/agentkit/v6/logical-ir/schemas/declarative-ir-types-v4.ts)),
    whereas `TransformConfig` has `input` **+ `additional_inputs?: string[]`** (lines 260-268). So a
    multi-input AI step can't be expressed; `IntentToIRConverter` drops the extra inputs to graph
    deps only, and `AIOperationResolver` ([AIOperationResolver.ts](../lib/agentkit/v6/compiler/resolvers/AIOperationResolver.ts))
    injects only `{{input_source}}` into the prompt. **Effect:** the 4 aggregate steps are *computed
    and correctly ordered* (they're real graph deps) but **never delivered to the model** — the LLM
    must re-derive count/sum/missing-lists from `extraction_results` alone.
  - **Root cause B (Phase 1):** `folder_link` was never declared as an email input; the compiler
    flagged it (`phase4-compiler-logs.txt`: *"1 unreferenced config key(s): [folder_link]"*). Even
    after fix A it won't appear unless declared.
  - **Bonus:** there is **no sum step** at all — the IC's single `compute_aggregates` was expanded
    only into the 4 outputs the email *declared* (count + 3 missing-lists), so the requested
    "Sum of total_amount" is purely LLM-derived too.
  - **Fix shape (plugin-agnostic):** add `additional_inputs?: string[]` to `AIConfig` (mirror
    transforms) → `IntentToIRConverter` populates it from the IC step's `inputs` → `AIOperationResolver`
    injects **each** input as a labelled `{{var}}` block in the prompt; and Phase 1 must declare
    config values referenced by a generate step (`folder_link`, a `total_sum` aggregate) as inputs.
    Real V6-pipeline enhancement (multi-input AI steps) — belongs in its own WP, not a downstream patch.
  - **Severity (revised after Phase E live run, 2026-06-15):** **DOWNGRADED to low-priority cleanup.**
    The live email came out complete: it **included the folder link** and a correct totals/Sum section.
    Why A & B don't bite in practice:
    - **B is not actually broken at runtime.** `extraction_results` carries no folder link, yet the
      email rendered `folders/1Wszlm9…`. Source = **runtime config scope**: the pilot's `ai_processing`
      exposes config keys (incl. `folder_link`) to the model even when not a *declared* input. So the
      LLM has it regardless of the IC omission.
    - **A is benign.** The LLM re-derives count/sum/missing-lists from the `extraction_results` array,
      so the email totals are right; steps 8–11 remain dead weight but break nothing.
    - **Net:** WP-58 is correctness-hygiene (drop or properly wire the dead aggregate steps; declare
      inputs so the data flow is honest), **not a blocker**. File it low-priority; don't rush.
- **🔴 NEW (candidate WP-59) — document-extractor FIELD QUALITY on real receipts (higher value than WP-58).**
  Surfaced only in the Phase E live run (deterministic extraction mode). The extractor *did* read all
  4 files incl. a PNG (Textract OCR, confidence 0.80–0.96), but field-level parsing is poor:
  | Field | Live example | Problem |
  |---|---|---|
  | `tax_amount` | `"One-time credit purchase1$50.00$50.00"`, `"es & fees"`, `"es & fees$14.20"` | **Garbage on every file** — wrong text region captured |
  | `due_date` | `"paidMarch 16, 2026"` | Prefix bleed from "Date paid" |
  | `invoice_number` | `"ATJYUG83 0001"` | Null char ` ` in OCR (`ATJYUG83 0001`) → merged with a space |
  | `total_amount` | `"$50.00"` vs `"35.00"` | Inconsistent format; declared `currency` but returned raw string |
  - **Dig (b) — findings (2026-06-15):**
    1. **Where the bogus `deterministic` param comes from:** Phase 1 IC sets `extract.deterministic =
       true` on the extract step → `IntentToIRConverter.convertExtract`
       ([IntentToIRConverter.ts:509-511](../lib/agentkit/v6/compiler/IntentToIRConverter.ts)) copies it
       to `genericConfig.deterministic` → it flows into the DSL action params. The plugin has **no
       `deterministic` param** (only `use_ai`), so it's silently ignored. Cleanliness bug, not the
       cause of the bad fields.
    2. **`use_ai: true` is NOT a quick win — it's a regression.** The executor
       ([document-extractor-plugin-executor.ts:125](../lib/server/document-extractor-plugin-executor.ts))
       maps `ocrFallback: !use_ai`, and the comment is explicit: *"If use_ai=true, we'd use LLM
       fallback (**not implemented yet**)."* So `use_ai:true` would **disable OCR** with no AI path to
       replace it — breaking image/PNG extraction entirely. The AI extraction path does not exist.
    3. **Real fix location:** field quality is inherent to the deterministic engine
       [lib/extraction/DeterministicExtractor.ts](../lib/extraction/DeterministicExtractor.ts) (+
       `SchemaFieldExtractor.ts`) — the OCR-text→field segmentation (e.g. capturing "Date paid"+date,
       or the tax region). Fixing tax/date accuracy means either **(a)** improving the deterministic
       field-matching heuristics, or **(b)** actually implementing the `use_ai` LLM-fallback path.
       Neither is a config flip.
  - **Why this matters more than WP-58:** the email *looked* fine only because the LLM summarizer
    smoothed over the garbage. If the agent's value is accurate invoice data, `tax_amount` is simply
    wrong. This is output correctness, not cosmetics. **Scope is real work (extractor engine), not a
    param tweak** — size accordingly.

- **🔴 NEW (WP-60) — folder-routing regression on a FRESHLY-CREATED agent (compile-time binding gap, distinct from 2B).**
  Surfaced 2026-06-16: a newly-created agent (`48d587d4`) run via batch calibration listed the **Drive root**, not the
  user's folder — the exact symptom 2B addressed, but a different root cause one layer up.
  - **Diagnosis (from dev.log):** the compiled `list_files` step has **no `folder_id` binding at all**. The compiler's
    param auto-binder ([ExecutionGraphCompiler.ts:6208-6247](../lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts)) third pass
    fuzzy-matches the action param `folder_id` against config keys via token-Jaccard (threshold **0.4**); the only folder-ish
    key is `folder_link`, and `{folder,id}`∩`{folder,link}`/`{folder,id,link}` = **0.333 < 0.4** → unbound → root. The
    namespaced `google-drive__list__folder_link` key is **not in the compiler's `workflowConfig`** (runtime-owned), so the
    binder never sees it.
  - **Why 2B didn't catch it:** 2B Part 2 (`reconcileInputsToDsl`) only fills an *existing* `{{input.folder_id}}` ref; 2B
    Part 1 (`extractDriveId`) only converts a URL already in `folder_id`. Both assume the compiler emitted a `folder_id`
    binding. Here it emitted none. **Why the WP-57 scenario passed:** its IntentContract config declared an explicit
    `folder_id` key (exact-match bind); the live creation flow emitted only `folder_link`.
  - **Fix ✅ IMPLEMENTED 2026-06-16 (compiler, uncommitted):** stem-aware match in `findBestConfigMatch`
    ([ExecutionGraphCompiler.ts](../lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts)) — a config key whose stem (trailing
    `id`/`link`/`url` dropped) equals the param's stem is a full match, so `folder_id` binds to `folder_link`. Emits
    `folder_id: {{config.folder_link}}`; runtime `StructuralRepairEngine` rewrites `{{config.X}}`→`{{input.X}}`, resolves to
    the URL, and `extractDriveId` converts URL→ID. Exact stem check (not a Jaccard relaxation) → `file_id`↔`sheet_id` and
    `invoice_id`↔`invoice_date` stay unmatched. +7 unit tests; typecheck clean.
  - **▶ Execution impact (next execution vs rebuild):** the compiler fix (A) **requires a DSL REBUILD** — it only affects
    future compilations, so the already-created agent stays broken until regenerated. **Decision (2026-06-17): ship A + B
    as layered defense** (same shape as 2B Part 1 + Part 2), so existing agents are repaired at runtime without a rebuild.

  - **✅ Chosen solution — combined A (compile-time) + B (runtime safety net):**
    | Layer | Role | Fires | Repairs existing agents? | Status |
    |---|---|---|---|---|
    | **A — compiler stem match** (`findBestConfigMatch`) | Fix-for-the-future: new agents compile `folder_id` bound, DSL correct on disk | agent creation / regen | ❌ (needs rebuild) | ✅ implemented (uncommitted) |
    | **B — runtime param-injector** (`WorkflowPilot.execute()`) | Safety net: bind unbound action params on the stored DSL at run time; repairs already-saved agents + catches future compiler misses | every `execute()` | ✅ yes | ✅ implemented (uncommitted) — `lib/pilot/injectUnboundActionParams.ts`, +12 tests |

  - **B design (decided defaults):** a **new, separate** function (keep `reconcileInputsToDsl` pure) run right after reconcile
    in `execute()`, with plugin-manager access:
    1. **Deterministic step targeting via the namespaced key.** Parse step-tagged input keys `{plugin}__{capability}__{param}`
       and match by **`plugin` + `capability`** to the action step (e.g. `google-drive__list__*` → the `google-drive`/`list_files`
       step). No string-similarity guessing about *which* step.
    2. **Schema-aware param pick.** Look up the step's action schema (via plugin manager). Pick the unbound param by the schema's
       own annotation first (the plugin marks the folder/resource-reference param); **fall back to a stem check only within that
       single already-identified step** (`folder_link`→`folder_id`) — a far narrower, safer use of the suffix heuristic than A's
       global fuzzy.
    3. **Conservative injection.** Only inject when there is exactly **one** unbound resource-ish param matching exactly **one**
       step-tagged key (no ambiguity); skip otherwise. Inject the value (URL) into `step.params[param]`; the executor's
       `extractDriveId` (2B-1) converts URL→ID. In-memory for that execution only (not persisted), like reconcile.
    4. **Backward-safe:** never overwrites a param already bound; no-op when nothing matches.
  - **Why B reduces the hardcoding concern (raised 2026-06-17):** B keys off the namespaced key's `plugin`+`capability` (a
    deterministic, system-generated mapping) for step targeting; the `id`/`link`/`url` suffix list survives only as a
    last-resort *param* tiebreaker inside one deterministically-chosen step — not as the primary matcher.
  - **Deepest root cause (not in scope, noted):** the creation flow tags the input `folder_link` while the action param is
    `folder_id`; if it emitted the action's real param name (`google-drive__list__folder_id`) everything would bind by exact
    match with **zero** heuristics at any layer. Bigger upstream change; doesn't repair existing agents. Tracked as a future option.
  - Full entry: [WEAK_POINTS § WP-60](./v6/V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md#wp-60-compiler-param-binder-cant-match-folder_id-to-folder_link-stem-so-list_files-defaults-to-drive-root).

---

## Next steps

| Step | What | Notes |
|------|------|-------|
| ~~2A~~ | ~~Strengthen the Phase-1 nudge~~ | ✅ Done — nudge now emits `extract`/`domain:document`, but exposed the binder bottleneck (below). |
| ~~2A′~~ (closed — moot) | ✅ **Closed 2026-06-16 — not needed.** The compiler auto-insert + firmed §6.4 nudge produce `download_file → document-extractor` on their own: confirmed by the user's fresh Phase-1 regen (2026-06-15) AND a deterministic re-compile (2026-06-16). The binder fix below is retained only as a historical note. Original plan: **B fix in `CapabilityBinderV2`:** (1) in `bind()`, scan steps recursively and mark each `data_source`/`fetch_content` step whose `output` feeds an `extract`/`domain:document` step; (2) thread that `Set<string>` through `bindSteps` → `bindStep`; (3) for a marked step, boost candidates whose output has `x-semantic-type: file_attachment` (+0.5) so `download_file` (1.5) beats `read_file_content` (1.0). Then add a binder unit test and re-regen to confirm `list_files → download_file → document-extractor`. | Plugin-agnostic (keys off the annotation, not names). Considered & rejected: just reorder the def (too blunt — breaks legit text reads). Edge: a Google Doc routed through document-extractor would prefer `download_file` (throws on native files) — but that's a misuse. Fallback: A (read+AI, text-only). |
| **2B (active)** | Fix the **link-vs-ID** folder bug (the binding placeholder is already fixed; the folder is supplied as a *link* but the action needs a bare *ID*). **Part 1 — executor URL tolerance ✅ Done:** Drive executor normalises URL-shaped id params (`folder_id`/`file_id`/`parent_folder_id`) to bare IDs at dispatch (`extractDriveId`); bare IDs unchanged → backward compatible; +3 unit tests. **Part 2 ✅ Done — value routing via execution-time reconciliation:** `reconcileInputsToDsl(steps, inputValues)` in `lib/pilot/reconcileInputsToDsl.ts`, called once at the top of `WorkflowPilot.execute()`. Routes a value tagged for a step (namespaced key `{plugin}__{capability}__{param}`) into that step's unmet `{{input.X}}` (match by step → stem disambig); fills MISSING keys only (backward-safe); Part 1 then extracts the bare ID. Single chokepoint → covers `run-agent`/`cron`/Phase E and repairs existing agents. +9 unit tests (39/39 with Part 1). See "2B Part 2" finding above for the full diagnosis + rejected alternatives. | Required for Phase E to list the Receipts folder, not the Drive root. Both parts done; ready for 2C regen. |
| ~~2C~~ | ~~Regenerate the scenario snapshot~~ | ✅ Done (2026-06-15) — fresh `output/` has IC + data_schema + IR + DSL; DSL now uses `download_file → document-extractor`. |
| ~~2D~~ | ~~Phase A — execution simulator on the new DSL~~ | ✅ Done — **14/14**, 0 errors (1 warning: `deterministic` param unknown to document-extractor). |
| ~~2E~~ | ~~Phase D — mocked WorkflowPilot on the new DSL~~ | ✅ Done (2026-06-15) — **12/12 steps, 0 failed** (harmless `execution_metrics` FK noise from the mock agent id). |
| ~~2F~~ | ~~Phase E — live run~~ | ✅ **Done (2026-06-15) — PASSED.** 13/13 steps, real email received with folder link + totals. 4 files incl. a PNG processed via Textract. Folder routing (2B) verified live. |
| **WP-58 (low priority)** | **Downgraded after live run.** Multi-input AI/`generate` cleanliness (root causes A+B). Benign in practice (runtime config scope + LLM re-derivation cover it). Fix = drop or properly wire the dead aggregate steps; add `additional_inputs` to `AIConfig` + populate in converter/resolver; declare `folder_link`/`total_sum` in Phase-1 IC. File in WEAK_POINTS + OPEN_ITEMS, no rush. | Grammar + IntentToIRConverter + AIOperationResolver + Phase-1 IC. |
| **WP-59 (candidate, higher value)** | **document-extractor field quality** — `tax_amount`/`due_date`/`invoice_number` mis-parsed in deterministic mode; compiler emits a bogus `deterministic` param (unknown to the plugin). Investigate where it's emitted + whether `use_ai: true` is a quick plugin-agnostic win. | See WP-59 finding above. Affects output correctness. **Digging now (b).** |

**Note:** the Drive Receipts folder currently holds 3 **PDFs** (no image). To exercise the
image→Textract path live in Phase E, add an image receipt to that folder.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-06-15 | Phase D+E passed; WP-58 downgraded, WP-59 filed | Phase D 12/12, Phase E **live PASS** (real email, folder link + totals present, 4 files incl. PNG via Textract; 2B folder routing verified live). Live evidence downgraded WP-58 to low-priority cleanup (folder_link reaches the LLM via runtime config scope; aggregates re-derived by the LLM — A/B break nothing). New WP-59 candidate filed: document-extractor field-quality (tax/date/invoice# mis-parsed in deterministic mode; bogus `deterministic` param emitted by compiler; `use_ai` may be the fix). Digging into the param path next. |
| 2026-06-15 | 2C/2D done + WP-58 candidate filed | Full regen produced `download_file → document-extractor` (2A′ likely moot). Phase A 14/14. Traced the email step's missing aggregate/`folder_link` inputs through P1→P3→P4: root cause A = AI ops are single-input by grammar (`AIConfig.input` only; no `additional_inputs`), so `IntentToIRConverter`/`AIOperationResolver` drop extra inputs to graph-deps/prose; root cause B = Phase-1 IC omits `folder_link`; bonus = no sum step. Documented as candidate WP-58 (decide after Phase D/E). |
| 2026-06-15 | 2B Part 2 SA review | Verdict **APPROVE-WITH-NITS**. Confirmed backward-safe (same-ref early return, fills-missing-only, pure), placement covers run-agent/cron/Phase E + resume (reconciled values persist via `createExecution`). Addressed: Finding 1 (Phase E DSL pilot simulator bypassed `execute()` → wired `reconcileInputsToDsl` into `scripts/test-dsl-pilot-simulator/index.ts` before context build, so 2D/2E exercise the real routing) and Finding 3 (recurse `SubWorkflowStep.workflowSteps`; +1 test → 10/10). **Deferred — Finding 2:** add the namespaced key's `capability` segment as a disambiguation tiebreaker for repeated-plugin steps (safe to omit now — ambiguity is skipped, no false routing; revisit before this matcher is relied on beyond Drive). |
| 2026-06-15 | 2B Part 2 implemented | `lib/pilot/reconcileInputsToDsl.ts` + wired into `WorkflowPilot.execute()` (after step parse, before `createExecution`/`ExecutionContext`). Match-by-step-plugin + stem disambig, fills missing keys only, pure, walks nested blocks. +9 unit tests; 39/39 with Part 1's Drive suite. Uncommitted — pending review. Next: 2C regen. |
| 2026-06-14 | 2B Part 2 designed | Diagnosed routing gap (folder delivered as `folder_link`, DSL reads `{{input.folder_id}}`; never bridged). Compiler can't carry the fix (`input_values` is client/runtime-owned). Chosen fix: execution-time `reconcileInputsToDsl` in `WorkflowPilot.execute()` — match-by-step, fills missing keys only, repairs existing agents. Documented; implementing next. |
| 2026-06-14 | 2B Part 1 done | Drive executor URL→ID tolerance (`extractDriveId` / `normalizeDriveIdParams`) + 3 unit tests (30/30 pass). Part 2 (value routing) next. |
| 2026-06-14 | 2B diagnosis refined | Binding placeholder already fixed (DSL binds `{{input.folder_id}}`). Real remaining bug = link-vs-ID mismatch: folder supplied as a URL (`folder_link`, email-only), `list_files` needs a bare `folder_id`, executor doesn't parse URLs, nothing derives ID from link → lists Drive root. Fix in two parts: (1) executor URL→ID tolerance, (2) value routing. Strengthened §6.4 nudge committed `63f6ef2`. |
| 2026-06-13 | 2A outcome + B decision | Nudge made Phase 1 emit `extract`/`domain:document`, but the binder binds the fetch step to `read_file_content` (text) → reroute to AI. Decided on B (bytes-fetch preference when feeding a document extractor) over A (read+AI), because A fails for images/scanned. Next: investigate `CapabilityBinderV2`. |
| 2026-06-13 | Initial summary | Captures WP-57 work through commit `b449503` (T1 done; T2 next, starting at 2A). |
