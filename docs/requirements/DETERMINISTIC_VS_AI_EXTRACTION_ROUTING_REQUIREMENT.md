# Requirement: Deterministic-vs-AI Extraction Routing — Ordered Coverage-Then-Fallback (WP-57 family)

> **Last Updated**: 2026-07-12

**Created by:** BA
**Date:** 2026-07-12
**Status:** Draft
**Target branch:** `agent-failure-troubleshooting` (existing branch — per user, NO new feature branch is created for this cycle)
**Source investigation:** [`AGENT_RCA_CONCLUSION_gmail-expense-attachment-ai-extract.md`](/docs/investigations/AGENT_RCA_CONCLUSION_gmail-expense-attachment-ai-extract.md) (see §§ 8, 10, 11, 12)

## Overview

Two same-owner, same-task Gmail → receipt-attachment expense agents were generated with **byte-for-byte identical pipeline structure** (`search_emails → flatten → filter → scatter[get_email_attachment → extract]`). One (`0ee53785`) correctly bound the deterministic `document-extractor.extract_structured_data` plugin for field extraction; the other (`95f791ed`) fell back to the AI branch (`ai_processing` / `llm_extract`) **even though the same suitable deterministic plugin was connected and genuinely covered the extraction**. The RCA (V6-generation layer) pins the cause to the sole non-deterministic phase: the deterministic-vs-AI choice is effectively decided by how the **Phase-1 IntentContract** happened to phrase the extract step (input-ref granularity + field framing), not by reliable downstream code. The reliable stages (`CapabilityBinderV2` / `IntentToIRConverter`) do **not** enforce "prefer the deterministic plugin whenever one genuinely covers the case."

This requirement makes the deterministic-vs-AI extraction choice an **ordered, reliable-code decision** that **preserves the AI safety net**. The primary and hardest deliverable this document must pin down is the **coverage judgment**: the criteria by which reliable code decides whether an identified deterministic plugin *genuinely covers* a specific extraction. Binding mechanics are the easy part; the coverage judgment is the substance.

This is a requirements document only. It describes the business problem, the coverage-judgment criteria, and acceptance criteria — it does not prescribe the technical design (which deterministic stage owns the decision, the exact data structures, the schema-matching algorithm). Those are flagged for the SA, who must design within the V6 Work Protocol and Design Principles.

---

## Table of Contents

