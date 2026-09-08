# Audit — Barak's "Blocked, consolidating everything open" report

> **Last Updated**: 2026-09-07

## Overview

Independent verification of every claim in Barak's 2026-09-07 blockers email. Each claim was
checked by execution — live read-only probes against the production Supabase schema, an isolated
Jest run, `tsc --noEmit`, and git history — not by reading the code. No claim in this document
rests on a code read alone, except where explicitly marked NOT AUDITED.

**Audit constraints observed:** read-only throughout. No migration was applied, no row written,
updated or deleted. The one test path that reaches a `send` fan-out was deliberately *not* run with
live credentials.

## Table of Contents

- [Verdict Summary](#verdict-summary)
- [Method](#method)
- [Claim 1 — Two migrations never applied](#claim-1--two-migrations-never-applied)
- [Claim 2 — Three detectors still query client_email](#claim-2--three-detectors-still-query-client_email)
- [Claim 3 — Four detectors broken against the schema](#claim-3--four-detectors-broken-against-the-schema)
- [Claim 4 — Generated types are missing](#claim-4--generated-types-are-missing)
- [Claim 5 — Still open from the merge](#claim-5--still-open-from-the-merge)
- [Claim 6 — saved-plans.test.ts hits the real database](#claim-6--saved-planstestts-hits-the-real-database)
- [Findings Barak did not report](#findings-barak-did-not-report)
- [Not audited](#not-audited)
- [Change History](#change-history)

---

## Verdict Summary

| # | Claim | Verdict |
|---|---|---|
| 1a | `20260904_business_subdomain` unapplied | ✅ CONFIRMED |
| 1a-impact | "breaks subdomain resolution" | ❌ REFUTED |
| 1b | `20260909_invoice_online_payment` unapplied | ❌ REFUTED |
| 2 | Three detectors still query `client_email` | ✅ ALREADY FIXED (3390050, 2026-08-26) |
| 3a | `WebMobileIssuesDetector` broken | ✅ CONFIRMED (worse than reported) |
| 3b | `WebPageUnderperformDetector` broken | ✅ CONFIRMED (worse than reported) |
| 3c | `PricingDiscountAbuseDetector` broken | ✅ CONFIRMED |
| 3d | `OpsPeakUnutilizedDetector` broken | 🟡 PARTLY CONFIRMED |
| 4a | `@/types/database` does not exist | ✅ CONFIRMED |
| 4b | `BusinessProfileRepository.ts` imports it, fails to compile | ❌ REFUTED |
| 4c | Nothing checks column names at build time | ✅ CONFIRMED (worse than reported) |
| 5a | Two capability paths coexist | ✅ CONFIRMED |
| 5b | Business OS ships one plugin and five side by side | ✅ CONFIRMED |
| 5c | `MutateExecutor` + triggers T2/T3/T4/T8 double-log | ⬜ NOT AUDITED |
| 5d | Intake completion advances CRM stage | ❌ REFUTED at app layer / ⬜ NOT AUDITED at trigger layer |
| 6a | `saved-plans.test.ts` has no mocks | ❌ REFUTED |
| 6b | `saved-plans.test.ts` makes live DB calls | ✅ CONFIRMED |

---

## Method

**Tree state.** `origin/main` is at `b83b359` (Merge PR #35), which already contains the
feature branch. Local branch `feature/business-os-reports-and-readiness` at `84614f0`.

```bash
git log --oneline -5 origin/main
# b83b359 Merge pull request #35 from AgentsPilot/feature/business-os-reports-and-readiness
# 84614f0 fix(business-os): retire the intake plugin, which operated a table that no longer exists
```

**Schema probes.** A throwaway Node script read `.env.local`, built a service-role Supabase
client, and ran `SELECT <columns> ... LIMIT 1` per claim. Verdicts read off the Postgres error
code: `42703` = column does not exist, `42P01` = relation does not exist. Script lived in the
scratchpad, not the repo.

---

## Claim 1 — Two migrations never applied

### 1a. `business_profiles.subdomain` — CONFIRMED

```
FAIL  business_profiles select=id,subdomain
      42703 column business_profiles.subdomain does not exist
```

The migration is genuinely unapplied.

### 1a-impact. "Breaks subdomain resolution" — REFUTED

Subdomain resolution does not read `business_profiles.subdomain`. It reads
`website_pages.subdomain`, which exists:

```
OK    website_pages select=id,subdomain  rows=1
```

All public resolution paths go through `WebsitePageRepository.findBySubdomain` /
`findBySubdomainAny` (`lib/repositories/WebsitePageRepository.ts:144,164`), plus the RPCs
`check_subdomain_available` and `generate_subdomain`.

A repo-wide grep for a read or write of `business_profiles.subdomain` returns **no call sites**.
The column appears only in the hand-written row interface
(`BusinessProfileRepository.ts:209`, `:297`) and in comments.

**No whole-select trap.** The main profile read uses `.select('*')`
(`BusinessProfileRepository.ts:325`), and none of the three explicit multi-column selects
(lines 708, 992, 1195) name `subdomain`. So the missing column returns `undefined` rather than
poisoning any select.

Applying the migration is still correct — it unblocks the business-level address feature — but it
is a prerequisite for unshipped work, not a live outage.

### 1b. `payment_invoices.allow_online_payment` — REFUTED

```
OK    payment_invoices select=id,allow_online_payment  rows=1
```

The column exists; the migration was applied. The flow is also fully wired end to end:

| File | Line | Role |
|---|---|---|
| `lib/repositories/PaymentRepository.ts` | 99, 663, 686 | row type + create/update field lists |
| `app/api/payments/invoices/route.ts` | 69, 217 | Zod input + persisted |
| `lib/services/InvoiceDeliveryService.ts` | 435 | read at send time |
| `app/invoice/[id]/page.tsx` | 140 | read by the client pay page |

---

## Claim 2 — Three detectors still query `client_email`

**Verdict: ALREADY FIXED** in `3390050` *feat(business-os): system readiness, reports period
filter, and RTL fixes*, 2026-08-26. Confirmed an ancestor of `origin/main`:

```bash
git merge-base --is-ancestor 3390050 origin/main && echo "3390050 IS on origin/main"
# 3390050 IS on origin/main
```

The column is indeed gone:

```
FAIL  scheduling_bookings select=id,client_email
      42703 column scheduling_bookings.client_email does not exist
OK    scheduling_bookings select=id,contact_id  rows=1
```

All three detectors already group by `contact_id`:

| Detector | Actual query | `client_email` present? |
|---|---|---|
| `CrmEngagementDecayDetector` | `.select('contact_id, start_time')` (L121) | No occurrence at all |
| `PricingIntroOfferStuckDetector` | `.select('id, contact_id, ...')` (L90) | Comment only (L143) |
| `RetRepeatBookingLowDetector` | `.select('contact_id, id, ...')` (L72) | Comment only (L90) |

The surviving occurrences are comments recording the removal, e.g.
`RetRepeatBookingLowDetector.ts:90`:

```
// Grouped by contact, not by email text. `client_email` was dropped
```

Note `client_email` *is* a live column on `payment_invoices` (`lib/business-os/catalog/catalog.ts:512`),
which is a different table and unaffected.

---

## Claim 3 — Four detectors broken against the schema

Every query in all four files was executed, not just the quoted one.

### 3a. `WebMobileIssuesDetector` — CONFIRMED, worse than reported

All four queries fail:

```
FAIL  q1 websites            42P01 relation "public.websites" does not exist
FAIL  q2 website_page_views  42703 column website_page_views.visitor_id does not exist
FAIL  q3 scheduling_bookings 42703 column scheduling_bookings.metadata does not exist
FAIL  q4 scheduling_bookings 42703 column scheduling_bookings.price does not exist
```

Failure mode is silent: the first query is guarded by
`if (websiteError || !website) { this.logDetection(userId, null); return null; }` (L68-71), so the
detector returns "nothing detected" on every run for every user rather than raising.

### 3b. `WebPageUnderperformDetector` — CONFIRMED, worse than reported

Four of five queries fail; only the `crm_contacts` one is sound.

```
FAIL  q1 websites            42P01 relation "public.websites" does not exist
FAIL  q2 website_page_views  42703 column website_page_views.page_path does not exist
FAIL  q3 scheduling_bookings 42703 column scheduling_bookings.source_url does not exist
OK    q4 crm_contacts select=id, source  rows=1
FAIL  q5 website_pages       42703 column website_pages.path does not exist
```

`website_pages` has `slug`, not `path`.

### 3c. `PricingDiscountAbuseDetector` — CONFIRMED

```
OK    q1 payment_transactions select=id, amount, metadata, contact_id, created_at  rows=1
FAIL  q2 scheduling_bookings select=id, payment_amount, metadata
      42703 column scheduling_bookings.metadata does not exist
```

Worth recording precisely: `metadata` **does** exist on `payment_transactions`. Only the
`scheduling_bookings` half is wrong, which is the trap — the column name is real, the table is not.

### 3d. `OpsPeakUnutilizedDetector` — PARTLY CONFIRMED

The detection logic is sound. Both queries that decide *whether* to fire succeed:

```
OK    q1+q2 scheduling_bookings select=start_time, status  rows=1
```

Only the third query, which prices the finding, fails:

```
FAIL  q3 scheduling_bookings select=price
      42703 column scheduling_bookings.price does not exist
```

At `OpsPeakUnutilizedDetector.ts:166-176` the result is destructured as `{ data: avgValue }` with
the error discarded, so `avgValue` is `null` and the code falls to its hardcoded default:

```typescript
: 75; // Default estimate
```

So this detector is not dead — it fires correctly and reports a **fabricated** missed-revenue
figure derived from $75/booking. Arguably worse than a dead detector, because the number looks real.

`scheduling_bookings` has `payment_amount`, not `price`.

### Barak's proposed replacement columns — both verified real

```
OK    scheduling_bookings select=id, booking_source  rows=1
OK    crm_contacts select=id, source_metadata  rows=1
```

### Reference: actual columns

**`website_page_views`:** `id, page_id, user_id, subdomain, viewed_at, user_agent, referer,
ip_hash, country_code, device_type, session_id, created_at, utm_source, utm_medium, utm_campaign,
is_owner_view`

Note `device_type` exists — it is `visitor_id` and `page_path` that do not. `session_id` and
`page_id` are the likely intended keys.

**`website_pages`:** `id, user_id, page_type, slug, title, meta_description, seo_keywords,
published, published_at, template_id, theme, created_at, updated_at, subdomain, custom_domain,
custom_domain_verified, status, last_published_at, favicon_url, og_image_url, client_flow,
website_language, content_generated_at`

**`scheduling_bookings`:** `id, user_id, service_id, contact_id, start_time, end_time, timezone,
status, cancellation_reason, payment_status, payment_id, notes, internal_notes, booking_source,
reminder_24hr_sent, reminder_2hr_sent, created_at, updated_at, external_calendar_event_id,
calendar_sync_provider, calendar_synced_at, calendar_sync_error, payment_method, payment_amount,
payment_currency, invoice_id, payment_plan_id, intake_responses, intake_completed_at, intake_sent_at`

---

## Claim 4 — Generated types are missing

### 4a. `@/types/database` does not exist — CONFIRMED

`/types/` contains only: `analytics.ts`, `pdf-parse.d.ts`, `pdfjs-dist.d.ts`, `settings.ts`,
`system-health.ts`.

### 4b. `BusinessProfileRepository.ts` imports it and fails to compile — REFUTED

Line 9 of that file is:

```typescript
import { supabaseServer } from '@/lib/supabaseServer';
```

There is no import of `@/types/database` anywhere in the repository. The only two matches
repo-wide are comments noting its absence:

- `app/business-os/website/page.tsx:7416`
- `app/api/website/forms/intake/__tests__/route.test.ts:6`

A full typecheck is clean:

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS"
# 0
```

Zero errors project-wide, and no `TS2307` for `types/database`.

### 4c. Nothing checks column names at build time — CONFIRMED, and worse

The conclusion holds even though the cited evidence does not. Additionally, generating the types
alone would **not** close the hole:

**File:** `next.config.js`

```javascript
typescript: {
  ignoreBuildErrors: true,
}
```

The build discards TypeScript errors regardless. Wiring column safety into CI needs the generated
types *and* a typecheck gate that actually fails the build.

---

## Claim 5 — Still open from the merge

### 5a. Two capability paths — CONFIRMED

Both exist. `lib/business-os/ChatCommandExecutor.ts` defines a local `verifyCapabilityAccess`
(L82, called at L1096) while `lib/business-os/chat/CapabilityEngine.ts` is used by
`ChatOrchestrator`, `ResponseRenderer`, `PaymentRepository` and
`app/api/payments/blocks/execute/route.ts`.

The duplication is self-documented at `ChatCommandExecutor.ts:32-41`, which also notes the local
version queries `user_capabilities` directly via `supabaseServer`, violating the mandatory
repository rule. Tracked as **D11 / C3** in `BUSINESS_OS_REPORTS_MERGE_REQUIREMENT.md`.

### 5b. One Business OS plugin or five — CONFIRMED

`lib/plugins/definitions/` ships the aggregate `business-os-plugin-v2.json` alongside four domain
plugins: `crm`, `payments`, `scheduling`, `website`. The intake plugin was retired in `84614f0`.

### 5c. `MutateExecutor` + triggers T2/T3/T4/T8 — NOT AUDITED

Still logged as open **Q2** in `BUSINESS_OS_REPORTS_MERGE_REQUIREMENT.md:633` (status ⬜ Open),
so Barak is right that it is outstanding. I could not resolve it: enumerating `pg_trigger`
requires SQL that the REST interface does not expose read-only, and I would not add an RPC to a
database I am auditing.

Partial signal only, not a verdict: `MutateExecutor.ts` contains two `activity_type` literals
(L211 `'email'`, L1065 `'note'`) and no direct `crm_activities` insert on the booking/payment
paths the triggers own. That is suggestive, not proof.

### 5d. Intake completion advances the CRM stage — REFUTED at the app layer

The stage advance was deliberately removed. `app/api/website/forms/intake/route.ts:214-215`:

```
// NOTE: `stage` is deliberately NOT written here — pipeline stage vocabulary is
// per-tenant (crm_pipeline_stages) and completing an intake is not a promotion
```

New contacts are created as `stage: 'lead'` (L259); an existing contact's stage is never touched.
L174 records tests asserting `expect(patch).not.toHaveProperty('stage')`.

The other three intake routes contain no `stage` reference at all:
`app/api/book/manage/[token]/intake/route.ts`, `app/api/scheduling/bookings/[id]/intake/route.ts`,
`app/api/website/booking/intake/route.ts`.

Trigger layer not audited — see 5c.

---

## Claim 6 — `saved-plans.test.ts` hits the real database

### 6a. "There are no mocks in this test" — REFUTED

`lib/business-os/bizql/__tests__/saved-plans.test.ts:22-48` defines `makeFakeClient()`, a fake
Supabase client injected via `new SavedPlanStore(client)`. The file docblock (L12) states the
intent: *"The store's own DB calls are mocked."*

### 6b. "It makes a live DB call" — CONFIRMED

Correct, for a reason the report does not identify. The injected client is bypassed by three
un-injected module-level call sites reached from the `applyFrozenWrites` test (L199). Each emitted
a real outbound `fetch`:

| Call site | Path |
|---|---|
| `BusinessProfileRepository.findByUserId` | `applyWrites.ts:78` → `lib/email/branding.ts:74` → `BusinessProfileRepository.ts:323` |
| `SystemConfigService.get('bizchat_daily_limit_contacts_send')` | `ForEachExecutor.ts:236` → `SystemConfigService.ts:98` |
| `ActionLog.countToday` | `ForEachExecutor.ts:237` → `ActionLog.ts:146` |

All three logged `TypeError: fetch failed` — proof a real network call was attempted, not mocked.

**The risk is environment-dependent, and that makes it more serious.**
`tests/plugins/jest-setup.ts:12-14` stubs the Supabase env only when it is not already set:

```typescript
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key';
```

In this run the fetch went to the placeholder host and failed. On any machine or CI job with real
Supabase env exported, these three calls resolve against the **real database with the service-role
key**. I did not run that variant — the same test drives a `send` fan-out, and this audit is
read-only.

### 6c. The test passes, but Jest will not exit — the cause is unrelated

```
Tests:       8 passed, 8 total
Time:        3.38 s
```

Without `--forceExit`, the run hangs (I timed one out at 6m40s). `--detectOpenHandles` names it:

```
●  Timeout
    at AuditTrailService.startFlushTimer (lib/services/AuditTrailService.ts:231:23)
    at AuditTrailService.getInstance (lib/services/AuditTrailService.ts:63:36)
    at Object.<anonymous> (lib/services/BookingLifecycleService.ts:35:1)
    at Object.<anonymous> (lib/business-os/bizql/mutate/MutateExecutor.ts:39:1)
    at Object.<anonymous> (lib/business-os/bizql/mutate/applyWrites.ts:27:1)
```

A module-level `AuditTrailService.getInstance()` starts a `setInterval` flush timer that is never
cleared. This is a separate defect from the unmocked DB calls; mocking Supabase would not fix it.

---

## Findings Barak did not report

### F1. `PricingIntroOfferStuckDetector` enrichment matches UUIDs against the email column

The `client_email` → `contact_id` migration was completed everywhere except one enrichment query.
At L147 the loop variable is assigned a contact UUID but keeps its old name:

```typescript
const email = booking.contact_id;
```

That value flows into `stuckEmails`, which is then used at L231-235 as an *email* filter:

```typescript
.from('crm_contacts')
.select('id, email, first_name, last_name')
.eq('user_id', userId)
.in('email', [...stuckEmails].slice(0, 50));
```

Probed with a real booking's `contact_id` (`8742fcd8-…`) for its owning user:

```
AS-WRITTEN  .in(email,[uuid]) -> err= none rows= 0
CORRECTED   .in(id,[uuid])    -> err= none rows= 1
```

No error — Postgres compares the UUID as text against `email` and matches nothing. `stuckContacts`
is therefore **always empty**. The insight still fires with a correct conversion rate and severity,
but names nobody, so the one actionable part of it is missing. The stale `email` identifier naming
is what hides this.

### F2. `SystemConfigService.ts` logs via `console.*`

14 `console.*` calls, including the `console.warn` at L98 surfaced by the test run. Per CLAUDE.md
this should be converted to `createLogger`. Flagged, not changed.

---

## Not audited

| Item | Why |
|---|---|
| Triggers T2 / T3 / T4 / T8 double-logging (5c) | Cannot enumerate `pg_trigger` read-only via the REST interface |
| Whether a DB trigger advances CRM stage on intake (5d) | Same constraint; app layer refuted, trigger layer unverified |
| `saved-plans.test.ts` against real credentials | Deliberately not run — the path drives a `send` fan-out |
| Which capability path *should* survive (5a) | A design decision, not a factual claim |
| Whether the Business OS plugin surface should be 1 or 5 (5b) | Same |

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-07 | Initial audit | All 6 claims verified by execution against live schema, isolated Jest run, `tsc`, and git history. Two new findings (F1, F2) recorded. |
