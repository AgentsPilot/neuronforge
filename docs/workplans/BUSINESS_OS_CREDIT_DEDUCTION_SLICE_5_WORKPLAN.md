# Workplan: Business OS Credit Deduction — Slice 5 (Set the credit value and plan allowances)

> **Last Updated**: 2026-09-30

**Developer:** Dev
**Requirement:** [BUSINESS_OS_LLM_DEDUCTION_LAYER_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_LLM_DEDUCTION_LAYER_REQUIREMENT.md): §12 slice 5, FR-3, FR-18, FR-37, AC-2, AC-25, BD-8 (D1–D3), **BD-16**, **SQ-17**, **SQ-19**, OI-2, OI-7, OI-9, and **"SA review — slice 5 (2026-09-30)"**, which is binding (C-1 to C-5, G-1 to G-10, N-12, N-13, P-1, P-2, and the stale-comment list)
**Numbers from:** [BUSINESS_OS_CREDIT_PRICING.md](/docs/architecture/BUSINESS_OS_CREDIT_PRICING.md), the single source for D1–D3, the formula and the benchmark
**Builds on:** [BUSINESS_OS_CREDIT_DEDUCTION_SLICE_3_WORKPLAN.md](/docs/workplans/BUSINESS_OS_CREDIT_DEDUCTION_SLICE_3_WORKPLAN.md), which added credit value v0 and the resolver that reads it
**Date:** 2026-09-30
**Branch:** `feature/business-os-credit-deduction-slice-5` (worktree `neuronforge-llm-deduction`, off `origin/main` `fe7f6410`)
**Status:** Code Complete, uncommitted, ready for SA code review. BD-16 decided by the user on 2026-09-30 (2,000 credits, §15 UD-1); R-7 answered (option C, §15 UD-2); `LanguageContext.tsx` logging is a separate chip (§15 UD-3). T13 (C-3) recount = 0 on 2026-09-30 10:09 UTC. No migration.

## Overview

Slice 5 replaces the invented allowance numbers with the ones the user decided on 2026-09-30 (D1–D3). It also renames the allowance from "AI actions" to a general credit allowance, as SA ruled under SQ-17. The whole slice is configuration, copy, tests and docs, shipped in one PR (C-1):

- **Credit value version 1** is appended: $0.001, `derived`, decided 2026-09-30, `matrixVersion: 2`. Version 0 is left as it is.
- The **tier matrix goes to version 2**. The capability `ai.actions` becomes **`credits.allowance`**, with unit `'credit'` and the working label "Credits". Essentials gets **19,750** credits a month and Autopilot **32,250**. Founding Partner reads the Autopilot row, so it gets 32,250 with no separate edit.
- The **trial's one-off total is BD-16**, still with the user. It is planned as one named constant holding a placeholder, plus a gate test that stays red until the user's figure replaces it.

Nothing is enforced, the charge path does not change, and nothing is written to the database. Owners do see two copy changes on screens that are **not** behind shadow mode, set out in §6.

---

## Table of Contents

