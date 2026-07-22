# Agent RCA Conclusion — Gmail Expense Attachment: step 6 uses `ai_processing` instead of the deterministic document-extractor

> **Last Updated**: 2026-07-12 (addendum § 12: remediation reframed as an ordered **conditional fallback** — prefer a deterministic plugin only when it *genuinely covers* the case; preserve the AI branch as the last-resort safety net)
> **Agent (failing)**: `95f791ed-dfc1-49ee-beb4-2ee08e2865ba` ("Gmail Expense Attachment Summarizer") · **Owner**: meiribarak@gmail.com
> **Agent (working contrast)**: `0ee53785-44d0-4b46-85dd-367551a657ba` ("Gmail Expense Attachment Table + Total Summary") — same owner, same task, **correctly** bound `document-extractor`.
> **Scope**: Why the compiled DSL's step 6 field-extraction is an LLM (`ai_processing` / `llm_extract`) step rather than the deterministic `document-extractor.extract_structured_data` plugin action, given the connected plugin and the "prefer deterministic" prompt rule.
> **Skill**: `v6-pipeline` (RCA). DIAGNOSTIC ONLY — no product code, prompts, DSL, schemas, or backlog files changed.
> **Sibling**: the working-contrast agent `0ee53785` also has a *separate* flatten field-shape defect diagnosed in [`AGENT_RCA_CONCLUSION_gmail-expense-attachment-flatten.md`](/docs/investigations/AGENT_RCA_CONCLUSION_gmail-expense-attachment-flatten.md); its WP-55 persistence-clobber addendum explains why both agents' `intent_contract`/`data_schema` are null.

## Overview

The user is right on both counts: the deterministic `document-extractor` plugin **was connected and suitable**, and the Phase-1 prompt **does** carry a hard "use a document extractor for binary files" rule (§ 6.4 / WP-57). Step 6 is definitively the AI-only branch of `convertExtract` (its persisted `prompt` matches the template at `IntentToIRConverter.ts:692` verbatim), reached only when the `document-extractor` binding is absent by the time the IR is compiled.

**Correction after the sibling comparison (§ 11):** the working agent `0ee53785` — same owner, same expense-attachment task — has the **byte-for-byte identical pipeline structure** (`search_emails → flatten → filter → scatter[ get_email_attachment → extract ]`), the **same producer** (`get_email_attachment`), the **same missing plugin annotation**, and the **same competing upstream email-text collection** — yet it **kept** the `document-extractor` binding. So **scatter-scoping is NOT the decisive difference** (my initial primary hypothesis is refuted as the differentiator). Every deterministic and structural input to the file-vs-text router is identical between the two agents; the *only* thing that differs is the **Phase-1 IntentContract emission of the extract step** — the pipeline's sole non-deterministic phase. This matches WP-57's own framing that the document-vs-AI outcome is "selected by Phase 1 non-determinism."

**Remediation intent (§ 12):** the fix is **not** to force document-extractor whenever a file is present — the AI extraction branch is a deliberate **safety net** for cases the deterministic extractor does not cover (unsupported formats, unproducible field types, out-of-coverage document shapes) and must be preserved. The requirement is an **ordered conditional fallback**, decided in reliable deterministic code rather than left to Phase-1 phrasing: (1) is the input a document/file? (2) does an available deterministic plugin *genuinely cover* this case — right capability, requested fields, file type? (3) if yes → bind it; (4) if no → fall back to AI. Today's bug is the **inversion** of this: both agents had a genuinely-covering deterministic plugin, yet the failing one still landed on the AI net. Root-cause layer: **V6 generation**. Fix-owner: **`v6-pipeline`**.

---

## 1. Reported symptom

User concern: in agent `95f791ed-…`'s generated DSL, **step 6 performs field extraction via an `ai_processing` (LLM) step rather than the deterministic `document-extractor` plugin**, despite the V6 IntentContract LLM being instructed to *prefer a deterministic approach over an LLM approach*. Follow-up: a **similar agent (`0ee53785`) did it correctly** — what is the decisive difference?

Supplied identifiers: **agent IDs** `95f791ed-…` (failing) and `0ee53785-…` (working). Stage (b) — V6 DSL generation.

## 2. Evidence gathered