1. [Problem & Motivation](#problem--motivation)
2. [Goals & Non-Goals](#goals--non-goals)
3. [The Required Ordered Decision](#the-required-ordered-decision)
4. [Coverage-Judgment Criteria (primary focus)](#coverage-judgment-criteria-primary-focus)
5. [Functional Requirements](#functional-requirements)
6. [Non-Functional Requirements](#non-functional-requirements)
7. [Existing System Grounding](#existing-system-grounding)
8. [V6 Protocol Compliance](#v6-protocol-compliance)
9. [Assumptions](#assumptions)
10. [Acceptance Criteria](#acceptance-criteria)
11. [Out of Scope / Future Roadmap](#out-of-scope--future-roadmap)
12. [Open Questions](#open-questions)
13. [References](#references)
14. [Change History](#change-history)

---

## Problem & Motivation

The deterministic `document-extractor` plugin performs OCR-based structured extraction **without AI** — no token cost, no fabrication risk, deterministic output. The AI `convertExtract` branch (`llm_extract`) is a deliberate **safety net** for cases the deterministic extractor genuinely cannot handle (unsupported formats, field types it cannot produce, out-of-coverage document shapes).

Today, for a file/attachment extraction, **which of the two is used is non-deterministic** — decided by Phase-1 phrasing rather than reliable code. The proven failure (`95f791ed`) is the **inversion**: a genuinely-covering deterministic plugin was available, yet the AI net was used anyway. Consequences:

- **Fabrication risk.** For image attachments (JPG/PNG) the AI branch receives base64 `data` as text with no OCR → fabricated field values (the WP-13/WP-16/WP-34 family). A "silent wrong answer," not a crash.
- **Cost/latency.** Even for PDFs, the AI path burns tokens and latency for something the deterministic extractor does for free.
- **Non-reproducibility.** Two identical agents behave differently. The WP-57 "Gmail works" contrast is only *sometimes* true.
- **Silent detection blind spot.** A PDF-only dry-run can pass (the LLM leans on `extracted_text`), so calibration would likely not flag it. It surfaces only on image attachments or as cost/fabrication drift.

The fix must **not** overcorrect into "force `document-extractor` whenever a file is present." That would destroy the AI net that legitimately handles uncovered cases — trading one silent failure for another (per V6 Design Principle 11: defense-in-depth must not hide failures). The correct shape is an **ordered conditional fallback** decided in reliable code, with the AI branch preserved unchanged as the last resort.

---

## Goals & Non-Goals

### Goals

| # | Goal |
|---|------|
| 1 | Move the deterministic-vs-AI extraction choice **out of Phase-1 phrasing and into a reliable deterministic stage** (`CapabilityBinderV2` / `IntentToIRConverter`), so a mis-phrased plan cannot flip a covered case to AI. |
| 2 | Define, precisely and testably, when an available deterministic plugin **genuinely covers** a given extraction — the **coverage judgment** (capability + requested fields + file type). This is the primary deliverable. |
| 3 | When a suitable deterministic plugin covers the case → **bind it deterministically**. |
| 4 | When **no** suitable deterministic plugin covers the case → **fall back to AI**, with the `convertExtract` AI branch preserved unchanged. |
| 5 | Make **both directions provable**: a covered case binds deterministically across repeated generations; an uncovered case still falls back to AI. |
| 6 | Keep the decision **plugin-agnostic** — schema-driven, no `if (plugin === 'document-extractor')` / `if (action === 'get_email_attachment')` branches (V6 Design Principle 6). |

### Non-Goals

| # | Non-Goal |
|---|---------|
| 1 | **Do NOT remove, bypass, or unconditionally override the `convertExtract` AI branch** (`IntentToIRConverter.ts` L682-704). It is the correct destination for genuinely-uncovered extractions and must remain intact. |
| 2 | **Do NOT force `document-extractor` (or any deterministic extractor) whenever a file/attachment is present.** Presence of a file is step 1 of the decision, not the whole decision. |
| 3 | Do NOT add plugin-specific or action-specific branches to generic V6 infrastructure. The coverage judgment must read plugin schemas as the source of truth. |
| 4 | Do NOT attempt to improve the deterministic extractor's per-field parse quality (that is WP-59 — out of scope here). |
| 5 | Do NOT relitigate the WP-55 IntentContract-persistence clobber; it is a separate item. It is only referenced here because it blocks reading the two ICs directly (see Open Questions Q5). |

---

## The Required Ordered Decision

The reliable-code decision, in order (AI = fallback of last resort). This restates RCA § 12 verbatim as the authoritative framing — **do not deviate**:

1. **Is this a document/file input?** (bytes-bearing / `file_attachment`-semantic slot)
2. **Does an available deterministic plugin GENUINELY COVER this specific case?** — right capability, supports the *requested fields*, right file type. **This coverage judgment is the hard part**, not the binding mechanics.
3. **If yes → bind the deterministic plugin.**
4. **If no suitable deterministic plugin was identified → fall back to AI** (net preserved, `convertExtract` AI branch unchanged).

The bug being fixed is the **inversion** of this order: step 2 is being answered by Phase-1 wording instead of by reliable code, so a covered case (both agents had a genuinely-covering plugin — RCA § 3) landed on AI.

---

## Coverage-Judgment Criteria (primary focus)

This is the substance of the requirement. "Genuinely covers" must be a **deterministic, schema-driven predicate** — call it `pluginCoversExtraction(extractStep, candidatePlugin, inputSchema)` — that returns true only when **all** of the following hold. The SA owns the exact algorithm/data structures; the BA defines the criteria and their pass/fail semantics.

| # | Criterion | Genuinely-covers when… | Does NOT cover when… |
|---|-----------|------------------------|----------------------|
| **CC-1 — Input is a document/file** | The extract step's input resolves to a bytes-bearing / file-attachment slot. | The input producer's schema exposes binary/bytes content (e.g. base64 `data`) or carries the `file_attachment` semantic signal, AND the extract's input ref points at (or is resolvable to) that bytes field. | The input is plain text / an object with only text markers (e.g. `emails[].body/subject/snippet`) and no bytes-bearing field — this is not a document extraction; AI or a text primitive is appropriate. |
| **CC-2 — Capability match** | An available (connected) deterministic plugin exposes a **capability whose purpose is structured extraction from a document/file** (declared as deterministic, non-AI). | A **connected** plugin advertises `extract_structured_data`-class capability declared as deterministic OCR/parse. ("Available" = connected at generation time; connectable-but-unconnected does NOT count this cycle.) | No **connected** plugin advertises a deterministic document-extraction capability at all → fall back to AI. |
| **CC-3 — Requested-field coverage** | The plugin's capability can **produce the fields the extract step requests**. | Every requested *document-surface* field can be produced by the capability's declared output/`fields` contract (schema-declared or accepted as free-form `fields` input the deterministic extractor fills). | The extract requests fields the deterministic capability cannot produce (e.g. a computed/derived/normalized/meta field like a categorization, a cross-record aggregate, or a field requiring reasoning) → those requested fields are out of coverage. **See CC-3a.** |
| **CC-3a — Meta/normalization field handling** | Requested set mixes pure document-surface fields with normalization/meta fields. | The pure document-surface fields are covered by the deterministic plugin AND the normalization/meta fields can be **split into a separate downstream step** (the working agent `0ee53785` pattern: deterministic `extract_structured_data` for surface fields + a separate `generate` step for normalization). | Extraction + normalization are **inseparably folded into one requested field set** such that no deterministic capability can produce it as-requested and the design does not split them → the extraction is not covered as-phrased; AI fallback (or an SA-designed split) applies. |
| **CC-4 — File-type support** | The plugin supports the input's file type(s). | The capability's declared accepted input types include the document's MIME/type (PDF/JPG/PNG/etc.), matching what the upstream producer yields. | The document is a type the deterministic capability does not support → fall back to AI. |

**Decision rule:** bind the deterministic plugin **iff CC-1 ∧ CC-2 ∧ CC-3 (with CC-3a resolution) ∧ CC-4** all hold. Otherwise fall back to the AI branch. The judgment must be **conservative in the safe direction**: when coverage genuinely cannot be established from the schemas, fall back to AI (never fabricate coverage), and — symmetrically — never fall back to AI when coverage *is* schema-provable (the today-bug).

**Reference fingerprints from the proven pair (RCA § 11), to anchor the criteria:**

| Signal | Working `0ee53785` (deterministic bind — CC-* all pass) | Failing `95f791ed` (fell to AI — inversion) |
|--------|--------------------------------------------------------|---------------------------------------------|
| Extract input ref | `file_content = {{attachment_content.data}}` (bytes field) | `input = {{attachment_content}}` (whole object) |
| Requested fields | 5 pure document fields (`date_time, vendor, amount, currency, expense_type`) | 6 fields incl. meta (`notes`, `source_filename`); extraction+normalize folded |
| Normalization | separate `generate` step (step 7) | folded into one `llm_extract` |
| Outcome | `document-extractor.extract_structured_data` | `ai_processing / llm_extract` |

Both agents had a genuinely-covering plugin (RCA § 3), so the **correct** coverage-judgment outcome for **both** is: bind deterministic (surface fields) + split normalization. The criteria above must yield that verdict for both — that is the covered-case proof (AC-1). The uncovered-case proof (AC-2) requires a constructed scenario where CC-2, CC-3, or CC-4 genuinely fails.

---

## Functional Requirements

### A. Reliable-code routing decision (primary)

| # | Requirement |
|---|-------------|
| A1 | The deterministic-vs-AI extraction routing decision MUST be made in a **reliable deterministic stage** (`CapabilityBinderV2` and/or `IntentToIRConverter`), not left to Phase-1 IntentContract phrasing. |
| A2 | The decision MUST implement the ordered flow in [The Required Ordered Decision](#the-required-ordered-decision): file-input? → coverage judgment → bind-if-covered → else-AI-fallback. |
| A3 | The coverage judgment MUST implement the [Coverage-Judgment Criteria](#coverage-judgment-criteria-primary-focus) (CC-1..CC-4, CC-3a) as a deterministic, schema-driven predicate. |
| A4 | When coverage holds, the stage MUST bind the deterministic plugin action and produce the deliver-branch DSL shape (extract input mapped to the bytes field, requested surface fields on the plugin action). |
| A5 | When coverage does not hold, the stage MUST route to the **existing** `convertExtract` AI branch **unchanged** (no removal, no override, no weakening). |
| A6 | The decision MUST be **plugin-agnostic** — driven by plugin/action schemas and semantic signals, with no branches keyed on plugin or action identity (V6 Design Principle 6 / Anti-pattern F). |
| A7 | The routing decision SHOULD be **observable** — when it selects deterministic-bind or AI-fallback, it should log (structured Pino) which branch was chosen and the coverage-criterion that decided it, so a wrong verdict is diagnosable (not silent — V6 Design Principle 11). |

### B. Companion / defense-in-depth changes (from RCA § 8) — ALL IN-CYCLE (user decision 2026-07-12)

All three companions are in scope for this cycle. The authoritative decision MUST still live in reliable code (Section A); the companions steer/harden around it.

| # | Requirement |
|---|-------------|
| B1 | **Phase-1 prompt steer.** Tighten `intent-system-prompt-v2.ts` § 6.4 so an inline-base64 email attachment *tends* to emit a document-domain `extract` at the bytes field with normalization split out — but as a **steer only**; reliable code (Section A) makes the authoritative decision, so a mis-phrased plan cannot flip a covered case to AI. |
| B2 | **Plugin-def annotation.** Add `x-semantic-type: file_attachment` to `google-mail-plugin-v2.json` `get_email_attachment.output_schema`, giving the coverage check (CC-1) a reliable file signal for current and future agents — mirroring the signal WP-57 added for Drive's `download_file`. |
| B3 | **Heuristic hardening.** Harden `inputLooksLikeFileAttachment` (`IntentToIRConverter.ts` ~L2205-2278): resolve loop-internal producer schemas (the direct-slot lookup misses a loop-internal input) and stop the whole-graph text short-circuit (~L2271) from overriding the extract input's own producer. Must not reintroduce a second decision-maker — it only prevents *stripping* a binder-authored binding. |
| B4 | **(Non-goal guard)** The `convertExtract` AI branch (`IntentToIRConverter.ts` L682-704) MUST remain a valid, reachable destination. Any change that makes it unreachable or unconditionally overridden is a defect against this requirement. |

---

## Non-Functional Requirements

| Category | Requirement |
|----------|-------------|
| **Determinism** | Given the same connected plugins + the same extract intent, the routing verdict MUST be identical across repeated generations. The whole point is removing Phase-1 non-determinism from this decision. |
| **No hardcoding** | Schema-driven only; no plugin/action-identity branches in generic V6 code (Design Principle 6). |
| **Root-cause placement** | Fix at the earliest reliable layer that owns the decision (binder/converter), per Design Principle 7 — not a runtime patch, not solely a prompt tweak. |
| **Failure visibility** | The AI-fallback path must remain a *visible, intentional* choice, not a silent default; log the branch + deciding criterion (Design Principle 11). |
| **Logging** | All new/changed server code uses structured Pino via `createLogger` — no `console.*`. Flag any touched file that still uses `console.*` and propose conversion (CLAUDE.md rule #3). |
| **Type safety** | TypeScript strict; no implicit `any`. |
| **No new patterns without SA** | The coverage predicate is a new decision surface — requires SA review before implementation (Mandatory Rule #7). |

---

## Existing System Grounding

| Capability | Status | Where |
|------------|--------|-------|
| Deterministic OCR structured extraction (`extract_structured_data`, "without AI", required `fields`, base64 `file_content`) | **Exists** | `lib/plugins/definitions/document-extractor-plugin-v2.json` (L61-71) |
| `get_email_attachment` output (`data` base64, `extracted_text`, `is_image`) — **missing** `x-semantic-type: file_attachment` | **Exists (gap)** | `lib/plugins/definitions/google-mail-plugin-v2.json` (L708-814) |
| `convertExtract` deliver/plugin branch (deterministic bind; `file_content` mapping) | **Exists** | `IntentToIRConverter.ts` L633-681 (mapping L643-652) |
| `convertExtract` AI-only branch (the safety net to preserve) | **Exists** | `IntentToIRConverter.ts` L682-704 (template L692) |
| Capability binding + reselect (`checkAndReselect`, input-type checks) | **Exists** | `CapabilityBinderV2` (L820-895) |
| File-attachment heuristic router | **Exists (fragile)** | `inputLooksLikeFileAttachment` L2205-2278 (whole-graph short-circuit L2271) |
| Phase-1 "use a document extractor for binary files" MUST rule (WP-57) | **Exists (non-deterministic in effect)** | `intent-system-prompt-v2.ts` § 6.4 (L903-935) |
| `x-semantic-type: file_attachment` signal precedent (Drive `download_file`, WP-57) | **Exists — reuse pattern** | consumed at `inputLooksLikeFileAttachment` L2234-2239 |
| **Reliable-code coverage-then-fallback decision** | **Net-new** | — |
| **Schema-driven `pluginCoversExtraction` coverage predicate (CC-1..CC-4)** | **Net-new** — the core deliverable | — |

---

## V6 Protocol Compliance

Per CLAUDE.md V6 Work Protocol (this is `lib/agentkit/v6/` + `lib/pilot/` work):

- **Tracking status:** This is **NOT yet tracked** as an open item. WP-57 (Google Drive → document-extractor base64 byte source) is ✅ Fixed (2026-06-16) and already removed from `V6_OPEN_ITEMS.md`. This is a **new, distinct WP in the WP-57 family** — the Gmail-scatter-attachment analog where the deterministic-vs-AI choice is left to Phase-1 phrasing. The RCA proposes the full WP text (as "WP-NN") but per protocol did **not** write it. **Dev owns writing the new WP entry** into `V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md` and the one-line pointer into `V6_OPEN_ITEMS.md` (do not double-track; use the RCA's proposed text as the starting point).
- **Design Principles engaged:** Principle 6 (no plugin-specific behavior — the coverage predicate must be schema-driven), Principle 7 (fix at root cause — binder/converter, not runtime), Principle 11 (defense-in-depth must not hide failures — log the branch/criterion; keep AI-fallback a visible choice), Anti-pattern F (no plugin-keyed branch in generic infra). SA must confirm the design does not violate these.
- **Regression scenario (mandatory):** A **new scatter-attachment regression scenario** (`search_emails → flatten → filter → scatter[get_email_attachment → extract]`) MUST be added per `V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_SCRIPTS.md`, run **multiple times** to prove determinism (the working/failing pair proves a single pass is not evidence). It must assert **both** the covered-binds-deterministic and uncovered-falls-back-to-AI boundaries.
- **After-fix doc updates:** mark the new WP ✅ Fixed with commit ref + date, add a Change History entry, remove it from OPEN_ITEMS, and — if a new pattern emerges — extend `V6_DESIGN_PRINCIPLES.md`.

---

## Assumptions

| # | Assumption |
|---|------------|
| 1 | `document-extractor.extract_structured_data`'s declared schema (deterministic OCR, required `fields`, base64 `file_content`) is the authoritative source for the CC-2/CC-3/CC-4 checks. |
| 2 | The connected-plugins list on the agent is the authoritative "available deterministic plugin" set for CC-2 (connected-only, per user decision). |
| 3 | Pure document-surface fields vs. normalization/meta fields is a distinguishable property at generation time (the working agent already splits them), supporting CC-3a. |
| 4 | Preserving the AI branch unchanged is acceptable and desired — it is the correct home for genuinely-uncovered extractions. |
| 5 | The decision can be made from schemas + intent without re-running the non-deterministic Phase-1 planner. |

---

## Acceptance Criteria

Both directions MUST be provable. AC-1 and AC-2 are the load-bearing pair the RCA (§ 10) requires.

- [ ] **AC-1 (covered → deterministic, the today-bug fixed).** For the proven scatter-attachment shape with a connected `document-extractor` that genuinely covers the requested document-surface fields (the `0ee53785`/`95f791ed` case), generation binds `document-extractor.extract_structured_data` (deterministic branch) — and does so **deterministically across repeated generations** of the same intent, i.e. the failing agent's outcome can no longer occur.
- [ ] **AC-2 (uncovered → AI, the net preserved).** For a constructed extract case where **no** connected deterministic plugin covers it (CC-2 fails: no deterministic document-extraction capability; or CC-4 fails: unsupported file type; or CC-3 fails: only computed/derived fields requested), generation routes to the `convertExtract` AI branch — proving the AI net still fires when it should.
- [ ] **AC-3 (decision lives in reliable code).** The covered-vs-uncovered verdict is produced by a deterministic stage (binder/converter) and is invariant to Phase-1 phrasing variations of the same extract intent (input-ref granularity, field-order, framing). A mis-phrased-but-equivalent plan yields the same verdict.
- [ ] **AC-4 (coverage predicate implements CC-1..CC-4).** `pluginCoversExtraction` (or the SA's equivalent) evaluates CC-1 (file input), CC-2 (capability match, connected-only), CC-3/CC-3a (requested-field coverage incl. meta/normalization split), and CC-4 (file-type support), and binds iff all hold.
- [ ] **AC-5 (plugin-agnostic).** No plugin-identity or action-identity branch is introduced into generic V6 infrastructure; the predicate reads schemas/semantic signals only (verified in SA code review against Design Principle 6 / Anti-pattern F).
- [ ] **AC-6 (AI branch intact).** The `convertExtract` AI branch (L682-704) remains present, reachable, and unmodified in behavior for uncovered cases.
- [ ] **AC-7 (observability).** When the router picks deterministic-bind vs AI-fallback, it emits a structured log naming the chosen branch and the deciding criterion (no silent default).
- [ ] **AC-8 (regression scenario, run repeatedly).** A new scatter-attachment regression scenario is committed and passes Phase E, exercised **multiple times** to demonstrate determinism, asserting **both** AC-1 and AC-2 boundaries; `scenario.json` fields updated per protocol.
- [ ] **AC-9 (image-attachment safety).** For an image (JPG/PNG) attachment in the covered case, the deterministic OCR path is taken (not base64-as-text to the LLM), removing the fabrication risk called out in the RCA runtime-impact note.
- [ ] **AC-10 (V6 docs).** New WP entry added to WEAK_POINTS with commit ref, one-line pointer in OPEN_ITEMS, Design-Principles updated if a new pattern emerged — per V6 Work Protocol.

---

## Out of Scope / Future Roadmap

| # | Item | Note |
|---|------|------|
| 1 | Improving deterministic extractor per-field parse quality | Tracked as WP-59; distinct problem. |
| 2 | WP-55 IntentContract-persistence clobber | Separate item; only blocks reading the two ICs directly (Q5). |
| 3 | Generalizing coverage judgment to non-document extraction domains | v1 targets document/file extraction (the proven failure surface). Broader `extract` coverage can follow. |
| 4 | Retiring AI fallbacks for retire-safe deterministic primitives | Related to RETIRE-2; out of scope here — this requirement *preserves* the AI net. |
| 5 | Connectable-but-unconnected plugin preference/gating | Explicitly deferred — CC-2 is connected-only this cycle (user decision). |

---

## Open Questions

> **Status (2026-07-12):** Q4 and Q6 CLOSED by user scope decisions (all companions in-cycle; "available" = connected-only). Q5 ACCEPTED (construct the uncovered case synthetically). Q1–Q3 ROUTED TO SA and resolved in the workplan's SA Workplan Review section — see [`DETERMINISTIC_VS_AI_EXTRACTION_ROUTING_WORKPLAN.md`](/docs/workplans/DETERMINISTIC_VS_AI_EXTRACTION_ROUTING_WORKPLAN.md).

- [x] **Q1 — Which stage owns the decision?** → **RESOLVED by SA:** binder authors the coverage-then-bind verdict (`CapabilityBinderV2`), converter honors it (`IntentToIRConverter.convertExtract`), single decision-maker. See workplan SA review.
- [x] **Q2 — CC-3 field-coverage strictness (no hardcoded field names).** → **RESOLVED by SA:** classify each requested field by its **declared source** (surface-read vs meta/computed) from the IntentContract, never by field-name lists; document-surface fields are coverable, meta/computed are split or excluded. See workplan SA review.
- [x] **Q3 — CC-3a split responsibility.** → **RESOLVED by SA:** **auto-synthesize** the split (deterministic extract for surface fields + downstream `generate` for residual meta/normalization), with guardrails G1–G4 (zero-surface → whole AI fallback; no fabrication; honor already-split; plugin-agnostic). See workplan SA review.
- [x] **Q4 — Companion scope.** → **CLOSED by user:** all three companions (B1, B2, B3) in-cycle.
- [x] **Q5 — Uncovered-case test construction.** → **ACCEPTED by user:** construct synthetically per the SCRIPTS manual; real uncovered agent is a bonus, not a blocker.
- [x] **Q6 — Definition of "available."** → **CLOSED by user:** connected-only this cycle.

---

## References

- [AGENT_RCA_CONCLUSION_gmail-expense-attachment-ai-extract.md](/docs/investigations/AGENT_RCA_CONCLUSION_gmail-expense-attachment-ai-extract.md) — source RCA (§§ 8, 10, 11, 12; proposed WP text)
- [DETERMINISTIC_VS_AI_EXTRACTION_ROUTING_WORKPLAN.md](/docs/workplans/DETERMINISTIC_VS_AI_EXTRACTION_ROUTING_WORKPLAN.md) — Dev workplan + SA Q1–Q3 resolution
- [V6_DESIGN_PRINCIPLES.md](/docs/v6/V6_DESIGN_PRINCIPLES.md) — Principles 6, 7, 11; Anti-pattern F
- [V6_OPEN_ITEMS.md](/docs/v6/V6_OPEN_ITEMS.md) — backlog (WP-57 fixed; this is the new family member, not yet tracked)
- [V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md](/docs/v6/V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md) — where Dev writes the new WP entry
- [V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_SCRIPTS.md](/docs/v6/V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_SCRIPTS.md) — regression-scenario procedure (mandatory for the new scenario)
- [CLAUDE.md](/CLAUDE.md) — Platform Design Principles, Mandatory Rules, V6 Work Protocol
- Key code refs: `IntentToIRConverter.ts` (L633-704 convertExtract branches; L2205-2278 heuristic), `CapabilityBinderV2` (L820-895), `intent-system-prompt-v2.ts` § 6.4 (L903-935), `document-extractor-plugin-v2.json` (L61-71), `google-mail-plugin-v2.json` (L708-814)

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-07-12 | Initial draft | BA authored requirement for ordered deterministic-vs-AI extraction routing (coverage-then-fallback, AI net preserved), sourced from the gmail-expense-attachment-ai-extract RCA §§ 8/10/11/12. Primary deliverable = the coverage-judgment criteria (CC-1..CC-4, CC-3a). Acceptance criteria make BOTH directions provable (AC-1 covered→deterministic; AC-2 uncovered→AI). Flagged as new WP-57-family item (not yet tracked; WP-57 already fixed). 6 open questions flagged (owning stage, field-coverage strictness, split responsibility, companion scope, uncovered-case test construction, definition of "available"). |
| 2026-07-12 | User scope decisions + SA resolutions | Companion scope = all in-cycle (B1/B2/B3); "available" = connected-only (CC-2 tightened); Q1–Q3 resolved by SA in the workplan (binder-authors/converter-honors; classify-by-declared-source; auto-synthesize split). Q4/Q6 closed, Q5 accepted. Target branch corrected to the existing `agent-failure-troubleshooting` — NO new feature branch is created this cycle (RM skips branch creation). |
