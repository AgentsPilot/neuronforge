# Workplan: AI Model Price Review, Slice 6 (retire Sync and direct edits, guard rewrite)

> **Last Updated**: 2026-10-16

**Developer:** Dev
**Requirement:** [AI_MODEL_PRICE_REVIEW_REQUIREMENT.md](/docs/requirements/AI_MODEL_PRICE_REVIEW_REQUIREMENT.md): MP-FR-11 (Q9 (c): no direct single-row add / edit / delete), MP-FR-13 (Sync list is one price copy), R-1 copies table, R-5 (guard), R-9 row 6 ("must merge before any apply"; RC-4 note), RR-1/RR-2 (live tables written only by the apply RPC)
**Branch:** `feature/ai-model-price-review-slice6` (worktree `neuronforge-model-pricing-s3`, off origin/main `447d17a2`)
**Date:** 2026-10-16
**Status:** Code Complete, uncommitted; awaiting SA code review + QA. SA approved 2026-10-16 with SC6-1..SC6-9 (binding; folded in below, and where an SC item and the plan differ the SC item wins). User chose BQ-1 (a) on 2026-10-16

## Overview

Slice 6 removes the only two ways a live price changes today: **Sync Latest Pricing** (copies a 42-model list typed into the route over `ai_model_pricing`) and the per-row **Edit** (`PUT`). It also removes the unused `POST` (create) and `DELETE` (hard delete) handlers. After it, nothing in the app writes `ai_model_pricing` or `ai_model_image_pricing`; slice 8's apply RPC becomes the one writer. **Until slice 8 ships there is no in-app way to change a live price** (section 8, BQ-1). No migration. No charge changes: the readers (`lib/ai/pricing.ts`, comparison) are untouched.

## Table of Contents

