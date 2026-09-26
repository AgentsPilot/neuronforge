# Admin Identification & Access

> **Last Updated**: 2026-09-26

## Overview

This document describes how AgentPilot identifies **platform admins/operators** — the small, trusted group with elevated, cross-tenant visibility (initially just the platform owner). It defines the authoritative source of truth (`admin_users`), the repository/service that every component uses to answer "is this user an admin?" and "who are the admins?", how admins are bootstrapped, and the open follow-ups.

It exists because, before this work, the system had **no trustworthy admin signal** and every `/api/admin/*` route relied on the service-role key with no caller check. This is the prerequisite (Q1) for the [Admin Agent Health Dashboard](/docs/requirements/ADMIN_AGENT_HEALTH_DASHBOARD_REQUIREMENT.md).

---

## Table of Contents

1. [As-Built State — read this first](#as-built-state--read-this-first)
2. [Why not `profiles.role`](#why-not-profilesrole)
3. [Agreed Design](#agreed-design)
4. [Architecture at a Glance](#architecture-at-a-glance)
5. [Data Model](#data-model)
6. [Components](#components)
7. [Runtime Flows](#runtime-flows)
8. [Lifecycle Scenarios](#lifecycle-scenarios)
9. [How to Use It](#how-to-use-it)
10. [Bootstrapping Admins](#bootstrapping-admins)
11. [Open Items / Follow-ups](#open-items--follow-ups)
12. [Security Notes](#security-notes)
13. [Change History](#change-history)

---

## As-Built State — read this first

> **The admin surface is now unified for enforcement, and still duplicated in
> implementation.** Every `/api/admin/*` handler is behind an admin check and
> every `/admin` page is guarded on the server. What is NOT finished: 6 handlers
> reach the same answer through their own hand-rolled check instead of the
> canonical gate.
>
> This section is kept deliberately blunt about the gap, because the previous
> version of it described an *intended* end state and a reader would have
> concluded the system was protected when it was not.

Re-derived **2026-09-26** (merge of admin reorganisation slice 4 with Admin Archiving slice 1): **82 handlers across 53
route files = 76 `requireAdmin` + 6 inline + 0 open.** The split is measured, not
asserted — re-run the census rather than trusting these figures if much time has
passed.

> **How 72/65/7 became 80/74/6.** The 2026-09-21 figures were correct then. Seven
> handlers added since (the Business OS entitlements routes and the LLM settings
> reads) were gated from birth but never added to the register below; the base of
> slice 2 measured **79 / 72 + 7 / 50 files**. Slice 2 then converted
> `audit-trail#GET` to `requireAdmin` (R1 and R2 caps 7 → 6, same commit) and
> added `business-os/accounts/[accountId]/summary#GET`, gated from birth. The
> register now lists all 80.
>
> **80 → 82 (2026-09-26):** two handlers, both gated from birth, landed in parallel:
> `health-summary#GET` (admin reorganisation slice 4, the Health landing) and
> `archiving#GET` (Admin Archiving slice 1). Each branch measured 81 / 75 + 6 / 52
> on its own; re-measured after the merge: **82 / 76 + 6 / 53 files**. No cap moved.

### What is true

| Claim | Status |
|---|---|
| There is **one** canonical gate for API routes — `requireAdmin` (`lib/admin/requireAdminRoute.ts`) | ✅ True |
| It derives admin identity **only** from `admin_users`, via `AdminAccessService` | ✅ True |
| It fails closed, answers **401** signed-out / **403** non-admin, and never 500s on an authorization outcome | ✅ True |
| No app-code access decision reads `profiles.role` — a repo-wide sweep returns **zero** hits | ✅ True, and CI rule R4 keeps it that way |
| **Every one of the 82 `/api/admin/*` handlers requires an admin.** 76 via `requireAdmin`, 6 via their own equivalent check. **Zero open.** | ✅ **True as of 2026-09-26** (slices 2 + 3 of the unification; re-counted after merging admin reorganisation slice 4 with Admin Archiving slice 1) |
| **All 25 `/admin` pages are protected on the server**, by inheritance from `app/admin/layout.tsx` | ✅ **True as of 2026-09-21** (slice 5), for the 21 pages then. The 4 added since inherited it without an edit: `business-os-tiers`, `platform-dashboard` (the old landing, moved in admin reorganisation slice 4, beside the rewritten `/admin` Health page) and `archiving` (Admin Archiving slice 1). Re-counted 2026-09-26: 25 `page.tsx` files under `app/admin/` |
| A **new** admin route cannot ship ungated | ✅ **True.** `Admin authz surface guard` is a **required status check** on `main` with `enforce_admins` and `strict` — a red guard blocks the merge |
| A **new** `/admin` page is protected before its author writes a line of it | ✅ True — it renders as `children` of the guarded layout; there is no per-page opt-out |

### What is NOT true, stated plainly

The point of this table is to stay as rigorous about not over-claiming *now*, with
the work mostly done, as it was when the work had barely started.

| Tempting claim | Reality |
|---|---|
| ~~"There is one way to validate that a caller is a platform admin"~~ | **Still not literally true in use.** One way exists, is canonical and is CI-enforced for new code — but **6 handlers still hand-roll their own `AdminAccessService` check** (7 until `audit-trail` was converted on 2026-09-25). They are *correct*; they are not *the one way*. Slice 4 (de-duplication) is **PARKED**. Until it lands, "one way" describes the standard, not the codebase. |
| ~~"The admin surface is fully hardened"~~ | Every handler is gated, but most still construct a **service-role client inline**, bypassing RLS and the repository layer. **Gated, not isolated** — see Open Item 9. And **26 of 44 files** still return a raw error `.message` to the client with no `NODE_ENV` guard (Open Item 7). |
| ~~"The admin Settings screen has been retired"~~ | **False.** Slice 7 is **PARKED**. `app/admin/settings/page.tsx` and `app/api/admin/settings/admin-users/route.ts` still exist. They are **non-functional and gated**: an operator who "adds an admin" there writes to `system_settings_config.admin_users`, a store that **grants nothing**. Never describe this as retired. |
| ~~"The page guard makes the admin pages secure"~~ | The page guard is **defence-in-depth**; the **API gate is the security boundary**. Three escapes remain, by construction rather than oversight: **E1** a `route.ts` under `app/admin/` is not wrapped by layouts (zero exist; CI rule R3 keeps it so); **E2** layouts do not re-render on client-side soft navigation, so the guard runs on entry to the subtree and on full loads; **E3** admin content served from a URL outside `/admin` is outside the boundary. |
| ~~"The guard proves every gate actually runs"~~ | R1 proves a gate is **present**, not that it runs **first** or runs at all. 76 handlers are gated (2026-09-26): the 65 counted on 2026-09-21 were verified by hand and by the oracle, the 11 added since only by their own route tests — measured, not enforced. See [Known gaps in the guard itself](#known-gaps-in-the-guard-itself) and Open Item 8. |
| ~~"The published counts cannot drift"~~ | The equality caps stop the exemption lists getting **longer**. Nothing forces an entry to be deleted when its handler is gated, so the figures can still drift **conservatively** — understating how much is gated (OI-22). |

### Every admin handler and its state (82)

The unit is the **handler**, not the file: slice 1 gated write verbs and left read
verbs open in the *same* files, so a file-level table would have been misleading.
That asymmetry is gone now — every row below is gated — but the handler remains
the right unit for the register.

**76 `requireAdmin` · 6 correct-but-inline · 0 open.** (Rows 73–80 were added 2026-09-25 and rows 81–82 on 2026-09-26; the numbering of rows 1–72 is kept so older references still resolve.)

| # | Route | Verb | State | Note |
|---|---|---|---|---|
| 1 | `agents` | `GET` | 🟡 inline | Correct behaviour, hand-rolled `AdminAccessService` check (was slice 4). |
| 2 | `audit-trail` | `GET` | ✅ gated | `requireAdmin` since 2026-09-25 (admin reorganisation slice 2c changed the route, so it was converted; R1/R2 caps 7 → 6). The read itself is still an inline service-role client (OI-9). |
| 3 | `business-os/llm-usage` | `GET` | 🟡 inline | Correct behaviour, hand-rolled `AdminAccessService` check (was slice 4). |
| 4 | `business-os/llm-usage/businesses` | `GET` | 🟡 inline | Correct behaviour, hand-rolled `AdminAccessService` check (was slice 4). |
| 5 | `chat-usage` | `GET` | 🟡 inline | Correct behaviour, hand-rolled `AdminAccessService` check (was slice 4). |
| 6 | `users/[id]/audit-logs` | `GET` | 🟡 inline | Correct behaviour, hand-rolled `AdminAccessService` check (was slice 4). |
| 7 | `users/[id]/login-stats` | `GET` | 🟡 inline | Correct behaviour, hand-rolled `AdminAccessService` check (was slice 4). |
| 8 | `agent-generation-config` | `GET` | ✅ gated | `requireAdmin` |
| 9 | `agent-generation-config` | `PUT` | ✅ gated | `requireAdmin` |
| 10 | `ais-config` | `GET` | ✅ gated | `requireAdmin` |
| 11 | `ais-config` | `POST` | ✅ gated | `requireAdmin` |
| 12 | `ais-weights` | `PUT` | ✅ gated | `requireAdmin` |
| 13 | `ais-weights/combined` | `PUT` | ✅ gated | `requireAdmin` |
| 14 | `ais-weights/creation` | `PUT` | ✅ gated | `requireAdmin` |
| 15 | `backfill-embeddings` | `GET` | ✅ gated | `requireAdmin` |
| 16 | `backfill-embeddings` | `POST` | ✅ gated | `requireAdmin` |
| 17 | `boost-packs` | `DELETE` | ✅ gated | `requireAdmin` |
| 18 | `boost-packs` | `GET` | ✅ gated | `requireAdmin` |
| 19 | `boost-packs` | `POST` | ✅ gated | `requireAdmin` |
| 20 | `boost-packs` | `PUT` | ✅ gated | `requireAdmin` |
| 21 | `calculator-config` | `PUT` | ✅ gated | `requireAdmin` |
| 22 | `dashboard` | `GET` | ✅ gated | `requireAdmin` |
| 23 | `dashboard` | `HEAD` | ✅ gated | `requireAdmin` |
| 24 | `execution-stats` | `GET` | ✅ gated | `requireAdmin` |
| 25 | `execution-tiers` | `DELETE` | ✅ gated | `requireAdmin` |
| 26 | `execution-tiers` | `GET` | ✅ gated | `requireAdmin` |
| 27 | `execution-tiers` | `POST` | ✅ gated | `requireAdmin` |
| 28 | `execution-tiers` | `PUT` | ✅ gated | `requireAdmin` |
| 29 | `helpbot-config` | `GET` | ✅ gated | `requireAdmin` |
| 30 | `helpbot-config` | `PUT` | ✅ gated | `requireAdmin` |
| 31 | `memory-config` | `GET` | ✅ gated | `requireAdmin` |
| 32 | `memory-config` | `PUT` | ✅ gated | `requireAdmin` |
| 33 | `memory-consolidation` | `GET` | ✅ gated | `requireAdmin` |
| 34 | `memory-consolidation` | `POST` | ✅ gated | `requireAdmin` |
| 35 | `messages` | `GET` | ✅ gated | `requireAdmin` |
| 36 | `messages/[id]` | `DELETE` | ✅ gated | `requireAdmin` |
| 37 | `messages/[id]` | `PATCH` | ✅ gated | `requireAdmin` |
| 38 | `messages/[id]/replay` | `POST` | ✅ gated | `requireAdmin` |
| 39 | `migrate-labels` | `POST` | ✅ gated | `requireAdmin` |
| 40 | `onboarding-config` | `GET` | ✅ gated | `requireAdmin` |
| 41 | `onboarding-config` | `PUT` | ✅ gated | `requireAdmin` |
| 42 | `onboarding-users` | `GET` | ✅ gated | `requireAdmin` |
| 43 | `orchestration-config` | `GET` | ✅ gated | `requireAdmin` |
| 44 | `orchestration-config` | `PUT` | ✅ gated | `requireAdmin` |
| 45 | `reward-config` | `GET` | ✅ gated | `requireAdmin` |
| 46 | `reward-config` | `POST` | ✅ gated | `requireAdmin` |
| 47 | `settings/admin-users` | `GET` | ✅ gated | `requireAdmin` |
| 48 | `settings/admin-users` | `POST` | ✅ gated | `requireAdmin` |
| 49 | `settings/platform-users` | `GET` | ✅ gated | `requireAdmin` |
| 50 | `storage-stats` | `GET` | ✅ gated | `requireAdmin` |
| 51 | `storage-tiers` | `DELETE` | ✅ gated | `requireAdmin` |
| 52 | `storage-tiers` | `GET` | ✅ gated | `requireAdmin` |
| 53 | `storage-tiers` | `POST` | ✅ gated | `requireAdmin` |
| 54 | `storage-tiers` | `PUT` | ✅ gated | `requireAdmin` |
| 55 | `system-config` | `GET` | ✅ gated | `requireAdmin` |
| 56 | `system-config` | `PUT` | ✅ gated | `requireAdmin` |
| 57 | `system-config/pricing` | `DELETE` | ✅ gated | `requireAdmin` |
| 58 | `system-config/pricing` | `GET` | ✅ gated | `requireAdmin` |
| 59 | `system-config/pricing` | `POST` | ✅ gated | `requireAdmin` |
| 60 | `system-config/pricing` | `PUT` | ✅ gated | `requireAdmin` |
| 61 | `system-config/pricing/sync` | `POST` | ✅ gated | `requireAdmin` |
| 62 | `system-limits` | `PUT` | ✅ gated | `requireAdmin` |
| 63 | `token-usage` | `GET` | ✅ gated | `requireAdmin` |
| 64 | `token-usage` | `HEAD` | ✅ gated | `requireAdmin` |
| 65 | `token-usage/drill-down` | `GET` | ✅ gated | `requireAdmin` |
| 66 | `token-usage/stats` | `GET` | ✅ gated | `requireAdmin` |
| 67 | `ui-config` | `GET` | ✅ gated | `requireAdmin` |
| 68 | `ui-config` | `POST` | ✅ gated | `requireAdmin` |
| 69 | `user-emails` | `POST` | ✅ gated | `requireAdmin` |
| 70 | `users` | `GET` | ✅ gated | `requireAdmin` |
| 71 | `users` | `HEAD` | ✅ gated | `requireAdmin` |
| 72 | `users/[id]/stats` | `GET` | ✅ gated | `requireAdmin` |
| 73 | `business-os/entitlements/accounts/[accountId]` | `GET` | ✅ gated | `requireAdmin` (added before 2026-09-25, first registered then) |
| 74 | `business-os/entitlements/accounts/[accountId]` | `POST` | ✅ gated | `requireAdmin` (idem) |
| 75 | `business-os/entitlements/launch` | `POST` | ✅ gated | `requireAdmin` (idem) |
| 76 | `business-os/entitlements/plans` | `GET` | ✅ gated | `requireAdmin` (idem) |
| 77 | `business-os/entitlements/shadow-report` | `GET` | ✅ gated | `requireAdmin` (idem) |
| 78 | `business-os/llm-settings` | `GET` | ✅ gated | `requireAdmin` (idem) |
| 79 | `business-os/llm-settings/ledger` | `GET` | ✅ gated | `requireAdmin` (idem) |
| 80 | `business-os/accounts/[accountId]/summary` | `GET` | ✅ gated | `requireAdmin`, new in admin reorganisation slice 2b (the Businesses panel) |
| 81 | `health-summary` | `GET` | ✅ gated | `requireAdmin`, gated from birth in admin reorganisation slice 4 (the Health landing). Reads across all accounts (audit counts, Business OS AI spend) through admin-only repository methods; returns counts and sums only |
| 82 | `archiving` | `GET` | ✅ gated | `requireAdmin` first statement, new in Admin Archiving slice 1 (read-only overview; position pinned by its route test I-10) |

### CI enforcement

`.github/workflows/admin-authz-guard.yml` runs `lib/admin/__tests__/admin-authz-surface.guard.test.ts` on every PR to `main`, with **no `paths:` filter** (a filtered workflow would be defeated by the very change it guards).

Seven rules: **R1** admin handler without `requireAdmin` · **R2** any `route.ts` importing `AdminAccessService` · **R3** a `route.ts` under `app/admin/**` · **R4** an access decision on a `role` value · **R5** a migration adding an RLS policy on `profiles.role` · **R6** the `/admin` layout whose **first statement** is not the page guard · **R8** a render entry point under `app/admin/**` that is server-rendered and does not guard itself.

> **There is no R7, on purpose.** R7 is reserved for the *inverted* rule described under [Known gaps](#known-gaps-in-the-guard-itself) — "is anything that **behaves** like an admin route gated, wherever it lives?" — which is parked deliberately. The rule closing OI-21 was numbered **R8** rather than taking the free number, so the parked decision is not retired by accident.

Exemptions live in two separate lists per rule — **PARKED** (an open hole someone decided not to close yet) and **PERMANENT** (an architectural exception). Each list has an **asserted cap**, and **the ratchet rule** applies: *any commit that removes an exemption must lower that list's cap by the same number, in the same commit.* Adding an exemption therefore requires raising a cap, which is a visible act in a diff.

Current caps, after slices 2, 3 and 5:

| Rule | PARKED | PERMANENT | Note |
|---|---|---|---|
| **R1** | **6** (was 34, then 7) | 0 | The 6 correct-but-inline handlers. Slice 4 takes this to 0. `audit-trail` left on 2026-09-25. |
| **R2** | 6 (was 7) | **1** | Same 6 files; the permanent entry is `calibrate/batch`, a capability flag rather than a gate. |
| **R3** | 0 | 0 | Genuinely zero — no `route.ts` under `app/admin/**`, which is what keeps the page guard airtight. |
| **R4** | 2 | 0 | Both in files slice 7 would delete; neither reads `profiles`. |
| **R5** | 0 | 0 | Genuinely zero. |
| **R6** | **0** (was 1) | 0 | The `/admin` layout carries its server guard **as the first statement of its body** (strengthened 2026-09-24; proved against twelve disabling shapes and nine correct ones). |
| **R8** | 0 | 0 | Genuinely zero — every render entry point under `app/admin/**` is a client component **or awaits the guard as its own first statement**. Added 2026-09-24. |

> **The ratchet in action.** Slices 2, 3 and 5 gated 27 handlers and guarded the
> pages, so R1 dropped **34 → 7** and R6 **1 → 0** *in the same commit*. The caps
> are asserted by equality, so leaving them stale would have failed the build —
> the mechanism working as designed, not an obstacle to route around.

> ⚠️ **A green run means no NEW ungated admin surface was added.** It does **not**
> mean the admin surface is *hardened* — see "What is NOT true" above. The check
> **is** now a required status check on `main` (with `enforce_admins` and
> `strict`), so a red guard genuinely blocks a merge.

### Known gaps in the guard itself

| Gap | Detail |
|---|---|
| **Precedence, not presence** | R1 checks that a handler *contains* `requireAdmin(`. It does not prove the gate runs **first**, nor that it runs at all (a gate inside a never-invoked closure satisfies it). 76 handlers are gated as of 2026-09-26; the 65 counted on 2026-09-21 were verified by hand and by the oracle, and the 11 added since only by their own route tests — a measurement, not an invariant. **Closing it also requires extending the oracle's instrumentation to cover the body parse**, since `mockTablesTouched` records DB/RPC/auth-API calls and not `request.json()`.<br><br>📌 **SA condition (2026-09-20): this is the FIRST thing built when the parked slices resume.** The reasoning is that the guard's authority *grows* once it becomes a required status check — and precedence is the one place where a green run does not mean what a reader will assume it means. The longer it is green-but-shallow, the more weight it carries unearned. Tracked as **OI-20**.<br><br>⚠️ **Still open for the 76 gated `/api/admin/*` handlers (and the 6 inline ones) — the *page* half is now closed.** Since 2026-09-24, R6 asserts that `requireAdminPage()` is the **first statement** of `app/admin/layout.tsx`, by parsing the default export over a string-blanked scaffold (the same primitive R1 uses for D-Q1, shared via `tests/helpers/source-scan.ts`). That is precedence for **one** file and **a different guard**. It does **not** discharge OI-20's SA condition: the precedence gap over the gated route handlers still needs the oracle instrumented for the **body parse**, and it is still the first thing built when the parked slices resume. |
| **The `/admin` page guard can be bypassed by a client-supplied header, and what makes that harmless is UNASSERTED** | Measured 2026-09-24 (QA of the Business OS AI screen, P6/P7). An **unauthenticated** request that simply carries a crafted `Next-Router-State-Tree` header claiming it is already inside `/admin` returns **200 with no `NEXT_REDIRECT`**: React re-uses the cached layout segment, so `app/admin/layout.tsx` is not re-rendered and **`requireAdminPage()` never runs**. The caller does not have to have entered the subtree — it only has to *say* it did.<br><br>```bash\n# 200, no redirect, guard never invoked (no cookies at all)\ncurl -s -o /dev/null -w '%{http_code}' http://localhost:3000/admin/business-os-llm \\\n  -H 'RSC: 1' -H 'Next-Router-State-Tree: %5B%22%22%2C%7B%22children%22%3A%5B%22admin%22%2C%7B%7D%5D%7D%5D'\n```<br><br>**Nothing leaks today, and the reason is two properties, NEITHER of which is asserted anywhere:** (1) **every `app/admin/**/page.tsx` is `'use client'` and takes no server props**, so no admin page has server-rendered data in its payload — verified by hand across all 22 pages at the time (25 as of 2026-09-26), not by a test; and (2) **every `/api/admin/*` handler requires an admin**, which is the actual security boundary (both routes behind that screen answer 401 unauthenticated). **The day one admin page becomes a Server Component, or fetches on the server, property 1 breaks and this becomes a real disclosure — silently, with every check still green.**<br><br>⚠️ This also **falsifies the stated reason** the soft-navigation escape (E2, `lib/admin/requireAdminPage.ts:26-29`) was judged harmless — *"the caller already passed the guard on entry to the subtree"*. The conclusion stands; the reason does not, because entry is claimed in a header rather than proved.<br><br>📌 **Nearly free to close, and it belongs with OI-20:** the surface guard's scanner already computes `isClient` per page (`lib/admin/__tests__/admin-authz-surface.guard.test.ts:1567`), so asserting *"every `/admin` page is a client component with no server props"* is a rule over data the guard already has — and it turns a silent break into a red required check. Tracked as **OI-21**.<br><br>✅ **Property (1) is ASSERTED as of 2026-09-24 — rule R8, in the required check.** It covers every Next.js render entry point under `app/admin/**` (`page`, `layout`, `template`, `default`, `loading`, `error`, `not-found`, `global-error` — not only `page.tsx`, because a nested `layout.tsx` renders *inside* the bypassed segment), requires each to be a client component **or** to await the guard as its own first statement, and exempts nothing. The self-guarding shape is accepted because it is **immune** to this bypass — the crafted header re-uses the cached `/admin` **layout** segment and never skips the page's own render — and a page whose guard runs *after* a read is still an offender.<br><br>⚠️ **The bypass itself is NOT fixed.** The `curl` above still returns 200 with `requireAdminPage()` never running. What changed is that the condition making that harmless can no longer break **silently**. The actual fix is a middleware check on the `/admin` path prefix, which runs before routing and cannot be skipped by a router header — not built, and it belongs with the parked admin-authz work. |
| **STOP HARDENING THE PAGE-GUARD ASSERTION — the durable fix is behavioural** | Five rounds were spent on one textual assertion over `app/admin/layout.tsx`. Rounds 4 and 5 each closed a real hole — a decoy component **signature**, then a decoy **import**, both hidden inside template literals — and each also opened a way to **reject correct code**, which is the more dangerous failure: a required check that fails a correct file is a check somebody switches off. A textual rule over this property cannot be finished, only extended.<br><br>**The durable fix is behavioural: one test that renders `AdminLayout` as a non-admin and asserts the redirect.** It is immune to all twelve known disabling shapes and to the thirteenth nobody has thought of, and it does not care how the call is written. **That test should LEAD the parked admin-authz work — not a v7 of the parser.** Written down here because the next person's instinct will be another regex. See `tests/helpers/admin-page-guard.ts` and [ADMIN_GUARD_HARDENING_AND_LINT_WORKPLAN.md](/docs/workplans/ADMIN_GUARD_HARDENING_AND_LINT_WORKPLAN.md). |
| **The guard has been deciding on TRUNCATED SOURCE — fixed here, and it was never branch-local** | Found by QA and corrected by SA, 2026-09-24. The scanner's `stripComments` blanked **strings before finding comments**, so an apostrophe inside a one-line block comment (`/* the admin user's list */`) swallowed the closing `*/`, left the comment unclosed, and deleted real code up to the next `*/` anywhere later in the file. A second gap in the same function had **no regex-literal state**, so `/[/*]/` opened a phantom comment the same way.<br><br>**Measured against an oracle built on TypeScript's own parser, over the 2,524 files the guard scans: `origin/main`'s committed version truncates 36 files / 62,594 characters** — `lib/repositories/BusinessProfileRepository.ts` loses **97% of its content** and `enforceContentLevel.wp24.test.ts` loses **all** of it. **R1–R5 have therefore been deciding on mangled input in production CI**, and a `profiles.role` access decision has been demonstrated disappearing from R4's input.<br><br>Both are fixed by one left-to-right pass that recognises comments before strings and knows regex literals and template interpolations. On the same corpus: **36 / 62,594 before → 27 / 1,840 with the precedence fix alone → 0 files / 0 characters** once the regex state is added (the middle figure independently reproduces SA's **28 / 1,952**, measured by a different method).<br><br>⚠️ **Two earlier figures are SUPERSEDED: “16 files / 64,700” and the first “0 / 0”.** Both were measured against hand-written reference strippers that **shared the implementation's blind spot** — no regex-literal state — so they scored a still-broken scanner as perfect. A reference that can agree with the bug is not a reference; the figures above come from an oracle built on TypeScript's own parser, validated by byte-for-byte identity on comment-free sources.<br><br>⚠️ **NOT yet true of `main`: PR #104 merged (`d45a6cca`, 2026-09-24) WITHOUT this fix**, so the apostrophe bypass, the truncated input and the `build`/`dist`/`coverage` blind spot below are all **live in the required check today**; the follow-up branch `fix/admin-guard-scanner-followup` is what closes them. Until it merges, a green run of the required check is weaker than it looks. |
| **A directory named `build`, `dist` or `coverage` was invisible at any depth — fixed here, also inherited** | The scan's skip list matched a bare directory NAME at every depth, so an unguarded server page at `app/admin/build/page.tsx` and an ungated handler at `app/api/admin/build/route.ts` both passed the guard, while identical files in normally-named directories failed it. `build` is an ordinary route segment. **`origin/main` still has the byte-identical list and walk — `SKIP_DIRS` tested at every depth — because PR #104 merged without this fix.** Fixed by splitting "skip anywhere" (tool output) from "skip only at the repository root" (build directories), and by making the anti-vacuity check enumerate independently so a skip-list bug cannot move both sides of the comparison together. |
| **Path-scoped** | R1 only looks under `app/api/admin/**`. An admin capability elsewhere is caught only if it imports `AdminAccessService` (R2). The inverted rule that would close this ("is anything that *behaves* like an admin route gated, wherever it lives?") is **parked deliberately**: R2 already catches the realistic recurrence, and a false positive on a *required* check is the single thing most likely to get the check switched off. |


---

## Why not `profiles.role`

`profiles.role` **cannot** be an admin security boundary:

| Problem | Evidence |
|---------|----------|
| **User-writable** — any authenticated user could self-promote to `'admin'` | The `profiles` UPDATE policy is `USING (auth.uid() = id)` with no `WITH CHECK` and no column restriction, so the browser anon key could write the column directly (`components/v2/settings/ProfileTabV2.tsx` upserts `profiles` including `role`, and offered "Administrator" as a selectable option). `app/api/user/profile/route.ts` also wrote `updateData.role = role` straight from the request body. **Closed 2026-09-20** — see the note below. |
| **Overloaded** — the same column holds onboarding personas | `role` constraint allows `business_owner`, `manager`, `consultant`, `sales`, … alongside the legacy `admin` / `user` / `viewer` (`supabase/SQL Scripts/20251118_update_profiles_role_constraint.sql`). |

Therefore admin identity lives in a **dedicated, service-role-only table** (`admin_users`), never in `profiles.role`. Do **not** seed admins from `profiles.role` — it would import self-promoted users.

### The self-promotion write is closed — and there is one rule you must inherit

`supabase/migrations/20261002_profiles_role_privilege_guard.sql` added a `BEFORE INSERT OR UPDATE OF role` trigger on `public.profiles` that silently drops a privileged value written by a non-service-role caller, the profile PUT no longer accepts `role`, and the "Administrator" option is gone. The three live `role = 'admin'` rows found on 2026-09-20 (two of them genuine `admin_users`) were cleared by `scripts/cleanup-profiles-role-admin.ts`.

**The rule:** if you ever read `profiles.role` for a privilege-ish decision, compare against **that trigger's normaliser** — `lower(regexp_replace(normalize(v, NFKC), '[^a-zA-Z0-9]', '', 'g'))` — never your own. A reader that lowercases first, or trims instead of stripping, or skips NFKC, will disagree with the database about what `'admin'` is, and **the disagreement is the vulnerability** (a dotted capital `İ` alone is enough to split them). Two classes of spelling are knowingly left unclamped — cross-script homoglyphs (`аdmin` with a Cyrillic `а`) and near-misses like `admins` / `org_admin` — which is safe only for as long as nothing authorizes on the column. The CI check that enforces "nothing authorizes on `profiles.role`" is owned by the admin-authz slice.

> Separately, `SYSTEM_ADMIN_USER_ID` / `system-admin@neuronforge.internal` is only an audit-trail attribution identity — it is **not** an operator-access concept and is unrelated to this table.

---

## Agreed Design

| Decision | Choice |
|----------|--------|
| Source of truth | A standalone **`admin_users` table** (not `profiles.role`, not an env-only list). |
| Bootstrap | Seeded from the **`ADMIN_EMAILS`** env allow-list (and/or a bootstrap SQL migration). |
| Key | **`email`** (stable; known before/independent of the auth account). `user_id` is bound once the admin has an account. |
| Write access | **Service role only** (RLS blocks anon/authenticated). |
| Consumption | Via **`AdminAccessService`** — the single surface for gates and recipient lists. |
| Runtime safety net | An email in `ADMIN_EMAILS` is treated as admin even before the DB seed runs, so the first operator is never locked out. |
| Failure behavior | The gate **fails closed** — any error denies admin access. |
| Self-promotion fix | 🟡 **Partly closed 2026-09-20.** The app-code side is done and CI-enforced (rule R4; a repo-wide sweep returns zero access decisions on `profiles.role`). The **write** on the customer profile route and the live-database `pg_policies` re-measurement remain — see [Open Items](#open-items--follow-ups) #1. |

---

## Architecture at a Glance

One authoritative allow-list (`admin_users`), reached only through one service (`AdminAccessService`). Bootstrap writes go in by **email**; consumers ask the service; nothing reads `profiles.role` for access.

> **History, so the claim is not read as "it never happened".** Two things did trust that column, and both are gone: the `system_settings_config` write policy `"Only admins can modify settings"` (dropped by `20260920a_lock_system_settings_and_pricing_rls.sql`) and `PUT /api/user/profile`, which accepted `role` from the request body until 2026-09-20. The column is a persona label; keeping it one is an active rule, not a historical fact — see [Why not `profiles.role`](#why-not-profilesrole).

```
  Bootstrap (by email)             Runtime (identity check)              Consumers
 ┌───────────────────┐         ┌──────────────────────────┐        ┌──────────────────┐
 │ ADMIN_EMAILS env  │──seed──▶│                          │◀──ask──│ /api/admin/* gate│
 │ seed SQL migration│───────▶ │   AdminAccessService     │        │ failure-email    │
 └───────────────────┘         │  (60s cache, fail-closed)│        │   recipients     │
                               │            │             │        │ future admin UI  │
                               │            ▼             │        └──────────────────┘
                               │   AdminUserRepository    │
                               │            │             │
                               │            ▼             │
                               │   admin_users (RLS:      │
                               │     service-role only)   │
                               └──────────────────────────┘
```

---

## Data Model

**Table:** `admin_users` (`supabase/migrations/20260701_create_admin_users.sql`)

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `user_id` | `uuid` UNIQUE, NULLABLE | FK → `auth.users(id)` `ON DELETE CASCADE`. Null until the admin has an account, then bound (self-heals on first admin check carrying the email). |
| `email` | `text` NOT NULL UNIQUE | Lowercased; the stable bootstrap/seed key. |
| `granted_by` | `uuid` NULLABLE | FK → `auth.users(id)` `ON DELETE SET NULL`. Null for env/bootstrap rows. |
| `notes` | `text` | Free-form. |
| `is_active` | `boolean` NOT NULL `true` | Soft-revoke switch (disable without deleting the audit row). |
| `created_at` / `updated_at` | `timestamptz` | `updated_at` maintained by a trigger. |

**RLS:** enabled, with a single `service_role`-only policy and **no** permissive anon/authenticated policy. The repository accesses it through the service-role client (`supabaseServer`) — an intentional, documented RLS bypass for an admin-only surface.

---

## Components

| Layer | File | Responsibility |
|-------|------|----------------|
| Migration (schema) | `supabase/migrations/20260701_create_admin_users.sql` | Creates the table, indexes, RLS, `updated_at` trigger. |
| Migration (data) | `supabase/migrations/20260701_seed_admin_users.sql` | Bootstrap the initial admin(s) by email. Edit before running. |
| Repository | `lib/repositories/AdminUserRepository.ts` | Data access: `findByUserId`, `findByEmail`, `listActive`, `upsertByEmail`, `bindUserId`, `deactivateByEmail`. |
| Service | `lib/services/AdminAccessService.ts` | **The consumption surface:** `isAdmin`, `isAdminById`, `listAdmins`, `listAdminEmails`, `invalidateCache`. 60s cache, fails closed, env fallback, self-heal. |
| Seed script | `scripts/seed-admin-users.ts` | Populates `admin_users` from `ADMIN_EMAILS` (resolves emails → user ids via `auth.admin.listUsers`). |
| Env | `.env.example` → `ADMIN_EMAILS` | Comma/semicolon-separated admin emails. |
| Tests | `lib/repositories/__tests__/AdminUserRepository.test.ts`, `lib/services/__tests__/AdminAccessService.test.ts` | Unit coverage: query shape/normalization/errors (repo); 3-step resolution, self-heal, fail-closed, union, caching (service). |

---

## Runtime Flows

### The admin check — `isAdmin({ id, email })`

The gate resolves in a deliberate 3-step order and **fails closed** on any error:

```
isAdmin({ id, email })
  │
  ├─1─ user_id in cached admin set?          → YES → admin ✅   (fast path, no email needed)
  │
  ├─2─ email in cached admin set?            → YES → admin ✅
  │        └─ if that row's user_id ≠ this id → bind user_id, invalidate cache  (self-heal)
  │
  ├─3─ email in ADMIN_EMAILS env?            → YES → admin ✅   (pre-seed safety net, logs a warn)
  │
  └─ none → not admin ❌
  (any error anywhere → ❌ fail closed)
```

Why each step exists:

| Step | Purpose |
|------|---------|
| 1 — bound `user_id` | Steady state; cheap set membership against the 60s cache. |
| 2 — email match + **self-heal** | Handles *invited-before-signup*: the row was seeded with `user_id = NULL`; on the admin's first authenticated request we bind their real `user_id` so future checks hit step 1. No manual backfill needed. |
| 3 — `ADMIN_EMAILS` fallback | Guarantees the first operator is never locked out if the DB seed hasn't run yet (fresh env). Logs a warning so you know the seed is pending. |

### Listing admins — `listAdminEmails()`

Returns the **union of active `admin_users` rows and `ADMIN_EMAILS`**. On a DB error it still returns the env admins, so failure-alert recipients are never fully lost.

```
listAdminEmails() → { active admin_users emails } ∪ { ADMIN_EMAILS }
```

### Caching

The active-admin set is cached in memory for **60s** (the gate runs on every admin request; the set is tiny and rarely changes). A stale cache is preferred over throwing if a refresh fails (graceful degradation). Call `invalidateCache()` after an out-of-band grant/revoke to force immediate effect.

---

## Lifecycle Scenarios

| # | Scenario | What happens |
|---|----------|--------------|
| 1 | **New operator, already a user** | Add email to seed/env → run it → `user_id` bound immediately → admin routes pass at step 1. |
| 2 | **New operator, not yet signed up** | Seed by email (`user_id = NULL`) → they sign up and open an admin page → step 2 matches by email, binds `user_id`, grants → next request is step 1. |
| 3 | **Revoke an admin** | `deactivateByEmail(...)` (or `is_active = false`) → within ≤60s (or immediately after `invalidateCache()`) the gate denies. |
| 4 | **A user self-sets `profiles.role = 'admin'`** | **Can no longer happen, and would be irrelevant anyway** — since 2026-09-20 a database trigger drops the value on any non-service-role write, and no code reads `profiles.role` for access. They never appear in `admin_users`. |

---

## How to Use It

**Admin authz gate** (the intended consumer for `/api/admin/*` routes):

```typescript
import { AdminAccessService } from '@/lib/services/AdminAccessService';
import { getUser } from '@/lib/auth';

const user = await getUser();
if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

const isAdmin = await AdminAccessService.getInstance().isAdmin({ id: user.id, email: user.email });
if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
```

> Always pass `email` when you have it — it enables the self-heal (bind `user_id`) and the env-fallback paths.

**Notification recipients** (e.g. failure emails for the admin dashboard):

```typescript
const recipients = await AdminAccessService.getInstance().listAdminEmails();
```

After granting/revoking an admin out-of-band, call `invalidateCache()` so the 60s cache doesn't mask the change.

### If your page inherits its protection, pin the thing that provides it

**Pattern, worth copying.** Every page under `/admin` is protected by
`app/admin/layout.tsx`, which awaits `requireAdminPage()` before any page's RSC
payload is produced. That is the right design — protection is a property of the
route tree, so page 23 is guarded before its author writes a line of it — and it
has one consequence people miss:

> **The safety of your page lives in a file you did not write, that you will
> never open, and that nothing stops someone editing.**

A page that adds no guard of its own is correct *and* has no local evidence that
it is protected. So the page's own test suite should assert the property it
depends on:

```typescript
it('the layout that protects it still awaits the guard as its FIRST statement', () => {
  const layout = codeOf(read('app/admin/layout.tsx'));
  const opener = /export default async function AdminLayout\s*\([\s\S]*?\)\s*\{/.exec(layout);
  expect(opener).not.toBeNull();

  const body = layout.slice(opener.index + opener[0].length).trim();
  const end = Math.min(
    ...[body.indexOf(';'), body.indexOf('{')].filter((i) => i >= 0).concat([body.length])
  );

  expect(body.slice(0, end).trim()).toMatch(/await\s+requireAdminPage\s*\(\s*\)/);
});
```

**Why FIRST statement and not "the call exists".** The weaker version was tried
and defeated three times: commenting the call out, wrapping it in
`try { … } catch {}` — which swallows the redirect, because `requireAdminPage`
redirects by THROWING — and putting an early `return` above it. Asserting the
call is the first statement subsumes all four known mutations, because the `try`
or the `if` becomes the first statement instead.

**Where it lives.** In the page's suite, not only in the layout's: a failure
should reach the person whose screen becomes public, and a test that only exists
next to the layout is a test nobody reads when they add a page. Two live
examples: `app/admin/business-os-llm/__tests__/source.guard.test.ts` (which also
exercises the rule against synthetic disabled layouts) and
`app/admin/business-os-tiers/__tests__/source.guard.test.ts`.

**Generalise it.** This is not about admin pages. Any time a component's safety
is provided by a different file — a layout, a middleware, a wrapper, a cron
runner — the dependent should assert the property, in the shape that cannot be
satisfied by the guard merely being *present*.

---

## Bootstrapping Admins

You do **not** need to hand over user IDs — email is the key, and `user_id` binds automatically. Pick either path:

**Option A — env + seed script (repeatable):**

```bash
# .env.local
ADMIN_EMAILS=meiribarak@gmail.com

npx tsx scripts/seed-admin-users.ts
```

**Option B — bootstrap SQL data migration (runs with your migrations):**

Edit the email list in `supabase/migrations/20260701_seed_admin_users.sql`, then run it. It inserts the row by email and binds `user_id` via an `auth.users` subquery if the account already exists (otherwise it binds on first login).

Either path is idempotent (keyed on `email`) and re-activates a soft-revoked row.

---

## Open Items / Follow-ups

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | **Close the self-promotion hole** in `app/api/user/profile/route.ts` (stop accepting `role='admin'` from the body; drop "Administrator" from `ProfileTabV2` options). | 🟡 **Partly closed 2026-09-20** | The **app-code** side is done and enforced: a repo-wide sweep for an access decision on `profiles.role` returns **zero** hits, and CI rule **R4** fails the build on a new one. What remains: **(a)** the write itself still exists on the customer profile route, so a user can still set the column even though nothing reads it for access; **(b)** whether a policy living **only in the live database** still trusts the column is a `pg_policies` read nobody has run. Tracked as its own P0. |
| 2 | **Wire the gate into `/api/admin/*` routes.** | ✅ **Done 2026-09-21 — 0 open** | 65 of 72 handlers use `requireAdmin`; the other 7 perform a correct but hand-rolled check. Slice 1 gated the writes (PR #67), PR #69 gated `user-emails`, and slices 2 + 3 gated the remaining 27 reads. **See [As-Built State](#as-built-state--read-this-first).** Slice 4 (de-duplicate the 7) is PARKED — it is hygiene, not risk. |
| 2a | **Server-side guard for the 21 `/admin` pages.** | ✅ **Done 2026-09-21 (slice 5)** | `app/admin/layout.tsx` is an async Server Component awaiting `requireAdminPage()`, rendering the chrome (moved verbatim to `app/admin/components/AdminChrome.tsx`) only for an admin. **None of the 21 `page.tsx` files was edited** — protection is inherited, so page 22 is guarded before it is written. A non-admin is silently redirected to `/business-os`, and anonymous vs signed-in-non-admin are asserted **indistinguishable** (BQ-3). CI rule R6 holds it. |
| 2b | **Retire the non-functional admin Settings screen.** | 🔴 **Not done — PARKED** | `app/admin/settings/page.tsx` + `app/api/admin/settings/admin-users/route.ts` still exist. They are **gated but non-functional**: they manage `system_settings_config.admin_users`, a store that grants no access. Do not describe this as retired. |
| 3 | **`GET /api/admin/admins` route** to list admins over HTTP (gated by `AdminAccessService.isAdmin`), backed by `listAdmins()` / `listAdminEmails()`. | ⬜ Recommended | No HTTP endpoint exposes the admin list today — service/repo are server-side only. Needed for any UI that shows or manages admins. |
| 4 | **Admin management UI/API** (grant/revoke) instead of env/SQL only. | ⬜ Future | `AdminUserRepository` already supports `upsertByEmail` / `deactivateByEmail`. |
| 5 | **Audit-log admin grants/revocations** via `AuditTrailService`. | ⬜ Future | — |
| 6 | Decide whether to **retire `admin`/`viewer` from the `profiles.role` constraint** once nothing reads them for access. | ⬜ Future | Keep persona values; drop access-level values. Blocked on item 1's remaining halves. |
| 7 | **Error-response conformance across the admin surface.** | ⬜ Todo | **26 of 44** admin route files put a raw error `.message` into a response body with **no `NODE_ENV` guard** — two shapes: `details: <err>.message` (4 files) and `message: error instanceof Error ? … ` (16 files). Only 4 use the guarded form. Contradicts the Security Rule *"never expose internal error details to client in production"*. Severity is reduced on gated routes (admin-only now) but not closed. |
| 8 | **Guard precedence gap.** | ⬜ Todo | R1 proves a gate is **present**, not that it runs **first** or runs at all. Applies to all 76 gated handlers (82 in total, 2026-09-26). Closing it needs the oracle's instrumentation extended to cover the **body parse** — `mockTablesTouched` records DB/RPC/auth-API calls, not `request.json()` — otherwise a precedence check is only half a check. |
| 9 | **Admin routes repository-pattern migration.** | ⬜ Todo — **template agreed 2026-09-25** | **38 of 44** admin route files do direct DB access (25 construct their own service-role client at module scope), violating CLAUDE.md mandatory rule 1. They are **gated, not isolated**. 14 tables already have an owning repository to reuse; 6 table groups would need a new one. ⚠️ Blocked on a design decision: these are cross-user admin reads **by design**, so they need methods that are *not* the `.eq('user_id', userId)` shape the repository layer exists to enforce. Full write-up in [admin-authz-unification.md](/docs/workplans/admin-authz-unification.md).<br><br>📌 **The design decision is now made, and there is a template (2026-09-25, admin reorganisation slice 2a, SA C-3).** `lib/repositories/AdminTokenUsageAnalyticsRepository.ts` is the first admin-only, cross-account repository: service role with the reason in the header, "all accounts" in the method **name**, no `lib/business-os/**` import (filters arrive as data), allow-listed columns, `{ data, error }` and never throws, `info` log per read, singleton + barrel, and a source guard that fails if anything outside `app/api/admin/**` imports it. Admin reads on owner repositories follow the same discipline with "Admin" in the method name and their own source guard (`lib/repositories/__tests__/adminReadMethods.guard.test.ts`). **Counts (26 of 44, 38 of 44) above and in OI-7 are from 2026-09-20 and predate the 51-file tree; re-measure before quoting them.** Still inline after slice 2: the `audit-trail` read and the drill-down route's label lookups and execution-detail path. |
| 11 | **Assert what makes the `/admin` page-guard bypass harmless (OI-21).** A crafted `Next-Router-State-Tree` header skips the layout render, so `requireAdminPage()` never runs — demonstrated unauthenticated. It is contained **only** because every `/admin` page is `'use client'` with no server props **and** every admin API is gated; the first of those is a hand-verified property that a future Server Component page would break with no test failing. | ✅ **Done 2026-09-24** — rule **R8**, in the required check | Built on the `isClient` the scanner already computed (now read from *stripped* source, so a comment mentioning the directive cannot fake it). Covers every render entry point, not only `page.tsx`; accepts a self-guarding server page and rejects a lookalike; nothing exempted. **The header bypass itself remains open** — what is closed is that the property containing it can no longer break silently. See [Known gaps in the guard itself](#known-gaps-in-the-guard-itself). Found by QA of the Business OS AI admin screen, 2026-09-24. |
| 10 | **`app/admin/learning-system/page.tsx:233` still uses `console.error`.** | ⬜ Todo | Rule-3 cleanup around the `user-emails` feature is incomplete. |

---

## Security Notes

- `admin_users` is **cross-tenant by design** and admin-only. Reads bypass the standard `.eq('user_id', userId)` rule intentionally, via the service-role client — documented here and in code per the project Security Rules.
- The gate **fails closed**: any repository/DB error denies admin access rather than granting it.
- Never expose the admin allow-list to a non-admin (client) surface.

---

## Lint enforcement of the admin standards — what is NOT enforced

Recorded here because two of this document's rules are, in practice, enforced only by review.

**`npm run lint` did not run at all until 2026-09-24.** `next lint` on Next 14 ignores the flat `eslint.config.mjs` and drops into an interactive setup wizard, so the repo had no working full-lint entry point — the **second** time a broken lint entry point hid findings here (the first was `eslint.config.js` shadowing the flat config, fixed in PR #76). It is now `eslint .`, which **runs and reports** but is deliberately **not wired into CI**: the repo has **420 errors and 9,909 warnings**, so wiring it today would turn `main` red for everyone.

**`no-console` is not an enabled rule, so CLAUDE.md's mandatory rule 3 ("never `console.*`, always Pino") has had zero automated enforcement.** The `// eslint-disable-next-line no-console` comments scattered through the repo are decorative — there is no enabled rule to disable. Measured with ESLint itself, because that is what a ratchet compares:

```bash
npx eslint app lib components hooks --rule '{"no-console":"error"}'
```

**4,658 findings across 410 files** (2026-09-24). It therefore **cannot** simply be flipped to `error`.

**The ratchet order, so the next person does not rediscover it:**

1. **Ignore `archive/`** — `tsconfig.json` already excludes it. Errors **420 → 253**, and it holds the only fatal parse error.
2. **Clear the `no-require-imports` and `prefer-const` errors** — mechanical, mostly `jest.mock` factories; `prefer-const` is auto-fixable.
3. **Take the counted `no-console` baseline above and enable the rule as a ratchet**, not as an error.
4. **Only then** make it a required status check.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-07-01 | Initial | Documented the `admin_users` source of truth, `AdminUserRepository` + `AdminAccessService`, env/SQL bootstrap, and open follow-ups. Prerequisite for the Admin Agent Health Dashboard (Q1). |
| 2026-07-01 | Added runtime flows | Added Architecture diagram, Runtime Flows (3-step `isAdmin` resolution, `listAdminEmails` union, caching), and Lifecycle Scenarios sections. |
| 2026-07-01 | Added unit tests | 21 passing tests for `AdminUserRepository` + `AdminAccessService` (query shape, self-heal, fail-closed, union, caching). |
| 2026-09-26 | **Admin Archiving slice 1: 81 = 75 gated + 6 inline + 0 open, 52 files** | Added row 81, `archiving#GET` (read-only overview of `audit_trail` counts), gated by `requireAdmin` as its first statement. Re-measured against the tree: 52 route files, 81 exported handlers, 6 without `requireAdmin` (the 6 inline rows). No guard cap moved: a handler that calls `requireAdmin` adds no exemption. |
| 2026-09-25 | **Re-count after admin reorganisation slice 2: 80 = 74 gated + 6 inline + 0 open, 51 files; OI-9 template named** | `audit-trail#GET` converted to `requireAdmin` because slice 2c had to change it (account filter); its R1 and R2 parked entries were deleted and **both caps went 7 → 6 in the same commit** (the ratchet). Slice 2b added `business-os/accounts/[accountId]/summary#GET`, gated from birth. The register had silently fallen behind: seven handlers added after 2026-09-21 (entitlements, LLM settings) were gated but unlisted, so the stated 72 was really 79 before this change — rows 73–80 now list them. `AdminTokenUsageAnalyticsRepository` recorded under OI-9 as the agreed admin-repository template. ⚠️ `CLAUDE.md` still says "7 handlers still hand-roll"; it is not edited by Dev and is flagged to TL. |
| 2026-09-24 | **R6 strengthened to a first-statement assertion, and R8 added to assert OI-21's containing property** | **R6** asserted `toContain('requireAdminPage')`, which the **import line** satisfies — the call could be deleted with the required check still green. It now asserts the guard is the **first statement** of the layout body, that it **is** the call rather than merely containing it, and that the identifier is bound by exactly one import of the canonical module — by parsing the default export over a **string-blanked scaffold** (R1's D-Q1 primitive, shared via `tests/helpers/source-scan.ts` rather than copied). Proved against **twelve** disabling shapes (deleted · `//`- and block-commented · try/catch · after an early return · `&&` · ternary · local no-op · default-valued parameter · decoy **signature** in a template literal · decoy **import** in a template literal · nested-template variant · aliased-away binding) and **nine** correct shapes it must not reject. **R8** asserts every render entry point under `app/admin/**` is a client component or guards itself. Guard suite **74 → 106** tests; no exemption, cap or ratchet widened, and `R8` is capped 0/0. ⚠️ **Further hardening of this assertion is closed** — see the stop entry under Known gaps. |
| 2026-09-24 | **OI-21 recorded: the `/admin` page guard is bypassable by a client-supplied header, and the two properties that make that harmless are unasserted** | Found by QA while testing the Business OS AI admin screen (P6/P7) and escalated by SA. An unauthenticated `curl` with a crafted `Next-Router-State-Tree` gets **200 with no redirect** — the layout segment is not re-rendered, so `requireAdminPage()` never runs. Contained today only because **(1)** all 22 `/admin` pages are `'use client'` with no server props and **(2)** every admin API is `requireAdmin`-gated; property (1) is hand-verified and a future Server Component page would break it **silently**. Also falsifies the stated reason for E2's ✅ in `requireAdminPage.ts` (entry is *claimed* in a header, not proved). Recorded as a guard gap with the exploit, as open item **11 (OI-21)** to be built with **OI-20**, and noted as nearly free — the surface guard already computes `isClient` per page. |
| 2026-09-21 | **Slices 2, 3 and 5 — the admin surface closed** | **27 open handlers gated and all 21 `/admin` pages guarded.** Slice 2: 14 cross-tenant reads (every platform user, any named user’s usage, per-user LLM spend, platform metrics, the message log, and the 3 `HEAD` probes that confirmed route existence to anonymous callers) + 9 internal-config GETs. Slice 3: the 4 catalogue GETs — `reward-config` was the one with **live customer callers**, so its gate and the replacement projection `GET /api/rewards/agent-sharing` (a new `ConfigRepository.isRewardActive`, `{ isActive }` only, no migration, no second store) ship in the **same commit**; both agent-detail pages repointed. Slice 5: `app/admin/layout.tsx` became an async Server Component awaiting `requireAdminPage()`, with the chrome moved verbatim to `AdminChrome.tsx` — **none of the 21 pages edited**, protection is inherited. **The ratchet fired as designed: R1 34 → 7 and R6 1 → 0 in the same commit**, and the published figures moved with it (**72 = 65 gated + 7 inline + 0 open**). Truth tables re-flipped in BOTH directions: "all 21 pages protected on the server" and "every handler requires an admin" are now ✅ — while **"one way to validate" is still NOT literally true in use**, because the 7 correct-but-inline copies remain (slice 4 parked), and the surface is **gated, not isolated** (service-role clients, error-message leakage). Tests: guard 74/74, oracle 293/293, admin surface 508/508. |
| 2026-09-24 | Added the inherit-protection pattern | A page guarded by `app/admin/layout.tsx` has no local evidence that it is protected, so its own suite should pin the layout's FIRST statement — the form that survives commenting out, `try/catch` (which swallows the redirect) and an early return. Generalised to anything whose safety lives in another file |
| 2026-09-20 | **Corrected to the as-built state (slice 8)** | Added [As-Built State](#as-built-state--read-this-first) with the **72-row per-handler table** (38 gated / 7 inline / **27 knowingly open**) — the handler, not the file, is the unit, because slice 1 gated write verbs and left read verbs open in the *same* files. Replaced six claims that would have been **false** if written as originally planned: "all 44 route files are behind the gate", "this class of gap cannot recur" (true for **new** surfaces only), "all 21 `/admin` pages are protected on the server" (**there is no server page guard at all**), "one way to validate" (one way exists and is enforced for new code; 7 inline copies remain in use), "the Settings screen is retired" (it is **non-functional and gated**, never retired), and the reward-config mirror drift (moot — the live fact is that the full reward ruleset including abuse caps is **anonymously readable**). Documented CI enforcement, the PARKED/PERMANENT split, the ratchet rule, and the guard's own two known gaps. Open items reworked: 1 is **partly** closed (app-code side enforced; the write and the live `pg_policies` read remain), 2 is **38/72**, and new items 7–10 record error-response conformance (**26 of 44** files), the precedence gap, the repository-pattern migration, and a stray `console.error`. |
| 2026-09-20 | `profiles.role` self-promotion closed | Recorded the database guard (`20261002_profiles_role_privilege_guard.sql`), the route and UI changes, and the cleanup of the three live `admin` rows. Corrected the "nothing reads `profiles.role` for access" claim, which was true of the code but not of history — a dropped `system_settings_config` policy and the profile PUT both trusted it. Added the inherited-normaliser rule for any future reader, and the two knowingly-unclamped spelling classes. |
| 2026-09-26 | Admin reorganisation slice 4 (Health landing) | Register row **81** (`health-summary#GET`, gated from birth). Census re-measured: **81 handlers / 52 route files = 75 `requireAdmin` + 6 inline + 0 open**; no guard cap moved. `/admin` pages re-counted: **24** `page.tsx` files (the old dashboard moved to `/admin/platform-dashboard`, URL-only; `/admin` is now Health). All still client components (R8) under the guarded layout |
| 2026-09-26 | Merge: admin reorganisation slice 4 + Admin Archiving slice 1 | Both branches added one handler gated from birth and each numbered it row 81. After the merge: row 81 `health-summary#GET`, row 82 `archiving#GET`. Census re-measured on the merged tree: **82 handlers / 53 route files = 76 `requireAdmin` + 6 inline + 0 open**; **25** `/admin` pages. The "All 21 pages" truth-table row and the precedence-gap figures are updated to match; no guard cap moved (R1 parked = 6) |
