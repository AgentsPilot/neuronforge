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

### 2.9 SA Review — round 2 (the four user decisions)

**Reviewed by SA — 2026-09-27** (still uncommitted)
**Status:** 🔄 **CHANGES REQUIRED** — two required (**R2-1, R2-2**), three low. The four decisions are implemented well and the reasoning behind the flags is better than the brief asked for; **R2-2 is a reproducible test failure that appeared between round 1 and round 2** and must be diagnosed rather than re-run until green.

**What SA ran:** `npm run test:bos-entitlements` — **1 suite failed, 64 passed; 2 tests failed of 1,282**. The surface suites — **1 suite failed, 6 passed; 3 tests failed of 118**. Round 1's run of the same code was fully green, so this is new.

#### R2-2 (required) — an order-dependent failure, and the assertion that fails carries a customer promise

`lib/business-os/entitlements/__tests__/customerPlanView.test.ts` **passes alone (31/31) and fails in company**. Two reproductions:

```
npx jest lib/business-os/entitlements/__tests__/mode.test.ts \
         lib/business-os/entitlements/__tests__/customerPlanView.test.ts --runInBand   → 1 failed
npx jest lib/business-os/entitlements/__tests__/customerPlanView.test.ts \
         app/api/business-os/entitlements --runInBand                                   → 2 failed
```

The failing assertion is `customerPlanView.test.ts:529` — *"no withheld list is produced at all"* — and the received value is the payload's key list **including `"excluded"`**:

```
["status","planId","name","kind","monthlyPriceUsd","free","state","accessEndsAt",
 "endsWhen","whenThisChanges","included","excluded","nextPlanUp","problem"]
```

Two reasons this is required rather than a flake to re-run:

1. **The assertion is the structural half of the promise this slice is built on** — that the surface has no field in which an exclusion could ever be rendered. If that key can appear, the promise is conditional, and "conditional" is not what §2.4 and `noExclusions.test.ts` claim.
2. **It is order-dependent, so CI can be green or red by sharding.** A green run proves nothing until the cause is known.

**I am not claiming the payload leaks exclusions in production — I do not know that, and guessing a mechanism is how §13.9 went wrong.** What I can offer is where to look, in order:

- `excluded` does **not** appear anywhere in `customerPlanView.ts`. A key absent from the source arriving in the object means **the module under test is not behaving as the file reads** — that is the thread to pull first, ahead of any theory about modes.
- `report.ts` **does** contain `excluded`. A shared helper or singleton reached through a path only taken in a multi-file run is the most economical explanation, and it is checkable.
- `mode.test.ts` mutates `process.env[BOS_ENTITLEMENTS_MODE]` and uses `jest.isolateModules` in four places; `process.env` is shared across test files inside one worker. That is a real leak vector — but the second reproduction above does **not** involve `mode.test.ts`, so it cannot be the whole story.

Please diagnose before the next hand-off, and say in the doc what it was.

#### R2-1 (required) — the component reintroduces the claim the server refused, for anyone not looking at the icons

The `changes` list is the right idea and the payload genuinely maintains the distinction: three separate arrays, and `changes` is populated only where `comparableAmount` refused to rank. The component then renders all three inside **one `<ul>` whose accessible name is `"What {plan} would add"`**, and gives `changes` items the **same sentence** as `improves` — `"— {from} becomes {to}"`.

So the distinction survives in exactly one channel: a muted arrow instead of a muted tick, same size, same colour.

- **A screen-reader user is told "what Autopilot would add" over an item the server explicitly declined to call a gain.** The one channel assistive technology does not receive is the only one carrying the distinction.
- CLAUDE.md's accessibility NFR — warnings must not rely on colour alone — is the same principle; an icon-only distinction is the same class of problem.
- And this is the round-1 defect's own shape: the server stopped ranking unlike units, and the presentation layer labels them a gain anyway.

**Fix:** give the changed items their own list with its own accessible name (e.g. *"How {plan} compares"*), or keep one list and make the name neutral **and** the sentence distinguishable in text. Then assert it at the DOM boundary — the render suite already reaches into the DOM, so the cost is one test.

#### The four decisions