| Source | Salient output |
|---|---|
| `npx tsx scripts/dump-agent.ts 95f791ed-…` | `connected_plugins` includes **`document-extractor`**. `step4` `scatter_gather` over `{{eligible_attachments}}` (itemVariable `attachment_item`) wraps **`step5` `google-mail.get_email_attachment`** → **`step6` `ai_processing` / `llm_extract`** (`input: {{attachment_content}}`; fields `date_time, vendor, amount, expense_type, notes, source_filename`). |
| `npx tsx scripts/dump-agent.ts 0ee53785-…` | `connected_plugins` includes **`document-extractor`**. **Identical** `step4` scatter → `step5` `google-mail.get_email_attachment` → **`step6` `action` / `plugin: document-extractor` / `action: extract_structured_data`** (`params.file_content: {{attachment_content.data}}`; fields `date_time, vendor, amount, currency, expense_type`), then a **separate** `step7` `ai_processing/generate` (normalize). |
| Read-only query of `agents.agent_config.ai_context` (both) | **Neither** agent has persisted `intent_contract` / `data_schema` (WP-55 clobber — sibling doc). Both EPs' `services_involved` name **`document-extractor`**. |
| `lib/plugins/definitions/document-extractor-plugin-v2.json` | `extract_structured_data`: "deterministic OCR … **without AI**"; required `fields`; base64 `file_content` (`x-input-mapping.accepts: [file_object]`, L61-71). The operation both step 6s need. |
| `lib/plugins/definitions/google-mail-plugin-v2.json` L708-814 | `get_email_attachment` output `{ filename, mimeType, size, **data** (base64), extracted_text, is_image }`. **No `x-semantic-type: file_attachment`** — for **both** agents (same plugin def). |
| `lib/agentkit/v6/intent/intent-system-prompt-v2.ts` § 6.4, L903-935 | The "MUST use a document extractor for binary files" rule (WP-57), incl. L934-935 "an email attachment with base64 content — feed that to the `document` extractor directly." Present for both generations. |
| `lib/agentkit/v6/compiler/IntentToIRConverter.ts` L682-704 | `convertExtract` AI-only branch; template L692 = failing agent's step 6 `prompt` (exact match). L633-681 = the deliver/plugin branch that produced the working agent's step 6. |

## 3. Was the deterministic path available and suitable? — YES (for both agents)

`document-extractor` is connected in both; `extract_structured_data` matches the required fields; `step5 get_email_attachment.data` supplies the base64 bytes; the source is a PDF/JPG/PNG receipt. The working agent proves the path is not merely available but **routable** on this exact shape. This is not an "unavailable/unsuitable plugin" situation for either agent — the deterministic plugin **genuinely covers** this extraction (the coverage test in § 12 step 2 passes for both).

## 4. Is the "prefer deterministic" instruction present? — YES

`intent-system-prompt-v2.ts` § 6.4 (L903-935, WP-57 block) is a hard MUST for binary documents, including the inline-base64 email-attachment note (L934-935). Both agents were generated with this prompt. The rule exists; it is simply **not deterministic** in effect (see § 11).

## 5. Earliest failing step + cascade — where the `ai_processing` choice was authored

**Earliest failing point: Phase-1 IntentContract emission of the `extract` step** (narrowed by the § 11 comparison). Step 6 reaches the AI-only branch of `convertExtract` only when `effectivePluginKey` is not a live `document-extractor` binding. Given that **every deterministic and structural input is identical between the failing and working agents** (§ 11), the divergence cannot originate in the deterministic Phase 2/3 routing alone — it must originate in the differing Phase-1 emission that those deterministic stages faithfully consumed.

The candidate deterministic gates (any of which strips the binding *once Phase 1 hands it a strippable shape*) remain:

1. **Phase 3 — O-WP12 heuristic reroute.** `IntentToIRConverter.ts` L555-574 → `inputLooksLikeFileAttachment` (L2205-2278): direct-slot lookup (L2242) misses a loop-internal input; whole-graph fallback returns `false` at **L2271** because `expense_emails.emails[]` carry TEXT_MARKERS (L2213). Fires only if a `document-extractor` binding survived Phase 2.
2. **Phase 2b — InputTypeChecker rejection.** `CapabilityBinderV2.checkAndReselect` (L820-895) → `input_type_incompatible` → `convertExtract` L538-550 reroute.
3. **Phase 2 — never bound.** The binder never bound `document-extractor` because Phase 1 did not declare `uses: [{capability: extract_structured_data, domain: document}]` (or referenced a non-file input) → `effectivePluginKey` undefined from the start → AI branch, and gates 1–2 never even run.

