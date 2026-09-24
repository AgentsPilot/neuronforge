# Workplan: Business OS Tiers — admin page (read-only v1)

> **Last Updated**: 2026-09-24

**Developer:** Dev
**Requirement:** none yet — this is the user's direct request relayed by TL after he saw `app/admin/onboarding/page.tsx` and asked for "that UI concept, but its own page". The entitlements behaviour it renders is specified in [BUSINESS_OS_SUBSCRIPTION_ENTITLEMENTS_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_SUBSCRIPTION_ENTITLEMENTS_REQUIREMENT.md) and the config is §4.32 of [business-os-subscription-entitlements.md](/docs/workplans/business-os-subscription-entitlements.md).
**Date:** 2026-09-24
**Status:** Code Complete — for SA review

**Branch:** `feature/business-os-tiers-admin-page`.

> **Branched from the tier branch, before PR #103 merged — now resolved.**
> This branch starts at `c065021e`, the head of `feature/business-os-entitlement-tiers`, which was `main` merged in plus the tier config. At the time that was necessary: the page renders the four plans **from the same config the resolver uses**, and while #103 was open `main` still shipped `TIER_ORDER = []`, no `presentation` block and no `chat.access` — a page built on it would not have compiled.
>
> **PR #103 is now MERGED**, so `main` carries the config and the reason is historical. The base commit is still the tier branch head, so **RM should rebase onto `main`** — the diff is additive (new files plus one sidebar entry), and the tier config it depends on is now upstream of it either way.
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
| Affected scope (`entitlements`, `api/admin/business-os`, both admin screens, authz guard, scripts, migrations) | **43 suites, 1,222 tests**, 0 failures (after three QA rounds) |
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

## Review rounds

### SA (§13.11) — R-1, R-2, R-3 and two low items

| Item | What was done |
|---|---|
| **R-1** the banner is not enough for `chat.access` | The caveat now sits **at the capability**, in the same chip shape as the write-ops list, and it is **self-clearing**. What drives it: `config/enforcementPoints.ts`, a registry of capability → the files that gate it, empty today because Slice 1 wired no call site. The page reads `gateBuilt` per capability and a `withheldWithoutGate` summary. It is not a note anyone must remember to delete, because the registry is checked **both ways**: every file it names must exist and contain that capability id, and a source scan fails if any product file names a capability the registry does not know about. So a gate cannot ship while the page still says none exists, and registering it is what clears the marker |
| **R-2** the resolver re-run rebuilds the synthetic | The comment no longer claims to be "the strongest form" and says what it does prove. The synthetic is now pinned two ways: its **11 fields asserted as values** (not rebuilt), and the resolved **state and basis per preview**, which are outputs a wrong synthetic changes |
| **R-3** the source guard only knew `@/lib/` | It now tests where a specifier **resolves**: an aliased import outside the screen, or a relative one that escapes it, both fail. With a negative control proving `../../../lib/...` is caught |
| SA low: the lookup takes an id | The page says so, and why: an email search would make a plan-configuration screen a way to **search people**. It points at `/admin/users`, which does that properly |
| SA low: propagate the layout-guard pattern | Written into [ADMIN_IDENTIFICATION_AND_ACCESS.md](/docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md) § *If your page inherits its protection, pin the thing that provides it* — the code, why FIRST-statement rather than "the call exists", why it belongs in the dependent's suite, and the generalisation to anything whose safety lives in another file |

⚠️ If §13.11 carries a **third** low item, I could not read it — the section is in neither workplan in my tree. Name it and it is done.

### QA — three High, one Medium, and the finding that outlives them

| Finding | Fix |
|---|---|
| **High-1** the page did not render: `withheldWithoutGate` / `gateBuilt` were never emitted | Confirmed and closed. Two of my edits had silently no-op'd (a `str.replace` with no assertion), so the interfaces carried the fields while the payload did not. **Now verified against the REAL payload, not a fixture** — see QA-7 |
| **High-2** `basis` rendered as a React child | The route sends the resolver's `EntitlementBasis` **object**. `types.ts` said `string`, which is why the compiler could not see it. The type now describes the object, and the component renders `kind` plus the tier or cohort name |
| **High-3** a second granting rule in the lookup | `value !== false` is gone. `isGrantingValue` — the one rule — now runs **server-side** in the accounts route, which sends `granting` per capability. The component cannot hold a second opinion because it is not given the means to form one |
| **Medium** the documented 404 was unreachable | The read path now runs the **same tenancy check as the write path**, from the same two repositories, and returns 404 `not_a_business_os_account`. A test asserts both paths answer the same way, so they cannot drift |
| **QA-7** nothing compared the page to the payload the server sends | Two new contract suites, below |
| **Vacuity** the account test rebuilt the account it was testing | Fixed with R-2. Both QA mutations now fail: `onboardingStartedAt → null` (5 failures), `planVersion → 999` (2 failures) |

