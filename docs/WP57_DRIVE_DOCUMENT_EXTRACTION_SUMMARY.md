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
| _(this commit)_ | **2B Part 1 — Drive URL→ID tolerance** — Drive executor normalises URL-shaped id params (`folder_id`/`file_id`/`parent_folder_id`) to bare IDs at the dispatch entry point: `extractDriveId()` handles `/folders/{id}`, `/d/{id}`, `?id={id}`; bare IDs and `root` pass through. Backward compatible. +3 unit tests (folder URL, `/file/d/<id>/view`, bare-ID passthrough). |

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
- **Phase 1 is non-deterministic / often wraps the flow in a `decide` (empty-folder handling)** —
  regen step counts look small but the real flow is nested in the `else` branch.
- **Backward compatibility:** all V6-pipeline changes are *generation-time* (don't touch existing
  agents' stored DSLs); `download_file` is additive; the `read_file_content` change only affects
  `application/pdf` (garbage → real text) and nothing relied on the garbage.

---

## Next steps

| Step | What | Notes |
|------|------|-------|
| ~~2A~~ | ~~Strengthen the Phase-1 nudge~~ | ✅ Done — nudge now emits `extract`/`domain:document`, but exposed the binder bottleneck (below). |
| **2A′ (active)** | **B fix in `CapabilityBinderV2`:** (1) in `bind()`, scan steps recursively and mark each `data_source`/`fetch_content` step whose `output` feeds an `extract`/`domain:document` step; (2) thread that `Set<string>` through `bindSteps` → `bindStep`; (3) for a marked step, boost candidates whose output has `x-semantic-type: file_attachment` (+0.5) so `download_file` (1.5) beats `read_file_content` (1.0). Then add a binder unit test and re-regen to confirm `list_files → download_file → document-extractor`. | Plugin-agnostic (keys off the annotation, not names). Considered & rejected: just reorder the def (too blunt — breaks legit text reads). Edge: a Google Doc routed through document-extractor would prefer `download_file` (throws on native files) — but that's a misuse. Fallback: A (read+AI, text-only). |
| **2B (active)** | Fix the **link-vs-ID** folder bug (the binding placeholder is already fixed; the folder is supplied as a *link* but the action needs a bare *ID*). **Part 1 — executor URL tolerance ✅ Done:** Drive executor normalises URL-shaped id params (`folder_id`/`file_id`/`parent_folder_id`) to bare IDs at dispatch (`extractDriveId`); bare IDs unchanged → backward compatible; +3 unit tests. **Part 2 (next) — value routing:** ensure the user's folder reaches `folder_id` (set `folder_id` in the scenario config; broader: EP/grounding should populate `folder_id` from the folder link). | Required for Phase E to list the Receipts folder, not the Drive root. Part 1 done; Part 2 next (plumbing). |
| **2C** | Regenerate the scenario snapshot (new IC + data_schema + DSL); review + commit | Phase 1 non-deterministic — may take a couple runs |
| **2D** | Phase A — execution simulator on the new DSL | |
| **2E** | Phase D — mocked WorkflowPilot on the new DSL | |
| **2F** | Phase E — live run (real Drive, real download→extract, **real email to `meiribarak@gmail.com`**) | Outward-facing |

**Note:** the Drive Receipts folder currently holds 3 **PDFs** (no image). To exercise the
image→Textract path live in Phase E, add an image receipt to that folder.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-06-14 | 2B Part 1 done | Drive executor URL→ID tolerance (`extractDriveId` / `normalizeDriveIdParams`) + 3 unit tests (30/30 pass). Part 2 (value routing) next. |
| 2026-06-14 | 2B diagnosis refined | Binding placeholder already fixed (DSL binds `{{input.folder_id}}`). Real remaining bug = link-vs-ID mismatch: folder supplied as a URL (`folder_link`, email-only), `list_files` needs a bare `folder_id`, executor doesn't parse URLs, nothing derives ID from link → lists Drive root. Fix in two parts: (1) executor URL→ID tolerance, (2) value routing. Strengthened §6.4 nudge committed `63f6ef2`. |
| 2026-06-13 | 2A outcome + B decision | Nudge made Phase 1 emit `extract`/`domain:document`, but the binder binds the fetch step to `read_file_content` (text) → reroute to AI. Decided on B (bytes-fetch preference when feeding a document extractor) over A (read+AI), because A fails for images/scanned. Next: investigate `CapabilityBinderV2`. |
| 2026-06-13 | Initial summary | Captures WP-57 work through commit `b449503` (T1 done; T2 next, starting at 2A). |
