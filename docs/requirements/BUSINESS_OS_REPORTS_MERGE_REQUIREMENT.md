# Requirement: Merge `feature/business-os-reports-and-readiness` into `main`

> **Last Updated**: 2026-09-01

**Created by:** BA
**Date:** 2026-09-01
**Status:** Draft — blocked on one architecture decision (see [The Blocking Architecture Decision](#the-blocking-architecture-decision))

## Overview

The coworker branch `feature/business-os-reports-and-readiness` (author: **offiromer**) carries two large Business OS commits — reports/readiness and a payments hub with channel insights — that have never been integrated with `main`. The branch diverged on **2026-08-04** and predates every Business OS hardening commit that has since landed on `main`. It is therefore **not "newer" code**; it is older code with newer features layered on top, which inverts the usual merge intuition and makes a naive "take the branch" resolution actively dangerous.

This document is the **living record for the entire merge effort**. It captures the starting-point gap analysis produced by the RM, the conflict inventory, the high-risk files that merge *silently*, the one architecture decision that blocks everything else, and a [Decision Log](#decision-log) that is appended to as each step is resolved. It is written to be picked up cold across multiple working sessions, by anyone, with zero context from the conversation that produced it.

**Scope note:** this document describes a *merge*. It proposes no new features and no redesign of Business OS. Anything that looks like a gap is recorded as an [Open Question](#open-questions-for-offir), not answered by invention.

---

## Table of Contents

1. [Branch Topology](#branch-topology)
2. [Governing Merge Rule](#governing-merge-rule)
3. [Conflict Inventory (14 files)](#conflict-inventory-14-files)
   - [Area A — Dependencies & Config](#area-a--dependencies--config)
   - [Area B — Business OS Plugin Architecture](#area-b--business-os-plugin-architecture)
   - [Area C — Public Website / Business OS Routes](#area-c--public-website--business-os-routes)
   - [Area D — Business OS Lib & Repositories](#area-d--business-os-lib--repositories)
4. [The Blocking Architecture Decision](#the-blocking-architecture-decision)
5. [High-Risk Areas With NO Conflict Markers](#high-risk-areas-with-no-conflict-markers)
6. [Verified Safe — No Action Needed](#verified-safe--no-action-needed)
7. [Non-Blocking Cleanups](#non-blocking-cleanups)
8. [Merge Strategy](#merge-strategy)
9. [Ordered Execution Checklist](#ordered-execution-checklist)
10. [Acceptance Criteria](#acceptance-criteria)
11. [Process & Governance Note](#process--governance-note)
12. [Decision Log](#decision-log)
13. [Open Questions for Offir](#open-questions-for-offir)
14. [Out of Scope](#out-of-scope)
15. [Change History](#change-history)

---

## Branch Topology

| Fact | Value |
|------|-------|
| Feature branch | `feature/business-os-reports-and-readiness` (author: offiromer) |
| Feature HEAD | `ea35c79` — "feat(business-os): payments hub, channel insights, and business-wide branding" |
| Second branch commit | `3390050` — "feat(business-os): system readiness, reports period filter, and RTL fixes" |
| `origin/main` HEAD | `9d755f1` |
| Merge base | `fc4ae9d` (2026-08-04) |
| Divergence | **65 behind / 2 ahead** |
| Branch change scale | **560 files, +139,859 / −9,824** — in only 2 commits |
| Main change scale since base | 170 files, +30,824 / −7,979 |
| Files touched by both sides | 24 → **14 conflict**, 10 auto-merge |
| Conflict kinds | All 14 are **content conflicts (both-modified)**. No add/add, no rename, no modify/delete. |

The conflict set was obtained **non-destructively** via:

```bash
git merge-tree --write-tree --name-only origin/main HEAD
```

### Why direction matters

The branch predates **all** of main's Business OS hardening commits:

| Hardening commit | Area it hardened |
|------------------|------------------|
| `b0c3b28` | Business OS chat / payment recording path |
| `a97847f` | Business OS chat capability routing |
| `9194511` | Business OS |
| `5e18040` | Website analytics log hygiene (M4 — no full row bodies) |
| `8054d8c` | Scheduling availability via repository |
| `138ff46` | Business OS |
| `36ab5da` | Intake route — phantom columns, repository routing, contact linkage |
| `a24c389` | Plugin-route identity hardening |

Any conflict resolved in the branch's favour on a file these commits touched **silently reverts shipped hardening**.

---

## Governing Merge Rule

> **For any file `main` touched after 2026-08-04, main's side is the default.**
>
> The branch's side is merged in **only** where it adds a genuinely new capability, and it is **re-expressed through main's repository / plugin structure** rather than pasted over it.

Every deviation from this rule must be recorded as a row in the [Decision Log](#decision-log).

---

## Conflict Inventory (14 files)

Difficulty key: 🟢 easy · 🟡 medium · 🔴 hard

### Area A — Dependencies & Config

| File | Difficulty | Conflict | Resolution |
|------|-----------|----------|------------|
| `package.json` | 🟢 | Main's dep audit (`a6a32f3`) removed `axios` as unused; branch re-adds `axios` + `bidi-js`. **Neither is imported anywhere on the branch** (verified by grep). | Take main's side. Drop `axios` and `bidi-js`. |
| `package-lock.json` | 🟢 mechanical | 23 hunks. Main **fully regenerated** the lock (+4,189/−5,514) after removing 5 packages. Branch added `@react-pdf/renderer`, `@stripe/connect-js`, `pdf-lib`, `pdfmake`, `pdfmake-rtl`, `qrcode.react`, `react-pdf-rtl`, `@types/pdfmake`. | **Do NOT hand-merge.** Fix `package.json` first, then delete the lock and run `npm install`. |
| `vercel.json` | 🟢 | Main added crons `payment-reminders` (`0 8 * * *`) and `payment-retry` (`0 * * * *`) from PR #27. Branch added `channel-metrics-sync` (`30 * * * *`). Non-overlapping. | Union all three crons. **Open check:** confirm the hosting plan's cron-count limit accommodates three. |

---

### Area B — Business OS Plugin Architecture

| File | Difficulty | Conflict |
|------|-----------|----------|
| `lib/server/plugin-manager-v2.ts` | 🔴 | Two **incompatible architectures for the same capability**. The text union is a 30-second edit; the product decision behind it is not. See [The Blocking Architecture Decision](#the-blocking-architecture-decision). |

⚠️ This file must be resolved **together with** the auto-merging `lib/server/plugin-executer-v2.ts` — see [High-Risk Areas](#high-risk-areas-with-no-conflict-markers).

---

### Area C — Public Website / Business OS Routes

| File | Difficulty | Conflict | Resolution |
|------|-----------|----------|------------|
| `app/api/website/forms/intake/route.ts` | 🔴 | 4 hunks. Main's `36ab5da` fixed **5 phantom columns**, routed all 4 table accesses through repositories, and made a contact-lookup error **fatal**. Branch keeps raw `supabaseServer` inserts and re-adds `stage: intakeStage` on the existing-contact path. | Take main's side. **Taking the branch side reverts a shipped fix.** Re-express any branch-only behaviour through main's repository calls. |
| `app/api/onboarding/build/route.ts` | 🔴 | Main's `eb57f3f` removed `tools` from the `business_profiles` upsert because **that column does not exist** (PGRST204 → the whole upsert 500s). Branch rewrote the route (+624/−27), writes `tools` again, and drops `services`. | Keep the branch's rewrite where it adds capability, but **must not write `tools`** and must not drop `services`. Re-verify column set against the live schema. |
| `app/api/website/scheduling/availability/route.ts` | 🟡 | Main (`8054d8c`) replaced a direct `scheduling_services` query with `schedulingServiceRepository.findById`. Branch kept the direct `supabaseServer` query and added `status` to the select. | Take main's repository call. If `status` is needed, **push it into the repository**, not back into the route. |
| `app/api/website/booking/confirm/route.ts` | 🟢 | **Comment-only.** Both sides deleted the duplicate `crm_activities` insert; only the explanatory comment differs. | Keep main's comment (it cites trigger **T2**). |
| `app/api/website/booking/create/route.ts` | 🟢 | **Comment-only** conflict marker. The branch's real changes here (+131/−89) **auto-merged**. | Keep main's comment — then **review the merged file end to end**, not just the marker. |
| `app/api/website/booking/finalize/route.ts` | 🟢 | **Comment-only** conflict marker. Branch's +93/−91 **auto-merged**. | Keep main's comment — then review the merged file end to end. |

---

### Area D — Business OS Lib & Repositories

| File | Difficulty | Conflict | Resolution |
|------|-----------|----------|------------|
| `lib/business-os/ChatCommandExecutor.ts` | 🔴 | **2 hunks.** **Hunk 1** (top of file): adjacent non-overlapping additions — main adds `CRM_/SCHEDULING_/PAYMENTS_PLUGIN_KEY`, branch adds `INTENT_CAPABILITY_MAP` + `verifyCapabilityAccess()`. **Hunk 2** (~L3578, `payment.record`): a **real regression** — main routes through `PaymentsPluginExecutor.record_manual_payment` (sets `paid_at`, lets triggers T3/T4 own side effects, explicitly replacing "the old rogue insert"); the branch side **IS** that rogue direct `payment_transactions` insert. | **Hunk 2: take main, unconditionally.** **Hunk 1:** union is textually fine, but the branch's `verifyCapabilityAccess()` queries `user_capabilities` via raw `supabaseServer` (violates mandatory repository rule 3/4) **and duplicates `CapabilityEngine`**. Prefer routing through `CapabilityEngine`; do not ship two authorization paths. |
| `lib/repositories/BusinessProfileRepository.ts` | 🟡 | Non-overlapping type blocks at the same offset. Main added `CalendarSyncProvider`, `SchedulingAvailability`, and a hand-written **exhaustive** `BusinessProfile` row interface (L29–185). Branch added `InvoiceAddress` + `InvoiceSettings` (L185–212). | Union the type blocks. **Then extend main's `BusinessProfile` interface** with the branch's new `invoice_*` / `description` / theme columns (added by the branch's own migrations) — main's interface is a **closed column list**, so expect TS errors post-union until it is extended. |
| `lib/repositories/PaymentRepository.ts` | 🟢 | 13-line **constructor-only** conflict. Main: `private supabase: SupabaseClient` with a documented DI default. Branch: untyped `private supabase`. | Take main's. The branch's other **+582 lines auto-merged**. |
| `lib/repositories/WebsiteAnalyticsRepository.ts` | 🟡 | 2 hunks, both `logger.debug`. Main (`5e18040`) **deliberately narrowed** logging to counts/ids — "never full row bodies (M4)". Branch logs the whole `result` object. | Take main's. **Taking the branch side reverts a log-hygiene / PII control.** |

---

## The Blocking Architecture Decision

> ⚠️ **This decision blocks everything downstream of it.** It is an **SA/TL call**, not a merge-mechanics call.

### Framing (important — do not restate the earlier mischaracterization)

The RM's first pass framed this as one side reverting the other. **That framing is wrong and must not be repeated when this is discussed with Offir.**

Verified by diffing **both sides against the merge base**:

- At the merge base, **neither implementation existed**.
- Main added the granular set on **2026-08-14**; the branch added its version **in parallel**.
- The branch's diff since base is **+7 lines** in `plugin-manager-v2.ts` and **+8 lines** in `plugin-executer-v2.ts`. It **deletes nothing of main's**.

**This is parallel invention, not a revert.** Both authors independently answered the same question: *how do we expose the user's own business records (contacts, bookings, invoices, pages) to the agent engine as a plugin?*

### The two answers

| Dimension | `main` | branch |
|-----------|--------|--------|
| Shape | **5 plugin keys**: `crm`, `scheduling`, `payments`, `intake`, `website` | **1 plugin key**: `business-os` |
| Action count | 71 total, **hand-written JSON** definitions | 67, **generated from** `lib/business-os/catalog` |
| Action naming | `create_contact`, `move_stage` | `create_contacts`, `find_page_views` (verb_entity) |
| Write path | 1:1 delegation to `lib/repositories/CRM*Repository` etc. | **BizQL compiler + `MutateExecutor`** — the same engine the BOS chat uses |
| Tenant scoping | `db_active` access strategy → `connection.user_id` | `connection.user_id` → injected by the BizQL compiler |
| Discovery | `visibility: "business_os"` — **hidden by default**, opt-in via `includeBusinessOs` | `isSystem: true`, `platform_key` auth, **no visibility field → visible everywhere** |
| Upkeep | Hand-edit JSON | Regenerate from catalog; a **drift test fails** if stale |

Both are **tenant-safe**. Both authors wrote a code comment asserting theirs is the single data path and that a second one would be a second place to be wrong.

### Why a union merge is the wrong answer

| # | Failure | Detail |
|---|---------|--------|
| 1 | 🔴 **V6 grounding gets two truths** | The generator would see ~138 actions in which `create_contact` and `create_contacts` both exist and do the same thing. CLAUDE.md's design principle states the **plugin schema is the source of truth** — a union ships two. |
| 2 | 🔴 **Trigger discipline** | Main's `CRMPluginExecutor` carries an explicit guardrail: do **not** log a `contact_created` activity, because trigger **T8** already does; same for **T2/T3/T4** on bookings and payments. **OPEN:** does BizQL's `MutateExecutor` account for those triggers? If not, the same write through the other door **double-logs**. |
| 3 | 🟡 **Visibility asymmetry** | Post-merge the five are hidden from discovery by default and the monolith is not — so in practice the generator sees the branch's surface and ignores main's, **silently, without anyone having decided that**. |

### Neither side is a superset

This is precisely why it cannot be settled by "keep the bigger one".

| Only on the **branch** | Only on **main** |
|------------------------|------------------|
| insights | payment plans + installments |
| short links + click tracking | intake templates / settings |
| page sections | `count_*` actions |
| channel metrics | `check_availability` |
| channel connections | website blocks |
| agents, agent runs | — |
| emails | — |
| availability set / clear | — |

### Recorded analyst read (recommendation — NOT a decision)

> [Open Question 3](#open-questions-for-offir) is the decider.
>
> - **If** catalog + BizQL is what the BOS chat **already runs on**, the branch's generated surface is the more maintainable long-term shape and main's five hand-written JSONs are the duplication — **but** main's `db_active` gating, `visibility: "business_os"`, and the trigger guardrails **must then be re-applied onto it**.
> - **If** it is a thin cap, folding the branch's unique entities into main's five is the **smaller, safer** merge.
>
> Either way: **one shape, not both.**

---

## High-Risk Areas With NO Conflict Markers

> These files **auto-merge silently**. They are the **most dangerous items in the whole merge** precisely because git will not stop and ask. Every one must be re-read end to end after the merge.

| File / Area | Risk | What happens silently |
|-------------|------|----------------------|
| `lib/server/plugin-executer-v2.ts` | 🔴 | Git unions **both registries**, producing a `PluginExecuterV2` registering main's `'crm' \| 'scheduling' \| 'payments' \| 'intake' \| 'website'` **AND** the branch's `'business-os'` **AND** `'meta-insights' \| 'google-analytics' \| 'google-business-profile'`. This is the **twin** of the `plugin-manager-v2.ts` conflict and must be hand-audited **together with it**. |
| `app/api/payments/blocks/execute/route.ts` | 🔴 | **Both sides rewrote it; no conflict.** Main: +27/−30, moved reminder creation to `paymentReminderRepository.create` (PR #27 queue-drain work). Branch: +49/−141, rewrote `refund_full` / `refund_partial` into thin adapters over a new `lib/payments/RefundService`, deleting the `paymentProcessorService.processRefund` path. Different functions → clean text merge, but the result is **two independent rewrites spliced together**. Re-read end to end. |
| `lib/repositories/SchedulingRepository.ts` | 🔴 | Auto-merges but **carries a security invariant**. Main added `linkIntakeContact(bookingId, userId, contactId)` as part of `36ab5da`, with an **owner-verified-`contactId` invariant** documented on the method and locked by a test. The branch adds +197/−39 elsewhere in the file. Textually clean — **BUT** the intake-route resolution must actually **CALL** `linkIntakeContact`, or main's method survives with its only caller replaced by a raw update. |
| Duplicate capability-authorization implementations | 🟡 | Main put +70/−26 into `lib/business-os/chat/CapabilityEngine.ts` (repository routing, `f538c7d` / `2a96c87`). The branch adds a **second independent** `verifyCapabilityAccess()` + `INTENT_CAPABILITY_MAP` inside `ChatCommandExecutor.ts` using raw `supabaseServer`. Post-merge there would be **two places deciding whether a user may use a capability** — two places for it to be wrong. |
| `lib/services/PaymentProcessorService.ts` | 🟡 | Stories are consistent; just verify **no caller is left**. Main (−164) migrated `saved_payment_methods` access to `SavedPaymentMethodRepository`. Branch (+12) adds a deprecation banner on `processRefund` stating it "never worked" (it resolves an executor from a registry nothing populates and reads a `payment_processors` table nothing writes). **Confirm the branch's `RefundService` fully replaces the callers.** |

---

## Verified Safe — No Action Needed

| Check | Result |
|-------|--------|
| `a24c389` plugin-route identity hardening (`app/api/plugins/*`, `app/api/plugin-connections/*`, `lib/server/route-identity.ts`, `UserProvider.tsx`, `lib/client/plugin-api-client.ts`) | ✅ **Zero overlap** with the branch. Main's versions win outright. |
| Main's deletions: `lib/cachedAuth.ts`, `app/api/plugin-connections/save/route.ts`, `app/api/auth/[...nextauth].ts` | ✅ Branch does **not** modify them → **no modify/delete conflict**. The only branch-visible `cachedAuth` consumer is `app/api/plugins/user-status/route.ts`, which main rewrote and the branch left untouched. |
| Main's `2026-08-14_drop_payment_methods.sql` | ✅ Branch has **zero** `.from('payment_methods')` references. FK-safe drop holds. |
| Branch's new API routes reading a caller-supplied `user_id` (the `a24c389` vulnerability class) | ✅ Only `app/api/admin/chat-usage/route.ts`, correctly gated by `AdminAccessService` + Zod, **never `profiles.role`**. |
| `middleware.ts` | ✅ Auto-merges as a union of skip-list entries (branch: `/c/`, `/go/`, `/book/`, `/invoice/`, `/onboarding-chat`; main: `/test-business-os`). Per `a24c389`, middleware is **not** an auth gate and skips `/api` entirely, so API auth is **not weakened**. |
| `lib/audit/events.ts` | ✅ Union merge; main's `PLUGIN_ACT_AS` event survives. |

---

## Non-Blocking Cleanups

Record these as **follow-ups, not blockers**.

| # | Item | Detail |
|---|------|--------|
| C1 | 🟡 `console.log` in `middleware.ts` | The branch adds `console.log` calls, violating CLAUDE.md **mandatory rule 3** (Pino structured logging). Convert to `createLogger` during the merge. |
| C2 | 🟡 Migration filename-convention split | Main's 4 new migrations use **dashes** (`2026-08-14_payment_reminders_claim.sql`); all **44** branch migrations use the **compact** form (`20260812_...`). Under lexical sort, `'-'` (0x2D) sorts before `'0'` (0x30), so **every** `2026-08-14_*` migration sorts **before every** `2026MMDD_*` one — including branch migrations dated earlier. **Confirm whether the runner cares** before applying the merged migration set. |

---

## Merge Strategy

| Decision | Value |
|----------|-------|
| **Direction** | Merge **`main` INTO the feature branch**. |
| **Do NOT** | Rebase. |
| **Why not rebase** | 2 commits each touching ~560 files replayed onto 65 commits of main means resolving the same conflicts with **less** context — and it **rewrites a branch already published to `origin`**. |
| **Why merge-in** | Keeps `main` **green throughout** and makes the resolution reviewable as a **single PR diff**. |

Combined with the [Governing Merge Rule](#governing-merge-rule), this is the frame for every resolution below.

---

## Ordered Execution Checklist

Update the **Status** column in the same edit that adds the corresponding [Decision Log](#decision-log) row.

| Step | Work | Files | Difficulty | Status |
|------|------|-------|-----------|--------|
| **1** | **Deps & config** — `package.json`: take main + drop `axios`/`bidi-js`. Then **delete** `package-lock.json` and run `npm install`. `vercel.json`: union all 3 crons. *Gets to a buildable tree fastest.* | `package.json`, `package-lock.json`, `vercel.json` | 🟢 | ⬜ Not started |
| **2** | **Trivial tier** — the 3 booking-route comment-only conflicts, `PaymentRepository` constructor, `WebsiteAnalyticsRepository` logging. **All take-main.** | `booking/confirm`, `booking/create`, `booking/finalize`, `PaymentRepository.ts`, `WebsiteAnalyticsRepository.ts` | 🟢 | ⬜ Not started |
| **3** | **BusinessProfileRepository** — union the type blocks, **then extend** main's `BusinessProfile` interface with the branch's new columns so TS goes quiet. | `lib/repositories/BusinessProfileRepository.ts` | 🟡 | ⬜ Not started |
| **4** | 🔴 **BLOCKING architecture decision (TL/SA): one Business OS plugin or five?** Resolve `plugin-manager-v2.ts` **AND** hand-audit the auto-merged `plugin-executer-v2.ts` **together**. **Nothing downstream is safe to finalize before this call.** | `lib/server/plugin-manager-v2.ts`, `lib/server/plugin-executer-v2.ts` | 🔴 | ⬜ Not started |
| **5** | **The three 🔴 logic files** — one at a time, with `git show 36ab5da` / `eb57f3f` / `b0c3b28` open alongside. | `website/forms/intake/route.ts`, `onboarding/build/route.ts`, `ChatCommandExecutor.ts` | 🔴 | ⬜ Not started |
| **6** | **Re-read the silently auto-merged rewrites** end to end. | `payments/blocks/execute/route.ts`, `SchedulingRepository.ts`, `CapabilityEngine.ts`, `PaymentProcessorService.ts`, `CRMPipelineStagesRepository.ts` | 🔴 | ⬜ Not started |
| **7** | **Gate on main's guard tests**, then `npm run build`, then confirm the migration-ordering question (C2). | See test list below | 🟡 | ⬜ Not started |
| **8** | **Non-blocking cleanups** — C1 (`middleware.ts` → Pino). | `middleware.ts` | 🟢 | ⬜ Not started |

### Step 7 — required guard tests

| Test | Guards |
|------|--------|
| `app/api/website/forms/intake/__tests__/route.test.ts` | `36ab5da` intake fixes (phantom columns, repository routing) |
| `lib/repositories/__tests__/SchedulingRepository.linkIntakeContact.test.ts` | Owner-verified-`contactId` invariant |
| `lib/server/__tests__/route-identity.test.ts` | `a24c389` identity hardening |
| `app/api/plugins/__tests__/identity-hardening.test.ts` | `a24c389` identity hardening |

---

## Acceptance Criteria

- [ ] ⬜ Merge is performed as `main` → feature branch (no rebase, no force-push to `origin`).
- [ ] ⬜ All 14 content conflicts resolved, each with a [Decision Log](#decision-log) row.
- [ ] ⬜ No file that `main` touched after 2026-08-04 has been reverted to the branch's older side without an explicit, logged decision.
- [ ] ⬜ **Exactly one** Business OS plugin shape ships — not both (Step 4 decision applied to `plugin-manager-v2.ts` *and* `plugin-executer-v2.ts`).
- [ ] ⬜ `payment.record` in `ChatCommandExecutor` routes through `PaymentsPluginExecutor.record_manual_payment`; no direct `payment_transactions` insert survives.
- [ ] ⬜ Intake route writes go through repositories; no phantom columns; contact-lookup error remains fatal; `linkIntakeContact` is actually called.
- [ ] ⬜ `onboarding/build` upsert does **not** write `tools` and does not drop `services`.
- [ ] ⬜ Only **one** capability-authorization implementation survives (no duplicate `verifyCapabilityAccess()` alongside `CapabilityEngine`).
- [ ] ⬜ `WebsiteAnalyticsRepository` logging keeps main's M4 narrowing (counts/ids only).
- [ ] ⬜ All five silently-auto-merged files in Step 6 have been read end to end by a reviewer.
- [ ] ⬜ All four guard tests pass.
- [ ] ⬜ `npm run build` succeeds.
- [ ] ⬜ Migration-ordering question (C2) answered before the merged migration set is applied.
- [ ] ⬜ `axios` and `bidi-js` are absent from `package.json`; lock regenerated via `npm install`.
- [ ] ⬜ Vercel cron-count limit confirmed to accommodate 3 crons.
- [ ] ⬜ All four [Open Questions for Offir](#open-questions-for-offir) have recorded answers.
- [ ] ⬜ Merge gates satisfied: **SA approved**, **QA passed**, **user approved**.

---

## Process & Governance Note

A **560-file / +139k-line** branch delivered in **2 commits**, reviewed as a single PR, is **not reviewable** in the sense the project's gates assume. The TL should decide whether this lands as one PR or is split into reviewable slices.

> **None of the three merge gates (SA approved / QA passed / user approved) is satisfied for this branch yet. No commit or merge action should be taken until they are.**

---

## Decision Log

Every resolution gets a row here.

| # | Date | Step / Conflict | Decision | Decided by | Rationale |
|---|------|-----------------|----------|------------|-----------|
| D1 | 2026-09-01 | Merge direction | Merge `main` INTO the feature branch; do **not** rebase | RM (proposed), **pending user confirmation** | 2×560-file commits replayed over 65 commits of main loses context and rewrites a published branch |

> **How to use this table:** every subsequent conflict resolution, architecture call, or deviation from the [Governing Merge Rule](#governing-merge-rule) is appended as a new row (`D2`, `D3`, …). In the **same edit**, update the matching row's **Status** in the [Ordered Execution Checklist](#ordered-execution-checklist) (⬜ Not started → 🟡 In progress → ✅ Done). A resolution without a Decision Log row is not considered resolved.

---

## Open Questions for Offir

These must be answered before Step 4 can be decided. Fill the **Answer** column in place; add a Decision Log row when an answer changes the plan.

| # | Question | Raised by | Status | Answer |
|---|----------|-----------|--------|--------|
| Q1 | Was the parallel build of the Business OS plugin surface known, or did the two of you not see each other's work? | BA / RM | ⬜ Open | *(blank)* |
| Q2 | Does BizQL's `MutateExecutor` account for triggers **T2 / T3 / T4 / T8**, or does BizQL assume it owns the side effects? (If not, the same write through the other door double-logs.) | BA / RM | ⬜ Open | *(blank)* |
| Q3 | Is the generated-from-catalog approach **load-bearing elsewhere** (the BOS chat, BizQL), or is the plugin surface a **thin cap** that could be re-pointed at main's five? **This is the decider for Step 4.** | BA / RM | ⬜ Open | *(blank)* |
| Q4 | Should Business OS actions be **hidden** from general plugin discovery (main's position, `visibility: "business_os"`) or **offered like any other plugin** (the branch's position)? | BA / RM | ⬜ Open | *(blank)* |

Additional open checks not directed at Offir:

| # | Question | Owner | Status | Answer |
|---|----------|-------|--------|--------|
| Q5 | Does the hosting plan's cron limit accommodate 3 crons (`payment-reminders`, `payment-retry`, `channel-metrics-sync`)? | Merge operator | ⬜ Open | *(blank)* |
| Q6 | Does the migration runner depend on lexical filename ordering (see [C2](#non-blocking-cleanups))? | Merge operator | ⬜ Open | *(blank)* |

---

## Out of Scope

- Any **new** Business OS feature work.
- Any **redesign** of the Business OS data model, BizQL, or the chat engine beyond choosing one of the two already-built plugin shapes.
- Retroactive splitting of the branch's 2 commits into semantic commits (a TL packaging call — see [Process & Governance Note](#process--governance-note), not a requirement here).
- Resolving the parked follow-ups already tracked elsewhere (execute-route hardening, repo-conformance sweep, legacy intake contract) unless a merge resolution directly touches them.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-01 | Document created | Initial gap analysis from RM: 14 content conflicts across 4 areas, 5 silently-auto-merging high-risk files, 6 verified-safe checks, 2 non-blocking cleanups. Records the blocking Business OS plugin-shape decision (**corrected framing: parallel invention, not a revert**), the merge-into-branch strategy, an 8-step ordered checklist, the Decision Log seeded with D1, and 6 open questions (Q1–Q4 for Offir). |