#### The two contract suites, and how they would have caught the crash

**`payload.contract.test.tsx`** calls `buildAdminPlansView()` — the real server module — and renders the real page against its real output. Nothing in it declares a shape. Removing `withheldWithoutGate` from the payload again turns **6 tests red**, starting with *"renders at all — the assertion that was missing"*; before it existed, that same deletion left every suite green while the page rendered nothing. It also pins the payload's keys at three levels, so a field the server stops sending is a named failure rather than a blank screen.

**`accountLookup.contract.test.tsx`** does the same for the other payload, which is where High-2 and High-3 both lived. The route cannot be imported into jsdom (`next/server` needs `Request`, `ReadableStream`, `MessagePort`; polyfilling them hung the suite), so the body is **recorded verbatim** from the real route into `__fixtures__/recordedAccountBody.json`, and `routes.test.ts` asserts the route still deep-equals that recording. The component is rendered against it. The two halves meet.

The recorded body is also **assigned to `AccountPayload`**, which is the check that would have caught High-2 at compile time: an object does not assign to `string`.

#### Where else the same gap could be

Those are the only two payloads this screen consumes. Both are now covered. The pattern worth copying elsewhere: *a fixture is a statement of what we believe the server sends; something must compare it to what the server does send.*

### QA round 2 — NEW-1 to NEW-7, QA-8, and a second recording

| Finding | Fix |
|---|---|
| **NEW-1** (Med) 10 of the 19 "no gate yet" capabilities are `not_built` | A capability that does not exist needs no gate, so `gateBuilt` is now true for every `not_built` one. The list is **9**, all real, and `chat.access` is one chip in nine rather than one in nineteen. Three tests make the two panels unable to contradict each other again: **no capability may appear in both**, no `not_built` capability may be marked on a card, and every survivor must have a lifecycle that is not `not_built` |
| **NEW-2** (Med) two tenancy rules that disagreed | `isBusinessOsTenant` is **exported** and the read path calls it. The difference mattered: the private one short-circuits on a profile hit, so an account with a profile and a failing onboarding read is a tenant — the re-implementation 500'd on it. Two tests pin the behaviour from both sides: a check that cannot answer is a 500 on the read path, and a profile hit with a failing onboarding read is **200 on the read and 200 on the write** |
| **NEW-3** (Med) `tenant_check_failed` had no copy | Added, with the other missing one. The lists are now **pinned to each other**: the suite reads the GET handler's source, collects every `error: '…'` it can return, and asserts each renders as a sentence rather than a code. Demonstrated — deleting the copy again turns that case red with `Could not read that account (tenant_check_failed).` on screen |
| **NEW-4** (Low) the lookup suite was thin for CI | The id is **pasted, not typed**: one event instead of 36 per test, and the budget is raised to 20s |
| **NEW-5** (Low) the scan only matched quoted literals | The marker's self-clearing property is now carried by a second rule: **anything outside the module that IMPORTS it** must be registered or exempt with a reason. A gate written as `decide({ capability: CHAT_SURFACE })` is caught by that even though it writes no id. It immediately found the file the FR-46 gate will live in — `chat-v4/route.ts` — and its exemption is itself checked: the suite asserts that file still only calls `shadowChatPlan` and contains **no** `decide(`, `.check(`, `requireEntitlement` or `withEntitlement`. So "known non-gate" cannot become a place for a gate to hide |
| **NEW-6** (Low) two controls that could not fail | Both replaced. `{...real, x: null} !== real` is true of any object; it now asserts the **written-out expectation** rejects each mutation. And the enforcement-point control now calls `hasEnforcementPoint` for real, against a registry that has an entry — which needed the function to take the registry as a parameter, since the shipped one is empty |
| **QA-8** (Low, carry-over) the lookup printed raw JSON | One formatter now, `capabilityDisplay.ts`, server-side, used by both payloads. The lookup renders `display`; the column shows `1 seat`, not `{"included":1,"purchasable":false}` |
| **Coverage** the no-plan-row panel was untested | Second recording: `recordedAccountBodyNoPlanRow.json`. **0 of 38 in force** where the old rule listed 14, `unknown` state, `none` basis. Both recordings are kept fresh by the route suite |

**SA's R-4** (the "strongest form" comment) was already done.

#### On NEW-1, which is the one a reader would have noticed

The page said *"nothing asks"* about ten capabilities **that do not exist**, three lines above a panel headed *"Cannot be sold (10)"*. Both sentences were true of the code and together they were misleading: for a feature that is not built, "nothing refuses it yet" reads as *a customer can get this*. The fix is one clause in the view and three tests that make the contradiction impossible rather than merely absent.