| # | Verdict |
|---|---|
| **Two commercial flags** | ✅ **Endorsed, and the reasoning is right.** Required-not-defaulted is correct and the justification is the good part: either default answers a commercial question silently, and they are wrong in opposite directions. The `superRefine` rejects the one incoherent combination and permits the other three — including *shown, not buyable*, which is what ships. Invariants cover both the rejection and the both-required rule, with the shipped combination pinned. `availableToBuy` being the single switch, with the component holding no notion of purchasability, is exactly how step 3 should be reachable. |
| **Chat named normally** | ✅ Correct now that the premise changed. Chat is available to everyone, so suppressing its *name* was protecting a restriction that does not exist. Deleting `customerPlanView.chat.test.ts` in the same change — per that file's own instruction — is the mechanism working as designed, and worth noting as such. |
| **`champion` → `base: { tier: 'pro' }`** | ✅ Correct, and **the precedence claim is true — I checked the code, not the comment.** `resolver.ts` layer 3 applies a cohort's explicit values **only when the cohort's base is a tier** (`'tier' in cohort.base`), so `CHAMPION_VALUES`' 1,000/month does override the `pro` row's 2,000. The trace even records *"the champion cohort states this one"*. Documenting it matters because the result is counter-intuitive — a design partner on "Autopilot" gets **fewer** AI actions than an Autopilot customer — and a reader would assume the opposite. |
| **The `changes` list** | ✅ In the payload; ❌ at the boundary — see R2-1. It also removes a real hazard: a trial no longer depends on `email.volume` happening to be same-unit to see a paid plan at all. |

#### The blast radius (Dev's own flag) — confirmed, and it is the right shape

**Dev is right that the flags are config-level, and I would have rejected a surface-level version.** The decisive reason is not reuse, it is validation: **only the loader can refuse *buyable-but-hidden*, and the loader validates config.** A flag living in `customerPlanView.ts` could not be validated, could not be shown on the admin screen without re-deriving it, and would need a second copy for the buy page in step 3 — all three are the drift this module exists to prevent. So the five touched files are the necessary consequence, not scope creep.

**On rule 7 (no new patterns without SA review):** this is an **extension of an approved pattern** — the same `presentation` block I approved in §13.9, two more required fields, validated by the same builder — not a new one. Reviewed here, and approved. Flagging it rather than leaving it implicit was the right instinct.

#### The replacement rule

✅ **The right durable invariant, and better than what it replaces.** The old rule was tied to one capability and a temporary state, so it *had* to be deleted. The new one is a property of the surface — *it lists what a plan includes and never asserts what yours excludes* — which survives FR-46, survives new capabilities, and states the actual editorial principle. Narrow in the right way: it constrains how the surface speaks, not what exists.

**The negative control is strong enough.** It feeds the phrasing regex the very sentence the test is named after and asserts it *matches*, plus a benign sentence that must not — so the four `not.toMatch` assertions cannot pass on text that simply lacks the words. `it('there ARE withheld capabilities to stay quiet about')` covers the premise's non-vacuity, and naming a nonexistent capability in neither direction is a good addition.

**Permitting `nextPlanUp.adds` to name chat: endorsed, with the reason recorded rather than deferred to "the user accepted it".** The asymmetry is principled — we state facts about *other plans* (config truths) and refuse to assert limitations about *yours* (claims about product behaviour). Suppressing chat from `adds` would understate the plan above, which is its own dishonesty, and would need deleting later too. **R2-3 (low):** the inference is wrong only until FR-46 ships, so that window belongs in FR-46's entry alongside the P-4 pointer — *until this ships, `nextPlanUp.adds` overstates the gap* — otherwise nobody is tracking a customer-visible inaccuracy.

#### The tests that were re-pointed

✅ **Honestly, and better than honestly.** `resolver.test.ts`'s inheritance test now says explicitly that its assertions are the **fixture's** `pro` row, that the fixture is not a price list, and that **production's fact is pinned in `productionConfig.test.ts` rather than here**. That is the correct division: the inheritance test tests inheritance; the production truth lives where production is asserted. It was not pinned to the old truth, and the comment records what the flip changed.

#### The docs

**R2-4 (low) — one row is now wrong rather than updated.** `BUSINESS_OS_ENTITLEMENTS.md`'s Change History carries a 2026-09-27 row saying the section *"says **nothing about chat** while FR-46's gate does not exist"* and that the gates table *"now carries the reciprocal instruction: delete `customerPlanView.chat.test.ts`"* — both reversed by **later rows of the same date**. Two rows in one history state opposite things and the earlier is the false one. Change History is a record, so supersede rather than rewrite: mark that row as superseded by the later two, the way retractions are handled elsewhere in this programme.

