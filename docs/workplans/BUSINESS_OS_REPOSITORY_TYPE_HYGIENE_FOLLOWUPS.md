# Business OS — Repository / Type-Hygiene Follow-ups

> **Last Updated**: 2026-08-12

## Overview

A small cleanup workplan for the **type-hygiene residue** left behind by two earlier changes:
1. the Insights **G2 minimal slice** ([BUSINESS_OS_INSIGHTS_G2_MINIMAL_WORKPLAN.md](/docs/workplans/BUSINESS_OS_INSIGHTS_G2_MINIMAL_WORKPLAN.md)), and
2. the **`@/types/database` → hand-written interfaces** change (SA-approved), which replaced the missing generated Supabase types in the only 2 repos that imported them (`BusinessProfileRepository`, `OnboardingConversationRepository`).

None of these are bugs — they are SA-flagged **Low-severity** correctness/honesty improvements deferred at the time. They are small, independent, and can be done in one short session. Grouped here because they all touch `BusinessProfile`/`business_profiles` typing.

> **Starting a session for this:** branch fresh off `main`. These items are independent — you can do any subset. Verify line numbers before editing (they may have shifted since these notes were written).

## Table of Contents

1. [T1 — `BusinessProfileInsert.vertical` nullability](#t1--businessprofileinsertvertical-nullability)
2. [T2 — Redundant cast in OpsUtilizationLowDetector](#t2--redundant-cast-in-opsutilizationlowdetector)
3. [T3 — Phantom `business_profiles` fields (currency / timezone / contact_email)](#t3--phantom-business_profiles-fields)
4. [T4 — Availability-route double cast (optional)](#t4--availability-route-double-cast-optional)

---

## T1 — `BusinessProfileInsert.vertical` nullability

**Severity:** Low · **Risk:** 🟢

**Problem.** When `@/types/database` was replaced with a hand-written interface, `BusinessProfileInsert.vertical` was typed **`string | null`** to mirror the one call site that writes it — even though the DB column `business_profiles.vertical` is **NOT NULL**. So the TS type is looser than the DB constraint: TypeScript won't catch a `null` insert, and Postgres would reject it at runtime.

**Evidence.**
- Interface: `lib/repositories/BusinessProfileRepository.ts` — `BusinessProfileInsert.vertical: string | null` (deliberately loosened, documented in a comment).
- Call site driving the looseness: `app/api/onboarding/build/route.ts` writes `vertical: profile.vertical || null` (its Zod schema makes `vertical` optional).
- DB: `vertical` is `NOT NULL` on `business_profiles` (base CRM/onboarding migration).

**Fix.** Tighten `BusinessProfileInsert.vertical` to `string`, and give the `onboarding/build` call site a real non-null fallback (e.g. `profile.vertical ?? 'generic'` — confirm the correct default against the vertical enum / how other write paths default it) instead of `|| null`. Then the type matches the constraint and a bad insert is caught at compile time.

**Verify.** `npx tsc --noEmit` clean; the onboarding build path still compiles and writes a valid vertical.

---

## T2 — Redundant cast in OpsUtilizationLowDetector

**Severity:** Low · **Risk:** 🟢 (pure simplification)

**Problem.** During the Insights G2 slice, `OpsUtilizationLowDetector` read `profile.scheduling_availability` through a defensive local cast because `BusinessProfile` was then effectively `any` (the `@/types/database` module was missing). Now that `BusinessProfileRepository` returns a properly-typed `BusinessProfile` **that includes `scheduling_availability`** (typed as the weekly-availability shape), that cast is redundant.

**Evidence.**
- `lib/business-os/insight/detectors/catalog/OpsUtilizationLowDetector.ts` (~lines 157–163) — reads `new BusinessProfileRepository(this.supabase).findByUserId(userId)` then narrows via `(profile as { scheduling_availability?: WeeklyAvailability } | null)`.
- `BusinessProfile.scheduling_availability` is now a real field (`Record<string, { start: string; end: string }[]> | null`) in `BusinessProfileRepository.ts`.

**Fix.** Drop the `as { scheduling_availability?: … }` cast and read `profile?.scheduling_availability` directly off the typed `BusinessProfile`. Keep the local `WeeklyAvailability`/parse logic (`calculateAvailableHours`) as-is.

**Verify.** `npx tsc --noEmit` clean; `npx jest lib/business-os/insight/detectors/catalog/__tests__/OpsUtilizationLowDetector.availability.test.ts` still green.

---

## T3 — Phantom `business_profiles` fields

**Severity:** Low · **Risk:** 🟡 (decide migration vs delete-reads)

**Problem.** Three fields are **read** off `business_profiles` by live consumers but **do not exist in any migration** — `currency`, `timezone`, `contact_email`. Because the table is fetched with `select('*')`, these keys are never present, so the reads always fall through to their `|| default`. When the hand-written `BusinessProfile` interface was authored, they were added as **optional, Row-only** fields (deliberately absent from `Insert`/`Update` so nothing tries to write a non-existent column) — a safe stopgap, but the type still advertises fields that aren't real.

**Evidence (defensive readers, verify line numbers):**
- `lib/business-os/ai-data-layer/AIDataLayerService.ts` (~:116, :133–134, :181) — reads `currency` / `timezone` / `contact_email` with `|| default`.
- `lib/business-os/ai-data-layer/SafeExecutionLayer.ts` (~:975).
- `lib/services/BookingEmailService.ts` (~:247).
- `app/api/website/scheduling/availability/route.ts` carries a literal `// TODO: Add timezone column to business_profiles if needed`.
- Interface: `lib/repositories/BusinessProfileRepository.ts` — `currency?`, `timezone?`, `contact_email?` typed Row-only.

**Fix — decide per field (BA/SA + user):**
- **(a) Make them real** — add the columns via a migration (+ backfill sensible defaults) if the product wants per-tenant currency / timezone / contact email. Then move them into `Insert`/`Update` too and let the writers set them.
- **(b) Remove the dead reads** — delete the `|| default` reads at the consumer sites and remove the fields from the interface, if the defaults are the intended behavior forever.

Pick one per field (they may differ — `timezone` and `currency` are plausibly real product needs; `contact_email` may be derivable from the owner's auth email). Do NOT leave them as phantom Row-only fields long-term.

**Verify.** If (a): migration applies, types move to Insert/Update, writers set the values, `tsc` clean. If (b): the reads and interface fields are gone, consumers use an explicit default, `tsc` clean.

---

## T4 — Availability-route double cast (optional)

**Severity:** Low · **Risk:** 🟢 (cosmetic)

**Problem.** `app/api/website/scheduling/availability/route.ts` casts the profile's availability via `as unknown as WeeklyAvailability` because the route declares a **fixed-key** local `WeeklyAvailability` interface while `BusinessProfile.scheduling_availability` is an **index-signature** `Record<string, …>` (interfaces don't get an implicit index signature, so the direct cast is rejected — hence the double cast). Same-shape values, so it's safe, just noisy.

**Fix (optional).** Either leave the documented double cast, or align the route's local type to the repo's shape — e.g. `type WeeklyAvailability = Record<string, { start: string; end: string }[]>` (or import the repo's `SchedulingAvailability` type) so a single, clean assertion works. Low value; do only if touching the file anyway.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-08-12 | Created | Captured the SA-flagged Low-severity type-hygiene follow-ups from the Insights G2 slice + the `@/types/database`→interfaces change (vertical nullability, redundant detector cast, phantom business_profiles fields, availability-route double cast) so they have a self-contained home for a future session. |
