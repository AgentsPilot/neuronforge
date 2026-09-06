# Requirement: Merge `feature/business-os-reports-and-readiness` into `main`

> **Last Updated**: 2026-09-02

**Created by:** BA
**Date:** 2026-09-01
**Status:** 🟡 **Merge resolved and committed on the integration branch; one gate red, and it is not ours.** All 11 checklist steps done, **15 conflicts closed across two merges** (14 from `main`, 1 from Offir's follow-up `54184fdb`), **22 logged decisions**. Nothing pushed; `git reset --hard` back to `23b7379` still undoes everything. `tsc` **0** merge-induced errors · guard suites **93/93** · Business OS **632/632** · full jest **3,034 passed / 128 failed** (all pre-existing). **`npm run build` exits 1** — [F6](#finding-f6---landing-preview-breaks-npm-run-build-pre-existing-on-the-branch), a defect in Offir's own new page that **reproduces at his branch tip**, so it is his to fix, not a merge resolution. The architecture question remains **deferred by decision, not blocking** (see [D9](#decision-log)).

**Outstanding:** Offir's branch defects ([F1](#finding-f1---dropped-client_-columns-still-read-by-branch-code), [F3](#finding-f3---has_website-is-a-phantom-column-read-by-branch-only-code), **[F6](#finding-f6---landing-preview-breaks-npm-run-build-pre-existing-on-the-branch) — build-blocking**) · open decisions (Q2/Q3/Q4, [Q9](#open-questions-for-offir), [C3](#non-blocking-cleanups)) · operator check (Q6) · the three merge gates.

**Per-file ledger for review with Offir:** https://claude.ai/code/artifact/4e3b4ee7-0d9f-4708-ae7b-a0dde4adf2d8

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
4. [The Architecture Decision (Deferred)](#the-architecture-decision-deferred--resolved-by-union-see-d9)
5. [High-Risk Areas With NO Conflict Markers](#high-risk-areas-with-no-conflict-markers)
6. [Finding F5 - Pre-existing TS Baseline](#finding-f5---pre-existing-typescript-error-baseline-on-the-branch)
7. [Finding F6 - `/landing-preview` Build Failure](#finding-f6---landing-preview-breaks-npm-run-build-pre-existing-on-the-branch)
7. [Finding F4 - Merge-Induced Type Defects](#finding-f4---merge-induced-typeruntime-defects-in-silently-auto-merged-files)
8. [Finding F3 - `has_website` Phantom Column](#finding-f3---has_website-is-a-phantom-column-read-by-branch-only-code)
9. [Finding F2 - `tools` Exists Post-Merge](#finding-f2---tools-does-exist-post-merge-mains-premise-is-inverted)
10. [Finding F1 - Dropped `client_*` Columns](#finding-f1---dropped-client_-columns-still-read-by-branch-code)
11. [Verified Safe — No Action Needed](#verified-safe--no-action-needed)
12. [Non-Blocking Cleanups](#non-blocking-cleanups)
13. [Merge Strategy](#merge-strategy)
14. [Ordered Execution Checklist](#ordered-execution-checklist)
15. [Incoming Work — Offir's commit `54184fdb`](#incoming-work--offirs-commit-54184fdb-fetched-2026-09-02)
15. [Acceptance Criteria](#acceptance-criteria)
16. [Process & Governance Note](#process--governance-note)
17. [Decision Log](#decision-log)
18. [Open Questions for Offir](#open-questions-for-offir)
19. [Out of Scope](#out-of-scope)
20. [Change History](#change-history)

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

## The Architecture Decision (DEFERRED — resolved by union, see D9)

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
| 1 | ~~🔴 **V6 grounding gets two truths**~~ ❌ **RETRACTED 2026-09-01** | The original claim: the generator would see ~138 actions in which `create_contact` and `create_contacts` both exist. **This is false.** It assumed both surfaces are visible to the generator. They are not - main's five carry `visibility: "business_os"` and `getConnectedPlugins()` defaults `includeBusinessOs: false`, so the generator only ever sees the branch's 67 actions. No ambiguity exists, and this was the strongest argument against a union. See [D9](#decision-log). |
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

## Finding F1 - Dropped `client_*` columns still read by branch code

🔴 **Surfaced during Step 2 review. This is a PRE-EXISTING DEFECT ON THE BRANCH, not caused by the merge.** It is recorded here because the merge review found it and it must not ship.

Branch migration `supabase/migrations/20260810_remove_client_fields_and_total_amount.sql` (added by branch commit `3390050`; **not on main, not at the merge base**) drops four columns from `scheduling_bookings`:

```sql
DROP COLUMN IF EXISTS client_first_name,
DROP COLUMN IF EXISTS client_last_name,
DROP COLUMN IF EXISTS client_email,
DROP COLUMN IF EXISTS client_phone;
```

The booking routes were migrated correctly (they now JOIN `crm_contacts`; **zero** `client_*` references remain under `app/api/website/booking/`). But other **branch-only** code still selects the dropped columns:

| File | Line | Query |
|------|------|-------|
| `lib/business-os/insight/detectors/catalog/CrmEngagementDecayDetector.ts` | ~121 | `.from('scheduling_bookings').select('client_email, start_time')` |
| `lib/business-os/insight/detectors/catalog/OpsLastMinuteCancelsDetector.ts` | ~72 | `.select('id, start_time, updated_at, payment_amount, client_email, cancellation_reason')` |
| `lib/business-os/insight/detectors/catalog/PricingIntroOfferStuckDetector.ts` | ~90 | `.select('id, client_email, service_id, payment_amount, created_at, status')` |
| `lib/business-os/insight/detectors/catalog/RetCancellationSpikeDetector.ts` | ~63 | `.select('id, client_email, service_id, cancellation_reason, updated_at')` |
| `lib/business-os/insight/detectors/catalog/RetRepeatBookingLowDetector.ts` | ~72 | `.select('client_email, id, start_time, payment_amount')` |
| `lib/business-os/insight/detectors/catalog/WebMobileIssuesDetector.ts` | ~130 | `.select('id, metadata, client_email')` |
| `lib/business-os/insight/detectors/catalog/WebPageUnderperformDetector.ts` | ~115 | `.select('source_url, client_email')` |
| `lib/repositories/SchedulingRepository.ts` | ~793 | reads `booking.client_first_name` / `client_last_name` for search filtering - **needs confirming**, it may read a normalized in-memory shape rather than a DB column |

All seven detectors are branch-only (absent from both `main` and the merge base `fc4ae9d`), so the branch drops columns its own code still queries. PostgREST returns an error for an unknown column in `select`, so each of these detectors fails at runtime once the migration is applied.

**Exactly the failure class main's `36ab5da` fixed** (phantom columns in the intake route) - which is why it is called out rather than left to QA.

**Owner:** Offir. **Not a merge-resolution item** - do not attempt to fix it inside a conflict resolution. Tracked as [Q7](#open-questions-for-offir).

---

## Finding F2 - `tools` DOES exist post-merge; main's premise is inverted

🔴 **Changes the planned resolution for [Step 5](#ordered-execution-checklist) (`app/api/onboarding/build/route.ts`). Discovered during Step 3.**

The RM's analysis (and the original framing of this document) recorded that the branch "reintroduces a known 500" by writing `tools` to `business_profiles`, because main's `eb57f3f` removed that write - the column does not exist and PostgREST returns PGRST204, failing the whole upsert.

**That is true on `main`. It is false in the merged tree.** Branch migration `supabase/migrations/20260812_add_onboarding_intelligence_columns.sql` (branch commit `3390050`; **absent from `main` and from the merge base**) creates it:

```sql
ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS pain_points TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS goals TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS tools TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS payment_mode TEXT DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS online_presence_mode TEXT DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS needs_stripe_connect BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS extracted_data JSONB DEFAULT '{}';
```

So main's removal of the `tools` write was a **correct fix for main's schema** and becomes a **regression** if carried into the merged tree unchanged: the branch's onboarding feature legitimately writes a column that will exist.

**Revised rule for Step 5.** The [Governing Merge Rule](#governing-merge-rule) ("main's side is the default") still holds for *structure* - repository routing, error handling, logging. It does **not** hold for *which columns exist*: the branch's migrations are strictly newer than main's knowledge of the schema. Resolve `onboarding/build/route.ts` **column-by-column against the merged migration set**, not by side-picking.

**Precondition:** this depends on the branch migration actually being applied. It is unapplied in production today (branch-only), which ties into the migration-ordering question ([Q6](#open-questions-for-offir)) and [Finding F1](#finding-f1---dropped-client_-columns-still-read-by-branch-code) - both concern branch migrations whose application state drives whether code is correct.

> **Generalised lesson:** wherever main "removed a phantom column," re-check whether a branch migration adds it. `36ab5da` (the intake route, [Step 5](#ordered-execution-checklist)) is the other instance and must get the same column-by-column treatment rather than a straight take-main.

---

### D9 verification evidence

Checked against the merged tree after resolution:

| Check | Result |
|-------|--------|
| Definition files loaded | 29, all present on disk |
| Executor registry entries | 29, **no duplicate keys** |
| Definitions with no executor | none |
| Executors with no definition | none |
| `business-os` | `visibility` unset -> discoverable; `isSystem: true`; no `access_strategy` (declares `auth_config`, so main's stricter `validateDefinition` accepts it) |
| `crm` / `scheduling` / `payments` / `intake` / `website` | `visibility: "business_os"` -> hidden; `access_strategy: db_active`; `isSystem: true` |
| Main's hardening retained | `isPluginDiscoverable` import, `includeBusinessOs` threading, and the `auth_config \|\| access_strategy` + `db_active => isSystem` validation all survive |
| `npx tsc --noEmit` | **0 non-marker errors** project-wide |
| UI collision | neither surface appears in `lib/plugins/pluginList.tsx` - no connect-card |

**What the union does NOT settle:** `ChatCommandExecutor`'s `payment.record` hunk (Step 5) is the one place the two paths genuinely contend - same file, same flow. It must still take main's `PaymentsPluginExecutor.record_manual_payment` route. **Q2** (does BizQL's `MutateExecutor` respect triggers T2/T3/T4/T8?) also remains open on its own merits: it concerns the branch's path with or without the union, and is not a merge blocker.

---

## Finding F3 - `has_website` is a phantom column read by branch-only code

🔴 **Pre-existing defect on the branch, not merge-induced.** Surfaced by the Step 5 column audit of `onboarding/build`.

`lib/services/CapabilityConditionEvaluator.ts:377` (branch-only - absent from `main` and from the merge base) reads:

```typescript
const { data: profile, error } = await supabaseServer
  .from('business_profiles')
  .select('vertical, clients_per_week, tools, pain_points, goals, has_website')
  .eq('user_id', userId)
  .single();
```

`vertical`, `clients_per_week`, `tools`, `pain_points` and `goals` all exist. **`has_website` does not** - zero migrations across the whole repo mention it (`grep -rn has_website supabase/migrations/` returns nothing). PostgREST rejects an unknown column in `select`, so `getUserProfile()` throws and capability-condition evaluation fails.

It is read in exactly one place. Elsewhere `has_website` is only ever an **in-memory** field (`activationProfile` in `onboarding/build`, the `UserProfile` interfaces in `CapabilityActivationService` / `OnboardingConfigurationService`) - those are fine and must not be 'fixed'.

**Likely intent:** derive it from `online_presence_mode` (`'full_website' | 'website_only'`), which is exactly what `onboarding/build` does when building `activationProfile`. **Owner:** Offir. Tracked as [Q8](#open-questions-for-offir).

---

## Finding F4 - merge-induced type/runtime defects in silently auto-merged files

🔴 **Merge-induced, not pre-existing. These are the [Step 6](#ordered-execution-checklist) files, and they would ship broken.**

With all 14 conflicts resolved, `npx tsc --noEmit` surfaces a consistent failure shape: **one side's code meeting the other side's types or schema.** Git merged both cleanly because they touch different lines.

| # | Site | Defect | Whose code / whose type |
|---|------|--------|--------------------------|
| 1 | `lib/business-os/chat/CapabilityEngine.ts:22` | `new CRMPipelineStagesRepository()` - constructor expects 1 argument | ⚠️ **PRE-EXISTING on the branch, NOT merge-induced** (corrected 2026-09-02). The branch's *own* `CRMPipelineStagesRepository` also declares `constructor(supabaseClient: SupabaseClient)`. Same family as F1/F3 - **owner: Offir**. |
| 2 | `lib/business-os/chat/CapabilityEngine.ts:179` | `pipelineStagesRepo.findByUser()` does not exist | ⚠️ **PRE-EXISTING on the branch, NOT merge-induced** (corrected 2026-09-02). **Neither** side's repository has `findByUser` - both expose `list(userId)`. The branch's chat `createContact` path has been calling a non-existent method. Same family as F1/F3 - **owner: Offir**. |
| 3 | `lib/business-os/chat/CapabilityEngine.ts:411` | `service.duration_minutes` possibly `null` | **main** code (`duration_minutes: number`), **branch's** type (`number \| null`) + `20260901_service_shape.sql` dropping the NOT NULL |
| 4 | `lib/business-os/chat/CapabilityEngine.ts:435` | writes `client_first_name` - not in `SchedulingBookingInsert` | **main** code, **branch's** dropped columns (see [F1](#finding-f1---dropped-client_-columns-still-read-by-branch-code)) |
| 5 | `lib/business-os/chat/CapabilityEngine.ts:530` | invoice insert shape not assignable to `CreatePaymentInvoiceInput` | **main** code, **branch's** type |
| 6 | `lib/server/payments-plugin-executor.ts:349` | object missing 10 properties of `PaymentInvoiceInsert` (a local `Omit<PaymentInvoice, ...>` alias) | **main** code, **branch's** widened `PaymentInvoice` (branch added `booking_id`, `refund_status`, `refunded_amount`, `refunded_at` and 6 more) |
| 7 | `lib/server/scheduling-plugin-executor.ts:295` | writes `client_first_name` - not in `SchedulingBookingInsert` | **main** code, **branch's** dropped columns |

**Corrected attribution (2026-09-02):** of the seven, **five are merge-induced** (#3, #4, #5, #6, #7) and **two (#1, #2) are pre-existing branch defects** that this pass happened to surface. The first attribution here wrongly called #1/#2 merge-induced on the basis that they appear as added lines in the diff against `main`; they came from the branch, where they were already broken against the branch's own repository.

**Severity.** #1 and #2 fail at runtime immediately (the branch's `createContact` path in the chat engine) - and did so before the merge. #4 and #7 fail at runtime once the branch's `20260810` migration is applied - PostgREST rejects the unknown column. They are the write-side twin of [F1](#finding-f1---dropped-client_-columns-still-read-by-branch-code), which covers the read side.

**Why the build does not catch this:** `next.config.js` ignores TypeScript errors (CLAUDE.md, Common Gotchas). Nothing else checks these column names - which is precisely why main's `36ab5da` added the intake guard tests.

**These are merge-resolution work**, unlike F1/F2/F3 which are branch defects. They belong to Step 6.

---

## Finding F6 - `/landing-preview` breaks `npm run build` (pre-existing on the branch)

🔴 **Pre-existing defect on the branch, NOT merge-induced. It fails the Step 11 build gate.** Surfaced by the Step 11 build.

`app/landing-preview/page.tsx` is added by Offir's commit `54184fdb`. It is a `'use client'` page that calls `useSearchParams()` at the top level with no `<Suspense>` boundary:

```typescript
export default function LandingPreviewPage() {
  const searchParams = useSearchParams();
  ...
```

Next.js 14 refuses to statically prerender a client page that reads search params outside a suspense boundary, so `npm run build` ends:

```
 ⨯ useSearchParams() should be wrapped in a suspense boundary at page "/landing-preview".
Error occurred prerendering page "/landing-preview".
> Export encountered errors on following paths:
	/landing-preview/page: /landing-preview
```

Compilation and static generation both **succeed** (`✓ Compiled successfully`, `✓ Generating static pages (282/282)`); the failure is in the export step afterwards, and it sets **exit 1**.

**Attribution - verified, not inferred** ([D22](#decision-log)):

| Evidence | Result |
|----------|--------|
| `git log --all -- app/landing-preview/page.tsx` | One commit: `54184fdb`. The file does not exist on `main` or at the merge base |
| `git diff 54184fdb -- app/landing-preview lib/i18n components/website/blocks next.config.js app/layout.tsx` | **Empty** - the page and its entire import closure are byte-identical to his tip |
| `npm run build` **at his tip `54184fdb`** in a clean worktree | **Exit 1, same error, same page** - 280/280 pages generated, then the identical export failure |

So the merged tree reproduces his branch's own build failure exactly; the merge neither caused nor worsened it. (The merged build generates **282** pages to his 280 - the two extra come from `main`.)

**Why the sibling page does not fail:** `app/website-preview/[id]/page.tsx` calls `useSearchParams()` the same way, but it is a **dynamic** route with no `generateStaticParams`, so Next never attempts to prerender it. `/landing-preview` is a static route, so it is prerendered and the rule bites. The two were written together - the comment in the landing page even says *"Same as the website preview"* - which is likely why the difference was not noticed.

**Fix shape** (for Offir, not applied here): wrap the body in `<Suspense>` and export a thin shell, or add `export const dynamic = 'force-dynamic'` to the page. One line either way.

**Why this wasn't caught earlier:** the page is new in `54184fdb`, and that commit was pushed without a build. This merge's Step 7 build gate ran **before** his commit existed.

**Owner:** Offir. **Not a merge-resolution item.** Tracked as [Q10](#open-questions-for-offir).

---

## Finding F5 - pre-existing TypeScript error baseline on the branch

🟡 **Context, not a blocker.** `npx tsc --noEmit` on the merged tree reports **4,760 errors across 600 files**. Attributed by comparing each file against the branch tip `ea35c79`:

| Bucket | Errors |
|--------|--------|
| Files byte-identical to `ea35c79` (pre-existing on the branch) | **4,413** |
| Test files added by main (fail under the app `tsconfig`, **pass under jest** - 53/53) | ~340 |
| **Merge-changed production files** | **7** (all of them [F4](#finding-f4---merge-induced-typeruntime-defects-in-silently-auto-merged-files)) |

The branch carries a large pre-existing error baseline (Stripe API version literals, `EntityType` unions, `CRMContact` fields on the invoice PDF route). `lib/audit/types.ts` is **0 lines changed** from the branch and `StripeConnectAccount` is byte-identical, confirming those are the branch's own. Not merge work - but worth knowing that `tsc` is not currently a usable gate on this branch, so **the guard tests are the real safety net.**

---

### Step 6 verification evidence

| Check | Result |
|-------|--------|
| Merge-induced `tsc` errors in non-test files | **0** (was 7; the 2 remaining are F4 #1/#2, pre-existing branch defects) |
| Duplicate-method sweep across **568** merge-changed TS files | 1 real hit - `PaymentInvoiceRepository.count`, fixed under D12. (`ProviderFactory.getProvider` is an interface member, false positive.) |
| `payments/blocks/execute/route.ts` | Both rewrites coexist coherently - `RefundService` (branch) for refunds, `paymentReminderRepository` (main) for reminders |
| `SchedulingRepository.ts:793` | **Benign** - `normalizedData` synthesises `client_first_name` from the joined `contact`, so the search filter reads an in-memory shape, not a dropped column. Closes the "needs confirming" note in F4 |
| `PaymentProcessorService.processRefund` | **0** callers outside the service - the branch's `RefundService` fully replaced them |
| `CRMPipelineStagesRepository.ts` | No duplicates; main's version intact |
| Final `client_*`-vs-`scheduling_bookings` sweep | Only F1's 7 detectors remain (Offir's). `app/api/payments/money/route.ts` verified clean - its `client_name`/`client_email` are `payment_invoices` columns, which exist |
| Full `npx jest` | **2,956 passed / 128 failed.** All 20 failing suites are byte-identical to branch tip `ea35c79`, **and so are their subjects** (e.g. `featureFlags.ts`: 0 lines changed). **Zero merge-changed suites fail.** V6 / pilot / orchestration only - unrelated to Business OS |
| Business OS + guard suites | **All green** - 53/53 guard tests, 16/16 scheduling executor, plus crm / intake / website / payments executors |

---

## Finding F7 - `saved-plans.test.ts` makes a real network call

🟡 **Pre-existing on the branch. Not a merge regression, and not blocking.**

`lib/business-os/bizql/__tests__/saved-plans.test.ts` contains **zero `jest.mock` calls**. Its path reaches `applyFrozenWrites` -> `resolveEmailBranding` -> `businessProfileRepository.findByUserId`, which issues a real Supabase request. The result is environment-dependent: it **passes in the full `npx jest` run** and **fails with `TypeError: fetch failed` in the `npx jest lib/business-os` subset**, and hangs when run alone.

**Attribution, checked rather than assumed:** the test file is unchanged since `54184fdb` (when this suite was 632/632 green). The only changed files in its call chain are his own `applyWrites.ts` (+45/-7) and `branding.ts` (+26/-22), both byte-identical to his tip here. The merged `BusinessProfileRepository` was ruled out - its `findByUserId` is **identical** to the one on his branch. So `6df79536` destabilised his own test.

**Fix shape (his):** mock the repository in the test, or don't resolve email branding on this write path. **Owner:** Offir. Tracked as Q11.

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
| C1 | ✅ **DONE (D18)** - `middleware.ts` converted to Pino | **Attribution corrected:** this was recorded as the branch adding `console.log`s. `main` carried **11** of the 12 and the branch added **1** (the `/onboarding-chat` bypass line) - a shared pre-existing gap, not Offir's. |
| C2 | 🟡 Migration filename-convention split | Main's 4 new migrations use **dashes** (`2026-08-14_payment_reminders_claim.sql`); all **44** branch migrations use the **compact** form (`20260812_...`). Under lexical sort, `'-'` (0x2D) sorts before `'0'` (0x30), so **every** `2026-08-14_*` migration sorts **before every** `2026MMDD_*` one — including branch migrations dated earlier. **Confirm whether the runner cares** before applying the merged migration set. |

| **C3** | 🟡 **Two capability-authorization implementations.** main routes capability checks through `lib/business-os/chat/CapabilityEngine.ts` (repository-backed); the branch added an independent `INTENT_CAPABILITY_MAP` + `verifyCapabilityAccess()` inside `ChatCommandExecutor.ts` that queries `user_capabilities` directly via `supabaseServer` - a **mandatory repository-rule violation** (CLAUDE.md rule 1). Both were kept by the merge (D11) so the branch's feature keeps working; a flagged comment marks the site. Collapsing them into one is a deliberate change, not merge work. **Owner: Offir + SA.** |
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
| **0** | **Open the merge** - cut `merge/business-os-reports-into-main` from the feature branch, commit this document, run `git merge origin/main`. Resolve nothing. | - | 🟢 | ✅ Done - 2026-09-01, 14 conflicts as predicted |
| **1** | **Deps & config** — `package.json`: take main + drop `axios`/`bidi-js`. Then **delete** `package-lock.json` and run `npm install`. `vercel.json`: union all 3 crons. *Gets to a buildable tree fastest.* | `package.json`, `package-lock.json`, `vercel.json` | 🟢 | ✅ Done - 2026-09-01 |
| **2** | **Trivial tier** — the 3 booking-route comment-only conflicts, `PaymentRepository` constructor, `WebsiteAnalyticsRepository` logging. **All take-main.** | `booking/confirm`, `booking/create`, `booking/finalize`, `PaymentRepository.ts`, `WebsiteAnalyticsRepository.ts` | 🟢 | ✅ Done - 2026-09-01 |
| **3** | **BusinessProfileRepository** — union the type blocks, **then extend** main's `BusinessProfile` interface with the branch's new columns so TS goes quiet. | `lib/repositories/BusinessProfileRepository.ts` | 🟡 | ✅ Done - 2026-09-01 |
| **4** | 🟡 **Business OS plugin shape - DEFERRED, not decided.** Both surfaces unioned and kept side by side; interim comments at both registration sites. The *decision* (one shape or five) is still owed - see [D9](#decision-log) and Q2-Q4. | `lib/server/plugin-manager-v2.ts`, `lib/server/plugin-executer-v2.ts` | 🟡 | ✅ Unblocked - 2026-09-01 (decision deferred) |
| **5** | **The three 🔴 logic files** — one at a time, with `git show 36ab5da` / `eb57f3f` / `b0c3b28` open alongside. | `website/forms/intake/route.ts`, `onboarding/build/route.ts`, `ChatCommandExecutor.ts` | 🔴 | ✅ Done - 2026-09-02 (D10, D11, D12, D13). **All 14 conflicts resolved.** |
| **6** | **Re-read the silently auto-merged rewrites** end to end. | `payments/blocks/execute/route.ts`, `SchedulingRepository.ts`, `CapabilityEngine.ts`, `PaymentProcessorService.ts`, `CRMPipelineStagesRepository.ts` | 🔴 | ✅ Done - 2026-09-02 (D14). 5 merge-induced defects fixed + 1 tsc could not see; 4 auto-merged files re-read clean |
| **7** | **Gate on main's guard tests**, then `npm run build`, then confirm the migration-ordering question (C2). | See test list below | 🟡 | ✅ Done - 2026-09-02 (D17). Build exit 0; all guard suites green |
| **8** | **Non-blocking cleanups** — C1 (`middleware.ts` → Pino). | `middleware.ts` | 🟢 | ✅ Done - 2026-09-02 (D18) |
| **9** | **Commit the merge resolution** on `merge/business-os-reports-into-main`. **Prerequisite for Step 10** — git refuses a second merge while `MERGE_HEAD` exists. Reversible: `git reset --hard HEAD~1`, or delete the branch. | — | 🟢 | ✅ Done - 2026-09-02, committed as `8550eebb` |
| **10** | **Merge Offir's new commit `54184fdb`** ("service-driven client journey, AI website content, readiness rework", 116 files, +10,035/−2,739) into the integration branch and resolve whatever conflicts it raises. | see the incoming-work table below | 🟡 | ✅ Done - 2026-09-02 (D19–D21). **Exactly 1 conflict** (`forms/intake/route.ts`); the other 8 overlap files auto-merged and were audited individually. All 7 protected decisions verified surviving |
| **11** | **Re-verify after Step 10** — `npm run build`, the four guard suites, the Business OS suites, and a fresh merge-induced-`tsc`-error sweep. Confirm no regression against the Step 7 baseline. | — | 🟡 | 🟡 Done, **1 gate red** - 2026-09-02 (D22). `tsc` **0** merge-induced errors · guard suites **93/93** · Business OS **632/632** · full jest **3,034 passed / 128 failed** (same 128, all pre-existing) · `npm run build` **exit 1** on `/landing-preview` — [F6](#finding-f6---landing-preview-breaks-npm-run-build-pre-existing-on-the-branch), Offir's defect, reproduced at his own tip |

### Step 7 — required guard tests

| Test | Guards |
|------|--------|
| `app/api/website/forms/intake/__tests__/route.test.ts` | `36ab5da` intake fixes (phantom columns, repository routing) |
| `lib/repositories/__tests__/SchedulingRepository.linkIntakeContact.test.ts` | Owner-verified-`contactId` invariant |
| `lib/server/__tests__/route-identity.test.ts` | `a24c389` identity hardening |
| `app/api/plugins/__tests__/identity-hardening.test.ts` | `a24c389` identity hardening |

---

## Incoming Work — Offir's commit `54184fdb` (fetched 2026-09-02)

Pushed to `origin/feature/business-os-reports-and-readiness` **after** this merge was resolved. Not yet merged.

| Fact | Value |
|------|-------|
| Commit | `54184fdb` — *feat(business-os): service-driven client journey, AI website content, readiness rework* |
| Scale | **116 files, +10,035 / −2,739** |
| New areas | `lib/website-builder/` (`selectTemplate`, `mergeCentralContent`, `templateLabels`) with its own tests; `WebsiteGenerationService` / `WebsitePublishService` rework |
| New migrations | `20260902_website_content_empty_defaults`, `20260902_website_pages_content_generated_at`, `20260903_business_template`, `20260904_business_subdomain`, plus a change to `20260722_add_currency_to_scheduling_services` |

**Overlap with work already resolved here** — measured against the branch tip `ea35c79` this merge was built from:

| File | Change in `54184fdb` | Why it matters |
|------|----------------------|----------------|
| `app/api/website/booking/create/route.ts` | +88 / −4 | Resolved under D7 (comment-only). His new work lands on top |
| `app/api/website/booking/finalize/route.ts` | +54 / −7 | Resolved under D7 |
| `app/api/website/booking/confirm/route.ts` | +22 / −12 | Resolved under D7 |
| `app/api/website/forms/intake/route.ts` | +18 / −10 | **Resolved under D13** — the most carefully rebuilt file in the merge. Re-check that main's repository routing and the `linkIntakeContact` call survive |
| `lib/repositories/BusinessProfileRepository.ts` | +15 / −3 | **Resolved under D8** — check whether his 15 added lines need more columns in the extended row interface |
| `app/api/onboarding/build/route.ts` | +10 / −0 | Resolved under D10 (branch side taken) |
| `middleware.ts` | +35 / −2 | **Converted to Pino under D18.** A near-certain conflict, and any `console.*` he adds must be converted again (CLAUDE.md rule 3) |

A read-only `git merge-tree origin/main <his new tip>` reports **the same 14 conflicting files** as before — he has not introduced conflicts in new areas. The 7 files above are where his new work meets decisions already taken.

**Sequencing constraint:** git refuses to start a second merge while `MERGE_HEAD` exists, so Step 9 (commit) must precede Step 10 (merge his commit). Committing is on the local integration branch only — nothing is pushed, and it is reversible with `git reset --hard HEAD~1`.

---

## Acceptance Criteria

Reconciled against the [Decision Log](#decision-log) on 2026-09-02. Three of the original criteria were
**superseded by decisions taken during the merge** and are marked as such rather than silently edited — they
describe the plan as written on day one, not a failure to meet it.

- [x] ✅ Merge performed as `main` → feature branch, on an integration branch; no rebase, no force-push to `origin` (D1, D2).
- [x] ✅ All 14 content conflicts resolved, each with a Decision Log row (D4–D14).
- [x] ✅ No file `main` touched after 2026-08-04 reverted to the branch's older side without an explicit logged decision.
- [ ] ⚠️ **SUPERSEDED by [D9](#decision-log)** — *original: "exactly one Business OS plugin shape ships, not both."* **Both ship, deliberately.** The two surfaces have distinct consumers and do not contend; forcing a shape mid-merge would have been an architecture decision made under merge pressure. Tracked as Q2/Q3/Q4.
- [x] ✅ `payment.record` routes through `PaymentsPluginExecutor.record_manual_payment`; **no direct `payment_transactions` insert survives** in `ChatCommandExecutor` (verified by grep) (D11).
- [x] ✅ Intake route writes go through repositories; no phantom columns; contact-lookup error fatal; `linkIntakeContact` called (D13).
- [ ] ⚠️ **SUPERSEDED by [F2](#finding-f2---tools-does-exist-post-merge-mains-premise-is-inverted) / [D10](#decision-log)** — *original: "`onboarding/build` does not write `tools`."* **It does write `tools`, and that is correct.** Main removed the write because the column does not exist *on main*; branch migration `20260812_add_onboarding_intelligence_columns.sql` creates it. All 16 columns the route writes were verified against the merged migration set. `services` is omitted by the branch's own documented product decision.
- [ ] ⚠️ **SUPERSEDED by [D11](#decision-log) / [C3](#non-blocking-cleanups)** — *original: "only one capability-authorization implementation survives."* **Both survive.** Collapsing `verifyCapabilityAccess()` into `CapabilityEngine` is a deliberate refactor, not merge work; the site is flagged in code and tracked as C3 (owner: Offir + SA).
- [x] ✅ `WebsiteAnalyticsRepository` logging keeps main's M4 narrowing (counts/ids only) (D7).
- [x] ✅ All silently-auto-merged Step 6 files read end to end; 568 merge-changed TS files swept for the duplicate-method pattern (D14).
- [x] ✅ All four guard tests pass — 93/93 across guard + executor suites; 625/625 Business OS (D17). **Re-confirmed after Offir's `54184fdb`: 93/93 and 632/632** (D22).
- [ ] 🔴 `npm run build` succeeds. **Was exit 0 / 280 pages at Step 7 (D17); now exit 1** after Offir's `54184fdb`. Compilation and all 282 static pages still succeed — the export step fails on `/landing-preview`. **Not a merge regression:** reproduced at his own branch tip. Blocked on [F6](#finding-f6---landing-preview-breaks-npm-run-build-pre-existing-on-the-branch) / Q10, owner Offir.
- [ ] ⬜ Migration-ordering question (**Q6 / C2**) answered before the merged migration set is applied. **Still open** — operator check.
- [x] ✅ `axios` and `bidi-js` absent from `package.json`; lock regenerated via `npm install` (D4, D5).
- [x] ✅ Vercel cron budget confirmed — 11 crons, plan is Pro (limit 40); **Q5 answered** (D6).
- [ ] ⬜ All Open Questions for Offir answered. **Q1 and Q5 answered; Q2, Q3, Q4, Q6, Q7, Q8, Q9 still open.**
- [ ] ⬜ Merge gates satisfied: **SA approved**, **QA passed**, **user approved**. **None satisfied.**

**Additional criteria added during the merge** (not in the original list):

- [x] ✅ Zero TypeScript errors introduced by the merge in non-test files (7 found, 7 fixed — [F4](#finding-f4---merge-induced-typeruntime-defects-in-silently-auto-merged-files)).
- [x] ✅ Zero merge-changed test suites failing (128 failures in the full run are all pre-existing on the branch — [F5](#finding-f5---pre-existing-typescript-error-baseline-on-the-branch)). **Still 128 after `54184fdb`, same 20 suites, all byte-identical to `ea35c79`.**
- [x] ✅ `middleware.ts` converted to Pino, Edge-compatibility verified by build (D18, C1).

---

## Process & Governance Note

A **560-file / +139k-line** branch delivered in **2 commits**, reviewed as a single PR, is **not reviewable** in the sense the project's gates assume. The TL should decide whether this lands as one PR or is split into reviewable slices.

> **None of the three merge gates (SA approved / QA passed / user approved) is satisfied for this branch yet. No commit or merge action should be taken until they are.**

---

## Decision Log

Every resolution gets a row here.

| # | Date | Step / Conflict | Decision | Decided by | Rationale |
|---|------|-----------------|----------|------------|-----------|
| D1 | 2026-09-01 | Merge direction | Merge `main` INTO the feature branch; do **not** rebase | RM (proposed) -> **user-approved 2026-09-01** | 2×560-file commits replayed over 65 commits of main loses context and rewrites a published branch |
| D2 | 2026-09-01 | Where the merge is performed | Merge onto a **dedicated integration branch** `merge/business-os-reports-into-main` (cut from `feature/...` @ `ea35c79`), **not** onto Offir's branch | User-approved | Leaves Offir's published branch untouched so he can keep working; restart/abandon costs nothing; the eventual PR shows the full resolution as one reviewable diff. Cost accepted: if Offir pushes during the merge, re-merge his branch at the end. |
| D3 | 2026-09-01 | This document's home | Commit the requirement MD to the integration branch as its first commit (`23b7379`), before the merge | User-approved | Version-controls the decision record so it travels with the work instead of living only on one machine. |
| D4 | 2026-09-01 | `package.json` | **Took main's side** - dropped `axios` and `bidi-js` as direct deps; kept the branch's 8 PDF/Stripe/QR additions (all auto-merged) | User-approved | Re-verified against the merged tree, not taken on trust: **0** direct imports of either (`grep` over app/lib/components/hooks/scripts/types). The only `bidi` hit is a CSS `dir="ltr"` comment. `bidi-js` still resolves **transitively** via `@react-pdf/textkit -> bidi-js ^1.0.2`, so the branch's RTL PDF work is unaffected by dropping the direct entry. |
| D5 | 2026-09-01 | `package-lock.json` | **Deleted and regenerated** with `npm install` - not hand-merged | User-approved | 23 hunks of two independent regenerations; hand-merging a lockfile produces a tree that resolves differently from either side. Result: lockfileVersion 3, 67 root deps, all 8 branch additions present, `axios` absent, exit 0. |
| D6 | 2026-09-01 | `vercel.json` | **Union of all 3 crons** - `channel-metrics-sync` (branch) + `payment-reminders` + `payment-retry` (main, PR #27) | User-approved | Non-overlapping paths and schedules. Total now **11 crons**; all 3 merged routes verified to exist on disk. Resolves **Q5**: the project already ran 8 crons pre-merge, far past Hobby's limit of 2, so it is on Pro (limit 40) - 11 is within budget. Confirm with Offir but not a blocker. |
| D7 | 2026-09-01 | Trivial tier (5 files) | **Took main on all five.** 3 booking routes (comment-only), `PaymentRepository` constructor, `WebsiteAnalyticsRepository` logging | User-approved | Booking-route conflicts were comment-only and main's text is strictly more informative (names trigger T2 + workplan section). `PaymentRepository`: main's typed `SupabaseClient` DI constructor - verified the type is imported (L1) and all **three** classes in the file (`PaymentTransactionRepository`, `PaymentInvoiceRepository`, `StripeConnectRepository`) are now consistently typed. `WebsiteAnalyticsRepository`: main's version logs counts/ids only; the branch's logged the whole `result` object, so taking the branch side would have reverted the M4 PII/log-hygiene control. **Auto-merged content around the markers was reviewed, not just cleared** - the branch's real work (userCode + attribution in `create`, `crm_contacts` JOIN + Stripe Connect context in `finalize`, pipeline-stage resolution + `duration_minutes` null-guard in `confirm`) landed coherently. |
| D8 | 2026-09-01 | `BusinessProfileRepository.ts` | **Unioned** both type blocks (branch's `InvoiceAddress`/`InvoiceSettings` + main's `CalendarSyncProvider`/`SchedulingAvailability`/`BusinessProfile`/`Insert`/`Update`), then **extended main's row interface with 22 branch columns** | User-approved | Column set derived by parsing every `ALTER TABLE business_profiles` block across all migrations (38 ADD COLUMNs) and diffing against main's interface - not guessed. All 22 come from branch-only migrations. Nullability follows each migration: `show_logo_on_smart_links` is `NOT NULL DEFAULT true` so non-nullable; `theme` is nullable JSONB typed structurally (no `BusinessTheme` type exists in the repo yet). Verified nothing constructs a `BusinessProfile` object literal, so promoting the fields to required is safe. **`npx tsc --noEmit`: zero type errors** - the only remaining diagnostics project-wide are TS1185 markers in the 5 unresolved files. |
| D9 | 2026-09-01 | **Business OS plugin shape** | **Union both surfaces; defer the decision.** Load all 29 definitions (main's 5 granular + the branch's `business-os` + 3 analytics) and register all 29 executors. Keep `visibility: "business_os"` on the five; **do NOT** add it to `business-os`. Interim comments added at both registration sites pointing here. | User-approved after joint review | **Q1 answered: parallel build, genuine mix-up - neither side saw the other.** Code review showed the two surfaces are not competing for one consumer: the five are hidden from discovery and reached only by explicit key from `ChatCommandExecutor`; `business-os` is discoverable and reached only via `getConnectedPlugins()` in `lib/agentkit/convertPlugins.ts` by the agent-generation pipeline. `'business-os'` appears nowhere else in the tree. **This retracts the earlier "V6 grounding gets two truths" objection** - the generator never sees the five, so there is no ambiguity. Union is therefore backward-compatible: each path keeps its own consumer, unchanged. |
| D10 | 2026-09-02 | `app/api/onboarding/build/route.ts` | **Took the branch's side**, plus a provenance comment on the `tools` write | User-approved | **Not a side-pick on merit - main's side is not runnable here.** The branch rewrote this route (+624/-27); `profile` is a *request field* and values are derived from `configuration ?? profile`. Main's version reads `profile.*` directly, which would ignore the new `configuration` format entirely, and `profile` is optional in the merged schema so `profile.vertical` could throw. Main's only contribution to this hunk was removing the `tools` write, which **F2** shows is no longer applicable. Per F2's rule, **every column the route writes was verified against the merged migration set: all 16 exist.** The branch's deliberate omission of `services` is a documented product decision (it duplicated `scheduling_services` and was left empty), not a schema issue - kept. A comment now records why `tools` is written, so it is not removed a third time. `tsc`: 0 non-marker errors. |
| D11 | 2026-09-02 | `lib/business-os/ChatCommandExecutor.ts` | **Hunk 1 (constants): unioned** - main's `CRM_/SCHEDULING_/PAYMENTS_PLUGIN_KEY` + the branch's `INTENT_CAPABILITY_MAP` and `verifyCapabilityAccess()`. **Hunk 2 (`payment.record`): took main** - `PaymentsPluginExecutor.record_manual_payment`. | User-approved | Hunk 1 is purely additive and both are live: `verifyCapabilityAccess` is called at L1093, main's keys at L2101/3093/3347/3592. Hunk 2 was not a judgement call - **the code immediately after the conflict already reads `paymentResult.success`, which only main's side defines**, so the branch's `{ error }` binding would not compile; `PluginExecuterV2` is already imported and used at three other sites in the file. Rationale nuance recorded for accuracy: main's comment says the old rogue insert 'omitted `paid_at`', but this branch revision *does* set it - the reasons main's side still wins are trigger ownership (T3/T4 own the CRM activity and invoice->paid side effects) and the mandatory repository rule, not `paid_at`. Verified `from('payment_transactions')` no longer appears in the file. `tsc`: 0 non-marker errors. |
| D12 | 2026-09-02 | `app/api/website/scheduling/availability/route.ts` | **Took main** (`schedulingServiceRepository.findById`), plus a null-duration guard | User-approved | `select('*')` supplies the `status` field the branch had added to its raw select, so nothing is lost. Routing through the typed repository surfaced that `duration_minutes` is genuinely nullable (branch migration `20260901_service_shape.sql` drops the NOT NULL so a service can exist without a bookable span). Guarded to return an empty slot list rather than coercing to 0, which would make slot generation meaningless. |
| D13 | 2026-09-02 | `app/api/website/forms/intake/route.ts` | **Main's structure + the branch's attribution feature re-expressed through it.** All 4 table accesses go through repositories; `source_metadata` added to `CRMContactInsert`. **Stage behaviour: main's kept, branch's stage lookup removed.** | User-approved | Hunk 1 unioned (attribution kept, main's `websitePageRepository.findBySubdomainAny` kept); hunks 2 and 4 took main; hunk 3 took main's `crmContactRepository.create` with `source_metadata` re-applied - the column exists (`20260824_add_conversion_layer.sql`) but main's `CRMContactInsert` did not carry it, so the type was extended rather than bypassing the repository. The branch's `crm_pipeline_stages` lookup was **removed, not left computed-but-unused**: it is an extra query on a public unauthenticated endpoint and it broke main's guard tests (unmocked there precisely because main never makes it). **All 15 intake guard tests pass; 53/53 across all four guard suites.** The stage question itself is deferred - see [Q9](#open-questions-for-offir). |
| D14 | 2026-09-02 | **Step 6 - the 5 merge-induced F4 defects** | Fixed all five, plus one `tsc` could not see. Two of main's `create_booking` guard-test assertions **updated** to the post-drop contract. | User-approved | **F4 #4/#7 (`client_*` writes):** `scheduling_bookings` no longer has those columns, and `SchedulingBookingInsert` now requires `contact_id`. `CapabilityEngine.createBooking` already had a contact, so the four fields were simply dropped. `scheduling-plugin-executor.buildBookingInsert` had none, so it now **resolves the contact** (find-by-email, else create) exactly as `app/api/website/booking/create` does - the plugin's declared contract (`client_first_name` + `client_email` required) is unchanged. **F4 #3:** null-duration guard in `CapabilityEngine.createBooking` (nullable since `20260901_service_shape.sql`; multiplying null gives an Invalid Date written without complaint). **F4 #5/#6:** the 7 nullable/DB-defaulted invoice columns the branch added (`refund_status`, `refunded_amount`, `refunded_at`, `client_name`, `client_email`, `booking_id`, `service_id`) moved into the optional half of `CreatePaymentInvoiceInput`, and `payments-plugin-executor`'s hand-rolled `Omit<PaymentInvoice, ...>` alias repointed at that published type instead of re-deriving one. **Bonus - invisible to `tsc`:** `scheduling-plugin-executor` line ~210 read `b.client_first_name` off booking rows to label availability conflicts, rendering the literal string `"undefined"`; `unwrap()` returns `any` so the compiler never saw it. Now reports `contact_id`. |
| D15 | 2026-09-02 | Main's `create_booking` guard tests | **Updated** two assertions; added 2 cases | User-approved (implied by D14 - flagged for review) | Main asserted `client_email` reaches the booking row and that create_booking makes **no CRM call at all**. Both encoded the pre-drop world, where trigger T1 created the contact from the booking's `client_*` columns. The branch's own `20260810_update_booking_contact_trigger.sql` states the new contract - *"Contacts are ALWAYS created BEFORE booking... contact_id is ALWAYS set"* - and its legacy fallback reads the very columns `20260810_remove_client_fields_and_total_amount.sql` deletes, so it is dead. The guardrail's real intent is preserved and still asserted: **no service writes, no CRM activity emission** (T2 owns that). Added cases for create-when-absent and explicit-`contact_id`. **Distinguish from [Q9](#open-questions-for-offir):** that test locks a *choice* and was left alone; this one locked a *removed capability*. |
| D16 | 2026-09-02 | **F4 #1/#2** - `CapabilityEngine.createContact` | **Fixed** despite being a pre-existing branch defect rather than merge work | User-approved on request | The chat `createContact` path called `pipelineStagesRepo.findByUser(this.userId)` on a locally built `new CRMPipelineStagesRepository()`. Neither is valid on **either** parent: the repository has never exposed `findByUser`, and its constructor requires a `SupabaseClient`. The module already publishes the configured singleton `crmPipelineStagesRepository`, and `list(userId)` orders by `position` ascending - so `[0]` is the first stage, exactly the intent of the original code. main's `crm-plugin-executor` already uses that same pair. Intent preserved, no behaviour invented. |
| D17 | 2026-09-02 | **Step 7 - build gate** | `npm run build` **exit 0** | User-approved | `✓ Compiled successfully`, `✓ Generating static pages (280/280)`. The `DYNAMIC_SERVER_USAGE` entries in the log are Next.js probing API routes that read `cookies`/`headers` during static generation and falling back to dynamic rendering - expected, present on both parents, and emitted by the app's own logger rather than the build. The Stripe `ConnectJS won't load when rendering code in the server` notice is Stripe's own documented SSR message. **Guard + executor suites: 93/93 across 6 suites. Business OS: 625/625 across 29 suites.** |
| D18 | 2026-09-02 | **Step 8 / C1** - `middleware.ts` logging | All **11** `console.*` call sites converted to structured Pino, plus one log-hygiene fix | User-approved | **Edge-runtime risk checked rather than assumed:** middleware runs on the Edge runtime and `lib/logger.ts` imports `pino` directly, so the conversion was made and then built - `✓ Compiled successfully`, **0** "not supported in the Edge Runtime" warnings, exit 0. Cost: the middleware bundle grows 64.4 kB -> 67.3 kB (+2.9 kB for Pino's browser build) on a path that runs for every request. **Log hygiene:** the old line 147 logged the entire `business_profiles` row; it now logs only the decision inputs (`hasProfile`, `onboardingCompleted`, `profileError`) - the same M4 rule applied under D7 to `WebsiteAnalyticsRepository`. See C1 for the corrected attribution. |
| D19 | 2026-09-02 | **Step 10** - `app/api/website/forms/intake/route.ts` (the merge's **only** conflict) + `lib/business-os/publicOwner.ts` | **Took his side of the conflict, then re-expressed the new module it depends on through main's repositories.** The route now calls his `resolvePublicOwner({ subdomain, userCode })`; `resolvePublicOwner` itself was rewritten to use `websitePageRepository.findBySubdomainAny` + `businessProfileRepository.findByUserCode` instead of two raw `supabaseServer` queries | RM | **This is [Governing Merge Rule](#governing-merge-rule) clause 2 in its purest form: genuinely new capability, re-expressed through main's structure.** The capability is real - a smart link (`/c/{userCode}/book`) carries no subdomain, so the shared booking flow could not run on it at all; his change makes `subdomain` optional and adds `user_code`. Taking it verbatim would have broken **D13**: main's guard test asserts `expect(supabaseFrom).not.toHaveBeenCalled()` at route.test.ts:306, so a raw `supabaseServer` query inside the resolver fails the test rather than merely violating the standard. **Both repository methods already existed** (`findBySubdomainAny`, `findByUserCode`) - nothing was invented, no new repository method was added. Fixing the shared module rather than special-casing the route means his other two callers (`website/booking/intake`, `website/payment-intent`) inherit the repository routing for free. Two behaviours preserved deliberately: `findBySubdomainAny` applies **no status filter** (intake must work on draft/preview sites), and a subdomain that resolves to nothing **falls through** to the user-code branch rather than returning null - `findBySubdomainAny` uses `.single()`, so "not found" arrives as an error where his `maybeSingle()` gave `data: null`. The route's now-unused `WebsitePageRepository` / `supabaseServer` imports were dropped. **D13 verified intact afterwards: all 4 table accesses on repositories, `linkIntakeContact(booking_id, ownerId, contactId)` still called, `source_metadata` attribution still written, contact-lookup error still fatal, deferred-stage comment untouched. 15/15 intake guard tests pass.** |
| D20 | 2026-09-02 | **Step 10** - `lib/repositories/BusinessProfileRepository.ts` | **Auto-merged clean; extended the row interface with 2 more columns** (`template_id`, `subdomain`) | RM | His 18 changed lines touch only `getConversionConfig`, replacing a hardcoded `primaryColor: null` with a read of the existing `theme` column - which **D8** had already added to the interface, so his change needed nothing new to compile. The extension is **D8's standing rule** rather than his change: the interface is documented as an exhaustive mirror of the physical column set, and his commit's `20260903_business_template.sql` / `20260904_business_subdomain.sql` add two columns to `business_profiles`. Both are nullable `text` with no default, so both are `\| null` on the row and optional on Insert - **derived from the migrations, not guessed**, per D8. Nothing currently reads them *through* the repository (his `businessTemplate.ts` / `businessSubdomain.ts` query `supabaseServer` directly and cast inline), so this produced no TS change; it keeps the closed column list truthful. |
| D21 | 2026-09-02 | **Step 10** - the other 7 files where his work met a taken decision | **All auto-merged; every decision verified surviving, none re-resolved** | RM | Checked individually rather than assumed, because F4 is the class where git merges cleanly and the result is still wrong. **`middleware.ts` (D18):** his +35/-2 is purely a `V2_REWRITE_EXEMPT` list + `isV2Exempt()` helper; it landed on the Pino-converted file with **0** `console.*` added (count verified `0` for the whole file) and the business_profiles log-hygiene fix intact. **3 booking routes (D7):** all three trigger-**T2** comments present, **0** re-introduced `crm_activities` inserts, **0** writes to the dropped `client_*` columns. **`onboarding/build` (D10/F2):** his change is a single `export const maxDuration = 60`; the `tools` write and its provenance comment survive untouched. **Two files beyond the seven flagged in the incoming-work table were also caught by the overlap query and audited:** `SchedulingRepository.ts` - his change is one line widening a joined `service:scheduling_services(...)` select, and `linkIntakeContact` survives whole with its owner-verified-`contactId` invariant docblock and `.eq('user_id', userId)`; `payments/blocks/execute/route.ts` - he routes `record_manual_payment` through the branch's `settleInvoicePaid` for idempotency, and main's `paymentReminderRepository` reminder path is still there at 4 call sites, so the D14 coexistence holds. **D4/D5/D6/D9/D11/D12 files were not touched by this commit at all** (`package.json`, `package-lock.json`, `vercel.json`, `plugin-manager-v2`, `plugin-executer-v2`, `ChatCommandExecutor`, `scheduling/availability`) - his `booking/availability` route is a different file from D12's `scheduling/availability`. |
| D22 | 2026-09-02 | **Step 11** - attribution method for the verification numbers | **Built a temporary `git worktree` at his tip `54184fdb` and ran `tsc` and `npm run build` there**, rather than reasoning about which errors were new | RM | The Step 7 baseline is "0 errors in merge-changed non-test files" against a ~4,400-error pre-existing floor, so a raw count proves nothing - and [F5](#finding-f5---pre-existing-typescript-error-baseline-on-the-branch) already warned `tsc` is not a usable gate here. A second checkout of his tip (with a junction to the existing `node_modules`) gives a **like-for-like** error set to diff against. This is what let F6 be attributed to his branch with evidence rather than inference. The worktree and the `.env.local` copied into it for the build were both **removed afterwards** (`git worktree remove --force`; `git worktree list` shows only the main checkout). |
| D23 | 2026-09-02 | **F6** - `app/landing-preview/page.tsx` build failure | **Fixed** despite being Offir's pre-existing defect rather than merge work | User-approved on request | The page calls `useSearchParams()` with no Suspense boundary, so Next refuses to prerender it and the export step fails (`missing-suspense-with-csr-bailout`) - **the build gate went red**. Verified as his, not ours: the file is byte-identical to `54184fdb` and the RM reproduced the same failure building his tip in a clean worktree. Fixed the way Next documents: the component was renamed `LandingPreviewContent` and a thin default export wraps it in `<Suspense>`. **The fallback mirrors the component's own loading state** (same spinner, same copy, `defaultLocale` - the real locale comes from `?lang=`, which by definition cannot be read until the boundary resolves), so the boundary is invisible in use. Chose this over `export const dynamic = 'force-dynamic'`, which would have opted the page out of prerendering entirely to work around a two-line fix. `/landing-preview` now prerenders as static. |
| D24 | 2026-09-02 | `middleware.ts` (round 3) | **Took Offir's side entirely** | User-approved | He had independently done the same Pino conversion, and **his is better**: a dedicated `createEdgeLogger` (`lib/logger/edge.ts`) emitting Pino-shaped records, plus `logger.child({ correlationId, pathname })` binding context once instead of repeating `pathname` at every call site. All D18 invariants re-verified on his version: **0** `console.*`, the whole `business_profiles` row still never logged. **Caveat on D18:** its verification claimed "Edge-compatible" on the strength of a passing build. His module note argues Pino cannot initialise in the Edge Runtime at all - the bundle compiling never proved it would run. His approach is the safer one regardless of which reading is right. |
| D25 | 2026-09-02 | `app/api/website/forms/intake/route.ts` (round 3) | **Kept his localised activity title, sourced through the repositories** | User-approved | He added a locale-aware activity title (`activitySentence` in the business's own language) but reached it with two raw `supabaseServer` calls, which breaks D13 - the guard test asserts `expect(supabaseFrom).not.toHaveBeenCalled()`. The feature is real and was kept; the owner locale now comes from `businessProfileRepository.findByUserId`. Also **restored `source_entity_id: booking_id`**, which his version dropped: `crm_activities` has no metadata column, so that field is the only carrier of the booking linkage. The guard test's mock list gained `BusinessProfileRepository` - the route legitimately depends on it now, and the `supabaseFrom` assertion still catches raw client use. 15/15. |
| D26 | 2026-09-02 | `lib/repositories/CRMActivityRepository.ts` | **Kept main's deletion of `logPayment`** | User-approved | Main deleted it as dead code and a double-log footgun - trigger T3 is the sole writer of the payment `crm_activities` row. He rewrote it instead, fixing a genuine bug (a hard-coded `$` regardless of the business's billing currency). Re-checked at his tip: **still zero callers**, so the deletion stands. His finding is preserved in the note at the deletion site so a future reviver formats with `Intl.NumberFormat` rather than reintroducing the symbol. |
| D27 | 2026-09-02 | `lib/repositories/BusinessProfileRepository.ts` (round 3) | Union; **removed a dead import** | User-approved | His side adds `import type { Database } from '@/types/database'` - a module that exists **nowhere, including on his own branch** - and never uses the symbol. Removed rather than left to add a new type error attributable to the merge; because it is unused, this changes no behaviour. His 4 new invoice-tax columns are migration-backed (`20260907_invoice_tax_line`, `20260908_invoice_document_type`) and live on his own `InvoiceSettings` interface; all 22 columns from D8 verified intact. |

> **How to use this table:** every subsequent conflict resolution, architecture call, or deviation from the [Governing Merge Rule](#governing-merge-rule) is appended as a new row (`D2`, `D3`, …). In the **same edit**, update the matching row's **Status** in the [Ordered Execution Checklist](#ordered-execution-checklist) (⬜ Not started → 🟡 In progress → ✅ Done). A resolution without a Decision Log row is not considered resolved.

---

## Open Questions for Offir

These must be answered before Step 4 can be decided. Fill the **Answer** column in place; add a Decision Log row when an answer changes the plan.

| # | Question | Raised by | Status | Answer |
|---|----------|-----------|--------|--------|
| Q1 | Was the parallel build of the Business OS plugin surface known, or did the two of you not see each other's work? | BA / RM | ✅ Answered | **Parallel build - a genuine mix-up; neither saw the other's work.** Confirmed in code: both surfaces were added after the 2026-08-04 merge base, and the branch deletes nothing of main's (+7 / +8 lines only). Resolved by union - see [D9](#decision-log). |
| Q2 | Does BizQL's `MutateExecutor` account for triggers **T2 / T3 / T4 / T8**, or does BizQL assume it owns the side effects? (If not, the same write through the other door double-logs.) | BA / RM | ⬜ Open | *(blank)* |
| Q3 | Is the generated-from-catalog approach **load-bearing elsewhere** (the BOS chat, BizQL), or is the plugin surface a **thin cap** that could be re-pointed at main's five? **This is the decider for Step 4.** | BA / RM | ⬜ Open | *(blank)* |
| Q4 | Should Business OS actions be **hidden** from general plugin discovery (main's position, `visibility: "business_os"`) or **offered like any other plugin** (the branch's position)? | BA / RM | ⬜ Open | *(blank)* |

Additional open checks not directed at Offir:

| # | Question | Owner | Status | Answer |
|---|----------|-------|--------|--------|
| Q5 | Does the hosting plan's cron limit accommodate 3 crons (`payment-reminders`, `payment-retry`, `channel-metrics-sync`)? | Merge operator | ✅ Answered | **Yes - within budget.** 8 crons existed pre-merge (> Hobby's 2), so the project is on Pro (limit 40). Post-merge total is 11. Verify plan tier with Offir. |
| Q6 | Does the migration runner depend on lexical filename ordering (see [C2](#non-blocking-cleanups))? | Merge operator | ⬜ Open | *(blank)* |
| Q7 | 🔴 **[F1]** Branch migration `20260810_remove_client_fields_and_total_amount.sql` drops `client_*` from `scheduling_bookings`, but 7 branch-only insight detectors still `select` those columns. Was this migration applied and the detectors missed? See [Finding F1](#finding-f1---dropped-client_-columns-still-read-by-branch-code). | Offir | ⬜ Open | *(blank)* |
| Q8 | 🔴 **[F3]** `CapabilityConditionEvaluator.ts:377` selects `has_website` from `business_profiles`, but no migration creates that column - capability-condition evaluation throws. Should it be derived from `online_presence_mode` instead? See [Finding F3](#finding-f3---has_website-is-a-phantom-column-read-by-branch-only-code). | Offir | ⬜ Open | *(blank)* |
| Q9 | 🟡 **Product decision:** should completing an intake form advance the contact's CRM pipeline stage? The branch did (computing a per-tenant stage from `crm_pipeline_stages`); main does not (new contacts are `'lead'`, existing contacts' stage untouched) and its guard tests lock that. Main's behaviour is in place; restoring the branch's needs those two test expectations changed. | Barak + Offir | ⬜ Open | *(blank)* |
| Q10 | 🔴 **[F6]** `app/landing-preview/page.tsx` (new in `54184fdb`) calls `useSearchParams()` with no `<Suspense>` boundary, so `npm run build` exits **1** on the export step. Reproduced at your own branch tip, so it is failing for you too. One line to fix - wrap in `<Suspense>` or add `export const dynamic = 'force-dynamic'`. | RM | ⬜ Open | *(blank)* |
| Q11 | 🟡 **[F7]** `saved-plans.test.ts` has no mocks and makes a real Supabase call, so it passes or fails depending on how jest is invoked. Mock the repository, or drop `resolveEmailBranding` from that write path? | Offir | ⬜ Open | *(blank)* |

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
| 2026-09-01 | Step 0 complete | Merge opened on integration branch `merge/business-os-reports-into-main` (doc committed as `23b7379`, then `git merge origin/main`). **14 conflicts - exactly the predicted set**, no unpredicted files; auto-merged portion staged 156 files / +25,990 / -2,001. Decision Log D1 confirmed, D2-D3 added. |
| 2026-09-01 | Step 1 complete | Deps & config resolved (D4-D6): `package.json` took main, `package-lock.json` regenerated via `npm install` (exit 0), `vercel.json` unioned to 11 crons. **11 of 14 conflicts remain.** Q5 answered. |
| 2026-09-01 | Step 2 complete | Trivial tier resolved (D7): 3 booking routes + `PaymentRepository` + `WebsiteAnalyticsRepository`, all take-main; auto-merged content reviewed for coherence. **6 of 14 conflicts remain.** Added **Finding F1** (branch drops `client_*` from `scheduling_bookings` while 7 branch-only detectors still select them) and **Q7**. |
| 2026-09-01 | Step 3 complete | `BusinessProfileRepository` resolved (D8): type blocks unioned, 22 branch columns added to the row and Insert shapes, migration-derived. `tsc --noEmit` clean apart from markers in the 5 remaining files. **5 of 14 conflicts remain.** Added **Finding F2** - the `tools` column IS created by a branch migration, inverting main's premise and changing the Step 5 plan. |
| 2026-09-01 | Step 4 unblocked | **Q1 answered** (parallel build, mix-up). Plugin surfaces **unioned and the shape decision deferred** (D9): 29 definitions / 29 executors, no collisions, main's visibility + `db_active` hardening retained, interim comments at both sites. Retracted the earlier "two truths" objection. `tsc` clean. **4 of 14 conflicts remain.** |
| 2026-09-02 | Step 5 (1 of 3) | `onboarding/build/route.ts` resolved (D10) - branch side taken, all 16 written columns verified against the merged migration set, `tools` provenance documented. **3 of 14 conflicts remain.** Added **Finding F3** (`has_website` phantom column) and **Q8**. |
| 2026-09-02 | Step 5 (2 of 3) | `ChatCommandExecutor.ts` resolved (D11) - constants unioned, `payment.record` routed through `PaymentsPluginExecutor`, rogue `payment_transactions` insert gone. Added cleanup **C3** (duplicate capability authorization). **2 of 14 conflicts remain.** |
| 2026-09-02 | **All 14 conflicts resolved** | `availability` (D12) and `forms/intake` (D13) closed. **53/53 guard tests pass.** Added **F4** (7 merge-induced defects where one side's code meets the other's types/schema - Step 6 work), **F5** (4,413-error pre-existing TS baseline on the branch; `tsc` is not a usable gate, guard tests are), and **Q9** (intake stage product decision). |
| 2026-09-02 | F4 attribution corrected | Re-checked each of the seven against both parents. **#1 and #2 are pre-existing branch defects, not merge-induced** - the branch's own `CRMPipelineStagesRepository` has the same constructor signature and no `findByUser`. Five (#3-#7) are genuinely merge-induced. |
| 2026-09-02 | **Step 6 complete** | All 5 merge-induced F4 defects fixed (D14), plus one `tsc` could not see (`unwrap()` returns `any`). Main's `create_booking` guard tests updated to the post-drop contract (D15). 4 auto-merged files re-read - all clean. **Zero merge-changed test suites fail**; the 128 failures are the branch's pre-existing V6/pilot baseline. Remaining `tsc` errors in merge-changed non-test files: **0**. |
| 2026-09-02 | **Steps 6-7 complete** | F4 #1/#2 also fixed at the user's request (D16) - `crmPipelineStagesRepository.list()` replaces the non-existent `findByUser` and the argument-less constructor. `npm run build` **exit 0**, 280/280 static pages (D17). Guard + executor suites 93/93; Business OS 625/625. **Merge-changed `tsc` errors in non-test files: 0.** Only Step 8 (C1) remains before the gates. |
| 2026-09-02 | **Step 8 complete - all 9 checklist steps done** | `middleware.ts` converted to Pino (D18); Edge compatibility verified by build (0 Edge warnings, +2.9 kB). C1's attribution corrected - 11 of 12 `console.*` calls were main's. **The merge is fully resolved and verified but NOT yet committed.** Everything remaining is owed by others: Offir's branch defects (F1, F3), the deferred decisions (Q2/Q3/Q4, Q9, C3), the operator check (Q6), and the three gates. |
| 2026-09-02 | **Document reconciled** | Header status, ToC numbering and Acceptance Criteria brought in line with the Decision Log. **Three original criteria were found to assert the opposite of what was decided** (one plugin shape, no `tools` write, one capability-auth implementation) — marked SUPERSEDED with the decision that changed each, rather than edited away. 3 criteria remain genuinely open (Q6, open questions, gates). Added the per-file ledger link. |
| 2026-09-02 | **New work arrived on the branch** | Offir pushed `54184fdb` (116 files, +10,035/−2,739) after this merge was resolved. Added **Steps 9–11** (commit → merge his commit → re-verify) and an [Incoming Work](#incoming-work--offirs-commit-54184fdb-fetched-2026-09-02) section listing the **7 files where his new work lands on decisions already taken**. `merge-tree` confirms he introduces **no conflicts in new areas** — the conflict set against `main` is the same 14 files. |
| 2026-09-02 | **Step 9 complete** | Merge resolution committed on the integration branch as `8550eebb` - 14 conflicts, 18 decisions, nothing pushed. Unblocks Step 10: git refuses a second merge while `MERGE_HEAD` exists. |
| 2026-09-02 | **Step 10 complete - Offir's `54184fdb` merged** | **Exactly 1 conflict** - `forms/intake/route.ts` (D19), where his smart-link owner resolution met **D13**. Resolved by keeping the new capability and re-expressing his new `lib/business-os/publicOwner.ts` through `websitePageRepository.findBySubdomainAny` + `businessProfileRepository.findByUserCode`; both methods already existed. `BusinessProfileRepository` gained 2 migration-derived columns per D8's standing rule (D20). The other **8** overlap files auto-merged and were audited one by one (D21) - **two beyond the seven flagged in the incoming-work table** (`SchedulingRepository.ts`, `payments/blocks/execute/route.ts`) were caught by querying main's changed-file set directly rather than trusting the list. **All 7 protected decisions verified surviving: D7 ×3, D8, D10/F2, D13, D18.** |
| 2026-09-02 | **Step 11 - verified, one gate red** | `tsc`: **0** merge-induced errors. All 209 errors in the 25 merge-changed files with errors are **present identically at his tip `54184fdb`**; the only files erroring in the merged tree but not his are main's own test files (the F5 bucket-2 class) and stale `.next/` artifacts. Duplicate-method sweep across **111** merge-changed TS files: **0** real hits (`SchedulingRepository`'s `create`/`findById`/`update`/`delete` pairs straddle the class boundary at L532; `providerFactory.getProvider` is the known interface false-positive). Guard + executor suites **93/93** (baseline 93/93). Business OS **632/632** across 30 suites (baseline 625/625 across 29 - his commit adds a suite). Full jest **3,034 passed / 128 failed**; the 20 failing suites are the same pre-existing V6/pilot/orchestration set, all **byte-identical to `ea35c79`** and none touched by this merge. His new `lib/website-builder` tests **23/23**. **`npm run build` exit 1** - see F6. |
| 2026-09-02 | **Finding F6 added** | `/landing-preview` (new in `54184fdb`) breaks the build: `useSearchParams()` with no `<Suspense>` boundary. **Attributed by building his tip in a throwaway worktree** (D22) - same error, same exit code, so the merge neither caused nor worsened it. Not fixed, per the standing rule that branch defects belong to their author. Tracked as **Q10**. This is the **first time the build gate is red**, and it must be green before the merge to `main`. |
| 2026-09-02 | **Build gate restored to green** | [F6](#finding-f6) fixed (D23) - `landing-preview` wrapped in a Suspense boundary. **`npm run build` exit 0, 282/282 static pages**, `/landing-preview` now prerendered. Guard + executor **93/93**, Business OS **632/632**, 0 tsc errors on the page. Offir's outstanding branch defects are now **F1** and **F3** only. |
| 2026-09-02 | **Round 3 merged** | Offir's `6df79536` (262 files, +39,870/−5,786, 10 more migrations) merged. **4 conflicts** — all predicted, all on held decisions (D24–D27). His Edge logger supersedes D18's Pino conversion. **Build exit 0, 286/286. Guard + executor 93/93. Full jest 3,313 passed / 128 failed — identical baseline, and every failing suite is byte-identical to his tip.** Added **F7** (networked test) and **Q11**. |
| 2026-09-01 | Document created | Initial gap analysis from RM: 14 content conflicts across 4 areas, 5 silently-auto-merging high-risk files, 6 verified-safe checks, 2 non-blocking cleanups. Records the blocking Business OS plugin-shape decision (**corrected framing: parallel invention, not a revert**), the merge-into-branch strategy, an 8-step ordered checklist, the Decision Log seeded with D1, and 6 open questions (Q1–Q4 for Offir). |
