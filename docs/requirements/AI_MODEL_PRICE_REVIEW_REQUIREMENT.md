# Requirement: AI Model Price Review (proposal, approve, apply)

> **Last Updated**: 2026-10-09

**Created by:** BA
**Date:** 2026-10-08
**Status:** Draft; business questions Q0–Q9 DECIDED by the user 2026-10-08 (section 8). SA requirement review 2026-10-08: APPROVED WITH CONDITIONS (see SA Requirement Review section). Slice 1: workplan SA-approved 2026-10-09 ([workplan](/docs/workplans/AI_MODEL_PRICE_REVIEW_SLICE1_WORKPLAN.md)); code complete, uncommitted, awaiting SA code review

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
9. [Out of scope / future roadmap](#9-out-of-scope--future-roadmap)
10. [Integration points](#10-integration-points)
11. [SA Requirement Review (2026-10-08)](#sa-requirement-review-2026-10-08)
12. [Change History](#change-history)

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
| **MP-FR-2** | **Model coverage list.** The proposal covers every model that BOS uses live (AB-13), every model an admin or user can select, and every model currently in the table or fallback. Each is classified: in use by BOS / selectable / table-only | - [ ] `text-embedding-3-small` and `gpt-image-1` appear; - [ ] a model in use with **no price** anywhere is flagged "unpriced" at the top; - [ ] Mistral appears (AB-12) |
| **MP-FR-3** | **Researched price per model.** For each model: the official price (input, output, and image or embedding unit where relevant), the provider's official pricing page URL, and the date checked | - [ ] No proposed price without a URL on the provider's own domain and a check date; - [ ] third-party aggregators are not accepted as a source; they are used only as the cross-check in MP-FR-6 (Q0) |
| **MP-FR-4** | **Proposal.** A stored proposal listing per model: current price, proposed price, % change, source URL, date checked, and flags | - [ ] Old, new and % are shown per model and per unit; - [ ] a model whose price did not change is listed as "no change" (proof it was checked); - [ ] the proposal is frozen once submitted (its contents cannot change; a correction is a new proposal) |
| **MP-FR-5** | **Ambiguity flags.** Each line may carry flags: cached-input price exists; batch price exists; long-context tier exists; regional pricing; model renamed; model deprecated or retiring (with date); model in use but unpriced; precision loss (the stored value would round the official price) | - [ ] Flags are visible on the review screen; - [ ] a line with a blocking flag (BA suggests "unpriced in use" and "precision loss"; SA to confirm) cannot be applied without an explicit override reason |
| **MP-FR-6** | **Alternatives (decided Q0, Q1).** (a) **Price cross-check, first version:** each researched price is compared with a machine-readable third-party price list; a disagreement (or a model missing from the list) is flagged on the line. The third-party value is never applied. (b) **Alternative models, later slice:** cheaper, newer or better-value models for each BOS AI area with price and estimated effect on cost per typical action | - [ ] (a) Every line shows the cross-check result (agrees / differs by X% / not listed) and the third-party source and date; - [ ] (b) alternatives are advisory only; approving a price never changes which model an area uses; - [ ] each alternative shows its source and date |
| **MP-FR-7** | **Customer impact before apply.** For the selected lines, show the change in our cost per typical AI action (the §4.5 action types) and in credits charged per action, and the effect on the plan cost ceiling headroom | - [ ] Per action type: old cost, new cost, old credits, new credits; - [ ] states whether the §6.1 "model price change" revisit trigger is met; - [ ] shows any area whose cost per action rises above a threshold (SA proposes the value); - [ ] applying a price **never** changes plan packages, allowances, markup or credit value (Q7) |
| **MP-FR-8** | **Review and approve.** Any platform admin (Q2: one approval, no second approver, no size threshold; drops and rises follow the same rules, Q3) approves all lines or a chosen subset, or rejects the proposal, with a mandatory reason | - [ ] Approve and reject both require a reason (at least the existing admin-reason minimum); - [ ] a rejected proposal changes no price; - [ ] an unapproved line is never applied; - [ ] a proposal can be approved at most once |
| **MP-FR-9** | **Apply with full audit.** Approved lines are applied as new effective prices; prior prices are kept as history (never overwritten or hard-deleted) | - [ ] One audit record per applied change: who approved, who submitted, when, model, old to new, source URL, check date, reason, proposal id; - [ ] the audit write is durable (flushed); - [ ] if the apply fails part way, the outcome is all-or-nothing for the approved set, and the admin is told |
| **MP-FR-10** | **Effective timing shown.** After apply, the screen shows when charges will start using the new price (cache window) | - [ ] The admin sees the expected effective time; - [ ] already-recorded charges are never re-priced |
| **MP-FR-11** | **Retire Sync and direct edits (Q9).** The Sync button and route no longer overwrite prices; they are removed or turned into "create proposal". The single-row add / edit / delete is removed as a write path: every price change, even one line, goes through a proposal | - [ ] No path writes a price without an approved proposal; - [ ] no hard delete of a price remains; - [ ] guard tests updated deliberately with SA approval |
| **MP-FR-12** | **Research input.** Researched prices enter the system as a submitted proposal produced by agent / operator research of the official pages (Q0: option B, section 5) | - [ ] Submission is admin-only and validated; - [ ] malformed or unsourced lines are refused with a clear message; - [ ] the system itself fetches no provider pricing page |
| **MP-FR-13** | **One source of truth.** End drift between the price copies (AB-12) per SA's design (section 6) | - [ ] After the change, a price exists in exactly one authoritative place used for charging; other copies are removed, generated from it, or clearly marked non-authoritative; - [ ] a test or check fails if a second authoritative copy reappears |
| **MP-FR-14** | **Margin check prompt (Q7).** When an applied change touches a model BOS uses live, admins are prompted to go and validate plan margins and credit allowances. Nothing changes automatically | - [ ] The prompt names the models and the cost-per-action change; - [ ] it links to the credit-pricing view; - [ ] it can be marked done with a note; - [ ] a fuller workflow is future roadmap (section 9) |
| **MP-FR-15** | **Monthly research reminder (Q4).** Admins are reminded monthly **by email** (user decision 2026-10-09) that a price research round is due, and can start one on demand at any time | - [ ] An email goes to platform admins when more than 30 days have passed since the last applied proposal, at most once per due period; - [ ] it shows the date of the last approved proposal and links to the Model pricing page; - [ ] the reminder never creates or applies prices by itself; - [ ] SA rules on the scheduled job and email path in that slice's workplan (cron auth, `durable-queue-drain` if it drains a table, existing email infrastructure reused) |
| **MP-FR-16** | **Precision fix, going forward only (Q8).** Prices are stored exactly from the first apply after the fix | - [ ] Past charges are not recomputed, quantified or credited back |

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
| **Q0** | **Price source:** (B) agent / operator researches the official pricing pages (URL + date per price), **plus (C) a third-party price list as a cross-check only**; disagreements are flagged. The server does not scrape provider pages |
| **Q1** | **Alternatives:** the price cross-check from the first version (= Q0); **alternative models in a later slice**, advisory only |
| **Q2** | **Any platform admin, one approval.** No second approver, no size threshold |
| **Q3** | **Drops and rises follow the same rules** |
| **Q4** | **Monthly reminder + on demand.** No scheduled job that proposes by itself |
| **Q5** | **No undo.** A correction is a new proposal |
| **Q6** | **Embeddings and images in scope from the first proposal** |
| **Q7** | **A price change never changes packages, allowances or credits.** It must prompt the admin to go and validate package margins and credits. A more advanced workflow is future work |
| **Q8** | **Fix precision going forward only.** No measurement of past charges, no credit-backs. (Which flags block apply: BA suggestion "unpriced in use" and "precision loss" stands for SA to confirm) |
| **Q9** | **Remove the direct single-row edit / delete.** Every change goes through a proposal |

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

**R-3 Research input.**
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

**R-8 Slice plan (replaces section 7).** "Mig" means a migration the user applies by hand on prod.

| # | Slice | Mig | Notes |
|---|---|---|---|
| 1 | Truth fix + sync audit flush | No | R-7 |
| 2 | Capture + baseline + precision + partial unique + new columns + empty image table + retire duplicate/alias rows | Yes | Readers unchanged; zero charge change |
| 3 | Proposal tables + submit RPC + repository + submit/read routes + server-side flags (R-3, R-4) | Yes | Research contract and runbook |
| 4 | Review UI, read-only + upload | No | |
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

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-08 | Created (Draft) | BA draft: as-built AB-1..AB-17 (origin/main a689de3f); MP-FR-1..14, MP-NFR-1..9; research options A vs B (BA recommends B, SA to rule); single-source-of-truth problem statement for SA; provisional slices 1–8 (+9, 10); open business questions Q1–Q9 |
| 2026-10-08 | User decisions recorded | Q0 (price source: B + third-party cross-check) and Q1–Q9 decided by the user; MP-FR-6/7/8/11/12 updated; MP-FR-14 (undo) replaced by margin prompt; MP-FR-15 monthly reminder, MP-FR-16 precision going forward; slices renumbered (no undo slice) |
| 2026-10-08 | SA requirement review | APPROVED WITH CONDITIONS: findings 1–11 (AB-10 unproven, image/guardrail readers, conservative-rate dependency, per-instance cache, Mistral dead, same-day unique collision); rulings R-1..R-8 (DB authoritative + image sibling table, exact numeric, capture-first baseline, frozen proposals via service-role RPC, researcher-side cross-check, blocking flags, guard plan, impact sources); slice plan 1–12 replaces section 7; slice 1 cleared to start |
| 2026-10-09 | Reminder channel decided | User chose email to admins for MP-FR-15 (not the SA default banner); slice 11 now needs a scheduled job + email, SA to rule in its workplan |
| 2026-10-09 | Slice 1 workplan approved; code complete | SA approved the slice 1 workplan with C-1 (T-2 no longer claims every charge comes from the table) and C-2 (the Sync paragraph says it also adds missing listed models); MT-1/MT-2 approved, MT-3 dropped; display option C; Sync audit flushed with `await auditTrail.flush().catch(...)` as in the sibling pricing route. Dev implemented MP-FR-1 page text, exact per-token display with a per-1M line, and the Sync audit flush; uncommitted, awaiting SA code review |