**The § 11 comparison makes gate 3 (or a Phase-1 input-ref difference feeding gates 1–2) the operative cause**, because gates 1–2 are deterministic functions of `data_schema` + graph, which are structurally identical across the two agents. The failing agent's Phase-1 emission differs (different input ref, different field set — see § 11), and that difference is what the deterministic stages then acted on.

**Cascade:** step 6 → `extracted_fields` → gather → `extracted_expenses` → sum/count → HTML generate → send. None independent.

**Runtime impact:** for **image** attachments (JPG/PNG) the LLM extraction receives base64 `data` with no OCR → fabrication (WP-13/WP-16/WP-34 family); for PDFs it may lean on `extracted_text` but still burns tokens/latency, carries unvalidatable fabrication risk, and defeats the deterministic preference. document-extractor's Textract OCR is the intended path.

## 6. Classified root-cause layer

**V6 generation.** A binary-document field-extraction was routed to an LLM instead of the connected deterministic extractor **that genuinely covered the case**. Not input/data, not runtime/external, not calibration-detection. A generation-phase defect of the WP-57 family — pinned to Phase-1 emission non-determinism by the working-agent contrast.

## 7. Defensible root cause (the "why," with exact references)

**Operative:** the failing agent's **Phase-1 IntentContract emitted the extract step in a shape that did not yield a live `document-extractor` binding**, whereas the working agent's did — the sole non-deterministic phase, and the only thing that differs between two otherwise-identical pipelines (§ 11). Observable DSL fingerprints of the divergence:
- **Input ref:** working `params.file_content = {{attachment_content.data}}` (the base64 **bytes field**) vs failing `input = {{attachment_content}}` (the **whole object**). `IntentToIRConverter.ts` L643-652 maps the extract input to `file_content` only in the deliver branch; the failing agent never reached it.
- **Field set / framing:** working = 5 pure document-surface fields (`date_time, vendor, amount, currency, expense_type`) with normalization split into a *separate* `generate` step (step 7); failing = 6 fields including **meta** fields (`notes` = "notes about extraction issues", `source_filename`) with extraction + normalization folded into one `llm_extract` whose instruction says "read the subject, snippet, and body" — an email-text framing, not a document framing.

**Contributing (latent, shared by both — not the differentiator):**
- `google-mail-plugin-v2.json` `get_email_attachment.output_schema` (L780-814) lacks `x-semantic-type: file_attachment` — the authoritative signal WP-57 added for Drive's `download_file` (`inputLooksLikeFileAttachment` L2234-2239). Its absence means routing leans on the fragile field-name/graph heuristic. Present in **both** agents, so it does not explain the divergence, but it removes the safety net that would make either outcome robust.
- The whole-graph `sawTextItems` short-circuit (`IntentToIRConverter.ts` L2271) and the top-level-only slot resolution are a real latent gap, but — proven by the working agent — they do **not** by themselves force the reroute on this shape.

**Evidence gap (stated honestly):** both agents have **null** persisted `intent_contract` / `data_schema` (WP-55 clobber), so I cannot read the two IntentContracts to show the exact `uses`/input-ref difference directly; I infer it from the compiled DSL fingerprints above. Per the non-determinism rule I did **not** re-run either pipeline. Confirming the exact Phase-1 divergence requires re-enabling WP-55 persistence and re-capturing both ICs via `capture-scenario-from-agent.ts` (QA/fix-testing, outside TS scope).

## 8. Named fix-owner

**`v6-pipeline`.** The fix must implement the **ordered conditional fallback** of § 12 — prefer a deterministic plugin only when it *genuinely covers* the case, and **preserve the AI branch as the last-resort net**. It must NOT unconditionally force document-extractor whenever a file is present. Owners:

