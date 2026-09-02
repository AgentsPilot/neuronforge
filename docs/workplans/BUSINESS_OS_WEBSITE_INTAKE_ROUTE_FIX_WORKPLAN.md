# Business OS — Public Intake Route Fix (`task_dda5f400`, reduced scope)

> **Last Updated**: 2026-08-18

**Author:** Dev
**Status:** 🟢 Implemented — **QA PASS-WITH-NOTES (2026-08-18, § QA Report)**: all acceptance criteria pass, no must-fix issues; 8 non-blocking notes (NB-1..NB-8). SA code review PASS-WITH-CHANGES (§11.2) with blocking F1 verified landed.
**Parent:** [Module → Internal Plugin Roadmap](/docs/workplans/BUSINESS_OS_MODULE_PLUGINS_ROADMAP.md) § CRM open issues (`task_dda5f400`).

## Overview

The public website **intake form** endpoint — [`app/api/website/forms/intake/route.ts`](/app/api/website/forms/intake/route.ts) — writes **five columns that do not exist** in the schema, and reaches four tables with direct `.from()` calls in violation of the mandatory repository rule. This workplan corrects the columns and routes the endpoint through the repository layer.

> **Scope decision (user, 2026-08-18): columns-only.** This is a **latent-bug fix with no user-visible change.** The endpoint's only caller sends a payload that fails Zod validation *before* any column is touched (§1), so correcting the columns does not by itself make the legacy intake form work. The caller-contract gap is deliberately **left open and tracked** (§2). Nothing in the change history for this work may claim the intake form was "fixed" for end users.

This is the **reduced remainder** of `task_dda5f400`. The roadmap describes the drift as spanning five public routes; verification against live code (2026-08-17) found the other four already corrected — `forms/contact` writes `first_name`/`last_name`/`stage`, and the three `booking/*` routes no longer double-log against trigger T2.

## Table of Contents