#### Re-verified

| Check | Result |
|---|---|
| Affected scope | **43 suites, 1,217 tests**, 0 failures |
| Typecheck, the verified method | **2,077** — the branch base — **0** in any file this change touches |
| ESLint (screen, entitlement routes, entitlements module) | clean |

### QA round 3 — R3-1: the exemption was a denylist, and a gate walked through it

QA attacked the eight closures and cleared seven. The eighth is the one this screen's whole R-1 mechanism rests on.

**The reproduction, run here before fixing anything.** QA added to `app/api/business-os/chat-v4/route.ts` an import of `resolveEntitlements` and a function called `qaChatSurfaceGate` — a plausible FR-46 surface gate, with **no capability literal anywhere**. All **16** enforcement tests stayed green, and the admin screen would have gone on saying "no gate yet" for `chat.access` after the gate shipped. Three rules and not one of them saw it:

| Rule | Why it missed |
|---|---|
| The quoted-literal scan | The gate writes no capability id |
| The import rule (NEW-5) | chat-v4 is already an exempt importer |
| The claim-check | A **denylist** of `decide(`, `.check(`, `requireEntitlement`, `withEntitlement` — and the call was called `qaChatSurfaceGate` |

**A denylist has to predict the name somebody will choose.** That is the defect, and it is not fixable by lengthening the list.

#### The fix: an allow-list of imported SYMBOLS, for every exemption

A gate must reach the resolver **through some imported symbol**. So each exempt importer now declares exactly what it may import, and the suite asserts set equality:

| File | May import |
|---|---|
| `chat-v4/route.ts` | `shadowChatPlan` — the one symbol that cannot refuse anything |
| `entitlements/plans/route.ts` | `buildAdminPlansView` |
| `entitlements/accounts/[accountId]/route.ts` | the ten it uses, named |
| `entitlements/launch/route.ts` | `getEntitlementConfig` |
| `entitlements/shadow-report/route.ts` | `buildShadowReport`, `getEntitlementMode` |

**Verified by reproducing QA's mutation against the new rule:** it fails immediately, naming the file and the extra symbol, and the mutation was reverted afterwards (`chat-v4/route.ts` is byte-identical to `HEAD`). The reader itself has a non-vacuity test, because a symbol reader that silently returned `[]` would make every one of those assertions pass on a file full of gates.

**The other exemptions had the same shape** — they were `why` strings, which are declarations, not checks. All five are now checked the same way. Adding an import to any of them fails this suite until a human says which kind it is.

#### NEW-6 remainder, and the hunt for a third

The two tails QA named compared **two local literals** and could not fail. Deleted: the by-value tests above them already catch both mutations, and the case now proves that by mutating the **subject** (`trial.onboardingStartedAt` is the instant, `basic.planVersion` is the matrix version) rather than the expectation.

I then scanned every test file in this branch's three trees for the class — a negated assertion whose both sides are locally built with no call into the subject. **26 files, 32 negated assertions, no third instance**: every other one reads real source, a real payload or a real resolution.

#### Minor

The error-code extractor is quote-agnostic now (`'`, `"` and backtick, with a backreference so the quotes must match).

#### Not ours, and worth its own task

`app/api/business-os/chat-v4/__tests__/route.audit.test.ts` **kills the Jest worker**: a mock throws `profile read failed for OWNER-TEXT-MARKER-c1 cancel` outside any assertion, so the process exits rather than the test failing. It is byte-identical to `HEAD`, introduced by `8809ffd2` which is an ancestor of `origin/main` — **inherited, not this branch's**.

It matters more than an unrelated red test usually would: that file is the home of the FR-46 gate, and therefore of the exemption the whole self-clearing mechanism now rests on. **Recommend a separate task** — it is a different area (BOS LLM audit), it needs whoever owns that suite, and folding it in here would mix an unrelated fix into a page review. What this branch does instead is make the *source-level* rule cover that file, which does not depend on its test suite running.

#### Re-verified

| Check | Result |
|---|---|
| Affected scope | **43 suites, 1,222 tests**, 0 failures |
| Enforcement-point suite | 21 tests, and QA's mutation now fails it |
| Typecheck, the verified method | **2,077** — the branch base — **0** in any file this change touches |
| ESLint (screen, entitlement routes, entitlements module) | clean |
| `chat-v4/route.ts` | byte-identical to `HEAD` — the mutation left no trace |

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

---

## QA Testing Report — round 2 (re-verification)

