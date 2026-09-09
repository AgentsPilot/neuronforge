# Phantom Column Remediation — Workplan

> **Last Updated**: 2026-09-09

## Overview

A live read-only sweep of the production database found database selects across the codebase that fail against the actual schema. PostgREST rejects the *entire* select for a single unknown name, so these are total failures, not degraded queries — and several fail *silently*, because the error is destructured away and the code falls through to a default.

This document was revised on 2026-09-09 after Offir audited the same list independently. **He found three errors in the first version and two bugs neither of us had recorded.** The [Corrections Register](#corrections-register) states what changed and why, because the reasons are more useful than the conclusions.

**Root cause, unchanged:** `types/database.ts` does not exist and `next.config.js` sets `ignoreBuildErrors: true`, so no column name is checked at build time or in CI.

---

## Table of Contents

1. [Corrections Register](#corrections-register)
2. [The Tree Problem](#the-tree-problem)
3. [P0 — Merge `dda5c51f`](#p0--merge-dda5c51f)
4. [P1 — Two One-Line Bugs](#p1--two-one-line-bugs)
5. [P2 — Generated Types + a Gate That Fails](#p2--generated-types--a-gate-that-fails)
6. [P3 — The Web Detectors](#p3--the-web-detectors)
7. [P4 — `business_subdomain` Migration](#p4--business_subdomain-migration)
8. [P5 — `saved-plans.test.ts` (two defects)](#p5--saved-planstestts-two-defects)
9. [P6 — Platform-Wide Breakages](#p6--platform-wide-breakages)
10. [Sequencing](#sequencing)
11. [Prevention](#prevention)
12. [Open Questions](#open-questions)
13. [Change History](#change-history)

---

## Corrections Register

Errors in the first version of this workplan, kept visible rather than edited away.

| # | Claim (v1) | Reality | Cause |
|---|-----------|---------|-------|
| C1 | `20260909_invoice_online_payment` is **not applied** | **It is applied.** The column is `allow_online_payment`, not `online_payment_enabled` | The probe guessed the column name from the *migration filename* instead of reading the migration body. **This is the exact failure class the document is about** |
| C2 | ~4,400 pre-existing TypeScript errors; `tsc` unusable as a gate | **`npx tsc --noEmit -p tsconfig.json` reports 0** | Earlier counts were taken mid-merge and included `.next/` generated types and test files. Never re-measured on a clean tree |
| C3 | `@/types/database` is imported in at least one file | **Imported nowhere.** One match in the repo, a comment in a test | It *was* imported in `BusinessProfileRepository` — and removed during the merge under D11/D27. The workplan described a state already fixed by its own author |
| C4 | The three identity detectors need a `contact_id` fix | The fix **exists** — but on an unmerged branch, not `main` | See [The Tree Problem](#the-tree-problem) |

**C2 changes the plan materially.** A typecheck gate was scoped as a cleanup project behind thousands of errors. At zero errors it is a config change available today, which moves [P2](#p2--generated-types--a-gate-that-fails) up.

---

## The Tree Problem

Both audits were internally correct and reached opposite conclusions, because neither stated which git ref it ran against.

| Ref | `CrmEngagementDecayDetector` |
|---|---|
| `origin/main` | `.select('client_email, start_time')` — **broken** |
| `origin/feature/business-os-reports-and-readiness` | `.select('contact_id, ...')` — fixed |

The fix lives in **`dda5c51f`** — *"booking self-service, bizql writes, and CRM drawer fixes"*, 64 files, +5,143/−644 — which is **one commit ahead of `main` and unmerged**.

So the `contact_id` work is real, and it is not anywhere users can reach. On `main`, which is what ships, all three detectors still fail.

> **Rule going forward:** every schema or defect claim states the ref it was measured on. Without it, two correct audits produce a contradiction and the disagreement costs more than the bug.

---

## P0 — Merge `dda5c51f`

🔴 **Highest value. Nothing else is coherent while `main` and the feature branch disagree.**

Verified: `git merge-tree origin/main dda5c51f` returns **no conflicts**.

**What it brings**

- ✅ The three identity detectors move from `client_email` to `contact_id`
- ✅ Touches `WebMobileIssuesDetector` and `WebPageUnderperformDetector` (removes `client_email`, does **not** fix their other phantom columns — see [P3](#p3--the-web-detectors))
- ➕ Introduces the `.in('email', <uuids>)` bug fixed in [P1](#p1--two-one-line-bugs)

**Tasks**

- [ ] Merge `dda5c51f` to `main` via PR
- [ ] Re-run the schema sweep afterwards — the detector list changes
- [ ] Confirm `main` and the feature branch agree, so the next audit has one tree

---

## P1 — Two One-Line Bugs

🔴 **Both are live, both produce wrong output rather than an error, and both are one line.**

### 1a — `PricingIntroOfferStuckDetector`: UUIDs matched against an email column

Arrives with `dda5c51f`. Line 147 assigns a contact UUID to a variable still named `email`:

```typescript
const email = booking.contact_id;   // name is now a lie
...
.in('email', [...stuckEmails].slice(0, 50));   // matches UUIDs against crm_contacts.email
```

Probed: `.in('email', [uuid])` → 0 rows, **no error**. `.in('id', [uuid])` → 1 row. Postgres compares the UUID as text and matches nothing, so the insight fires with a correct rate and severity but names **nobody** — the only actionable part of it.

- [ ] `.in('email', …)` → `.in('id', …)`
- [ ] Rename `email` / `stuckEmails` → `contactId` / `stuckContactIds`. **The stale name is what hid this in review**

### 1b — `OpsPeakUnutilizedDetector`: fabricated revenue

```typescript
.select('price')                                    // column is payment_amount
...
: 75;                                               // silent fallback
```

Its detection queries are sound, so it fires correctly. Only the query that *prices* the finding fails — and the error is discarded, so it falls through to a hardcoded $75 per booking. **It is currently showing users an invented missed-revenue number.**

- [ ] `price` → `payment_amount`
- [ ] Decide whether the `: 75` fallback should exist at all, or whether the finding should suppress its revenue estimate when it cannot compute one

> Worse than dead. A dead detector reports nothing; this one reports a number that looks real.

---

## P2 — Generated Types + a Gate That Fails

🟡 **The only item that prevents the next round instead of cleaning up the last.**

Generated types alone are not enough — `next.config.js` has:

```javascript
typescript: { ignoreBuildErrors: true }
```

so the build discards type errors regardless. Types without a failing gate give the feeling of coverage without the coverage.

**The tree currently typechecks clean (0 errors), so the gate can be switched on immediately** rather than after a cleanup project.

- [ ] Generate `types/database.ts` (`supabase gen types typescript`)
- [ ] Wire it into the Supabase client generics so `.select()` is checked
- [ ] Add a `typecheck` script and make it fail CI
- [ ] Decide on `ignoreBuildErrors` — needs agreement before starting
- [ ] Add type regeneration to the migration workflow so they cannot drift

---

## P3 — The Web Detectors

🔴 **Product decision required before any code.**

Not dead selects — they *use* the missing values, so deleting the column reference leaves them running and silently returning empty results.

| Detector | Failing (verified against live schema) |
|---|---|
| `WebMobileIssuesDetector` | `websites` — **table does not exist**; `website_page_views.visitor_id`; `scheduling_bookings.metadata`; `scheduling_bookings.price`. **All four queries fail.** Guarded by `if (websiteError \|\| !website) return null`, so it reports "nothing detected" for every user, every run |
| `WebPageUnderperformDetector` | `websites`; `website_page_views.page_path`; `website_pages.path` (real column is `slug`); `scheduling_bookings.source_url`. Four of five fail — only the `crm_contacts` query is sound |
| `PricingDiscountAbuseDetector` | Only the `scheduling_bookings.metadata` half. `payment_transactions.metadata` **does** exist — right column name, wrong table |

Live replacements confirmed to exist: `scheduling_bookings.booking_source`, `crm_contacts.source_metadata`, `website_pages.slug`.

- [ ] **Decide per detector: rebuild or retire.** They have been silently dead long enough that nobody noticed — which is itself evidence about whether anyone reads their output
- [ ] `PricingDiscountAbuseDetector` is the cheap one: one query, wrong table
- [ ] Until decided, leave them failing loudly. **Do not "fix" by deleting the phantom column**

---

## P4 — `business_subdomain` Migration

🟡 **Genuinely unapplied. No live impact today, but one business away from being a silent bug.**

`business_profiles.subdomain` does not exist — confirmed. The read in `businessSubdomain.ts:41-45` fails 42703 on every call, but **softly**: the error is destructured away, `profile` is null, and execution falls through to the `website_pages.subdomain` path, which works. That is where every real address comes from today.

What is actually dead is the final fallback:

```typescript
return profile?.user_code || null;   // profile is always null
```

A business with no subdomain on any page can never reach its `user_code`, and `WebsitePublishService:130` refuses the publish with *"This page has no web address yet."*

Current exposure: **1 user with website pages, 0 with no subdomain.** Nobody is in that state — yet.

- [ ] Apply `20260904_business_subdomain`
- [ ] Re-probe `business_profiles.subdomain`
- [ ] Establish how migrations are applied and what records them — nothing in the repo tracks it, which is how this went unnoticed

---

## P5 — `saved-plans.test.ts` (two defects)

🟡 **Two separate problems; fixing one does not fix the other.**

### 5a — Un-injected call sites reach the real database

The test *does* mock — `makeFakeClient()` injected via `new SavedPlanStore(client)`. What escapes the injection is three module-level call sites reached from the `applyFrozenWrites` test:

| Escape | Path |
|---|---|
| `BusinessProfileRepository.findByUserId` | `applyWrites.ts:78` → `lib/email/branding.ts:74` |
| `SystemConfigService.get(...)` | `ForEachExecutor.ts:236` |
| `ActionLog.countToday` | `ForEachExecutor.ts:237` |

`tests/plugins/jest-setup.ts` stubs Supabase env **only when unset**:

```typescript
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://test.supabase.co';
```

So on a machine or CI job with real Supabase env exported, **these three resolve against the real database with the service-role key.** The same test drives a send fan-out.

- [ ] Inject or mock the three call sites
- [ ] Consider making `jest-setup.ts` *override* rather than default, so a real env cannot leak into tests

### 5b — Jest never exits

Passes 8/8 in 3.4s, then hangs. `--detectOpenHandles`:

```
AuditTrailService.startFlushTimer (lib/services/AuditTrailService.ts:231)
  at AuditTrailService.getInstance (:63)  ← module-level call
```

A module-level `getInstance()` starts a `setInterval` flush timer that is never cleared. **Mocking Supabase would not fix this** — the timer needs disposing or the singleton injecting.

---

## P6 — Platform-Wide Breakages

🟡 **~26 failing selects outside Business OS.** Not from this work, no current owner. Recorded so they are not rediscovered a third time.

**Tables that do not exist:** `users`, `user_api_keys`, `behavior_rules`, `insight_outcomes`, `workflow_drafts`, `user_credits`

**Representative:** `agent_executions.total_tokens_used`, `user_subscriptions.plan_name`, `workflow_executions.input_data`, `ais_system_config.pilot_credit_cost_usd`, `profiles.display_name`, `execution_metrics.success_step_count`, `agents.workflow`, `business_profiles.business_name`, `business_profiles.target_audience`

- [ ] Triage live paths vs dead code
- [ ] Assign an owner — platform debt, not Business OS

---

## Sequencing

| Order | Work | Why |
|---|---|---|
| 1 | **P0** — merge `dda5c51f` | Clean merge. Everything else is measured against the wrong tree until this lands |
| 2 | **P1** — the two one-liners | Both currently produce *wrong output*, not errors. 1b is putting invented revenue in front of users |
| 3 | **P2** — types + CI gate | Free today at 0 errors. Do it **before** P3 so the rebuild is type-checked |
| 4 | **P4** — apply the migration | Cheap, closes a trap |
| 5 | **P5** — the test defects | Real-DB access from tests is a standing hazard |
| 6 | **P3** — web detectors | Needs a product call first |
| 7 | **P6** — platform sweep | Separate owner |

---

## Prevention

The engineering fix and the procedural fix are different, and the engineering one does more.

**Engineering (P2, above).** Generated types plus a failing CI gate turn every one of these from a silent runtime failure into a build error. Nothing procedural comes close.

**Procedural — a committed schema-check script.** Most of both audits was mechanical: extract every `.from().select()`, replay it against the live schema as a zero-row select, report failures. It should be a checked-in script anyone can run, not something rebuilt per audit. It would have caught [C1](#corrections-register) and [C4](#corrections-register) before either reached a list.

- [ ] Commit the sweep as `scripts/schema-check.ts`, read-only, zero-row selects only
- [ ] Have it print the git ref it ran against
- [ ] Extend to `.insert()` / `.update()` payloads — never swept, same risk class

**Known blind spots** — the failure count is a floor: `.select('*')`, embedded joins, template-literal selects, and write payloads are all unchecked.

---

## Open Questions

| # | Question | Owner |
|---|----------|-------|
| W1 | Was `20260904` skipped by accident? What applies migrations and what records them? | Offir / Barak |
| W3 | Rebuild or retire, per web detector? | Product |
| W5 | Turn off `ignoreBuildErrors` and gate CI on typecheck? | SA |
| W6 | Should the `: 75` revenue fallback exist at all? | Product |
| Q2 | Does BizQL's `MutateExecutor` account for triggers T2/T3/T4/T8? **Needs psql** — the REST interface cannot enumerate `pg_trigger` read-only, and neither auditor was willing to add an RPC to audit with | Needs DB access |
| Q9 | Intake stage advance — refuted at the app layer (stage deliberately not written, tests assert it). **Only a trigger could still do it**, same psql wall as Q2 | Needs DB access |

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-09 | **Revised after independent audit** | Offir re-ran the list against the live schema. Three v1 claims were wrong ([C1–C3](#corrections-register)) and one was measured on the wrong tree ([C4](#the-tree-problem)). Two new live bugs recorded — `.in('email', <uuids>)` and the fabricated `$75` revenue estimate — both producing wrong output rather than errors. `tsc` is clean at 0 errors, which moves the CI gate from a cleanup project to a config change. Added [Prevention](#prevention) and the ref-stating rule. |
| 2026-09-07 | Created | Live schema sweep: 530 select pairs across 1,761 files, 48 failing. Found unapplied migrations, 11 broken detector selects, and the missing generated types as common root cause. |
