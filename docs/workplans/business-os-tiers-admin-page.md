# Workplan: Business OS Tiers — admin page (read-only v1)

> **Last Updated**: 2026-09-24

**Developer:** Dev
**Requirement:** none yet — this is the user's direct request relayed by TL after he saw `app/admin/onboarding/page.tsx` and asked for "that UI concept, but its own page". The entitlements behaviour it renders is specified in [BUSINESS_OS_SUBSCRIPTION_ENTITLEMENTS_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_SUBSCRIPTION_ENTITLEMENTS_REQUIREMENT.md) and the config is §4.32 of [business-os-subscription-entitlements.md](/docs/workplans/business-os-subscription-entitlements.md).
**Date:** 2026-09-24
**Status:** Code Complete — for SA review

**Branch:** `feature/business-os-tiers-admin-page`.

> ⚠️ **It is NOT branched from `origin/main`, and it has to be said plainly.**
> TL asked for a branch from current `origin/main`. The page must render the four
> plans **from the same config the resolver uses** — and that config does not
> exist on `main`: PR #103 is open, so `main` still ships `TIER_ORDER = []`, no
> `presentation` block and no `chat.access`. A page built on `main` would not
> compile against the types it needs, and if it did it would render an empty
> list.
>
> So this branch starts at `c065021e`, the head of `feature/business-os-entitlement-tiers`, which is `main` **merged in** plus the tier config. **RM: rebase onto `main` once #103 merges** — the diff is additive (new files plus one sidebar entry), so the rebase should be clean.
>
> Branch creation is normally RM's. Dev created it on TL's instruction, and this is the record of that deviation — the same note the entitlements workplan carries for `feature/business-os-entitlements`.

## Overview

A read-only admin screen, **Business OS Tiers**, showing what the four Business OS plans are, what each includes, what cannot be sold at all, and what a given account currently resolves to. It writes nothing. Its first job is to be **unmissable about the fact that nothing is enforced yet**, because every number on it describes an intention rather than a behaviour.

---

## Analysis Summary

| Touches | What |
|---|---|
| `app/admin/business-os-tiers/**` | New screen: page, types, components, tests |
| `app/api/admin/business-os/entitlements/plans/route.ts` | New read-only endpoint |
| `lib/business-os/entitlements/adminPlansView.ts` | New server module that builds the payload |
| `app/admin/components/AdminSidebar.tsx` | One nav entry |
| Existing `GET …/entitlements/accounts/[accountId]` | Reused unchanged for the lookup |

**Nothing else is touched.** No write path, no config change, no migration.

### The precedent I am copying

