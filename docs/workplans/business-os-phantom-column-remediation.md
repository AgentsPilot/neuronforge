# Phantom Column Remediation — Workplan

> **Last Updated**: 2026-09-07

## Overview

A live read-only sweep of the production database found **48 database selects in the codebase that fail against the actual schema**. Each one asks for a column or table that does not exist, and PostgREST rejects the *entire* select for a single unknown name — so these are not degraded queries, they are total failures for every user, every time.

This is the same class of bug as `has_website` (fixed) and the `client_email` detectors (F1). It is not three isolated mistakes; it is a systematic gap with a single root cause: **`@/types/database` does not exist**, so no column name in this codebase is checked at build time.

The sweep also revealed that **migrations have been applied out of order, with gaps** — two are missing while later ones have run. Two live features are broken purely because of that, with no code defect at all.

**Scope note:** this workplan covers what the sweep found. It supersedes the narrower "fix the seven detectors" framing in [BUSINESS_OS_REPORTS_MERGE_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_REPORTS_MERGE_REQUIREMENT.md) F1.

---

## Table of Contents

1. [How This Was Measured](#how-this-was-measured)
2. [P0 — Apply Two Missing Migrations](#p0--apply-two-missing-migrations)
3. [P1 — Business OS Insight Detectors](#p1--business-os-insight-detectors)
4. [P2 — Root Cause: Generate the Database Types](#p2--root-cause-generate-the-database-types)
5. [P3 — Platform-Wide Breakages](#p3--platform-wide-breakages)
6. [Sequencing](#sequencing)
7. [Open Questions](#open-questions)
8. [Change History](#change-history)

---

## How This Was Measured

Read-only. No writes, no DDL, no RPC.

Every `.from('table').select('cols')` pair in `lib/`, `app/` and `components/` was extracted (1,761 files, 530 distinct pairs) and replayed against the live database as a **zero-row select** — `.select(cols).limit(0)`. PostgREST validates every column name and returns no data, so the probe is definitive about existence and reads nothing.

**Known blind spots** — the real number is a floor, not a ceiling:

| Not covered | Why |
|---|---|
| `.select('*')` | No column names to check |
| Embedded joins — `.select('a, contact:crm_contacts(email)')` | Skipped to avoid false positives on relationship syntax |
| Template-literal or multi-line selects | The extractor only reads single-line quoted strings |
| Writes — `.insert()` / `.update()` payloads | Same phantom-column risk, not yet swept. **F4 found several by hand** |

---

## P0 — Apply Two Missing Migrations

🔴 **No code change. Two live features are broken solely because their migration never ran.**

Migration state, probed one representative column each:

| Migration | State |
|---|---|
| `20260810_remove_client_fields` | ✅ applied |
| `20260812_onboarding_intelligence` | ✅ applied |
| `20260824_add_conversion_layer` | ✅ applied |
| `20260827_business_logo` | ✅ applied |
| `20260831_collection_method` | ✅ applied |
| `20260901_service_shape` | ✅ applied |
| `20260902_business_theme` | ✅ applied |
| `20260902_page_content_generated` | ✅ applied |
| `20260903_business_template` | ✅ applied |
| **`20260904_business_subdomain`** | 🔴 **NOT APPLIED** |
| `20260907_invoice_tax_line` | ✅ applied |
| `20260908_invoice_document_type` | ✅ applied |
| **`20260909_invoice_online_payment`** | 🔴 **NOT APPLIED** |
| `20260910_business_intake_forms` | ✅ applied |

**The gaps are not at the end.** `20260904` and `20260909` were skipped while everything after them ran. The database is in a state that no clean sequential run would produce, which means the ordering question (Q6) is not theoretical — it has already happened.

**Consequences right now:**

| Broken | Needs |
|---|---|
| `lib/business-os/businessSubdomain.ts` — 2 failing selects | `business_profiles.subdomain` |
| Invoice online-payment flow | `payment_invoices.online_payment_enabled` |

**Tasks**

- [ ] Confirm with Offir that `20260904` and `20260909` were skipped accidentally, not deliberately
- [ ] Apply both, in order
- [ ] Re-probe: `business_profiles.subdomain` and `payment_invoices.online_payment_enabled` resolve
- [ ] Establish how migrations are tracked and applied — nothing in the repo records applied state, which is why two went missing unnoticed

---

## P1 — Business OS Insight Detectors

🔴 **11 failing selects across 7 detectors.** These split into three groups by fix type, and only the first is mechanical.

### Group A — dead selects (no behaviour change)

The column is selected and never read. Remove it from the select.

| Detector | Column | Status |
|---|---|---|
| `OpsLastMinuteCancelsDetector` | `client_email` | ✅ **Done** — branch `fix/business-os-detector-dead-selects` |
| `RetCancellationSpikeDetector` | `client_email` | ✅ **Done** — same branch |

Both post-fix selects were validated against the live schema.

### Group B — identity swap (small behaviour change, needs confirmation)

`client_email` is used as a **client identity key**. `contact_id` is the correct replacement — it is required on every booking and is the real identity — but results change at the edges: two contacts sharing an email currently collapse into one and would stop collapsing.

| Detector | Use |
|---|---|
| `CrmEngagementDecayDetector` | Set of active client emails |
| `PricingIntroOfferStuckDetector` | Groups bookings by email |
| `RetRepeatBookingLowDetector` | Filters non-null email, then groups |

The `contact_id` variant of all three selects was **pre-validated against the live schema** — the fix will work. Blocked only on intent.

- [ ] Offir confirms `contact_id` matches what each detector measures
- [ ] Apply, add a test per detector — there is currently **one** test file across all detectors

### Group C — features that have never worked

🔴 **Not dead selects. These query tables and columns that have never existed**, and the values are *used*. Removing the phantom name would leave the detector running and silently producing empty results — worse than the current error.

| Detector | Failing selects |
|---|---|
| `WebMobileIssuesDetector` | `websites` — **table does not exist**; `website_page_views.visitor_id`; `scheduling_bookings.metadata` (used for `device_type` / `user_agent`) |
| `WebPageUnderperformDetector` | `website_page_views.page_path`; `website_pages.path`; `scheduling_bookings.source_url` (used to attribute bookings to pages) |
| `PricingDiscountAbuseDetector` | `scheduling_bookings.metadata` |
| `OpsPeakUnutilizedDetector` | `scheduling_bookings.price` |

`WebMobileIssuesDetector` queries a `websites` table that does not exist anywhere. These were written against a schema that was never built.

- [ ] **Product decision per detector:** rebuild against real columns, or retire it. `booking_source` and the `crm_contacts.source_metadata` attribution layer are the live equivalents for the web ones; `payment_amount` is live where `price` was expected
- [ ] Until decided, they fail loudly — which is the safer of the two failure modes. **Do not "fix" them by deleting the phantom column**

---

## P2 — Root Cause: Generate the Database Types

🟡 **This is why all 48 exist, and why they survived review.**

`@/types/database` is imported in at least one file and **does not exist anywhere in the repo**. Several code comments assume it does. Its absence means:

- No column name is checked at build time
- `next.config.js` ignores TypeScript errors anyway, so even a partial type would not gate CI
- The only thing catching column names today is hand-written guard tests, which exist for exactly one route

Generating it — `supabase gen types typescript` — turns every one of these 48 from a silent runtime failure into a compile error, and prevents the next 48.

- [ ] Generate `types/database.ts` from the live schema
- [ ] Wire it into the Supabase client generics so `.select()` is checked
- [ ] Decide whether TS errors should gate the build — currently they are ignored, which is what let a 4,400-error baseline accumulate
- [ ] Add the regeneration step to the migration workflow so the types cannot drift again

---

## P3 — Platform-Wide Breakages

🟡 **26 failing selects outside Business OS.** Not from this merge, not owned by anyone currently. Recorded so they are not rediscovered a third time.

**Tables that do not exist at all:** `users`, `user_api_keys`, `behavior_rules`, `insight_outcomes`, `workflow_drafts`, `user_credits`

**Representative column failures:**

| Area | File | Missing |
|---|---|---|
| Admin | `api/admin/users/[id]/stats/route.ts` | `agent_executions.total_tokens_used`, `user_subscriptions.plan_name` |
| Admin | `api/admin/token-usage/drill-down/route.ts` | `workflow_executions.input_data` |
| Stripe | `api/stripe/webhook/route.ts` | `ais_system_config.pilot_credit_cost_usd` |
| Stripe | `api/stripe/create-checkout/route.ts` | `profiles.display_name` |
| Pilot | `lib/pilot/insight/PredictiveAnalytics.ts` | `execution_metrics.success_step_count` |
| Memory | `lib/memory/UserMemoryContextBuilder.ts` | `agents.workflow`, `agents.trigger_type` |
| Business OS | `api/business-os/my-day/route.ts` | `business_profiles.business_name` |
| Website | `api/website/landing-pages/generate/route.ts` | `business_profiles.target_audience` |

- [ ] Triage: which of these are live user-facing paths vs dead code
- [ ] Assign an owner — this is platform debt, not Business OS

---

## Sequencing

| Order | Work | Why first |
|---|---|---|
| 1 | **P0** — apply the two migrations | Zero code change, fixes two live features immediately, and unblocks nothing else being confused by a half-applied schema |
| 2 | **P1 Group A** | Already done, ready to merge |
| 3 | **P1 Group B** | One question to Offir, fix pre-validated |
| 4 | **P2** — generate types | Do this *before* Group C, so the rebuild is type-checked rather than hand-verified |
| 5 | **P1 Group C** | Needs product decisions; benefits from P2 |
| 6 | **P3** | Separate thread, separate owner |

---

## Open Questions

| # | Question | Owner |
|---|----------|-------|
| W1 | Were `20260904` and `20260909` skipped accidentally? What applies migrations, and what records that they ran? | Offir / Barak |
| W2 | Does `contact_id` match the intent of the three Group B detectors? | Offir |
| W3 | For each Group C detector — rebuild against real columns, or retire? | Offir / product |
| W4 | Was `types/database.ts` ever generated, or always aspirational? | Offir |
| W5 | Should TypeScript errors gate the build? Today they are ignored and a ~4,400-error baseline has accumulated | SA |

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-07 | Created | Live read-only schema sweep: 530 select pairs across 1,761 files, **48 failing**. Found two unapplied migrations causing live breakage, 11 broken detector selects in three distinct fix categories, and the missing generated types as the common root cause. |