The rest is accurate: the banner correctly says `chat.access` is still unenforced, the FR-46 row now carries the consequence **and** the champion note, and the champion note states the allowance is unchanged *and why* — which I verified against the resolver.

#### Round-2 fixes

| # | Fix | Priority |
|---|---|---|
| **R2-1** | Separate the accessible name and the wording so `changes` is not announced as an addition; assert it in the DOM. | **Required** |
| **R2-2** | Diagnose the order-dependent failure of `customerPlanView.test.ts:529` and record the cause. Do not re-run until green. | **Required** |
| R2-3 | Record in FR-46's entry that until the gate ships, `nextPlanUp.adds` overstates the gap. | Low |
| R2-4 | Supersede the contradicted Change History row in `BUSINESS_OS_ENTITLEMENTS.md`. | Low |
| R2-5 | P-1..P-5 and QA-1..QA-5 are closed; leave them recorded as closed rather than deleted, so the round-1 reasoning stays findable. | Low |

#### For the user

1. **Your two-flag design is the right shape, and I would have pushed back on a simpler version.** Keeping "can they see it" and "can they buy it" apart, with neither defaulted, means turning purchasing on later is one line of configuration rather than a change to the screen — and the configuration refuses the one combination that makes no sense (buyable but hidden).
2. **Naming chat is right now that you have told us it is live for everyone.** The earlier silence existed to avoid claiming a restriction that was not real; the real one was never chat, it was that Autopilot cannot be bought yet.
3. **One thing to fix before this ships, and it is about people who cannot see the icons.** The screen lists three kinds of difference: what the next plan adds, what it improves, and what simply *changes* (your AI actions go from a one-off 250 to 500 every month — genuinely different, not obviously better). The first two get a tick, the third an arrow — but the list as a whole is announced to screen readers as "what Autopilot would add", which turns a neutral change back into a promise. That is the same mistake as the downgrade-as-upgrade one, in a channel we cannot see.
4. **And one honest wrinkle you already accepted:** a trial customer reading "Autopilot adds AI chat" may conclude they do not have chat. They do, today — that sentence becomes true when the chat gate is built. I have asked for that to be recorded against the gate so it is not forgotten.
5. **A test that passed last round now fails when the suite runs together.** It may be a test-isolation problem rather than a product one, but the assertion that fails is the one guaranteeing this screen can never tell a customer what they lack — so it gets diagnosed, not re-run.

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

### Round 2 — after the user's four decisions

**QA - 2026-09-27, round 2**
**Test mode:** full regression on the reversal, plus re-runs of every round-1 check this round could have broken
**Strategy used:** mutation first - 11 mutations, plus a structural additive-diff proof for the admin payload and four read-only probes.
**Safety:** the tree is **still uncommitted**, so `git checkout --` was again never used. `customerPlanView.ts`, `route.ts` and `config/tierMatrix.ts` were copied outside the repo, each copy asserted non-empty **and** `cmp`-identical before any edit, and restored from that copy with `cmp` verifying every restore. Baseline and final both **79/79** on the five customer and admin suites; all three files restored byte-identical.

**Round 1 is closed.** QA-1's identity door now bites: the `x-user-id` fallback that passed 11/11 last round produces **3 failures**, verified against the current route. QA-2 to QA-5 are closed as reported.

### Verdict

**PASS with two findings worth fixing and two notes.** The reversal is handled well: the replacement rule is sharper than the suppression it replaced, the two flags are properly required and the incoherent combination is refused, the champion flip was re-pointed **honestly**, and the extraction is still invisible to the admin screen. Two guards, however, claim more than they check - and in both cases the claim is the word *structural*.

### 1. The deleted suppression - does the replacement bite?

Eight tests went away and seven arrived. The new rule is the better one and it is genuinely enforced in three of the four ways it could be:

| Mutation | Result |
|---|---|
| **E1** an `excluded: [...]` array added to the payload | **2 failed** - the field check bites |
| **E2** a `youDoNotHave: [...]` array - a name **not** on the denylist | **54 passed - NOT CAUGHT** - QA-7 |
| **E3** an exclusion sentence written into `endsWhen` | **4 failed** |
| **E4** an exclusion sentence written into a **rendered** feature value | **1 failed** - better than I expected |