**QA — 2026-09-24, 21:05**
**Test mode:** regression on the fixes + full adversarial re-check
**Strategy used:** A + B + the jsdom render path, plus **mutation testing** as the primary instrument. Every fix was attacked by reintroducing the defect it claims to close and confirming the suite goes red; every new guarantee was attacked by asking what it would miss.
**Input source:** prompt keywords (five numbered re-check items)
**Tree state:** implementation still uncommitted, nothing of it touched by me. Docs at `6a925e96`.

### Verdict

**The three High and the Medium are genuinely closed. I could not break any of them.** Four new Medium/Low findings remain, one of which is a truth-on-screen issue in the very mechanism added to fix a truth-on-screen issue.

### 1. Every fix, attacked

Each mutation was applied to the real source, the suite run, and the file restored from a backup; the tree is byte-identical afterwards and green.

| # | Mutation — the defect, put back | Result | Verdict |
|---|---|---|---|
| M1 | drop `withheldWithoutGate` from the payload (**the exact High-1 defect**) | **6 failed** / 9 | ✅ matches Dev's claim of 6, exactly |
| M2 | drop `gateBuilt` from every capability | **3 failed** / 9 | ✅ |
| M3 | the route grows a field the recording lacks | **1 failed** / 36 | ✅ the deep-equal bites |
| M4 | the recording loses a key the route still sends | **1 failed** / 42 | ✅ the deep-equal bites both ways |
| M5 | register a gate file that does not exist | **2 failed** / 17 | ✅ the forward check bites |
| M6a | `syntheticAccount.onboardingStartedAt` → `null` (my round-1 vacuity mutation) | **5 failed** / 25 | ✅ matches Dev's claim of 5 |
| M6b | `syntheticAccount.planVersion` → `999` (my second one) | **2 failed** / 25 | ✅ matches Dev's claim of 2 |
| M7 | the route stops sending `granting` (**the High-3 defect**) | **3 failed** / 42 | ✅ |

**Dev's compile-time claim is true, and I checked it rather than took it.** Forcing `AccountPayload.basis` back to `string` produces **`TS2352` at `accountLookup.contract.test.tsx:56`** — *"neither type sufficiently overlaps"* — plus seven consequent errors in the component. So the recorded-body assignment really is the check that would have caught High-2 before a render. I also tried the mirror defect, which is the one that caused High-1: adding a required field to `AccountPayload` that the recording lacks is caught at `accountLookup.contract.test.tsx:56`, and adding one to `PlansPayload` the server never sends is caught at `page.render.test.tsx:67`. **Both contracts fail in both directions.**

### 2. Do the two contract suites close QA-7? — Yes, and I verified the claim under them

Dev's claim is *"those are the only two payloads this screen consumes"*. **I checked it myself** rather than accepting it: `grep` for `fetch(` across the whole screen returns exactly two call sites — `page.tsx:53` (`/plans`) and `AccountLookup.tsx:67` (`/accounts/[accountId]`) — and there is no `require`, no dynamic `import`, no third endpoint. The claim holds **for success bodies**.

**It does not hold for error bodies, and that is NEW-3 below.**

The two suites are also built differently, which is worth recording: the **plans** contract is enforced at *runtime* (the real builder rendered through the real page, plus key-lists at three levels), the **accounts** contract at *compile time* (the recorded body assigned to `AccountPayload`) **and** at runtime. Neither mechanism is the weaker one; they close different halves.

### 3. The recorded body — can it go stale in a way that passes?

This was the sharpest question asked, so it got the sharpest test. **No, not in the ways that matter**, because the recording is not compared to a hand-written expectation — it is compared to the **live route running the real resolver over the real config**. The repositories are mocked, but `capabilities` is produced by `getSnapshot` → `resolveEntitlements` → the real catalog and the real matrix. So:

| If this changes | Does the deep-equal notice? |
|---|---|
| the route adds or removes a field | ✅ M3 |
| the recording loses a field | ✅ M4 |
| a capability is added to the catalog | ✅ the `capabilities` map gains a key |
| a tier's value changes | ✅ the resolved value changes |
| `isGrantingValue` changes | ✅ `granting` flips |

**The residual is coverage, not staleness:** the recording is one account — `basic`, no overrides, no anomaly — so the component is only ever rendered in that state. A **tenant whose plan row is missing** still reaches the panel (the new 404 only catches non-tenants), and renders `basis.kind === 'none'`, `anomaly: no_plan_row`, `plan: null`. That path is correct today — with server-side `granting` it now reads *"Capabilities in force (0 of 38)"*, which is the truth — but nothing tests it, and it is the state this screen was most wrong about a round ago.

### 4. The enforcement registry — can the both-ways check be satisfied vacuously?