1. [Evidence — what is broken](#1-evidence--what-is-broken)
2. [Scope](#2-scope)
3. [Decisions](#3-decisions)
4. [Tasks](#4-tasks)
5. [Tenant-isolation analysis](#5-tenant-isolation-analysis)
6. [Tests](#6-tests)
7. [Risks & questions for SA](#7-risks--questions-for-sa)
8. [Verification](#8-verification)
9. [SA Review (2026-08-17)](#sa-review-2026-08-17)
10. [Implementation notes (Dev, 2026-08-18)](#implementation-notes-dev-2026-08-18)
11. [QA Report (2026-08-18)](#qa-report-2026-08-18)
12. [Change History](#change-history)

---

## 1. Evidence — what is broken

Schema source of truth: `supabase/migrations/20260722_create_crm_tables.sql` (`crm_contacts`, `crm_activities`), `20260722_create_scheduling_tables.sql` + `20260728_create_intake_tables.sql` (`scheduling_bookings`).

| # | Line | Write | Real schema | Consequence if reached |
|---|---|---|---|---|
| P1 | `:171` | `crm_contacts.insert({ name })` | `first_name` / `last_name` | **Fatal** — PostgREST 42703 → `createError` → `throw` → 500 |
| P2 | `:175` | `crm_contacts.insert({ status: 'qualified' })` | `stage` | **Fatal** — same insert |
| P3 | `:153` | `crm_contacts.update({ status: 'qualified' })` | `stage` | **Fatal** — `updateError` → `throw` → 500 |
| P4 | `:200` | `scheduling_bookings.update({ intake_completed: true })` | `intake_completed_at` | Non-fatal — caught and warned; **the booking is never linked to the contact either**, since the whole update fails |
| P5 | `:219`,`:222` | `crm_activities.insert({ type, metadata })` | `activity_type`; **no** `metadata` column | Non-fatal — caught and warned; the intake activity is never logged |

### The live failure mode is 400, not 500 (SA C1)

The phantom columns are real, but **no live request reaches them.** The endpoint's only caller — [`components/website/blocks/ProcessFlowSection.tsx:1775`](/components/website/blocks/ProcessFlowSection.tsx:1775) (`handleIntakeSubmit`, commented *"Legacy intake submit (for backwards compatibility with intake_fields)"*) — posts `{ subdomain, booking_id, name, email, answers }`.

`template` is **required** by `IntakeFormBaseSchema` (`route.ts:22`), so every real submission fails the Zod gate at `:91` with **400** and never touches a column. Two further contract mismatches sit behind it: `answers` is a nested object that the non-strict Zod intersection **silently strips**, and the legacy step only renders when a block has old-style `intake_fields` **and** no intake template (`ProcessFlowSection.tsx:2032`).

**Net effect, stated honestly:** on sites using legacy `intake_fields` blocks the intake step captures nothing today, and it will still capture nothing after this change. What this change delivers is that the endpoint is **correct if called correctly**, and standards-compliant — the phantom-column landmine and the repository-rule violation are removed. The contract gap is tracked in §2.

**Why it compiled:** `supabaseServer` is untyped in this repo — the generated `@/types/database` file is absent (roadmap cross-cutting item). Nothing checks column names at build time.

**Repository-rule violations in the same file:** four direct `.from()` families — `website_pages` (`:102`), `crm_contacts` (`:131`,`:148`,`:167`), `scheduling_bookings` (`:196`), `crm_activities` (`:214`).

---

## 2. Scope

**In scope**
- Correct P1–P5 in `app/api/website/forms/intake/route.ts`.
- Route all four table accesses through repositories.
- One repository addition (task A1) so the booking link is expressible through the repo without publishing a cross-tenant footgun.
- Document the intentional service-role/RLS bypass on this public path (CLAUDE.md requirement).
- Unit tests, including the mandatory tenant-isolation invariant.

**Out of scope — tracked, not silently dropped**

| Item | Why out | Where tracked |
|---|---|---|
| **The caller-contract gap** — `handleIntakeSubmit` omits `template` and sends `answers`, which Zod strips | User decision 2026-08-18: columns-only. Repairing or retiring the legacy path is a product call about whether old-style `intake_fields` blocks stay supported | New roadmap open item under CRM (this workplan §1) |
| `app/api/website/forms/contact/route.ts` — column-correct but still direct `.from()` | Not broken; pure refactor with its own regression surface. SA Q1: keep out (one PR per logical change) | Roadmap item 1.2.c |
| `app/api/website/booking/intake/route.ts` — the **modern** template-based intake submit; writes `intake_responses` + `intake_completed_at` **correctly** (`:243-251`) and does an explicit booking-ownership pre-check (`:209-214`), but still uses direct `.from()` | Same as above — it is also the reason D4 is right (that route legitimately owns `intake_responses`) | Roadmap item 1.2.c (SA C2 — the sweep covers **six** public routes, not four) |
| Persisting `scheduling_bookings.intake_responses` here | No 1:1 template mapping — see D4 | This workplan D4 |
| Duplicate `20260721`/`20260722_create_crm_tables.sql` migrations | Both `CREATE TABLE IF NOT EXISTS`; harmless at runtime | Roadmap migration-hygiene item |
| Generating `@/types/database` | The cross-cutting fix that would have prevented this whole bug class | Roadmap cross-cutting item |

---

## 3. Decisions

**D1 — `name` → `first_name` / `last_name`.** Mirror the split already used by the sibling contact route (`forms/contact:107-110`): split on whitespace, first token is `first_name`, the remainder joined is `last_name` (`null` when absent). Consistency across the public capture routes matters more than sophistication.

**D2 — Stage handling.**
- *New contact:* `stage: 'lead'`, matching `forms/contact:122` and `booking/create:230`.
- *Existing contact:* **do not touch `stage`.** The `status: 'qualified'` write never succeeded, so there is no behaviour to preserve.

*Rationale (corrected per SA C4).* Not "per-tenant stage resolution would be a large piece of work" — that mechanism already exists **twice**: `booking/finalize/route.ts:82-110` (`active_client` > `active` > `client` > highest non-terminal position) and the T1 trigger (`20260728_skip_contact_for_pending_payment.sql:26-43`), both over `crm_pipeline_stages`. The reason is **product semantics**: completing an intake form is not a payment, and only the paid paths currently promote a contact. Writing a hardcoded `'qualified'` — which is in no tenant's seed vocabulary — would also fight `20260722_migrate_contacts_to_pipeline_stages.sql:80-94`, the migration that exists precisely to repair contacts whose stage is not in their tenant's pipeline.
> **Follow-up (product, named):** *"Should completing an intake promote the contact's pipeline stage?"* If yes, reuse `CRMPipelineStagesRepository` + the two precedents above rather than hardcoding.

**D3 — Activity shape.** `activity_type: 'note'`, `auto_logged: true`, `source_capability: 'website'`, `activity_date: now()` — identical to `forms/contact:155-165`. The non-existent `metadata` column is dropped; `booking_id`, when present, goes into `source_entity_id` (a real column) and the template/subdomain context into the human-readable `description`. The structured intake payload is persisted on `crm_contacts.custom_fields.intake_data`.
> Note (SA C1): that payload is only as complete as the request — `answers` is currently stripped by the schema, so for the legacy caller `intake_data` would carry the template envelope without the answers. Part of the tracked contract gap, not of this fix.

No double-log risk: trigger T8 (`log_crm_contact_created`, `20260722_crm_contact_creation_activity.sql`) writes a distinct `contact_created` activity, `NEW.user_id`-scoped.

**D4 — Booking link.** Set `contact_id` + `intake_completed_at` through the new `linkIntakeContact` method (A1). **`intake_responses` is deliberately not written here**: `IntakeRepository.saveIntakeResponses` requires a catalog `template_id`, and this route's `template` enum (`general|therapist|coach|consultant|fitness`) matches the catalog's **`vertical`** column, not its `template_key` (`therapist_initial`, `coach_discovery`, `generic_intake`, …) — there is no 1:1 mapping and `general` has no counterpart. The modern `booking/intake` route owns that write with a real `template_id`.

**D5 — Subdomain lookup.** Use `WebsitePageRepository.findBySubdomainAny` — the current code applies **no** status filter, and `findBySubdomain` would add `status = 'live'`, silently breaking intake on draft/preview sites. `website_pages.subdomain` is `UNIQUE` (`20260726_enhance_website_tables.sql:11`), so `.single()` is safe.

**D6 — Repository instantiation (SA C3).** There is **no** `websitePageRepository` singleton — only `getWebsitePageRepository(supabase)`, which caches its first-injected client (a known roadmap issue). Instantiate `new WebsitePageRepository(supabaseServer)` at module scope, as the REST routes do. Consequently the `supabaseServer` import **stays** — it is the injected client, and its RLS-bypass on this public path gets the CLAUDE.md-required justification comment.

**D7 — `findByEmail` error path (SA C6/T11).** `findByEmail` returns `{data:null,error:null}` on PGRST116 (not-found) but `{data:null,error:<Error>}` on a real failure. The current code cannot tell them apart (it destructures `data` only) and would fall through to the create branch — risking a duplicate contact on a transient error. **Locked behaviour:** a non-null `error` is treated as fatal → 500; only a clean not-found proceeds to create.

---

## 4. Tasks

### A1 — `SchedulingBookingRepository.linkIntakeContact` (SA C5)
**File:** `lib/repositories/SchedulingRepository.ts`

Add a dedicated method rather than widening `SchedulingBookingUpdate` with `contact_id`:

`async linkIntakeContact(bookingId: string, userId: string, contactId: string)` — updates `{ contact_id, intake_completed_at: now() }` scoped `.eq('id', bookingId).eq('user_id', userId)`.

**Why not the generic update.** `scheduling_bookings.contact_id` is `REFERENCES crm_contacts(id)` with **no same-tenant constraint**. Exposing it on the generic `SchedulingBookingUpdate` would publish a durable API surface where a future caller could link another tenant's contact to its own booking — the skill's "caller-supplied field shadows a scoped one" case. A named method with a documented invariant keeps that surface closed.

**Invariant (doc comment on the method):** `contactId` **must** be owner-verified — derived from a `user_id`-scoped repository call. The caller is the isolation boundary (see `tenant-isolation-guard`). The ownership pre-check is deliberately *not* duplicated inside the method: in this route the id comes straight from `findByEmail(email, ownerId)` / `create({user_id: ownerId})`, so re-checking would be the over-guarding the skill warns against, and importing `CRMContactRepository` into `SchedulingRepository` would couple two module repositories. Locked by test T12.

*(Correction to the original A1 rationale, per SA: T1 is `AFTER INSERT` only and T2 is `AFTER INSERT OR UPDATE OF status` — this route's update fires **neither**. The reason for care is the missing tenant constraint, not the triggers.)*

### A2 — Route the endpoint through repositories
**File:** `app/api/website/forms/intake/route.ts`

| Current | Replacement |
|---|---|
| `.from('website_pages').select('user_id').eq('subdomain',…)` | `new WebsitePageRepository(supabaseServer).findBySubdomainAny(subdomain)` (D6) |
| `.from('crm_contacts').select(…).eq('user_id').eq('email')` | `crmContactRepository.findByEmail(email, ownerId)` (+ D7 error handling) |
| `.from('crm_contacts').update(…)` | `crmContactRepository.update(id, ownerId, patch)` |
| `.from('crm_contacts').insert(…)` | `crmContactRepository.create({ user_id: ownerId, … })` |
| `.from('scheduling_bookings').update(…)` | `schedulingBookingRepository.linkIntakeContact(booking_id, ownerId, contactId)` (A1) |
| `.from('crm_activities').insert(…)` | `crmActivityRepository.create({ … })` |

Repositories return `{data, error}` rather than throwing — the route branches on `error`/`!data`, preserving the existing severity split: contact create/update failure → 500; booking-link and activity failure → warn, continue, still return success.

Two behaviour notes to keep explicit (SA 3c): routing the contact update through the repo **adds** `user_id` scoping the current `.eq('id')`-only code lacks, and dropping the manual `updated_at` is behaviour-preserving because `update_crm_contacts_updated_at_trigger` sets it.

### A3 — Apply the column corrections
P1–P5 per D1–D4.

### A4 — Tests
See §6.

---

## 5. Tenant-isolation analysis

Applying the `tenant-isolation-guard` skill. Public, unauthenticated, service-role path → the guard applies.

| Vector | Assessment |
|---|---|
| **Tenant anchor** | `ownerId` is derived **server-side** from `subdomain → website_pages.user_id`. The caller names a public site, which is inherent to any public form; it cannot name a `user_id`. ✅ |
| **Caller-supplied `booking_id`** | Passed to `linkIntakeContact(booking_id, ownerId, contactId)`, scoped `.eq('id').eq('user_id', ownerId)`. A foreign booking matches zero rows → warn, continue. **Fails closed.** ✅ |
| **The `contact_id` *value*** (SA C5) | `scheduling_bookings.contact_id` has **no same-tenant constraint** — only `REFERENCES crm_contacts(id)`. Here the value is always derived server-side from a `user_id`-scoped call (`findByEmail(email, ownerId)` / `create({user_id: ownerId})`), never from input. That is the stated invariant of A1 and is locked by test T12. ✅ |
| **Field allow-list** | Every payload is built field-by-field from Zod-validated input; no raw `params` forwarded; `user_id` is always `ownerId`; `id` is never taken from input. ✅ |
| **Triggers** (corrected per SA C5) | **T1** (`create_crm_contact_from_booking`) is `AFTER INSERT` only; **T2** (`log_booking_activity`) is `AFTER INSERT OR UPDATE OF status` — this route's `contact_id`/`intake_completed_at` update fires **neither**, and both write `NEW.user_id`-scoped rows regardless. **T8** fires on the contact insert, is `NEW.user_id`-scoped, and writes `activity_type='contact_created'` (so D3's no-double-log claim holds). No unscoped cross-table write exists on this path. ✅ |
| **Upsert** | None. Explicit find → create/update; `upsertByEmail` is deliberately avoided so the update path can omit `stage` (D2). ✅ |
| **Global catalog** | None read (the template catalog is untouched — D4). No phantom `user_id` filter invented. ✅ |

**Conclusion:** no additional ownership pre-check is required. Every id written against is either derived server-side or passed through a `user_id`-scoped repository method — the skill's explicit "plain `repo.method(id, userId)` … don't over-guard" case.

---

## 6. Tests

`app/api/website/forms/intake/__tests__/route.test.ts`, repositories mocked:

| # | Case | Assertion |
|---|---|---|
| T1 | New contact, valid payload | `create` called with `first_name`/`last_name`/`stage:'lead'`; **no** `name`/`status` key present; 200 + `contactId` |
| T2 | Existing contact | `update` called with `phone`/`custom_fields` only — **asserts `stage` is absent** (D2) |
| T3 | Unknown subdomain | 404, no writes attempted |
| T4 | Invalid payload (bad email) | 400, no writes attempted |
| T5 | Contact create fails | 500; booking/activity writes not attempted |
| T6 | Booking link fails | still 200 — non-blocking |
| T7 | Activity create fails | still 200 — non-blocking |
| T8 | Activity payload shape | `activity_type:'note'`, `source_capability:'website'`; **no `type`/`metadata` keys** |
| T9 | Booking link payload | `intake_completed_at` present, **`intake_completed` absent**, `contact_id` set, scoped to `ownerId` |
| **T10** | **Caller contract (SA C6)** — the exact `handleIntakeSubmit` body `{subdomain, booking_id, name, email, answers}` | **400**, no repository call — locks the documented columns-only outcome so the gap can't be mistaken for fixed |
| **T11** | **`findByEmail` returns `error`** (D7) | 500; **`create` not called** (no duplicate-contact fallthrough) |
| **T12** | **Isolation invariant (skill Step 7, mandatory)** | Body carrying injected `user_id`/`id`/`stage`/`status` → every repository call receives `ownerId` and none of the injected keys reach any payload; foreign `booking_id` → `linkIntakeContact` called with `ownerId`, request still 200 |
| **T13** | **Repository-only guard** | The route makes no direct `supabase.from()` call |

Column-name assertions are deliberate: they are the regression lock for the phantom-column class while `@/types/database` is missing.

---

## 7. Risks & questions for SA

- **R1 — (corrected).** This change is **not** user-visible. The endpoint returns 400 for its only caller before and after. The value is removing the phantom-column landmine and the repository-rule violation. Nothing downstream depends on the route: the single caller only checks `data.success`.
- **R2 — D2** stands (SA agreed); rationale corrected per C4.
- **R3 — A1** resolved via SA's preferred option: dedicated `linkIntakeContact`, `contact_id` kept **off** the generic update interface.
- **R4 — new.** The ownership pre-check for `contactId` lives at the caller, not inside `linkIntakeContact` (see A1). Confirm at code review that the documented invariant + T12 is sufficient, versus duplicating the check inside the repository.

---

## 8. Verification

- `npx tsc --noEmit` on touched files — clean.
- `npx jest app/api/website/forms/intake` — all green.
- Phantom-column audit (grep corrected per SA C6 — the old `grep "name:"` matched `first_name:` and always hit): `grep -nE "(^|[^_[:alnum:]])(name|status|type|metadata|intake_completed):" app/api/website/forms/intake/route.ts` must return nothing.
- `grep -n "\.from(" app/api/website/forms/intake/route.ts` — must return nothing.
- QA: happy path + at least one failure path per CLAUDE.md testing standard.

---

## SA Review (2026-08-17)

**Reviewed by SA — 2026-08-17**
**Status:** 🔄 **APPROVE-WITH-CHANGES** — the diagnosis and the repository mapping are sound and the approach is the right one. Five items must be corrected before implementation; **C1 is blocking** because, as written, the fix would ship without changing anything the only live caller experiences.

All claims were re-verified against live source; workplan line numbers were spot-checked and are accurate.

### Per-item confirmation

| # | Claim under review | Verdict | Evidence |
|---|---|---|---|
| 1a | P1/P2/P3 phantom (`crm_contacts.name`, `.status`) | ✅ Confirmed | `20260722_create_crm_tables.sql:12-18` — `first_name`/`last_name`/`stage`; **no** `name`, **no** `status`. The duplicate `20260721_create_crm_tables.sql:13-19` is identical on these columns, so the drift is real under either migration order. |
| 1b | P5 phantom (`crm_activities.type`, `.metadata`) | ✅ Confirmed | `20260722_create_crm_tables.sql:66-82` — `activity_type`; **no** `metadata` column. |
| 1c | P4 phantom (`scheduling_bookings.intake_completed`) | ✅ Confirmed | `20260728_create_intake_tables.sql:111-113` adds `intake_responses` + `intake_completed_at` only; `20260722_create_scheduling_tables.sql:64-100` has no `intake_completed`. |
| 1d | The 2 fatal writes really do `throw` | ✅ Confirmed | `route.ts:158-161` and `:185-188` rethrow into the outer catch → `500 Failed to process intake form`. Both branches are covered; no partial-success path. |
| 1e | **"Every submission fails with 500 / the endpoint is broken today"** | ❌ **Incorrect** | The only caller (`ProcessFlowSection.tsx:1775-1800`, `handleIntakeSubmit`, commented *"Legacy intake submit"*) posts `{subdomain, booking_id, name, email, answers}` — it does **not** send `template`, which `IntakeFormBaseSchema:22` makes **required**. Every real submission fails Zod at `:91` with **400**, never reaching a phantom column. The 500 is reachable only by a hypothetical well-formed request. See **C1**. |
| 2 | The other 4 routes in scope are already corrected | ✅ Confirmed (with an addition) | `forms/contact:117-122` and `booking/create:218-224`, `booking/confirm:167-173`, `booking/finalize:143-160` all write `first_name`/`last_name`/`stage`; `confirm:~205` and `finalize:~240` carry explicit "logged by trigger T2 — not inserted here (was double-logging)" comments and `create` has no `crm_activities` insert. Correctly scoped out. **Addition:** a 6th sibling the workplan never mentions — `app/api/website/booking/intake/route.ts` — is the *modern* replacement for the route being fixed; see **C2**. |
| 3a | `CRMContactRepository.findByEmail(email, userId)` | ✅ Confirmed | `:136-161` — `.eq('email').eq('user_id')`, `.single()`, PGRST116 → `{data:null,error:null}` (matches the route's current "ignore not-found" behaviour). |
| 3b | `CRMContactRepository.create(insert)` | ✅ Confirmed | `:82-107` — `user_id` from the insert object, `stage` defaults to `'lead'`. `CRMContactInsert:33-44` has **no** `name`/`status` → the type itself is the regression lock for P1/P2. |
| 3c | `CRMContactRepository.update(id, userId, patch)` | ✅ Confirmed, **strictly safer** | `:273-297` — `.eq('id').eq('user_id')`. The current route (`:156`) filters by `id` only; routing through the repo *adds* tenant scope. `CRMContactUpdate:46-55` has no `updated_at` — dropping it is behaviour-preserving because `update_crm_contacts_updated_at_trigger` (`20260722_create_crm_tables.sql:184`) sets it. State this explicitly in A3 so it doesn't read as a silent drop. |
| 3d | `SchedulingBookingRepository.update(id, userId, updates)` | ✅ Confirmed | `SchedulingRepository.ts:694-717` — `.eq('id').eq('user_id')`, returns `{data,error}`. `SchedulingBookingUpdate` is at `:158` as stated. |
| 3e | `CRMActivityRepository.create(insert)` | ✅ Confirmed | `:65-92`. `CRMActivityInsert:28-38` has `activity_type` and **no** `metadata` → again the type is the lock for P5. |
| 3f | `WebsitePageRepository.findBySubdomainAny(subdomain)` | ⚠️ **Method exists; the accessor in A2 does not** | `:146-161` — no status filter, `.single()`, correct choice per D5. `website_pages.subdomain` is `UNIQUE` (`20260726_enhance_website_tables.sql:11`) as claimed. **But there is no `websitePageRepository` singleton export** — the file exports only `getWebsitePageRepository(supabase)` (`:494`), which caches its first-injected client. See **C3**. |
| 4 | D2 — do not write `stage` on the existing-contact update | ✅ **Correct call**, rationale needs a correction | `crm_pipeline_stages.stage_key` is per-tenant with `UNIQUE(user_id, stage_key)`; `'qualified'` is in no seed set; `20260722_migrate_contacts_to_pipeline_stages.sql:80-94` actively *repairs* contacts whose stage isn't in their tenant's pipeline — writing a hardcoded `'qualified'` would fight that migration. Preserving the owner's stage is right. See **C4** for the rationale correction. |
| 5 | D4 — do not persist `intake_responses` | ✅ Confirmed | `IntakeRepository.saveIntakeResponses(bookingId, userId, templateId, templateKey, responses)` (`:412-417`) requires a catalog `template_id`. Seeded `template_key`s are `therapist_initial`, `therapist_couples`, `coach_discovery`, `consultant_strategy`, `lawyer_initial`, `fitness_assessment`, `generic_intake` against verticals `therapist/coach/consultant/lawyer/fitness/other` — the route's enum matches `vertical`, and `general` has no counterpart. No 1:1 mapping exists. Decision upheld. |
| 6 | A1 — widen `SchedulingBookingUpdate` with `contact_id` + `intake_completed_at` | ⚠️ **Accept the columns, reject the stated justification** | Both columns are real. But *"`contact_id` is what triggers T1/T2 key off"* is wrong in a way that matters: **T1** (`create_crm_contact_from_booking`) is `AFTER INSERT` only (`20260728_skip_contact_for_pending_payment.sql:83-86`) and **T2** (`log_booking_activity`) is `AFTER INSERT OR UPDATE OF status` (`20260722_create_scheduling_tables.sql:323-326`). This route updates `contact_id`/`intake_completed_at` and **fires neither**. The real risk is elsewhere — see **C5**. |
| 7 | §5 — "no additional ownership pre-check needed" | ✅ **Conclusion correct**, ⚠️ two rows of the analysis are wrong | The `booking_id` vector is genuinely closed: `update(booking_id, ownerId, …)` is `.eq('id').eq('user_id')` and a foreign booking matches zero rows → warn + continue, fails closed. This is the skill's explicit "plain `repo.method(id, userId)` … don't over-guard" case. But the *Scope-defeating three* row analyses only T8 and mis-states T1/T2, and the analysis never considers the **value** written into `contact_id`. See **C5**. |
| 8 | §6 test matrix | ⚠️ Good spine, 4 gaps | T1–T9 are well-chosen and the column-name assertions are exactly the right regression lock while `@/types/database` is missing. Missing: the caller-contract case, the `findByEmail`-error path, the isolation invariant the skill requires (Step 7), and a "no `.from()` in the route" guard. See **C6**. |

### Required changes

**C1 — Blocking. Correct the evidence and decide the caller contract.**
§1's "Net effect" is wrong: the live failure mode is **400 at the Zod gate**, not 500, because `ProcessFlowSection.handleIntakeSubmit` omits the required `template`. Two consequences the workplan must resolve:
1. **Rewrite §1's Net effect and R1.** As written, R1 claims "the endpoint currently always 500s; after this it succeeds." After A1–A4 the endpoint would still return **400** for its only caller. Shipping that under a "fixed the broken intake endpoint" change-history line would be misleading.
2. **Make an explicit, recorded decision on the payload contract.** The legacy caller also sends `answers: {…}` (a nested object), which the non-strict Zod intersection **silently strips** — so even a `template`-bearing request from this component would persist an `intake_data` with no answers, which also undercuts D3's "nothing is lost, the full payload is on `custom_fields.intake_data`". Pick one and write it into §2/§3:
   - **(a) Fix the contract in this PR** — `template` optional defaulting to `'general'`, accept `answers: z.record(z.any()).optional()` and fold it into `intakeData`. Small, and it makes the fix actually observable.
   - **(b) Deprecate the route** — if `booking/intake` supersedes it (see C2), the honest fix may be to retire `handleIntakeSubmit` + this endpoint rather than repair columns nobody reaches. Requires a BA/product call, so flag it rather than deciding it here.
   - **(c) Columns-only** — acceptable *only* if §1/§2/R1 state plainly that this is defence-in-depth with **no user-visible change**, and the caller-contract gap is logged as a named follow-up on the roadmap.
   SA does not choose for you; SA requires the choice be explicit and the evidence corrected.

**C2 — Add `app/api/website/booking/intake/route.ts` to §2 as a cross-reference.**
It is a public intake submit route on the same tables, it writes `intake_responses` + `intake_completed_at` **correctly** (`:243-251`), and it does an explicit booking-ownership pre-check (`:209-214`). It is the reason D4 is right (that route legitimately owns `intake_responses`) and it is material to the C1(b) option. Also note in §2 that it still uses direct `.from()` and belongs to the same 1.2.c repo-conformance item.

**C3 — Fix the repository accessor in A2.**
`websitePageRepository.findBySubdomainAny(...)` will not compile — no such export. Use `new WebsitePageRepository(supabaseServer)` at module scope, **not** `getWebsitePageRepository()`: the roadmap already records that the getter caches its first-injected client (Website § "Repo singleton caching"), and the REST routes instantiate directly for that reason. Consequence: **A2's "Drop the now-unused `supabaseServer` import" is wrong** — the import stays as the injected client. Correct both lines.

**C4 — Correct D2's rationale (decision itself stands).**
"The correct implementation is a per-tenant configurable target stage — a separate, larger piece of work" overstates it: that resolution logic already exists **twice** — `booking/finalize/route.ts:82-110` (`active_client` > `active` > `client` > highest non-terminal position) and the T1 trigger (`20260728_skip_contact_for_pending_payment.sql:26-43`). So the mechanism is available; the reason not to use it here is **product semantics** — completing an intake form is not a payment, and only the paid paths currently promote a contact. Say that, cite `CRMPipelineStagesRepository` + the two precedents as the shape any future "intake promotes the lead" work should reuse, and log it as a named follow-up rather than "a larger piece of work".

**C5 — Harden A1 and rewrite the §5 trigger row.**
- **§5 rewrite:** replace the *Scope-defeating three* row with the verified facts: T1 is `AFTER INSERT` only and its `UPDATE … WHERE id = NEW.id` targets the just-inserted row; T2 is `AFTER INSERT OR UPDATE OF status`; **this route's booking update fires neither**, and both write `NEW.user_id`-scoped rows regardless. T8 (`log_crm_contact_created`, `20260722_crm_contact_creation_activity.sql`) fires on the contact insert, is `NEW.user_id`-scoped, and writes `activity_type='contact_created'` — so D3's no-double-log claim holds. This makes the "no pre-check needed" conclusion *stronger*, not weaker.
- **New §5 row — the `contact_id` value.** `scheduling_bookings.contact_id` is `REFERENCES crm_contacts(id)` only; there is **no** same-tenant constraint. In *this* route the value is derived server-side (`findByEmail(email, ownerId)` / `create({user_id: ownerId})`), so it is safe — state that as the invariant. But widening the generic `SchedulingBookingUpdate` publishes a field where a future caller could pass a caller-supplied contact id and link another tenant's contact to its own booking. That is the skill's "caller-supplied field in the payload shadows a scoped one" case. **Do one of:**
  - **(preferred)** add a dedicated `SchedulingBookingRepository.linkIntakeContact(bookingId, userId, contactId)` that pre-checks `crmContactRepository.findById(contactId, userId)` and fails closed, keeping `contact_id` **off** the generic update interface; or
  - widen as proposed **and** add a doc comment on the field — *"must be an owner-verified contact id; the caller is the isolation boundary (see `tenant-isolation-guard`)"* — **plus** the T-isolation test in C6.
- Add the CLAUDE.md-required one-line justification comment for the intentional `supabaseServer`/RLS-bypass on this public path (it is intentional and correct — it just has to be documented in the file).

**C6 — Extend §6 with four cases.**
- **T10 — caller contract:** the exact `handleIntakeSubmit` body (`{subdomain, booking_id, name, email, answers}`) → asserts whichever outcome C1 selects (400 today; 200 + `answers` persisted under option (a)). This is the test that would have caught the mis-diagnosis.
- **T11 — `findByEmail` returns `error`:** assert the chosen behaviour (current code effectively falls through to the create branch and risks a duplicate). Decide and lock it; don't inherit it by accident.
- **T12 — isolation invariant (skill Step 7, mandatory):** body carrying injected `user_id`/`id`/`stage`/`status` → assert every repo call receives `ownerId` and none of the injected keys reach any payload; foreign `booking_id` → assert `update` was called with `ownerId` and the request still returns 200.
- **T13 — repository-only guard:** assert the route module makes no direct `supabase.from()` call (or keep §8's `grep -n "\.from(" ` check as a CI-visible step). Also fix §8's audit grep — `grep "name:"` matches `first_name:` and will always report a hit; use `\bname:` / `[^_]name:` or assert on the repo-call payloads instead.

### Answers to R1–R3 / Q1

**R1 — "Behaviour change is a fix, not a regression."** Agreed on principle, but the premise is wrong: today's live behaviour is 400, not 500, so the stated after-state ("it succeeds") does not follow from A1–A4 alone. Resolve via **C1**. Nothing else downstream depends on this route — the single caller is verified (`ProcessFlowSection.tsx:1789`), and the endpoint returns `{success, message, contactId}` which the component only checks for `success`.

**R2 — D2.** ✅ SA agrees. Preserving the owner's stage beats writing a hardcoded value that may not exist in the tenant's pipeline — `20260722_migrate_contacts_to_pipeline_stages.sql` exists specifically to repair that class of damage, and re-introducing it from a public unauthenticated endpoint would be worse than the status quo. Apply **C4** to the rationale and log the product follow-up.

**R3 — A1 widening with `contact_id`.** ⚠️ Conditionally comfortable. Not because of T1/T2 (they don't fire here — see C5), but because the *value* is derived server-side in this route. Since a repository interface is a durable API surface and `contact_id` carries no same-tenant DB constraint, SA requires either the dedicated `linkIntakeContact` method or the documented-invariant + test route from **C5**. Widening it silently is not approved.

**Q1 — pull `forms/contact` into this PR?** ❌ **No — keep it out.** It is column-correct and functioning; converting it is pure refactor with its own regression surface, and mixing it in would blur the blast radius of a fix whose live behaviour is already mis-characterised. One PR per logical change stands. It is already tracked under roadmap item 1.2.c; per **C2**, note `booking/intake` there too so the eventual "public routes → repositories" pass covers all six, not four.

### Approval

- [x] Approved to proceed **once C1–C6 are folded into the workplan**. C1 requires a re-read by SA (evidence + scope correction); C2–C6 may be applied and implemented without a second review cycle.
- [x] Code review (Phase 2) completed 2026-08-18 — see [11.2 SA code review](#112-sa-code-review-post-implementation): APPROVE-WITH-CHANGES, approved for QA conditional on F1.

---

### 11.2 SA code review (post-implementation)

**Reviewed by SA — 2026-08-18**
**Status:** 🔄 **APPROVE-WITH-CHANGES** — the production code is correct, standards-compliant and matches the approved plan; **one required change (F1) is a missing regression lock, test-only.**

All claims below were re-verified against live source, the migrations and a local test/typecheck run — the workplan's own verification section was not taken on trust.

#### Verified — the five column corrections

| # | Written now | Schema evidence | Verdict |
|---|---|---|---|
| P1 | `first_name` / `last_name` via `splitName` (`route.ts:108-114`, `:212-218`) | `20260722_create_crm_tables.sql:12-13` — `first_name`/`last_name`; no `name` | ✅ Correct; mirrors `forms/contact:107-121` exactly as D1 claims (verified line-by-line) |
| P2 | `stage: 'lead'` on create (`:221`) | `crm_tables.sql:19` — `stage TEXT NOT NULL DEFAULT 'lead'`; no `status` column | ✅ Correct |
| P3 | *nothing* — `stage` deliberately omitted from the update patch (`:190-195`) | same | ✅ Correct per D2; locked by the "no stage/status" test |
| P4 | `intake_completed_at` (`SchedulingRepository.ts:747`) | `20260728_create_intake_tables.sql:111-113` adds `intake_responses` + `intake_completed_at`; no `intake_completed` anywhere | ✅ Column correct — **but untested, see F1** |
| P5 | `activity_type:'note'`, `source_entity_id: booking_id`, no `metadata` (`:261-271`) | `crm_tables.sql:70-79` — `activity_type`, `source_entity_id UUID`; no `metadata`. `CRMActivityInsert:28-38` matches the payload field-for-field | ✅ Correct |

#### Verified — C1–C6 each applied

| Item | Evidence | Verdict |
|---|---|---|
| **C1(c) columns-only** | Route header `:17-22` documents the gap and states "correct if called correctly"; §1/§2/R1 rewritten; the roadmap gains a **named** open item ("Legacy intake payload contract") plus the stage-promotion product follow-up; no change-history line claims a user-visible fix; test T10 locks the 400 | ✅ Honoured, including the "no user-visible change claimed" condition |
| **C2** | §2 cross-references `booking/intake`; roadmap 1.2.c now says **six** public routes | ✅ |
| **C3 / D6** | `new WebsitePageRepository(supabaseServer)` at module scope (`:38`) with the caching rationale in a comment; `supabaseServer` import retained (`:27`); RLS-bypass justification present `:11-15` | ✅ |
| **C4** | D2 rationale is now product semantics + the two precedents; mirrored in the in-code comment `:180-182` | ✅ |
| **C5** | `git diff` confirms `SchedulingBookingUpdate` (`:158-176`) is **untouched** — the only addition is `linkIntakeContact`. Invariant doc comment present. §5 trigger row corrected; re-verified independently: T1 = `AFTER INSERT` only (`20260728_skip_contact_for_pending_payment.sql:83-86`), T2 = `AFTER INSERT OR UPDATE OF status` (`20260722_create_scheduling_tables.sql:322-326`) → this route's update fires neither | ✅ |
| **C6** | T10–T13 all present and passing | ✅ (T9 partially — F1; T12 partially — F3) |

#### Verified — standards & the tenant-isolation-guard checklist

- **Repository pattern:** zero `.from(` in the route; asserted at runtime by T13 (the `supabaseServer` mock's `from` is never called). ✅
- **Zod:** `safeParse` before any business logic; the 400 returns Zod field errors only (unchanged from the original and identical to `forms/contact:45`) — no internal detail leak; the 500 path returns no details. ✅
- **Pino:** zero `console.*` in both touched files; `logger.child({ correlationId })` throughout; errors always as `{ err }`. ✅
- **TypeScript:** `npx tsc --noEmit` produces **no diagnostic in either touched file** (verified by filtering the full output on both paths). ✅
- **user_id scoping:** `ownerId` is derived server-side from `subdomain → website_pages.user_id`; every repository call takes it. ✅
- **Skill checklist:** service-role + caller-supplied id recognised ✅ · every caller-supplied id (`booking_id`) passed through an `.eq('id').eq('user_id')` method, fail-closed ✅ · payloads built field-by-field, no raw body forwarded, `user_id` never from input, `id` never from input ✅ · scope-defeating three re-checked (no trigger fires on this update; no upsert; no shadowing field) ✅ · no global-catalog read ✅ · invariant test present (T12) ✅ — **except** the repo-boundary leg, see F1/F3.
- **Regression risk to other `SchedulingBookingRepository` callers:** none — the change is purely additive (new method; no signature, interface or shared-helper change). `npx jest lib/repositories` → 11 suites / 80 tests pass; `npx jest app/api/website/forms/intake` → 14/14 pass. ✅

#### R4 answered — the ownership pre-check at the caller

**Accepted as implemented.** Keeping the check at the caller is correct here and matches the skill's own "don't over-guard" clause: `contactId` is never caller-supplied — it comes from `findByEmail(email, ownerId)` or `create({user_id: ownerId})` two statements earlier, so a `findById(contactId, ownerId)` inside the method would re-read a row the caller has just proved it owns. Importing `CRMContactRepository` into `SchedulingRepository` to do it would also couple two module repositories for no isolation gain. The three things that make this acceptable are all present: (1) `contact_id` is **off** the generic update surface, so the unguarded shape cannot be reached accidentally by a future caller; (2) the invariant is documented on the method, in the skill's vocabulary, at the point a future caller will read it; (3) T12 locks it at the route. **Condition:** if a second caller is ever added, the invariant must be re-argued for that caller — add that sentence to the doc comment.

#### Behaviour deltas — assessment

| Delta | Verdict |
|---|---|
| Contact update now `user_id`-scoped | ✅ Correct and strictly safer. No functional change in practice — `existingContact` already came from a `user_id`-scoped lookup. |
| Manual `updated_at` dropped (contact **and** booking) | ✅ Verified safe: `update_crm_contacts_updated_at_trigger` and `update_scheduling_bookings_updated_at_trigger` are both **`BEFORE UPDATE`** (`crm_tables.sql:183-189`, `scheduling_tables.sql:211-215`). The booking half of this delta is not listed in the notes — the old code wrote `updated_at` on the booking too; add it. |
| `phone` written only when supplied | ✅ Behaviour-preserving — but the stated **reason is wrong** (F5). |
| Activity `description` carries the subdomain | ✅ Correct; `source_entity_id` is the right home for `booking_id`. Nothing of value is lost from the old `metadata` (`intake_summary: templateFields` was always `{}` because of the strip defect, and `source:'website_intake'` survives on `crm_contacts.source`). |
| Contact-lookup errors now fatal (D7) | ✅ Correct and locked by T11. Note the **subdomain** lookup keeps the opposite convention — a real DB error still yields 404 "Website not found" (`:141`). Unchanged from the original and harmless (non-destructive, no duplicate risk), but it is the one remaining place where "error" and "not found" are conflated; worth a comment rather than a change. |

#### The "KNOWN GAP" test — is asserting a defect the right call?

**Yes, keep it — the intent is right.** With the contract gap deliberately out of scope, an executable record of the defect beats a prose note, and it does force the eventual fix to be explicit. Two refinements (both optional, see F4): the test currently encodes the **wrong** behaviour as the expectation, which is exactly the failure mode of this pattern — a future dev sees a red test and "fixes" it by re-asserting the strip. Jest 30 is installed, so `it.failing(...)` is available: write the **desired** assertion (`intake_data` *contains* `coaching_goals`) under `it.failing`, and the day the contract is repaired Jest reports "Failing test passed unexpectedly" and the fix is to delete one word. Either shape is acceptable; if the current shape is kept, put the roadmap link in the test name/comment so the reader lands on the tracked item.

#### Findings

| # | File:line | Finding | Severity |
|---|---|---|---|
| **F1** | `app/api/website/forms/intake/__tests__/route.test.ts:213-219` + `lib/repositories/SchedulingRepository.ts:735-763` | **P4's column names are the one phantom-column fix left with no regression lock.** §6 T9 promised "`intake_completed_at` present, **`intake_completed` absent**". The implemented T9 asserts only `linkIntakeContact(BOOKING_ID, OWNER_ID, CONTACT_ID)` against a **fully mocked** repository — the column literals now live inside `linkIntakeContact` and no test reaches them. P1/P2/P5 stay locked because those payloads are asserted at the repo *call* boundary and the repo passes them straight through; P4 does not. Given the whole PR exists to kill this bug class while `@/types/database` is missing, the lock has to follow the code. | **Medium — required** |
| **F2** | `lib/repositories/SchedulingRepository.ts:751-755` | `.single()` means the expected "foreign or already-deleted booking" outcome (zero rows) raises PGRST116 → logged at **`logger.error`** from an **unauthenticated public path**. Functionally fine (fails closed; the route warns and continues), but a not-found is not an error here, and it is attacker-triggerable error-level noise. Prefer `maybeSingle()` (then `{data:null,error:null}`, which the route already handles via `!linkedBooking`) or the PGRST116→clean-miss treatment `CRMContactRepository.findByEmail:148-153` already uses. | Low |
| **F3** | `__tests__/route.test.ts:250-276` | T12's "foreign `booking_id`" leg is not foreign — it reuses `BOOKING_ID` with the success mock. What it does assert (every repo call receives `ownerId`; injected keys dropped) is the valuable half and is correct. The fail-closed half is covered only by T6, and only in the `error` shape; the `{data:null,error:null}` shape the route also handles is never exercised. Add one case (or rename the test to what it asserts). Folds naturally into F1's repo test. | Low |
| **F4** | `__tests__/route.test.ts:112-121` | KNOWN-GAP test encodes the defect as the expectation. Consider `it.failing` + the desired assertion (Jest 30 supports it), or at minimum put the roadmap link in the test name. | Low (suggestion) |
| **F5** | Implementation notes § Behaviour deltas, row 3 | The stated reason is inaccurate: `custom_fields` **was** in the old `select('id, custom_fields')`, so `existingContact.custom_fields?.phone` was structurally readable. It was always `undefined` for a different reason — **nothing in the codebase ever writes a `phone` key into `custom_fields`** (verified repo-wide; the only other reader is the same dead fallback at `forms/contact:93`). The conclusion — behaviour-preserving — stands; only the reason needs correcting. While there, add the dropped booking `updated_at` to the same table. | Low (doc accuracy) |
| **F6** | Implementation notes § Verification results | "the only project errors remaining are the pre-existing `supabase/functions/run-scheduled-agents` Deno-global ones" is false — `npx tsc --noEmit` reports **1,977** errors repo-wide (all pre-existing, none in the touched files). The first half of the claim ("zero errors in both touched files") is verified true. Restate as "no new errors in the touched files" so the verification record is not overstated. | Low (doc accuracy) |
| **F7** | `route.ts:256-259` | `if (subdomain)` can never be false — `subdomain` is `z.string().min(1)`. Collapse to a single template literal. | Low (dead branch) |
| **F8** | `route.ts:190-195` | `contactPatch` is typed inline (`{ custom_fields: Record<string, any>; phone?: string }`). Because it is passed as a *variable*, TypeScript's excess-property check does **not** apply at the `update()` call — the type-level lock SA cited for P1/P2 is switched off on the patch path. Annotate it `CRMContactUpdate` (type-only import) and the compiler rejects a future phantom field. The create path is already covered (object literal checked against `CRMContactInsert`). | Low |
| **F9** | `docs/workplans/BUSINESS_OS_MODULE_PLUGINS_ROADMAP.md` (working tree) | The roadmap diff correctly carries the C1(c)-required tracking entries, but also flips five unrelated module rows to ✅ Done (PRs #20–#22) and records the Step-3 timing hold. Those look accurate but sit outside this workplan's blast radius. RM should confirm they belong in this commit or split them. | Info |

#### Required changes

1. **F1 (required).** Add `lib/repositories/__tests__/SchedulingRepository.linkIntakeContact.test.ts` (mocked Supabase chain, in the shape of `PaymentReminderRepository.test.ts`) asserting: the update payload contains `contact_id` and `intake_completed_at`; contains **neither** `intake_completed` **nor** `updated_at`; and both `.eq('id', bookingId)` and `.eq('user_id', userId)` are applied. That restores the §6 T9 promise, gives the new method its repo-boundary tenant-scoping test (skill Step 7), and can absorb F3's zero-rows case.
2. **F5 + F6 (required, doc-only).** Correct the two inaccurate sentences in the implementation notes and add the booking `updated_at` row.

F2, F3, F4, F7, F8 are **optimisation suggestions** — apply if convenient; none blocks.

#### Code Approved for QA: **Yes — conditional**

The production code is approved as written. F1 is a test-only addition and must land before QA signs off; QA may start in parallel. F5/F6 are documentation corrections inside this workplan and do not gate QA.

---

## Implementation notes (Dev, 2026-08-18)

### Files

| File | Change |
|---|---|
| `lib/repositories/SchedulingRepository.ts` | **Added** `SchedulingBookingRepository.linkIntakeContact(bookingId, userId, contactId)` (A1) — updates `{contact_id, intake_completed_at}` scoped `.eq('id').eq('user_id')`, with the owner-verified-`contactId` invariant documented on the method. `SchedulingBookingUpdate` left untouched — `contact_id` is deliberately **not** on the generic update surface. |
| `app/api/website/forms/intake/route.ts` | **Rewritten** onto repositories (A2) + all five phantom columns corrected (A3). Added the CLAUDE.md service-role/RLS-bypass justification and a header note pointing at the tracked contract gap. Added a `splitName` helper mirroring `forms/contact`. |
| `app/api/website/forms/intake/__tests__/route.test.ts` | **New** — 14 tests (T1–T13 + the known-gap lock below). |
| `lib/repositories/__tests__/SchedulingRepository.linkIntakeContact.test.ts` | **New** (SA F1) — 4 tests locking the `linkIntakeContact` update payload, both `.eq()` scopes, the clean-miss path and error propagation. |

### New finding — a second contract defect (documented, not fixed)

Test T1 surfaced a defect neither the workplan nor the SA review had caught: **the template-specific answers a submission stores are decided by whichever union branch happens to validate first — not by the declared `template`.**

`IntakeFormSchema` is `IntakeFormBaseSchema.and(z.union([Therapist…, Coach…, Consultant…, Fitness…, z.object({})]))`. A `z.union` returns the output of the **first branch that validates**, and Zod object schemas **strip** unknown keys. `TherapistIntakeFields` is all-optional and non-strict, so it validates almost any payload and gets to decide which keys survive — regardless of `template`.

Verified directly (QA NB-1 corrected an earlier, simpler characterisation of this — "everything is always stripped" — which is wrong):

```
// therapist branch validates → keeps ITS field, drops the coach field
{template:'coach', goals:'g1', coaching_goals:'c1'}                     → { template, name, goals:'g1' }

// an invalid therapist-branch enum value pushes the parse to a later branch,
// which flips WHICH keys survive
{template:'coach', coaching_goals:'c1', preferred_communication:'carrier-pigeon'}
                                                                        → { template, name, coaching_goals:'c1' }
```

Consequences:
- For the common case (a payload carrying only its own template's fields, as the forms actually send), those answers **are** dropped — `custom_fields.intake_data` carries only the envelope (`template`, `submitted_at`, `date_of_birth`, `emergency_contact`).
- But the behaviour is **non-deterministic with respect to `template`**, and can flip on an unrelated invalid value. That is worse than uniform stripping and it scopes the fix: the tracked repair is `z.discriminatedUnion('template', …)`, not merely making the branches strict.

This is the same defect class as SA's `answers` finding (C1) — a payload-contract bug, not a column bug — so per the user's columns-only decision it is **tracked, not fixed**. It also qualifies D3's "the structured payload is persisted on `custom_fields.intake_data`": the envelope is, the answers generally are not.

Locked by the test *"KNOWN GAP: strips template-specific answers from intake_data"*, which asserts the true, stable outcome for its payload so that fixing the contract fails the test loudly and forces an explicit decision.

### Behaviour deltas beyond the column corrections

| Delta | Why |
|---|---|
| The contact **update** is now `user_id`-scoped | The repo does `.eq('id').eq('user_id')`; the old inline update filtered on `id` only. Strictly safer (SA 3c). |
| Manual `updated_at` dropped from the update payload | `update_crm_contacts_updated_at_trigger` sets it; `CRMContactUpdate` has no such field. Behaviour-preserving. |
| `phone` is written **only when the submitter supplied one** | The old code fell back to `existingContact.custom_fields?.phone`. `custom_fields` *was* selected, so the read was structurally valid — but **no code path anywhere writes `custom_fields.phone`**, so the fallback was always `undefined` and the update wrote `undefined` for phone (dropped during serialization). Conditional inclusion preserves the stored phone explicitly rather than relying on that. (Corrected per SA F5.) |
| Activity `description` now carries the site subdomain | The subdomain previously lived in the phantom `metadata` column; `booking_id` moved to the real `source_entity_id`. |
| Contact-lookup errors are now fatal (D7) | Previously indistinguishable from not-found → could create a duplicate contact on a transient read failure. |

### Verification results

- `npx jest app/api/website/forms/intake lib/repositories` — **13 suites / 99 tests pass** (final count after the SA F1 suite and the QA NB-6 test were added; the pre-review counts were 14 and 80).
- `npx tsc --noEmit` — **no errors in any touched file**. To be precise (SA F6): the project reports ~1,977 pre-existing errors repo-wide; this change adds none, and none fall in the files it touches.
- `grep -n "\.from(" app/api/website/forms/intake/route.ts` — empty (repository-only).
- `grep -n "console\." …` — empty (Pino throughout).
- Phantom-column screen: the coarse grep in §8 still reports benign hits — `name:` in the **Zod schema** and the `splitName` signature, and `status:` inside **HTTP response** objects (`{ status: 400 }`). Neither is a DB payload. The authoritative locks are the test assertions (T1/T2/T8/T9 assert the phantom keys are absent from the actual repository payloads).

---

### Post-review fixes (Dev, 2026-08-18)

Responses to SA's code review (§11.2). F1 was the only blocking item.

| SA item | Severity | Action |
|---|---|---|
| **F1** — P4 (`intake_completed_at`) had no regression lock: the route tests mock the repository, so the column literals in `SchedulingRepository.ts` were unreachable | Medium | **FIXED.** New `lib/repositories/__tests__/SchedulingRepository.linkIntakeContact.test.ts` (4 tests): asserts the update payload is **exactly** `{contact_id, intake_completed_at}` (no `intake_completed`, no `updated_at`), that `intake_completed_at` parses as a date, that both `.eq('id')`/`.eq('user_id')` scopes are applied to `scheduling_bookings`, plus the clean-miss and error-propagation paths |
| **F2** — `.single()` made a legitimate foreign/absent booking log at `error` level from a public endpoint | Low (opt.) | **FIXED.** `linkIntakeContact` now uses `.maybeSingle()`; a miss returns `{data:null,error:null}` and logs at `warn` with an explanatory comment. The route's non-blocking branch is unchanged |
| **F3** — T12's "foreign `booking_id`" leg was not actually foreign | Low (opt.) | **FIXED.** T12 now stubs the clean-miss result before the call and documents that `BOOKING_ID` stands for an unowned booking |
| **F5** — inaccurate `phone` rationale | Low (doc) | **FIXED** in the behaviour-delta table above |
| **F6** — overstated tsc claim | Low (doc) | **FIXED** in the verification list above |
| **F7** — dead `if (subdomain)` branch (Zod guarantees non-empty) | Low (opt.) | **FIXED.** Description built unconditionally |
| **F8** — `contactPatch` typed as an inline literal suppressed excess-property checking | Low (opt.) | **FIXED.** Typed as `CRMContactUpdate` |
| **F4** — the KNOWN-GAP test encodes the defect rather than the desired behaviour (`it.failing` alternative) | Low (opt.) | **KEPT AS IS**, per SA ("keeping it is fine — the intent is right"). `it.failing` would flip to green the moment the contract is fixed, silently; the current assertion fails loudly and forces the decision to be explicit, which is the point |
| **F9** — the working tree also carries unrelated roadmap status flips (RM information) | Info | Acknowledged. The roadmap edits are the doc-truth pass that closes `task_dda5f400` and records the items this session re-verified; surfaced to the user at the code-review handoff so they can split the commit if they prefer |
| **R4** — ownership pre-check kept at the caller | — | Accepted by SA, conditional on re-arguing if a second caller of `linkIntakeContact` appears. Noted in the method's doc comment |

**Re-verification after the fixes:** `npx jest app/api/website/forms/intake lib/repositories/__tests__/SchedulingRepository.linkIntakeContact.test.ts` → **2 suites / 18 tests pass**.

---

## QA Report (2026-08-18)

**QA — 2026-08-18**
**Test mode:** full
**Strategy used:** A + B (Jest unit/integration against the route handler with repositories mocked, plus the repository unit suite) — the change is a serverless API route + one repository method with no UI surface, and the endpoint is unauthenticated with no live tenant available. E2E/Playwright is not applicable: the only caller cannot produce a valid payload (tracked gap), so a browser run would only re-demonstrate the 400 that T10 already locks.
**Focus:** api, schema, security (tenant isolation), standards
**Skipped:** e2e (no reachable UI path — see above); no live Supabase execution (public route, service-role writes; QA does not write to production data). Column existence was therefore verified statically against `supabase/migrations`, independently of the workplan (§4 below).
**Input source:** prompt keywords + workplan §6/§8

---

### 1. Test results (actual output)

**`npx jest app/api/website/forms/intake lib/repositories/__tests__/SchedulingRepository.linkIntakeContact.test.ts`**

```
PASS lib/repositories/__tests__/SchedulingRepository.linkIntakeContact.test.ts
PASS app/api/website/forms/intake/__tests__/route.test.ts

Test Suites: 2 passed, 2 total
Tests:       18 passed, 18 total
Snapshots:   0 total
Time:        4.757 s
```

**`npx jest lib/repositories`**

```
PASS lib/repositories/__tests__/PaymentAutomationRepository.test.ts
PASS lib/repositories/__tests__/PaymentReminderRepository.test.ts
PASS lib/repositories/__tests__/PaymentEventRepository.test.ts
PASS lib/repositories/__tests__/AdminUserRepository.test.ts
PASS lib/repositories/__tests__/PaymentRepository.getOverdueInvoices.test.ts
PASS lib/repositories/__tests__/PaymentAutomationExecutionRepository.test.ts
PASS lib/repositories/__tests__/PaymentProcessorRepository.test.ts
PASS lib/repositories/__tests__/AgentRepository.calibration.test.ts
PASS lib/repositories/__tests__/SchedulingRepository.linkIntakeContact.test.ts
PASS lib/repositories/__tests__/AgentRepository.pilotSteps.test.ts
PASS lib/repositories/__tests__/CalibrationHistoryRepository.metadata.test.ts
PASS lib/repositories/__tests__/AgentRepository.findAllForAdmin.test.ts

Test Suites: 12 passed, 12 total
Tests:       84 passed, 84 total
Snapshots:   0 total
Time:        7.638 s
```

> Note: the implementation notes record "11 suites / 80 tests" for `lib/repositories` — that was the pre-F1 count. With the new `linkIntakeContact` suite it is **12 suites / 84 tests**, all green. No regression in any other repository suite.

**Typecheck — `npx tsc --noEmit`**

```
total "error TS" lines : 1977   (all pre-existing, repo-wide)
grep 'app/api/website/forms/intake|SchedulingRepository' : (no matches)
```

Zero diagnostics in either touched file; the 1,977 pre-existing errors are unchanged and out of scope. `tsconfig.json` has `"strict": true`; no `any` was introduced in production code (`custom_fields: Record<string, any>` is the pre-existing repository type).

**Diff-shape check (regression surface):** `git diff --numstat lib/repositories/SchedulingRepository.ts` → `53 / 0` — purely additive, `SchedulingBookingUpdate` untouched, so existing `SchedulingBookingRepository` callers cannot be affected. The route's response contract is identical to `HEAD` (`{success, message, contactId}` / `{success, error}` + 400/404/500), so the single caller's `data.success` check is unaffected.

---

### 2. Acceptance-criteria walk (§8 Verification)

| # | Criterion (§8) | Tested? | Result | Evidence |
|---|---|---|---|---|
| V1 | `npx tsc --noEmit` on touched files — clean | ✅ | **Pass** | Full-project run filtered on both paths → no diagnostic. 1,977 pre-existing errors elsewhere, unchanged. |
| V2 | `npx jest app/api/website/forms/intake` — all green | ✅ | **Pass** | 14/14 in that suite; 18/18 with the repository suite. |
| V3 | Phantom-column audit grep returns nothing *that is a DB payload* | ✅ | **Pass (with the documented benign hits)** | Hits: `:46` and `:51` `name:` inside the **Zod schema**, `:109` the `splitName` signature, `:130/:146/:293` `{ status: nnn }` **HTTP** objects. Every one inspected — **no DB payload contains a phantom column**. The four real payloads (contact create, contact patch, activity insert, booking link) were read field-by-field: see §4. |
| V4 | `grep -n "\.from(" route.ts` — nothing | ✅ | **Pass** | Empty. Also asserted at runtime by T13 (the mocked `supabaseServer.from` is never called). |
| V5 | QA: happy path + at least one failure path per CLAUDE.md | ✅ | **Pass** | Happy path (T1/T2), plus 400 (T4/T10), 404 (T3), 500 on create (T5) and on lookup (T11), non-blocking failures (T6/T7), isolation (T12). QA added 15 further probes (§5). |
| V6 | §6 matrix T1–T13 implemented | ✅ | **Pass** | All 13 present + the KNOWN-GAP lock = 14 tests. F1's repository suite restores the T9 promise (P4 column literals) at the repository boundary. |

---

### 3. Non-blocking / fatal semantics — confirmed

| Path | Required | Observed | Locked by |
|---|---|---|---|
| Booking link returns `error` | non-blocking → 200 | 200, warn only | T6 |
| Booking link returns clean miss `{data:null,error:null}` | non-blocking → 200 | 200, activity still written | T12 + QA E8 |
| Activity create returns `error` | non-blocking → 200 | 200, warn only | T7 |
| Contact **create** fails | 500, no downstream writes | 500; `linkIntakeContact` and `createActivity` not called | T5 |
| Contact **update** fails | 500, no downstream writes | 500; neither downstream call attempted | QA E6 (no committed test — see NB-6) |
| `findByEmail` returns `error` | 500, **no** create fallthrough | 500, `create` not called | T11 |
| Unknown subdomain | 404, no writes | 404 | T3 |

---

### 4. Independent column verification (against `supabase/migrations`)

Verified directly from the migrations, not from the workplan. Also checked every `ALTER TABLE` on the three tables (`20260723_add_calendar_sync_fields`, `20260723_enhance_payments`, `20260728_create_intake_tables`, `20260803_allow_null_booking_times`) — none renames or drops a column used here. The duplicate `20260721_create_crm_tables.sql` is identical on every column below, so the result holds under either migration order.

| Payload | Columns written | Exists? | Source |
|---|---|---|---|
| `crmContactRepository.create` (`route.ts:216-229`) | `user_id`, `first_name`, `last_name`, `email`, `phone`, `source`, `stage`, `custom_fields` | ✅ all 8 | `20260722_create_crm_tables.sql:8-24` (`first_name`, `last_name`, `email`, `phone`, `stage NOT NULL DEFAULT 'lead'`, `custom_fields JSONB`, `source`). **No `name` and no `status` column exists** — P1/P2 correct. |
| `crmContactRepository.update` patch (`:192-197`) | `custom_fields`, `phone` (conditional) | ✅ both | same. `stage` correctly absent (P3). `updated_at` correctly absent — `update_crm_contacts_updated_at_trigger` is `BEFORE UPDATE`. |
| `crmActivityRepository.create` (`:260-270`) | `user_id`, `contact_id`, `activity_type`, `title`, `description`, `auto_logged`, `source_capability`, `source_entity_id`, `activity_date` | ✅ all 9 | `20260722_create_crm_tables.sql:66-82`. **No `metadata` column; the column is `activity_type`, not `type`** — P5 correct. All three `NOT NULL` columns (`contact_id`, `activity_type`, `title`) are supplied. |
| `linkIntakeContact` (`SchedulingRepository.ts:742-746`) | `contact_id`, `intake_completed_at` | ✅ both | `contact_id UUID REFERENCES crm_contacts(id)` — `20260722_create_scheduling_tables.sql:68`; `intake_completed_at TIMESTAMPTZ` — `20260728_create_intake_tables.sql:111-113`. **No `intake_completed` column exists anywhere in the migrations** — P4 correct. |

Nested keys inside `custom_fields.intake_data` (`template`, `submitted_at`, `date_of_birth`, `emergency_contact`, …) are JSONB payload, not columns — no schema exposure.

`.eq()` scoping verified at the repository boundary for every write: `crm_contacts.update` → `.eq('id').eq('user_id')`; `linkIntakeContact` → `.eq('id', bookingId).eq('user_id', userId)` (asserted as an ordered pair by the new repository suite); `findByEmail` → `.eq('email').eq('user_id')`. `findBySubdomainAny` correctly applies **no** status filter (D5) — confirmed at `WebsitePageRepository.ts:146-160`.

---

### 5. Edge cases

Probed with a temporary QA-only Jest file against the real handler (repositories mocked), then deleted. 15 probes, 14 passed, 1 produced the finding NB-1 below.

| # | Edge case | Result | Notes |
|---|---|---|---|
| E1 | `booking_id` omitted | ✅ Pass | `linkIntakeContact` never called; `source_entity_id: null` on the activity; 200. |
| E2 | Single-word name (`"Prince"`) | ✅ Pass | `first_name:'Prince'`, `last_name: null`. `crm_contacts.last_name` is nullable — safe. |
| E2b | Padded / 3-token name (`"  Ada   Byron King  "`) | ✅ Pass | `first_name:'Ada'`, `last_name:'Byron King'` — the `\s+` split handles double spaces and trims. |
| E3 | Existing contact with `custom_fields = null` | ✅ Pass | The `|| {}` guard holds; the patch is exactly `['custom_fields']` (no `phone` key when none supplied). |
| E4 | Subdomain resolves to a **draft** page | ✅ Pass | `findBySubdomainAny` applies no status filter → 200. D5 honoured; draft/preview intake is not broken. |
| E5 | `template: 'general'`, no template-specific fields | ✅ Pass | 200; `intake_data.template = 'general'`; `phone: null`; activity title `Intake Form Completed (general)`. The `z.object({})` union branch is never reached (branch 1 matches first), which is harmless here. |
| E6 | Contact **update** failure | ✅ Pass | 500; booking link and activity not attempted. Behaviour correct — but this path has **no committed test** (NB-6). |
| E7 | Subdomain lookup returns a real DB **error** | ⚠️ Pass-with-note | 404 "Website not found", not 500 — error and not-found are conflated. Unchanged from `HEAD`, non-destructive, no duplicate risk. SA flagged the same; NB-3. |
| E8 | Booking link clean miss (`{data:null,error:null}`) | ✅ Pass | 200, activity still written, request unaffected. This is the F2/`maybeSingle()` path — fails closed. |
| E9 | Non-UUID `booking_id` | ✅ Pass | 400 at the Zod gate before any repository call. |
| E10 | Malformed JSON body | ⚠️ Pass-with-note | 500, not 400 — `request.json()` throws inside the outer `try`. Pre-existing project-wide pattern; NB-4. |
| E11 | 500 response body leaks no internals | ✅ Pass | Exactly `{success:false, error:'Failed to process intake form'}`; the thrown error's message never reaches the client. (The 400 returns Zod field errors only.) |
| E12 | `date_of_birth` + `emergency_contact` | ✅ Pass | Both survive into `custom_fields.intake_data` (base-schema fields, unaffected by the union). |
| E13 | **Therapist template answers** | ❌ Finding | `presenting_concerns` is **retained**, contradicting the workplan's "every template-specific field is stripped, for every template". See NB-1 and §6. |
| E14 | Concurrent submissions, same email | ⚠️ Reasoned, not executed | `crm_contacts` has **no** unique constraint/index on `(user_id, email)` (verified across all migrations). The find→create sequence is not atomic and `upsertByEmail` is deliberately avoided (D2), so two simultaneous first-time submissions each see not-found and each create a contact. Once duplicates exist, `findByEmail`'s `.single()` returns PGRST116 for >1 row → read as a clean not-found → a third duplicate on the next submission. **Entirely pre-existing** (identical in `HEAD`), not introduced or worsened here, and unreachable while the only caller 400s. NB-5. |

---

### 6. KNOWN GAP behaviour — confirmed real, partially mis-documented

- **Legacy caller → 400: confirmed.** `components/website/blocks/ProcessFlowSection.tsx:1789` is the **only** caller in the repo (`grep -rn "forms/intake"` → one non-test hit). Its body is `{subdomain, booking_id, name, email, answers}`; `template` is required by `IntakeFormBaseSchema`, so the request fails validation with `fieldErrors: {template:['Required']}` and **no** repository call is made. T10 locks this exactly. The workplan's "no user-visible change" claim is accurate.
- **Answers stripping: real, but the mechanism is not what the notes say.** The notes state "every template-specific field is silently stripped, for every template". Probed directly through the handler:

```
template:'coach', coaching_goals:'g'                       -> intake_data = {template, submitted_at}                       (stripped)
template:'coach', goals:'therapist-field',
                  coaching_goals:'coach-field'             -> intake_data = {template, submitted_at, goals:'therapist-field'}
template:'coach', coaching_goals:'g',
                  preferred_communication:'carrier-pigeon' -> intake_data = {template, submitted_at, coaching_goals:'g'}
template:'therapist', presenting_concerns:'anxiety'        -> intake_data = {template, submitted_at, presenting_concerns:'anxiety'}
```

  The accurate statement: `z.union` returns the **first branch that validates**, which is `TherapistIntakeFields` for almost every payload. So *therapist-named* fields are retained **regardless of the declared template**, every other template's fields are dropped, and the outcome **flips** as soon as a value trips a therapist-branch enum (row 3: an invalid `preferred_communication` knocks out branch 1, the Coach branch then matches, and `coaching_goals` is suddenly persisted). The captured data is therefore non-deterministic with respect to `template` — worse than "always stripped", and it should be recorded that way so the eventual contract fix is scoped correctly (`z.discriminatedUnion('template', …)` or a per-template switch). The committed KNOWN-GAP test still asserts a true and stable fact for its payload; only the surrounding prose and comment are wrong. Documentation-only; **out of scope** under the columns-only decision.

---

### 7. Standards

| Standard | Verdict | Evidence |
|---|---|---|
| Repository pattern | ✅ | Zero `.from(` in the route (grep + T13). All four table accesses go through `WebsitePageRepository`, `CRMContactRepository`, `CRMActivityRepository`, `SchedulingBookingRepository`. |
| Pino logging | ✅ | Zero `console.*` in both touched files. `logger.child({ correlationId })`; errors always as `{ err }`. |
| Zod validation | ✅ | `safeParse` before any business logic; every downstream payload built field-by-field from parsed data. |
| `user_id` scoping | ✅ | `ownerId` derived server-side from `subdomain → website_pages.user_id`; passed to every repository call; never taken from the body (T12). |
| Service-role/RLS-bypass documented | ✅ | `route.ts:11-15`. |
| TypeScript strict | ✅ | `strict: true`; zero diagnostics in the touched files; `contactPatch` annotated `CRMContactUpdate` (F8) so a future phantom field is a compile error. |
| Tenant isolation (`tenant-isolation-guard`) | ✅ | Caller-supplied `booking_id` flows only through `.eq('id').eq('user_id')` and fails closed as a clean miss; `contact_id` is never caller-supplied and is kept **off** `SchedulingBookingUpdate`; no upsert; no trigger fires on this update. Locked at the route (T12) and at the repository boundary (new suite). |

---

### 8. Issues found

#### Must fix before commit

**None.** No High-severity bug, no failing test, no new type error, no phantom column, no isolation hole. SA's blocking F1 is verified landed and green.

#### Non-blocking

| # | Issue | Severity | Recommendation |
|---|---|---|---|
| **NB-1** | **Doc accuracy — the "New finding" section and the KNOWN-GAP test comment mis-state the strip mechanism.** It is not "every template-specific field, for every template": the first validating union branch (`TherapistIntakeFields`) keeps its own fields for **any** template, and a value that trips one of its enums silently promotes a different branch (evidence in §6). | Low (doc) | Correct the two prose blocks and the test comment, and carry the corrected description into the tracked roadmap item so the fix is scoped as `z.discriminatedUnion('template', …)`. No code change under columns-only. |
| **NB-2** | The clean-miss booking link logs `"Failed to link booking (non-blocking)"` at `warn` with `err: null` (`route.ts:249`), duplicating the repository's own `"No booking matched for intake link"` warn. A legitimately absent/foreign booking reads as a failure in the logs. | Low | Split the branch: `if (bookingError) warn('Failed to link booking'); else if (!linkedBooking) info('No booking matched — nothing linked')`. |
| **NB-3** | The subdomain lookup conflates a real DB error with not-found → 404 (E7). Pre-existing; SA raised the same point. | Low | Leave the behaviour; add a one-line comment at `route.ts:142` so the asymmetry with D7 is visibly deliberate. |
| **NB-4** | Malformed JSON body → 500 rather than 400 (E10), because `request.json()` throws inside the outer `try`. Pre-existing project-wide. | Low | Optional: parse the body in its own try/catch and return 400. Not specific to this route. |
| **NB-5** | No unique constraint on `crm_contacts(user_id, email)` + a non-atomic find→create ⇒ concurrent first-time submissions can create duplicate contacts, and pre-existing duplicates make `findByEmail().single()` return PGRST116 (read as not-found) and create yet another (E14). Pre-existing; unreachable while the caller 400s. | Low | Track on the roadmap with the other CRM contract items; a partial unique index or `upsertByEmail` is the real fix, and it interacts with D2 (`stage` must not be overwritten). |
| **NB-6** | The **contact-update failure → 500** path has no committed test — the suite covers create-failure (T5) and lookup-error (T11) but not `update` returning `error`. QA verified it manually (E6). | Low | Add one test mirroring T5 with `updateContact` failing; ~6 lines, and it closes the last uncovered fatal branch. |
| **NB-7** | The implementation notes still say `npx jest lib/repositories` → "11 suites / 80 tests"; with the F1 suite it is now **12 / 84**. | Low (doc) | One-line correction. |
| **NB-8** | (RM information, restating SA F9) the working tree also carries `docs/workplans/BUSINESS_OS_MODULE_PLUGINS_ROADMAP.md` status flips outside this change's blast radius. | Info | RM to confirm or split at commit time. |

---

### 9. Final status

- [x] **All acceptance criteria pass — ready for commit.**
- [ ] Issues found — Dev must address before commit

**Verdict: PASS-WITH-NOTES.**

The five phantom columns are corrected, and every column written by the route and by `linkIntakeContact` was independently verified to exist in `supabase/migrations`. The repository conversion is complete (no `.from(` in the route), the severity split behaves exactly as specified, tenant isolation holds at both the route and the repository boundary, and the change is purely additive on `SchedulingRepository` with no regression in the 84-test repository suite. The documented KNOWN GAP is real and correctly locked (legacy payload → 400, no repository call).

The notes are all **non-blocking**: NB-1 and NB-7 are documentation corrections (NB-1 matters because it changes how the tracked contract gap should be fixed), NB-6 is one missing test for an already-correct path, and NB-2 through NB-5 are pre-existing or cosmetic. None of them changes behaviour for any live caller. Recommend committing as-is, with NB-1/NB-6/NB-7 folded in if convenient before RM picks it up.

---

### Post-QA fixes (Dev, 2026-08-18)

QA returned **PASS-WITH-NOTES** with no must-fix items. Three of its eight notes were acted on; the rest are pre-existing or informational.

| QA note | Action |
|---|---|
| **NB-1** — the "New finding" prose and the KNOWN-GAP test comment claimed template fields are *always* stripped | **FIXED (doc + comment).** QA is right and the correction matters: `z.union` returns the first *validating* branch, so a therapist-shaped field survives even under `template:'coach'`, and an invalid therapist-branch enum flips which keys survive. Re-verified directly. The finding section now records the non-determinism and names the real fix (`z.discriminatedUnion('template', …)`); the roadmap open item was corrected to match. The committed test assertion was already true and stable for its payload — only the prose was wrong. |
| **NB-2** — a clean miss on the booking link logged "Failed to link booking" with `err: null` | **FIXED.** The route now distinguishes the two: a repository error logs "Failed to link booking (non-blocking)" with `err`; a scope miss logs "Booking not found for this site owner (non-blocking)" without one. |
| **NB-6** — the contact-**update** failure path had no committed test | **FIXED.** Added T5b: an existing contact whose update fails → 500, with no booking link and no activity attempted. |
| **NB-7** — test-count drift in the notes | **FIXED** in the verification list above (13 suites / 99 tests). |
| **NB-3** subdomain lookup conflates DB error with not-found → 404; **NB-4** malformed JSON → 500 not 400; **NB-5** no unique index on `crm_contacts(user_id, email)` ⇒ concurrent-duplicate risk | **NOT CHANGED.** All three are pre-existing and identical at HEAD — NB-5 in particular is a schema-level gap affecting every public capture route, not something this fix introduces or should unilaterally change. Worth a follow-up if duplicate contacts are observed in practice. |
| **NB-8** — restates SA F9 (the working tree also carries the roadmap doc-truth pass) | Surfaced to the user at the code-review handoff. |

**Re-verification:** `npx jest app/api/website/forms/intake lib/repositories` → **13 suites / 99 tests pass**.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-08-17 | Created | Workplan for the reduced remainder of `task_dda5f400`: 5 phantom-column writes in the public intake route (2 fatal → the endpoint always 500s) + repository-layer conversion. Verified the other 4 routes in the original task scope are already corrected. |
| 2026-08-17 | SA review | APPROVE-WITH-CHANGES. Phantom columns, repository mapping, D4 and D5 verified against live source. Blocking C1: the live failure mode is 400 (the only caller omits the required `template`), not 500 — evidence and R1 must be corrected and the payload contract decided. C2–C6: cross-reference `booking/intake`; fix the non-existent `websitePageRepository` singleton in A2; correct D2's rationale; harden A1's `contact_id` widening and rewrite the §5 trigger row (T1 is INSERT-only, T2 is `UPDATE OF status` — neither fires here); add 4 test cases including the mandatory isolation invariant. |
| 2026-08-18 | C1–C6 folded in | User decision on C1: **columns-only** — the caller-contract gap (legacy `handleIntakeSubmit` omits `template`, sends stripped `answers`) stays open and is tracked on the roadmap; §1/§2/R1 rewritten to state plainly that this change is not user-visible. C2 `booking/intake` cross-referenced (the 1.2.c sweep covers six routes). C3 → D6 (`new WebsitePageRepository(supabaseServer)`; the `supabaseServer` import stays + gets its RLS-bypass justification). C4 D2 rationale corrected to product semantics. C5 → A1 becomes a dedicated `linkIntakeContact`, keeping `contact_id` off the generic update; §5 trigger row corrected. C6 → tests T10–T13 added (incl. the mandatory isolation invariant) and the §8 audit grep fixed. New D7 locks the `findByEmail` error path. |
| 2026-08-18 | Implemented | A1 `linkIntakeContact` added (generic update surface left closed); route rewritten onto repositories with all 5 phantom columns corrected; 14 tests incl. the mandatory isolation invariant. **New finding:** the Zod union silently strips every template-specific field (same contract-gap class as `answers`) — documented + test-locked, not fixed, per the columns-only decision. tsc clean on touched files; jest 14/14 + repositories 80/80. Holding for user code review before QA/RM. |
| 2026-08-18 | SA code review (Phase 2) | **APPROVE-WITH-CHANGES.** Re-verified all 5 column corrections against the migrations, C1-C6 applied, repository/Zod/Pino/TS-strict/user_id scoping and the tenant-isolation-guard checklist; jest 14/14 + repositories 80/80 and tsc re-run independently. R4 answered: the ownership pre-check may stay at the caller (invariant documented + `contact_id` kept off the generic update surface). **F1 required (Medium, test-only):** P4 is the one column fix with no regression lock left — T9 asserts only the mocked `linkIntakeContact` args, so `intake_completed_at` is never asserted; add a repository unit test. F5/F6 doc-accuracy corrections required; F2/F3/F4/F7/F8 optional. **Code Approved for QA: Yes (conditional on F1).** |
| 2026-08-18 | SA code review + post-review fixes | SA verdict APPROVE-WITH-CHANGES, code approved for QA conditional on F1. F1 fixed (new `SchedulingRepository.linkIntakeContact` unit suite — the P4 regression lock the route tests could not reach), F2/F3/F7/F8 optional items applied, F5/F6 doc inaccuracies corrected, F4 kept as-is per SA. 18/18 tests green. Ready for QA. |
| 2026-08-18 | QA | **PASS-WITH-NOTES.** 18/18 tests green (14 route + 4 repository); `lib/repositories` 12 suites / 84 tests green; `tsc --noEmit` shows zero diagnostics in either touched file (1,977 pre-existing repo-wide, unchanged). All four DB payloads verified column-by-column against the migrations independently of the workplan — P1–P5 all correct, no phantom column reaches any payload; the §8 audit grep hits are only Zod-schema `name:` and HTTP `{ status: nnn }`. Non-blocking semantics, fatal semantics, KNOWN-GAP 400 and tenant isolation all confirmed. 15 extra edge-case probes run. **No must-fix issues.** 8 non-blocking notes, of which NB-1 matters most: the "answers are stripped for every template" description is inaccurate — the first validating union branch (therapist) keeps its own fields for any template and the outcome flips on an enum mismatch, so the tracked contract fix should be scoped as a discriminated union. |
| 2026-08-18 | QA PASS-WITH-NOTES + post-QA fixes | QA found no must-fix issues; independently re-verified all 5 column corrections against the migrations and confirmed the non-blocking/fatal split. NB-1 corrected a real inaccuracy in the finding write-up (the stripping is branch-dependent and non-deterministic, not uniform — fix is `z.discriminatedUnion`); NB-2 (log a scope miss distinctly from an error) and NB-6 (contact-update failure test) fixed; NB-7 counts corrected. NB-3/4/5 left as pre-existing. 13 suites / 99 tests green. **Holding for user code review before RM.** |
