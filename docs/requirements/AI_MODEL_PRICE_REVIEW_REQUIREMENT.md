# Requirement: AI Model Price Review (proposal, approve, apply)

> **Last Updated**: 2026-10-14

**Created by:** BA
**Date:** 2026-10-08
**Status:** Business questions Q0–Q9 DECIDED by the user 2026-10-08 (section 8); reminder channel = email (2026-10-09). SA requirement review 2026-10-08: APPROVED WITH CONDITIONS. **Slice 1** ✅ MERGED 2026-10-10 (PR #281, commit 236ad66, merge 6869ed13; [workplan](/docs/workplans/AI_MODEL_PRICE_REVIEW_SLICE1_WORKPLAN.md)). **Slice 2** ✅ MERGED 2026-10-11 (PR #304, commit 856455c4, merge 7cf7974a) and APPLIED to production 2026-10-11: 12 rows retired with the charged-price fingerprint unchanged, prices stored exactly, image price table created empty, dependent view recreated hardened; checker VERDICT PASS 83/0 ([workplan](/docs/workplans/AI_MODEL_PRICE_REVIEW_SLICE2_WORKPLAN.md), [capture](/docs/workplans/AI_MODEL_PRICE_REVIEW_SLICE2_CAPTURE_2026-10-10.md)). Slice 3 was put on hold by the user on 2026-10-12 pending feedback. **User feedback received 2026-10-14** (UF-1..UF-4, [section 8a](#8a-user-feedback-2026-10-14)): research by a server-side fetch button (reverses Q0), green/red coverage colours, per-model apply, a per-model price history. **SA re-review 2026-10-14** ([below](#sa-re-review-2026-10-14)) rules on the fetch and replaces the slice plan (R-9 supersedes R-8 and R-3). **Slice 3** IN PROGRESS: workplan SA-approved with changes 2026-10-14 ([workplan](/docs/workplans/AI_MODEL_PRICE_REVIEW_SLICE3_WORKPLAN.md)); code written, uncommitted, awaiting SA code review. **Slice 3** ✅ MERGED 2026-10-14 (PR #368, merge 99fb09a0) and APPLIED to production 2026-10-14 (`20261066`, checker PASS 68/0, probe PASS, no charged price changed; [workplan](/docs/workplans/AI_MODEL_PRICE_REVIEW_SLICE3_WORKPLAN.md)). Next: slice 4, the comparison page; not started until the user says go.

## Overview

Every Business OS credit charge is computed from our AI model price table: a credit is $0.001 of **measured** cost, and measured cost is tokens (or images) multiplied by the price we hold for that model. A wrong price is therefore a wrong charge on every customer, silently. Today the "Sync Latest Pricing" button on `/admin/system-config` overwrites those prices from a hardcoded list without contacting any provider, without review, and with an audit record that can be lost. This requirement replaces it with a reviewed flow: research official prices with sources, produce a proposal (old to new, with flags), show the effect on customers, let an admin approve all or part of it with a reason, and only then apply it, fully audited. It also asks SA to end price drift between the many copies of the price list.

This is a **money path**. Nothing in this requirement writes to the production database without the user's explicit approval; the user applies migrations by hand.

---

## Table of Contents

1. [As-built (verified 2026-10-08)](#1-as-built-verified-2026-10-08)
2. [User stories](#2-user-stories)
3. [Functional requirements](#3-functional-requirements)
4. [Non-functional requirements](#4-non-functional-requirements)
5. [Research options: server fetch vs operator research](#5-research-options-server-fetch-vs-operator-research)
6. [Single source of truth (problem statement for SA)](#6-single-source-of-truth-problem-statement-for-sa)
7. [Proposed slices (provisional, SA to confirm)](#7-proposed-slices-provisional-sa-to-confirm)
8. [Open business questions](#8-open-business-questions)
   - [8a. User feedback (2026-10-14)](#8a-user-feedback-2026-10-14)
9. [Out of scope / future roadmap](#9-out-of-scope--future-roadmap)
10. [Integration points](#10-integration-points)
11. [SA Requirement Review (2026-10-08)](#sa-requirement-review-2026-10-08)
12. [SA Re-review (2026-10-14)](#sa-re-review-2026-10-14)
13. [Change History](#change-history)

---

## 1. As-built (verified 2026-10-08)

Verified on `origin/main` at `a689de3f`.

| # | Area | Fact |
|---|---|---|
| AB-1 | Charging path | `lib/ai/pricing.ts` reads `ai_model_pricing` via `aiModelPricingRepository.listActive()`: `retired_date IS NULL`, `effective_date <= today`, newest row per model wins; cached for **1 hour** |
| AB-2 | Fallback | In-code `FALLBACK_PRICING`: 45 models (23 OpenAI incl. 3 embedding, 13 Anthropic, 3 Google, 6 Kimi), section-dated Jan–Mar 2026 |
| AB-3 | Unknown model | `lib/business-os/llm/chargePricing.ts` (FR-12): charged the highest in-code rate for that provider/kind, no cached discount |
| AB-4 | Sync route | `app/api/admin/system-config/pricing/sync/route.ts` contacts **no provider**. It copies a hardcoded 42-model list labelled "June 2026" (20 OpenAI, 13 Anthropic, 3 Google, 6 Kimi; no embeddings) via `syncMany`, which updates the newest row per model or inserts one, so it **overwrites manual edits**. Gated by `requireAdmin` |
| AB-5 | Sync audit | The audit entry is queued but **never flushed** (the single-row routes flush). The record of a sync can be lost |
| AB-6 | Page text | `app/admin/system-config/page.tsx`: `:356` falsely says it "Automatically fetches current rates from OpenAI and Anthropic APIs"; `:359` "Changes affect cost calculations immediately" (wrong, 1 h cache); `:350` / `:353` "per 1,000 tokens" (wrong, columns are per token); `:346` / `:363-365` legacy "Intelligent Routing" text |
| AB-7 | Guard | `app/admin/system-config/__tests__/source.guard.test.ts` S-1..S-10 pin the sync handler, button, helper text and the false paragraph byte for byte, deliberately (UC-5). Any change is a deliberate, SA-approved guard update |
| AB-8 | Single-row routes | `app/api/admin/system-config/pricing/route.ts` GET/PUT/POST/DELETE: `requireAdmin`, Zod, awaited audit + flush. DELETE is a **hard** delete |
| AB-9 | Live table | `ai_model_pricing`, created outside migrations (no CREATE TABLE in the repo). Columns: id, provider, model_name, input_cost_per_token, output_cost_per_token, effective_date (date), retired_date (date, null), created_at. **No** cached-input, batch or long-context columns. 54 rows; all current rows dated 2026-06-29 |
| AB-10 | Precision | Values appear rounded to 8 decimals per token: $0.075 per 1M is stored as $0.08 per 1M (about 7% high for that model) |
| AB-11 | Table hygiene | Alias rows `claude-3-haiku` / `-opus` / `-sonnet` dated 2024-01-01; duplicate history rows (`gpt-4o-mini` has 4) |
| AB-12 | Price copies | At least ten: the DB table; `FALLBACK_PRICING`; the sync list; `docs/AI_PROVIDER_MODELS.md` (per 1M, 2026-04-08); seed SQL `supabase/migrations/20260213_add_claude_46_pricing.sql` and `supabase/SQL Scripts/20251030_add_missing_models_pricing.sql`; dead `lib/utils/usageTracker.ts` `MODEL_PRICING`; inline rates in `lib/ai/providers/mistralProvider.ts` (Mistral is in no table); `IMAGE_FALLBACK_PRICING` in `SystemConfigRepository.ts`; setting `helpbot_embedding_cost_per_1k_tokens`; a hardcoded 50% cache-read discount in `openaiProvider.ts` |
| AB-13 | What BOS uses live (all OpenAI) | `gpt-4o-mini`: chat planner/analysis, insights, briefing, leads, website default, intake question_inference. `gpt-4o`: website full_site / landing_page, intake, onboarding. `text-embedding-3-small` (chat embeddings): **not in the DB**, fallback only. `gpt-image-1` (images): in **neither**, priced only by in-code `IMAGE_FALLBACK_PRICING` ($0.25/image, no live setting row) |
| AB-14 | Credit economics | [BUSINESS_OS_CREDIT_PRICING.md](/docs/architecture/BUSINESS_OS_CREDIT_PRICING.md): 1 credit = $0.001 measured cost; 100% markup (D1); allowance = 50% of fee at retail, cost ceiling 25% (D2). Essentials $79 = 19,750 credits; Autopilot $129 and Founding Partner = 32,250; Trial = 2,000 one-off. §4.5 typical costs: chat turn ~$0.002, briefing ~$0.0002, insight run $0.0003–0.0006, onboarding turn $0.0044, onboarding build $0.0168, image $0.25. §6.1 lists "A model price change" as a revisit trigger |
| AB-15 | Parked items | [ADMIN_BOS_CLEANUP_REQUIREMENT.md](/docs/requirements/ADMIN_BOS_CLEANUP_REQUIREMENT.md) §11, NF-2, FR-PR3, OQ-2. **This requirement supersedes the parked Sync item**; it is not repeated here |
| AB-16 | Precedents | No proposal-approve-apply pattern and no two-admin approval exist anywhere. Nearest: `lib/business-os/bizql/mutate/ConfirmationStore.ts` (a frozen plan confirmed later) and admin writes requiring `reason: z.string().min(3)` (jobs-queues drain, entitlements launch). No server-side web-page scraping exists; `cheerio` is installed but unused |
| AB-17 | Admin authz | Pricing routes are listed in [ADMIN_IDENTIFICATION_AND_ACCESS.md](/docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md); the CI guard scans the filesystem, so any new admin route is covered automatically and must use `requireAdmin` |

**What this means in business terms.** A price change is a change to what every customer pays per AI action, applied today by one click, from an unsourced list, with a record that can vanish. Two of the four models BOS uses live (embeddings and images) are not in the table the admin sees at all.

---

## 2. User stories

- As a **platform admin**, I want a proposal of current official prices with a source link and date for each, so that I never apply a price I cannot trace.
- As a **platform admin**, I want to see old to new, the % change and any ambiguity flags per model, so that I can approve what is clear and hold what is not.
- As a **platform admin**, I want to see what a proposal does to our cost per typical AI action and to customers' credit charges, so that I know the customer effect before I apply.
- As a **platform admin**, I want to approve all or part of a proposal with a mandatory reason, so that every change has a justification on record.
- As the **business owner (us)**, I want every applied price change audited (who, when, old to new, source, reason), so that any charge can be explained later.
- As the **business owner (us)**, I want suggested alternatives (cheaper, newer or better-value models, or price-source confirmation), so that we can lower cost per action deliberately.
- As a **BOS customer**, I want the credits I am charged to reflect the provider's real price, so that I am not overcharged by a stale or rounded price.

---

## 3. Functional requirements

| ID | Requirement | Acceptance criteria |
|---|---|---|
| **MP-FR-1** | **Truthful page and recorded sync (immediate).** Correct the wrong page text (AB-6) and make the existing Sync's audit entry durable (flushed, as the single-row routes do), before anything else changes | - [ ] No text claims prices are fetched from providers; - [ ] the unit shown matches the stored unit; - [ ] the text states changes take effect within the cache window (up to 1 hour); - [ ] legacy "Intelligent Routing" text removed or marked as such; - [ ] a Sync click always leaves an audit row (verified by test); - [ ] the S-1..S-10 guard is updated deliberately, with SA approval recorded |
| **MP-FR-2** | **Model coverage list.** The proposal covers every model that BOS uses live (AB-13), every model an admin or user can select, and every model currently in the table or fallback. Each is classified: in use by BOS / selectable / table-only | - [ ] `text-embedding-3-small` and `gpt-image-1` appear; - [ ] a model in use with **no price** anywhere is flagged "unpriced" at the top; - [ ] Mistral appears (AB-12) (amended by SA finding 5: only if a live code path can call it); - [ ] **(UF, 2026-10-14) each model shows which Business OS areas use it** (chat, insights, briefing, leads, website, intake, onboarding, images, embeddings), derived at view time from the live model settings, never from a typed list (SA re-review RR-3); a model no area uses is labelled "not used by Business OS" |
| **MP-FR-3** | **Researched price per model.** For each model: the official price (input, output, and image or embedding unit where relevant), the provider's official pricing page URL, and the date checked | - [ ] No proposed price without a URL on the provider's own domain and a check date; - [ ] third-party aggregators are not accepted as a source; they are used only as the cross-check in MP-FR-6 (Q0) — **unchanged by UF-1**: the fetch button reads the providers' own pages, and a manually entered price also needs an official URL (SA re-review RR-1) |
| **MP-FR-4** | **Proposal.** A stored proposal listing per model: current price, proposed price, % change, source URL, date checked, and flags | - [ ] Old, new and % are shown per model and per unit; - [ ] a model whose price did not change is listed as "no change" (proof it was checked); - [ ] the proposal is frozen once submitted (its contents cannot change; a correction is a new proposal); - [ ] **(UF-2, 2026-10-14) coverage colour per unit** (input, output, cached input, image): **green** when our current stored price is greater than or equal to the provider's new price (we are covered), **red** when it is below (we undercharge), with the % gap shown per unit; the row shows the worst unit (any red unit makes the row red) and names the red units in text (SA re-review RR-4); colour is never the only signal (MP-NFR-8) |
| **MP-FR-5** | **Ambiguity flags.** Each line may carry flags: cached-input price exists; batch price exists; long-context tier exists; regional pricing; model renamed; model deprecated or retiring (with date); model in use but unpriced; precision loss (the stored value would round the official price) | - [ ] Flags are visible on the review screen; - [ ] a line with a blocking flag (BA suggests "unpriced in use" and "precision loss"; SA to confirm) cannot be applied without an explicit override reason |
| **MP-FR-6** | **Alternatives (decided Q0, Q1).** (a) **Price cross-check, first version:** each researched price is compared with a machine-readable third-party price list; a disagreement (or a model missing from the list) is flagged on the line. The third-party value is never applied. (b) **Alternative models, later slice:** cheaper, newer or better-value models for each BOS AI area with price and estimated effect on cost per typical action | - [ ] (a) Every line shows the cross-check result (agrees / differs by X% / not listed) and the third-party source and date; - [ ] (a) **(SA re-review RR-1, 2026-10-14) kept, and now fetched automatically by the same research button** as a second, independent reading of each price; if the third-party list cannot be fetched, lines show "cross-check unavailable" and the flow continues; - [ ] (b) alternatives are advisory only; approving a price never changes which model an area uses; - [ ] each alternative shows its source and date |
| **MP-FR-7** | **Customer impact before apply.** For the selected lines, show the change in our cost per typical AI action (the §4.5 action types) and in credits charged per action, and the effect on the plan cost ceiling headroom | - [ ] Per action type: old cost, new cost, old credits, new credits; - [ ] states whether the §6.1 "model price change" revisit trigger is met; - [ ] shows any area whose cost per action rises above a threshold (SA proposes the value); - [ ] applying a price **never** changes plan packages, allowances, markup or credit value (Q7); - [ ] **(UF-2, 2026-10-14)** the impact figures use the same green/red coverage colour as MP-FR-4, so a red model's effect on cost per action is visible next to it |
| **MP-FR-8** | **Review and approve.** Any platform admin (Q2: one approval, no second approver, no size threshold; drops and rises follow the same rules, Q3) approves all lines or a chosen subset, or rejects the proposal, with a mandatory reason | - [ ] Approve and reject both require a reason (at least the existing admin-reason minimum); - [ ] a rejected proposal changes no price; - [ ] an unapproved line is never applied; - [ ] a proposal can be approved at most once; - [ ] **(UF-3, 2026-10-14) the primary flow is a per-model Apply button.** Its reason is required but **pre-filled**, e.g. "Provider price change — source <url> (checked <date>)"; the admin confirms or edits it. A line can be applied at most once. Bulk approval of several rows may remain, with the same pre-filled reason per row; - [ ] an **override reason** for a blocking flag (R-4) is never pre-filled (SA re-review RR-5); - [ ] dismissing a pending price is the per-row equivalent of reject and also needs a reason |
| **MP-FR-9** | **Apply with full audit.** Approved lines are applied as new effective prices; prior prices are kept as history (never overwritten or hard-deleted) | - [ ] One audit record per applied change: who approved, who submitted, when, model, old to new, source URL, check date, reason, proposal id; - [ ] the audit write is durable (flushed); - [ ] if the apply fails part way, the outcome is all-or-nothing for the approved set, and the admin is told |
| **MP-FR-10** | **Effective timing shown.** After apply, the screen shows when charges will start using the new price (cache window) | - [ ] The admin sees the expected effective time; - [ ] already-recorded charges are never re-priced |
| **MP-FR-11** | **Retire Sync and direct edits (Q9).** The Sync button and route no longer overwrite prices; they are removed or turned into "create proposal". The single-row add / edit / delete is removed as a write path: every price change, even one line, goes through a proposal | - [ ] No path writes a price without an approved proposal; - [ ] no hard delete of a price remains; - [ ] guard tests updated deliberately with SA approval |
| **MP-FR-12** | **Research input.** ~~Researched prices enter the system as a submitted proposal produced by agent / operator research of the official pages (Q0: option B, section 5)~~ **Amended by UF-1 (2026-10-14): a "Check provider prices" button on the Model pricing page fetches current prices server-side from each provider's official pricing source and stores them as pending prices. They are not live.** If a provider cannot be fetched, the admin can enter that model's new price by hand with an official source URL, so the flow never blocks | - [ ] The button and the manual entry are admin-only and validated; - [ ] malformed or unsourced lines are refused with a clear message; - [ ] ~~the system itself fetches no provider pricing page~~ (reversed by UF-1); - [ ] the fetch writes **only** pending prices, never a live price; - [ ] each provider succeeds or fails on its own: a failure is shown per provider with its reason, and the other providers still load; - [ ] a page whose layout changed fails loudly for that provider and never yields a guessed price; - [ ] every fetch is audited (who, when, per-provider outcome) |
| **MP-FR-13** | **One source of truth.** End drift between the price copies (AB-12) per SA's design (section 6) | - [ ] After the change, a price exists in exactly one authoritative place used for charging; other copies are removed, generated from it, or clearly marked non-authoritative; - [ ] a test or check fails if a second authoritative copy reappears |
| **MP-FR-14** | **Margin check prompt (Q7).** When an applied change touches a model BOS uses live, admins are prompted to go and validate plan margins and credit allowances. Nothing changes automatically | - [ ] The prompt names the models and the cost-per-action change; - [ ] it links to the credit-pricing view; - [ ] it can be marked done with a note; - [ ] a fuller workflow is future roadmap (section 9) |
| **MP-FR-15** | **Monthly research reminder (Q4).** Admins are reminded monthly **by email** (user decision 2026-10-09) that a price research round is due, and can start one on demand at any time | - [ ] An email goes to platform admins when more than 30 days have passed since the last applied proposal, at most once per due period; - [ ] it shows the date of the last approved proposal and links to the Model pricing page; - [ ] the reminder never creates or applies prices by itself; - [ ] SA rules on the scheduled job and email path in that slice's workplan (cron auth, `durable-queue-drain` if it drains a table, existing email infrastructure reused) |
| **MP-FR-16** | **Precision fix, going forward only (Q8).** Prices are stored exactly from the first apply after the fix | - [ ] Past charges are not recomputed, quantified or credited back |
| **MP-FR-17** | **Per-model price history (UF-4, 2026-10-14).** For any model, the admin can open its full price history: every past and current price per unit, when it took effect and when it was replaced, who applied it, the reason and the source | - [ ] Built from the price table's kept rows (retired and active) joined to the pending-price record that produced each one (SA re-review RR-6); - [ ] rows from before the review flow show "before price review" plus any recorded Sync audit, never an invented actor or reason; - [ ] read-only; nothing on it changes a price; - [ ] newest first, with the current price marked |

---

## 4. Non-functional requirements

| ID | Area | Requirement |
|---|---|---|
| MP-NFR-1 | Security | All new routes are admin routes gated by `requireAdmin`; pages by `requireAdminPage`. Inputs validated with Zod. No secrets needed for research (public pages) |
| MP-NFR-2 | Auditability | Every proposal, approval, rejection and applied change is recorded durably. The audit must survive the request ending (flush). Price history is append-only |
| MP-NFR-3 | Accuracy | Stored precision must represent official prices exactly for every model we price (AB-10). The design must state the precision and prove it with a test case at $0.075 per 1M |
| MP-NFR-4 | Safety | A failed research step or failed apply leaves current prices unchanged. No partial apply |
| MP-NFR-5 | Production data | Nothing writes to production without explicit user approval. The user applies migrations by hand. SQL meant for the Supabase SQL editor must not contain the word "into" inside a string literal (known editor bug) |
| MP-NFR-6 | Performance | The review screen loads a proposal of up to ~100 lines in under 2 seconds; impact figures are computed from stored data, not live LLM calls |
| MP-NFR-7 | Cost | Research and impact estimation must not create customer charges; any AI used for research is platform cost, attributed per the BOS LLM standards |
| MP-NFR-8 | Accessibility | The review screen follows the admin design system: keyboard-operable selection of lines, visible focus, flags conveyed by text, not colour alone |
| MP-NFR-9 | Process | No new pattern without SA review (CLAUDE.md rule 7). The proposal-approve-apply flow is new (AB-16) and needs an SA ruling |

---

## 5. Research options: server fetch vs operator research

| Criterion | **(A) Server fetches provider pages on a button click** | **(B) Agent / operator researches with web search and submits a proposal** |
|---|---|---|
| Reliability when page layouts change | **Poor.** Pricing pages are marketing pages, often script-rendered, and change layout without notice. A parser breaks silently or, worse, reads the wrong number | **Good.** A person or agent reads the page as a human does; a layout change does not break it |
| Failure and timeouts | Serverless time limits, bot protection and rate limits are likely; one failing provider blocks or partially fills the proposal | Failures happen outside the system; the system only receives a finished, validated proposal |
| Secrets | None needed (public pages) | None needed |
| Cost to build and keep | High: one parser per provider, maintained forever; a new pattern (no scraping exists, AB-16) | Low: one submission path plus validation; reuses the review flow |
| Cost to run | Near zero per click | Operator or agent time per round (minutes) |
| Freshness | On demand, if the parser works | On demand; as fresh as the last round (Q4 decides cadence) |
| Trust | Looks automatic, but a mis-parse produces a confident wrong price | Each line carries a URL and date the admin can open and check |
| Fit with the money path | A silent wrong number reaching review is the main risk | The review step remains the safety net in both; B gives the reviewer better evidence |

**BA recommendation: (B)**, with mandatory URL + date per line and admin review as the control. (A) could be revisited later for a single stable provider if one publishes a machine-readable price list.

**Decided by the user 2026-10-08 (Q0): (B) plus (C), a machine-readable third-party price list used only as a cross-check** (MP-FR-6a). SA rules on the mechanics: which third-party list, and whether the cross-check is done by the researcher or by the server (if by the server, that is a new external call: timeouts, failure behaviour, no secrets, and what happens when the list format changes).

**Reversed by the user 2026-10-14 (UF-1): (A), a server-side fetch on a button click, is now the research mechanism.** This is a deliberate user reversal of Q0, taken with the risks in the table above known. The controls that make (A) acceptable on the money path are in the [SA Re-review (2026-10-14)](#sa-re-review-2026-10-14): official sources only, a fixed parser per provider that fails loudly, an automatic third-party cross-check, sanity bounds, pending-only writes, and manual entry as the fallback.

---

## 6. Single source of truth (problem statement for SA)

**Problem.** At least ten copies of model prices exist (AB-12). They disagree in date, unit (per token vs per 1M vs per 1K), model coverage and precision. Charging uses the DB table, then the in-code fallback, then a conservative maximum (AB-1 to AB-3). Embeddings and images, both live in BOS, are priced only in code. The table has no columns for cached-input, batch or long-context prices, yet a cached-read discount is hardcoded in the OpenAI provider.

**Constraints (business).**
- One authoritative price per model and unit, used for charging, with history kept.
- Every change to it goes through the approve flow (MP-FR-8, MP-FR-9).
- Charging must still work if the authoritative store is unreachable (today's fallback behaviour must not be lost without a replacement that is equally safe for customers).
- Customers must never be charged at a rounded-up price because of storage precision.
- The live table was created outside migrations (AB-9); any schema change starts by capturing its current definition.

**Candidate options (for SA, not decided by BA).**
1. DB table authoritative; in-code fallback generated from it or reduced to a conservative floor; docs generated or linked.
2. Versioned config in code authoritative (like `creditValue.ts`); DB becomes a read cache; approval becomes a PR.
3. DB authoritative with extra price kinds (cached-input, batch, long-context, image, embedding) as columns or as rows per unit.

SA decides: the authoritative store, table shape and price kinds, precision, the fallback's role, what happens to each copy in AB-12, alias and duplicate rows (AB-11), and whether hard DELETE stays (AB-8).

---

## 7. Proposed slices (provisional, SA to confirm)

> Superseded: first by R-8 (2026-10-08), now by **R-9** in the [SA Re-review (2026-10-14)](#sa-re-review-2026-10-14). Kept for the record.

Each slice is small, shippable alone, and leaves the system consistent.

| # | Slice | Delivers | Depends on |
|---|---|---|---|
| 1 | **Truth fix + sync audit flush** | MP-FR-1: correct page text, flush the Sync audit, deliberate guard update | — |
| 2 | **Proposal storage** | MP-FR-4, MP-FR-5 data side: a frozen proposal with lines, sources, dates, flags; no UI, no apply | SA design ruling |
| 3 | **Review UI (read-only)** | Admin can open a proposal and see old to new, %, flags, sources | 2 |
| 4 | **Apply + audit** | MP-FR-8, MP-FR-9, MP-FR-10: approve all or part with reason, reject, apply, durable audit | 3 |
| 5 | **Customer-impact view** | MP-FR-7 on the review screen | 3 |
| 6 | **Research input + cross-check** | MP-FR-12, MP-FR-2, MP-FR-3, MP-FR-6a; first real proposal produced, **including embeddings and images** (Q6) | 2 |
| 7 | **Retire Sync and direct edits + update guard** | MP-FR-11 | 4, 6 |
| 8 | **Consolidate copies** | MP-FR-13, MP-FR-16 per section 6; includes embeddings, images, Mistral, precision | SA design; may split into 8a/8b |
| 9 | **Margin prompt + monthly reminder** | MP-FR-14, MP-FR-15 | 4 |
| 10 | **Alternative models (later)** | MP-FR-6b | 3, 5 |

No undo slice (Q5: a correction is a new proposal).

Each schema change ships as a migration the user applies by hand on production, after approval.

---

## 8. Open business questions

All **DECIDED** by the user on 2026-10-08. The original options and BA recommendations are kept below for the record.

| # | Decision |
|---|---|
| **Q0** | ~~**Price source:** (B) agent / operator researches the official pricing pages (URL + date per price), **plus (C) a third-party price list as a cross-check only**; disagreements are flagged. The server does not scrape provider pages~~ **REVERSED by the user 2026-10-14 (UF-1, section 8a):** a button on the admin page fetches the official prices server-side. The third-party list stays a cross-check only, now fetched by the same button |
| **Q1** | **Alternatives:** the price cross-check from the first version (= Q0); **alternative models in a later slice**, advisory only |
| **Q2** | **Any platform admin, one approval.** No second approver, no size threshold |
| **Q3** | **Drops and rises follow the same rules** |
| **Q4** | **Monthly reminder + on demand.** No scheduled job that proposes by itself |
| **Q5** | **No undo.** A correction is a new proposal |
| **Q6** | **Embeddings and images in scope from the first proposal** |
| **Q7** | **A price change never changes packages, allowances or credits.** It must prompt the admin to go and validate package margins and credits. A more advanced workflow is future work |
| **Q8** | **Fix precision going forward only.** No measurement of past charges, no credit-backs. (Which flags block apply: BA suggestion "unpriced in use" and "precision loss" stands for SA to confirm) |
| **Q9** | **Remove the direct single-row edit / delete.** Every change goes through a proposal |

**Open (raised 2026-10-14, not yet decided):**

| # | Question |
|---|---|
| **Q10** | **Removing the `gpt-image-1` image prices after its shutdown (23 Oct 2026) is a charging change.** `chargePricing` takes its conservative image rate as the maximum of `IMAGE_FALLBACK_PRICING`. Today that is $0.25 (`gpt-image-1` at high, 1536x1024 / 1024x1536). Once the `gpt-image-1` entries are removed, the maximum becomes $0.212 (`gpt-image-2.5-flare` at max, 1024x1024), so the rate drops from $0.25 to $0.212. Decide here whether and when to remove them, and treat it like any price change (Q7: prompt the admin to re-check package margins and credits). Until decided, the entries stay. Source: `fix/gpt-image-1-retirement` (Change History 2026-10-14) |

**Original questions and BA recommendations (for the record):**

| # | Question | Options | BA recommendation |
|---|---|---|---|
| **Q1** | Which alternatives do we want in a proposal? | (a) confirm each price against a second official source; (b) suggest alternative models per BOS area with price and cost-per-action effect; (c) both | **(c) both, staged:** (a) in the first version, since it protects the money path; (b) as a later slice, advisory only |
| **Q2** | Who may approve a price change, and do large changes need a second admin? | (a) any platform admin; (b) any admin, but a change above a threshold (e.g. >20% either way) needs a second, different admin; (c) only a named owner | **(b)**, threshold 20%. Single admin for routine changes keeps it practical; a second pair of eyes for large ones protects customers. The submitter may not be the second approver |
| **Q3** | Are price drops and rises treated the same? | (a) same rules; (b) rises need extra scrutiny (second approver or impact sign-off), drops do not; (c) drops also scrutinised, since a wrong drop loses margin | **(a) same rules.** Both are equally likely to be research errors; a wrong drop silently costs margin, a wrong rise overcharges customers |
| **Q4** | How often does research run? | (a) only on demand; (b) a reminder to the admins at a set interval (e.g. monthly); (c) a scheduled check that only creates a proposal, never applies | **(b) monthly reminder + on demand.** Matches the operator-research recommendation; (c) only becomes cheap if option A is adopted |
| **Q5** | Keep a "restore last approved prices" undo? | (a) yes, through the same approve + reason flow; (b) no, a correction is a new proposal | **(b) for now.** Because history is kept and every proposal is frozen, a correction proposal is equivalent and simpler; revisit if a bad apply happens |
| **Q6** | Embeddings and images are charged at prices that live only in code (`text-embedding-3-small`, `gpt-image-1`, $0.25/image). Should they come under the same review? | (a) yes, in scope from the first proposal; (b) later slice | **(a).** Images dominate customer cost (one image = 250 credits); an unreviewed image price is the largest single exposure |
| **Q7** | Should an approved price change automatically trigger the credit-pricing revisit (§6.1)? | (a) automatically open a revisit task / note for any applied change; (b) only above a threshold (e.g. a BOS-live model changes by >20%); (c) manual | **(b).** Changes to models BOS uses live above 20% record a revisit entry; small or unused-model changes do not |
| **Q8** | The stored prices are rounded (e.g. $0.075 per 1M stored as $0.08, ~7% high). Should customers already charged at a rounded price be considered? | (a) fix precision going forward only; (b) also quantify past over-charge for information; (c) also credit customers back | **(b).** Fix going forward and quantify; charges are tiny today (test accounts), so decide on (c) only if the figure is material. Also decide which flags block apply (BA suggests: "unpriced in use" and "precision loss") |
| **Q9** | Should the single-row price edit (add / edit / delete one model) remain as a direct path, outside the proposal flow? | (a) keep, as today; (b) keep add/edit but require a reason and source; (c) remove: every change goes through a proposal | **(c).** One controlled path for a money input; a one-line proposal is just as quick. If kept, hard delete should go (SA to rule on the mechanism) |

### 8a. User feedback (2026-10-14)

Recorded by TL from the user, 2026-10-14. SA rulings on it: [SA Re-review (2026-10-14)](#sa-re-review-2026-10-14).

**The flow the user envisions.**

1. As admin, on the Model pricing page, research and sync current provider prices into a **pending area** in the database. Pending prices are not live.
2. Per model, the page shows:
   - the current price and the new provider price;
   - the difference, with a colour (UF-2);
   - which Business OS areas use the model (chat, insights / briefing / leads, website, intake, onboarding, images, embeddings), derived from the live model settings.
3. Each model has its own **Apply** button. Applying makes the new price live; charging follows within the cache window (up to 1 hour). Per Q7, plans, allowances, markup and credit value never change; the admin only gets the margin-check prompt (MP-FR-14).
4. A history and audit log.

**Decisions.**

| # | Decision | Effect on this requirement |
|---|---|---|
| **UF-1** | **Research mechanism:** a button on the admin page that fetches provider prices server-side. This is a **deliberate reversal of Q0** (agent research plus a third-party cross-check, no server scraping) | Section 5 and Q0 marked reversed; MP-FR-12 amended; SA R-3 (admin uploads agent-researched JSON, no new external call) is **superseded** by RR-1 |
| **UF-2** | **Colour rule:** **green** when our current stored price is greater than or equal to the provider's new price (we are covered); **red** when it is below (we undercharge). Show the % gap per model and per unit (input, output, cached input, image) | MP-FR-4 and MP-FR-7 amended; row-level rule in RR-4 |
| **UF-3** | **Per-model apply:** a short reason is required but **pre-filled** (e.g. "Provider price change — source <url>"); the admin confirms or edits it. Bulk approval may remain, but per-row apply is the primary flow | MP-FR-8 amended; per-line state in RR-2 |
| **UF-4** | **Per-model price history view:** every past price, who applied it, when, the reason and the source, built from the retired rows plus the audit | New MP-FR-17; data sources in RR-6 |

---

## 9. Out of scope / future roadmap

- Changing which model a BOS area uses (Layer 2 model settings own that; alternatives here are advisory only).
- Changing the credit value, markup or plan allowances (owned by [BUSINESS_OS_CREDIT_PRICING.md](/docs/architecture/BUSINESS_OS_CREDIT_PRICING.md) §6.3).
- Re-pricing any recorded charge (never done), including the past effect of rounding (Q8).
- An advanced margin-review workflow after a price change (Q7: today only a prompt; to be designed later).
- Two-admin approval and a "restore last approved prices" undo (Q2, Q5: declined for now).
- Reconciling with provider invoices (a later idea: compare our measured cost with the actual bill).
- Pricing for the non-BOS legacy AgentsPilot flows beyond what shares the same table.

---

## 10. Integration points

| System | Effect |
|---|---|
| `ai_model_pricing` (live table, outside migrations) | Source of current prices; schema may change per SA |
| `lib/ai/pricing.ts`, `aiModelPricingRepository` | Reads prices for charging; cache window |
| `lib/business-os/llm/chargePricing.ts` | Unknown-model conservative charge |
| Credit ledger (`business_os_credit_charges`) | Charges computed from these prices; never re-priced |
| `/admin/system-config` page and `pricing` / `pricing/sync` routes | Sync retired; review flow added (location for SA/UX) |
| `source.guard.test.ts` | Deliberate update, SA-approved |
| Audit trail (`AuditTrailService`) | New durable audit events for proposal, approve, reject, apply |
| `/admin/business-os-llm` Costs & credits tab | Data source for impact figures (§6.2 of credit pricing) |
| [ADMIN_BOS_CLEANUP_REQUIREMENT.md](/docs/requirements/ADMIN_BOS_CLEANUP_REQUIREMENT.md) §11 | Parked Sync item superseded by this requirement; add a pointer there |
| [ADMIN_IDENTIFICATION_AND_ACCESS.md](/docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md) | New admin routes listed |
| [AI_PROVIDER_MODELS.md](/docs/AI_PROVIDER_MODELS.md) | One of the price copies; fate per section 6 |

---

## SA Requirement Review (2026-10-08)

**Reviewed by SA against origin/main `a689de3f`. Verdict: APPROVED WITH CONDITIONS.** Slice 1 may start now. Slices 2+ start only after a Dev workplan that adopts the rulings (R-1..R-8) and the slice plan below. Q0–Q9 are not reopened.

### Findings

1. **AB-10 is not proven.** The page's `formatCost` (`page.tsx:220-226`) shows per-token values at 8 decimals, so the screen shows $0.075/1M as $0.08/1M even when storage is exact. Slice 2 starts with read-only checks: `numeric_precision`/`numeric_scale` from `information_schema.columns` and `select input_cost_per_token::text`. If storage is exact, the precision work is display-only. R-1 stands either way.
2. **AB-13 image price is a 9-entry table, not a flat $0.25.** `IMAGE_FALLBACK_PRICING` is keyed `model:size:quality` ($0.011–$0.25). The setting `image_generation_prices_usd` (Layer 1.5) overrides it. Both are also read by the Layer 2 guardrail (`lib/business-os/llm/modelSettings.ts:322`). That guardrail is a price reader the requirement does not list.
3. **The FR-12 conservative rate comes from the in-code tables.** `chargePricing.ts` takes the maximum of `FALLBACK_PRICING` per provider (and of `IMAGE_FALLBACK_PRICING`). Reducing or "generating" the fallback lowers the conservative charge silently. Option 1's "reduced to a conservative floor" is therefore rejected.
4. **The cache is per serverless instance.** `refreshPricingCache()` refreshes only the instance that runs it. "Effective everywhere within 1 hour of apply" is the only honest claim for MP-FR-10.
5. **Mistral is dead code.** `lib/ai/providers/mistralProvider.ts` has no importer and is not in the provider factory. The MP-FR-2 AC "Mistral appears" is amended: a model appears only if a live code path can call it. Mistral's inline rates are deleted in slice 10, not priced.
6. **`helpbot_embedding_cost_per_1k_tokens`** feeds only `EmbeddingService`'s returned/logged cost. The charge comes from the provider tracking path (`pricing.ts`). It is still a copy (fate in R-1).
7. **The 50% cached-read rule** (`openaiProvider.ts:564-580`) is right for the gpt-4o family BOS uses. OpenAI's cached-input discount varies by model family, so research must capture cached-input per model (R-1).
8. **Same-day re-apply collides.** The unique constraint `(provider, model_name, effective_date)` covers retired rows, and `effective_date` is a `date`. A second apply on the same day fails unless the constraint changes (R-1).
9. **ACs made testable here:**
   - MP-FR-7 threshold = **20%** rise in cost per action type.
   - MP-FR-13 guard defined in R-1.
   - MP-FR-15 "due" = more than 30 days since the last applied proposal.
   - MP-FR-2 coverage set is computed, never typed: active DB rows ∪ in-code tables ∪ BOS call-catalog defaults ∪ current Layer 2 settings.
10. **MP-NFR-7 is N/A.** Research happens outside the product, so there is no in-product AI call and `bos-llm-call-standards` does not apply.
11. **Housekeeping.** Every new route uses `requireAdmin` as its first statement and every page uses `requireAdminPage`. New routes are listed in ADMIN_IDENTIFICATION_AND_ACCESS.md. The ADMIN_BOS_CLEANUP §11 pointer ships in slice 1. No entitlements import is expected; if one appears, the `business-os-entitlements` checklist applies.

### Design rulings

**R-1 Single source of truth.**
- **Authority.** The DB is authoritative.
  - Token prices stay in `ai_model_pricing`, which gains:
    - nullable `cached_input_cost_per_token`;
    - `proposal_id` and `proposal_line_id`, for provenance.
  - Images get a sibling table, `ai_model_image_pricing`, with the same lifecycle: provider, model_name, size, quality, cost_per_image, effective_date, retired_date, created_at, plus the provenance columns.
  - Images get their own table, not rows in the token table. The billing reader would read an image row as a $0 token price.
- **Price kinds.**
  - Embeddings are token rows with output 0, as `isInputOnlyPricedModel` already allows.
  - Batch and long-context are **flags only, not stored**: no BOS call uses batch or reaches a long-context tier. Add a column when one does.
- **Precision.**
  - Both cost columns become unconstrained `numeric`.
  - Prices travel as per-1M **decimal strings** (Zod `^[0-9]{1,6}([.][0-9]{1,9})?$`, never a JS float). The RPC converts them in SQL (`p / 1000000`).
  - Test: a submitted `0.075` stores a value equal to `0.075/1000000` exactly.
  - Display shows per 1M with no rounding.
- **Capture first.** Before any DDL, the user runs a read-only query (columns, types, constraints, indexes, policies, grants, triggers, dependent views) and pastes the result into the workplan. A baseline migration (`CREATE TABLE IF NOT EXISTS` plus the constraints as found, a no-op on prod) commits the definition, and only then does the slice-2 migration change it.
- **Constraint.** Drop `(provider, model_name, effective_date)` and replace it with a partial unique index on the same columns `WHERE retired_date IS NULL`. Apply retires the previous active row, then inserts.
- **`FALLBACK_PRICING` and `IMAGE_FALLBACK_PRICING`** stay in code as **non-authoritative outage fallbacks** and as the FR-12 conservative-rate source.
  - Their headers say so.
  - Never shrink them.
  - An approved line that differs from them adds a "fallback differs, update by PR" item to the margin prompt (MP-FR-14).
  - A proposed price above the provider's conservative rate is flagged. The conservative rate would then under-charge.
- **Copies (AB-12):**

| Copy | Fate |
|---|---|
| DB table | Authoritative |
| In-code fallbacks | Kept, marked as above |
| Sync list | Deleted (slice 8) |
| `AI_PROVIDER_MODELS.md` | Prices removed, replaced by a pointer |
| `20260213` migration | Immutable history |
| `SQL Scripts/20251030…` | Deleted (a runnable bypass) |
| `usageTracker.ts` | Deleted (no importer) |
| Mistral inline rates | Deleted with the dead provider |
| `image_generation_prices_usd` setting | No longer read (slice 6) |
| Helpbot embedding cost setting | No longer read: `EmbeddingService` uses `pricing.ts` |
| 50% cached-read rule | Uses the cached-input column when set, else today's rule |

- **MP-FR-13 guard.** A Jest source guard fails on a numeric per-token or per-image price literal outside the two fallback files and `supabase/migrations/`.
- **Alias and duplicate rows.** Duplicate history rows are retired (`retired_date`), never deleted. Newest-wins already ignores them, so no charge changes. Alias rows are retired only after a read-only `token_usage` check shows no call under that name in 90 days. Hard DELETE goes (Q9).

**R-2 Proposal storage and approval.** This is a new pattern and is approved.
- **Precedent.**
  - The freezing principle comes from `ConfirmationStore`: store the resolved plan, replay exactly, fail on drift.
  - Its storage does not. It is TTL'd, and this record must be durable.
  - Storage follows `20261017_business_os_credit_lots.sql`:
    - client roles get `REVOKE ALL`;
    - RLS is on, with admin-only SELECT via `is_platform_admin()`;
    - functions are `SECURITY INVOKER`, `EXECUTE` is granted to `service_role` only, and a migration source test pins the grants.
- **Tables.**
  - `ai_price_proposals`: status `submitted|rejected|applied`, submitter, decided_by/at, reason, applied_at, margin-review done/by/note.
  - `ai_price_proposal_lines`: kind token|image, model, current-price snapshot, proposed per-1M strings, source_url, checked_on, flags[], cross-check value/source/date/verdict, override_reason.
  - Lines are insert-only.
- **All-or-nothing apply.** Approval with a subset is one plpgsql RPC, so one transaction:
  - lock the proposal `FOR UPDATE WHERE status='submitted'` (this enforces "at most once");
  - defence-in-depth `admin_users` check on `p_admin_user_id`;
  - refuse unless every selected line's snapshot equals the live active price (stale → abort, resubmit);
  - retire the prior rows and insert the new ones;
  - set `applied`;
  - return one result row.
- **Writes go through repository `.rpc()` only.** No `.update().or().select()` chains (the PostgREST 42703 bug). No word "into" inside any string literal or `RAISE` message; the migration test asserts this.
- **Effective date** is `(now() at time zone 'utc')::date`, matching `listActive`.
- **Audit.**
  - New registered events, with valid severities. An invalid severity destroys the whole batch.
    - `AI_PRICE_PROPOSAL_SUBMITTED`, `_REJECTED`, `_APPLIED`.
    - `AI_PRICING_APPLIED_LINE`, one per line (MP-FR-9).
    - `AI_PRICE_MARGIN_REVIEW_DONE`.
  - All entries are queued, then written with `logAndFlush` before the response.
  - The DB provenance columns are the backstop record.
- **Cache.** After apply, call `refreshPricingCache()` and show "in effect on all servers by HH:MM" (applied_at + 1 h).

**R-3 Research input.** *Superseded 2026-10-14 by RR-1 and RR-2 (user decision UF-1). Kept for the record; the domain allow-list, server-computed flags and the LiteLLM choice carry over.*
- **Submission.** An admin uploads or pastes a JSON proposal on the review page. `POST /api/admin/model-pricing/proposals` takes it, with `requireAdmin` first and a strict Zod schema.
  - `source_url` must be https on the provider's official domain. The provider→domain allow-list is config data, not model names.
  - The server computes every flag and the cross-check verdict itself, and never trusts the researcher's.
- **No other route in.** No script writes proposals: that would be a second write path.
- **Contract.** The Zod schema is the contract. A runbook gives the research agent the JSON shape and steps.
- **Cross-check.** The **researcher** does it, not the server, so there is no new external runtime call.
  - The proposal carries the third-party value, URL and fetch date per line.
  - The server derives agrees / differs X% / not listed.
- **Suggested list:** LiteLLM `model_prices_and_context_window.json` (per-token, includes cache-read and image). Alternative: OpenRouter `/api/v1/models`.

**R-4 Blocking flags.**
- **Hard refusal at submission** (no override):
  - precision loss (more than 9 decimals per 1M);
  - zero or negative price (output 0 is allowed only for input-only models);
  - non-official or missing source URL or date.
- **Blocking with a per-line override reason:**
  - **unpriced in use**, amended to proposal level: approving while any BOS-live model stays unpriced;
  - cross-check differs by more than 5%;
  - BOS-live model renamed or retiring.
- **Informational only:** cached/batch/long-context/regional exists, large change, above the conservative rate, fallback differs.

**R-5 Guard tests (S-1..S-10).**
- **Slice 1:** S-1 and S-4 are re-pinned to the new truthful strings, still byte-exact. S-2/3/5–7/9/10 stay unchanged (S-5's false *comment* goes in slice 8 with the handler). The guard header records the approval: "SA 2026-10-08 R-5".
- **Slice 8:** S-1..S-10 are replaced by assertions that no Sync handler, button, route or direct-write handler exists.
- **Every slice:** the page-level G-* assertions stay.

**R-6 Impact view (MP-FR-7).** Use both sources, with distinct roles.
- **Base cost per action type** = p50/p90 from the ledger (`business_os_credit_charges`, via the Costs & credits tab's repository), last 30 days.
- **Per-model input/output token share** from `token_usage` through the existing admin analytics repository. Verify the columns with `business-os-schema-check`.
- **New cost** = base × the share-weighted price ratio. Credits are cost / $0.001.
- **§4.5** is shown only as a labelled benchmark when an action type has fewer than 5 charges.
- **Headroom** = plan cost ceiling (25% of fee) vs p90 account period cost × ratio.
- No live LLM call (NFR-6).

**R-7 Slice 1 confirmed: ships now, independently, no migration.**
- `page.tsx`:
  - S-1 helper text and S-4 paragraph state that Sync copies a built-in list and contacts no provider;
  - units say per token;
  - edits take effect within up to 1 hour;
  - the "Intelligent Routing" box and the routing sentence are removed;
  - `formatCost` no longer rounds to 8 decimals.
- `pricing/sync/route.ts`: flush after `logAIPricingSynced`, exactly as the sibling `pricing/route.ts` (WC-7 `auditTrail.flush()`, non-blocking). Correct the false "external sources" header comment.
- Sync route test: the flush is called after the audit write, and a flush failure still returns 200.
- Guard per R-5.
- ADMIN_BOS_CLEANUP §11 pointer.

**R-8 Slice plan (replaces section 7).** *Superseded 2026-10-14 by R-9 (rows 1 and 2 are done; the rest is re-planned).* "Mig" means a migration the user applies by hand on prod.

| # | Slice | Mig | Notes |
|---|---|---|---|
| 1 | Truth fix + sync audit flush | No | R-7 |
| 2 | Capture + baseline + precision + partial unique + new columns + empty image table + retire duplicate/alias rows | Yes | Readers unchanged; zero charge change |
| 3 | Proposal tables + submit RPC + repository + submit/read routes + server-side flags (R-3, R-4) | Yes | Research contract and runbook |
| 4 | Review UI, read-only + upload | No | **Follow-up from slice 2 QA (2026-10-11):** the admin pricing list (`listAll()`, no `retired_date` filter) shows retired rows exactly like active ones, so after the slice 2 retire it still lists all 54 rows. The review UI must hide retired rows or label them as retired. If slice 8 keeps any part of the old page, the same applies there. Not fixed in slice 2 |
| 5 | Customer-impact view (R-6) | No | Ships **before** apply |
| 6 | Readers on the authoritative store: images (resolver + Layer 2 guardrail), cached-input, `EmbeddingService`; stop reading the two settings | No | An empty table falls back, so it is safe |
| 7 | Approve / reject / apply RPC + audit + effective time + margin prompt (MP-FR-14) | Yes | |
| 8 | Retire Sync and direct add/edit/delete + guard (R-5) | No | **Must merge before the first real apply**: a Sync click would overwrite approved prices |
| 9 | First real proposal, incl. embeddings and images (Q6) | No | Operational, run with the user |
| 10 | Consolidate remaining copies + MP-FR-13 guard | No | |
| 11 | Monthly reminder (MP-FR-15) by **email** (user decision 2026-10-09) | No (SA to confirm whether a sent-marker needs one) | Scheduled job + email; SA rules in the slice workplan |
| 12 | Alternative models (MP-FR-6b), later | No | |

**Conditions:** AB-10, AB-12 and AB-13 corrected per findings 1, 2, 5 and 6 when the workplan is written. Every migration ships with a source test, matching the credit-lots precedent.

---

## SA Re-review (2026-10-14)

**Reviewed by SA against origin/main `799f8018`, after the user feedback in [section 8a](#8a-user-feedback-2026-10-14). Verdict: the server-side fetch (UF-1) is APPROVED as a new pattern (CLAUDE.md rule 7), WITH CONDITIONS RR-1..RR-8.** R-3 is superseded, R-2 is amended by RR-2, R-8 is replaced by R-9. R-1, R-4 (extended in RR-1), R-5, R-6 and R-7 stand. Q1–Q9 are not reopened; Q0 is reversed by the user.

### Urgent finding outside this requirement

**F-A. `gpt-image-1` shuts down on 23 October 2026.** OpenAI's official deprecations page (developers.openai.com/api/docs/deprecations, checked 2026-10-14) lists `gpt-image-1` for shutdown on October 23, 2026, substitutes `gpt-image-2.5-sunburst` or `gpt-image-2.5-flare`. It is the Business OS images default (`IMAGE_GENERATION_CONFIG_DEFAULTS` in `lib/repositories/SystemConfigRepository.ts`). Image generation for customers stops in 9 days unless the model changes. This is escalated to TL as **BQ-1**; it is not part of any slice here. The LiteLLM list also carries `deprecation_date: 2026-10-23` for it, so the RR-1 cross-check would have raised the "retiring" flag automatically.

### Source survey (2026-10-14)

Checked by fetching each page from a plain server-side client. No provider publishes an official pricing API. Three of four publish an **official markdown version** of the pricing page, which is the most structured official source available.

| Provider | Official page (human URL, stored as `source_url`) | Machine-readable official form | Traps found |
|---|---|---|---|
| OpenAI | `developers.openai.com/api/docs/pricing` (`platform.openai.com/docs/pricing` redirects; `openai.com/api/pricing` returns 403 to a server) | `…/pricing.md` (markdown tables) | Same model in several tables at different prices: Standard, Batch, Flex, Fast, Ultrafast, fine-tuning (`gpt-4o-mini` appears three times). Image models are priced per token on this page; per-image prices by size and quality are on the image-generation guide. Embeddings sit in a separate grouped table |
| Anthropic | `platform.claude.com/docs/en/about-claude/pricing` (`docs.anthropic.com` redirects) | `…/pricing.md` | Rows keyed by **display name** ("Claude Sonnet 4.6"), not API id; cache-write 5 min / 1 h and cache-hit columns; retired models still listed, with a note inside the name cell |
| Google | `ai.google.dev/gemini-api/docs/pricing` | `…/pricing.md.txt` | Free-tier and paid-tier columns; prompt-length tiers; some cells hold **two dated prices** ("$0.75 through December 31, 2026. $1.50 starting January 1, 2027") |
| Kimi (Moonshot) | `platform.kimi.ai/docs/pricing/chat` (`platform.moonshot.ai` redirects) | `…/chat.md` exists, but its tables are JSX components (`DocTable rows={[...]}`), not markdown tables | The most brittle of the four; column sets differ per model series |
| LiteLLM (third party) | n/a | `raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json`, JSON, about 2.8 MB | Per-token **floats**; cache-read; per-image entries keyed `quality/size/model`; `deprecation_date`; a `source` field pointing at the official page; Gemini listed under more than one provider key with different sources |
| OpenRouter | n/a | `openrouter.ai/api/v1/models` | A resale catalogue, not provider list prices. Not used |

### Rulings

**RR-1 Research fetch (UF-1).**
- **Primary source: the provider's official markdown page**, per the survey. HTML scraping is not used. The provider-to-URL-and-parser map is code config (a URL is not a model name); it is never client-supplied, so the route has no SSRF surface. Each line stores the **human** page URL as `source_url`, so **MP-FR-3 holds unchanged**.
- **LiteLLM as the primary source: rejected.** MP-FR-3 forbids a third-party source; its values are floats transcribed by others, can lag the provider, and its provider keys are ambiguous.
- **MP-FR-6a cross-check: kept, now fetched automatically by the same button.** It is the only independent defence against the main risk of a fetch (section 5): a parser reading the wrong table or column and producing a confident wrong number. Rules:
  - fetched in parallel with the providers; if it fails, lines show "cross-check unavailable" (informational) and nothing blocks;
  - compared numerically with a tolerance; a LiteLLM value is never stored as a price, only shown as text;
  - its `deprecation_date` feeds the R-4 "retiring" flag.
- **Parsing.** One pure adapter per provider: page text in, `{ lines, problems }` out. Deterministic only. **No LLM reads the page**: that would make a price non-deterministic and add an in-product AI call (MP-NFR-7 stays N/A).
  - Each adapter pins its anchors: the section heading (OpenAI: "Standard" only, never Batch, Flex, Fast, Ultrafast or fine-tuning), the exact column header names, and the unit text ("/ MTok", "1M tokens", per 1M).
  - **A missing anchor fails that provider** with reason `layout_changed` and **zero lines**. A cell that is not exactly one price (two dated prices, "Free of charge", a range) sends that model to "needs manual entry" with the cell text shown. Never take the first number found.
  - Prices go from page text straight to the per-1M decimal string (R-1). No float at any step.
- **Model matching.** Only models in the computed MP-FR-2 coverage set are proposed. A display name is turned into an id by a generic rule (lowercase, spaces and dots to hyphens, parenthetical notes dropped) and must match a coverage id **exactly**. No per-model mapping table in code (CLAUDE.md rule 5). A coverage model the page does not yield is listed "not found on provider page", for manual entry.
- **Images.** Per-image prices (size and quality) come from the official image-generation guide when the adapter finds its anchored table; otherwise image lines go to manual entry. The first fetch slice does not depend on them.
- **Runtime.** Node runtime, never Edge; `maxDuration = 60`.
  - Each source has a 10 s timeout (`AbortController`); all run in parallel (`Promise.allSettled`). One retry on a network error or 5xx, none on 4xx. Response caps: 5 MB per markdown page, 8 MB for LiteLLM. The handler is designed to finish within 30 s.
  - **Partial failure:** every provider gets its own outcome: `ok`, `http_<status>`, `timeout`, `blocked`, `layout_changed` or `too_large`. Outcomes are stored on the fetch record and shown per provider. Successful providers still load.
  - **Bot and rate protection:** an honest User-Agent naming the product. No headless browser, no evasion, no proxies. A 403 or a challenge page is `blocked`, and that provider goes to manual entry. One fetch per click; the server refuses a new fetch within 60 s of the previous one (double-click guard).
- **Secrets:** none. Public pages, no keys, nothing to rotate.
- **Logging:** Pino, `createLogger({ module: 'ModelPriceFetch' })`, child with `correlationId`. One line per source: provider, outcome, duration, bytes, lines parsed. Failures at warn or error with `{ err }` and the reason code. Page bodies are never logged.
- **Authorisation:** `requireAdmin` is the first statement of the fetch, manual-entry, read, apply and history routes; the page uses `requireAdminPage`. The admin id is passed to the RPC, which repeats the `admin_users` check (R-2).
- **Audit of the fetch:** new events `AI_PRICE_FETCH_RUN` (round id, per-provider outcome, line counts) and `AI_PRICE_MANUAL_ENTRY`, with a registered, valid severity (info), written with `logAndFlush` before the response.
- **Validation.** Parser output and manual entry pass **the same** Zod schema: the R-1 per-1M decimal-string regex, an https `source_url` on the provider's official-domain allow-list, a `checked_on` date. Then server-side bounds, added to R-4:
  - **hard refusal** (line not stored, shown as a problem): zero or negative (output 0 only for input-only models), more than 9 decimals per 1M, or above a sanity ceiling ($1,000 per 1M tokens; $5 per image; named config constants);
  - **blocking with an override reason:** a move of more than **50%** either way against the current price (upgraded from informational for fetched lines); cross-check differs by more than 5% (unchanged); cross-check marks the model retiring.
- **Writes:** the fetch and manual entry write **only pending lines**, through the submit RPC. `ai_model_pricing` and `ai_model_image_pricing` are written only by the apply RPC (RR-2). A migration source test pins that the submit RPC never names the live tables.
- **Fallback:** manual entry per model and unit: price, official https source URL (allow-listed; **never fetched by the server**), checked date. Same flags, same review. It is also the path for models no adapter covers. The flow never blocks on a fetch.
- **Tests:** per provider a trimmed, dated fixture of the markdown page, and a trimmed LiteLLM JSON, committed under the adapter's `__fixtures__`. Pure parser tests with negative controls: renamed heading, renamed column, two-price cell, Batch table ignored, unmatched model. The orchestration is tested with an injected fetch (timeout, one provider failing, oversized body). **No network in CI.** The tests run inside the existing Jest job in well under a second: **no added CI time**, no new job. Fixtures must not contain a backslash followed by a hex letter (Tailwind scan hazard, PR #180 guard).
- **Monitoring of a broken parser:**
  - the page shows, per provider, the last successful fetch and the last failure reason;
  - each failure is a Pino warn or error line;
  - the monthly email (MP-FR-15) lists every provider whose last fetch failed or that has not fetched successfully in 30 days.
  - No scheduled fetch is added: Q4 ("no scheduled job that proposes by itself") still holds.

**RR-2 Pending area and per-line apply (UF-1, UF-3; amends R-2).**
- **Tables keep the R-2 names; the meaning changes.** `ai_price_proposals` is one fetch round or one manual entry: `source_kind` fetch or manual, per-provider outcomes, created_by, created_at. It has **no** approve or reject status.
- **`ai_price_proposal_lines`**: the price content (proposed per-1M strings, current-price snapshot, source, checked date, flags, cross-check) is insert-only. A per-line **state** `pending | applied | dismissed | superseded` with decided_by, decided_at, reason and override_reason is written only by the RPCs, via a column-level grant to `service_role` (as slice 2's `UPDATE (retired_date)`).
- **One pending line per model and unit key** (provider, model, and for images size and quality). A new submit marks older pending lines `superseded` in the same transaction. The page shows the newest pending line per model.
- **Apply RPC** takes one line id (the per-row button) or several (bulk). One transaction, all-or-nothing for the selection:
  - lock each line `FOR UPDATE` where state is `pending` (at most once per line);
  - stale check: snapshot equals the live active price, else abort;
  - retire the prior row and insert the new one with `proposal_id` / `proposal_line_id`;
  - set `applied`;
  - write one `ai_price_apply_batches` row per call, holding the MP-FR-14 margin-review fields (done, by, note).
- **Dismiss RPC:** per line, reason required.
- **Reason pre-fill (UF-3):** built **in the page** from the line's source URL and checked date ("Provider price change — source <url> (checked <date>)"). The server requires the usual admin-reason minimum and stores the confirmed text; it never makes a reason up. **Override reasons are never pre-filled**: a pre-filled override would defeat the blocking flag.
- **Audit events** replace R-2's proposal-level ones: `AI_PRICE_FETCH_RUN`, `AI_PRICE_MANUAL_ENTRY`, `AI_PRICING_APPLIED_LINE` (one per line), `AI_PRICE_LINE_DISMISSED`, `AI_PRICE_MARGIN_REVIEW_DONE`.
- **Unchanged from R-2:** storage and grants per the credit-lots precedent, service-role RPCs called through the repository `.rpc()`, no `.update().or().select()`, no word "into" inside a string literal or `RAISE` message, UTC effective date, `refreshPricingCache()` and "in effect on all servers by HH:MM".

**RR-3 Domain tags (MP-FR-2 amendment).** Live data through existing repositories and the existing resolver; never a typed model list.
- **Areas:** for each area in `BOS_LLM_AREAS` (the catalogue names areas and calls, not models), the model each call resolves to comes from `validateAreaRow`, the same resolver `/admin/business-os-llm` uses, reading through `systemConfigRepository`. The model is tagged with that area. Resolved-first: if the resolver rejected or locked a stored value, the tag goes to the model the call actually uses.
- **Embeddings:** the `helpbot_embedding_model` setting (excluded from area rows) via `systemConfigRepository`, tagged "embeddings (chat)".
- **Images:** the images area's resolved model, tagged "images".
- A model no call resolves to is "not used by Business OS". Non-BOS AgentsPilot flows are not tagged (section 9).
- Tags describe **today's** settings; past charges may have used other models. Computed server-side per page load (the resolver caches 60 s).

**RR-4 Colour rule (UF-2).**
- **Per unit** (input, output, cached input, image per size and quality): gap % = (our current − provider's new) ÷ provider's new. **Green** when the gap is 0 or more; **red** when below 0. Equal prices: green, "no change".
- **"Current" is the rate we charge today.** For cached input with no stored value, it is the rate today's rule charges (the OpenAI 50% rule), labelled "derived".
- A unit only one side has: grey "not compared", no colour.
- A Business OS model with no stored price: red, "not priced" (with the R-4 unpriced flag).
- **Row (recommended): worst unit wins.** Red if any compared unit is red; green only when every compared unit is green. In business words: a model is covered only when every part of its price is covered. The row names the red units in text ("Undercharging: output −12%"), with per-unit chips beside. Icon and text go with the colour (MP-NFR-8). The user may override this; it is a display choice, not a data one.

**RR-5 Per-model apply (UF-3).** Covered by RR-2. The per-row button is the primary flow; bulk stays and uses the same RPC. MP-FR-9's all-or-nothing applies to the selection actually submitted.

**RR-6 Price history (UF-4, MP-FR-17).**
- **Primary source is the database, not the audit.** All rows of `ai_model_pricing` / `ai_model_image_pricing` for the model, retired included, ordered by effective date then `created_at` (same-day applies). Each is joined by `proposal_line_id` to its line: who applied (admin email via the admin-user repository), reason, override reason, source URL, checked date.
- **The audit fills only the gap before provenance existed:** rows without a `proposal_line_id` show any recorded Sync or single-row audit event (durable since slice 1); otherwise "before price review — no record". The 12 rows retired in slice 2 show "retired in clean-up 2026-10-11".
- Reads only, through repositories; `requireAdmin`; no migration beyond an index on `proposal_line_id`, which ships in slice 3.

**RR-7 Other requirement effects.** MP-NFR-1 now covers outbound HTTP to fixed public URLs (no secrets). MP-NFR-7 stays N/A (no AI call). MP-NFR-4 holds: a failed fetch writes nothing live.

**RR-8 Scope of the new pattern.** Outbound fetching of third-party content from a serverless route is approved **only in this shape and for this feature**: fixed URLs, pending-only writes, an admin click. Any reuse elsewhere needs its own SA review. Code location: `lib/ai/pricing-research/` (adapters and orchestration); routes under `/api/admin/model-pricing/`.

### R-9 Slice plan (replaces R-8)

Order follows the user's priority: **see** current vs new with colours and areas (3–5), then **apply** per model (6–8), then **history** (9). Each slice ships alone. "Mig" means a migration the user applies by hand; **production applies happen only with the user's explicit OK**.

| # | Slice | Delivers | Mig | Depends on |
|---|---|---|---|---|
| 1 | ✅ Truth fix + sync audit flush | Done, PR #281 | No | — |
| 2 | ✅ Schema groundwork | Done, PR #304, applied 2026-10-11 | Yes (applied) | — |
| 3 | **Pending-price storage** | Round and line tables (RR-2), submit RPC with server-side flags (R-4 + RR-1 bounds) and supersede, repository, manual-entry route, read route returning current vs pending with per-unit gap and colour (RR-4) and area tags (RR-3). Live price tables untouched: zero charge change | **Yes** | 2 |
| 4 | **Comparison page** (read-only + manual entry) | Current vs new, colours, % per unit, areas, flags, per-provider status; manual entry form; retired rows hidden or labelled (slice 2 QA follow-up) | No | 3 |
| 5 | **"Check provider prices" button: OpenAI + cross-check** | Fetch route, OpenAI adapter (tokens, embeddings; images when anchored), LiteLLM cross-check, bounds, fixtures, fetch audit | No | 3, 4 |
| 6 | Retire Sync and direct add / edit / delete + guard (R-5) | MP-FR-11. **Must merge before any apply** | No | 4 |
| 7 | Readers on the authoritative store | As R-8 row 6: images (resolver + Layer 2 guardrail), cached input, `EmbeddingService`; stop reading the two settings. Without it an applied image or cached price would not be charged | No | 2 |
| 8 | **Per-model apply (+ bulk) and dismiss** | Apply and dismiss RPCs, pre-filled reason, durable audit, effective time, margin prompt (MP-FR-14), apply-batch record. Charges change only when an admin clicks Apply | **Yes** | 4, 6, 7 |
| 9 | **Price history view** | MP-FR-17 (RR-6) | No | 8 |
| 10 | Anthropic adapter | Fixture-tested | No | 5 |
| 11 | Google and Kimi adapters | Per **BQ-4**; may split 11a / 11b, or be dropped in favour of manual entry | No | 5 |
| 12 | First real round, with the user | Includes embeddings and images (Q6). Operational; production apply only with the user's explicit OK | No | 8 |
| 13 | Customer-impact view (MP-FR-7, R-6) | Position per **BQ-2** | No | 4 |
| 14 | Consolidate remaining copies + MP-FR-13 guard | As R-8 row 10 | No | 8 |
| 15 | Monthly email reminder + fetch health | MP-FR-15 and the RR-1 monitoring list | Maybe (a sent-marker; SA rules in the workplan) | 5, 8 |
| 16 | Alternative models (MP-FR-6b), later | Advisory only | No | 13 |

Slice 7 has no dependency on 3–6 and can run alongside them.

**Notes for slice 8, recorded at the slice 3 SA code review (2026-10-14):**

- **Stale check per basis.** A line's `current_cached_input_cost_per_token` is the derived OpenAI value (half the input) even when `current_basis = 'table'`, because no charge reads the cached-input column before slice 7. The apply RPC must re-derive it, never compare it with the table column. Values whose basis is the in-code table or the image setting are not table rows either; the stale check is defined per basis.
- **Rollback lock.** Before slice 8 makes an apply possible, the slice 3 rollback must take `LOCK TABLE public.ai_model_pricing, public.ai_model_image_pricing IN SHARE ROW EXCLUSIVE MODE` before its guard, so an apply cannot add a referencing row between the guard and the drops. Not reachable today.

### Business questions (only these remain)

| # | Question | SA recommendation |
|---|---|---|
| **BQ-1** | **Urgent, outside this requirement.** `gpt-image-1`, the Business OS image model, shuts down on 23 October 2026 (F-A). Who decides the replacement model and its price, and when? | Open a separate urgent item today. Pick the replacement and enter its price under today's mechanism before switching, so images are never charged at an unknown price. Do not wait for this feature |
| **BQ-2** | Must the customer-impact view (cost and credits per action, plan headroom) exist **before** the first real apply, as R-8 had it, or can it follow the history view, as your stated priority implies? | **After history** (slice 13). The green/red colours already show whether we are covered, plans never change automatically (Q7), and the margin-check prompt asks you to review after each apply |
| **BQ-3** | When our price is **far above** the provider's (we charge customers more than needed), it is green under UF-2. Do you want that called out? | **Keep it green, no third colour**, but show the % gap in text ("we charge 35% above provider") and let the list sort by gap, so overcharging is visible and a price drop is one click away |
| **BQ-4** | No Business OS area uses Google or Kimi models today; their pricing pages are the hardest to read automatically. Build automatic fetch for them, or use manual entry for them until they are used? | **Manual entry for Google and Kimi** until a Business OS area selects one of their models. Build OpenAI (slice 5) and Anthropic (slice 10) automatically |

**Decided by the user 2026-10-14:** BQ-2, BQ-3 and BQ-4 follow the SA recommendations: the customer-impact view comes after the history view (slice 13 stays where R-9 puts it); a price far above the provider's stays green with the % gap shown and the list sortable by gap (no third colour); Google and Kimi use manual entry until a Business OS area uses one of their models (slice 11 deferred). BQ-1 (`gpt-image-1` shutdown) was spun off to its own session on 2026-10-14. The user approved the R-9 slice plan and started **slice 3**.

**Decided by the user 2026-10-14 (slice 3 workplan question): an admin MAY record a provider price for a model Business OS does not use yet** (for example the replacement for `gpt-image-1`). The line carries the `new_model` flag, is labelled "not used yet", stays pending and changes no charge until someone applies it. Provider allow-list and model id format still apply; the "coverage set only" rule (RR-1) is for fetched lines.

**Follow-up note (out of scope, recorded 2026-10-14):** `lib/ai/providers/anthropicProvider.ts` never reads cache-read tokens, so a cached Anthropic read is not costed the way the OpenAI 50% rule costs it. This is a charging-accuracy item for a separate task, not part of this requirement; no Business OS area uses an Anthropic model today. On the comparison view, non-OpenAI cached input shows "not compared" (slice 3 O-8).

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-08 | Created (Draft) | BA draft: as-built AB-1..AB-17 (origin/main a689de3f); MP-FR-1..14, MP-NFR-1..9; research options A vs B (BA recommends B, SA to rule); single-source-of-truth problem statement for SA; provisional slices 1–8 (+9, 10); open business questions Q1–Q9 |
| 2026-10-08 | User decisions recorded | Q0 (price source: B + third-party cross-check) and Q1–Q9 decided by the user; MP-FR-6/7/8/11/12 updated; MP-FR-14 (undo) replaced by margin prompt; MP-FR-15 monthly reminder, MP-FR-16 precision going forward; slices renumbered (no undo slice) |
| 2026-10-08 | SA requirement review | APPROVED WITH CONDITIONS: findings 1–11 (AB-10 unproven, image/guardrail readers, conservative-rate dependency, per-instance cache, Mistral dead, same-day unique collision); rulings R-1..R-8 (DB authoritative + image sibling table, exact numeric, capture-first baseline, frozen proposals via service-role RPC, researcher-side cross-check, blocking flags, guard plan, impact sources); slice plan 1–12 replaces section 7; slice 1 cleared to start |
| 2026-10-09 | Reminder channel decided | User chose email to admins for MP-FR-15 (not the SA default banner); slice 11 now needs a scheduled job + email, SA to rule in its workplan |
| 2026-10-09 | Slice 1 workplan approved; code complete | SA approved the slice 1 workplan with C-1 (T-2 no longer claims every charge comes from the table) and C-2 (the Sync paragraph says it also adds missing listed models); MT-1/MT-2 approved, MT-3 dropped; display option C; Sync audit flushed with `await auditTrail.flush().catch(...)` as in the sibling pricing route. Dev implemented MP-FR-1 page text, exact per-token display with a per-1M line, and the Sync audit flush; uncommitted, awaiting SA code review |
| 2026-10-10 | Slice 2 workplan written | Dev workplan for R-8 row 2: read-only capture (definition, security, row shape, precision proof for AB-10, 90-day alias usage from `token_usage`, price fingerprint), guarded no-op baseline, unconstrained numeric, partial unique index on active rows, nullable cached-input and provenance columns, empty `ai_model_image_pricing`, fingerprint-checked retirement of duplicate rows; no code written, awaiting SA |
| 2026-10-10 | Slice 2 code written | C-1 found a dependent view `public.pilot_cost_savings_summary` on both cost columns: the schema migration drops it, alters the columns and recreates it from the captured definition in one transaction (deviation D-1, SA to rule). Baseline `20261052` and schema migration `20261053` (renumbered, D-2), rollback, checker, retire script with the 12 approved ids and its rollback, comment-only edits, Jest test. View owner, grants, options and comment pending (T-2b). Uncommitted |
| 2026-10-11 | Slice 2 view hardened | User decision: the dependent view `pilot_cost_savings_summary` is recreated with `security_invoker = true`, anon loses all access, SELECT only for authenticated and service_role, owner postgres, no comment; the rollback keeps the hardening. Slice 2 code complete, awaiting SA code review |
| 2026-10-11 | Slice 2 SA code review and QA fixes | SA CR-1 to CR-3 applied (view guard refuses triggers, extra rewrite rules and comments; Infinity excluded in the two new CHECKs; apply-order expectations). QA follow-up recorded under slice 4: the admin pricing list shows retired rows unlabelled |
| 2026-10-12 | Slice 2 merged and applied; slice 3 on hold | PR #304 merged (856455c4 / 7cf7974a). Production apply 2026-10-11 by TL via the Supabase connector with the user's go-ahead: baseline `20261052` (no-op), retire (12 rows, fingerprint `76c7cfe8e89e2464f9fa866668682426` unchanged, 42 active / 12 retired), schema `20261053`, checker VERDICT PASS 83/0; anon refused on `pilot_cost_savings_summary` (401). Open: user smoke check after deploy; admin list still shows retired rows (review UI slice); separate task on anon read of `pilot_step_routing_history`. User put slice 3 on hold pending feedback |
| 2026-10-14 | User feedback recorded; SA re-review | Section 8a: envisioned flow and UF-1..UF-4 (server-side fetch button reverses Q0; green/red coverage colours with % gap per unit; per-model apply with pre-filled reason; per-model price history). MP-FR-2/3/4/6/7/8/12 amended, MP-FR-17 added, section 5 and Q0 marked reversed. SA re-review: fetch approved as a new pattern with conditions RR-1..RR-8 (official markdown sources, deterministic fail-loud adapters, LiteLLM cross-check kept and auto-fetched, bounds, pending-only writes, manual fallback, offline fixtures, no added CI time); R-3 superseded, R-2 amended (per-line state), R-8 replaced by R-9 (slices 3–16). Urgent finding F-A: `gpt-image-1` shuts down 2026-10-23 (BQ-1). Open: BQ-1..BQ-4. Slice 3 not started, awaits the user's go |
| 2026-10-14 | R-9 plan approved; slice 3 started | User agreed with all SA recommendations (BQ-2 impact view after history, BQ-3 no third colour, BQ-4 manual entry for Google and Kimi); BQ-1 spun off to its own session; slice 3 started |
| 2026-10-14 | Slice 3 workplan written | [Slice 3 workplan](/docs/workplans/AI_MODEL_PRICE_REVIEW_SLICE3_WORKPLAN.md): round and line tables (insert-only content, RPC-only state, one pending line per unit), provenance FKs and index on the live tables, submit RPC that never names the live tables, shared Zod schema with RR-1 bounds, manual-entry and comparison admin routes, RR-3 area tags and RR-4 colours computed server-side; zero charge change; open questions O-1 to O-17 for SA. No code written |
| 2026-10-14 | Slice 3 SA-approved with changes; implementation started | SA approved the workplan with C-1 to C-13 (narrowed state-column grant plus a transition trigger, generated price columns, live-table FKs last, no `EmbeddingService` edit, migration `20261066`). User decision: a price may be recorded for a model not used yet (`new_model`). Follow-up note: Anthropic cache-read tokens are not costed (out of scope) |
| 2026-10-14 | Slice 3 code complete, uncommitted | Migration `20261066` (round and line tables, generated exact prices, transition trigger, submit RPC that never names the live tables, provenance FKs placed last), rollback, read-only checker, optional rolled-back probe; `lib/ai/pricing-research/`; `AiPriceProposalRepository`; admin routes `model-pricing/manual-entries` (POST) and `model-pricing/comparison` (GET); audit event `AI_PRICE_MANUAL_ENTRY`. Charging files unchanged. Awaiting SA code review, then QA, the user's view of the diff, and the user's production apply |
| 2026-10-14 | Slice 3 SA code review and QA fixes | CR-1 (source URL must be the exact `https://` form, 400 not 500), CR-2 (two-decimal gaps), CR-3 (guard on settings and admin reads); the `new_model` flag is shown as "not used yet"; slice 8 notes recorded under the R-9 table; branch brought up to origin/main `97f75df4`. Still uncommitted |
| 2026-10-14 | Slice 3 merged and applied | PR #368 merged; migration `20261066` applied to production by TL via the Supabase connector with the user's OK (checker VERDICT PASS 68/0, fingerprint `76c7cfe8e89e2464f9fa866668682426` unchanged, probe PASS 6/6). Slice 4 not started |
| 2026-10-14 | Out-of-band image price addition (gpt-image-1 retirement) | Outside the proposal/approve/apply flow, by user decision: OpenAI shuts `gpt-image-1` down on 23 Oct 2026, and the review flow cannot charge a new image model before then: slice 3 (merged the same day) records and compares pending prices only, and `ai_model_image_pricing` has no reader until slice 7, and the image guardrail refuses a model whose sizes are not priced at low/medium/high. Fix branch `fix/gpt-image-1-retirement` adds 15 `gpt-image-2.5-flare:<size>:<quality>` entries (low, medium, high, xhigh, max) to the in-code `IMAGE_FALLBACK_PRICING`, moves the image default to that model with quality pinned `high`, and keeps the `gpt-image-1` entries until the shutdown has passed (the conservative charge rate is unchanged). Values are calculator ESTIMATES (OpenAI image-generation guide, 'GPT Image 2.5 (Sunburst and Flare)' row, checked 2026-10-14): output cost + $0.001 prompt allowance, rounded up to $0.001. The slice 3 comparison shows the 15 keys as in-code-fallback rows. When the DB-authoritative image table (`ai_model_image_pricing`, R-1) gets its reader (slice 7), these prices move there through the normal flow. Migration `20261067_bos_llm_images_model_gpt_image_2_5_flare.sql` moves the prod `images` area row, applied by hand after the code deploy. Offir emailed for approval. Workplan: `docs/workplans/GPT_IMAGE_1_RETIREMENT_WORKPLAN.md` |
