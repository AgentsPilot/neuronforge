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

**QA - 2026-09-27, snapshot 14:14**
**Test mode:** full, on the **uncommitted** tree
**Strategy used:** mutation first - 12 mutations against the claims, plus a payload-identity proof for the extraction and four probes (the three no-plan states, a per-capability dump, and three plan shapes that do not exist yet). Reading only where a mutation could not settle it.
**Safety:** the tree was **not committed**, so `git checkout --` was never used. Every target was copied to a backup **outside the repo**, the copy asserted non-empty **and byte-identical** before any edit, and restored from that copy with `cmp -s` verifying each restore. The harness aborts rather than proceeds if a backup or a restore fails. Final state verified: Dev's working set intact.

> **Dev was editing throughout.** `route.ts` gained `resolveAccountId` at 14:07, `enforcementPoints.test.ts` was fixed at 14:12, and three more files changed after my first survey. **Everything below is pinned to the 14:14 snapshot** and was re-verified against the files as they then stood. One consequence needs Dev's eye - QA-5.

### Verdict

**PASS with two findings worth fixing and three notes.** The extraction is provably behaviour-preserving, tenant isolation is structural, chat suppression is the best-defended thing in the slice, and the downgrade-as-upgrade fix generalises to plan shapes that do not exist yet. Dev's confessed vacuity is fixed, and the fix measures exactly as claimed.

### 1. The extraction - proven, not inferred

Rather than trust *the admin's 152 tests stayed green*, I ran the **pre-extraction module and the current one side by side**. A verbatim copy of `adminPlansView.ts` from `609635ff` was dropped in beside the new one as a **new** file (nothing existing was touched) and both payloads deep-compared:

| Check | Result |
|---|---|
| `JSON.stringify` equality at `mode=off` / `shadow` / `enforce` | **identical in all three** |
| Size of what was compared | 4 plans, **152 capability rows**, 10 `notBuilt`, 9 `withheldWithoutGate` |
| Non-vacuity: one sentence changed in the HEAD copy | **3 of 4 comparisons failed** |

**The admin screen says exactly what it said before.** Both scratch files were deleted and `git status` returned to Dev's set.

### 2. Tenant isolation

`getUser()` resolves the session from **cookies only**, verified server-side by `supabase.auth.getUser()` - not from a header, not from a body - so the identity cannot be spoofed. `requireAdmin`'s absence is deliberate, documented, and right: this is a customer route and the admin endpoints are untouched. The handler takes no input; the id reaches `getSnapshot` through `resolveAccountId(user.id)`.

| Mutation | Result |
|---|---|
| **T1** the route reads `?accountId=` and ignores it | **1 failed** - the source guard bites |
| **T2** the route **resolves** `?accountId=` - the real leak | **2 failed** |
| **T3** an `x-user-id` header fallback when there is no session | **11 passed - NOT CAUGHT** - QA-1 |

### 3. Chat suppression

| Mutation | Result |
|---|---|
| **C1** the `chat.` clause commented out | **10 of 54 failed** across the four new suites |
| **C2** the `not_built` clause commented out | 1 of 43 failed |

C1 is very well defended, and the fifth door I went looking for is already shut: `customerPlanView.chat.test.ts:86` serialises the **whole payload** per plan and asserts `not.toMatch(/chat/i)` **and** that the Hebrew label is absent, so an id, an English label and the Hebrew label are all covered - including inside `nextPlanUp`. I confirmed by probe that the three **no-plan payloads** carry no chat word either. C2's single failure is not a weakness: a `not_built` capability is never `granting`, so it cannot reach `included` or `adds` even unfiltered, and the one failing test is the rule-level one - the right place for it.

### 4. The downgrade-as-upgrade defect

Fixed, and fixed generically: `buildUpgrade` ranks `comparableAmount` off **both resolutions** and refuses when either side is unrankable or `nextAmount <= mineAmount`, and `nextPlanUp` is nulled entirely when nothing genuine remains. Measured on the real config: **champion gives `nextPlanUp: null`** (a Founding Partner is no longer offered a $79 downgrade); trial improves 2; basic improves 1 (`ai.actions 500 -> 2,000`).

On **plan shapes that do not exist yet**, built by cloning the config and editing the matrix:

| Synthetic shape | Result |
|---|---|
| next plan worse at everything | `nextPlanUp: null` - the section disappears |
| unrankable variant differences (unbranded to branded, ai to manual) | improvements claimed: **none**; section disappears |
| equal amount, different rendering (`1 seat` to `1 seat, more purchasable`) | claimed: **none** |

| Mutation | Result |
|---|---|
| **D1** any rendered difference is an improvement again | **3 failed** |
| **D2** unrankable values rank as `0` instead of `null` | 36 passed - **not caught**, QA-3 |
| **D3** an equal amount counts as an improvement | 36 passed - **not caught**, QA-3 |