**The backward half is not vacuous**: it walks 300+ product files (with a `> 300` floor so a broken file list cannot pass silently), strips comments first, and currently finds exactly one hit — `LanguageContext.tsx` naming `payments.invoices` — which is exempted per *(file, capability)* pair with a reason and a ratchet asserting the file still names it. The exemption **hides nothing**: it is scoped to that one pair, so any other capability in that file would still fail. That is the right shape.

**The forward half bites** (M5: a registered file that does not exist → 2 failures).

**But the claim is stronger than the check — NEW-5 below.**

### 5. Nothing I had confirmed correct was disturbed

| Previously confirmed | Now |
|---|---|
| the 19 / 10 / 19 / 19 include-withhold split | **unchanged** — re-dumped the real payload and re-compared to the config by hand |
| the synthetic accounts, all eleven fields | **unchanged**, and now *asserted by value* per plan kind via the newly exported `previewAccountFor` |
| the recorded account body's granted count | **19 of 38** for `basic` — the same number I derived independently in round 1, now produced by the route |
| authorization | `requireAdmin` still first in both handlers; 401 / 403 / fail-closed still parametrized over every handler; `test:authz-guard` **74 passed**, no new exemption |
| lint / typecheck | ESLint **0 problems**; tsc **2,077**, with **zero in any file this branch creates or touches** — Dev's stated baseline, confirmed |
| scope suite | **30 suites, 789 tests** |

### New findings

**NEW-1 — The "no gate yet" marker is on 10 capabilities that cannot have a gate, and it says the product allows them.** — Severity: **Medium**