1. [Analysis](#1-analysis) · 2. [Decisions](#2-decisions-recommended) · 3. [Guard pin table](#3-guard-pin-table-sourceguardtestts) · 4. [Tests](#4-tests-and-ci) · 5. [Files](#5-files) · 6. [Docs](#6-docs) · 7. [Risks](#7-risks) · 8. [Business questions](#8-business-questions) · 9. [Open questions for SA](#9-open-questions-for-sa) · 10. [Task list](#10-task-list)

---

## 1. Analysis

**What exists (verified on disk, this worktree).**

| Item | Where | Today |
|---|---|---|
| Sync handler + button | `app/admin/system-config/page.tsx:373-406`, `:513-529` | Pinned byte for byte by S-9 / S-10 |
| Edit / Save / Cancel | `page.tsx:305-371`, `:672-745`, `:749-791` | `PUT /api/admin/system-config/pricing` with per-token numbers; RC-4: still accepts a retired id |
| Add model / Delete UI | none | No page calls `POST` or `DELETE` (grep below) |
| Sync route | `app/api/admin/system-config/pricing/sync/route.ts` (469 lines) | The 42-model list is **inline** in the handler, not exported; one consumer of `syncMany` |
| Single-row routes | `app/api/admin/system-config/pricing/route.ts` | `GET` (used by the page for row id, dates, retired rows), `PUT`, `POST`, `DELETE` (hard) |
| Repository writes | `lib/repositories/AiModelPricingRepository.ts` | `create`, `updateCosts`, `deleteById`, `syncMany`; read `findById` used only by `PUT`/`DELETE` |
| Audit helpers | `lib/audit/admin-helpers.ts:188-320` | `logAIPricingCreated/Updated/Deleted/ZeroCost/Synced`, called only by the two routes |
| Copy | `priceReviewCopy.ts:10` `PRICE_REVIEW_NOTE`, `EDIT_UNIT_WORDS`; help drawer `page.tsx:148-173` | Say "Sync and Edit still change live prices directly" |

**Caller grep** (`app lib components scripts tests`, `.ts/.tsx/.js/.mjs`, excluding `node_modules`, `.claude`, `.next`, `tsconfig.tsbuildinfo`):

| Removed | Production callers | Test / guard references |
|---|---|---|
| `POST …/pricing/sync` | `page.tsx:379` only | `sync/__tests__/route.test.ts`; `pages.render` R-5, R-10; `pages.edge.qa` E-3; `source.guard` S-5..S-10, W2-4 |
| `PUT …/pricing` | `page.tsx:323` only | `pricing/__tests__/route.test.ts`; `pages.render` R-9, R-13; `pages.edge.qa` E-1, E-2; `priceTable` T-11b, T-15 |
| `POST`, `DELETE …/pricing` | **none** (no page, script or admin page calls them) | `pricing/__tests__/route.test.ts` |
| `syncMany` | sync route only | repo test; negative regexes in `chargingUntouched.guard`, `fetchSources.source` (kept, still valid) |
| `updateCosts`, `deleteById`, `create`, `findById` | pricing route only | repo test; same negative regexes |
| Types `CreateAiModelPricingInput`, `AiModelPricingSyncEntry`, `AiModelPricingSyncResult` | repository; barrel `lib/repositories/index.ts:376-378` | none |
| `logAIPricing*` (5) | the two routes only | the two route tests |

Other writers of the live tables: **none in app code.** Code-level literals of `'ai_model_pricing'` (comments stripped): the repository `TABLE`, `app/api/admin/agent-generation-config/route.ts:52` (read, `.is('retired_date', null)`), `scripts/analyze-pricing-discrepancies.ts:34` and `scripts/calculate-gpt4o-cost.ts:11` (reads). `'ai_model_image_pricing'` has no code literal. Grants (from migrations `20261052`, `20261053`): `authenticated` has SELECT only on both tables, so the inert `ai_model_pricing_admin_write` RLS policy grants no write; `service_role` keeps full DML on `ai_model_pricing` (O-5).

**Flagged, not fixed (deprecated pattern):** `agent-generation-config/route.ts` reads the table with a direct Supabase client and uses `console.error` (CLAUDE.md rules 1, 3). Outside this slice; recorded for TL.

**Skills:** `new-repository` (removing methods, header kept accurate), `tenant-isolation-guard` (N/A: writes removed, none added), `business-os-schema-check` (grants read from the migration files above; no new column claim). No entitlements import, no AI call.

---

## 2. Decisions (recommended)

**D-1 Sync route: delete the file, not a 410 stub.** Deleting `pricing/sync/route.ts` (and its test) gives 404. A 410 stub would be a permanent handler that must still call `requireAdmin` first (authz guard R1), log, and be tested, for no caller. A stale open tab clicking Sync gets the page's own "Failed to sync pricing" and writes nothing. The 42-model list goes with the file (MP-FR-13, R-1 "Sync list: deleted"); it has no other importer.

**D-2 `PUT`, `POST`, `DELETE`: remove the exports; keep `GET`.** Next.js App Router answers **405** for a method a route file does not export, so "refuse" comes free with no code. `GET` stays unchanged (slice 4 reads row id, dates and retired rows). Route header rewritten: read-only.

**D-3 Repository: remove `create`, `updateCosts`, `deleteById`, `syncMany` and `findById`** (the last is a read whose only callers were `PUT`/`DELETE`; O-2). Remove the three types and barrel exports. The repository becomes read-only: `listAll`, `listActive`, `listActiveExact`. Header's class-1 caller list updated.

**D-4 Audit: keep all five events registered; delete the five helpers.** `AI_PRICING_CREATED/_UPDATED/_DELETED/_SYNCED/_ZERO_SET` stay in `AUDIT_EVENTS`, their metadata and `AUDIT_EVENT_AUDIENCE`, so existing `audit_trail` rows keep their label and severity (an unregistered action shows as "Unknown event", the PAYMENT_PLAN_CANCELLED precedent) and MP-FR-17's history can show "recorded Sync" rows. Pinned counts 205 / 58 / 63 / 84 do not move. Comments mark them "historic: no longer emitted since slice 6"; the false "Synced from external source" comment is corrected. The helpers have no caller and are deleted (dead code). `AI_PRICING_ZERO_SET` is not needed by slice 8: R-4 refuses a zero price at submission.

**D-5 Page.** Remove Sync handler and button, Edit / Save / Cancel and the inline editor, `saving`, `success` (only Sync and Save set it) and its banner, `rereadComparison`, editor state, and the unused icons (`Edit`, `X`, `Download`, `CheckCircle`). `markPricingReadFailed` no longer closes an editor. The Actions column keeps "Enter provider price". Header comment rewritten. `EDIT_UNIT_WORDS` deleted from `priceReviewCopy.ts`.

**D-6 New copy (proposed, byte-pinned once SA agrees).**
- Section helper (S-1 replacement): `Cost per token for each AI model, as charged today. Live prices cannot be changed on this page until Apply arrives.`
- `PRICE_REVIEW_NOTE`, last sentence becomes: `Until then, no live price can be changed on this page.`
- Help drawer, "The buttons": drop the Sync and Edit paragraphs. New paragraph (S-4 replacement; **SC6-1**: it must not contain the old button label, because S-2 asserts it is gone): `The Sync button and the per-row Edit have been removed. Every price change will go through a pending price and Apply. Until Apply arrives, a live price can only be changed in the database by an operator, with the platform owner&apos;s approval.` (`&apos;` in JSX for eslint; the pin reads the source)
- Cache sentence (MT-2 kept verbatim, still true for a database change and for Apply): `Each server keeps its own copy of these prices for up to 1 hour, so a change is in effect on all servers within 1 hour. Changes don't alter provider billing.`
- Units: drop "and the Edit field still takes the per-token value".

**D-7 Layout registry: leave it to L-11.** The Sync `.json()` pin disappears here, but joining still needs `AdminPageHeader` (drop the G-8 `<h1>`), the page's own GET `.json(` moved to `readJsonBody`, and the early-return spinner (F-81). That is UI work; mixing it into a money-path removal makes the diff harder to review. This slice records in the requirement that the Sync-pin blocker for L-11 is gone (ADMIN_LAYOUT_STANDARD §7.14 dependency).

**Migration: none.** No table, grant, policy or function changes. Confirmed: the removals are app code only; the stale table comment and `service_role` DML grants are an O-5 question for slice 8's migration.

---

## 3. Guard pin table (`source.guard.test.ts`)

R-5 said "slice 8" under R-8; R-9 moved it to slice 6. Header gains "SA <date> slice 6 R-5". There is no S-8 case in the file (it was the T-9 sync-route diff check); it is superseded by RG-2.

| Pin | Today | Slice 6 |
|---|---|---|
| G-1, G-2 | no AgentsPilot route / billing state on P | **Keep** |
| W2-4 (P) | pricing route ×2, sync ×1, 4 handler bindings | **Replace**: pricing route named ×1; `/pricing/sync` ×0; `handleSyncPricing`, `handleSavePricing`, `handleEditPricing`, `handleCancelEditPricing` ×0 |
| G-3, G-7 | no `console.`; client logger | **Keep** |
| G-8 | `<h1>Model pricing</h1>` | **Keep** (D-7) |
| S-1 | old helper text | **Replace** with D-6 helper, byte-exact |
| S-2, S-3 | contains "Sync Latest Pricing", "Syncing..." | **Invert**: neither present |
| S-4 | Sync info paragraph | **Replace** with D-6 removed-paragraph, byte-exact |
| S-5..S-7 | sync comment, fetch, error strings, `setTimeout 5000` | **Invert** the sync-specific ones (`/pricing/sync`, `'Failed to sync pricing'`, `'Pricing synced successfully!'`, the false comment); drop `await fetchData(true);` (still legitimately used) |
| S-9, S-10 | whole handler / button verbatim | **Delete** fixtures; covered by NW-1 |
| MT-1 | no false claims | **Keep**, add `'Edit pricing'` and `'change live prices directly'` |
| MT-2 | "in effect on all servers within 1 hour" | **Keep** unchanged |
| G-4, G-6, W2-4 (B) | AgentsPilot billing page | **Keep** |
| **NW-1 (new)** | — | P code has no `method: 'PUT'`, `'POST'`, `'DELETE'` or `'PATCH'`, and every `fetch(` in P is the pricing GET (other routes go through the slice 4/5 read modules) |

**New guard `lib/ai/pricing-research/__tests__/livePriceWrites.guard.test.ts` (MP-FR-11 "no path writes a price"):**
- **LW-1** Scan `app/`, `lib/`, `components/`, `scripts/` (code, comments stripped with `tests/helpers/source-scan.ts`, tests excluded). A file whose code names `'ai_model_pricing'` or `'ai_model_image_pricing'` must be on an allow-list (repository, `agent-generation-config/route.ts`, the two scripts), and none may follow `.from(<that name>)` with `.insert(`, `.update(`, `.upsert(` or `.delete(` in the same chain.
- **LW-2** `AiModelPricingRepository.ts` code contains no `.insert(`, `.update(`, `.upsert(`, `.delete(`; its public methods are exactly `listAll`, `listActive`, `listActiveExact`.
- **LW-3** No apply-style RPC exists yet: every string constant or literal starting `ai_price_` that reaches `.rpc(` in `lib/repositories/` is on an allow-list holding only `ai_price_submit_pending` (`AiPriceProposalRepository.ts:49`, pending lines only, RR-1). Slice 8 adds its apply and dismiss RPCs to this list, deliberately.
- **LW-4** Negative controls: a fixture string with each write verb, and a renamed variable, are caught.
Prefilter on `includes('ai_model_')` before regex; target under 1 s inside the existing Jest job (O-3).

**SA conditions on this guard (binding):** **SC6-2** LW-1 matches the name as a whole quoted literal; scans `.ts .tsx .js .jsx .mjs .cjs`, skipping `__tests__`, `*.test.*`, `__fixtures__`; outside the repository the name must appear inline in `.from('…')` (a `const` alias fails); a chain runs from `.from(` to the next `;` or `.from(`, across lines. **SC6-3** LW-3 is per file in `lib/repositories/`: the set of `ai_price_*`/`ai_model_*` literals equals a fixed set (tables and functions listed separately; functions = `ai_price_submit_pending` only). **SC6-4** new **LW-5**: no `CREATE [OR REPLACE] FUNCTION` body in `supabase/migrations/*.sql` writes either live table (allow-list empty); top-level DML on them only in `20260213_add_claude_46_pricing.sql`, `20261052`, `20261053`. LW-4 carries the negative controls.

---

## 4. Tests and CI

| Suite | Change |
|---|---|
| `pricing/sync/__tests__/route.test.ts` | **Deleted** with the route |
| `pricing/__tests__/route.test.ts` | Keep GET gate (401 / 403 / check throws), GET happy, GET 500. Delete PUT/POST/DELETE validation, happy, zero-price and flush suites. **RG-1** the module's HTTP exports are exactly `['GET']`. **RG-2** `pricing/sync/` does not exist. **RG-3** source has no `logAIPricing`, no `auditTrail`, no repository method but `listAll` |
| `AiModelPricingRepository.test.ts` | Delete `create`, `updateCosts`, `deleteById`, `syncMany`, `findById` cases; "never throws" covers the three reads |
| `pages.render` | Delete R-5, R-9, R-13. R-10 re-homed: the `ProviderPriceCheck` stand-in gets a test-id button calling `onFinished`; a failed silent re-read clears the table (O-5 intent kept). R-12: "Retired <date>", no Edit anywhere. **R-14 (new)**: no Sync button, no `Edit pricing` title, and only GETs are sent |
| `pages.edge.qa` | All three cases test removed behaviour (E-1/E-2 save, E-3 editor + Sync). **File deleted** (O-4) |
| `priceTable.render` | T-11: row kinds kept, Edit assertions become "none on any row". T-11b deleted. T-15 re-homed to the silent re-read after the stand-in's `onFinished` |
| `pageLayout.render` | L-10: the "when Apply arrives" sentence becomes the D-6 removed-paragraph |
| `priceReview.source` | Unchanged (no new browser file) |
| `source.guard` | Section 3 |
| new `livePriceWrites.guard` | Section 3 |

**Speed:** `fireEvent` and test ids only, `ProviderPriceCheck` stays mocked. Eight slow page cases are deleted and two re-homed, so the page suites get faster. **No added CI time**, no new job. QA records three parallel `app/admin/system-config` runs as at the layout slice (3.5 s case ceiling).

**Run before handover:** `npx jest app/admin/system-config app/api/admin/system-config lib/repositories/__tests__/AiModelPricingRepository lib/ai/pricing-research lib/admin/__tests__/admin-authz-surface.guard lib/audit app/admin/components/layout`, `npx tsc --noEmit -p .` filtered to touched files, `npm run lint` on touched files.

---

## 5. Files

| File | Action |
|---|---|
| `app/admin/system-config/page.tsx` | modify (D-5, D-6) |
| `app/admin/system-config/priceReviewCopy.ts` | modify: `PRICE_REVIEW_NOTE`, delete `EDIT_UNIT_WORDS` |
| `app/api/admin/system-config/pricing/route.ts` | modify: GET only |
| `app/api/admin/system-config/pricing/sync/route.ts` + `__tests__/route.test.ts` | **delete** |
| `lib/repositories/AiModelPricingRepository.ts`, `types.ts`, `index.ts` | modify (D-3) |
| `lib/audit/admin-helpers.ts`, `lib/audit/events.ts` | modify (D-4; comments only in `events.ts`) |
| tests in section 4; `app/admin/system-config/__tests__/pages.edge.qa.test.tsx` | modify / delete |
| `lib/ai/pricing-research/__tests__/livePriceWrites.guard.test.ts` | create |
| docs in section 6 | modify; runbook create only if BQ-1 (a) |

---

## 6. Docs

- **Requirement:** status line, R-9 row 6 note, Change History; note that L-11's Sync-pin blocker is gone.
- **`ADMIN_IDENTIFICATION_AND_ACCESS.md`:** strike rows 57, 59, 60, 61 (kept for references, the rows 47–49 precedent); row 58 `GET` stays. Census re-derived from disk with the guard's own `scanHandlers`. A plain grep today reads 107 handlers / 76 route files, one more than the slice 5 figure (106 / 75), so one handler landed on main without a row; Dev finds and registers it. Expected after: 4 handlers and 1 file fewer.
- **`ADMIN_BOS_CLEANUP_REQUIREMENT.md` §11:** the Sync row gets a dated "Removed in AI model price review slice 6" note.
- **`BUSINESS_OS_LLM_MODEL_SETTINGS_RUNBOOK.md:101`** ("Price it first"): point at the emergency entry (BQ-1).
- **New `docs/runbooks/AI_MODEL_PRICE_EMERGENCY_SQL_RUNBOOK.md`** (BQ-1 (a), decided): **superseded by SC6-5**, the runbook is three pastes (read-only pre-check with the slice 2 fingerprint; one `DO $emergency_price$` block retiring by id with `GET DIAGNOSTICS` checks; read-only post-check), never deletes, and warns against `supabase/SQL Scripts/20251030_add_missing_models_pricing.sql`. The draft below is kept for the record only. No SQL is run by Dev.
- **SC6-9 / SA suggestion:** dated removal notes in `docs/SYSTEM_CONFIG_IMPLEMENTATION.md` and `docs/AUDIT_COVERAGE_ANALYSIS.md`.

```sql
-- Read-only before: the one active row, written down in the runbook log.
SELECT id, input_cost_per_token, output_cost_per_token, effective_date
FROM public.ai_model_pricing
WHERE provider = 'openai' AND model_name = 'MODEL' AND retired_date IS NULL;
BEGIN;
UPDATE public.ai_model_pricing SET retired_date = (now() at time zone 'utc')::date
WHERE provider = 'openai' AND model_name = 'MODEL' AND retired_date IS NULL;
INSERT INTO public.ai_model_pricing (provider, model_name, input_cost_per_token, output_cost_per_token, effective_date)
VALUES ('openai', 'MODEL', 0.15 / 1000000, 0.60 / 1000000, (now() at time zone 'utc')::date);
-- Must return exactly one row before COMMIT; otherwise ROLLBACK.
SELECT count(*) FROM public.ai_model_pricing
WHERE provider = 'openai' AND model_name = 'MODEL' AND retired_date IS NULL;
COMMIT;
```

The old row is retired, never deleted (Q9). Prices go in per 1M as exact decimals divided in SQL (R-1). No string literal holds the word the SQL editor trips on (MP-NFR-5). Effect within 1 hour (cache). It writes no audit row, so the runbook log is the record; any pending line for that model becomes stale, and slice 8 will refuse to apply it until it is re-entered (by design).

---

## 7. Risks

| # | Risk | Mitigation |
|---|---|---|
| K-1 | **No in-app price change between this slice and slice 8** | BQ-1; runbook; slice 8 next in line after 7 |
| K-2 | A switch of a Business OS area to a new model needs a price first (runbook line 101) | Same SQL path, or wait for slice 8. Image prices are unaffected: they still change by PR in `IMAGE_FALLBACK_PRICING` until slice 7 |
| K-3 | A stale open tab clicks Sync or Save after deploy | 404 / 405, page shows its error, nothing written |
| K-4 | A hidden caller of a removed method | Grep in section 1 is empty; `tsc` fails on any import; LW-1..LW-3 stop a new one |
| K-5 | Revert of this PR brings Sync back, which would overwrite reviewed prices once slice 8 exists | Revert only before slice 8 ships; noted in the PR body |
| K-6 | Old `audit_trail` rows lose labels | Events stay registered (D-4) |
| K-7 | Guard scan cost | Prefilter, one pass, measured by QA (O-3) |

---

## 8. Business questions

**BQ-1. Emergency price fix before Apply exists.** After this slice, until slice 8 ships, nobody can change a live price from the admin screen. If a provider raises a price and we start undercharging (a red row), or a Business OS area must move to a model that has no price, the only way is a SQL change in the Supabase editor.
- **(a) Recommended:** ship slice 6 now; an emergency change is done only from a documented runbook entry (retire the old row, add the new one, nothing deleted), and only after you approve that change in the session. Prices rarely change (every live row dates from 2026-06-29), and Sync is the bigger risk today: one click overwrites 42 models with an unsourced June list.
- (b) Hold slice 6 and merge it together with slice 8, so there is no gap. Sync and Edit stay live meanwhile.
- (c) Remove Sync now but keep Edit until slice 8. Narrows the gap, but reverses your Q9 decision for a while.

**Decided by the user 2026-10-16: (a).** Ship slice 6 now; emergency price changes go through the SQL runbook, applied only with the user's approval.

**BQ-2.** None other. Audit history is kept either way (D-4).

---

## 9. Open questions for SA

| # | Question | Dev proposal |
|---|---|---|
| O-1 | Delete vs 410 for Sync and the three verbs (D-1, D-2) | Delete; rely on 404 / 405 |
| O-2 | Remove `findById` too (read, no caller left) | Yes |
| O-3 | Scope and cost of LW-1 (about 4,500 files across the four roots) | Accept the four roots with the prefilter if QA measures under 1 s; else narrow to `app/api`, `app/admin`, `lib`, `scripts` |
| O-4 | Delete `pages.edge.qa.test.tsx` rather than keep an empty shell | Delete |
| O-5 | Slice 8's migration: drop the inert `ai_model_pricing_admin_write` policy, revoke `DELETE`/`TRUNCATE` on `ai_model_pricing` from `service_role` (the image table already has `INSERT, UPDATE (retired_date)` only), and correct the table comment that names `/api/admin/system-config/pricing` as the writer (pinned in the slice 2 migration test as captured state) | Record as a slice 8 note now; no migration here |
| O-6 | D-4: keep events, delete helpers | Approve |
| O-7 | D-6 wording and which sentences become byte pins | Approve or amend |
| O-8 | D-7: layout registry stays with L-11 | Approve |
| O-9 | R-10 and T-15 re-homed through the `ProviderPriceCheck` stand-in's `onFinished` | Approve |

---

## 10. Task list

- [x] T-0 SA workplan review (SC6-1..SC6-9); user answered BQ-1 (a)
- [x] T-1 Page and copy (D-5, D-6)
- [x] T-2 `pricing/route.ts` to GET only; delete the sync route and its test
- [x] T-3 Repository, types, barrel (D-3)
- [x] T-4 Audit helpers removed, event comments (D-4)
- [x] T-5 `source.guard` rewrite (section 3) and `livePriceWrites.guard`
- [x] T-6 Page and route tests (section 4)
- [x] T-7 Run the suites, `tsc`, lint; record timings
- [x] T-8 Docs (section 6); runbook if BQ-1 (a)
- [x] T-9 `git diff --stat` check (no blanked file); hand to SA

### 10.1 Implementation notes and deviations (2026-10-16)

- **SC6-1..SC6-9 done.** S-4 paragraph without the old label; LW-1/LW-3/LW-5 as specified, with negative controls (LW-4) and two non-vacuity checks; runbook as three pastes in `docs/runbooks/AI_MODEL_PRICE_EMERGENCY_SQL_RUNBOOK.md`; L-10, MT-1 (page + `priceReviewCopy.ts`) and R-14 edits; register row 110 (`plan-test-clock#POST`), rows 57/59/60/61 struck, census 103 = 97 + 6 + 0 in 75 files, truth-table and summary totals fixed; slice 8 note in the requirement; stale comments fixed; the pricing route imports no `z`.
- **DV-1 LW-1 roots: `components/` dropped (SA O-3 allowance).** Measured on this dev machine (another dev server running): walk + prefilter over app, lib, components, scripts 1.3–1.6 s; over app, lib, scripts 1.15–1.25 s. Still above 1 s locally; the walk itself is about 0.3 s and the rest is reading about 32 MB. QA to measure in CI. The prefilter runs on raw bytes, so only 22 files are decoded.
- **DV-2 `app/api/admin/system-config/__tests__/dataAccess.test.ts`:** its floor of 3 route files dropped to 2 (the Sync route is gone), with a comment. Not in the plan.
- **DV-3 T-14:** SA noted `PRICE_REVIEW_NOTE` "is pinned where it already is (T-14 imports it)". T-14 only checked the first sentence, so it now also pins the new last sentence.
- **DV-4 `AI_PRICING_SYNCED` description** (the label shown on historic audit rows) changed from "synced from external source" (false) to "synced from the built-in list". Severity and audience unchanged; counts unchanged.
- **DV-5 Runbook** also covers a first price for a model with no row (`v_old_id` NULL, zero active rows required). The help drawer does **not** link the runbook: SA did not allow it; the requirement and the LLM settings runbook link it.
- **DV-6 Page test stand-ins:** the mocked `ProviderPriceCheck` in `pages.render` and `priceTable.render` became a test-id button that calls `onFinished` (O-9). T-15 asserts both lists are read twice.
- **DV-7 Regexes:** to keep the coordinator's "no backslash before a hex digit" rule, word edges are lookarounds, and a SQL function body's end is found by searching for its dollar-quote tag with `indexOf` (no back-reference and no named group; `tsc`'s ES target rejects named groups). Corrected per SA CR-6.
- `chargingUntouched.guard` unedited and green; no charging file changed. `typecheck:bos-llm` reports one baseline entry fixed (`app/api/onboarding/build/route.ts`), which is not a file this slice touches.

## SA Review Notes

**Reviewed by SA — 2026-10-16** (against this worktree, origin/main `447d17a2`)
**Status:** ✅ Approved with conditions. SC6-1..SC6-9 are folded into the code; no second workplan review is needed unless BQ-1 comes back (c).

**BQ-1 is not ruled here.** This approval assumes (a). If the user picks (b), the plan stands but the merge waits for slice 8, and the D-6 copy is re-worded at that point because Apply will exist. If the user picks (c), this is a different slice (Edit, PUT, the W2-4 Edit pins and the repository's `updateCosts`/`findById` stay) and comes back for review.

### Verification done
- **Caller greps are complete for code.** Running `git grep` outside `docs/` confirms the only production callers of the sync route and of `PUT` are `page.tsx:379` and `:323`. Nothing calls `POST` or `DELETE`, and nothing else calls `syncMany`, `create`, `updateCosts`, `deleteById`, `findById`, the three types or the five `logAIPricing*` helpers. That covers other admin pages, `components/`, `scripts/`, seeds, `supabase/functions` and `agent-generation-config`. `isInputOnlyPricedModel` keeps four other callers. `refreshPricingCache` was never called by these routes. **One miss in the literal inventory:** `app/admin/system-flow/page.tsx:613` holds `'lib/ai/pricing.ts (cached from ai_model_pricing table)'` in code, not in a comment (SC6-2). `agent-generation-config/route.ts` only reads the live table. Its `.upsert(` is on `system_settings_config`, which is why LW-1 has to check the chain and not ban the verb file-wide.
- **Authz 107 vs 106.** On disk: 107 handlers in 76 files. Every live register row matches a handler except **`business-os/test/plan-test-clock#POST`**. It has no row. It is gated (`requireAdmin`, `route.ts:85`) and landed in `be3eab13` (P-6a.1). The guard pins no handler count (floor of 40). No allow-list entry names either pricing file, so deleting the sync file keeps "every allow-listed file still exists" green (SC6-7).
- **Audit.** No test or guard needs a registered event to have an emitter. The only importers of the five helpers are the two routes and their tests. D-4 is safe, and the 205 pin in `eventAudience.test.ts` does not move.
- **No catch-all route.** Nothing like `[...]` sits under `app/api/admin/system-config/`, so a request to the deleted sync path gets a plain 404.

### Rulings on O-1..O-9
1. **O-1: delete. ✅ Approved.** `scanHandlers` counts every exported verb, and R1 needs `requireAdmin` in each one. A 410 stub would therefore be a gated handler that lives forever, with a route test and a register row, and it has no caller. Deleting is cleaner. A stale tab is safe: both handlers check `response.ok` before `.json()`. A 404 (an HTML body) or a 405 produces "Failed to sync pricing" or "Failed to update pricing", writes nothing and never reaches the JSON parse. RG-1 and RG-2 pin the result.
2. **O-2: ✅ Approved.** Remove `findById`.
3. **O-3: ✅ Approved, conditional on SC6-2, SC6-3 and SC6-4.** The four roots are about 3,100 non-test code files (measured: app 772, lib 1,329, components 588, scripts 437). Use one walk, read each file once, prefilter, and keep the test inside the existing Jest job, so there is no new job and no added critical-path time. QA records the time. If it goes over 1 s, Dev may drop `components/`, but never `lib/`, `app/` or `scripts/`. The LW-3 allow-list is built so that slice 8 adds its apply and dismiss functions by a one-line, reviewed edit.
4. **O-4: ✅ Approved.** All three cases (E-1, E-2, E-3) test behaviour that is being removed.
5. **O-5: ✅ Approved as a slice 8 note, with the content in SC6-8.**
6. **O-6: ✅ Approved.**
7. **O-7: 🔄 Amended (SC6-1).** Byte pins in `source.guard`: the S-1 helper and the S-4 replacement paragraph. MT-2 stays verbatim. `PRICE_REVIEW_NOTE` is pinned where it already is (T-14 imports it), and MT-1 gains a check on its old wording (SC6-6).
8. **O-8: ✅ Approved.**
9. **O-9: ✅ Approved.** `onFinished` → `fetchData(true)` → `markPricingReadFailed` is the surviving silent re-read, so R-10 keeps its intent there. In T-15, assert that both reads ran twice (the silent path re-reads both lists, not only the comparison).

### Guard pin table (section 3): every pin checked
The rewrite of the frozen guard is approved, with SC6-1 and SC6-6. Keep: G-1, G-2, G-3, G-7, G-8, MT-2, and B's G-4, G-6 and W2-4. W2-4 (P) replaced: the pricing literal ×1 is correct, since only the GET stays. S-1 and S-4 replaced byte for byte. S-2, S-3 and S-5..S-7 inverted, and dropping `await fetchData(true);` is right, because two callers still use it. S-9 and S-10 deleted: the inverted labels, the zero handler names and NW-1 cover more than the fixtures did. There is no S-8 case, as noted. In the header, replace the "frozen byte for byte" bullet with "SA 2026-10-16 slice 6 R-5 (moved from slice 8 by R-9 row 6)". Rename the describe that says "Sync is unchanged".

### Required changes
- **SC6-1 (High): D-6 contradicts S-2.** The new S-4 paragraph contains `Sync Latest Pricing`, and S-2 asserts that P no longer contains it, so the test cannot pass as planned. Reword the paragraph without the old label, for example: `The Sync button and the per-row Edit have been removed. Every price change will go through a pending price and Apply. Until Apply arrives, a live price can only be changed in the database by an operator, with the platform owner's approval.` Keep S-2 and S-3 over the whole of P, comments included.
- **SC6-2 (High): pin down the LW-1 matcher.** (a) Match the table name as a **whole quoted literal**, `['"\x60]ai_model_(image_)?pricing['"\x60]`, so the system-flow description string does not count. Otherwise allow-list system-flow by name and give the reason. (b) Scan `.ts .tsx .js .jsx .mjs .cjs` and skip `__tests__`, `*.test.*` and `__fixtures__`. (c) In an allow-listed file other than the repository, the name is used inline in `.from('…')`. Binding it to a `const` is a failure, so the chain check cannot be dodged by an alias. (The repository's `TABLE` constant is covered by LW-2.) (d) A chain runs from `.from(` to the next `;` or the next `.from(`, across lines. `agent-generation-config` is multi-line.
- **SC6-3 (Medium): make LW-3 deterministic, with no dataflow.** For each file under `lib/repositories/`, the set of string literals matching `^(ai_price_|ai_model_)` must equal an exact expected set. Keep two lists: tables (`ai_model_pricing` in the pricing repository; `ai_price_proposals` and `ai_price_proposal_lines` in the proposal repository) and functions (`ai_price_submit_pending` only). Any other `.rpc(` argument in that folder starting with either prefix fails. Slice 8 adds its functions and `ai_price_apply_batches` to these lists, deliberately.
- **SC6-4 (Medium): LW-5, the SQL side of "one writer".** A future apply RPC writes from SQL, which LW-1 cannot see. Scan `supabase/migrations/*.sql`, about 250 files, prefiltered on `ai_model_`. No `CREATE [OR REPLACE] FUNCTION` body may name either live table with `INSERT`, `UPDATE`, `DELETE` or `TRUNCATE`; today the allow-list is empty and slice 8 adds its apply function. Top-level DML on the live tables is allowed only in today's historic files: `20260213_add_claude_46_pricing.sql`, `20261052`, `20261053`. Put the negative controls in LW-4.
- **SC6-5 (High): rewrite the runbook SQL in §6** before it goes into the runbook. As drafted, the Supabase editor runs the whole paste at once, including `COMMIT`, so "must return one row, otherwise ROLLBACK" is not something an operator can act on. Split it into three pastes:
  1. **Read-only pre-check.** Return the active row's `id`, its prices `::text`, `cached_input_cost_per_token`, `effective_date`, and the count of active rows for the model, including any dated later than today. Return the slice 2 price fingerprint as well: the `20261010` retire-script formula (`md5`, `round(…,18)::text`, newest per model with `effective_date <= today`).
  2. **The write, as one `DO $emergency_price$` block in `BEGIN … COMMIT`.** Retire **by the id from step 1**: `UPDATE … SET retired_date = (now() at time zone 'utc')::date WHERE id = '<id>' AND retired_date IS NULL`, then `GET DIAGNOSTICS` and `RAISE EXCEPTION` unless the row count is 1. Refuse if any other active row for the model exists, a later-dated one included. Insert with placeholders for provider, model, and both per-1M prices divided by `1000000`. Set `cached_input_cost_per_token`, `proposal_id` and `proposal_line_id` explicitly to NULL; NULL/NULL satisfies `ai_model_pricing_provenance_paired`. Refuse a price at or below 0, except an output of 0 on an input-only model. Then re-count and require exactly one active row, or raise. The partial unique index `(provider, model_name, effective_date) WHERE retired_date IS NULL` cannot collide, because the old row is retired first, even on a second change the same day.
  3. **Read-only post-check.** Show the stored values `::text`, the old row now retired, and the fingerprint again; only this model's entry should differ. Log both fingerprints in the runbook log.

  No string literal or `RAISE` message may contain the word the SQL editor trips on, and keep it out of comments too. Never `DELETE`. Add a warning: the old `supabase/SQL Scripts/20251030_add_missing_models_pricing.sql` uses `ON CONFLICT (provider, model_name, effective_date) DO UPDATE`, which overwrites in place and targets a constraint slice 2 dropped. Never use it, or any script like it.
- **SC6-6 (Medium): test edits the plan missed.** (a) L-10 also asserts `Copies a built-in price list, kept in the code`; replace that assertion as well. (b) MT-1 scans only `page.tsx`, but the old wording lives in `priceReviewCopy.ts`, so extend MT-1 to that file for `change live prices directly` and `Sync and Edit`. (c) R-14 also checks that the old helper sentence is gone.
- **SC6-7 (Medium): authz register.** Add a row for `business-os/test/plan-test-clock#POST` (gated, P-6a.1). Strike rows 57, 59, 60 and 61. Afterwards, re-derive the census with `scanHandlers`. Expected: **103 handlers in 75 files, 97 `requireAdmin` + 6 inline + 0 open**. In the same edit, fix the stale totals at doc lines 182 ("104") and 209 ("107 rows, 104 live").
- **SC6-8 (Medium): what the slice 8 note says.** Slice 8's migration adds a **new** `COMMENT ON TABLE public.ai_model_pricing`. It never edits `20261052`, and `CAPTURED_TABLE_COMMENT` in the slice 2 migration test stays as captured state. The new comment fixes both false claims: the writer route, and "read + write for authenticated sessions" (authenticated has SELECT only). Narrow `service_role` on `ai_model_pricing` to `SELECT, INSERT, UPDATE (retired_date)`, matching the image table. Drop the inert `ai_model_pricing_admin_write` policy. Slice 8's own migration test pins the new grants. Slice 8 also extends the LW-3 and LW-5 allow-lists.
- **SC6-9 (Low): comments that go stale.** Rewrite the page's E-3 comment (`page.tsx:437`, "Refresh stays the first header button") and the header lines 17–19 and 33–35. Update the repository header's caller list (lines 20–50), and remove its "a caller cannot widen what is written" paragraph (it describes writes that no longer exist), per `new-repository`. Remove the `z` import from the pricing route if nothing still uses it. GET takes no input, so no schema is needed.

### Optimisation suggestions
- Add a dated "removed in AI model price review slice 6" note to `docs/SYSTEM_CONFIG_IMPLEMENTATION.md` and `docs/AUDIT_COVERAGE_ANALYSIS.md`. Both still describe Sync and the helpers.
- Slice 9 note: a live row created after this slice's merge date with `proposal_id IS NULL` is an emergency runbook change. History should show "changed by operator (runbook)" with the runbook log reference, never an invented actor.
- K-5: put the revert warning in the PR body, as planned, and in the requirement's R-9 row 6 note.

### Approval
[x] Workplan approved, conditions SC6-1..SC6-9. Implementation may start once the user answers BQ-1 (a). Same plan with a held merge if (b); re-review if (c).

---

**Code Review by SA — 2026-10-16** (uncommitted worktree diff on `447d17a2`, 26 files, +291 / −2,894, plus the 3 untracked files)
**Status:** 🔄 Fix Required. Three small fixes (CR-1..CR-3), none in app runtime code. QA may start in parallel. SA checks the three fixes from the diff, with no full re-review.

### Verified
- **Suites green locally:** the §4 command gives 62 suites and 1,466 tests passing. `chargingUntouched.guard` is unedited and green. `git diff` shows no change to `lib/ai/pricing.ts`, `lib/business-os/llm/**` or the charging guard. Lint on the touched files gives 0 errors. The warnings are old ones on lines this slice did not touch. `tsc`, filtered to the touched files, shows only the old `reward_config` errors in `admin-helpers.ts:76-148`, which sit above the removed block and are not from this slice. No `console.*` in any touched runtime file.
- **Removals are complete.** I ran `git grep` again outside `docs/` for `logAIPricing`, `syncMany`, `updateCosts`, `CreateAiModelPricingInput`, `AiModelPricingSync*`, `pricing/sync`, `EDIT_UNIT_WORDS`, and `aiModelPricingRepository.create/findById`. The only hits are the guards' own negative assertions and the unrelated `BoostPackRepository.deleteById`. There is no stray "Sync pricing" or "Edit pricing" text in `app/`, `components/` or `lib/`.
- **Old tabs.** A stale `PUT` gets a 405 (unexported method) and a stale Sync gets a 404 (the folder is gone, and there is no catch-all). Either way the old handler's `!response.ok` branch shows its error and nothing is written. RG-1 and RG-2 pin this.
- **Authz census re-counted from disk:** 75 `route.ts` files, 103 exported handlers and 97 `requireAdmin(` calls, so 103 = 97 + 6 + 0 holds. The register reads 110 rows, 7 struck, 103 live, and row 110 is correct. The stale totals at the truth table and the summary are fixed (SC6-7 ✅).
- **SC6-1** ✅ The S-4 paragraph does not contain the old label, and S-2/S-3 run over all of P. **SC6-6** ✅ (a) L-10, (b) MT-1 over `priceReviewCopy.ts`, (c) R-14. **SC6-8** ✅ The requirement's slice 8 note matches. **SC6-9** ✅ The E-3 comment, page header, repository header and route header are rewritten, and the route has no `z` import.
- **`source.guard` against the pin table:** every Keep/Replace/Invert/Delete row matches §3. The header bullet reads "SA 2026-10-16 slice 6 R-5 (moved from slice 8 by R-9 row 6)", and the describe is renamed. **NW-1 is meaningful.** P has exactly one `fetch(` after comments are stripped, that fetch is pinned as the pricing `GET`, and no `method: 'PUT'|'POST'|'DELETE'|'PATCH'` remains. A reintroduced direct write in the page fails two ways. Writes through the slice 3/5 modules (pending lines only) are correctly outside its scope.
- **LW-1 / LW-2 / LW-3 matchers.**
  - **What they catch.** LW-1 matches only a whole quoted literal, so the system-flow description string passes, and LW-4 proves it. Any file outside the allow-list that holds the literal fails, a constants file included, so a `const` alias declared anywhere is caught. Inside the allow-list, an alias fails the inline count. Chains are cut at `;` or `.from(` and span lines. The non-vacuity check finds exactly one chain in each of the three non-repository allow-listed files.
  - **Negative controls.** LW-4 bites: update, insert, multi-line upsert, delete, alias and not-allow-listed fail, and a read, a write on another table, and the description string pass.
  - **LW-2.** The verb ban covers the whole file, so a non-`async` method that writes is still caught.
  - **LW-3.** Per-file set equality holds, and a listed file that is missing reads as `[]` and fails.
  - **Residual, accepted.** A computed or concatenated name, a builder alias inside one of the four allow-listed files, or an `ai_price_*` function name imported from a constant outside `lib/repositories/`. These are deliberate dodges rather than accidents. The guard's header should name them (CR-4).
- **LW-5.**
  - **Fails closed.** A function the head regex misses, such as a `CREATE PROCEDURE` or a body quoted with single quotes, lands in `topLevel` and fails as top-level DML in a non-historic file. A `DO` block that writes in a new file fails the same way.
  - **Non-vacuous.** The `ai_price_submit_pending` body is found.
  - **Gaps:** CR-3.
- **Runbook paste 2 meets SC6-5.**
  - **Checks.** Prices must be above zero, with the embedding exception matching `isInputOnlyPricedModel`. It refuses unless exactly 1 active row is counted, future-dated rows included. It retires by id, scoped to the provider and model, then `GET DIAGNOSTICS` must equal 1 or it raises. It inserts with `cached_input_cost_per_token`, `proposal_id` and `proposal_line_id` set explicitly to NULL, then re-counts and requires exactly 1 or it raises.
  - **Safety.** There is no `DELETE`, and nothing is overwritten in place. The editor's problem word appears only as the `INSERT INTO` keyword, with none in any literal, `RAISE` text or comment. There is no backslash before a hex digit.
  - **Readers.** `listActive` filters `retired_date IS NULL`, so the retired row stops charging at once, and caches pick it up within 1 h.
  - **DV-5 (first price).** A NULL id requires 0 active rows. A forgotten placeholder fails the uuid cast, which is safe.
  - **Fingerprint.** It matches the `20261010` formula (`md5`, `round(…,18)::text`, newest per model, `effective_date <= today`).
  - **Warning.** The `20251030` warning is present and correct.

### Code Review Comments
1. **`docs/runbooks/AI_MODEL_PRICE_EMERGENCY_SQL_RUNBOOK.md` §2/§4: paste 1 is two statements, and the Supabase SQL editor shows only the last statement's result.** Priority: **High** (money path; it defeats SC6-5 step 1).
   - **Problem.** The operator never sees the first SELECT, which holds the active row `id`, its `::text` prices, `cached_input`, `effective_date` and the retired rows. Paste 2 needs that id. Paste 3 ("run paste 1 again") is meant to show the new row and the retired old row, and cannot.
   - **Fix.** Split it into **paste 1a**, the row listing alone (one statement), and **paste 1b**, the count and fingerprints alone (one statement).
     - Add `(SELECT string_agg(id::text, ', ') FROM public.ai_model_pricing WHERE provider = 'PROVIDER' AND model_name = 'MODEL' AND retired_date IS NULL) AS active_row_ids` to 1b, so the id is on the screen the operator reads the count from.
     - Paste 3 becomes "run 1a, then 1b, each on its own".
     - Update the "two places each" placeholder count and the table of contents.
     - Add a §1 rule: "Each paste is exactly one statement (paste 2's `BEGIN; DO …; COMMIT;` is one unit): the editor shows only the last result."
2. **Lost coverage: the deleted `pages.edge.qa` E-3 also covered recovery from a failed read.** Priority: **Medium**.
   - **What was lost.** After a failed read, the header Refresh re-reads successfully, the table comes back, and both the banner and `pricing-read-failed` clear. That behaviour still exists (`fetchData()` → `setError(null)`), and no surviving case asserts it. R-2..R-4 and R-10 only test the failure side. The rest of the O-4 deletion is justified: E-1, E-2 and E-3's editor half test removed behaviour.
   - **Fix.** Add **R-15** to `pages.render.test.tsx`: the first pricing read returns 500 and the second returns `okRows()`. Click the header Refresh (`container.querySelector('header button')`, as E-3 did, or add `aria-label="Refresh"` to the button and query it by role), then assert the row is back and the banner and failure line are gone. One `fireEvent`, so the time is negligible.
3. **`livePriceWrites.guard.test.ts:79` `SQL_LIVE_DML` misses `MERGE INTO` (Postgres 15, Supabase) and quoted identifiers (`public."ai_model_pricing"`, `"public".ai_model_pricing`).** Priority: **Medium**.
   - **Why it matters.** LW-5 is the only SQL-side check, and slice 8 writes from SQL.
   - **Fix.** Use `/(?<![A-Za-z0-9_])(INSERT\s+INTO|UPDATE|DELETE\s+FROM|MERGE\s+INTO|TRUNCATE(\s+TABLE)?)\s+(ONLY\s+)?("?public"?[.])?"?ai_model_(image_)?pricing"?(?![A-Za-z0-9_])/i`. It has no backslash before a hex digit, so the Tailwind rule holds.
   - **Controls.** Add two LW-4 controls: `MERGE INTO public.ai_model_pricing AS t USING …` inside a function body, and a top-level `UPDATE public."ai_model_pricing" SET …`. Both must fail.
   - **Optional.** `TRUNCATE other_table, ai_model_pricing` is also missed. Accept it, or match `TRUNCATE[^;]*ai_model_`.
4. **`livePriceWrites.guard.test.ts` header (lines 1–25).** Priority: **Low**.
   - Name the accepted residuals: a computed or concatenated table name, a builder alias inside an allow-listed file, and an `ai_price_*` function name imported from outside `lib/repositories/`. A future reader should not take the guard for a proof.
   - Replace "under 1 s" with the DV-1 ruling below.
5. **Runbook §4: the example "`0.15` per 1M shows as `0.00000015`" is not what Postgres prints.** Priority: **Low**.
   - **Why.** `numeric / 1000000` keeps the extra scale, so `::text` reads `0.00000015000000000000`.
   - **Fix.** Write "numerically equal to the per-1M price divided by 1,000,000 (the text may carry trailing zeros, e.g. `0.00000015000000000000`)".
   - **Also add one line.** This fingerprint covers every model (no `claude-3-*` exclusion), so it is compared only between paste 1b and paste 3 of the same run. It is never compared with the slice 2 logged value.
6. **Workplan §10.1 DV-7 says "the dollar-quote end is a named back-reference"; the code (line 76–78) says the opposite.** The code searches for the tag with `indexOf` and uses no named group. Priority: **Low**. **Fix:** correct the DV-7 text.

### DV rulings
- **DV-1 (guard about 1.15–1.25 s locally): ✅ Accepted as is. No further narrowing, no cache, no shared scan.**
  - **Why it adds no critical-path time.** `tests.yml` runs the gate as 3 parallel shards in a workflow separate from `build.yml`, so the critical path is `next build`. About 1 s of file I/O in one shard does not move it.
  - **Net Jest time goes down.** This slice deletes the Sync route suite, the five-handler route suites, `pages.edge.qa` (three render cases of several seconds each), R-5, R-9, R-13 and T-11b.
  - **Local timing is unreliable here.** On this machine, under load, a bare `readFileSync` over the same 2,530 files and 32 MB took 1.6–3.1 s with no regex. The cost is disk I/O, which a Linux runner's page cache makes much cheaper. Caching across test files adds a new pattern for no gain.
  - **Bound, for QA to record from the PR's CI run:**
    - the guard file's own time;
    - each shard's wall time against `Build (next build)` in the same run.
  - **Accept when:**
    - the guard is under 3 s in CI;
    - no shard finishes later than Build. Today that cannot happen because of this file.
  - **If either fails, narrow the walk.** Use `git ls-files -- app lib scripts` filtered to the code extensions. It is the same file set without walking untracked or ignored trees. Never drop `app/`, `lib/` or `scripts/`.
  - **`components/` stays out.** It is client code, and `authenticated` has SELECT only on both live tables, so a component cannot write them.
- **DV-2 (`dataAccess` floor 3 → 2): ✅** Correct, and the comment is clear.
- **DV-3 (T-14 also pins the new last sentence): ✅** This is what SC6-6 intended.
- **DV-4 (`AI_PRICING_SYNCED` description): ✅** I checked the history. Every version of the Sync route, from `e22afc4f` onward, carried only a typed list, with provider URLs in comments and no fetch. So "synced from the built-in list" is true for every historic row and "external source" was false. Severity, audience, compliance flags and the 205-count pin are unchanged, and `eventAudience` is green.
- **DV-5 (first-price path in the runbook): ✅** It is safe as written: a NULL id requires 0 active rows, then insert, then the count must be exactly 1. CR-1 still applies, because the operator needs `active_rows_for_model` = 0 on screen.
- **DV-6 (stand-in `onFinished` button): ✅** Matches O-9. T-15 asserts both lists are re-read (`pricingReads` 2), and R-14 confirms that 4 GETs and only GETs are sent.
- **DV-7 (lookarounds, tag found by `indexOf`): ✅** The code is right. Correct the text (CR-6).

### Optimisation Suggestions
- Optional runbook guard: in paste 2, `RAISE` when the new per-1M price is more than 10× or less than 0.1× the old row's. A typo of `150` for `0.15` would then fail closed. The owner's approval and paste 3 already catch it, so this is not required.
- Optional: add `supabase/functions` (small) to the LW-1 roots for completeness. No file there names a live table today.
- Proportionality: ✅. The slice is a net −2,600 lines. It adds one guard file, one runbook and no migration, and it introduces no new pattern.

### Code Approved for QA: Yes, in parallel. Merge only after CR-1..CR-3 are fixed (SA checks them from the diff). CR-4..CR-6 go in the same edit. The emergency runbook is applied only with the user's explicit OK for each run (BQ-1 (a)).

## QA Testing Report

**QA — 2026-10-16**
**Test mode:** full
**Strategy used:** A (Jest unit and source guards) + B (route and repository suites, mocked client) + mutation testing on a scratchpad mirror (copies of `app`, `lib`, `scripts`, `supabase/migrations`, `tests/helpers`, run through a scratch Jest config that resolves `@/` to the mirror first) + static review of the runbook SQL (not run) + CI timing analysis (read-only `gh`). D (browser) is a manual check owed after deploy, below.
**Focus:** all (api, ui, schema, security, performance)
**Skipped:** browser check (no dev server in this session, by instruction). No DB access. The runbook SQL was reviewed but not run.
**Input source:** prompt keywords (TL trigger) + workplan section 4

**Machine state:** no quiet window existed. CPU was at 100% throughout: three `tsc --noEmit` runs from other worktrees, six `next dev` servers, and about 20 tsc/jest processes from other sessions. Every local time below is under that load.

### Test Coverage
| Acceptance criterion / check | Tested? | Result | Notes |
|---|---|---|---|
| Sync removed: route deleted, button and handler gone (MP-FR-13, R-1) | ✅ | Pass | RG-2; S-2/S-3/S-5..S-7; W2-4; R-14. Mutation: re-adding "Sync Latest Pricing" is caught by S-2/S-3 and R-14 |
| No direct single-row add/edit/delete (MP-FR-11, Q9 (c)) | ✅ | Pass | RG-1 exports exactly `['GET']`. Mutation: re-adding `PUT` is caught by RG-1 |
| Repository read-only (D-3, LW-2) | ✅ | Pass | Mutation: an `async updateCosts` with `.update(` is caught by LW-2 (both cases) and the repository test; a non-async arrow `.insert(` is caught by LW-2 "no write call" |
| No app path writes a live table (LW-1) | ✅ | Pass, with an accepted limit | Caught: a new `app/api` file with `.from('ai_model_pricing').update(`; an `.update(` added to the allow-listed agent-generation-config chain; a `const` alias in that reader (two cases fire, including non-vacuity). Not caught: a computed name, `['ai','model','pricing'].join('_')` (E-1) |
| SQL has no live-table writer (LW-5) | ✅ | **Partial** | Caught: a plpgsql function with `UPDATE public.ai_model_pricing`. **Not caught:** `MERGE INTO public.ai_model_pricing` and `UPDATE public."ai_model_pricing"` inside a function (Bug 2). Dynamic `EXECUTE format(...)` is also missed (E-1) |
| Page sends only the pricing GET (NW-1) | ✅ | Pass | Caught: a second `fetch(` with `method: 'PUT'`; a `window.fetch` with a lowercase verb in a variable (the fetch count fires) |
| Edit gone from every row | ✅ | Pass, with a gap | Old button (`title="Edit pricing"`) is caught by T-11, R-12, R-14 and MT-1. A button titled "Edit price" with no handler passes every suite (E-2) |
| Help text: S-1, S-4 byte pins; MT-1; MT-2 | ✅ | Pass, with a gap | Changing "within 1 hour" to "within 2 hours" is caught by MT-2 and L-10. Rewriting the first half to "Prices update instantly, so a change is in effect on all servers within 1 hour" passes (E-3) |
| Runbook `20251030` warning | ✅ | Not pinned | No test reads the runbook (grep), so removing the warning cannot be caught (E-4) |
| Events kept, helpers gone (D-4) | ✅ | Pass | `lib/audit/__tests__` 179/179 |
| Authz surface after deletion (SC6-7) | ✅ | Pass | `test:authz-guard` 203/203 |
| Charging untouched | ✅ | Pass | `chargingUntouched.guard.test.ts`: no diff against HEAD. No charging file in `git diff --name-only HEAD`. No backslash followed by a hex digit in any changed or new file |
| Runbook static rules (step 4) | ✅ | **Partial** | See the table below |

### Suite runs (verbatim counts)
| Command | Suites | Tests | Exit |
|---|---|---|---|
| `npx jest app/admin/system-config --ci --verbose`, run A (parallel) | 10 passed, 10 total | 144 passed, 144 total | 0 (Time 104.02 s; one "worker failed to exit gracefully" warning) |
| same, run B (parallel) | 10 passed, 10 total | 144 passed, 144 total | 0 (Time 105.554 s) |
| `npx jest lib/ai/pricing-research --ci` | 14 passed | 294 passed | 0 |
| `npx jest app/api/admin/model-pricing --ci` | 3 passed | 51 passed | 0 |
| `npx jest supabase/migrations --ci` | 42 passed | 2183 passed | 0 |
| `npm run test:bos-entitlements` | 279 passed | 8258 passed | 0 |
| `npx jest lib/audit/__tests__ --ci` | 15 passed | 179 passed | 0 |
| `npm run test:authz-guard` | 2 passed | 203 passed | 0 |
| `npm run test:bos-llm` | 23 passed | 627 passed | 0 |
| Tailwind guard `app/__tests__/tailwind-css-escape.guard.test.ts` | 1 passed | 6 passed | 0 |
| Extra: `app/api/admin/system-config` + `AiModelPricingRepository` | 4 passed | 56 passed | 0 |

**Slowest 5 cases, run A:** L-1a 4097 ms · M-6b 3009 ms · T-5 2939 ms · R-6 2853 ms · T-1 2836 ms.
**Slowest 5 cases, run B:** T-1 4655 ms · T-2 3459 ms · R-1 3057 ms · T-1b 3001 ms · M-1 2894 ms.
Two cases went over the 3.5 s ceiling (L-1a, T-1), on a CPU already at 100% from other sessions (E-5).

### Guard runtime (DV-1, O-3)
Script: a copy of the guard's module-level walk, raw-byte prefilter and candidate decode, timed with `hrtime`.

| Condition | Run 1 | Run 2 | Run 3 | Shape |
|---|---|---|---|---|
| Baseline (other sessions' load only; no quiet window existed) | 1888 ms (walk 335) | 1399 ms (walk 345) | 1510 ms (walk 385) | 2,530 files, 32.1 MB, 22 candidates |
| Under the two parallel system-config runs | 4217 ms (walk 1651) | 4152 ms (walk 700) | 3047 ms (walk 759) | same |
| Four roots (with `components/`), baseline | 1999 ms | — | — | 3,118 files, 41.5 MB |
| Whole guard suite alone, Jest-reported | 8.07 s | 6.13 s | 11.38 s | 17/17 pass; includes the ts-jest transform |

Reading 32 MB dominates; the walk is about 0.35 s. **Locally the guard is over the 1 s target** (O-3), and SA's only allowed lever, dropping `components/`, is already used.

**CI impact: none on the critical path; the in-CI number is still owed.**
- **Shard:** Jest's `--shard` hashes the POSIX-relative path, the same on Windows and Linux. `npx jest --config jest.gate.config.js --listTests --shard=k/3` puts the guard in **shard 3/3** (487 / 487 / 486 suites).
- **Recent runs** (6 runs, 2026-10-15/16, PR and merge-queue; job wall clock): shard 3 took 113–177 s, the slowest shard (usually 2) 196–202 s, and Build 145–236 s. In run 38927279342's artifact, shard 3's Jest wall was **51.2 s**, against 105.6 s for shard 2 and 65.1 s for shard 1. Shard 3's heaviest existing guard takes 1.5 s.
- **Estimate:** on the Linux runner, 2,530 freshly checked-out files are in page cache; expect roughly 0.2–0.5 s (an estimate, not measured). That lands on one of four workers in the lightest shard, so shard wall moves by well under 1 s.
- **Critical path:** in 5 of 6 runs shard 3 finished 20–120 s before Build. In one run (38913702373: Build 145 s, shard 3 146 s plus a 14 s verdict) shard 3 was the last job; there a sub-second addition would sit on the critical path. That is noise level, and within the no-added-CI-time rule.
- **Owed:** after the PR opens, read this suite's `endTime - startTime` from the `gate-results-3` artifact and record it here.

### Runbook static checks (`docs/runbooks/AI_MODEL_PRICE_EMERGENCY_SQL_RUNBOOK.md`, 88 SQL lines)
| Rule | Result |
|---|---|
| The word "into" only as `INSERT INTO` | ✅ Pass. One occurrence in the whole file (line 138) |
| No `--` or `/*` comments | ❌ **Fail.** Three `--` comments in paste 2, lines 103–105 (Bug 1) |
| No single-letter aliases | ✅ Pass (`pricing`, `ranked`) |
| No backslash | ✅ Pass. None in the file |
| ASCII only | ✅ SQL blocks pass. Prose has `—` (line 1), `⚠️` (183), `→` (189), which are outside the pastes |
| Every write inside the DO block | ✅ Pass. The only `UPDATE` (129) and `INSERT` (138) are inside `$emergency_price$` |
| No DELETE | ✅ Pass. None in SQL; prose only warns against it |
| Refuses unless exactly one row changed | ✅ Pass. `GET DIAGNOSTICS v_changed = ROW_COUNT` must be 1; the active count is checked as 1 before (or 0 for a first price) and exactly 1 after |

**PG17 reasoning (not run):**
- `BEGIN; DO …; COMMIT;`: any `RAISE EXCEPTION` aborts the transaction, so nothing persists.
- `count(*)` (bigint) into `integer` is an implicit assignment cast. Uncorrelated scalar subqueries next to aggregates are legal.
- Bare `position` as a column reference is legal; it is a col_name_keyword, and the 20261010 script used the same alias.
- `v_old_id uuid := 'OLD-ROW-ID'` left unedited fails at block entry (invalid uuid), which is safe.
- The input-only exception (`openai`, `text-embedding-%`) matches `isInputOnlyPricedModel`.
- The INSERT satisfies `ai_model_pricing_provenance_paired` (NULL/NULL) and `ai_model_pricing_cached_input_valid` (NULL). Retire-then-insert cannot hit the partial unique index.
- Readers (`listActive`/`listActiveExact`: `retired_date IS NULL`, `effective_date <= today`) pick up the new row at once, and stop reading the old one.
- The fingerprint is the 20261010 formula without that script's one-off `NOT IN` filter, which is correct here.

Two text slips found (Bugs 3 and 4).

### Issues Found

#### Bugs (must fix before commit)
1. **Runbook paste 2 carries three `--` comments** — File: `docs/runbooks/AI_MODEL_PRICE_EMERGENCY_SQL_RUNBOOK.md` lines 103–105 — Severity: Medium
   - Steps to reproduce: `awk '/^```sql/{f=1;next}/^```/{f=0}f' <runbook> | grep -n -- '--'`
   - Expected: no `--` or `/*` in any paste (TL static rule).
   - Actual: `-- or NULL for a model with no price yet`, `-- input price per 1M tokens, …`, `-- output price per 1M tokens, …`. Harmless to PG17, but they break the rule, and the paste is what an operator edits under pressure. Move the three hints into the prose above the block.
2. **LW-5 misses `MERGE INTO` and a quoted table name** — File: `lib/ai/pricing-research/__tests__/livePriceWrites.guard.test.ts` (`SQL_LIVE_DML`) — Severity: Medium
   - Steps to reproduce (scratch mirror): add a migration whose plpgsql function body is `MERGE INTO public.ai_model_pricing AS live USING … WHEN MATCHED THEN UPDATE SET retired_date = …`, or `UPDATE public."ai_model_pricing" SET …`.
   - Expected: LW-5 fails.
   - Actual: 17/17 pass. `MERGE` (PG15+) is a natural shape for an apply function, which is exactly the writer LW-5 exists to catch.
   - Fix: add `MERGE\s+INTO` to the verbs, allow an optional `"` around the table name (and schema), and add both to the LW-4 controls. Keep the no-backslash-hex rule: `\s` is safe.
3. **Paste 1 says "two places each"; there are three** — File: runbook line 44 (placeholders at 55, 68, 77) — Severity: Low
   - An operator who replaces only two leaves `'PROVIDER'`/`'MODEL'` in either `active_rows_for_model` or the `fingerprint_other_models` filter.
   - Fails safe: paste 2 re-counts, and the post-check then shows a false mismatch. Still a confusing stop mid-emergency. Say "three places each".
4. **Paste 3's example display is wrong** — File: runbook line 164 — Severity: Low
   - Expected (per the text): `0.15` per 1M shows as `0.00000015`.
   - Actual (PG numeric division scale rules, `select_div_scale`: 16 significant digits): `0.15 / 1000000` stores `0.000000150000000000000000` (scale 24), so `::text` shows trailing zeros. The value is exact and the fingerprint (round 18) is unaffected, but an operator matching text will think it is wrong.
   - Fix: use `v_input_per_1m * 0.000001`, the formula the pending area's generated column uses (20261066), which yields `0.00000015`. Or reword the check to "equal in value".

#### Performance Issues (should fix)
1. **DV-1: the guard scan is over the 1 s target locally** (1.4–1.9 s under others' load, 3.0–4.2 s under the parallel run). CI impact is estimated sub-second, in the lightest shard, off the critical path (above). Accept, conditional on the owed in-CI measurement. If CI shows over 1 s, the cheapest next lever is skipping files larger than about 200 KB that are known data (translations, `catalog.generated.ts`). That is an SA call, since it narrows LW-1.

#### Edge Cases (nice to fix)
1. **E-1** Computed names escape both scans: `['ai','model','pricing'].join('_')` in app code (LW-1), and `EXECUTE format(…, 'ai_model_' || 'pricing')` in SQL (LW-5). This is the accepted limit of a static guard; worth one sentence in the guard header.
2. **E-2** An Edit button with a different title ("Edit price") and no handler passes every suite. Any write it made would trip NW-1, so the risk is only false UI. A role-name check (`queryAllByRole('button', { name: /edit/i })` → 0) in R-14 would close it.
3. **E-3** MT-2 pins only "in effect on all servers within 1 hour". The cache half of the sentence can be changed to something false and pass. Consider pinning the whole D-6 sentence.
4. **E-4** No test reads the runbook, so the `20251030` warning (or the no-DELETE property) can be removed silently. Optional: a small doc guard over the SQL blocks (no `--`, no `DELETE`, "into" only as `INSERT INTO`, warning present). It would also have caught Bug 1.
5. **E-5** Over the 3.5 s case ceiling under load: L-1a 4097 ms (run A), T-1 4655 ms (run B). Neither case's logic is touched by this slice (both pre-date it), and the CPU was saturated by other sessions. Re-check on a quiet machine before reading it as a regression. Run A printed one "worker failed to exit gracefully" warning; run B did not.
6. **E-6** `supabase/SQL Scripts/` (where `20251030` lives) is outside LW-5 by design (operator scripts). The runbook warning is the only control there; slice 14 deletes the file.

### Manual check after deploy (user, desktop browser, admin account)
1. Open `/admin/system-config`. **No "Sync Latest Pricing" button** in the header, and **no Edit (pencil) button** on any row, including with "Show retired" on. The Actions column shows only **Enter provider price**.
2. Section helper reads: *"Cost per token for each AI model, as charged today. Live prices cannot be changed on this page until Apply arrives."*
3. Open the help drawer (**?**). "The buttons" has no Sync or Edit paragraph, and reads *"The Sync button and the per-row Edit have been removed. … with the platform owner's approval."* It also still reads *"Each server keeps its own copy of these prices for up to 1 hour, so a change is in effect on all servers within 1 hour. Changes don't alter provider billing."* The units section no longer mentions an Edit field. Esc closes it.
4. **KPIs** show numbers (not blank or error), and match the table's red/amber rows.
5. **Check provider prices:** click it and let it finish. It reports a result, the table re-reads (pending column fills for OpenAI rows), and no live price changes. The "as charged today" figures stay the same.
6. **Enter provider price** on one row: type a price, save. It shows as a pending price, no live price changes, then **dismiss or leave it** as the test requires (no Apply exists).
7. **Old tab:** before deploying, open the page in a tab and leave it open. After the deploy is live, click **Sync Latest Pricing** in that stale tab. Expect the red message **"Failed to sync pricing"**, and on refresh no price changed. Optionally, click an old **Edit → Save**: expect **"Failed to update pricing"** (405).
8. In DevTools → Network on a fresh load: only `GET /api/admin/system-config/pricing` plus the comparison reads. No PUT, POST or DELETE.

### Test Outputs / Logs
- Mutation runs: 18 mutations, every suite compiled (0 "Test suite failed to run"), and the mirror was restored byte-for-byte after each. Caught: m1, m2a, m2b, m3, m3c, m4, m5, m6, m7a, m8a, m8b, m9a. Not caught: m3b (E-1), m5b and m5d (Bug 2), m5c (E-1), m7b (E-2), m9b (E-3). Runbook: no test (E-4).
- The worktree was untouched: `git status --short` had the same 29 entries before and after; nothing staged.

### Final Status
- [ ] All acceptance criteria pass — ready for commit
- [x] Issues found — Dev must address before commit: Bugs 1 and 2 (Medium); Bugs 3 and 4 are Low, but cheap and in the same file as Bug 1. No High-severity bug open. Everything that ran is green; the slice's behaviour (Sync and Edit gone, GET only, read-only repository, charging untouched) is verified.

## Commit Info

_To be completed by RM._

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-16 | Created | Workplan for slice 6: delete Sync route and list, GET-only pricing route, read-only repository, events kept and helpers removed, guard rewrite plus live-write guard, BQ-1 emergency SQL runbook. No code written |
| 2026-10-16 | SA workplan review | Approved with conditions SC6-1..SC6-9 (D-6 vs S-2 conflict, LW-1/LW-3 definitions, new SQL-side LW-5, runbook SQL as three self-guarding pastes, missed test edits, unregistered `plan-test-clock#POST`, slice 8 migration note content). O-1..O-9 ruled; BQ-1 left to the user |
| 2026-10-16 | SA conditions folded; BQ-1 decided | SC6-1..SC6-9 folded into D-6, section 3 and section 6. User decision BQ-1 (a): ship now, emergency changes by the SQL runbook with the user's approval. Implementation started |
| 2026-10-16 | Code complete | Slice 6 implemented per SC6-1..SC6-9; deviations DV-1..DV-7 in 10.1. Uncommitted, awaiting SA code review and QA |
| 2026-10-16 | SA code review | Fix Required, small fixes: CR-1 (High) the runbook's paste 1 is two statements and the editor shows only the last, so split it into 1a/1b; CR-2 (Medium) restore the failed-read recovery coverage lost with E-3 (R-15); CR-3 (Medium) LW-5 regex misses `MERGE INTO` and quoted identifiers; CR-4..CR-6 (Low) doc fixes. DV-1..DV-7 accepted; DV-1 bounded by a CI measurement. QA may run in parallel |
| 2026-10-16 | SA code review and QA fixes | CR-1 runbook paste 1 became 1a (rows) and 1b (count, `active_row_ids`, fingerprints), one statement per paste, paste 3 = 1a then 1b, §1 one-statement rule. CR-2 R-15 (Refresh after a failed read recovers). CR-3 / QA Bug 2 LW-5 matcher adds `MERGE INTO`, quoted identifiers and multi-table `TRUNCATE` (grants excluded), with LW-4 controls. CR-4 guard header names the accepted gaps and the DV-1 runtime ruling. CR-5 / QA Bug 4 runbook conversion `* 0.000001`, "numerically equal", fingerprint compared within one run. CR-6 DV-7 text. QA Bug 1 no comments in pastes; Bug 3 "three places each"; E-2 any button named "Edit…"; E-3 full MT-2 sentence pinned; E-4 new `emergencyRunbook.source.test.ts`. TL: 10x / 0.1x check in paste 2 with the `v_confirm_large_change` override, skipped for a first price. Merged origin/main. Uncommitted |