### 5. Dev's confession, measured

Verified exactly. Emptying `included` server-side fails **4 of the 16** render tests - Dev's claim of 1-of-15 to 4-of-16 - and 8 of 54 across the four new suites. Both halves of the fix are real: `expect(payload.included.length).toBeGreaterThanOrEqual(3)` **before** the loop, and `getByRole('list', { name: /What your plan includes/i })` in place of `getAllByRole('list')[0]`, with both lists in the component now carrying distinct `aria-label`s.

**The same shape in the other three suites:** `customerPlanView.chat.test.ts` loops a 4-element literal and has a non-vacuity leg for the catalog's chat entries - safe. `route.test.ts` has non-vacuity legs on both the comment stripper and the handler-export test - safe, and the stripper leg is the one I would otherwise have asked for. `customerPlanView.test.ts:183` is the one to note - QA-4.

### 6. The three no-plan states, and `not_built`

| State | What the customer gets |
|---|---|
| read failed (`unavailable`) | *We could not load your plan just now. Nothing has changed about your account - please try again shortly.* |
| no plan record (null resolution) | *We do not have a plan record for this account yet. Everything keeps working; get in touch if this stays here.* |
| `basis: none` | the same sentence, `status: no_plan_record` |

None renders as *your plan includes nothing*, the failed read is distinguishable from the missing record (the S-0 lesson, one product over), and the component adds a fourth guard: an empty `included` renders *We could not list your features just now. Nothing has been removed from your account.* rather than an empty list. **No `not_built` capability appears anywhere** - verified against live payloads and held by a test that has a non-vacuity leg.

### Findings

**QA-1 - The source guard forbids the query string and the body, but not the header - the one door this repo has actually been breached through.** Severity: **Medium**

- File: `app/api/business-os/entitlements/my-plan/__tests__/route.test.ts:139-157`
- It asserts the route source contains no `searchParams`, no `request.json()` and no `params`. It says nothing about `request.headers.get(...)`. I replaced the gate with a fallback that reads `x-user-id` when there is no session - a complete authentication bypass **and** a cross-tenant read - and **all 11 tests passed**, against the route as it stands at 14:12. The behavioural tests try a query string and a body; neither sends a header.
- The code today is correct, so this is not a live vulnerability. It is a missing assertion on the **highest-risk regression path**: `x-user-id` / body-`userId` is this repo's known IDOR class (the sweep behind PRs #80 / #82 / #86), and this is the first entitlement data a non-admin can see. A guard whose stated purpose is *the day somebody adds `?accountId=` the test fails rather than the customer* should cover the id source that has already gone wrong here.
- **Fix, two lines**, in the shape already used: a `not.toMatch` on `headers.get('x-user-id')` in the source guard, plus one behavioural test that sends the header and asserts the asked-for account is still the session's.

**QA-2 - `nothingToShow` can never be shown.** Severity: Low

- `lib/business-os/entitlements/customerPlanView.ts:255` sets it, `:359` discards it, `components/business-os/settings/PlanSection.tsx:201` renders it.
- It is non-null exactly when `adds.length === 0 && improves.length === 0`; `nextPlanUp` is kept exactly when `adds.length > 0 || improves.length > 0`. The conditions are complements, so whenever the sentence is set the object carrying it is dropped. The field is **unreachable** and so is the paragraph that renders it.
- It matters because the doc comment says it exists so *this plan adds nothing* and *we could not work it out* do not look the same - a distinction the screen cannot draw, while a reader of the type will believe it can. Either keep `nextPlanUp` so the sentence can do its job, or delete the field, the branch and its `toBeNull()` assertion.

**QA-3 - The two clauses that keep the comparison conservative are not pinned.** Severity: Low

- `lib/business-os/entitlements/customerPlanView.ts:243`. **D2**: making `comparableAmount` return `0` rather than `null` for an unrankable value is not caught - inert today only because `0 <= 0` keeps it silent, so it is safe by accident rather than by assertion. **D3**: changing `<=` to `<` is not caught, because an equal-and-identically-rendered pair is already skipped earlier.
- Neither is a defect. Both are the guarantee Dev correctly describes as *say nothing when there is nothing to rank*, unheld by a test. My three synthetic-config probes are the vehicle - they run through `buildCustomerPlanView({ config })` with no source change, and two of them fail under D2.

**QA-4 - One test named for the champion defect can silently check nothing.** Severity: Low

- `lib/business-os/entitlements/__tests__/customerPlanView.test.ts:183-196` does `if (!upgrade) continue;` then loops `upgrade.improves`. Today three of four plans contribute so the loop runs - but if a regression nulled every `nextPlanUp` this test would pass having examined zero pairs, and it is the one the suite offers as *the general form of the champion defect*. Neighbours at `:146` and `:172` do assert `nextPlanUp` is non-null for trial and basic, so the property is protected; the named guardian is the part that can go quiet. A counter plus an assertion that it is above zero closes it.