- Files: `lib/business-os/entitlements/adminPlansView.ts:282-288`, `app/admin/business-os-tiers/page.tsx:133-141`, `components/PlanCard.tsx:149-156`
- `withheldWithoutGate` is **19** entries, and **10 of them are the `not_built` capabilities** — `payments.reminders`, `marketing.posts`, `sms.messages`, the five `addon.*`, `website.custom_domain`, `marketing.mass_email`. The heading reads *"Withheld in the plan, not yet refused by the product"*, the body reads *"the configuration says no and nothing asks"*, and each one carries an amber chip whose tooltip says *"Withheld by the plan, but nothing in the product refuses it yet."*
- For a capability whose feature **does not exist**, that is read as *"a customer can currently get this despite their plan"*, which is false — there is nothing to refuse. The page says so itself, sixty pixels below, in **Cannot be sold (10)**.
- It also **dilutes the one entry that matters**: `chat.access` — the whole reason SA asked for R-1 — is 1 chip in 19 amber chips.
- Suggested shape (Dev's call): exclude `lifecycle === 'not_built'` from `withheldWithoutGate` and from the badge, since the not-built panel already carries them with better evidence; the summary then reads **9**, and every one of the nine is a real commercial gap.

**NEW-2 — The tenancy rule is now a second copy of itself, and the two copies disagree under a repository error.** — Severity: **Medium**

- Files: `app/api/admin/business-os/entitlements/accounts/[accountId]/route.ts:78-90` against `lib/business-os/entitlements/adminOps.ts:253-261`
- `isBusinessOsTenant` is **private** to `adminOps.ts`, so the route re-implements it. The implementations are not equivalent: `adminOps` reads the profile and **short-circuits on a hit**, reading onboarding only when there is no profile; the route reads **both in `Promise.all`** and returns 500 `tenant_check_failed` if **either** errors.
- So for an account **that has a profile** whose onboarding read fails: the **write** path says "tenant, proceed"; the **read** path says 500. The route's own comment states *"the same rule as `isBusinessOsTenant`, so the two paths cannot disagree about what a tenant is."*
- It fails in the safe direction and the test that "asserts both paths answer alike" exercises only the tenant / non-tenant cases, not the error case — the same shape as the vacuity class already twice found here. **Fix: export `isBusinessOsTenant` and call it from both.** That is the only version of this that cannot drift.

**NEW-3 — The third contract nobody checks: the error vocabulary. A code Dev added in this very fix has no copy.** — Severity: **Medium**

- Files: `app/admin/business-os-tiers/components/AccountLookup.tsx:43-49` against the route's four codes
- The GET now returns **`invalid_account_id`** (400), **`tenant_check_failed`** (500, new in this fix), **`not_a_business_os_account`** (404, new in this fix) and **`entitlement_inputs_unavailable`** (503), plus the catch-all `Internal server error`. `ERROR_COPY` names three. **`tenant_check_failed` is not one of them**, so an admin whose tenancy read fails is shown `Could not read that account (tenant_check_failed).`
- Nothing pins the two lists together — no test, no type. This is **QA-7 one layer down**: the success payload now has a contract, the failure payload does not, and the first thing added after the contract landed already fell through the hole. Round 1's `not_a_business_os_account` was dead copy for the same reason.
- Cheapest fix: export the route's error codes as a union and key `ERROR_COPY` by it, so an unhandled code is a compile error rather than a string in front of an admin.

**NEW-4 — `accountLookup.contract.test.tsx` is flaky under load: 2 tests failed in 1 of 6 full-scope runs.** — Severity: **Low** (honest caveat below)

- The suite takes 26–41 s, uses `userEvent.type` of a 36-character uuid (36 awaited events) before every assertion, and relies on Jest's default 5 s per-test timeout and `waitFor`'s default 1 s. It passed in isolation and in five of six scope runs; the failing run overlapped a heavy `tsc` **that I was running**, so I caused the contention and say so.
- It still matters: CI machines are contended too, and this is the suite whose entire job is to be the thing that catches a page-breaking regression. **An intermittently red contract suite gets re-run and ignored, which is exactly how the next green run hides the next broken page.** A `testTimeout`, or seeding the input with `fireEvent.change` instead of 36 keystrokes, removes it.

**NEW-5 — "A gate cannot ship unregistered" is stronger than the check.** — Severity: **Low**

- File: `lib/business-os/entitlements/__tests__/enforcementPoints.test.ts:146`
- The backward scan matches only **quoted string literals**: `code.includes("'" + capability + "'")`. A gate written with an imported constant, a template literal, or a capability looked up through a map — and `chatActionMap.ts`, which already maps chat actions to capabilities, lives inside `lib/business-os/entitlements/`, which `NOT_A_GATE` excludes **wholesale** — will not be found. The plausible Slice 2 shape (`decide({ capability: CHAT_SURFACE })` in a chat route) produces **no hit**, and the page goes on saying "no gate yet" after the gate ships.
- Same class, smaller: the source guard's import rule (`source.guard.test.ts:67`) matches only `from '…'`, so `require()` and dynamic `import()` walk past it.
- Neither is a defect today. Both are claims that should be narrowed to what they do, as R-4 taught: *"a gate cannot ship unregistered as a bare string literal"* is still a good rule and is honest.

**NEW-6 — Two "negative controls" that cannot fail.** — Severity: **Low**

- `lib/business-os/entitlements/__tests__/adminPlansView.test.ts:278-285` — *"the two QA mutations are caught, and the assertion says which"*:
  ```ts
  expect({ ...real, onboardingStartedAt: null }).not.toEqual(real);
  ```
  This is true for **any** object with any field. It passes if `previewAccountFor` returns `{}`. It tests `toEqual`, not the preview. Its own comment says *"Without it, the expectations above are just three more copies of the same object"* — it provides no such protection.
- `lib/business-os/entitlements/__tests__/enforcementPoints.test.ts:183-188` — *"would report a gate the moment one is registered"* builds a local literal `withGate` and asserts on it. **`hasEnforcementPoint` is never called.** It reduces to `expect(true).toBe(true)`.
- The real protection is elsewhere and **does** work — my M6a/M6b/M5 runs prove the by-value assertions and the forward check bite. These two add nothing and read as coverage, which is worse than absent.

**NEW-7 — The gate suite's "nothing was read before the refusal" now has two blind repositories.** — Severity: **Low**

- The accounts GET reads `businessProfileRepository` and `onboardingConversationRepository` before the snapshot; neither mock pushes to `repositoryCalls` (`routes.test.ts:126-145`), which only `findEntitlementInputs` does. `expect(repositoryCalls).toEqual([])` on the 401 / 403 / fail-closed tests therefore no longer covers everything the handler reads. The assertion is still **true** — the gate returns first — but it is now narrower than it reads.

**Carry-over — QA-8 (Low), unfixed:** `AccountLookup.tsx:191` still renders `JSON.stringify(resolved.value)`, so the value column shows `{"included":1,"purchasable":false}` — the thing the plan cards deliberately avoid and assert against.

### SA's third low item

It is **R-4**: *"the 'strongest form' comment overclaims."* Dev's table above accounts for R-3 and R-5 (as *"the lookup takes an id"*) and adds a fifth item SA did not list (propagating the layout-guard pattern), which is why the count came out one short. **R-4 is already done** — `adminPlansView.test.ts:81` now opens *"SA R-2: this is NOT the strongest form, and the comment used to claim it was"*, and states what the test does prove. All three of SA's lows are closed.

### Would a non-technical reader be misled?

**Not about the plans.** The four cards, the prices, the allowances, the endings and the include/withhold split are true to the configuration — re-verified capability by capability after the changes.

**Not about the account any more.** The panel renders, the count is the resolver's, and an id that is not a Business OS account is told so instead of being given a plan.

**Yes, mildly, about the product — NEW-1.** A reader who counts the amber chips concludes that nineteen things a plan withholds are currently obtainable. Nine are. The other ten do not exist, which the same page says in a different panel. It errs toward over-warning, which is the safe direction, and it is a copy-and-filter change rather than a design one.

### Final Status

- [x] **Ready for the user's review.** The three High and the Medium are closed, and I could not break them.
- [ ] Not yet ready to commit. **Fix first: NEW-1** (the page's own truth standard) **and NEW-3** (a raw error code in front of an admin, added by this fix) — both small. **NEW-2** should be the exported-function version before this pattern is copied. NEW-4 to NEW-7 and QA-8 are follow-ups that need not hold the commit, but NEW-6 should be deleted rather than left reading as coverage.

---

## QA Testing Report — round 3 (final re-verification)

**QA — 2026-09-24, 22:05**
**Test mode:** targeted regression on the eight closures, proportionate
**Strategy used:** mutation first. Eight mutations against the eight claims, each applied to real source, run, and reverted. Only where a mutation could not settle a question did I read.
**Input source:** prompt keywords (six ranked items)
**Tree state:** implementation uncommitted and untouched by me; docs at `f3d7b967`; `origin/main` merged in.

### Verdict

**Seven of the eight closures hold under attack. One does not, and it is the one asked about first.**

| # | Mutation — the claim, attacked | Result | Verdict |
|---|---|---|---|
| **P1** | **a plausible FR-46 gate added to `chat-v4`: imports a new symbol from the module, no capability literal, call named `qaChatSurfaceGate`** | **16 passed, 0 failed** | ❌ **NOT caught — see R3-1** |
| P1b | the same gate, written as `decide(` | 1 failed | ✅ caught |
| P2 | a brand-new product file importing the entitlements module | 1 failed | ✅ caught |
| P3 | a fifth error code in the GET handler, no copy | 1 failed | ✅ caught |
| P4 | `not_built` back in `withheldWithoutGate` (the NEW-1 defect) | **3 failed** | ✅ caught |
| P5 | `hasEnforcementPoint` ignores its injected registry | 1 failed | ✅ caught |
| P6 | the read path answers 404 where the write path answers 500 | 1 failed | ✅ caught |
| P7 | the shared formatter emits raw JSON again | 1 failed | ✅ caught |
| — | baseline and after-restore | **106 / 106 both** | tree byte-identical |

### R3-1 — The chat-v4 exemption is a denylist, and I got a gate through it — Severity: **Medium**

- File: `lib/business-os/entitlements/__tests__/enforcementPoints.test.ts` — the test *"the chat route still only RECORDS — the claim its exemption rests on"*
- The exemption's claim-check is `expect(chat).toContain('shadowChatPlan')` plus **four forbidden substrings**: `decide(`, `requireEntitlement`, `withEntitlement`, `.check(`. That is a **denylist of call names**, and the comment above it says *"Without this, 'known non-gate' would be a place for a gate to hide."*
- **It still is.** I added to `app/api/business-os/chat-v4/route.ts` exactly what a Slice 2 author plausibly writes:
  ```ts
  import { shadowChatPlan } from '@/lib/business-os/entitlements/shadow';
  import { resolveEntitlements } from '@/lib/business-os/entitlements/resolver';
  const qaChatSurfaceGate = async () => { … };
  ```
  No capability literal, so the literal scan sees nothing. chat-v4 is already in `KNOWN_NON_GATE_IMPORTERS`, so the new import rule sees nothing. The call is not one of the four names, so the claim-check sees nothing. **All 16 enforcement tests stayed green**, and the page would go on saying *"no gate yet"* for `chat.access` after the gate shipped.
- Rename it `decide(` and it is caught (P1b). Put the same gate in a **new** file and it is caught (P2). The hole is exactly the one file the exemption names as *"the file the real gate will be added to (FR-46)"*.
- **The property the coordinator asked me to confirm — that the FR-46 gate cannot ship while the page still says "no gate" — does not hold.** It holds for a gate written one of four ways, in the one file that matters.
- **Fix, and it is one assertion:** make the claim an **allow-list of imported symbols** rather than a denylist of call names. chat-v4 imports exactly one thing from the module today (`shadowChatPlan`, line 108). Assert that set equals `['shadowChatPlan']` and P1 fails immediately, because a gate must reach the resolver through *some* symbol. Combined with the literal scan the cover is then complete: a gate in chat-v4 must either name a capability (scan), or import something new (allow-list), or use only `shadowChatPlan` — which records and can refuse nothing.
- Dev is right that NEW-5 was understated, and the second rule is a real improvement — it catches every gate **outside** chat-v4. This is the remaining corner, and it is the corner FR-46 lands in.

### The other five items

**2. NEW-6's replacements can fail.** The enforcement control now calls `hasEnforcementPoint` against an injected non-empty registry, checks a negative, and checks that a key with an empty array is **not** a gate; making the function ignore its parameter turns it red (P5). The account control's first assertion — `previewAccountFor(config,'trial',NOW)` against a written-out object — is real. **Two of its three assertions are still tautological**, though: `expect({ ...expectedTrial, onboardingStartedAt: null }).not.toEqual(expectedTrial)` compares two local literals and is true of any object and any mutation, and the `planVersion: 999` one differs on that field alone regardless of what the function returns. The real protection is the by-value tests above them, which do bite (proven in round 2: 5 and 2 failures). **Low** — delete the two tails rather than leave them reading as controls.

**3. NEW-1 re-derived independently.** I dumped the real payload and computed the sets myself: `withheldWithoutGate` is **exactly the nine `chat.*` capabilities**, the intersection with the ten `not_built` is **empty**, and **no card marks a `not_built` capability**. `chat.access` is 1 in 9. The 19 / 10 / 19 / 19 split is unchanged. Three tests hold it (P4 → 3 failures), and the one that matters most asserts the *property* — every survivor's lifecycle is not `not_built` — rather than the number 9, so it survives a catalog change.

**4. NEW-3 closed.** The suite reads the GET handler's own source for every `error: '…'` and asserts each renders as a sentence not containing the code. I added a fifth code with no copy: **red** (P3). The extraction is quote-specific (`/error:\s*'…'/`), so a code written with double quotes or a template literal would be missed — worth knowing, not worth fixing now.

**5. NEW-2 properly closed.** `isBusinessOsTenant` is now **one exported function** called by both paths (`adminOps.ts:257`, `accounts/[accountId]/route.ts:85`), not two implementations agreeing by inspection. Making the read path answer differently is caught (P6). The case Dev says was false before — profile found, onboarding read failing — now answers **200 on read and 200 on write**, because the shared function short-circuits on the profile hit.

**6. The second recording and the formatter.** `recordedAccountBodyNoPlanRow.json` is the no-plan-row tenant: `state: unknown`, `basis: {kind:'none'}`, `anomaly: no_plan_row`, `plan: null`, and **0 of 38 granting** — where the old `value !== false` rule said 14. It is deep-equal-pinned in `routes.test.ts:513` and rendered in the lookup contract, and it is assigned to `AccountPayload`, so it carries the same compile-time protection as the first. `capabilityDisplay.ts` is one `server-only` formatter used by both payloads; the lookup renders `resolved.display` rather than `JSON.stringify` (`AccountLookup.tsx:207`), no display in the real payload contains `{`, and making the formatter emit raw JSON is caught (P7).

### Numbers

| Check | Result |
|---|---|
| Wide scope (`app/admin`, `lib/business-os/entitlements`, `app/api/admin/business-os`, `lib/admin`, `supabase/migrations`, `scripts/__tests__`) | **45 suites / 1,230 tests, 0 failures** — consistent with Dev's 43 / 1,217 on a marginally narrower scope |
| `test:authz-guard` | **74 passed**, no new exemption |
| ESLint, the three paths | **0 problems** |
| `tsc --noEmit` (verified method) | **2,077**, and **zero in any file this branch creates or touches** — Dev's stated baseline, confirmed |
| Mutation baseline / after restore | 106 / 106 both; working tree byte-identical |

**One observation, not a finding:** `app/api/business-os/chat-v4/__tests__/route.audit.test.ts` **fails to run** on this branch — a deliberate `throw` inside a mock escapes and kills the worker. The route and that test are **byte-identical to `HEAD`** and nothing this branch adds is in their import graph, so it is inherited from `origin/main`, not caused here. It is worth one line only because it is the file the R-1 mechanism now depends on, and no scope anyone is running includes it.

### Would a non-technical reader be misled?

**No.** The plans, the prices, the endings and the split are true to the configuration; the two panels no longer contradict each other; the account lookup renders, counts with the resolver's rule, prints sentences rather than JSON, and tells the truth about an id that is not a Business OS account. The residual is not something a reader sees today — it is that the page's self-clearing promise has one route by which it could **stop** being true in Slice 2, silently.

### Final Status

- [x] **Ready for the user's review.** Everything a reader sees is correct, and I could not break any of it.
- [ ] **One assertion before commit — R3-1.** An allow-list of chat-v4's imported symbols in place of the four-name denylist. It is the difference between "the marker clears itself" being a mechanism and being a convention, and the whole of R-1 rests on it. Everything else on this page is done.

## Commit Info

_RM to populate._