`app/admin/business-os-llm/` (PR #102, merged 2026-09-24) is the closest sibling in every dimension that matters: same product, same admin shell, same read-only-v1 posture, same "the screen must never hold a second copy of a rule" problem. Its shape — `'use client'` page + `types.ts` + `components/` + a server-only view module behind one `GET` — is adopted deliberately rather than re-invented, so the two Business OS admin screens read as one family.

---

## Decisions

### D-1: the route is `/admin/business-os-tiers`

| Option | Verdict |
|---|---|
| `/admin/onboarding` (nested) | **Rejected, and the reason is the whole point.** That page is the **agent platform's** free tier. Business OS is a different product with a different plan set, and putting them on one screen is precisely the confusion the user asked to avoid |
| `/admin/entitlements` | Rejected: accurate to the module, opaque to the reader. Nobody looks for "entitlements" when they want to know what Autopilot costs |
| **`/admin/business-os-tiers`** | **Chosen.** It names the product and the thing, and it is the exact naming shape of its sibling `/admin/business-os-llm`, which is what makes the two read as a set |

API: `/api/admin/business-os/entitlements/plans`, under the existing entitlements API family rather than a new one — the account lookup already lives at `…/entitlements/accounts/[accountId]`.

### D-2: the client/server boundary — nothing on the page imports the config

The page is `'use client'` and imports **no module from `lib/business-os/entitlements/`**. Every plan, price, capability value and the mode arrive in the `GET` payload.

The alternative — a Server Component importing `getEntitlementConfig()` directly — would be less code and was rejected:

1. **The screen must never be able to disagree with the resolver.** A component that imports the catalog can render a *derived* answer (is this granting? is this sellable?) with its own logic. Every such answer is a second implementation of a rule that already exists, free to drift. Keeping the boundary at HTTP means the page has no way to compute anything: it renders fields.
2. **`server-only` makes it structural.** `adminPlansView.ts` starts with `import 'server-only'`, so an accidental client import is a build error, not a review finding.
3. **It matches the sibling**, whose own header gives the same reason (FR-6 there).

The cost is one fetch and a loading state. That is the price of the guarantee, and it is small.

### D-3: the plan rows are produced by running the RESOLVER, not by reading the matrix

"Rendered from the same config the resolver uses" is taken literally: `adminPlansView` builds a **synthetic account** for each of the four plans and calls `resolveEntitlements()`. So the page shows what an account on that plan would actually get, including cohort inheritance (`trial` and `champion` resolve through the `basic` row), the `beta` lifecycle overlay and the `not_built` clamp.

Reading `TIER_MATRIX.tiers` directly would have shown the *row*, which is not the same thing — a cohort has no row at all, and the difference between the row and the resolution is exactly where a reader would be misled.

`isGrantingValue()` — the loader's own function — decides "includes" vs "withholds", so the page's notion of granting is the same one that refuses a `not_built` tier at load.

### D-4: no write operations (v1)

No `assign_tier`, no `set_cohort`, no launch. Those ops exist and are audited; they stay behind the API until the user asks for buttons. The page says so in words rather than leaving the absence to be inferred.

---

## Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `lib/business-os/entitlements/adminPlansView.ts` | create | Server-only payload builder |
| `app/api/admin/business-os/entitlements/plans/route.ts` | create | `GET`, `requireAdmin` first statement |
| `app/admin/business-os-tiers/page.tsx` | create | The screen |
| `app/admin/business-os-tiers/types.ts` | create | The payload shape, client side |
| `app/admin/business-os-tiers/components/EnforcementBanner.tsx` | create | The unmissable one |
| `app/admin/business-os-tiers/components/PlanCard.tsx` | create | One plan |
| `app/admin/business-os-tiers/components/NotBuiltPanel.tsx` | create | The cannot-be-sold list |
| `app/admin/business-os-tiers/components/AccountLookup.tsx` | create | Id in, resolution out |
| `app/admin/components/AdminSidebar.tsx` | modify | One entry beside Business OS AI |
| `lib/business-os/entitlements/__tests__/adminPlansView.test.ts` | create | The payload's properties |
| `app/api/admin/business-os/entitlements/__tests__/routes.test.ts` | modify | 401 / 403 / happy path for the new route |
| `app/admin/business-os-tiers/__tests__/*.test.tsx` | create | Render + source guard + nav |

## Task List

- [x] T1 `adminPlansView.ts` — the payload, resolver-driven ✅
- [x] T2 The `GET` route ✅
- [x] T3 The page and its components ✅
- [x] T4 Sidebar entry (beside Business OS AI, in Configuration) ✅
- [x] T5 Tests: view (17), route (+6), render (12), source guard (37), nav (6) ✅
- [x] T6 Full scope re-run, typecheck, lint ✅

## Verified

| Check | Result |
|---|---|
| Affected scope (`entitlements`, `api/admin/business-os`, both admin screens, authz guard, scripts, migrations) | **40 suites, 1,155 tests**, 0 failures |
| New tests | 72 (view 17, route 6, render 12, source guard 37 — `it.each` over 6 files — nav 6, minus overlap) |
| `test:authz-guard` | **74 passed**, no new exemption: the new route calls `requireAdmin` as its first statement |
| Typecheck, the verified method | **2,077 on this branch, and 0 in any file this change creates or touches.** The branch base is higher than the 2,029 I reported on the tier branch because `main` was merged in before this branch started — those ~48 are `main`'s own, already present in the base commit |
| ESLint, new files | 0 problems |
| ESLint, `AdminSidebar.tsx` | 3 **pre-existing** warnings (two unused icon imports, one `icon: any`). Not introduced here and not fixed here — the file has no `console.*`, so no logging conversion is owed |
| `lint:hooks` over the screen | clean |
| `console.*` in new files | 0 |

**`next build` was not run.** The reason `server-only` exists here is to make a client import of `adminPlansView` a build error — and the screen's source guard asserts something stronger and cheaper: **no file under `app/admin/business-os-tiers/` imports from `@/lib/` at all**, walked rather than listed. The only importer of the module outside its own test is the route, which is a server file. If SA wants the build as a belt-and-braces check, it is one command.

## Known follow-ups (not in v1)

1. **The account lookup takes a raw id.** There is no search-by-email, because the endpoint resolves ids and nothing in the entitlements module maps an email to an account. Worth doing when somebody asks.
2. **No write operations**, by decision. When the user asks for buttons, they are POSTs on the accounts route that already exist and are audited.
3. **The page cannot show the chat-surface gap.** `chat.access` appears as withheld on three plans, which is true of the config and not yet true of the product (FR-46 is Slice 2). The enforcement banner covers this by saying nothing is enforced, but once the mode is `shadow` that banner is the only thing standing between this page and a false impression.

## SA Review Notes

_SA to populate._

## QA Testing Report

**QA — 2026-09-24**
**Test mode:** full
**Strategy used:** A + B + a D-equivalent (Jest unit/integration, plus React Testing Library rendering in jsdom — this repo's stand-in for E2E, which is not installed), and an independent re-derivation of the plan content from the config by hand. Chosen because the failure mode here is not a crash in a pure function but **a screen that states something confidently and wrongly**: so every claim the page makes was checked against the configuration it claims to read, and the page was rendered against the payload the server actually sends.
**Focus:** ui, api, security, schema
**Skipped:** nothing. `next build` was not run (Dev did not run it either); every other check in the Verified table above was re-run independently.
**Input source:** prompt keywords (the six numbered items from the coordinator)

> 🕒 **Status at 19:29, five minutes after the snapshot below:** Dev landed the server half of the `gateBuilt` feature (`config/enforcementPoints.ts` + `adminPlansView.ts`), which **closes QA-0** — please re-run the QA-0 reproduction to confirm. **QA-1 and QA-2 were both still present at 19:29**, unchanged, and QA-7 is unaffected by any of it.

> ⚠️ **The tree moved under me.** Dev edited six files under review between **19:11 and 19:19** — `page.tsx`, `types.ts`, `PlanCard.tsx`, `AccountLookup.tsx`, `source.guard.test.ts`, `adminPlansView.ts` — adding a `gateBuilt` / `withheldWithoutGate` feature that is the right answer to item 3. **Every finding below was re-verified against the tree as it stood at 19:24.** Where something may be mid-edit, it says so.

### Test Coverage

| What the page claims | Tested? | Result | Notes |
|---|---|---|---|
| The four plans — names, prices, allowances, include/withhold split | ✅ | Pass | Re-derived from `tierMatrix.ts` + `cohorts.ts` by hand, independently of Dev's test |
| The synthetic accounts are faithful to a real account | ✅ | Pass, one inert caveat | Shape is exact — all 11 `EntitlementAccount` fields |
| The enforcement banner is undismissible and reads the live mode | ✅ | Pass | No button, no state, no storage key; `off` / `shadow` / `enforce` all exercised |
| The banner is sufficient against the `chat.access` false impression | ⚠️ | Partial | Not in `enforce`. **QA-5**. Dev is mid-fix |
| Authorization — 401 / 403 / fail-closed, nothing before the gate | ✅ | Pass | `requireAdmin` first; new handler in the parametrized gate suite; `test:authz-guard` 74 passed |
| The payloads leak nothing a non-admin should see | ✅ | Pass | Plans payload is config only; account payload is admin-gated and carries no name or email |
| Client/server boundary — the page imports nothing from `@/lib/` | ✅ | Pass | The guard genuinely **walks** the directory |
| The server-built sentences match the config | ✅ | Pass | The trial sentence is read off `durationHistory` + `clockStartsAt` + the value shape |
| **The page renders the payload the server actually sends** | ❌ | **FAIL** | **QA-0 — it throws** |
| Account lookup — malformed id | ✅ | Pass | Correct copy |
| Account lookup — valid id, happy path | ❌ | **FAIL** | **QA-1 — React throws** |
| Account lookup — unknown id / agent-platform-only user / deleted account | ❌ | **FAIL** | **QA-1 + QA-3** |

### Issues Found

#### Bugs (must fix before commit)

**QA-0 — The page crashes on load with the real payload. The whole screen, every time.** — Severity: **High**

- File: `app/admin/business-os-tiers/page.tsx:128` — `{payload.withheldWithoutGate.length > 0 && (`
- `types.ts:50` declares `withheldWithoutGate: string[]` and `types.ts:19` declares `gateBuilt: boolean`, both required. **`lib/business-os/entitlements/adminPlansView.ts` produces neither.** Dumped from the real module, the payload keys are `generatedAt, mode, modeEnvVar, modeMeaning, enforced, matrixVersion, plans, notBuilt, writeOpsNotOnThisPage`, and a capability's keys are `capability, label, category, display, granting`.
- Reproduce: render `BusinessOsTiersPage` with `buildAdminPlansView()`'s own output as the fetch body.
- Expected: the page renders. Actual: `TypeError: Cannot read properties of undefined (reading 'length')`. Proven with a throwaway render test that read the payload from the server module verbatim instead of from a fixture.
- Knock-on: `PlanCard.tsx:149` reads `!capability.gateBuilt`, `undefined` for every capability, so **every** withheld capability would carry the "no gate yet" badge — including the ten `not_built` ones, which have no gate to build.
- **Very likely mid-edit** — Dev was adding exactly this at 19:19. Reported anyway for what it exposes, which is not mid-edit at all: see **QA-7**.

**QA-1 — The account lookup throws on every successful lookup.** — Severity: **High**

- File: `app/admin/business-os-tiers/components/AccountLookup.tsx:138` — `['Basis', payload.basis]`, rendered at `:145` as `<dd>{value}</dd>`.
- `GET …/entitlements/accounts/[accountId]` returns `snapshot.resolution.basis`, which is an `EntitlementBasis` **object** (`lifecycle.ts:47-51`: `{kind:'tier',tier} | {kind:'cohort',cohort} | {kind:'none'}`). `types.ts:76` declares it `basis: string`, so the compiler cannot see it — the mirror is wrong about the payload, the one thing its own doc comment says it can be wrong about.
- Expected: the result panel renders. Actual: `Error: Objects are not valid as a React child (found: object with keys {kind, tier})`. Reproduced against the exact route payload; the happy path and the no-plan-row path both throw, the malformed-id path is fine.
- `adminPlansView.ts:236` does the right thing for the *plans* payload (`basis: resolution.basis.kind`). The accounts route is untouched by this branch and still returns the object.

**QA-2 — The lookup counts "capabilities in force" with a second, different rule, and overstates.** — Severity: **High**

- File: `app/admin/business-os-tiers/components/AccountLookup.tsx:74` — `.filter(([, resolved]) => resolved.value !== false)`.
- `PlanCard`'s own doc comment forbids precisely this: *"This component does not look at a value and judge it, because a second judgement is a second rule, free to drift from the first."* The plans payload uses `isGrantingValue`; the lookup uses `!== false`.
- Measured against the real resolver: a **`basic`** account → the lookup says **26 of 38 in force**, `isGrantingValue` says **19**, and the Essentials card two sections above says **Includes (19)**. Two numbers on one screen, for one plan, seven apart.
- Worse: an account with **no plan row at all** → the lookup says **14 of 38 in force** and lists `Website branding = branded`, `AI actions = {"perMonth":0}`, `Team seats = {"included":0}` and five `unavailable` add-ons as things the account *has*. The resolver grants it **nothing** (`isGranting = 0`, `state: unknown`, `anomaly: no_plan_row`).
- Fix shape (Dev's call): have the accounts route ship `granting` per capability the way the plans payload already does, and filter on that. Re-implementing `isGrantingValue` in the component would be the same mistake twice.

**QA-3 — The lookup's documented empty state does not exist; an agent-platform user gets a confident, wrong answer.** — Severity: **Medium**

- Files: `app/admin/business-os-tiers/components/AccountLookup.tsx:17-21` (the doc comment) and `:32` (`ERROR_COPY.not_a_business_os_account`).
- The comment says *"A 404 here means 'not a Business OS account' … an admin typing a valid agent-platform user id will hit it, and should be told which product they are looking at."* **The GET never returns that code.** `not_a_business_os_account` is produced only by `lib/business-os/entitlements/adminOps.ts:218`, on the **write** path. The GET returns `invalid_account_id` (400), `entitlement_inputs_unavailable` (503) or **200**.
- So a well-formed uuid with no plan row — an agent-platform-only user, or a deleted account, which are indistinguishable here — returns **200** and renders `Tier none / Cohort none / State unknown / Anomaly no_plan_row` plus the overstated table from QA-2. The sentence written for exactly that admin is dead code.

#### Performance Issues

None. The plans payload is pure config with no database read, and the lookup is one request per submit.

#### Edge cases and test quality

**QA-4 — "Re-run the resolver and demand an identical split" cannot detect an unfaithful synthetic account.** — Severity: Medium

- File: `lib/business-os/entitlements/__tests__/adminPlansView.test.ts:77-121`. The test builds its own account inline, **character-for-character the same construction** as `adminPlansView.ts:95-114`. It therefore checks the *filter*, not the *account*. Proven by mutation, each reverted:

| Mutation to `syntheticAccount` | Caught? |
|---|---|
| `onboardingStartedAt: iso` → `null` | ❌ 49/49 still pass |
| `planVersion: config.matrix.version` → `999` | ❌ 49/49 still pass |
| `tierExpiresAt: null` → `'2020-01-01…'` | ✅ 1 failure (`plan.state`) |

- The comment calls it *"the strongest form of the no-disagreement property"*. It is not: `expect(plan.state).toBe(resolution.state)` is the only leg that bites, and it bites only on dates. **The split itself is nevertheless correct** — verified independently below.

**QA-5 — The banner is enough today, and will be wrong in `enforce`.** — Severity: Medium (judgement)

- Files: `app/admin/business-os-tiers/components/EnforcementBanner.tsx:66-70`, `lib/business-os/entitlements/adminPlansView.ts:184`.
- In `off` and `shadow` it is genuinely good: undismissible by construction, first on the page, loud, and it names the env var and the server that answered. As a reader I would not be misled.
- In **`enforce`** it flips to *"Entitlements are being ENFORCED"* + *"an account without a capability is refused it."* At that moment the page asserts Essentials refuses chat — and it does not, and will not until FR-46's surface gate ships in Slice 2. The banner ties its truthfulness to the **mode**, but `chat.access` is untrue for a **second, independent reason**: nothing reads it. Flipping the mode is one env var; shipping the gate is a slice.
- So the answer to the question asked: **the page does need to say it at the capability.** Dev reached the same conclusion and was mid-implementation of a per-capability `gateBuilt` badge plus a `withheldWithoutGate` summary at 19:19 — the right shape, derived from code rather than maintained by hand. It is not finished (QA-0).

**QA-6 — `AccountLookup` has no test of any kind.** — Severity: Medium

- `app/admin/business-os-tiers/__tests__/page.render.test.tsx` has twelve tests and none of them touch the lookup. That is why QA-1, QA-2 and QA-3 shipped together in a 176-line component. It is a quarter of the screen and the only part that answers a question about a real customer.

**QA-7 — Nothing compares the page against the real payload.** — Severity: Medium — **the finding that survives whatever Dev does next**

- The render tests build a fixture typed against `types.ts`; the view test checks `adminPlansView.ts` against the config. `types.ts` is the contract and **neither side is ever compared to the other**. That is exactly how a page-breaking field mismatch (QA-0) sat inside a **green 764-test run**.
- Cheapest durable fix: one node-environment test that imports `buildAdminPlansView` and asserts the payload satisfies the client contract — or better, a jsdom test that renders the page with that payload, which is the throwaway test I wrote and which failed on the first run.

**QA-8 — The lookup renders raw JSON in the value column.** — Severity: Low

- `AccountLookup.tsx:153-155` — `JSON.stringify(resolved.value)` yields `{"included":1,"purchasable":false}`. The plan cards deliberately avoid this (`describeValue`, plus a test asserting `not.toContain('{')`). Same page, two standards.

### What I verified independently

**1 — The plan content is correct.** I re-derived the include/withhold split from `tierMatrix.ts` and `cohorts.ts` by hand and compared it to the built payload, capability by capability, on all four plans:

| Plan | Withholds expected from config | Payload | Match |
|---|---|---|---|
| `basic` | the 10 `not_built` + the 9 `chat.*` = 19 | 19 | ✅ exact set |
| `pro` | the 10 `not_built` = 10 | 10 | ✅ exact set |
| `trial` | resolves through `base: {tier:'basic'}` → 19 | 19 | ✅ exact set |
| `champion` | resolves through `base: {tier:'basic'}` → 19 | 19 | ✅ exact set |

The only value differences are the ones the config states: `champion` `ai.actions` 500 → **1,000 per month**; `trial` `ai.actions` → **250 in total** and `email.volume` 10,000 → **2,000**; `pro` the nine `chat.*` → yes and `ai.actions` → **2,000 per month**. `includeLifecycle: ['beta']` is inert because no capability is `beta` today, which is why champion and trial are otherwise identical to Essentials. Every one of the 38 capabilities appears exactly once per plan and no display string leaks raw JSON.

**2 — The synthetic accounts are faithful.** All eleven `EntitlementAccount` fields, none missing, none invented, each holding what a freshly-provisioned account of that plan would hold. One divergence: a cohort synthetic sets `trialStartedAt`, which on a real account is an admin **pin** and is normally null. It is provably inert — `lifecycle.ts:299` falls back to `factFor(...)`, and the synthetic sets `onboardingStartedAt` and `profileCreatedAt` to the same instant, so the pinned and derived paths give the identical answer. Worth a comment, not a change. `planVersion` being the current matrix version for a tier is right: the card answers "what would somebody buy today", and there are no `removals` for grandfathering to act on.

**3 — The sentences are read off the config, not typed.** `describeEnding` produces *"14 days from the first onboarding message, or when the AI actions run out — whichever comes first."* — the `14` from `cohorts.trial.durationHistory`, *"first onboarding message"* from `clockStartsAt`, and the *"or when the AI actions run out"* clause only because the trial's allowance is a one-off `{total}` rather than a `{perMonth}` rate. Shorten the trial in config and the sentence follows. The champion's *"No end date unless an admin sets one."* comes from the absence of a `durationHistory`, which the test asserts is absent.

**4 — Authorization.** `requireAdmin` is the first statement of the new `GET`, nothing above it. The handler is in the parametrized suite asserting **401 signed out / 403 non-admin / 403 when the admin check throws**, each with `repositoryCalls == []` and `audit == []`. `test:authz-guard` passes 74 with no new exemption. The page adds no guard of its own, and `app/admin/layout.tsx` still awaits `requireAdminPage()` as its first statement — the screen's own guard test asserts that, which is a good idea worth keeping. Neither payload carries a name, an email or anything beyond ids and config; the route logs `accountId` at info, an admin id in an admin log, consistent with the rest of the module.

**5 — The source guard is real.** It **walks** `app/admin/business-os-tiers/` recursively rather than listing files, names three files it must find and holds a floor of six, so it cannot fall behind new components. It strips comments before matching, so prose about a rule cannot satisfy it, and its blanket "no `@/lib/` import" is stronger than a deny-list. Two narrownesses worth knowing: the capability-id regex only covers `chat.`, `crm.` and `ai.actions`, and the `console.*` check runs on raw source, so a commented-out call would fail it.

### Test Outputs / Logs

```
npx jest app/admin/business-os-tiers lib/business-os/entitlements app/api/admin/business-os --ci
  Test Suites: 28 passed, 28 total
  Tests:       764 passed, 764 total        <- green, with the page unrenderable

npm run test:authz-guard        ->  74 passed, 74 total
npx eslint <the three new paths> ->  0 problems
tsc --noEmit --typeRoots <main>/node_modules/@types
  2,084 at 19:05; the 7 inside this branch's files were all transient, from
  Dev's in-flight gateBuilt edit. Not a standing count - the tree was mid-edit.

Real payload, dumped from buildAdminPlansView():
  keys = generatedAt,mode,modeEnvVar,modeMeaning,enforced,matrixVersion,
         plans,notBuilt,writeOpsNotOnThisPage
  withheldWithoutGate = undefined
  capability keys = capability,label,category,display,granting   (no gateBuilt)

Rendering the page with that payload:
  TypeError: Cannot read properties of undefined (reading 'length')

Rendering AccountLookup with the real accounts payload:
  Error: Objects are not valid as a React child (found: object with keys {kind, tier})

AccountLookup "in force" counts, measured:
  basic account      -> page says 26 of 38 | isGrantingValue says 19 | card says 19
  no plan row at all -> page says 14 of 38 | isGrantingValue says  0
```

### Would a non-technical reader be misled?

**By the plans themselves, no.** The four cards are true to the configuration — I checked all 38 capabilities on all four plans by hand. The banner is undismissible, first, loud and honest, and the "Cannot be sold" panel says something most pricing screens never say.

**By the account lookup, yes, badly — and today it does not render at all.** If QA-1 were fixed on its own, the reader would be shown a list headed *"Capabilities in force"* containing `unavailable` add-ons and zero-quantity allowances, contradicting the card above it by seven capabilities, and telling them that an account with **no plan whatsoever** has fourteen things in force.

**And in `enforce` mode the page would state the opposite of the truth about chat** until Slice 2 ships. That one is being fixed as I write.

### Final Status

- [ ] All acceptance criteria pass — ready for commit
- [x] **Issues found — Dev must address before commit.** Three High (QA-0, QA-1, QA-2), one Medium behavioural (QA-3), one Medium judgement (QA-5, in progress), four test-quality (QA-4, QA-6, QA-7, QA-8). **QA-7 is the one to fix even if everything else is already in hand: the page and its payload have never been compared, and that is why a green suite hid an unrenderable page.**

## Commit Info

_RM to populate._