1. **Deterministic coverage-and-bind decision, in reliable code (primary).** Move the "use deterministic vs AI" choice out of Phase-1 phrasing and into a deterministic stage (`CapabilityBinderV2` / `IntentToIRConverter`). For an `extract` over a file/bytes input: run the **coverage judgment** (§ 12 step 2) — does an available plugin expose a capability that produces the *requested fields* for this *file type*? If yes → bind it; if no → keep the AI branch. The hard part is the coverage judgment, **not** the binding mechanics.
2. **Phase-1 prompt `intent-system-prompt-v2.ts` § 6.4 (companion — steer, don't decide).** The MUST rule is present but non-deterministic on this shape (proven). Tighten it so an inline-base64 email attachment tends to emit a document-domain `extract` at the bytes field with normalization split out — but the *authoritative* decision lives in reliable code (item 1), so a mis-phrased plan cannot flip a covered case to AI.
3. **Plugin-def annotation (companion).** Add `x-semantic-type: file_attachment` to `get_email_attachment.output_schema` so the deterministic coverage check has a reliable file signal for both current and future agents.
4. **Heuristic hardening (latent).** `inputLooksLikeFileAttachment`: resolve loop-internal producer schemas and stop the whole-graph text short-circuit from overriding the extract input's own producer. Defense-in-depth, not the proven differentiator.

**Explicit non-goal:** do not remove or bypass the `convertExtract` AI branch (`IntentToIRConverter.ts` L682-704). It is the correct destination when **no** deterministic plugin genuinely covers the extraction (unsupported format, unproducible field types, out-of-coverage document shape). The bug is the AI net being used *despite* a covering plugin — the inversion, not the net's existence.

This is **not** solely a heuristic-tuning fix, nor an unconditional force-bind — it is a reliable-code coverage-then-fallback decision.

## 9. Did calibration behave correctly? (honest-failure distinction)

**Not applicable — no calibration surface is implicated.** Pure V6-generation routing defect on the compiled DSL. Note for triage: the failing choice is **silent** — a PDF-only dry-run could pass (LLM reads `extracted_text`), so calibration would likely not flag it; it surfaces on image attachments or as cost/fabrication drift. A detection blind spot, not a calibration defect.

---

## 10. Recommended remediation path

**Full cycle (not a hotfix).** The durable fix is the **ordered conditional-fallback** of § 12 implemented in a deterministic stage (coverage judgment → bind deterministic if covered, else fall back to AI), with the § 6.4 prompt steer, the plugin annotation, and the heuristic hardening as defense-in-depth. It must preserve the AI branch as the last-resort net. It touches shared Phase-1/2/3 logic, needs SA design (WP-57-adjacent — the coverage judgment is the hard, novel part), and QA regression via a **new scatter-attachment scenario** (`search_emails → flatten → filter → scatter[get_email_attachment → extract]`) run **multiple times** to prove that (a) a *covered* case binds the deterministic plugin deterministically and (b) an *uncovered* case still falls back to AI. The working/failing pair proves a single pass is not evidence. TS recommends TL route to **BA** to open a formal requirement referencing this doc, the §§ 11–12 framing, and the proposed WP entry.

> **Handoff:** TS recommends; TL routes. Diagnostic only — no product code, prompts, DSL, schemas, or backlog files were modified by this investigation.

---

## 11. Addendum — Side-by-side with the working sibling `0ee53785` (refutes scatter-scoping)

**Follow-up task:** the user pointed to a same-task agent that *did* use `document-extractor`. Question: what makes the router keep the binding there but strip it here?

### The diff on every dimension the RCA flagged as candidate-decisive

| Dimension | Failing `95f791ed` (step 6 = `ai_processing`) | Working `0ee53785` (step 6 = `document-extractor`) | Decisive? |
|---|---|---|---|
| Extraction inside a scatter/loop? | **Yes** — `step4` scatter, `itemVariable attachment_item` | **Yes** — identical `step4` scatter, same itemVariable | **NO — identical** |
| Producer of the extract input | `step5 google-mail.get_email_attachment` → `attachment_content` | **Same** `step5 google-mail.get_email_attachment` → `attachment_content` | **NO — identical** |
| Producer top-level `data_schema` slot? | Loop-internal (not top-level) | Loop-internal (not top-level) — **same** | **NO — identical** |
| `get_email_attachment` `x-semantic-type: file_attachment`? | Absent | Absent — **same plugin def** | **NO — identical** |
| Competing upstream TEXT markers (`emails[].body/subject/snippet`)? | Present (`expense_emails`) | Present (`expense_emails`) — **same** | **NO — identical** |
| § 6.4 / WP-57 prompt rule in effect? | Yes | Yes — **same prompt** | **NO — identical** |
| **Compiled extract input ref** | `input = {{attachment_content}}` (whole object) | `file_content = {{attachment_content.data}}` (bytes field) | **YES (fingerprint)** |
| **Extract field set / framing** | 6 fields incl. meta (`notes`, `source_filename`); extraction+normalize folded into one `llm_extract` ("read the subject, snippet, and body") | 5 pure document fields (`+currency`); normalization is a **separate** `step7 generate` | **YES (fingerprint)** |
| **Step 6 binding** | AI branch — `ai_processing/llm_extract` | Deliver branch — `document-extractor.extract_structured_data` | outcome |

### Confirm/refute the WP-57-scatter-analog hypothesis

**Refuted as the decisive difference.** Scatter-scoping, the loop-internal producer, the missing `x-semantic-type` annotation, and the competing email-text collection are **all identical** across the two agents — none can be the differentiator, because they do not differ. My initial doc's primary mechanism ("scatter-scoped slot → whole-graph text short-circuit") may still be a **latent contributor** (it is why neither outcome is *robust*), but it is **not what flipped this pair**.

**The only material difference is the Phase-1 IntentContract emission of the extract step** — the sole non-deterministic phase. Its DSL fingerprints are the two "YES" rows above: the working run emitted a *pure document extract* pointed at the base64 **bytes field** (`.data`) with normalization split out, which bound cleanly to `document-extractor`; the failing run emitted a *coarser extract* pointed at the **whole object** with meta/normalization folded in and an email-text framing, which did not yield a live `document-extractor` binding and fell to the AI branch. This is exactly WP-57's documented behavior that the document-vs-AI outcome is **"selected by Phase 1 non-determinism."**

**So: is scatter-scoping the only factor, or is there another? Neither — it is a *third* thing.** The decisive factor is Phase-1 emission variance (input-ref granularity + field framing), not structure. The latent slot/annotation gaps make both outcomes fragile but did not decide this pair.

---

## 12. Addendum — Correct remediation framing: conditional fallback, preserve the AI net

**Refinement from the user.** The fix must **not** be framed as "force document-extractor whenever there's a file" or a "deterministic auto-bind that overrides the AI branch." That would be dangerous: the AI extraction branch is a deliberate **safety net** for cases the deterministic extractor genuinely does **not** cover (unsupported file formats, field types the extractor cannot produce, document shapes outside its coverage). Removing or unconditionally overriding that net would trade one silent failure for another.

### The required ordered decision (AI = fallback of last resort)

1. **Is this a document/file input?** (bytes-bearing / `file_attachment` slot)
2. **Does an available deterministic plugin GENUINELY COVER this specific case?** — right capability, supports the *requested fields*, right file type. **This coverage judgment is the hard part**, not the binding mechanics.
3. **If yes → bind the deterministic plugin.**
4. **If no suitable deterministic plugin was identified → fall back to AI** (net preserved).

### Why today's bug is the inversion of this order

Both the working (`0ee53785`) and failing (`95f791ed`) agents **had** a suitable, available, genuinely-covering deterministic plugin (`document-extractor.extract_structured_data` covers `date_time/vendor/amount/expense_type` on PDF/JPG/PNG — see § 3). Yet the failing agent still landed on the AI net. The net was used **because of how the Phase-1 planner happened to phrase the step**, not because the plugin couldn't cover the case. That is step 2 being answered by Phase-1 wording instead of by reliable code — the exact defect.

### Requirement statement (for the BA requirement)

> Prefer the deterministic plugin whenever one **genuinely covers** the extraction (capability + requested fields + file type); use AI **only** when none does — and make that **coverage determination in reliable (deterministic-stage) code**, not left to how the Phase-1 planner phrased the step. Preserve the `convertExtract` AI branch unchanged as the last-resort fallback for genuinely-uncovered cases.

This supersedes any reading of §§ 8/10 as an "unconditional force-bind." The intent is conditional preference with the net intact.

---

## Proposed V6 backlog entry (text only — do NOT write to WEAK_POINTS / OPEN_ITEMS)

Per CLAUDE.md V6 Work Protocol, TS proposes the entry text; TL/Dev own the actual write. Extends the WP-57 family.

**Proposed `V6_..._WEAK_POINTS.md` entry (WP-NN — Gmail-attachment extract non-deterministically routed to AI vs document-extractor; coverage decision left to Phase-1 phrasing):**

> **Problem:** For an email attachment inside a scatter (`get_email_attachment → extract`), the pipeline **non-deterministically** binds the extraction to either `document-extractor.extract_structured_data` (deterministic OCR) or `ai_processing/llm_extract`, on structurally identical agents. Proven by two same-owner, same-task agents with byte-identical structure (`search_emails → flatten → filter → scatter[get_email_attachment → extract]`): `0ee53785` bound document-extractor (`file_content: {{attachment_content.data}}`, 5 pure fields, separate normalize step); `95f791ed` fell to `ai_processing/llm_extract` (`input: {{attachment_content}}`, 6 fields incl. meta, folded normalization). Both had a genuinely-covering deterministic plugin available; the AI net was used anyway because the "deterministic vs AI" choice is effectively decided by Phase-1 phrasing rather than by reliable code. Image attachments in the AI path get base64-as-text → fabrication. The WP-57 "Gmail works" contrast is only *sometimes* true.
> **Evidence:** agents `95f791ed-…` (AI) vs `0ee53785-…` (document-extractor). Failing step 6 `prompt` = `IntentToIRConverter.ts` L692 AI-branch template. Deliver branch that worked: L633-681 (`file_content` mapping L643-652). Router: L2205-2278 (whole-graph short-circuit L2271) — but identical inputs across both agents, so not the differentiator. Plugin-def gap (both): `google-mail-plugin-v2.json` `get_email_attachment.output_schema` L780-814 no `x-semantic-type: file_attachment`. § 6.4/WP-57 rule present (`intent-system-prompt-v2.ts` L903-935). Both ICs null (WP-55 clobber). Deterministic path available: `document-extractor-plugin-v2.json` + `get_email_attachment.data`.
> **Fix shape (ordered conditional fallback — preserve the AI net):** (1) Move the deterministic-vs-AI choice into a reliable deterministic stage: for an `extract` over a file/bytes input, run a **coverage judgment** (does an available plugin's capability produce the requested fields for this file type?) and bind the deterministic plugin iff covered; else fall back to AI. The coverage judgment is the hard part. (2) Tighten § 6.4 to *steer* toward a document-domain extract at the bytes field, but let reliable code make the authoritative decision. (3) Annotate `get_email_attachment.output_schema` with `x-semantic-type: file_attachment`. (4) Harden `inputLooksLikeFileAttachment` (loop-internal producer resolution; no whole-graph text override). **Do NOT** remove or unconditionally override the `convertExtract` AI branch (L682-704) — it is the correct home for genuinely-uncovered extractions.
> **Why not caught earlier:** WP-57's Gmail "working contrast" was a single non-scatter observation; the document-vs-AI outcome is Phase-1-non-deterministic, so a passing capture doesn't prove robustness. No regression scenario runs the scatter-attachment shape repeatedly, and none asserts the covered-vs-uncovered fallback boundary.

**Proposed one-line `V6_OPEN_ITEMS.md` pointer:**

> - WP-NN — Gmail-attachment `extract` non-deterministically routes to `ai_processing` vs `document-extractor` (coverage decision left to Phase-1 phrasing; proven by `95f791ed` vs `0ee53785`). Fix = reliable-code coverage-then-fallback, AI net preserved. WP-57 family. See WEAK_POINTS WP-NN. (RCA: `docs/investigations/AGENT_RCA_CONCLUSION_gmail-expense-attachment-ai-extract.md`)

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-07-12 | Initial RCA | Diagnosed step 6 = `convertExtract` AI branch; primary hypothesis = scatter-scoped file-slot → WP-12 whole-graph text short-circuit (WP-57 Gmail analog). |
| 2026-07-12 | Addendum § 11 + correction | Compared working sibling `0ee53785` (identical structure, kept the binding). **Refuted scatter-scoping as the differentiator**; narrowed operative root cause to Phase-1 IntentContract emission non-determinism (input-ref granularity + field framing). Updated Overview, §§ 5/7/8/10 and the proposed WP text. |
| 2026-07-12 | Addendum § 12 + remediation reframe | Per user refinement, reframed §§ 8/10 and the WP text from "deterministic auto-bind that overrides the AI branch" to an **ordered conditional fallback**: prefer the deterministic plugin only when it *genuinely covers* the case (capability + requested fields + file type), decided in reliable deterministic code; **preserve the `convertExtract` AI branch as the last-resort net**. Added explicit non-goal (do not force-bind / do not remove the net) and noted the coverage judgment is the hard part. |
