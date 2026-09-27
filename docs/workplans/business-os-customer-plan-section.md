# Workplan: Business OS customer "Your plan" section — S-4a step 1

> **Last Updated**: 2026-09-27

## Overview

A read-only "Your plan" section in the **customer's** Business OS settings: what plan they are on, what it includes, what the next plan up would add. First step of S-4a in [BUSINESS_OS_TIER_BILLING_REUSE_PLAN.md](/docs/requirements/BUSINESS_OS_TIER_BILLING_REUSE_PLAN.md) §6.5 (WS-2), and the **first entitlement data a non-admin can see**.

Built on the short path for UI work (user → Dev → SA review + QA in parallel → user diff → RM), so there is no Dev workplan; this document is the SA review record for the slice.

**Branch:** `feature/business-os-customer-plan-section` from `origin/main` `609635ff`. Dev created it on TL's instruction and flagged the deviation rather than leaving it implicit.

## Table of Contents

- [1. What was built](#1-what-was-built)
- [2. SA Review Notes](#2-sa-review-notes)
- [3. QA Testing Report](#3-qa-testing-report)
- [Change History](#change-history)

---

## 1. What was built

| Path | Role |
|---|---|
| `app/api/business-os/entitlements/my-plan/route.ts` | GET only. No input of any kind; resolves the session account |
| `components/business-os/settings/PlanSection.tsx` | Client section, wired into `app/business-os/settings/page.tsx` |
| `lib/business-os/entitlements/customerPlanView.ts` | `server-only` payload builder |
| `lib/business-os/entitlements/planPresentation.ts` | **New shared module** — presentation logic used by both the admin and customer surfaces |
| `lib/business-os/entitlements/adminPlansView.ts` | Now imports the shared module; 126 lines net smaller |

---

## 2. SA Review Notes

**Reviewed by SA — 2026-09-27** (implementation uncommitted; base `609635ff`)
**Status:** 🔄 **APPROVED FOR QA WITH TWO REQUIRED FIXES** (**P-1, P-2**) and four low. Nothing found that misleads a customer or leaks data today.

**What SA ran:** the ten affected suites — **167 tests, 0 failures** (the admin Tiers suites among them).

### 2.1 The extraction — verified by reading, not by the test count

This was the expensive failure to look for: the admin screen is merged and in use, and a "behaviour-preserving" refactor that quietly changed what it says would not necessarily be caught by tests written against the old behaviour's *shape*.

**First correction to the framing:** only **one** of the six functions existed under that name before (`previewAccountFor`). `describeEnding` was renamed; the other four (`planLabel`, `planMonthlyPriceUsd`, `planInheritsFrom`, `describePlanCapabilities`) were **inline inside `buildAdminPlansView`**. So this is not "six functions moved" — it is one move, one rename, and four extractions-with-naming, which is a higher-risk operation than the summary suggests. I compared each against the old source rather than trusting the green suite.

| Function | Verdict |
|---|---|
| `previewAccountFor` | ✅ **Byte-identical** apart from the file it lives in. |
| `describeEnding` → `describePlanEnding` | ✅ **Byte-identical** apart from the name, the `export`, and one line-wrap. |
| `describePlanCapabilities` | ✅ Field-for-field identical to the old inline `.map`, including the `gateBuilt` rule and its comment. |
| `planMonthlyPriceUsd` | ✅ Identical (`presentation?.monthlyPriceUsd ?? 0`, tier-gated). |
| `planInheritsFrom` | ✅ Identical result, and **clearer**: the old code reached `null` for a tier because `cohort` was `undefined`; the new code returns `null` explicitly. |
| `planLabel` | ✅ Identical **in every state the loader permits** — see the note below. |

**The one place the extraction became laxer.** The old inline code computed `const cohort = isTier ? undefined : config.cohorts[planId]`. `planLabel` drops the `isTier` guard and reads `config.cohorts[planId]` unconditionally, so its fallback chain is `presentation?.labels ?? cohort?.labels ?? planId`. That is identical today because tier ids and cohort ids are disjoint **and** because the loader rejects a tier with no `presentation` entry, which makes the cohort branch unreachable for a tier. So correctness now rests on an invariant enforced in another file, where it used to rest on a guard two lines above. **P-3 (low):** restore the `isTier` check inside `planLabel` — one line, and the property becomes locally obvious again instead of depending on a rule the reader has to go and find.

**Conclusion: the extraction is behaviour-preserving for the admin screen**, and I am satisfied on the evidence rather than on the test count.

### 2.2 Tenant isolation — the ruling

**Dev's reasoning stands, and I accept the absence of Zod.** CLAUDE.md rule 2 validates *inputs*; this handler has none — no path parameter, no query, no body — and the account comes from `getUser()`. A schema over nothing would assert nothing about the property that matters. More than that, the property is **stronger** than validation: validation constrains what a caller may say, whereas having no parameter means **no caller can name another account at all.** That is the structural form of what `tenant-isolation-guard` is for, and the guard's own premise is that a comparison can be defeated by a later refactor while an absent parameter cannot.

I accepted it on two conditions, and both are met:

1. **The guard must fail if input is ever added**, or the argument decays the first time someone writes `?accountId=`. It does: the suite asserts the source contains no `searchParams`, **plus** a comment-stripper non-vacuity test so the assertion cannot pass by reading a comment, **plus** behavioural tests that the session account wins whatever the URL or the body says. Three angles, one of them structural.
2. **`requireAdmin`'s absence is deliberate and recorded** — `it('does not require an admin — this is a customer route')`. That is the right way to pin an intentional omission: a later "harden every route" sweep will break a test that explains itself, rather than silently breaking the feature.

**P-1 (required) — the account seam is bypassed, and this is the second time.** The route calls `getEntitlementService().getSnapshot(user.id)` directly. `resolveAccountId` is the single seam that maps an acting user to an account (T-2), and `AccountId` is a `string` alias so the compiler cannot see the difference. **This is the same finding I made in §13.7 (R4-2) against `shadow.ts`, which was fixed there** — so the fix did not generalise, and it has now reappeared on a **customer-facing** read. Nothing misbehaves today, because the seam is the identity function. It misbehaves the day seats or organisations arrive, and the symptom would be a customer shown another account's plan.

Because it is a repeat, the fix is the mechanism and not just the call: route this read through `resolveAccountId(user.id)`, **and** extend `accountSeam.guard.test.ts` so that every caller of `getSnapshot`/`check` outside the entitlements module must pass through the seam. That turns "we remembered" into "it cannot be forgotten", which is the only version that holds.

### 2.3 The downgrade defect — fixed, and the same shape survives one layer down

**The fix is right.** `comparableAmount` ranks numerically, returns `null` for anything unrankable (variants, add-on states), and the loop skips unless `nextAmount > mineAmount`; the section hides itself when nothing remains. Deciding from the two **resolutions** rather than from a field on the shared row is also right — it keeps a customer-side comparison from reshaping the payload the admin screen renders.

**General form, for plan shapes that do not exist yet:** booleans rank 0/1; metered, quantity and fair-use rank on the first numeric key; mixed shapes (`{ included: 1, purchasable: false }`) rank on `included` and ignore the rest, which yields silence rather than a wrong claim. All conservative, all correct in direction.

**P-2 (required, small) — it compares magnitudes across different periods.** `comparableAmount` treats `{ total: 250 }` and `{ perMonth: 500 }` as 250 and 500 and calls the second an improvement. That happens to be true today (a recurring 500 does beat a one-off 250), but it is true **by luck, not by the comparison**: the function compared a one-off allowance with a monthly rate as if they were the same unit. Invert the numbers — a trial with `{ total: 5000 }` against a plan with `{ perMonth: 500 }` — and it suppresses a real upgrade or, with the operands the other way round, announces a reduction as a step up. **That is precisely the defect Dev just fixed, surviving one level deeper.** Fix: return `null` when the two values' numeric keys differ, so unlike units produce silence. One line, and the screen's whole promise — no shocks — is then structural rather than arithmetical coincidence.

### 2.4 Chat suppression — "say nothing" is the right shape

**Endorsed, and the audience split is the reason.** The alternative — annotating "included but not enforced yet" — puts a sentence on a **customer's** screen that only parses if you know our roadmap, and it invites the one question whose honest answer is unpublishable ("yes, and we may stop you later"). Silence promises nothing in either direction. The internal truth belongs on the admin screen, and §13.11 R-1 already put it there. Customer: nothing. Admin: "withheld in config, gate unbuilt." Correct by audience.

**Filtering by capability id prefix rather than category is right, and the reason is exact:** `ai.actions` sits in the `ai_chat` category and is the number a customer most wants to read. A category filter would have hidden their allowance. Omitting the withheld list from the payload entirely (rather than filtering at render) is the stronger version — there is nothing to leak through a later UI change.

**The header's instruction — delete this file in the same commit as FR-46's gate — is the right mechanism.** A test that pins a temporary state should die with the state, and tying its death to a specific diff beats a comment that ages. **P-4 (low):** the instruction is discoverable only by someone already reading that file, and the person shipping FR-46 will be reading FR-46's entry. Put the reciprocal pointer there.

### 2.5 The two guards

Both handled the way I would have asked.

**`KNOWN_NON_GATE_IMPORTER` with a symbol allow-list** — correct, and the valuable part is the written condition: it distinguishes `getSnapshot` (reports every capability: a read) from `check()` (refuses: a gate) and states that calling `check` moves the file into `ENFORCEMENT_POINTS`. An exemption with its condition beside it is auditable; a bare exemption is not.

**FR-12 widened by two `__tests__` directories rather than using the baseline** — the right choice. The baseline exists for **unrelated pre-existing** occurrences; routing a deliberate new test through it would launder a new fact into a mechanism meant for legacy noise. And the justification is checkable, so I checked it: the four **product** files behind this surface (`customerPlanView.ts`, `planPresentation.ts`, `PlanSection.tsx`, the route) contain **zero** tier ids between them. The guard's real target is intact.

### 2.6 Localisation

**Acceptable for this step, with the reason recorded rather than the gap papered over.** The sentences are derived from config **server-side**, which is what makes them single-sourced and honest; localising them means either shipping keys through the payload or moving sentence-building into the component, and the second re-introduces exactly the drift the server-side derivation exists to prevent. Matching the newer sibling sections is a fair consistency argument for one read-only step.

**P-5 (low), and it is a line rather than a preference:** when localisation comes, send **structured facts plus a key**, not a finished sentence — and it must not survive into the **buy** step. A customer being asked to pay should not be reading English in the middle of a Hebrew screen.

One boundary note: `PlanSection.tsx` imports `@/lib/business-os/LanguageContext` and `@/lib/logger`, where the admin Tiers page's guard forbids **any** `@/lib/` import. That is a deliberate divergence, not a defect — the admin rule exists to stop that page re-deriving config, and neither of these does — but it means the two screens are held to different rules, which is worth knowing before someone "aligns" them. The client-safety of `createLogger` is covered by the PR's `Build (next build)` check, which must be green.

### 2.7 Required and low fixes

| # | Fix | Priority |
|---|---|---|
| **P-1** | Route the customer read through `resolveAccountId`, **and** extend `accountSeam.guard.test.ts` so every external caller of `getSnapshot`/`check` must. Second occurrence of §13.7 R4-2 — fix the mechanism, not the call. | **Required** |
| **P-2** | `comparableAmount` must return `null` when the two values' numeric keys differ, so a one-off total is never ranked against a monthly rate. | **Required** |
| P-3 | Restore the `isTier` guard inside `planLabel`. | Low |
| P-4 | Put the reciprocal "delete the chat test" pointer in FR-46's entry. | Low |
| P-5 | Record that localisation must send facts + keys, and must land before the buy step. | Low |

### 2.8 For the user

1. **This is the first thing in Business OS a customer can see about their plan, and it cannot be asked about anyone else's.** The endpoint takes no input at all — there is no field in which to name another account — which is a stronger protection than checking an id, and there is a test that fails the day anyone adds one.
2. **Dev found and fixed the defect that mattered.** The screen was offering a Founding Partner an "upgrade" to Essentials whose headline was that their AI allowance would **drop** from 1,000 to 500 a month — a downgrade presented as the next step up, on the one screen whose purpose is that changing plan is not a shock. It now compares numbers rather than sentences and stays silent when there is nothing genuinely better to offer. I found the same mistake surviving one level down (comparing a one-off allowance against a monthly one as if they were the same thing); it happens to read correctly today, and I have asked for it to be made correct by construction.
3. **The screen says nothing about chat, deliberately.** The plans withhold it but nothing in the product stops it yet, so saying either "you have it" or "you don't" would be untrue. Silence is the only honest option until that gate is built; the admin screen carries the internal version.
4. **It is in English inside a right-to-left layout.** Fine for a read-only section that matches its neighbours — not fine on the screen that asks for money. That needs to be done before the buy step, not after.

---

## 3. QA Testing Report

_QA will populate this section._

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-27 | Created, with the SA review | Short-path UI slice, so there is no Dev workplan; this document is the review record. SA: approved for QA with P-1 (the account seam bypassed a second time — fix the guard, not just the call) and P-2 (the upgrade comparison ranks a one-off allowance against a monthly rate). Extraction verified function-by-function against the pre-change source rather than on the test count: two byte-identical, four semantically identical, one laxity noted (P-3). Endorsed the no-Zod argument on a no-input handler, the recorded absence of `requireAdmin`, "say nothing" about chat as the right shape by audience, both guard handlings, and English-for-now with a line drawn at the buy step. |