The negative control on the phrasing (`:119-128`) is real: it asserts the pattern **does** match two exclusion sentences and does **not** match a neutral one, so four `not.toMatch` assertions cannot pass on a vocabulary accident. The non-vacuity leg (`:63-81`) confirms there are withheld-and-real capabilities to stay quiet about. Both are the right shape.

### 2. The flags

| Mutation | Result |
|---|---|
| **F1** the customer view ignores `shownToCustomers` | **63 passed - NOT CAUGHT** - QA-6 |
| **F2** `availableToBuy` hardcoded `true` | **4 failed** |
| **F2b** `actionUnavailableBecause` stops reading the flag | **3 failed** |
| **F3** the **production** matrix made buyable-but-hidden | **6 failed** - the refusal bites |

Both flags are genuinely **required**: `z.boolean()` with no `.default()`, the object is `.strict()`, and `tierMatrix.invariant.test.ts:97-108` deletes each flag in turn and asserts validation throws. The one incoherent combination is refused in `schema.ts:266-272` with two assertions on the message. Production ships **shown, not buyable** for both tiers, pinned on its own in `productionConfig.test.ts` with a comment saying that if the test ever changes, somebody has made a commercial decision - which is the right way to hold it.

### 3. The champion flip, and whether the fallout was re-pointed honestly