- [1. Verification log](#1-verification-log)
- [2. Analysis summary](#2-analysis-summary)
- [3. Implementation approach](#3-implementation-approach)
- [4. The trial total (BD-16) and the merge gate](#4-the-trial-total-bd-16-and-the-merge-gate)
- [5. Expected snapshot diff (C-2)](#5-expected-snapshot-diff-c-2)
- [6. What owners could see](#6-what-owners-could-see)
- [7. Files to create / modify](#7-files-to-create--modify)
- [8. Estimate](#8-estimate)
- [9. Task list](#9-task-list)
- [10. Test plan](#10-test-plan)
- [11. Guardrails and out of scope](#11-guardrails-and-out-of-scope)
- [12. Risks](#12-risks)
- [13. Open questions for SA](#13-open-questions-for-sa)
- [14. Business question for the user](#14-business-question-for-the-user)
- [15. Flagged items (console.*, stale facts)](#15-flagged-items-console-stale-facts)
- [SA Review Notes](#sa-review-notes)
- [QA Testing Report](#qa-testing-report)
- [Commit Info](#commit-info)
- [Change History](#change-history)

---

## 1. Verification log

Every fact below was checked on 2026-09-30 in this worktree at `fe7f6410`. The only exception is V-17, which repeats SA's live read and is re-run at C-3.

| # | Fact | Evidence |
|---|---|---|
| V-1 | `CREDIT_VALUE_HISTORY` holds only version 0 ($0.001, `provisional`, `matrixVersion: 1`, 2026-09-28). `currentCreditValue()` returns the last entry. The header block "VERSION 0 IS PROVISIONAL" says slice 5 appends version 1 | `lib/business-os/entitlements/config/creditValue.ts` |
| V-2 | `creditValue.test.ts` checks four things: the history deep-equals `creditValue.history.json`; no released entry has been edited; versions run 0, 1, … with no gap; each `matrixVersion` is non-decreasing and `≤ TIER_MATRIX.version`. With v1 at `matrixVersion: 2` and the matrix at 2, all of these pass | `lib/business-os/entitlements/__tests__/creditValue.test.ts` |
| V-3 | The charge path reads `currentCreditValue()` in `price()` and stamps `creditValueVersion: value.version`. It logs `bos_credit_value_active` once per process, including the `status`. **No code change is needed**: after deploy every new charge records version 1 | `lib/business-os/llm/chargeResolver.ts:31`, `:104-111`, `:120-129` |
| V-4 | Tests that pin **version 0 as the current value** through the real resolver, and so fail once v1 exists (C-4): `chargeResolver.test.ts:144` (`toBe(0)`), `:197` (log fields `version: 0`, `status: 'provisional'`), `:267` (`creditValueVersion: 0` in the built record), `aiChargeRecorder.test.ts:134`, `aiActionAudit.test.ts:713`. Tests that use `0` as **arbitrary row data** and stay as they are: `BusinessOsCreditChargeRepository.test.ts:51, :65, :291`, `BusinessOsCreditLedgerReadRepository.test.ts:89`, `creditReport.test.ts:48, :72`, `creditLeakCheck.test.ts:79`, `credits/report/__tests__/route.test.ts:89` | grep of `creditValueVersion` / `credit_value_version` |
| V-5 | The capability is `'ai.actions'` in `config/catalog.ts:299`, with `shape: { kind: 'metered', unit: 'ai_action', period: 'month' }`, labels "AI actions" / "פעולות AI" / "Acciones de IA", `category: 'ai_chat'`, `audience: 'mixed'`, `atLimit: 'by_call_site_audience'`, and the stale `note` | `config/catalog.ts:299-310` |
| V-6 | The unit union is `'ai_action' \| 'sms'` in two places: `types.ts:39` and `schema.ts:526` (`z.enum`). No other code uses the **unit** `'ai_action'`. Every other `'ai_action'` in the repository is the audit `entity_type` (G-9) | grep of `'ai_action'` |
| V-7 | Tier values: `BASE['ai.actions'] = { perMonth: 500 }` (`tierMatrix.ts:147`) and `pro['ai.actions'] = { perMonth: 2000 }` (`:213`). `TIER_MATRIX.version: 1` (`:220`), `removals: []`. Stale text: the header table (`:10-15`), "point at the `basic` tier" (`:21-22`), "and `ai.actions`" (`:31`), the FIRST PASS block (`:144-146`), and "four times the credits" (`:210`) | `config/tierMatrix.ts` |
| V-8 | `CHAMPION_VALUES['ai.actions']` **reads** `TIER_MATRIX.tiers[CHAMPION_BASE_TIER]['ai.actions']`, with `CHAMPION_BASE_TIER = 'pro'`. `TRIAL_VALUES['ai.actions'] = { total: 250 }`. The stale comments are the header (`:23-26`), the PLACEHOLDER block (`:65-79`), `:125`, `:130-137` and `:202` | `config/cohorts.ts` |
| V-9 | Readers of the id outside `config/`: `customerPlanView.ts:519` (the trial's "runs out" sentence), `adminPlansView.ts:170`, `:178` (field `aiActions`), `planPresentation.ts:115`, `:131`, `:137` (parameter `aiActionsValue`, admin sentence "AI actions run out"). Stale comments: `types.ts:55`, `decide.ts:58`, `customerPlanView.ts:323`, `:419` | grep |
| V-10 | The admin Tiers screen shows the allowance as `plan.aiActions` under the label "AI actions" (`app/admin/business-os-tiers/components/PlanCard.tsx:122-124`, testid `plan-${plan.id}-ai`). The wire type is `app/admin/business-os-tiers/types.ts:33`. It also shows `matrixVersion` (`adminPlansView.ts:219`) | files |
| V-11 | The owner copy key `plan.ends_on_or_actions` is in `LanguageContext.tsx:326` (en), `:4063` (es) and `:9749` (he). It is referenced by `customerPlanView.ts:523`, `customerPlanView.test.ts:198, :202, :727, :729`, `planCopy.i18n.test.ts:37, :89`, and the mocked dictionary in `components/business-os/settings/__tests__/PlanSection.render.test.tsx:54`. That last file is **not on SA's list** | grep |
| V-12 | `app/admin/business-os-tiers/__tests__/__fixtures__/recordedAccountBody.json` and `…NoPlanRow.json` are **verbatim route bodies**. `app/api/admin/business-os/entitlements/__tests__/routes.test.ts:481-513` deep-equals the live route output against them, so they must be **re-recorded**, not hand-edited. Both hold `"matrixVersion": 1` and an `"ai.actions"` entry. **That suite is outside `test:bos-entitlements`** and must be run separately. Green at `fe7f6410` (40 / 40) | files; baseline run |
| V-13 | The drift snapshot `__tests__/entitlements.snapshot.json` holds only the **tiers** (no cohorts) plus `generated` and `matrixVersion`. `findDrift` skips a snapshot capability that is missing from the catalog (`snapshot.ts:112`, "the catalog test owns that"), so it cannot see the rename (SA SQ-17) | files |
| V-14 | `adminOps.ts:412` writes `plan_version = ctx.config.matrix.version` only when a **tier** is assigned. Overrides validate `capability` against the catalog keys | `lib/business-os/entitlements/adminOps.ts` |
| V-15 | No file outside `lib/business-os/entitlements/**` names the capability id, and `enforcementPoints.test.ts` has no `KNOWN_NON_GATES` entry for it. This slice adds **no new importer** from outside the module: every changed outside file is a test, a fixture, a type-only admin wire file, or `LanguageContext.tsx` (dictionary strings only) | grep; `.claude/skills/business-os-entitlements/SKILL.md` |
| V-16 | Owner-facing surfaces that render the allowance, **not gated by the entitlements mode**: (1) the Plan section of `/business-os/settings` (`app/business-os/settings/page.tsx:1017` → `components/business-os/settings/PlanSection.tsx` ← `app/api/business-os/entitlements/my-plan/route.ts:99` `buildCustomerPlanView`); (2) the public invite page `app/invite/page.tsx` via `lib/business-os/invites/inviteOffer.ts:106` → `describePlanOffer`. Both list granting capabilities by their localised catalog label plus `describeCapabilityValue` ("N per month" / "N in total", English in every locale, as today) | files |
| V-17 | **SA live read, 2026-09-30:** 0 override rows in total (none on `ai.actions`), 0 shadow events on `ai.actions`, 8 plan rows all `cohort = champion`, `tier = NULL`, `plan_version = 0`. No SQL reference. **Re-run at C-3 before merge** (T13) | SA review, slice 5 |
| V-18 | **Baselines at `fe7f6410` (Dev, 2026-09-30):** `npm run test:bos-entitlements` **93 suites / 1,928 tests, all pass**. Outside-module affected set (`chargeResolver`, `aiChargeRecorder`, `aiActionAudit`, `app/admin/business-os-tiers`, `PlanSection.render`, `app/invite`) **13 / 374 pass**. `routes.test.ts` **40 / 40**. `typecheck:bos-llm` **329 files, 28 errors, 0 new, passed** (it also notes one baseline entry already fixed, not ours). `check:bos-llm-literals` **53 files, 0 violations** | runs |
| V-19 | The "AI action" vocabulary outside the capability (audit `entity_type 'ai_action'`, `AiActionType`, `runAiAction`, the Health tiles "Failed AI actions", the leak-check labels in `bosCronJobs.ts:374-376`, `costCopy.ts:16`, `chargeClassification.ts:18`, `balance.ts:7, :19`, and the shadow report's `setupAi` in `report.ts:15, :814-820`) is about **AI actions**, not the plan allowance. **Not touched** (G-9) | grep |

---

## 2. Analysis summary

| Area | What changes |
|---|---|
| Credit value | Version 1 appended to `CREDIT_VALUE_HISTORY` and `creditValue.history.json`. Version 0 byte-for-byte unchanged (G-2) |
| Catalog / types / schema | `ai.actions` → `credits.allowance`, unit `'credit'` (the `'ai_action'` unit removed), labels "Credits" / "קרדיטים" / "Créditos". `category: 'ai_chat'` kept (N-12) |
| Tier matrix | `version: 2`; `BASE` 19,750 / month; `pro` 32,250 / month; `removals` stays empty (G-3); header and comments corrected |
| Cohorts | The champion keeps **reading** the `pro` row under the new key (G-7). The trial total is the BD-16 constant (§4). Placeholder wording replaced by a pointer to the pricing doc, except `email.volume`, which stays a named FIRST PASS (OI-2) |
| Readers | `customerPlanView.ts`, `planPresentation.ts`, `adminPlansView.ts` read the new id. The admin field `aiActions` → `credits`. The admin and owner "run out" sentences say credits |
| Admin UI | Tiers card label "AI actions" → "Credits". The card now shows 19,750 / 32,250 / 32,250 / the trial total, and matrix version 2 |
| Owner copy | `plan.ends_on_or_actions` → **`plan.ends_on_or_credits`** in en / es / he (SA's preferred option, since the three locale blocks are edited anyway; Q-2) |
| Tests / fixtures / snapshot | About 20 files renamed. C-4 version-0 pins → `currentCreditValue().version`. Snapshot regenerated. Admin recorded bodies re-recorded. One new gate test (§4) |
| Docs / skill | `BUSINESS_OS_ENTITLEMENTS.md` plan table, callouts, ops row, metering credit-value line, new Change History row. The skill's "paid tiers differ only by `chat.*` and `ai.actions`". Pricing doc **P-1 and P-2 only**, plus the revision-log and Change History rows OI-9 asks for |
| DB / RPC / migration / charge path | **None** (G-1) |

**The phase being fixed:** none in the V6 pipeline. This is Business OS entitlements configuration.

---

## 3. Implementation approach

**Order.** Rename first, numbers second, docs last, all in one PR (C-1). The rename is safe to do mechanically: `TierRow` and `CohortExplicitValues` are mapped types over the catalog, so re-keying the catalog entry turns every missed reader in typed code into a compile error. ts-jest type-checks each test file it loads, and a project-wide `tsc` (T12) catches the rest. The string-keyed readers (`resolution.values['…']`, `Record<string, unknown>` casts in tests, JSON fixtures) are **not** type-checked. They are found by `grep -rn "ai\.actions"`, which must return only the history rows in docs, requirements and workplans (T12).

**Key position.** The catalog entry, the `BASE` line and the `pro` line are re-keyed **in place**, so key order and the snapshot's field order stay the same. The snapshot diff is then exactly the two renamed entries plus the header lines (§5).

**Credit value v1** (AC-25 (a)), appended verbatim to both files:

```ts
{
  version: 1,
  usdPerCredit: 0.001,
  status: 'derived',
  matrixVersion: 2,
  decidedOn: '2026-09-30',
  derivation:
    'Derived from the user\'s decisions D1–D3 (2026-09-30): 100% markup, plan allowance = 50% of the fee at retail value, generous ceiling. $0.001 kept; a chat turn measured ~2 credits (N-8). Numbers, data and revision log: docs/architecture/BUSINESS_OS_CREDIT_PRICING.md.',
}
```

The header's "VERSION 0 IS PROVISIONAL" block becomes one short paragraph: v0 was the working figure, v1 is the derived value, see the pricing doc (G-8).

**Tier matrix.** `BASE['credits.allowance'] = { perMonth: 19750 }` and `pro['credits.allowance'] = { perMonth: 32250 }`, each with one pointer line to the pricing doc §3. `version: 2`, with the comment rewritten to say that v2 is the first matrix whose allowance is in credits (the SQ-17 rename and D1–D3 raises), that there is no removal, and why no `removals` entry exists (SA SQ-17 table). The header table is rebuilt: column "Credits/mo", champion "yes" chat and 32,250 (reads `pro`), trial = BD-16, and "`trial` → `basic`, `champion` → `pro`". "Four times the credits" becomes "and more credits" (≈ 1.6×, with no number repeated in code).

**Cohorts.** `CHAMPION_VALUES['credits.allowance'] = TIER_MATRIX.tiers[CHAMPION_BASE_TIER]['credits.allowance']`, with no literal 32,250 (G-7). `TRIAL_VALUES['credits.allowance'] = { total: TRIAL_CREDIT_TOTAL }` (§4). The PLACEHOLDER block is reduced to what is still true: the allowance is decided (pointer), and `email.volume` stays a named FIRST PASS (OI-2). The header's "champion gets Essentials until chat is ready" is corrected.

**Readers.**
- `planPresentation.describePlanEnding`: parameter `aiActionsValue` → `allowanceValue`, and the sentence ends "…or when the credits run out — whichever comes first."
- `customerPlanView.endsWhenSentence`: reads `resolution.values['credits.allowance']` and returns key `plan.ends_on_or_credits`.
- `adminPlansView`: field `credits`, read from `catalog['credits.allowance']`.

The comments at `types.ts:55`, `decide.ts:58` (text only: "How much of the allowance this call would spend", with the `requested` semantics left to slice 9, N-13) and `customerPlanView.ts:323`, `:419` are updated.

**i18n.**
- en: `'Ends on {date}, or when the credits run out, whichever comes first.'`
- es: `'Termina el {date}, o cuando se agoten los créditos, lo que ocurra primero.'`
- he: `'מסתיים ב־{date}, או כשייגמרו הקרדיטים, המוקדם מביניהם.'`

These are working wording. The final wording belongs to slices 6 and 7 (G-10, BD-15).

**Recorded admin bodies (V-12).** They are re-recorded with the same mechanism the originals were: take the route's actual JSON from `routes.test.ts` through a temporary `writeFileSync` in a scratch copy of the test, then delete the scratch file. They are never hand-edited. The diff is expected to be the rename, 500 → 19,750, `matrixVersion` 1 → 2, and label and display strings. Anything else is a stop.

---

## 4. The trial total (BD-16) and the merge gate

**One constant, in one place:**

```ts
// lib/business-os/entitlements/config/cohorts.ts
/**
 * Test Flight's one-off credit total — BD-16.
 * ⛔ PENDING THE USER. 250 is the old action-count placeholder, kept only so the
 * branch runs unchanged; it may not merge (AC-25 (c), SA C-5). The figure and its
 * reason go in docs/architecture/BUSINESS_OS_CREDIT_PRICING.md §7.
 */
const TRIAL_CREDIT_TOTAL = 250;
```

It is used once, as `{ total: TRIAL_CREDIT_TOTAL }`. The shape stays `total` and is never `perMonth` (SA BD-16 constraint 1, FR-18). Keeping 250 while the question is open means the branch changes nothing for a trial account (none exist today, V-17), and it is the one value the gate recognises.

**The gate: `lib/business-os/entitlements/__tests__/trialAllowance.invariant.test.ts` (new).** It resolves `COHORTS.trial.values['credits.allowance']` and asserts:

1. the shape is `{ total: n }`, never `perMonth` (constraint 1);
2. `n` is a whole number (constraint 2);
3. `n ≠ 250`, with the message "BD-16 not decided: the trial total is still the action-count placeholder" (AC-25 (c));
4. `n ≥ 1,000`, which comfortably exceeds a real setup: the worst measured setup month is ~347 credits and one image is ~250 (constraint 3, B-12). The floor is a Dev proposal and needs SA's confirmation (Q-1). Both of the user's options (~2,000 and ~9,200) pass it.

While BD-16 is open, `npm run test:bos-entitlements` therefore has **exactly one expected failure**, and the "Business OS entitlements invariants" CI job is red on the PR. That job is not a required check, so the gate also relies on three more layers:
- RM opens the PR as a **draft**, titled `[BLOCKED: BD-16]`.
- This workplan's Status line and §14 say so.
- T14 is the only task that can turn the gate green.

Once the user decides, assertions 1, 2 and 4 stay as a permanent B-12 guard. Assertion 3 stays too, and is harmless.

> **As built (2026-09-30):** the user decided BD-16 before implementation (2,000 credits, §15 UD-1), so the placeholder stage was skipped. `TRIAL_CREDIT_TOTAL = 2000` shipped directly, and `trialAllowance.invariant.test.ts` was written with assertions 1, 2 and 4 only (assertion 3 deleted per SA Q-1). No `[BLOCKED: BD-16]` draft is needed.

**When BD-16 lands (T14):**
- Set `TRIAL_CREDIT_TOTAL` to the user's figure and make the comment a pointer to the pricing doc's revision-log row.
- Add that row: date, figure, reason, data used.
- Update the pricing doc §1 and §8, the entitlements doc plan table, and the tierMatrix header row.
- Update `productionConfig.test.ts` to pin the figure.
- Re-run every gate.

---

## 5. Expected snapshot diff (C-2)

The command is `npm run entitlements:snapshot` (`scripts/write-entitlements-snapshot.ts`); the file is never hand-edited. The expected diff, which T10 replaces with the **actual** diff:

```diff
 {
-  "generated": "2026-09-29",
-  "matrixVersion": 1,
+  "generated": "<date of the run>",
+  "matrixVersion": 2,
   "tiers": {
     "basic": {
 …
       "chat.bulk": false,
-      "ai.actions": {
-        "perMonth": 500
+      "credits.allowance": {
+        "perMonth": 19750
       },
 …
     "pro": {
 …
       "chat.bulk": true,
-      "ai.actions": {
-        "perMonth": 2000
+      "credits.allowance": {
+        "perMonth": 32250
       },
```

What SA reads for: the old key gone from both tiers, the new key at 19,750 / 32,250, `matrixVersion: 2`, and nothing else moved. The snapshot holds no cohorts, so the trial and champion values are checked by `productionConfig.test.ts` and the new gate test, not here.

**Actual diff** (`npm run entitlements:snapshot`, 2026-09-30; `matrix version 2, 2 tier(s), 0 removal(s)`). It matches the expected diff exactly: nothing else moved.

```diff
@@ -1,6 +1,6 @@
 {
-  "generated": "2026-09-29",
-  "matrixVersion": 1,
+  "generated": "2026-09-30",
+  "matrixVersion": 2,
   "tiers": {
     "basic": {
       "crm.core": true,
@@ -28,8 +28,8 @@
       "chat.quotes": false,
       "chat.reporting": false,
       "chat.bulk": false,
-      "ai.actions": {
-        "perMonth": 500
+      "credits.allowance": {
+        "perMonth": 19750
       },
       "email.volume": {
         "ceilingPerMonth": 10000
@@ -80,8 +80,8 @@
       "chat.quotes": true,
       "chat.reporting": true,
       "chat.bulk": true,
-      "ai.actions": {
-        "perMonth": 2000
+      "credits.allowance": {
+        "perMonth": 32250
       },
       "email.volume": {
         "ceilingPerMonth": 10000
```

**Re-recorded admin bodies (Q-4).** Recorded through a scratch copy of `routes.test.ts` (`routes.record.scratch.test.ts`) whose two contract assertions were replaced by `writeFileSync(JSON.stringify(body, null, 2) + '\n')` (the originals' convention, verified byte-for-byte against `HEAD`); run with `-t "still matches"` (2 passed, 38 skipped); **the scratch file was deleted immediately and `git status` shows it gone** (condition b). `git diff --stat`: `recordedAccountBody.json` 3 lines changed, `recordedAccountBodyNoPlanRow.json` 2 lines changed. The whole diff (condition c):

| File | Changed lines |
|---|---|
| `recordedAccountBody.json` (a `basic` tier account) | `"ai.actions"` → `"credits.allowance"`; `value.perMonth` and the trace's `to.perMonth` 500 → 19750; `display` "500 per month" → "19,750 per month". Its `matrixVersion` **stays 1**: that field is the account's own `plan_version` from the plan row the test sets (`TIER_PLAN.plan_version: 1`), which is exactly SQ-19's "no plan row is re-stamped" |
| `recordedAccountBodyNoPlanRow.json` (no plan row) | `"matrixVersion": 1` → `2` (falls back to the current matrix); `"ai.actions"` → `"credits.allowance"` (value `{ perMonth: 0 }`, `display` "0 per month", unchanged) |

Nothing else changed.

---

## 6. What owners could see

Nothing is enforced, counted against, or refused. The resolver and the plan views are **not** mode-gated, so the copy and numbers below reach owners on deploy even though production runs `shadow`. SA ruled them acceptable as working copy (G-10). TL should still tell the user before the PR merges.

| Surface | Who | Before | After |
|---|---|---|---|
| **`/business-os/settings` → Plan** (included list, "AI assistant" heading) | Every Business OS owner. Today that is **8 accounts, all Founding Partner** (V-17) | "AI actions (2,000 per month)" (he "פעולות AI", es "Acciones de IA") | **"Credits (32,250 per month)"** (he "קרדיטים", es "Créditos"). "per month" stays English in every locale, as today |
| Same section, "Ends" sentence | Trial accounts only. **None exist today** | "Ends on {date}, or when the AI actions run out…" | "Ends on {date}, or when the credits run out…" (en / es / he) |
| Same section, included list | Trial accounts only (none) | "AI actions (250 in total)" | "Credits (*BD-16 figure* in total)" |
| Same section, "next plan up" | Trial accounts only (none). A champion has none, because it is on Autopilot's row | Unchanged logic. Unlike shapes (total vs perMonth) make no "more / less" claim (tested) | Same |
| **Public `/invite` page**, "what you are offered" | Anyone holding an invite link | e.g. a Founding Partner invite: "AI actions (2,000 per month)" | **"Credits (32,250 per month)"**. A trial invite shows the BD-16 total. **This number is shown to prospective customers** (R-7) |
| Credit usage card, credit diary | — | Not built (slices 6 / 7) | Not built. **Unchanged** |

Admin-only (not owners): the `/admin/business-os-tiers` plan cards show "Credits" with 19,750 / 32,250 / 32,250 / the trial total and **matrix version 2**. The account lookup lists "Credits". The `bos_credit_value_active` log line reports version 1, `derived`.

**As built, after the user's R-7 answer (option C, §15 UD-2).** The table above was the plan before R-7 was answered. What ships:

| Surface | Who | Before | After (as built) |
|---|---|---|---|
| `/business-os/settings` → Plan, included list ("AI assistant" row) | Every owner; today 8 Founding Partners | "AI actions (2,000 per month)" | **"Credits (included)"** — he "קרדיטים (כלול)", es "Créditos (incluido)". **No number** |
| Same, "Ends" sentence | Trial accounts (none today) | "…or when the AI actions run out…" | "…or when the credits run out…" (en / es / he). No number |
| Same, "next plan up" | Trial and Essentials accounts (none today); champions see none | Trial: "AI actions: 250 in total → 500 per month" (a change); Essentials: "500 per month becomes 2,000 per month" | **No credits line at all.** Both plans read "included", so no `changes` / `improves` line can carry a number. Essentials still sees what Autopilot adds (chat); a trial still sees the email-volume increase |
| Public `/invite` page | Anyone holding an invite link | "AI actions (2,000 per month)" | **"Credits (included)"** (the page's plan list is English, as before). **No number reaches a prospect** |
| Admin: `/admin/business-os-tiers` cards and account lookup | Admins | "AI actions" 500 / 2,000 / 2,000 / 250 | **"Credits" 19,750 / 32,250 / 32,250 / 2,000 in total**, matrix version 2 |

Implementation (T6c): `withCustomerDisplay` in `customerPlanView.ts` replaces the display of `credits.allowance` with a localised "included" on both customer builders (`buildCustomerPlanView`, both sides of the "next plan up" comparison, and `describePlanOffer`). The admin views never call it. Marked ⚠️ TEMPORARY in code with the slice 6 removal note.

---

## 7. Files to create / modify

**Config and module code (inside `lib/business-os/entitlements/`):**

| File | Action | Reason |
|---|---|---|
| `config/creditValue.ts` | modify | Append v1, correct the header (V-1) |
| `config/creditValue.history.json` | modify | Append v1 (AC-25 (a)) |
| `config/catalog.ts` | modify | Re-key, unit, labels, note (SQ-17) |
| `config/tierMatrix.ts` | modify | Values, `version: 2`, header and comments (SQ-19, V-7) |
| `config/cohorts.ts` | modify | Champion read, trial constant, comments (§4, V-8) |
| `types.ts`, `schema.ts` | modify | Unit `'credit' \| 'sms'`, comment `:55` |
| `decide.ts` | modify | Comment `:58` only |
| `customerPlanView.ts` | modify | New id, new i18n key, comments `:323`, `:419` |
| `planPresentation.ts` | modify | Parameter name and admin sentence |
| `adminPlansView.ts` | modify | Field `aiActions` → `credits` |

**Outside the module (not importers of it, V-15):**

| File | Action | Reason |
|---|---|---|
| `app/admin/business-os-tiers/types.ts` | modify | Wire field `credits` |
| `app/admin/business-os-tiers/components/PlanCard.tsx` | modify | Label "Credits", field, testid `plan-${id}-credits` (Q-3) |
| `lib/business-os/LanguageContext.tsx` | modify | Key rename plus text in en / es / he (3 lines) |

**Tests, fixtures and snapshot:**

| File | Action | Reason |
|---|---|---|
| `lib/business-os/entitlements/__tests__/`: `catalog.invariant`, `productionConfig`, `resolver`, `decide`, `entitlementService`, `customerPlanView`, `adminOps`, `notBuiltCannotBeAllocated`, `tierMatrix.invariant`, `tierMatrix.snapshot`, `adminPlansView`, `planCopy.i18n`, `creditValue` | modify | Rename; `productionConfig` version 2 and new values; `creditValue` gains a v1 block; `planCopy.i18n` new key |
| `lib/business-os/entitlements/__fixtures__/exampleTierMatrix.ts` | modify | Rename (typed on the catalog) |
| `lib/business-os/entitlements/__tests__/trialAllowance.invariant.test.ts` | **create** | The BD-16 gate plus the permanent B-12 guard (§4) |
| `lib/business-os/entitlements/__tests__/entitlements.snapshot.json` | regenerate | `npm run entitlements:snapshot` (§5) |
| `lib/business-os/llm/__tests__/chargeResolver.test.ts`, `aiChargeRecorder.test.ts`, `aiActionAudit.test.ts` | modify | C-4: pins → `currentCreditValue().version` (and `.status` at `:197`) |
| `app/admin/business-os-tiers/__tests__/page.render.test.tsx`, `payload.contract.test.tsx` | modify | Field, label, testid |
| `app/admin/business-os-tiers/__tests__/__fixtures__/recordedAccountBody.json`, `recordedAccountBodyNoPlanRow.json` | re-record | V-12 |
| `components/business-os/settings/__tests__/PlanSection.render.test.tsx` | modify | Mocked dictionary key and strings (V-11; not on SA's list, Q-7) |

**Docs and skill:**

| File | Action | Reason |
|---|---|---|
| `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md` | modify | Plan table, callouts, PLACEHOLDER paragraph, ops row, credit-value line `:231`, new Change History row (Q-5, Q-6) |
| `.claude/skills/business-os-entitlements/SKILL.md` | modify | `:35` "`chat.*` and `credits.allowance`" |
| `docs/architecture/BUSINESS_OS_CREDIT_PRICING.md` | modify (**P-1 / P-2 only**) | §4.7 caveat 2 "her" → "its"; §1 table and paragraph, §6.3 step 3, §8 SQ-17 / SQ-19 rows → the ruled id and version; a §7 revision-log row for the rename and matrix v2 (the trial row at T14); Change History row. The §3 "replaces" column stays as history |
| `docs/workplans/BUSINESS_OS_CREDIT_DEDUCTION_SLICE_5_WORKPLAN.md` | create | This plan |

**Not modified:** the requirement, `chargeResolver.ts`, any repository, any migration or SQL, `enforcementPoints.ts`, and historical workplans and requirements.

---

## 8. Estimate

| Work | Estimate |
|---|---|
| T1–T5: credit value v1, types / schema, catalog, tier matrix v2, cohorts and the BD-16 constant | 0.5 d |
| T6–T8: readers, admin card, i18n | 0.5 d |
| T9–T10: ~20 test / fixture files, C-4 pins, gate test, re-recording, snapshot | 0.5 d |
| T11–T12: entitlements doc, skill, pricing doc P-1 / P-2, full gates, `tsc` | 0.5 d |
| T14: BD-16 landing, once the user answers | ≤ 0.25 d |
| **Total** | **≈ 2 days** of work (SA's sizing), plus waiting on BD-16. One PR, no split |

---

## 9. Task list

- ✅ **T0** Branch `feature/business-os-credit-deduction-slice-5` confirmed (off `fe7f6410`). Baselines in V-18. SA review folded in; the user's decisions recorded in §15 before any code (UD-1 to UD-3).
- ✅ **T1** Credit value v1 appended to `creditValue.ts` and `creditValue.history.json`; header rewritten (G-8). `git diff` of both files is additions only for the entries. `creditValue.test.ts` gains a "version 1" block (3 tests). **Deviation:** the existing negative control "catches an edit to version 0" removed v0 with `slice(1)` and expected exactly `[0]`; with two entries the removal shifts v1 into position 0 so the result is `[0, 1]`. The assertion is now `toContain(0)` with a comment — the guard still proves a removed v0 is caught.
- ✅ **T2** `types.ts` / `schema.ts`: unit `'credit' | 'sms'`; `'ai_action'` unit removed; comment updated.
- ✅ **T3** `catalog.ts`: `'credits.allowance'` re-keyed in place, unit `'credit'`, labels Credits / קרדיטים / Créditos, new note, one-line pointers for G-10 and N-12. Category, audience, atLimit, sellable, lifecycle unchanged.
- ✅ **T4** `tierMatrix.ts`: 19,750 / 32,250, `version: 2` with the SQ-17 / SQ-19 comment, header table rebuilt (champion chat yes / 32,250 reads `pro`, trial 2,000 in total), cohort sentence corrected, "more credits", `removals` empty.
- ✅ **T5** `cohorts.ts`: champion reads `TIER_MATRIX.tiers[CHAMPION_BASE_TIER]['credits.allowance']` (no literal, G-7); `TRIAL_CREDIT_TOTAL = 2000` with a pointer comment (BD-16); PLACEHOLDER block reduced to `email.volume` FIRST PASS (OI-2); header corrected.
- ✅ **T6** Readers: `customerPlanView.ts` (new id, `plan.ends_on_or_credits`, comments incl. the stale "1,000 against 2,000" champion paragraph), `planPresentation.ts` (`allowanceValue`, "credits run out"), `adminPlansView.ts` (field `credits`), `decide.ts` comment (text only, N-13).
- ✅ **T6c (new, R-7 option C)** `withCustomerDisplay` in `customerPlanView.ts`: owners and invitees read "Credits (included)" / "קרדיטים (כלול)" / "Créditos (incluido)"; applied in `buildCustomerPlanView` (included list and both sides of the next-plan comparison) and `describePlanOffer`; admin views untouched. Marked ⚠️ TEMPORARY with a slice 6 pointer. Tests: new `creditsShownWithoutAmount.temporary.test.ts` (16), `inviteOffer.test.ts` +1, `PlanSection.render.test.tsx` +5. Three assertions in `customerPlanView.test.ts` and one in `PlanSection.render.test.tsx` changed for the rule, each marked "TEMPORARY (R-7 option C)" with the value slice 6 restores. **Slice 6 task (for its requirement / workplan): remove `withCustomerDisplay`, `SHOWN_WITHOUT_AMOUNT`, `INCLUDED_WITHOUT_AMOUNT` and their two call sites; delete `creditsShownWithoutAmount.temporary.test.ts` and the TEMPORARY test in `inviteOffer.test.ts`; restore the marked assertions and go back to `renderFor('trial')` in `PlanSection.render.test.tsx`.**
- ✅ **T7** Admin UI: `types.ts` field `credits`, `PlanCard.tsx` label "Credits", testid `plan-${id}-credits` (Q-3).
- ✅ **T8** `LanguageContext.tsx`: exactly 3 lines (`plan.ends_on_or_credits` en / es / he). The 9 `console.*` calls left for the separate chip (UD-3).
- ✅ **T9** Tests and fixtures: the ~20 files in §7 plus `trialAllowance.invariant.test.ts` (3 tests; assertion 3 never written, per Q-1 and UD-1). C-4: the five pins now read `currentCreditValue().version` (and `.usdPerCredit` / `.status` in the log test), plus an explicit "records version 1" test. `adminOps.test.ts` gains "refuses an override on the retired id `ai.actions`" through the production schema. `planCopy.i18n.test.ts` asserts the old key is gone from all three locales (Q-2).
- ✅ **T10** Snapshot regenerated and pasted (§5); admin bodies re-recorded per Q-4 and summarised (§5).
- ✅ **T11** Entitlements doc (plan table, cohort paragraph, "Champions are Autopilot", numbers callout + the temporary display note, PLACEHOLDER paragraph, ops rows per Q-6, credit-value line, one new Change History row). Skill line. Pricing doc: P-1, P-2 (§1, §6.3), §3 trial row, §7 two rows (slice 5 shipped; BD-16), §8 closed items + the temporary display row, Change History row.
- ✅ **T12** Gates — results in §10a below.
- ✅ **T13 (C-3)** Read-only recount, 2026-09-30 **10:09 UTC**, main checkout `.env.local`, GET with `Prefer: count=exact`, `Range: 0-0` (no writes):
  - `business_os_entitlement_overrides?capability=eq.ai.actions` → **0** (also 0 on `credits.allowance`, **0 rows in total**)
  - `business_os_entitlement_shadow_events?capability=eq.ai.actions` → **0**
  - `business_os_account_plans?tier=not.is.null` → **0** (8 plan rows in total)

  C-3 is met; nothing to convert.
- ✅ **T14 (BD-16)** Landed with the user's figure, 2,000 (UD-1): `TRIAL_CREDIT_TOTAL`, pricing doc §1 / §3 / §7 / §8, entitlements doc plan table, tierMatrix header, `productionConfig.test.ts` pin; gate test green.
- ⬜ **T15** Handover, uncommitted: SA code review → user diff view → QA → user approval → RM. No draft / `[BLOCKED]` title needed (BD-16 decided, C-3 = 0).

---

## 10. Test plan

| Check | Command / how | Pass criterion |
|---|---|---|
| Entitlements invariants (C-2) | `npm run test:bos-entitlements` | Green on the final diff. **Before T14: exactly one failure**, the BD-16 assertion in `trialAllowance.invariant.test.ts`; anything else red is a defect |
| Credit value append-only | `creditValue.test.ts` (in the above) | Snapshot equals history; v0 unedited; versions 0, 1; `matrixVersion` 1 → 2 ≤ `TIER_MATRIX.version` 2 |
| The charge path still records the current version | `npx jest lib/business-os/llm/__tests__/chargeResolver.test.ts aiChargeRecorder.test.ts aiActionAudit.test.ts` | Records `currentCreditValue().version` (= 1); credits unchanged (1 credit for $0.001: same value); log line shows v1 `derived` |
| Snapshot | `tierMatrix.snapshot.test.ts` plus the pasted diff (§5) | Green; SA's hand-read matches §5 |
| Champion parity | `productionConfig.test.ts`, `customerPlanView.test.ts` | Champion resolves to `pro`'s 32,250 with no literal (G-7) |
| Admin contract | `npx jest app/api/admin/business-os/entitlements/__tests__/routes.test.ts app/admin/business-os-tiers` | Route body deep-equals the re-recorded fixtures; card renders "Credits" |
| Owner copy | `planCopy.i18n.test.ts`, `PlanSection.render.test.tsx`, `npx jest app/invite` | New key present in three locales with `{date}`; renders |
| Registration rules | `enforcementPoints.test.ts`, `tierLiteral.forbidden.test.ts` (in the invariants run) | No new importer, no unregistered capability-id literal, no new tier literal outside `config/**` |
| BOS LLM typecheck | `npm run typecheck:bos-llm` | 0 new against baseline (V-18) |
| Literal gate | `npm run check:bos-llm-literals` | 0 violations |
| Whole-project types | `npx tsc --noEmit` against a baseline taken at T0 | No new error in any touched file |
| Lint | `npx eslint` over the changed files; `npm run lint:hooks` | Clean |
| Build | `next build` (CI placeholder env) | Exit 0 |
| Leftovers | `grep -rn "ai\.actions"` (T12) | Only docs history rows |

### 10a. Gate results (Dev, 2026-09-30, final diff)

| Check | Result |
|---|---|
| `npm run test:bos-entitlements` | **95 suites / 1,952 tests, all pass** (baseline 93 / 1,928; +2 suites: `trialAllowance.invariant`, `creditsShownWithoutAmount.temporary`) |
| `app/api/admin/business-os/entitlements/__tests__/routes.test.ts` (outside the invariants job — SA finding 2) | **40 / 40 pass**, against the re-recorded fixtures |
| Affected outside set: `chargeResolver`, `aiChargeRecorder`, `aiActionAudit`, `app/admin/business-os-tiers`, `PlanSection.render`, `app/invite`, `lib/business-os/invites` | **25 suites / 735 tests, all pass** (baseline set 13 / 374 did not include `lib/business-os/invites`) |
| Wider sweep `lib/business-os app/api/business-os app/api/admin/business-os app/admin app/business-os components/business-os` | 280 suites; 276 pass; **4 fail, none importing or naming anything this slice touches**: `tokenUsageRepository.contract` (arity pin, a known red on main), `callParams.boundary.step3` (chat/planner wire snapshot), `proposals-capability` ("declares every status the database allows"), `chat-v4/route.audit` (worker crash on an unhandled "profile read failed" rejection). Not re-run at baseline |
| `npm run typecheck:bos-llm` | 331 files, 28 errors, **0 new**, passed (the same "1 baseline entry is fixed" note as V-18, not ours) |
| `npm run check:bos-llm-literals` | 53 files, 2 exempt, **0 violations** |
| `npx tsc --noEmit` (whole project) | **0 new errors** against base `fe7f6410` (2,091 pre-existing, identical set; corrected per QA-1) |
| `npx eslint` on the 37 changed / new `.ts(x)` files | 0 errors, 3 warnings, all pre-existing (`LanguageContext.tsx` unused `currencyInitialized`; `customerPlanView.ts` unused `describePlanEnding` import; `chargeResolver.test.ts` `_ignored`) |
| `npm run lint:hooks` | clean |
| `next build` (`NODE_OPTIONS=--max-old-space-size=6144`, CI placeholder env from `build.yml`) | **exit 0** |
| Leftover greps over `lib app components scripts supabase .claude tests` | `ai\.actions`: only intentional history / refusal markers (tierMatrix version comment; `adminOps.test.ts` retired-id refusal; `customerPlanView.test.ts` history comment; `planCopy.i18n.test.ts` comment). `aiActions`: only `WorkflowValidator.ts` (V6, unrelated). `-ai` testids: none. `aiActionsValue`: none. `ends_on_or_actions`: only the absence assertion in `planCopy.i18n.test.ts`. `docs/architecture`: only "before" / "replaces" columns and history rows |

A happy path (champion resolves to 32,250; charge records v1) and failure paths (the gate test's placeholder refusal; a `perMonth` trial or a non-integer refused; an override on the old id refused by `adminOps` because it is no longer a catalog key, added to `adminOps.test.ts`) are all covered.

---

## 11. Guardrails and out of scope

G-1 to G-10 from the SA review apply verbatim. In particular:

- No change to `chargeResolver.ts`, the ledger, an RPC or a migration (G-1).
- v0 and $0.001 untouched (G-2).
- Nothing lowered, no `removals` entry (G-3).
- No markup on the charge (G-4).
- No enforcement and no new module importer (G-5).
- No lifecycle flip (G-6).
- No literal 32,250 outside `pro` (G-7).
- Rationale only in the pricing doc (G-8).
- Audit `entity_type 'ai_action'`, `AiActionType`, `runAiAction` and the V-19 list untouched (G-9).
- Working "Credits" wording only (G-10).

**Out of scope:** a neutral category heading (N-12, slice 6); the usage card and diary (slices 6 / 7); `decide()`'s `requested` semantics (N-13, slice 9); per-action caps (slice 12); the shadow report's `setupAi` counting actions (Q-6); the `describeCapabilityValue` English "per month" in he / es (pre-existing); editing the requirement.

---

## 12. Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | An override is set on `ai.actions` between SA's read and the merge, and becomes silently ignored under the new id | C-3 recount (T13), stop if non-zero |
| R-2 | The drift guard cannot see the rename | SA reads the pasted diff (§5); `productionConfig.test.ts` pins the values and the id list |
| R-3 | The placeholder trial total merges | Gate test red, draft `[BLOCKED: BD-16]`, Status line; T14 is the only way green |
| R-4 | A recorded admin fixture is hand-edited, and the contract test proves nothing | Re-record from the route (§3); SA / QA check the diff contains only the expected fields |
| R-5 | A string-keyed reader is missed (not type-checked) | The grep in T12, plus the full invariants and route suites |
| R-6 | `LanguageContext.tsx` (11k lines) conflicts with parallel branches | Edit 3 lines only; rebase before RM |
| R-7 | The public invite page shows 32,250 credits a month to prospective customers before slice 6 defines what a credit means to them | TL raises it with the user in the diff view (§6). Reverting is copy / config only |
| R-8 | Owners see a number jump from 2,000 to 32,250 with no explanation | Same as R-7; slice 6 owns the explanation. Nothing is enforced |

---

## 13. Open questions for SA

- **Q-1** The BD-16 gate (§4): is a red invariant test (one expected failure, not a required check) plus a draft PR the gate you want? Is the permanent floor **≥ 1,000** credits right for constraint 3, or would you set another?
- **Q-2** Renaming the key to `plan.ends_on_or_credits` (your preferred option): confirmed?
- **Q-3** Admin card testid `plan-${id}-ai` → `plan-${id}-credits`, alongside the ruled field rename. Fine, or should the testid stay?
- **Q-4** Re-recording the two admin bodies through a temporary scratch test that writes the route's JSON (deleted afterwards). Acceptable as "not hand-edited"?
- **Q-5** More stale text in `BUSINESS_OS_ENTITLEMENTS.md` beyond your list: the sentence that cohorts "point at the `basic` row", "Champions become Autopilot in one line" (already happened on 2026-09-27), the plan table's champion **Chat "no"**, and the Metering line `:231` "version 0, provisional". The plan is to correct them in this PR. Agree?
- **Q-6** The ops row "What does setup cost in AI actions?" points at the shadow report's `setupAi`, which genuinely counts **actions** (`report.ts:814-820`). The proposal is to keep that row's meaning and add a sibling row, "What does setup cost in credits? → the Costs & credits tab, by action type; pricing doc §4.6", rather than relabel a report that does not count credits. Agree?
- **Q-7** `PlanSection.render.test.tsx` mocks the dictionary and "AI actions (500 per month)". It is not on your list, and it only has to change because the key is renamed. Update its strings to the new copy as well?

---

## 14. Business question for the user

**BD-16 is the only one, and it is already with the BA.** How many credits does a free trial get in total: **about 2,000** (≈ $2 of our cost at most per trial, ~6× the worst setup measured) or **about 9,200** (a 14-day share of Essentials, ≈ $9.20 at most)? The slice is built, reviewed and tested around a placeholder, but **it cannot merge until this is answered.**

---

## 15. Flagged items (console.*, stale facts)

**`console.*`** (CLAUDE.md § Logging): every file this plan modifies was counted on 2026-09-30. All have **0**, except:

- **`lib/business-os/LanguageContext.tsx`: 9 calls** (`console.debug` ×5, `console.error` ×4, at `:11225-11361`). It is a `'use client'` file, and `lib/logger/client.ts` exists as the client-side Pino path. **Proposed:** convert all 9 to the client logger. This slice touches only 3 dictionary lines there, so the recommendation is a separate small chip unless the user wants it folded into this PR. **Awaiting the user's answer.** The same file also makes **direct Supabase calls from a client component** (`import { supabase } from '@/lib/supabaseClient'`, the language and currency sync), which runs against CLAUDE.md rule 1. It is flagged here only and not touched.
- `scripts/write-entitlements-snapshot.ts` uses `process.stdout.write`, not `console.*`, and is not modified.

**User decisions, 2026-09-30 (recorded by Dev before implementation; relayed by TL):**

| # | Decision | Effect on this slice |
|---|---|---|
| UD-1 | **BD-16: the trial (Test Flight) gets 2,000 credits in total**, one-off, not monthly (≈ $2 of provider cost at most per trial) | T14 lands now: `TRIAL_CREDIT_TOTAL = 2000`. The gate test's assertion 3 (`n ≠ 250`) is **deleted** per SA Q-1; assertions 1, 2 and 4 (floor ≥ 1,000) stay as the permanent B-12 guard. No `[BLOCKED: BD-16]` draft is needed |
| UD-2 | **R-7: option C.** Owners and invitees see **"Credits (included)"** without the number until slice 6; admin screens still show the figures | New task **T6c** (below). Implemented as one small, clearly temporary presentation rule in the module's customer plan view path, marked in code with a pointer to slice 6. Slice 6 must remove it (task note recorded in T6c) |
| UD-3 | **`LanguageContext.tsx` logging: a separate chip**, not folded into this PR | Only the 3 dictionary lines change in that file. The 9 `console.*` calls stay for the chip; the direct client Supabase call stays a separate backlog chip (SA finding 3). **Note (end of implementation):** that chip has since merged to `main` as PR #155 (`cb1e3283`), so this branch must be rebased before RM; the overlap is `LanguageContext.tsx` only (dictionary lines here, logging lines there) |

**Stale facts found:**
- S-1: the "AI action" wording in the Health tiles, leak-check labels and `balance.ts` is about AI actions, not the allowance, and correctly stays (V-19).
- S-2: the requirement's slice 5 guardrail "the `ai.actions` id is not renamed (SA-S11)" is superseded by SQ-17. The requirement is not edited by Dev.

**Deprecated systems:** none touched.

---

## SA Review Notes

### SA workplan review — slice 5 (2026-09-30)

**Reviewed by SA — 2026-09-30**, against the requirement's "SA review — slice 5 (2026-09-30)" (SQ-17, SQ-19, C-1 to C-5, G-1 to G-10, P-1, P-2, the stale-comment list) and the `business-os-entitlements` skill, with spot checks in this worktree at `fe7f6410`.
**Status:** ✅ **Approved with conditions.** Implementation (T1–T12) may start now. **Merge still waits on BD-16 (T14), the C-3 recount (T13), and the user's answer to R-7 below.** R-7 does not block starting: whichever option the user picks changes one small task (T6b below) and nothing else in the plan.

#### What SA checked and found correct

| Ruling / condition | In the plan | Verdict |
|---|---|---|
| SQ-17: `ai.actions` → `credits.allowance`, unit `'credit'`, `'ai_action'` unit removed, no alias, no `removals` entry | §2, §3, T2, T3, V-5, V-6 | ✅ Every reader SA listed is in §7, plus two SA missed (`PlanSection.render.test.tsx`, `payload.contract.test.tsx`). SA's own grep of `ai\.actions` / `aiActions` / `ends_on_or_actions` over `lib app components scripts supabase .claude tests` returns exactly §7's files plus one false positive (`WorkflowValidator.ts`, which matches `ai_actions` through the regex dot; not ours). Keep the T12 grep escaped as written |
| SQ-19: matrix v2, `removals` empty, credit value v1 `matrixVersion: 2` | §3, T1, T4, §5 | ✅ v1 object matches the ruled shape verbatim; v0 is append-only-checked by `git diff` and by `creditValue.test.ts` |
| C-1 one PR | §3 "Order", §8 | ✅ |
| C-2 invariants green, snapshot generated not hand-edited, diff pasted | §5, T10, §10 | ✅ Expected diff is right (in-place re-key keeps field order). `routes.test.ts` is outside `test:bos-entitlements` and is correctly listed separately (V-12) |
| C-3 recount before merge, stop if non-zero | T13 | ✅ The three counts are the right ones |
| C-4 version-0 pins | V-4, T9 | ✅ SA re-grepped: the five "current value" pins and the eight "arbitrary row data" sites match exactly. The added explicit "charge records version 1" assertion is welcome |
| C-5 merge after BD-16 | §4, T14, T15 | ✅ See Q-1 |
| G-1 to G-10 | §11 | ✅ G-9 list (V-19) checked: the Health tiles, `BusinessOsPanel` "failed AI actions", `costCopy.ts`, the leak-check labels and `report.ts` `setupAi` are the audit / charge vocabulary and stay |
| Stale-comment list | V-7, V-8, V-9, §7 | ✅ Every row of SA's table is mapped to a task. Q-5 adds more; accepted |
| P-1, P-2 | §7 pricing-doc row, T11 | ✅ Pricing doc edits limited to P-1 / P-2 plus the OI-9 revision-log and Change History rows |
| Registration rules (skill) | V-15 | ✅ No new importer from outside the module; `LanguageContext.tsx`, `PlanCard.tsx` and the admin `types.ts` do not import the module. If option B of R-7 is chosen, it lives inside the module (`customerPlanView.ts`) and still adds no importer |

#### Answers to Q-1 to Q-7

- **Q-1 — Approved, with one simplification.** One named constant (`TRIAL_CREDIT_TOTAL`), a red invariant test, a draft PR titled `[BLOCKED: BD-16]`, and the Status line are the gate SA wants. The entitlements invariants job is not a required check, so the draft title and T15 carry the weight; RM must not un-draft until T13 and T14 are ticked here. **The floor ≥ 1,000 is confirmed** as the permanent B-12 guard: about 3× the worst measured setup month (~347) and room for four generated images (~250 each); both of the user's options pass it. No upper bound (that is the user's pricing call, and constraint 4 says there is no ordering against Essentials). **Simplification:** assertion 3 (`n ≠ 250`) is already implied by the floor, since 250 < 1,000. Keep it until T14 because its message names BD-16, then **delete it at T14**: a permanent test naming a retired placeholder is noise. Assertions 1, 2 and 4 stay for good.
- **Q-2 — Confirmed:** `plan.ends_on_or_credits` in en / es / he, with `planCopy.i18n.test.ts`, `customerPlanView.test.ts` and `PlanSection.render.test.tsx` updated in the same change. The old key must not survive in any locale block (the i18n test should assert its absence).
- **Q-3 — Rename the testid** to `plan-${id}-credits`. A testid named after a field that no longer exists misleads the next reader; the only consumers are the tests in this PR.
- **Q-4 — Accepted as "not hand-edited"**, with three conditions: (a) the scratch test writes `JSON.stringify(body, null, 2)` plus the original file's trailing-newline convention, so the diff is confined to real changes; (b) the scratch file is deleted and `git status` shows it gone before the SA code review; (c) the pasted diff contains **only** the rename, 500 → 19,750, `matrixVersion` 1 → 2, and the label / display strings. Anything else stops the task, as the plan says. `accountLookup.contract.test.tsx` renders from the same fixture; it is covered by the `app/admin/business-os-tiers` directory run in §10, so no extra entry is needed.
- **Q-5 — Agree.** Correct all four in this PR (the "point at the `basic` row" sentence, "Champions become Autopilot in one line", champion Chat "no", Metering line "version 0, provisional"), and also the PLACEHOLDER paragraph's "Slice 3 sets them from the shadow report's setup-AI measurement". Earlier Change History rows are not edited; one new row records all of it.
- **Q-6 — Agree.** Keep the `setupAi` ops row (it really counts actions; relabelling it would make the doc lie). Add the separate "in credits" row that points at the Costs & credits tab and the pricing doc §4.6.
- **Q-7 — Yes.** Update the mocked dictionary key and the rendered strings to the new copy ("Credits (… per month)"). A render test that passes while asserting the old wording tests nothing.

#### Findings

1. **§4 / T14** — delete assertion 3 at T14 (Q-1). Priority: Low.
2. **§10 "Admin contract" row** — the `routes.test.ts` result (40 / 40 at baseline) must be reported next to the `test:bos-entitlements` result at T12, since CI does not run it through the invariants job. Priority: Medium.
3. **T8 / §15, `LanguageContext.tsx`** — **handling it as a separate chip is right**, on two conditions. The slice touches 3 dictionary lines in an ~11k-line shared file; converting its 9 `console.*` calls to the client logger is unrelated work and raises the conflict risk in R-6. But CLAUDE.md § Logging says a touched file may only stay non-compliant if the **user** declines or defers the conversion. So: (a) TL gets the user's answer ("separate chip" or "fold in") and records it in §15 **before the SA code review**, or the code review will mark it Fix Required; (b) if the user says "fold in", it goes in as a separate commit in this PR, not mixed with the dictionary edit. The **direct client Supabase call** (language / currency sync) is a rule 1 issue that cannot be fixed in a small edit: repositories are server-only, so it needs its own API route, and that is a design task. Flag-only is correct; TL should record it as its own backlog chip, separate from the logging chip.
4. **R-7 / R-8** — this is a real owner-visible and prospect-visible change, and it needs a **business decision from the user**, set out below. If the user picks option B, add **T6b** as described there. Priority: High for merge, not for starting.
5. **T12** — also grep for `-ai"` testid leftovers and for `aiActionsValue` (prop and parameter names in untyped test code are not always caught by the compiler). Priority: Low.

#### R-7 — the business question for the user (TL to ask, in these terms)

**What changes on screen.** Today every Business OS owner's Settings → Plan page lists "AI actions (2,000 per month)". After this slice it lists **"Credits (32,250 per month)"** (in Hebrew "קרדיטים", in Spanish "Créditos"). That is all 8 current accounts, all Founding Partners. The public invite page shows the same line to **people you invite who are not customers yet**. Nothing explains what a credit is until slice 6. Nothing is charged, counted or blocked either way.

| Option | What owners and invitees see | Cost | Risk |
|---|---|---|---|
| **A. Show it as planned** | "Credits (32,250 per month)" on Settings and the invite page | None | A large number in a new unit with no explanation. An invitee can quote it back later, and it is harder to change once prospects have seen it. Low reach: 8 friendly accounts, invite-only signup |
| **B. Hide the credits line from owners and invitees until slice 6** (admin screens still show it) | The line disappears from Settings → Plan and from the invite page; everything else is unchanged | About 2–3 hours: one temporary, named rule in the existing "what the customer is not told" check (`isHiddenFromCustomer`), plus tests that it is hidden on both owner surfaces and still shown to admins, and a note that slice 6 removes it | Owners lose a line they can see today (no one relies on it; nothing is enforced). The rule must be removed in slice 6, which gets a task for it. The same mechanism hid chat until 2026-09-27, so it is not a new pattern |
| **C. Show "Credits (included)" without the number** | The word "Credits" without a figure | About half a day: a customer-only display rule for one capability plus tests | Reads oddly ("included" with no amount), still introduces an undefined word, and adds a special case to the display code that slice 6 must unwind. The weakest option |

**SA recommendation: B.** The number is the first thing a prospective customer would hold you to, and slice 6 is where you decide how to explain credits. B keeps that decision open for a couple of hours of work and changes nothing for admins. If you are comfortable with 8 friendly accounts and your own invitees seeing the figure early, **A** is acceptable too: the audience is small and the change is config-only to reverse. **C is not recommended.**

**If B is chosen — T6b:** add a clause to `isHiddenFromCustomer` in `customerPlanView.ts` for `credits.allowance` only, with a one-line pointer comment ("until slice 6 explains credits to owners, BD-15"). Tests: hidden from `buildCustomerPlanView` (included and next-plan-up) and from `describePlanOffer`; still present in `adminPlansView` and the admin account route; `customerPlanView.noExclusions.test.ts` stays green. Add "remove the slice 5 credits suppression" to the slice 6 scope. The trial "Ends … or when the credits run out" sentence stays; it has no number and reaches no one today (0 trial accounts).

#### Approval

- [x] Workplan approved — implementation T1–T12 may start (plus T6b if the user picks B for R-7).
- [ ] SA code review (after T12, with the snapshot and admin-fixture diffs pasted, and the user's answers on R-7 and the `LanguageContext.tsx` logging chip recorded in §15).
- [ ] Merge: after T13 (C-3 = 0), T14 (BD-16), and R-7 answered.

### SA code review — slice 5 (2026-09-30)

**Code Review by SA — 2026-09-30**, on the uncommitted diff in `neuronforge-llm-deduction` (42 modified + 4 new files, off `fe7f6410`), against the workplan, the SA workplan review above, the requirement's "SA review — slice 5", and the `business-os-entitlements` skill review checklist.
**Status:** ✅ **Code Approved for QA**, with two docs-only conditions for merge (CR-1 and CR-2 below). There are no code fixes and nothing is Fix Required.

#### Gates re-run by SA (stub env `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9`, no DB writes)

| Check | Result |
|---|---|
| `npm run test:bos-entitlements` | **95 suites / 1,952 tests, all pass** (matches §10a) |
| `npx jest app/api/admin/business-os/entitlements/__tests__/routes.test.ts` | **40 / 40** against the re-recorded fixtures |
| Affected set: `chargeResolver`, `aiChargeRecorder`, `aiActionAudit`, `app/admin/business-os-tiers`, `PlanSection.render`, `app/invite`, `lib/business-os/invites` | **25 suites / 735 tests, all pass** |
| `npm run typecheck:bos-llm` | 331 files, 28 errors, **0 new**, passed |
| `npm run check:bos-llm-literals` | 53 files, 2 exempt, **0 violations** |
| The 4 wider-sweep reds (`tokenUsageRepository.contract`, `callParams.boundary.step3`, `proposals-capability`, `chat-v4/route.audit`) | **Unrelated, confirmed.** SA ran all four on a clean export of the base `fe7f6410`: they fail there in exactly the same way (4 suites, 3 failed / 44 passed tests), and the same on this branch |
| **Merge with current `main` (`f75e491d`, incl. #154 and #155)** | SA applied this diff to a scratch export of `origin/main` (no repository change). It **applies cleanly** with no textual conflict, `LanguageContext.tsx` included. On the merged tree: `test:bos-entitlements` **96 / 2,007 pass**; admin entitlements routes + `app/admin/business-os-tiers` + `components/business-os/settings` (incl. #154's `InviteFriendsSection`) + `app/invite` + `lib/business-os/invites` + `app/api/business-os/friend-invites` + `chargeResolver` **28 / 793 pass**. Scratch trees deleted |

#### What SA verified by hand

| Item | Verdict |
|---|---|
| Credit value v1 | ✅ Appended to `creditValue.ts` and `creditValue.history.json` exactly as ruled (`version: 1`, `0.001`, `derived`, `matrixVersion: 2`, `2026-09-30`, pointer-only derivation). **v0 is byte-identical in both files**: the diffs are pure additions after the v0 entry. Header rewritten (G-8) |
| Unit and id | ✅ Unit `'credit' \| 'sms'` in `types.ts` and `schema.ts`; the `'ai_action'` unit is gone. `credits.allowance` re-keyed in place in the catalog (category / audience / atLimit / lifecycle unchanged; N-12 note). A repo-wide grep for `ai\.actions`, `aiActions`, `ends_on_or_actions` and `-ai` testids returns only the intended history / refusal markers and the unrelated V6 `WorkflowValidator.ts` |
| Snapshot (C-2) — read by hand | ✅ `entitlements.snapshot.json` diff is exactly `generated`, `matrixVersion` 1 → 2, and the two in-place key renames at 500 → 19,750 and 2,000 → 32,250. Nothing else moved. `productionConfig.test.ts` independently pins the id list, the four values and version 2, which covers what the drift check cannot see |
| Tier matrix v2 | ✅ 19,750 / 32,250 (= fee × 50% ÷ 2 ÷ $0.001 for $79 / $129 — arithmetic checked). `removals` empty with the reason in the comment (a rename is not a removal). No literal 32,250 anywhere outside `pro` (G-7); champion reads `TIER_MATRIX.tiers[CHAMPION_BASE_TIER]['credits.allowance']` |
| Trial | ✅ `TRIAL_CREDIT_TOTAL = 2000`, used once as `{ total }`. `trialAllowance.invariant.test.ts` holds assertions 1, 2 and 4 (one-off total, integer, ≥ 1,000); assertion 3 correctly never written (Q-1, UD-1) |
| Admin card + i18n | ✅ Testid `plan-${id}-credits`, label "Credits", wire field `credits` in both `adminPlansView.ts` and `app/admin/business-os-tiers/types.ts`; the payload-contract field list updated. `plan.ends_on_or_credits` in en / es / he with `{date}`; the old key is gone from all three locales and `planCopy.i18n.test.ts` asserts its absence |
| C-4 pins | ✅ The five version-0 pins now read `currentCreditValue()`; the log assertion reads version, value and status; `chargeResolver.test.ts` has the explicit "records version 1" test. The new `currentCreditValue` imports in two `lib/business-os/llm/__tests__/` files are **tests**, which the skill exempts from registration |
| Re-recorded admin fixtures | ✅ Diff is only the rename, 500 → 19,750 (value, trace `to`, display) and, in the no-plan-row body, `matrixVersion` 1 → 2. **The tier-account body keeping `matrixVersion: 1` is correct**: the resolver reports `effectiveVersion`, i.e. the account's own `plan_version` from the plan row the test sets (`TIER_PLAN.plan_version: 1`), and uses the version only to grandfather `removals` newer than it. With no removals, a v1 account correctly resolves the v2 values (a raise), and no plan row is re-stamped (SQ-19). The no-plan-row body has no row, so it falls back to the current matrix (2) |
| Retired id at the boundary | ✅ `adminOps.test.ts` proves the production schema refuses an override on `ai.actions`. Also checked: a stored override on an unknown id is ignored by the resolver as `unknown_capability` (not a crash, not fail-closed), and the C-3 recount found 0 rows anyway |
| Option C rule (UD-2) | ✅ `withCustomerDisplay` is inside the module (no new importer), marked ⚠️ TEMPORARY with the slice 6 removal list, and applied at exactly three call sites: `buildCustomerPlanView` (included list), `buildUpgrade` (the next-plan side; the current side is already filtered through it), and `describePlanOffer`. Admin views (`adminPlansView`, the account route) never call it. No raw value leaks: the customer rows carry only `capability / label / category / display / granting / gateBuilt`, and `my-plan` is the only owner route that returns plan data. Tests cover both owner surfaces (every plan, three locales, the upgrade JSON), the invite offer, admins still seeing all four numbers, and "no other row is touched" |
| G-9 | ✅ Audit `entity_type 'ai_action'`, `AiActionType`, `runAiAction`, `report.ts` `setupAi` and the V-19 list are untouched |
| Registration (skill checklist) | ✅ No new outside importer (`LanguageContext.tsx`, `PlanCard.tsx` and the admin `types.ts` do not import the module); no new tier literal or unregistered capability-id literal outside `config/**`; snapshot generated, not hand-edited; nothing lowered or removed; invariants run and green |
| Logging | ✅ No `console.*` in any touched module or admin file. `LanguageContext.tsx` still has 9 here, but the user deferred it (UD-3) and it is **0 on `main` after #155**; the merge takes main's version of those lines (verified clean above) |
| Docs and skill | ✅ Entitlements doc (plan table, cohort paragraph, champions-are-Autopilot, numbers callout + temporary display note, PLACEHOLDER paragraph, the Q-6 sibling ops row, credit-value line, one new Change History row); skill line; pricing doc §1 / §3 / §6.3 / §7 / §8 with the P-1 caveat fix, revision-log rows and Change History row |

#### #154 / #155 semantic-conflict check

- **#154 (friend invites)**: champions issue Essentials invites whose public page is built by `describePlanOffer` → `inviteOffer`, so it gets "Credits (included)" automatically through this slice's rule, and SA's merged-tree run proves it. #154 names no capability id and asserts no allowance text. One doc-only overlap: #154's invite requirement (T-17) quotes the skill rule "paid tiers differ only by `chat.*` and `ai.actions`". It is a dated record, so it can stay as is, but the next BA edit of that requirement should say `credits.allowance`. **Not blocking.**
- **#155 (LanguageContext logging)**: different hunks from the three dictionary lines; clean merge.

#### Rulings on the Dev deviations

1. **`creditValue.test.ts` negative control changed to `toContain(0)`** (T1). **Accepted.** With two entries, dropping v0 shifts v1 into slot 0, so every later slot also reads as edited. What the guard has to prove is that a missing or edited v0 is caught, and `toContain(0)` still proves that. The edit case above it still uses the exact `toEqual([0])`.
2. **Assertions changed for the option C rule, each marked TEMPORARY** (T6c): three in `customerPlanView.test.ts` (trial `changes`, Essentials `improves` → `[]`, the included-list summary), the rank-threshold relaxation 2 → 1, the swap of the equality test's positive control to `email.volume`, and the one in `PlanSection.render.test.tsx`. **Accepted.** Each one states the value slice 6 restores. The relaxed threshold still fails if the comparison stops producing results (trial → Essentials still gives the email-volume improvement). The `email.volume` positive control is a better control anyway, because it does not depend on a display rule. **"Next plan up" hiding credits completely is acceptable while the rule is in place.** With both sides showing "included" there is no honest line to show: a "more credits" line without a number would repeat the problem the user chose C to avoid. It reaches no one today (0 Essentials and 0 trial accounts; champions get no next plan), and Essentials still sees chat, which is Autopilot's real difference. Slice 6 must restore it (CR-2).
3. **`PlanSection.render.test.tsx` uses a synthetic cross-unit `changes` line** (`renderTrialWithCrossUnitChange`, "Example allowance") instead of the real trial payload. **Accepted.** The real payload no longer has a cross-unit change, and the component's rendering of one (the separate list, the "different rather than larger" wording, which is SA R2-1 / QA accessibility behaviour) must stay tested. The fixture uses the server's shape and is marked for slice 6 to revert to `renderFor('trial')`.

#### Findings

| # | Where | Finding | Priority |
|---|---|---|---|
| CR-1 | `docs/architecture/BUSINESS_OS_CREDIT_PRICING.md`, this workplan | **Both are untracked new files**, not on `main`, and the code now points at the pricing doc (`tierMatrix.ts`, `cohorts.ts`, `creditValue.ts` v1 `derivation`, catalog note). **RM must `git add` both in this PR**, or the history entry points at a file that does not exist. Also: because the pricing doc is new in this PR, "P-1 / P-2 only" cannot be checked from a diff. SA read the doc's current state instead, and it is consistent with the code (§1 / §3 / §7 / §8) | **High for merge** (RM step), no code change |
| CR-2 | `docs/requirements/BUSINESS_OS_LLM_DEDUCTION_LAYER_REQUIREMENT.md` | The requirement (modified in this PR) still says the trial total is "**BD-16, pending the user**" (§13 BD-8 block, §12 note), does not record **R-7 option C**, and its slice 6 scope does not include **removing the temporary display rule**. At the moment that removal exists only as a note in T6c of this workplan. **BA to add in this PR, docs only:** BD-16 = 2,000 decided on 2026-09-30; R-7 → option C; and in slice 6 scope, "remove `withCustomerDisplay` / `SHOWN_WITHOUT_AMOUNT` / `INCLUDED_WITHOUT_AMOUNT`, delete `creditsShownWithoutAmount.temporary.test.ts` and the TEMPORARY `inviteOffer` test, and restore the TEMPORARY-marked assertions (T6c list)" | Medium — before merge |
| CR-3 | `lib/business-os/entitlements/__tests__/customerPlanView.test.ts:292` | A comment still says "The trial gives `{ total: 250 }` AI actions" in the present tense. The trial is now 2,000 credits. Rewording it as history ("gave") is enough. `customerPlanView.ts:155` ("a 2,000-action one-off trial") describes the inverted fixture and can stay | Low (optional) |
| CR-4 | Rebase / merge (RM) | The merge with `main` is clean (verified). After the merge, re-run `test:bos-entitlements` and the `routes.test.ts` suite on the merged branch. Both passed in SA's scratch merge, but the real merge is what ships | Low (routine) |

#### Optimisation suggestions

- None blocking. `withCustomerDisplay` is exported only so `planOfferView.ts` and the temporary test can use it. That is fine inside the module, and slice 6 deletes it.

#### Code Approved for QA: **Yes.** Merge after CR-1 (RM includes the two untracked docs) and CR-2 (BA requirement update); CR-3 optional.

---

## QA Testing Report

### QA report — slice 5 (2026-09-30)

**QA — 2026-09-30**, on the uncommitted diff in `neuronforge-llm-deduction` (off `fe7f6410`).
**Test mode:** full.
**Strategy used:** A (Jest unit, through the real resolver and config) + B (the admin entitlements route suite, stub Supabase) + D-by-proxy (jsdom renders of the real `PlanSection` and invite page, fed real payloads, in en / he / es), plus a base-vs-branch differential. Playwright is not installed, and no dev server was run against real credentials, per the brief.
**Focus:** schema, api, ui.
**Skipped:** a live browser pass (brief: no dev server with real creds) and any DB read (brief: never touch a real DB). The jsdom renders stand in for the browser pass.
**Input source:** TL prompt (items 1–6) and §10 / §10a.
**Environment:** Jest with `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9` and stub keys. `next build` ran with the CI placeholder env from `build.yml` and `--max-old-space-size=6144`. No database was contacted.

#### Verdict: ✅ PASS WITH NOTES. No bugs. One Low documentation inaccuracy in §10a (QA-1), and one pre-existing localisation gap on the invite page (QA-2). Neither blocks.

#### 1. Gates

| Check | Result |
|---|---|
| `npm run test:bos-entitlements` | **95 suites / 1,952 tests, all pass** |
| `npx jest app/api/admin/business-os/entitlements/__tests__/routes.test.ts` | **40 / 40 pass** |
| `npx jest lib/business-os/llm app/admin/business-os-tiers components/business-os/settings app/invite lib/business-os/invites` | 45 suites / 1,173 tests: **1,172 pass, 1 fails**. The failure is `callParams.boundary.step3` › chat/planner, one of the four known reds below (the whole `lib/business-os/llm` directory is wider than §10a's named set) |
| i18n: `planCopy.i18n.test.ts` + `lib/business-os/__tests__/userLanguage.test.ts` | **2 / 14 pass** (`planCopy.i18n` also runs inside the invariants job) |
| `npm run typecheck:bos-llm` | 331 files, 28 errors, **0 new**, passed (plus the same "1 baseline entry is fixed" note, `app/api/onboarding/build/route.ts`, not ours) |
| `npm run check:bos-llm-literals` | 53 files, 2 exempt, **0 violations** |
| `next build` (6 GB heap, CI placeholder env) | **exit 0**. Compiled successfully, 308 / 308 static pages. The log's "error" lines are runtime logs from the placeholder Supabase host during static generation, not build errors |
| `npx eslint` on the 37 changed / new `.ts(x)` files | 0 errors, 3 warnings, all pre-existing (the same three §10a lists) |
| Whole-project `npx tsc --noEmit` | **2,091 errors on the branch and 2,091 on base `fe7f6410`**. The two lists are identical by file and error code, except two TS2304 ↔ TS2552 ("did you mean") flips in untouched files (`app/(protected)/layout.tsx`, `lib/plugins/v2/registry.ts`), which is tsc's suggestion heuristic. **0 new.** None of the errors is in a slice-5 file, except the pre-existing duplicate-key errors in `LanguageContext.tsx`, and none of those is on the 3 changed lines (326 / 4063 / 9749). See QA-1 |
| **The 4 wider-sweep reds on `origin/main`** | Temp worktree at `origin/main` **`f75e491d`**, with a `node_modules` junction that was removed before the worktree. `tokenUsageRepository.contract` (arity pin), `callParams.boundary.step3` (chat/planner), `proposals-capability` ("declares every status the database allows") and `chat-v4/route.audit` ("Test suite failed to run") **fail on main exactly as on this branch**: 4 suites, 3 failed / 44 passed tests in both. Not caused by this slice. SA separately confirmed the same at base `fe7f6410` |

#### 2. Resolved plans (real resolver and config, temporary test, deleted)

| Case | Result |
|---|---|
| Essentials (`basic`) | `credits.allowance` = `{ perMonth: 19750 }` ✅ |
| Autopilot (`pro`) | `{ perMonth: 32250 }` ✅ |
| Founding Partner (`champion`) | basis `cohort: champion`, `{ perMonth: 32250 }` ✅. `COHORTS.champion.values['credits.allowance']` **is the same object** as `TIER_MATRIX.tiers.pro['credits.allowance']` (`toBe`), so the value is read, not copied (G-7) |
| Trial | `{ total: 2000 }`, with no `perMonth` key: one-off, not monthly ✅ |
| No plan row | basis `none`, anomaly `no_plan_row`, withheld `{ perMonth: 0 }`, `matrixVersion` 2 ✅ |
| `ai.actions` | Absent from the resolution values for null / blank / trial / champion / basic / pro, from `CAPABILITIES` and from the tier rows ✅ |
| Override on `ai.actions` | **Refused** by the production `adminOpSchema` (`add_override`), while the same op on `credits.allowance` parses ✅. A legacy stored override on `ai.actions` is **ignored** by the resolver as `unknown_capability`, and the champion's value stays 32,250 (no crash, not fail-closed) ✅ |
| **Base-vs-branch differential** (nothing else changed) | I dumped the full resolution (state, basis, anomaly, lifecycle, `matrixVersion`, every capability value) for 9 account shapes: no plan row, blank anomaly, active trial, ended trial, champion, and basic / pro at `plan_version` 1 and at 0. The dump ran at base `fe7f6410` and on the branch, with the old key normalised to the new one. **The only differences:** the credits values (trial 250 → 2,000, basic 500 → 19,750, pro / champion 2,000 → 32,250) and `matrixVersion` 1 → 2 on accounts with no stamped `plan_version`. No other capability, state, basis, lifecycle or anomaly moved. Accounts stamped `plan_version: 1` keep reporting `matrixVersion: 1` while receiving the raised values, which is correct under SQ-19 (no removals to grandfather) |

#### 3. Credit value and charge path (temporary test, deleted)

- `currentCreditValue()` is `{ version: 1, status: 'derived', usdPerCredit: 0.001, matrixVersion: 2, decidedOn: '2026-09-30' }`, and `matrixVersion === TIER_MATRIX.version` ✅.
- v0 deep-equals its original entry, and the history has 2 entries. `git diff` of `creditValue.ts` / `.history.json` shows additions only after v0, plus the rewritten header comment ✅.
- The real `resolveActionCharge` at costs $0.001, $0.0123, $2e-7, $0.5 and $1.23456789 stamps `creditValueVersion: 1` and gives **exactly** `round(cost ÷ v0.usdPerCredit, 6)`, so the credits match what v0 would have given ✅. The real `buildAiChargeRecord` for a $0.0042 chat turn records `creditValueVersion: 1, credits: 4.2` ✅. The `bos_credit_value_active` log line carries `version: 1, status: 'derived', usdPerCredit: 0.001` ✅.

#### 4. Owner and invitee display (option C), and admin figures

| Surface | How | Result |
|---|---|---|
| Settings → Plan, **data** | `buildCustomerPlanView` for trial / basic / pro / champion × en / he / es (12 cases) | The AI category contains **"Credits (included)" / "קרדיטים (כלול)" / "Créditos (incluido)"**. The credits feature value is the bare word, with **no digit anywhere in the AI category**. No 19,750 / 32,250 anywhere in the payload. "2,000" appears only as the trial's *email volume* ("2,000 per month (alerts, never blocks)"), never as credits ✅ |
| Settings → Plan, **rendered** | jsdom render of the real `PlanSection` with the **real `translations` dictionary** per locale, fed the real payload (12 cases) | The same strings appear in the DOM for each locale, and "AI actions" / "פעולות AI" / "Acciones de IA" appear nowhere ✅. The trial's "Ends" sentence renders as "Ends on October 14, 2026, or when the credits run out, whichever comes first." / "מסתיים ב־14 באוקטובר 2026, או כשייגמרו הקרדיטים, המוקדם מביניהם." / "Termina el 14 de octubre de 2026, o cuando se agoten los créditos, lo que ocurra primero.", with **no number** ✅. The payload key is `{ key: 'plan.ends_on_or_credits', date }` and nothing else |
| "Next plan up" | Trial → Essentials; Essentials → Autopilot | Trial: only `improves: email.volume` (2,000 → 10,000 emails), with **no credits line** in `adds` / `improves` / `changes`. Essentials: `adds` = the 9 chat features, **no credits line**. Champion and Autopilot have no next plan ✅ |
| Public invite offer, **data** | `describePlanOffer` for all 4 plans | AI category summary contains "Credits (included)", with no credits number ✅ |
| Public invite page, **rendered** | jsdom render of the real `/invite` page, invite language en / he / es × 4 plans (12 cases), offer from the real `describePlanOffer` | "Credits (included)" shown, with no 19,750 / 32,250 and no credits "2,000" ✅. In he / es invites the plan-list line is **English**; see QA-2 |
| Admin Tiers page | Real `buildAdminPlansView()` | `credits`: trial **"2,000 in total"**, champion **"32,250 per month"**, basic **"19,750 per month"**, pro **"32,250 per month"**; `matrixVersion` **2** ✅. `payload.contract.test.tsx` renders this real payload into every card (`plan-${id}-credits`), and it is green |
| Admin account lookup | Re-recorded route bodies, deep-equalled by `routes.test.ts` (40 / 40) | Tier account: `credits.allowance` 19,750, display "19,750 per month". No-plan-row account: `matrixVersion` 2 ✅. Fixture diff is only the rename, the numbers and `matrixVersion`, as §5 states |

#### 5. Rename completeness

`grep` over `lib app components scripts supabase .claude tests types hooks middleware.ts`:
- `ai\.actions`: `tierMatrix.ts:220` (the version comment), `adminOps.test.ts:539, :552` (the retired-id refusal), `customerPlanView.test.ts:108` (history comment), `planCopy.i18n.test.ts:89` (comment). All deliberate.
- `aiActions`: only `lib/agentkit/v6/compiler/validation/WorkflowValidator.ts:378-380` (V6, unrelated).
- `ends_on_or_actions`: only `planCopy.i18n.test.ts:91`, the absence assertion.
- `-ai` testids: **none**. `aiActionsValue`: **none**. Nothing in `supabase/`.
- The `'ai_action'` unit is gone (`types.ts:39` and `schema.ts:526` are now `'credit' | 'sms'`). The remaining `'ai_action'` hits are the audit `entity_type`, untouched per G-9.

This is exactly the leftover list in §10a.

#### 6. Docs

- `BUSINESS_OS_CREDIT_PRICING.md` §7 revision log has the row **"Shipped in slice 5"** (rename, matrix v2, credit value v1, 19,750 / 32,250, champion reads Autopilot) and the row **"Trial (Test Flight) one-off total: 2,000 credits (user, BD-16)"**. §1, §3 and §8 agree, and the Change History has the "Slice 5 shipped; BD-16 decided" row ✅.
- `BUSINESS_OS_ENTITLEMENTS.md` plan table: trial **2,000 (one-off total)**, champion **yes (reads `pro`) / 32,250 / month (reads `pro`)**, basic **19,750 / month**, pro **32,250 / month**. It also has the temporary "Credits (included)" callout, the credit-value line at version 1 `derived`, and a new Change History row ✅.
- Both docs carry `Last Updated: 2026-09-30`. The pricing doc is untracked, which is SA's CR-1: RM must `git add` it.

#### Test Coverage

| Acceptance criterion / check | Tested? | Result | Notes |
|---|---|---|---|
| AC-25 (a) credit value v1 appended, v0 unchanged | ✅ | Pass | §3 above; `creditValue.test.ts` |
| FR-3 new charges record the current version | ✅ | Pass | Real `buildAiChargeRecord` → version 1, same credits |
| D1–D3 allowances (19,750 / 32,250; champion inherits) | ✅ | Pass | Real resolver, differential against base |
| BD-16 trial 2,000 one-off (FR-18) | ✅ | Pass | `{ total: 2000 }`, no `perMonth`; `trialAllowance.invariant` green |
| SQ-17 rename, old id refused | ✅ | Pass | Schema refuses; resolver ignores a legacy row as `unknown_capability` |
| SQ-19 matrix v2, no removals, no re-stamp | ✅ | Pass | Snapshot, differential, recorded fixtures |
| UD-2 / R-7 option C (owners and invitees: no number) | ✅ | Pass | 24 jsdom renders + 16 data cases, all 3 locales |
| Admins see the figures and matrix v2 | ✅ | Pass | Real admin payload plus the contract render |
| G-1 no charge-path / DB / migration change | ✅ | Pass | No `chargeResolver.ts`, repository, SQL or migration in the diff |
| Registration rules / invariants | ✅ | Pass | `test:bos-entitlements` green |
| Build / typecheck / literals | ✅ | Pass | See QA-1 on the wording of the whole-project tsc line |

#### Issues found

**Bugs (must fix before commit):** none.

**Performance issues:** none. This slice is configuration only, and the display rule is an O(n) map over about 30 rows.

**Documentation / edge cases (nice to fix):**

1. **QA-1: §10a says whole-project `npx tsc --noEmit` has "0 errors"; it has 2,091, all pre-existing** (the same set at base `fe7f6410`, so **0 new**). The same "tsc 0" appears in the Dev Change History row. This is a wording fix, not a code fix: say "0 new against base (2,091 pre-existing)". Low.
2. **QA-2 (pre-existing, not introduced here): the invite page's plan list is English in every invite language.** `describePlanOffer` calls `describePlanCapabilities` and `withCustomerDisplay` without a locale, so a Hebrew or Spanish invitee reads "Credits (included)" in English, as they already read every other plan-list item ("Contacts, pipeline and tasks", and so on). §6 already states "the page's plan list is English, as before". The headings are localised and the Settings page is fully localised. Worth a slice 6 / invite backlog note: once slice 6 writes the owner-facing credits wording, the invite line should follow the invite's language. Low.
3. **Observation, no action:** an account whose plan row is stamped `plan_version: 1` reports `matrixVersion: 1` while it resolves the v2 (raised) values. This is by design (SQ-19, SA code review) and today affects 0 accounts (C-3: 0 tier rows).

#### Hygiene

- Temporary files created and **deleted**: `lib/business-os/entitlements/__tests__/qaS5.temporary.test.ts`, `lib/business-os/llm/__tests__/qaS5Charge.temporary.test.ts`, `components/business-os/settings/__tests__/qaS5Render.temporary.test.tsx`, `app/invite/__tests__/qaS5Invite.temporary.test.tsx`, and a dump test copied into both trees and removed after each run.
- Temp worktrees `qa-s5-main` (`origin/main` `f75e491d`) and `qa-s5-base` (`fe7f6410`, used twice) were **removed**. Each time the `node_modules` junction was deleted first, and the shared `neuronforge/node_modules` was intact afterwards (841 entries). `git worktree list` shows no `qa-s5*`.
- **No code changed during the QA run.** The SHA-256 of `git diff` for everything outside `docs/` and `*.md` was `f407371ff761500da449154c75558402d5580353e697b13ecaef26ce5869b231` before and after. `git status --short` shows the same 42 modified + 4 untracked files as at the start. The only other file modified during the run was `docs/requirements/BUSINESS_OS_LLM_DEDUCTION_LAYER_REQUIREMENT.md` (13:49, SA / BA working in parallel on CR-2), which QA did not touch. QA edited only this section and one Change History row.
- No database was contacted. No commit was made.

#### Final Status

- [x] All acceptance criteria pass: ready for commit from QA's side, subject to SA's CR-1 (RM adds the two untracked docs) and CR-2 (BA requirement update), plus QA-1's wording fix.
- [ ] Issues found: Dev must address before commit. *(None of the findings is a code defect.)*

---

## Commit Info

*(RM to populate.)*

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-09-30 | Workplan created (Dev) | Slice 5 as one PR, no migration, ≈ 2 days plus the BD-16 wait. Credit value v1 appended ($0.001, `derived`, `matrixVersion: 2`); tier matrix v2 with `ai.actions` → `credits.allowance` (unit `'credit'`, working "Credits" labels) at 19,750 / 32,250, champion reading `pro`; the trial total a single BD-16 placeholder constant behind a red gate test and a draft PR; readers, admin card, `plan.ends_on_or_credits` in three locales; C-4 version pins; snapshot and admin recordings regenerated; entitlements doc, skill, pricing doc P-1 / P-2. Verification log V-1 to V-19 and baselines (entitlements 93 / 1,928, affected 13 / 374, routes 40 / 40, typecheck 0 new, literals 0). Owner-visible copy on `/business-os/settings` Plan and the public `/invite` page stated in §6. Open for SA: Q-1 to Q-7. `LanguageContext.tsx` flagged (9 `console.*`) |
| 2026-09-30 | SA workplan review — slice 5: APPROVED WITH CONDITIONS | New subsection "SA workplan review — slice 5 (2026-09-30)" under SA Review Notes. SQ-17, SQ-19, C-1 to C-5, G-1 to G-10, P-1, P-2 and the stale-comment list all mapped to tasks; SA re-grepped the old id and the C-4 pins, both match. Q-1 gate approved, floor ≥ 1,000 confirmed, assertion 3 deleted at T14; Q-2 new key confirmed; Q-3 testid renamed; Q-4 re-recording accepted with three conditions; Q-5, Q-6, Q-7 agreed. `LanguageContext.tsx`: separate chip is right, but the user's answer must be in §15 before code review; the client Supabase call is its own backlog chip. R-7 put to the user as a business question with options A (show), B (hide from owners and invitees until slice 6; SA recommends), C (no number; not recommended), and optional task T6b. Implementation may start; merge waits on T13, T14 (BD-16) and R-7 |
| 2026-09-30 | Implementation (Dev): T0–T14 done, uncommitted | User decisions recorded first (§15 UD-1 BD-16 = 2,000; UD-2 R-7 option C; UD-3 logging chip separate). Credit value v1, `credits.allowance` (unit `credit`), matrix v2 at 19,750 / 32,250, champion reads `pro`, trial 2,000; readers, admin card (`plan-${id}-credits`), `plan.ends_on_or_credits` in three locales; new T6c temporary "Credits (included)" rule for owners and invitees (admins keep numbers); C-4 pins; snapshot and admin recordings regenerated (diffs in §5); entitlements doc, skill, pricing doc. T13 recount 0 / 0 / 0 at 10:09 UTC. Gates in §10a: invariants 95 / 1,952, routes 40 / 40, affected 25 / 735, typecheck 0 new, literals 0, tsc 0, build exit 0. Main has moved (#154, #155): rebase before RM |
| 2026-09-30 | SA code review — slice 5: CODE APPROVED FOR QA | New subsection "SA code review — slice 5 (2026-09-30)". SA re-ran the gates (invariants 95 / 1,952; routes 40 / 40; affected 25 / 735; typecheck 0 new; literals 0) and applied the diff to a scratch export of `main` `f75e491d`: clean, merged-tree runs 96 / 2,007 and 28 / 793. The 4 wider-sweep reds fail identically at base `fe7f6410`. Hand-read: v0 byte-identical, snapshot diff exact, fixtures only rename / numbers / matrixVersion (tier body at plan_version 1 correct), option C rule confined to customer paths, G-9 intact, no new importer. Dev deviations 1–3 accepted. Findings: CR-1 RM must add the untracked pricing doc and workplan (High for merge); CR-2 BA records BD-16 = 2,000, R-7 option C and the slice 6 removal task in the requirement (Medium, before merge); CR-3 stale test comment (Low); CR-4 re-run gates after the real merge (Low) |
| 2026-09-30 | QA report — slice 5: PASS WITH NOTES | New subsection "QA report — slice 5 (2026-09-30)" under QA Testing Report. Gates: invariants 95 / 1,952; routes 40 / 40; the `lib/business-os/llm` + admin tiers + settings + invite + invites set 1,172 / 1,173 (the 1 red is the known `callParams.boundary.step3`); i18n 14 / 14; typecheck-bos-llm 0 new; literals 0; `next build` exit 0; eslint 0 errors. The 4 wider-sweep reds fail identically on `origin/main` `f75e491d`. Real-resolver checks: 19,750 / 32,250 / champion 32,250 (same object as `pro`) / trial `{ total: 2000 }`; no plan row unchanged; `ai.actions` gone, override refused, legacy row ignored. Base-vs-branch differential over 9 account shapes: only the credits values and `matrixVersion` moved. Credit value v1 derived, v0 intact, charges stamp v1 with v0-identical credits. Option C confirmed by 24 jsdom renders (Settings and `/invite`, en / he / es, real dictionary) with no credits number; admin still sees 19,750 / 32,250 / 32,250 / 2,000 and matrix v2. Rename leftovers match §10a; docs correct. Findings: QA-1 §10a "tsc 0 errors" is really 2,091 pre-existing / 0 new (Low, wording); QA-2 invite plan list English in every invite language, pre-existing (Low). No code changed during the run (diff hash identical); temp tests and worktrees deleted |
| 2026-09-30 | QA-1 wording, CR-3 comment, QA-2 noted (TL) | §10a whole-project tsc now reads "0 new (2,091 pre-existing)"; `customerPlanView.test.ts` trial comment reworded as history (CR-3); QA-2 (invite plan list is English in every invite language, pre-existing) carried to slice 6 as a note |