**QA-5 - I mutated and restored a file Dev was editing; please confirm the route.** Severity: note, needs Dev

- I took a fresh byte-verified copy of `route.ts` at about 14:12, mutated it for T3, and restored it. Dev was editing in that window. The restored file is **4340 bytes, md5 `97379c6ab388`, three `resolveAccountId` occurrences**, and every guard pinning its content is green - `route.test.ts` asserts `resolveAccountId(user.id)`, `getSnapshot(accountId)` and *not* `getSnapshot(user.id)`, and the `enforcementPoints` exemption matches its import set. Strong evidence it is Dev's latest, not proof. One look settles it.

**Closed while I watched:** at 14:11 `enforcementPoints.test.ts` was **red** - the route had gained a `resolveAccountId` import while its exemption listed only two symbols. Dev fixed the exemption at 14:12. Worth recording because the guard that caught it is the import allow-list added after the S-0 round found the chat-v4 denylist hole: it did exactly the job it was built for, on the first new file to reach the module from outside.

### Would a customer be misled by anything on the screen?

**No - with one consequence of the FR-46 decision the user should know is deliberate.**

Everything rendered is true: the plan name, the price, the 19 capabilities, the ending sentence, and the free-plan notice that a paid plan is normal and will be announced first. A Founding Partner is no longer shown a cheaper plan as an upgrade. The three failure states each say something distinct and reassuring.

The consequence: because chat cannot be mentioned until S-2, **the upsell understates Autopilot**. An Essentials customer sees *Autopilot - $129 a month: AI actions 500 per month becomes 2,000 per month* and nothing else, because the nine chat capabilities are the rest of the difference and are suppressed. That is the honest choice - the alternative is telling them their plan excludes chat while chat works - but the screen invites *why would I pay $50 more for that?* and has no answer. It understates and never overstates, which is the safe direction, and it resolves itself when S-2 makes the claim true.

### Numbers

| Check | Result |
|---|---|
| Scope (entitlements, repositories, both `business-os` API trees, `components/business-os`, the admin tiers screen) | **74 suites / 1,377 tests, 0 failures** at the 14:14 snapshot |
| The four new suites | **54 tests**, green at baseline and after every restore |
| ESLint over the touched paths | **0 errors**, 7 pre-existing warnings (`InvoiceSettingsSection.tsx` and neighbours, not this slice) |
| `tsc --noEmit`, verified method | **2,069 - down 8**, exactly as Dev reported, and **zero in any touched file** |
| Mutations | **12 applied, 9 caught, 3 not** (T3 to QA-1, D2/D3 to QA-3); every file restored byte-identical |

### Anything needing the user

**QA-1 before commit** - two lines, and it closes the identity door this repo has already been through once. **QA-5** is a one-look confirmation from Dev. Everything else is a follow-up.

### Final Status

- [x] **Ready for the user's code review.** The extraction is provably invisible to the admin screen, isolation is structural, chat is silent through five doors, and no plan shape I could invent produces a misleading offer.
- [ ] **QA-1 first** - the header assertion. QA-2 to QA-4 are small and can follow.


---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-27 | Created, with the SA review | Short-path UI slice, so there is no Dev workplan; this document is the review record. SA: approved for QA with P-1 (the account seam bypassed a second time — fix the guard, not just the call) and P-2 (the upgrade comparison ranks a one-off allowance against a monthly rate). Extraction verified function-by-function against the pre-change source rather than on the test count: two byte-identical, four semantically identical, one laxity noted (P-3). Endorsed the no-Zod argument on a no-input handler, the recorded absence of `requireAdmin`, "say nothing" about chat as the right shape by audience, both guard handlings, and English-for-now with a line drawn at the buy step. |
| 2026-09-27 | QA round 1: PASS with two findings worth fixing (QA) | Added section 3. Twelve mutations, nine caught. The extraction is proven behaviour-preserving by running the pre-extraction module beside the new one and deep-comparing the admin payload - identical in all three modes over 152 capability rows, with a non-vacuity leg. Chat suppression fails 10 of 54 when the clause is removed, and the serialised-payload sweep already covers the fifth door including the Hebrew label. The downgrade fix holds on three plan shapes that do not exist yet. Dev's confessed vacuity measured exactly: 4 of 16 render tests. **QA-1 (Medium):** the source guard forbids the query string and the body but not `request.headers.get`, so an `x-user-id` authentication bypass passes all 11 route tests - this repo's known IDOR class. **QA-2..QA-4 (Low):** `nothingToShow` is unreachable; the two conservative comparison clauses are unpinned; one test named for the champion defect can examine zero pairs. 74 suites / 1,377 tests, lint 0 errors, tsc 2,069 (down 8) with zero in touched files. |
