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

_QA to populate._

## Commit Info

_RM to populate._