**Honestly, and better than honestly.** `resolver.test.ts` did not lose assertions: `chat.search: false` became `true`, `'branded'` became `'unbranded'`, `'manual'` became `'ai'` - the same assertions with the new values, plus a comment recording what they read before the flip. The `ai.actions` assertion reads the value **from the config** rather than hardcoding it, so it pins the generic property (a cohort's own numbers override the tier row) rather than a number. `productionConfig.test.ts` pins `champion.base` as `{ tier: 'pro' }` with a dated reason.

**And the resolver really does what the comment says** - verified at the resolver, not read off the comment:

| Plan | `ai.actions` | `decidedBy` | `chat.access` | included |
|---|---|---|---|---|
| `champion` | `{ perMonth: 1000 }` | **`cohort_values`** | `true` | 28 |
| `pro` | `{ perMonth: 2000 }` | `basis` | `true` | 28 |

So the cohort's explicit 1,000 **does** take precedence over the inherited `pro` row's 2,000. Founding Partners keep chat, and they are now offered Autopilot with `improves: ai.actions 1,000 per month -> 2,000 per month`, which is a genuine increase - the round-1 downgrade defect has not returned by another route.

⚠️ **Worth the user's attention, not a defect:** a Founding Partner now has Autopilot's 28 capabilities but **half its AI allowance**. "Champion is Autopilot for free" is not quite true, and the screen now says so out loud by offering Autopilot on exactly that axis. That is the honest consequence of keeping `CHAMPION_VALUES`; if the intent was parity, the 1,000 is the line to change.

### 4. The `changes` list

`comparableAmount` now returns `{ amount, unit }`, and the three branches are exclusive by construction: unrankable pairs `continue`, different units go to `changes`, same-unit-and-more goes to `improves`. Measured on the real config: trial to Essentials produces `changes(1): ai.actions 250 in total -> 500 per month` **and** `improves(1): email.volume`, correctly separated.

| Mutation | Result |
|---|---|
| **G1** cross-unit pairs pushed into `improves` instead | **3 failed** |

So a cross-unit pair cannot leak into `improves` unnoticed. The component uses `ArrowRight` rather than a tick, deliberately. **But see QA-9**: that is the only thing distinguishing them.

### 5. Re-runs of the round-1 checks

| Check | Result |
|---|---|
| The extraction, after `planCommercialFlags` moved in | **only additive**: the sole differences from the pre-extraction module are `plans[].shownToCustomers` and `plans[].availableToBuy`; non-additive diffs `[]` in all three modes |
| The identity door (round 1 QA-1) | **3 failures** - closed |
| Tenant isolation | still structural: no input, cookie-verified session, `resolveAccountId(user.id)` |
| The three no-plan states | all three still distinct and reassuring; `included: 0` with a `problem` sentence, no upsell, 13 keys |

The additive-diff check isolates the **extraction**: both modules read the same current config, so the champion flip's effect on the admin screen is excluded by construction - which is what makes the result meaningful.

### 6. The two content fixes

**Neither hid an assertion.** `Coming soon` (`:122`) and the `get in touch` sentence (`:123`) are asserted **separately**, which is what makes the two distinguishable again - the fix improved the test rather than relaxing it. The `Invoices` query was scoped into the includes list with an **exact** string instead of a regex (`:97-99`), so the chat invoice-control label in the upgrade list can no longer satisfy it; and two new assertions arrived at `:159` and `:165-166` pinning that chat appears in a champion's includes and in Essentials' "would add".

### Findings

**QA-6 - The `shownToCustomers` gate is never exercised, and the fixture built to exercise it is never used by the surface that reads it.** Severity: **Medium**

- File: `lib/business-os/entitlements/customerPlanView.ts:431`
- Replacing `nextPlanId !== null && planCommercialFlags(config, nextPlanId).shownToCustomers` with `nextPlanId !== null` - deleting the gate - passes **63 tests**.
- Dev's claim that varying the flags across three fixture tiers makes this impossible is **half-true**. The fixture is exactly right: `__fixtures__/exampleTierMatrix.ts:157-175` has shown+buyable, shown-only and **hidden**, and the hidden one is `pro`, **last in `tierOrder`** - so a customer on `growth` would have a hidden next plan, the perfect case. But all three customer-facing suites build their config with `readCodeConfig()` (`customerPlanView.test.ts:35`, `noExclusions.test.ts:45`, `PlanSection.render.test.tsx:42`), and in production **both** tiers are `shownToCustomers: true`. The fixture never reaches `buildCustomerPlanView`.
- This is the flag the user's decision turns on, and it is the one with no test. **Fix: one test** - build the view for a customer on fixture `growth`, assert `nextPlanUp` is null; and on fixture `basic`, assert `growth` **is** offered. That also gives the `availableToBuy: true` branch of the component its only coverage.

**QA-7 - "There is no field to render an exclusion list from" is enforced by a six-name denylist.** Severity: **Medium**

- File: `lib/business-os/entitlements/__tests__/customerPlanView.noExclusions.test.ts:89` and `:96`
- The header argues the rule outlives the old one because *"there is no field to render an exclusion list from, so the rule is structural rather than a habit"*. The test checks `Object.keys(view)` against `['withholds','excluded','excludes','missing','notIncluded','withheld']`. I added `youDoNotHave: ['chat.access']` to the payload and **all 54 tests passed** - so the rule is precisely a habit.
- Not a live leak: nothing renders the field. It is about whether the guard stops the next one, and the answer is "only if it is spelled one of six ways".
- **Fix, and there is precedent in this module:** make it an **allow-list** - assert `Object.keys(view).sort()` equals the known field set, so any new field must be declared in a diff. That is the shape Dev adopted for the entitlements import allow-list after the S-0 round found the same denylist weakness in the chat-v4 exemption.

**QA-8 - The phrasing guard names `problem` among the sentences it scans, never produces one, and would fail on good copy if it did.** Severity: Low-Medium

- File: `lib/business-os/entitlements/__tests__/customerPlanView.noExclusions.test.ts:103-117`
- The scanned list is `[endsWhen, whenThisChanges, problem, nextPlanUp?.actionUnavailableBecause]` - including `problem`, which signals intent to cover the failure states. But the loop runs over the four real plan ids only, where `status` is always `ok` and `problem` is always `null`. The three states that have a `problem` sentence are never built.
- I wrote the obvious extension - the same regex applied to the three no-plan views - and it **fails immediately**, on *"We do not have a plan record for this account yet."* The copy is good; the bare `do not have` alternative in the pattern is what catches it. So the next person to widen this guard will hit a false positive and the natural reaction is to weaken the regex.
- **Fix:** narrow the pattern to second-person claims about the plan (`you do not have`, `your plan does not include`, `not included in your plan`) **and then** extend the loop to the three failure states. That makes the guard both wider in coverage and correct - the two changes have to happen together.

**QA-9 - `changes` is separated from `improves` by an icon, inside a list announced as "would add".** Severity: Low

- Files: `components/business-os/settings/PlanSection.tsx:215` and `:243-253`
- The server takes deliberate care not to claim a cross-unit difference is better. The component then renders `changes` rows **in the same `<ul>`** as `adds` and `improves`, with the **identical** sentence template `- {from} becomes {to}`, differing only by `ArrowRight` instead of `Check` in the same muted colour. That `<ul>` carries `aria-label={`What ${upgrade.name} would add`}`.
- So a trial customer reads *"AI actions - 250 in total becomes 500 per month"* under a heading that says what the plan **would add**, and a screen-reader user gets only the "would add" framing. The component's own comment says a tick *"would assert an improvement the server deliberately refused to claim"* - the verb and the list label do the same work as the tick.
- **Fix:** a different verb for `changes` (`changes to`, or plain `250 in total -> 500 per month`), and its own list with its own label. Not urgent - the numbers shown are true and both are visible - but it re-introduces exactly the inference the server refused to make.

### Would a customer be misled?

**No, and the reversal removed the one real understatement from round 1.** An Essentials customer is now shown the nine chat capabilities under Autopilot, so the upsell no longer reads as "$50 more for some AI actions". Champions keep chat. Everything rendered is true of the configuration.

Three things a reader should know are deliberate, all of them recorded in the code rather than left to be discovered:

1. **The accepted inaccuracy.** An Essentials customer shown chat under Autopilot may infer they do not have it today - which is false until FR-46 enforces `chat.access`. The user accepted this explicitly, and `noExclusions.test.ts:176-180` asserts it rather than leaving it as a comment, which is the right way to carry an accepted inaccuracy.
2. **Neither plan can be bought.** Every priced plan shows a *Coming soon* badge and a sentence, driven by `availableToBuy`, and the surface has no notion of purchasability of its own - so step 3 flips a flag and nothing else.
3. **QA-9's framing** is the one place the screen invites a conclusion the server declined to state.

### Numbers

| Check | Result |
|---|---|
| Scope (entitlements, repositories, both `business-os` API trees, `components/business-os`, both settings pages, the admin tiers screen) | **74 suites / 1,395 tests, 0 failures** - Dev's 73 / 1,391 on a marginally narrower selection |
| The five customer and admin suites | **79 tests**, green at baseline and after every restore |
| ESLint over the touched paths | **0 errors**, 4 pre-existing warnings |
| `tsc --noEmit`, verified method | **2,069**, **zero in any touched file** - unchanged from round 1 despite the new fields |
| Mutations | **11 applied, 9 caught, 2 not** (F1 to QA-6, E2 to QA-7); every file restored byte-identical |

### Anything needing the user

**QA-6 before commit** - one test, on the flag the user's decision turns on. **The champion allowance** is the one business question: a Founding Partner now gets Autopilot's features with half its AI actions, and the screen offers them the upgrade on that axis. If parity was intended, `CHAMPION_VALUES['ai.actions']` is the line. QA-7 to QA-9 are small and can follow.

### Final Status — round 2

- [x] **Ready for the user's code review.** The reversal is clean, the flags are required and coherent, the champion flip was re-pointed honestly and verified at the resolver, and the extraction remains invisible to the admin screen.
- [ ] **QA-6 first.** QA-7 (the allow-list) next, since it is the same lesson this module already learned once.


---

## 4. Dev response — SA round 2, QA round 2, and the parity decision

### 4.1 R2-2 — the diagnosis, and the plain answer

**The production payload cannot carry `excluded`, or any other key.** Not "does not today" — cannot.

**The evidence that settled it was POSITION.** SA's received list was byte-identical to the real one with `"excluded"` inserted **between `"included"` and `"nextPlanUp"`**:

```
real     [... "whenThisChanges", "included",              "nextPlanUp", "problem"]
SA's run [... "whenThisChanges", "included", "excluded",  "nextPlanUp", "problem"]
```

Key order in a JavaScript object literal follows the order the properties are **written in the source**. A key appearing at a specific position inside a literal that does not contain it cannot be produced by a module singleton, a `process.env` mutation, `jest.isolateModules`, or a shared config object — none of those can splice a property into the middle of a literal. It can only come from source that declares `excluded:` on the line after `included:`.

So the suite had read a **mutated file**. A QA mutation run was editing this tree in parallel (the coordinator confirmed QA round 2 was running), and adding an exclusion field is precisely the mutant that attacks this slice's central promise. **The assertion caught exactly what it exists for.** "Passes alone, fails in company" was a longer run overlapping a live edit, not an ordering effect — which is why neither of SA's two reproductions failed for me, in either order, or in nine other permutations including three full-folder `--runInBand` runs.

SA's two leads were both red herrings, and it was right to say so itself: `report.ts` contains the word `excluded` only in a comment and one sentence fragment — **no object in the module has such a key** — and `mode.test.ts` is absent from the second reproduction.

**Corroborating facts:**

| Check | Result |
|---|---|
| `excluded` as a KEY anywhere in `lib/business-os/entitlements/**` | none |
| Dynamic key construction in `customerPlanView.ts` (`Object.assign`, computed keys, spread of caller data) | none — the only spreads are of a local `empty` |
| Third time a parallel QA run has produced a mystery in this tree | yes: `route.ts` mutated mid-edit (round 1), tracked files destroyed by a `git checkout` loop (S-0) |

**What changed as a result** — the point is that this should never need diagnosing again. The two-name denylist became an **exact key-set allow-list** on both objects and both failure paths. Any extra key, under any name, now names itself in the diff instead of costing a round.

### 4.2 The champion allowance — the user chose parity

QA's note at §3 and SA's counter-intuitive-behaviour warning were both correct **when written**. The user's decision (2026-09-27) removes the behaviour: `CHAMPION_VALUES` no longer pins `ai.actions`, and **reads it from the tier its `base` names**, so a Founding Partner gets Autopilot's 2,000.

It is read rather than copied because `CohortExplicitValues` requires every cohort to state a value for every metered capability (RC-2) — so the field cannot be deleted, and a literal `2000` would be a second copy that silently stops matching. Parity is now structural.

**Downstream, all verified:** the champion's `nextPlanUp` is `null` (nothing left to offer), the section is **absent rather than an empty box**, and four tests re-pointed honestly — each saying what it read before. **No other cohort value disagrees with the inherited row**: `sms.messages` 0 (`not_built`, forced), `email.volume` 10,000, `team.seats` 1, `business.locations` 1 — all equal to BASE, which `pro` does not change. Recorded in `cohorts.ts` beside the values, because that is where a future divergence would hide.

### 4.3 The rest

| # | What was done |
|---|---|
| **R2-1 / QA-9** | `changes` has its own `<ul>`, its own visible heading, its own `aria-label` ("What changes on {plan}") and its own sentence — "from X to Y, **which is different rather than larger**". Four DOM assertions, including that the two lists are different nodes and that the improvements list still says "becomes", so the two demonstrably read differently |
| **R2-3** | FR-46's gate entry now says the surface **overstates the gap** until the gate ships, and that nothing customer-side changes when it does |
| **R2-4** | The contradicted row is **superseded, not rewritten**: struck through, with what was reversed, what remains true, and a pointer to the rows that correct it |
| **QA-6** | A fixture-driven block: a hidden plan is never offered (and the pair proving the flag is what decided it), plus both `availableToBuy` branches. It also caught a leak I had just introduced — `fixtureConfig()` shares its matrix, so writing a flag through it bled into the next test; the variant is cloned now |
| **QA-7** | Allow-list. Reproduced QA's `youDoNotHave` mutant first: every six-name denylist stayed green and only the exact key set failed |
| **QA-8** | Pattern narrowed to second-person plan claims **and** loop widened to the failure states, in one edit, with both halves controlled — "We do not have a plan record" must not match, and does not |
| **QA-1..QA-5, P-1..P-5** | Left recorded as closed (R2-5) |

### 4.4 One thing I broke and fixed, worth recording

My scripted edit wrote **literal ASCII backspace characters** (0x08) into a regex where `\b` was meant, because the Python string was not raw. The pattern then required a control character and matched nothing — caught immediately by the negative control I had written beside it. Same class as the stray `\'` escapes swept during S-0.

A sweep of the whole tree for stray control characters found **one other file**, `app/admin/business-os-llm/__tests__/ledgerPanel.render.test.tsx` — **not mine, not touched**, flagged here for whoever owns that slice.

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-27 | Created, with the SA review | Short-path UI slice, so there is no Dev workplan; this document is the review record. SA: approved for QA with P-1 (the account seam bypassed a second time — fix the guard, not just the call) and P-2 (the upgrade comparison ranks a one-off allowance against a monthly rate). Extraction verified function-by-function against the pre-change source rather than on the test count: two byte-identical, four semantically identical, one laxity noted (P-3). Endorsed the no-Zod argument on a no-input handler, the recorded absence of `requireAdmin`, "say nothing" about chat as the right shape by audience, both guard handlings, and English-for-now with a line drawn at the buy step. |
| 2026-09-27 | QA round 1: PASS with two findings worth fixing (QA) | Added section 3. Twelve mutations, nine caught. The extraction is proven behaviour-preserving by running the pre-extraction module beside the new one and deep-comparing the admin payload - identical in all three modes over 152 capability rows, with a non-vacuity leg. Chat suppression fails 10 of 54 when the clause is removed, and the serialised-payload sweep already covers the fifth door including the Hebrew label. The downgrade fix holds on three plan shapes that do not exist yet. Dev's confessed vacuity measured exactly: 4 of 16 render tests. **QA-1 (Medium):** the source guard forbids the query string and the body but not `request.headers.get`, so an `x-user-id` authentication bypass passes all 11 route tests - this repo's known IDOR class. **QA-2..QA-4 (Low):** `nothingToShow` is unreachable; the two conservative comparison clauses are unpinned; one test named for the champion defect can examine zero pairs. 74 suites / 1,377 tests, lint 0 errors, tsc 2,069 (down 8) with zero in touched files. |
| 2026-09-27 | SA review round 2: CHANGES REQUIRED (SA) | Added §2.9. Endorsed all four user decisions: the two required-not-defaulted commercial flags — and confirmed they MUST be config-level, because only the loader can refuse buyable-but-hidden, so the five-file blast radius is a consequence rather than scope creep, and it extends the approved `presentation` pattern rather than adding a new one; naming chat now that it is live for everyone; the champion flip, whose precedence claim I verified in `resolver.ts` layer 3, which applies cohort values only when the base is a tier, so the champion's 1,000/month really does beat the pro row's 2,000; and the `changes` list in the payload. The replacement rule is the right durable invariant with a genuinely strong negative control, and letting `nextPlanUp.adds` name chat is principled: facts about other plans, never limitations about yours. **R2-1 required:** the component renders all three lists in one list element labelled "What {plan} would add" and gives `changes` the same sentence as `improves`, so the distinction the server preserved survives only as a muted arrow versus a muted tick — a screen-reader user is told a neutral change is an addition, which is the round-1 defect in a channel we cannot see. **R2-2 required:** `customerPlanView.test.ts` passes alone at 31/31 and FAILS in company, in two reproductions, on line 529 — the assertion that no field could hold an exclusion list — with `excluded` among the payload keys; `excluded` appears nowhere in `customerPlanView.ts` but does in `report.ts`, so the module is not behaving as the file reads. Diagnosis required and the cause recorded; explicitly NOT claiming a production leak, because guessing a mechanism is how the §13.9 retraction happened. Low: R2-3 record the FR-46 window, R2-4 supersede a Change History row in BUSINESS_OS_ENTITLEMENTS.md that later rows of the same date contradict, R2-5 keep the closed round-1 items recorded. |
| 2026-09-27 | QA round 2 after the user's four decisions: PASS with two findings (QA) | Eleven mutations, nine caught; backups outside the repo with `cmp`-verified restores, no `git checkout` on an uncommitted tree. Round 1 closed - the `x-user-id` door now produces 3 failures where it passed 11. The replacement for the deleted chat suppression bites on three of four routes in; the champion flip was re-pointed **honestly** (assertions replaced with new values, not deleted) and the resolver verified to apply the cohort's 1,000 over pro's 2,000 via `decidedBy: cohort_values`; the admin payload changed **only additively** (the two flags). **QA-6 (Medium):** deleting the `shownToCustomers` gate passes 63 tests - the fixture built to exercise it is never used by the customer surface, which reads production config where both tiers are shown. **QA-7 (Medium):** the no-exclusion-field rule is a six-name denylist, so `youDoNotHave` passes all 54; an allow-list makes it structural as the header claims. **QA-8/QA-9 (Low):** the phrasing guard scans `problem` but never produces one and would fail on good copy if it did; `changes` is separated from `improves` only by an icon, inside a list labelled "would add". 74 suites / 1,395 tests, lint 0 errors, tsc 2,069 with zero in touched files. |
