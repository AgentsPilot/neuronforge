# Repository Routing — Booking-Cancellation and Channel-Performance Paths

> **Last Updated**: 2026-10-30
> **Rule**: CLAUDE.md Mandatory Rule 1 — all DB access via `lib/repositories/`; no direct Supabase calls in routes/services/components.

## Overview

Several service-layer modules on the booking-cancellation and channel-performance paths reach a module-scope `supabaseServer` directly. This workplan routes those reads and writes behind repositories, slice by slice.

The work was filed off the back of a CI-reliability investigation rather than a product bug. Gate unit tests were making real outbound HTTP calls because production code reaches `supabaseServer` past the collaborators a test can stub; `tests/plugins/jest-setup.ts` points Supabase at `https://test.supabase.co`, which does not resolve, so each call NXDOMAINed in milliseconds and the caller's `catch` swallowed it. The test passed and nothing showed that it had left the machine. When a DNS query was lost, the resolver waited out a ~5 s retry — Jest's per-test budget — and a random unrelated test failed with "Exceeded timeout of 5000 ms". That turned PRs #572 and #576 red on tests unrelated to either.

A separate change (`fix/gate-tests-no-network`) installs a floor that refuses any non-loopback connection a test attempts. It removes the flake but deliberately does **not** make the offending tests fail — the calls then fail in microseconds into the same swallowing `catch`. **That is why this slice is filed now:** the measurement below is perishable evidence. Once the floor is in, nothing points at these violations any more.

## Table of Contents

- [Measured Baseline](#measured-baseline)
- [Site Inventory](#site-inventory)
- [Slices](#slices)
- [Sites Deliberately Left Alone](#sites-deliberately-left-alone)
- [Constraints](#constraints)
- [SA Review](#sa-review)
- [QA Report](#qa-report)
- [Change History](#change-history)

---

## Measured Baseline

The original sweep (clean probe at `globalThis.fetch` across the whole gate) found **30 suites making 478 real outbound calls costing 53.9 s of wall-clock**.

Re-measured on this branch, 2026-10-30, with the same probe technique (a `globalThis.fetch` counter installed in `setupFilesAfterEnv`, per-suite totals grouped by REST path), each suite run on its own:

| Suite | Calls | Tables | Wall-clock |
|---|---|---|---|
| `lib/services/__tests__/BookingLifecycleService.test.ts` | **202** | `proposals` 67, `payment_plan_subscriptions` 45, `payment_plan_installments` 45, `scheduling_services` 45 | 22.8 s (contended) |
| `lib/business-os/channel-insights/__tests__/ChannelPerformanceService.test.ts` | **22** | `agents` 22 | 5.5 s |
| `lib/services/__tests__/packageAcceptance.test.ts` | **12** | `business_profiles` 12 | 7.3 s |

**Two corrections to the brief, both verified:**

1. **`packageAcceptance` is 12 calls, not 168, and ~7 s, not 46.1 s.** The 46.1 s was wall-clock under parallel contention — the same suite reads 22.5 s when run alongside the other two and 7.3 s alone. The call count does not reproduce at 168 on current `main`.
2. **`packageAcceptance`'s subject is not a Rule 1 violation.** `ProposalAcceptanceService` contains **zero** direct `supabaseServer` calls — it is already compliant, routing everything through six repositories. Its 12 calls come from `ProposalAcceptanceService.ts:801`, a deliberately dynamic, fire-and-forget `await import('@/lib/services/PaymentReminderService')` whose `scheduleInvoiceReminders` reads `business_profiles` twice (`PaymentReminderService.ts:1650,1698`) through the client injected at `PaymentReminderService.ts:1915`. That is a test-mock gap at an unmocked collaborator, not a violation at the named site. See [Slice 7](#slice-7--packageacceptance-test-gap).

`BookingLifecycleService`'s 202 reproduces exactly, and so does `ChannelPerformanceService`'s 22.

---

## Site Inventory

| # | File | Sites | Tables | Shape |
|---|---|---|---|---|
| 1 | `lib/business-os/channel-insights/ChannelPerformanceService.ts` | 1 (`hasInboxChannel`, ~L200) | `agents` | Class with **six** injected collaborators, bypassing every one for this query |
| 2 | `lib/services/BookingLifecycleService.ts` | 12 (L522, 583, 656, 721, 740, 909, 926, 997, 1004, 2062, 2077, 2737) | `proposals`, `payment_plan_subscriptions`, `payment_plan_installments`, `scheduling_services`, `scheduling_bookings` | Module-level exported functions; tests already mock repository modules |
| 3 | `lib/payments/cancelQuoteStages.ts` | 6 (L167, 211, 260, 319, 352, 436) | `proposals`, `payment_plan_installments`, `payment_invoices` | Module-level function; test fakes `supabaseServer` wholesale with a Proxy query-builder |
| 4 | `lib/payments/stopBookingPlan.ts` | 4 (L102, 124, 165, 209) | `scheduling_bookings`, `payment_plan_subscriptions`, `payment_plan_installments` | Same Proxy-fake shape as #3 |

Site 1 is the clearest illustration of the trap and the natural first slice: the dependency-injection seam already exists, and the class takes six collaborators in its constructor and then bypasses all of them for one query — so a test author can stub everything the constructor asks for and still hit the network.

Sites 3 and 4 make **zero** network calls today, because their tests replace the whole `@/lib/supabaseServer` module with a hand-rolled Proxy. They are Rule 1 violations with no measured network cost, and they carry the largest test-rewrite cost: the Proxy fake is exactly the "asserting on the query builder instead of on the behaviour" shape the repository pattern exists to remove.

---

## Slices

Each slice is one commit. Every slice must leave its unit tests reaching **no** network and asserting intended behaviour rather than passing because a DB call failed.

| # | Slice | Sites | Calls removed | Status |
|---|---|---|---|---|
| 1 | `hasInboxChannel` to `AgentRepository` | 1 | 22 | ✅ |
| 2 | `BookingLifecycleService` to `ProposalRepository` | L721 (x2), 740, 909, 1004 | 67 | ✅ |
| 3 | `BookingLifecycleService` to plan repositories | L522, 583, 2062, 2737 (not 656) | 90 | ✅ |
| 4 | `BookingLifecycleService` to `SchedulingRepository` | L926, 997, 2077 | 45 | ✅ |
| 5 | `cancelQuoteStages` to repositories | 6 | 0 (already faked) | ⬜ **moved out — see Outcome** |
| 6 | `stopBookingPlan` to repositories | 4 | 0 (already faked) | ⬜ **moved out — see Outcome** |
| 7 | `packageAcceptance` test gap | — | 12 | ✅ |

The 90/45 split reconciles against the measurement: `payment_plan_subscriptions` 45 + `payment_plan_installments` 45 = 90 for slice 3, and `scheduling_services` 45 for slice 4 (sites L926 and L2077 contributed 0 in tests, because `SchedulingRepository` was already mocked). Slices 1-4 therefore total 224 = 22 + 202, and with slice 7's 12 that is the whole 236 measured across the three suites.

### Slice 1 — `hasInboxChannel` to `AgentRepository`

**File:** `lib/business-os/channel-insights/ChannelPerformanceService.ts`

Add a read to the existing `AgentRepository` (the `agents`-table repository) for "does this user have a non-deleted agent carrying this tag", then take it as a seventh constructor collaborator alongside the six already there, defaulting to the singleton. The test's single `makeService` factory is the only place that needs a new stub.

The method must keep `hasInboxChannel`'s **never-throws** contract: a card that cannot answer this shows one row fewer, it does not fail. The `catch { return false }` stays; what changes is that a test can now reach it.

New assertions this slice must add, because none exist today:

- the `inbox` row appears when the repository reports a tagged agent
- the row is absent when it does not
- a repository failure still returns the other channels' rows

### Slice 2 — `BookingLifecycleService` to `ProposalRepository`

Sites L721 (two equality reads), L740 (conditional `stopped` update), L909 (package-quote read), L1004 (`withdrawn` update).

Two invariants in the comments must survive the move, and the repository methods must carry them rather than leaving them at the call site:

- **`UPDATE` + `.or()` is forbidden.** PostgREST accepts an `or` filter on a `SELECT` and rejects it on an `UPDATE` with the misleading "column proposals.booking_id does not exist". Verified against this project's PostgREST on supabase-js 2.75.1. The read must stay two equality reads merged by id — and it is written that way (rather than with a legal `SELECT .or()`) because `mutationOrSelect.guard` scans forward from every `.update(` to the end of the enclosing block and would report the unrelated `.or()` as if it belonged to the instalment update far above.
- **Every `proposals` update stays conditional on `status = 'accepted'`,** so a second press is a no-op instead of a rewritten `stopped_at`, and `declined`, `expired`, `withdrawn` and `superseded` cannot be clobbered.

### Slice 3 — `BookingLifecycleService` to plan repositories

Sites L522 (live-plan read), L583 (instalment close), L656 (`lowerPlansForCancelledStages`, which takes a client as its first argument), L2062 (stamp period 1 with its invoice), L2737 (pre-delete `RESTRICT` check).

Invariants to carry into the repository methods:

- **`installment_count`, never `periods_total`** — the latter does not exist, and one unknown name makes PostgREST reject the *whole* select. A typo here reports every cancelled booking as having no live plan. Confirm the column list against the live schema before writing it (`business-os-schema-check`).
- **The live-plan read filters on `PLAN_STOPPED_STATUSES`, derived not retyped,** and `maybeSingle()` is safe *because* of that filter: the partial unique index `idx_plan_subs_one_live_per_booking` allows at most one row per booking in exactly those statuses.
- **L2737 deliberately does NOT filter to live plans.** `ON DELETE RESTRICT` counts any row, finished or not. Copying `cancelBooking`'s live-only filter here would let a booking with a stopped plan through to a delete the database then rejects — after the invoices, the calendar event and the client email are already gone. These are two different questions and need two different methods.
- **L2062 is scoped by booking,** not by `payment_plan_id` + `installment_number` alone: the plan row is the *service's* and is shared by every booking of it.

`lowerPlansForCancelledStages(client, …)` takes the Supabase client as a parameter. Changing its signature pulls in `cancelQuoteStages.ts:416`, the other caller — so this slice either leaves that parameter alone (passing the client through, a narrower violation) or moves with Slice 5. **SA to rule.**

### Slice 4 — `BookingLifecycleService` to `SchedulingRepository`

Sites L926 (package already-cancelled guard), L997 (`sale_mode` read), L2077 (link booking to its plan).

- **L2077 needs no new method:** `SchedulingBookingRepository.linkPaymentPlan(id, userId, paymentPlanId)` already exists at `SchedulingRepository.ts:3537`.
- **L926 must keep reading BOTH `status` and `meeting_status`.** `cancel()` writes them together *except* on a booking whose outcome was already recorded, where it writes neither. A package whose sessions were all held keeps `status: 'confirmed'` after being called off, so a guard reading only `status` re-runs the whole cascade on the next press.
- **L997 currently reads `scheduling_services` by `id` with no `user_id` scope.** That is a Rule 4 question as well as a Rule 1 one. Routing it through `SchedulingServiceRepository.findById(id, userId)` adds the scope. **SA to confirm** that is intended and cannot break a legitimate cross-user read.

### Slices 5 and 6 — `cancelQuoteStages` and `stopBookingPlan`

Rule 1 compliance with no network benefit. Both tests replace `@/lib/supabaseServer` with a Proxy query-builder and assert on the filters passed to it; both must be rewritten to mock repositories and assert on behaviour. The invariants to preserve are dense and documented in the comments at each site — in particular `cancelQuoteStages`' ordering guarantee (invoices voided **before** stages are closed, so a crash leaves work visibly unfinished and safe to re-run) and its "everything not settled, which includes the billed ones" stage filter.

### Slice 7 — `packageAcceptance` test gap

Not a Rule 1 fix. `ProposalAcceptanceService` is already compliant; the 12 calls come from the unmocked, fire-and-forget `PaymentReminderService` reached by dynamic import. The test should mock `@/lib/services/PaymentReminderService` and assert that reminders were *asked for*, which is the subject's actual contract ("non-blocking and swallowed; the acceptance is already committed"). That is the honest assertion, and it is stronger than today's, where a real client flies at a dead host and the result is discarded.

---

## Sites Deliberately Left Alone

| Site | Why |
|---|---|
| `lib/services/PaymentReminderService.ts` (L1650, L1698, and throughout) | Takes its client by **constructor injection** (`new PaymentReminderService(supabaseServer)`), not module scope — a different and less trapping shape. Routing a 1,915-line service behind repositories is its own stream, not a rider on this one. It is the root cause of Slice 7's 12 calls and should be filed as a follow-up. |
| `lib/business-os/leads/inboxChannel.ts:233`, `inboxChannelRunner.ts:156` | The same `agents`-by-tag query as Site 1, so Slice 1's new repository method covers them — but they sit outside the named booking-cancellation and channel-performance paths. Cheap follow-up once Slice 1 lands. |
| `lib/payments/planFollowsItsStages.ts` (`lowerPlansForCancelledStages`) | Takes the client as a parameter from two callers. Pulled in only if SA rules that Slice 3 should change its signature. |

---

## Constraints

- **Do NOT raise any Jest timeout and do NOT add retries anywhere.** The flake is being fixed at the source, not waited out.
- Verify every column name against the live schema before writing it (`business-os-schema-check`). The phantom-column failure mode here is silent: PostgREST rejects the whole select and the caller's `catch` reports "no plan".
- Never commit to `main`; branch then PR. Nothing is committed, even locally, until the user has seen the diff and approved.
- Never `git stash` in this repo.
- Re-measure with the same probe after each slice and record the new number.

---

## SA Review

**Reviewed by SA — 2026-10-30 (pre-implementation)**
**Status:** ✅ APPROVED WITH CHANGES

The diagnosis is right, the evidence is first-hand, and the two corrections to the brief are the kind of thing that should stop a workplan rather than be absorbed silently. Three structural changes are required before code: Slices 5 and 6 leave this stream, the three open questions are answered below, and eight factual corrections (G1–G8) go into the document first. No new repository is needed anywhere in this stream.

---

### Answers to the three questions

#### A1 — Slice 3: `lowerPlansForCancelledStages(client, …)` keeps its client parameter. Do not change the signature in this stream.

- **The premise is wrong: there are three callers, not two.** `lib/repositories/SchedulingRepository.ts:1649` passes `this.supabase`. So a signature change reaches into the repository layer, not just into `cancelQuoteStages`.
- **The only signature change worth making is removing the client entirely**, and that means the helper's two statements (the `payment_plan_installments` sibling read and the `payment_plans` terms update) move into `PaymentPlanRepository` as `findBookingIdsForPlan(planId, userId)` and `lowerPlanTerms(planId, userId, { totalAmount, installmentCount })`, leaving the helper as grouping + clamping arithmetic with no client at all. That creates `SchedulingRepository → planFollowsItsStages → PaymentPlanRepository` — a repository reaching another repository through a helper, which is a new pattern (CLAUDE.md rule 7) and needs its own cycle analysis. Today only the dynamic `import()` keeps that from being a static cycle, and I will not approve relying on `import()` as the cycle fix.
- **It costs this stream nothing to leave alone.** All three call sites reach the helper by dynamic `import()`, which is already a mockable seam: Slice 3's test mocks `@/lib/payments/planFollowsItsStages` and nothing leaves the machine. The helper is not a source of the measured 202 calls.
- **Consequence to write into the plan:** with this answer, `BookingLifecycleService.ts` still imports `supabaseServer` after Slice 4, solely to hand to the helper (and `cancelQuoteStages.ts` likewise after Slice 5). So the exit criterion per file is **"no `.from(` in the file" and "no network in the suite"**, *not* "no `supabaseServer` import". State it that way or the stream cannot be declared finished.
- File the helper's two statements as follow-up stream **FU-A**, next to `PaymentReminderService`.

#### A2 — Slice 4: yes, add the `user_id` scope. No, do not route it through `SchedulingServiceRepository.findById`.

- **The tightening is correct and cannot break a legitimate read.** `booking` at L997 is the return of `schedulingBookingRepository.cancel(bookingId, userId, …)`, which is `user_id`-scoped, so `booking.service_id` is by construction a service of the same owner. There is no shared/template-service concept on `scheduling_services` — every other read of that table (`findById`, `findOwnedId`, `listAll`, `listBookable`) is owner-scoped. The only rows the new filter can exclude are rows the current query should never have been able to return. Rule 4 satisfied.
- **But `findById` is the wrong vehicle.** It is `select('*')` + `.single()` + an error log on a miss. The site is `select('sale_mode')` + `.maybeSingle()`, where "no service" is a quiet, legitimate answer meaning "not proposal mode". Reusing `findById` turns every such miss into an error row in the logs and over-fetches every service column on every cancellation.
- **Required instead:** `SchedulingServiceRepository.findSaleMode(id, userId)` — `select('sale_mode')`, `.eq('id')`, `.eq('user_id')`, `.maybeSingle()`, returns `{ data, error }`, not-found neither thrown nor logged (the `findOwnedId` convention in the same class).
- **Guard the null id at the call site.** `booking.service_id` is nullable; today's `.eq('id', null)` is a latent PostgREST error that the enclosing `catch` hides. Skip the call when it is null.
- Record the added scope as a **deliberate behaviour change** in the commit message and in this document — not inside a commit described as a pure move.

#### A3 — Slice sizing: Slice 1 ships alone, first. Then one PR of three commits for 2–4. Slices 5 and 6 leave the stream (see E). Slice 7 may ride in the 2–4 PR as an explicitly test-only commit.

- Slice 1 is a different file, a different risk class (worst case: one report row missing) and carries 22 of the measured calls behind a DI seam that already exists. It proves both the approach and the re-measurement technique before any money code is touched.
- Slices 2–4 all edit `cancelBooking` in one file and share one 754-line test suite; separate PRs would mean rebasing that suite three times, and L909 (Slice 2) and L926 (Slice 4) sit inside the *same* `try` block. One PR, one commit per slice.
- Seven commits in one PR across booking cancellation, quote stopping and plan stopping is more than can be reviewed in one sitting, and makes a revert all-or-nothing on money-handling code.

---

### Comments

**B — Slice boundaries**

1. **B1** — Boundaries for 2/3/4 are right: each maps onto one repository, which is what makes each commit reviewable. Keep them. — [SA: approved]
2. **B2** — Slice 3 is the biggest and the only candidate for splitting: it spans two repositories (`payment_plan_subscriptions` for L522/L2737, `payment_plan_installments` for L583/L2062) and contains the delete guard, the subtlest invariant in the file. If the diff passes ~400 lines, split into **3a** (subscriptions: L522, L2737) and **3b** (instalments: L583, L2062). L656 is untouched either way (A1). — [SA: pending Dev]
3. **B3** — L909 (`proposals`, Slice 2) and L926 (`scheduling_bookings`, Slice 4) are correctly assigned by table but live in the same `try` block of the package cascade. Two slices editing one block is a semantic-merge hazard; it is safe only because 2–4 are one PR. Do not split that PR later. — [SA: resolved by A3]
4. **B4** — No slice is complete on "the suite is green". Each needs the probe re-run **and** an assertion that the new method was called with the expected scope. The `stopBookingPlan` suite's own comment is the precedent: a mutation that removed `.eq('booking_id')` from the *read* passed all nine tests, because the mock returns its rows whatever it is asked. — [SA: pending Dev]

**C — Existing repository vs new one (`new-repository` skill Step 1, REPOSITORY_STRATEGY best practice 6)**

5. **C0** — **No new repository class.** Every table in scope already has an owner, so every method the plan implies is an addition to an existing class. Creating a class for any of these would be a review rejection:

| Table | Existing repository | Methods to add |
|---|---|---|
| `agents` | `AgentRepository` | `existsWithTag(userId, tag)` |
| `proposals` | `ProposalRepository` | accepted-by-booking read, `stopAcceptedByIds`, package-quote read, `withdrawOpenForBooking` |
| `payment_plan_subscriptions` | `PaymentPlanSubscriptionRepository` | `findLiveForBooking`, `findAnyForBooking` |
| `payment_plan_installments` | `PaymentPlanRepository` | `cancelOpenStagesForBooking` (returns rows), `stampFirstPeriodInvoice` |
| `scheduling_services` | `SchedulingServiceRepository` | `findSaleMode` (A2) |
| `scheduling_bookings` | `SchedulingBookingRepository` | `findCancelStateForOwner`; `linkPaymentPlan` already exists (L3537) |
| `payment_invoices` (FU, ex-slices 5/6) | `PaymentInvoiceRepository` | the per-proposal "loose invoice" read |

6. **C1** — `existsWithTag` returns `{ data: boolean \| null, error }` — never a bare boolean, and never `false` on error (`new-repository`: "every method returns `{ data, error }` — never throws"). The never-throws decision stays in `hasInboxChannel`, or the planned test "a repository failure still returns the other channels' rows" asserts on nothing distinguishable from a true `false`. Keep the filter byte-for-byte: `contains('tags', [TAG])` + `is('deleted_at', null)`, **no status filter** — an inbox channel agent may be paused and must still count. — [SA: pending Dev]
7. **C2** — `PaymentPlanSubscriptionRepository` has `private supabase = supabaseServer` and **no constructor injection**, failing the `new-repository` checklist item "constructor accepts optional `SupabaseClient` (for tests)". Slice 3 is adding methods to that class: add `constructor(client?: SupabaseClient)` in the same commit. No behaviour change, and it gives the new methods a real unit-test seam instead of module-level mocking only. — [SA: pending Dev]
8. **C3** — Do **not** fold the new stage close into `PaymentPlanRepository.cancelInstallments`. Different filters (booking vs plan + contact), a different patch (the existing one writes no `cancel_reason` / `cancel_note` / `cancelled_by`) and a different return (count vs the `id, amount, payment_plan_id` rows Slice 3 must feed to the helper). One named transition per call site with its patch fixed inside the repository — the CF-5 precedent. A generic `updateInstallments(filters, patch)` would be rejected. — [SA: pending Dev]

**D — Where each invariant belongs**

9. **D1 — `UPDATE` + `.or()` prohibition → repository, and the comment must be REWRITTEN, not copied.** The current justification ("written as two equality reads because `mutationOrSelect.guard` scans forward from every `.update(` to the end of the enclosing block — 242 lines here") becomes **false** once the read and the update are separate repository methods: the guard's block scan then stops at the method brace. A verbatim copy is a wrong comment in a new place, which is worse than none. Keep the two equality reads in the move commit (zero behaviour delta). Collapsing them into one legal `.or()` SELECT — which `ProposalRepository.latestForBooking` already does on exactly these two columns — is then available as a separate optional commit and must not be smuggled into the move. The UPDATE keeps `.in('id', …)` + `.select()`, which the guard permits because no `.or()` is in that method. — [SA: pending Dev]
10. **D2 — `installment_count`, never `periods_total` → repository**, as a module-level column constant (the CF-5 "column lists are module constants" pattern), not a string repeated across two methods. `PlanSubscription` already types `installment_count`, so a typed `Pick<>` return turns a phantom column into a `tsc` error instead of a silent runtime "no plan". — [SA: pending Dev]
11. **D3 — live-vs-any (L522 vs L2737) → repository, as two differently named methods.** `findLiveForBooking` derives its filter from `PLAN_STOPPED_STATUSES` (importable from `lib/payments/planStatus.ts`, a pure module — no cycle) and `maybeSingle()` stays safe *because* of that filter and `idx_plan_subs_one_live_per_booking`. `findAnyForBooking` carries no status filter, `limit(1)`, for the `ON DELETE RESTRICT` pre-check. **No `liveOnly` boolean parameter** — the difference must be visible at the call site. Add a unit test on `findAnyForBooking` asserting it applies **no** status filter, so a later "consistency" fix has to change a test on purpose (the device the webhook `⟨unscoped-by-design⟩` methods use). Bonus: `findAnyForBooking` is byte-identical to `stopBookingPlan.ts:124`, so the follow-up stream reuses it. — [SA: pending Dev]
12. **D4 — `status` AND `meeting_status` at L926 → repository** as `findCancelStateForOwner(id, userId)` returning both columns, with the "`cancel()` writes neither on a booking whose outcome was recorded" reason in the method doc. The **predicate** (`cancelled` on either) stays at the call site: that is the cascade's decision, not a fact about the row, and a precomputed `isCancelled` would hide which column answered. — [SA: pending Dev]
13. **D5 — L2062's booking scope → repository** as `stampFirstPeriodInvoice(planId, bookingId, userId, invoiceId)`, all four filters and `installment_number = 1` fixed inside, with the "the plan row is the *service's* and is shared by every booking of it" reason beside the query. The **"FIRST, before the Stripe round trip"** ordering invariant stays at the call site — it is about statement order in the service and no repository can enforce it. — [SA: pending Dev]
14. **D6 — not in the plan's list but load-bearing:** `cancelQuoteStages`' void-before-close ordering and `stopBookingPlan`'s read → void → close ordering are **call-site** invariants and must stay at the call site. Any future repository method that both voided and closed would destroy them. Record this in the follow-up stream's workplan. — [SA: pending Dev]

**E — Slices 5 and 6: remove from this stream and file as their own**

15. **E1** — My ruling is *not* "don't do them" — it is "not here, and not as a rider". Give them their own workplan, their own SA pass and a QA pass that is allowed to include a live money check. Reasons:
    - They remove **zero** measured calls. The stream's justification is perishable evidence; nothing about 5/6 is perishable. `fix/gate-tests-no-network` changes nothing for them, because their tests never touch the network today.
    - The cost is not "route ten queries". It is rewriting a 780-line and a 241-line suite whose stated purpose is asserting the *filters*, on the two paths that void invoices and close money rows. Both suites document mutations they caught by observing scope where it is applied. Moving those assertions into repository unit tests is the right end state, but a mistake there writes `status: 'cancelled'` over the wrong rows on a live account.
    - Shipping them with 1–4 means the CI-flake fix and the money-path regression risk revert together. Keep the flake fix clean.
16. **E2** — The split costs almost nothing, and say so in the new workplan: slice 6's booking-ownership read is already `schedulingBookingRepository.findOwnedId(id, userId)` (SchedulingRepository L2221) and its subscription read is Slice 3's `findAnyForBooking` (D3). Two of its four sites arrive pre-built. — [SA: pending Dev]

**F — Slice 7: approach approved, `PaymentReminderService` stays out of scope**

17. **F1** — Mocking `@/lib/services/PaymentReminderService` is the right seam and the only one. But soften the plan's wording: the module exports `paymentReminderService = new PaymentReminderService(supabaseServer)` at L1915, **bound at import**, so "constructor injection, a different and less trapping shape" is one hop too generous — the test cannot reach it except by mocking the module. Record that in the follow-up so whoever takes on its 11 queries knows the seam does not exist for free. — [SA: pending Dev]
18. **F2** — The mock factory must export `paymentReminderService: { scheduleInvoiceReminders: jest.fn().mockResolvedValue(undefined) }`, i.e. something that **returns a promise**. `ProposalAcceptanceService.ts:801-816` destructures the named export and chains `.catch()` on the return; a factory missing the key, or returning `undefined`, throws a TypeError inside the enclosing `try`, which returns `null` for the invoice id and breaks the *money* assertions in the same suite rather than the reminder ones. — [SA: pending Dev]
19. **F3** — Assert the arguments, not just the call: `(user_id, invoiceId, contact_id, dueDateFromTerms(termsDays))`. Add one test that a **rejected** `scheduleInvoiceReminders` does not fail the acceptance — that is the contract the comment claims and nothing currently proves. Label the slice test-only (no Rule 1 content). — [SA: pending Dev]

**G — Corrections required in this document before implementation**

20. **G1** — "Takes the client as a parameter from two callers" (§Slice 3 and §Sites Deliberately Left Alone) is wrong: **three** callers, the third `lib/repositories/SchedulingRepository.ts:1649`. — [SA: pending Dev]
21. **G2** — "`inboxChannel.ts:233`, `inboxChannelRunner.ts:156` — the same `agents`-by-tag query as Site 1, so Slice 1's new repository method covers them" is wrong. `inboxChannel.ts` selects `id, status, agent_config, tags, last_run` ordered ascending; the runner selects nine columns, filters `status = 'active'`, adds `.or(last_run.is.null,last_run.lte.…)`, limits — and has **no `user_id` filter at all**: it is a cron reading every account. `existsWithTag` covers neither. Rewrite the row: they need their own methods, and the runner's needs an `…AllAccounts` name plus a `tenant-isolation-guard` pass because its output is a cross-tenant row set. Still out of scope here — but not "cheap follow-up once Slice 1 lands". — [SA: pending Dev]
22. **G3** — The slice table's "Calls removed" sums to 224 against a measured 202 + 22, and the per-table figures do not split as 90/45: Slice 3 spans both `payment_plan_subscriptions` and `payment_plan_installments`, and Slice 4 spans `scheduling_services` + `scheduling_bookings`, the latter absent from the measured table entirely (L2077 is apparently not reached by the suite). Re-derive per slice or mark the column approximate — as printed it will not reconcile against the re-measurement the plan mandates. — [SA: pending Dev]
23. **G4** — `BookingLifecycleService.test.ts:36` mocks `@/lib/repositories/SchedulingRepository` with a factory exporting only `schedulingBookingRepository.{cancel, findChildren}`. Slices 3/4 add calls to `schedulingServiceRepository` and to `linkPaymentPlan` **from that same module**; a factory that does not list them yields `undefined`, a TypeError, and a swallowing `catch` — a test passing for the wrong reason, which is the exact failure this stream exists to remove. Every slice extends the factory **and** adds a call assertion. — [SA: pending Dev]
24. **G5** — Slice 1's exit criterion is "no `.from(` in `ChannelPerformanceService.ts`", not "no `supabaseServer`": the import legitimately stays for the two repository default constructor arguments at L183-184. While there, delete the stale comment at L18 (`/* supabaseServer is already imported further down — this module had it. */`), which becomes actively misleading. — [SA: pending Dev]
25. **G6** — Logging: all ten files in scope are already free of `console.*` (verified), so CLAUDE.md § Logging raises nothing. New repository methods follow the repository convention — `logger.error({ err, … }, '…')`, not-found neither thrown nor logged. — [SA: resolved]
26. **G7** — Narrow the `business-os-schema-check` requirement to what is genuinely new: every column named in this stream is already selected by the code being moved, so the only real risk is a column constant typed from scratch. Verify `scheduling_services.sale_mode` and `payment_plan_subscriptions.installment_count | periods_paid | next_charge_at` against live before freezing those constants. — [SA: pending Dev]
27. **G8** — No new table, bucket or column, so the `new-repository` skill's data-export classification item is **N/A**. State that in the plan so QA does not go looking for a descriptor change. — [SA: pending Dev]

### Optimisation suggestions (never blocking)

- Once D1's read lives in `ProposalRepository`, the two equality reads can become one `.or()` SELECT (precedent: `latestForBooking`), saving a round trip per cancellation. Separate commit, separate line in this plan.
- `findAnyForBooking` (D3) is reusable by the ex-slice-6 stream verbatim; naming it for the question ("is any plan attached") rather than the caller keeps that true.
- `existsWithTag` is the natural base for the G2 follow-up's `listInboxChannelsForUser`; design the tag argument as a parameter, not a constant, so the follow-up adds a method rather than editing this one.

### Adjusted items (marked by SA)

- **Slices 5 and 6 — removed from this stream.** File as `REPOSITORY_ROUTING_QUOTE_AND_PLAN_STOP` with its own SA + QA cycle. Carry D6, E2 and the invariant list across.
- **Slice 3 — scope unchanged, but `lowerPlansForCancelledStages` keeps its client parameter** (A1). Add follow-up **FU-A** for the helper's two statements.
- **Slice 4 — L997 routes through a new `findSaleMode`, not `findById`** (A2), with the `user_id` scope added as a declared behaviour change and a null-`service_id` guard at the call site.
- **Delivery — two PRs, not one:** PR 1 = Slice 1. PR 2 = Slices 2, 3, 4 (+7 as a test-only commit), one commit each, in that order.
- **Exit criterion restated per file:** "no `.from(` in the file" + "the suite reaches no network", not "no `supabaseServer` import".

### Approval

- [x] Workplan approved **with the changes above** — proceed to implementation once G1–G5, G7 and G8 are corrected in this document and the Slices table reflects the 5/6 removal and the two-PR split. The corrections are documentation-only; no second SA workplan pass is required before coding. Code review (Phase 2) still applies per slice, and I will walk D1–D6 and C0–C3 against the diff.

## QA Report

**QA — 2026-10-30**
**Test mode:** full
**Strategy used:** A + B + C (Jest unit/integration already present, plus my own standalone probe and mutation harness). No D (Playwright is not installed and this change has no UI), no E.
**Focus:** api / schema / security (tenant scoping) / performance (the gate's wall-clock)
**Skipped:** browser check — there is nothing a browser can see here.
**Input source:** QA judgment + the explicit verification list in the trigger. The workplan carries no `## QA Test Scope` block.

**State tested.** The working tree moved under this QA pass: at 19:23:40 another session renamed `cancelUnbilledStagesForBooking` to `cancelOpenStagesForBooking`, moved `findCancellationState` out of the CF-5 webhook section, changed `PaymentPlanSubscriptionRepository`'s constructor to a default parameter, and added `lib/repositories/__tests__/PaymentPlanRepository.bookingWrites.test.ts` plus changes to `BookingLifecycleService.planInvoice.test.ts`. Everything below was then re-run against that later state and pinned by checksum, except where a result is explicitly labelled "19:1x state". **Two of the findings were already fixed by that in-flight edit** — they are recorded because they were real and because the fix needs to stay.

### What I ran

| # | Check | Command |
|---|---|---|
| 1 | Network probe, three suites | own probe at `globalThis.fetch` **and** `http/https.request` **and** `net.Socket.prototype.connect`, injected via `setupFilesAfterEnv` in a throwaway config |
| 2 | Mutation testing | 28 mutations, one at a time, each restored from a byte-checked snapshot; 9 survivors then re-applied in two batches against every suite that could catch them |
| 3 | Full gate, three times | `jest --ci` on the branch, on the base commit `0dca3b2c` in a second worktree, and again on the final state |
| 4 | Typecheck | `tsc --noEmit` with `typeRoots` pointed at the parent repo's `node_modules/@types` and `--max-old-space-size=12288` |
| 5 | Scoping audit | every new repository method's body, plus the `userId` provenance of all nine production callers of `cancelBooking` / `deleteBooking` |

### Test Coverage

| Acceptance criterion | Tested? | Result | Notes |
|---|---|---|---|
| Zero outbound network from `BookingLifecycleService.test.ts` | ✅ | **Pass** | 0 fetch, 0 `http.request`, 0 non-loopback socket connect |
| Zero outbound network from `ChannelPerformanceService.test.ts` | ✅ | **Pass** | same, 0/0/0 |
| Zero outbound network from `packageAcceptance.test.ts` | ✅ | **Pass** | same, 0/0/0 |
| The measured baseline is real (not a mis-measurement) | ✅ | **Pass** | reproduced on `0dca3b2c` exactly: **202 / 22 / 12**, with the REST URLs |
| The whole gate got quieter | ✅ | **Pass** | gate-wide fetch attempts **323 → 87**; suites making any attempt **32 → 28** |
| The new tests assert behaviour, not a swallowed failure | ⚠️ | **Partial** | 19 of 28 mutations caught; **9 survived** — see Bug 3 |
| Rule 4: every new repository method filters by `user_id` | ✅ | **Pass** | all 11 methods, exactly one `.eq('user_id', userId)` each |
| The `findSaleMode` tightening is safe | ✅ | **Pass** | see "Rule 4" below — all nine callers pass the owner's id |
| No regression against `main` | ✅ | **Pass on the final state** | two branch-only failures at the 19:1x state (Bugs 1 and 2), both fixed in-flight; the final run has **no** branch-only failure, and its 29 are a subset of the base commit's 33 |
| `lowerPlansForCancelledStages` reaches no network from a test | ✅ | **Pass** | it can only use its `db` parameter; mocked in the booking suite, 0 calls measured |
| Exit criterion "no `.from(` in the file" | ✅ | **Pass** | `BookingLifecycleService.ts` 0, `ChannelPerformanceService.ts` 0 |
| Typecheck clean in the touched files | ❌ | **Fail** | one new error — see Bug 4 |

### Network probe — the numbers, measured independently

The probe wraps three layers, because `fetch` alone can be bypassed. It is not a no-op: on the base commit it reported 32 suites making outbound attempts, with full URLs.

| Suite | Base commit `0dca3b2c` | This branch | Tables seen on the base commit |
|---|---|---|---|
| `lib/services/__tests__/BookingLifecycleService.test.ts` | **202** (socket 202) | **0** | `payment_plan_subscriptions`, `payment_plan_installments`, `proposals`, `scheduling_services` |
| `lib/business-os/channel-insights/__tests__/ChannelPerformanceService.test.ts` | **22** | **0** | `agents?select=id&user_id=eq.…&tags=cs.{inbox-enquiries}&deleted_at=is.null` |
| `lib/services/__tests__/packageAcceptance.test.ts` | **12** | **0** | `business_profiles?select=payment_reminder_…` |
| **whole gate** | **323 fetch / 32 suites** | **87 fetch / 28 suites** | −236, exactly these three suites |

One of the baseline URLs is itself evidence: `scheduling_services?select=sale_mode&id=eq.undefined`. The old read passed a missing `service_id` straight into `.eq('id', …)` — see Observation O1 for what that does and does not prove.

Largest remaining offender, unrelated to this stream and worth a follow-up: `app/api/public/invites/validate/__tests__/route.test.ts`, **32** calls.

### Mutation testing — 28 mutations, 19 caught, 9 survived

Each mutation was applied alone to a pristine snapshot, run, and reverted; the snapshot was checksum-verified after every restore, and the final tree matches the pre-QA checksums byte for byte.

**Caught (19)** — the invariant has a test that fails when it is broken:

| Mutation | Caught by |
|---|---|
| `existsWithTag` loses `user_id` | `AgentRepository.existsWithTag › scopes to the owner, the tag, and the undeleted` |
| `existsWithTag` loses `deleted_at IS NULL` | same, plus the true/false cases |
| `existsWithTag` forced `true` / forced `false` | the two boolean tests |
| `hasInboxChannel` treats an unreadable answer as "present" | `the mailbox channel › costs the rest of the card nothing when it cannot be read` |
| `hasInboxChannel` asks about another user | `the mailbox channel › is asked about by tag, for the user whose card this is` |
| `findAnyForBooking` **gains** a live-only status filter (the `ON DELETE RESTRICT` bug) | `findAnyForBooking › applies NO status filter at all`, and two `deleteBooking` tests |
| `findAnyForBooking` loses `user_id` | the repository scope test |
| `findLiveForBooking` loses its status filter | `excludes the finished statuses, so at most one row can match` |
| `findLiveForBooking` loses `user_id` | `scopes to the booking and its owner` |
| `findLiveForBooking` selects the phantom `periods_total` | `asks for installment_count and NEVER periods_total` |
| `cancelOpenStagesForBooking` drops `subscription_id IS NULL` | `closes only this booking owner-scoped, unsettled, non-subscription stages` |
| …loses `user_id` | same |
| …narrows back to `status = 'pending'` | same, plus the service-level stage test |
| `stampFirstPeriodInvoice` drops the booking scope | `stamps period 1 of THIS booking, for THIS owner` |
| …loses `user_id` | same |
| `cancelBooking` stops guarding the null `service_id` | `does not ask about the service when the booking names none` |
| `deleteBooking` asks the live-plan question instead of the any-plan one | both `BookingHasPlanError` tests |
| `cancelBooking` stops passing reason/note/owner to the stage close | `closes them and carries the reason, the note and the owner` |

So the four invariants the brief asked about specifically — a dropped `user_id`, a status filter creeping into `findAnyForBooking`, `existsWithTag` forced either way, and a dropped `subscription_id IS NULL` — are all **genuinely covered**. The three new repository test files are what covers them; without them most of these mutations would pass.

**Survived (9)** — see Bug 3.

### Issues Found

#### Bugs

> Bugs 1 and 2 were found here from my own gate run before I had read §"Second round", and they turn out to match what Dev recorded there from their own baseline diff. They are kept because two independent runs agreeing on them is the useful fact, and because the shape of each fix needs to survive the next edit. **Bugs 3 and 4 are not in any other section of this document.**

1. **A source-shape guard went red: `findCancellationState` was placed inside the CF-5 webhook section** — File: `lib/repositories/SchedulingRepository.ts` — Severity: **High** (red required gate) — **already fixed in-flight at 19:23:40; verified green afterwards.**
   - At the 19:1x state the method sat between `markPaidForOwnerCounted` and `linkPaymentPlan`, i.e. inside the region `SchedulingBookingRepository.webhook.test.ts › source shape (SA C-3)` slices from `// Stripe webhook and plan binding: owner-scoped (CF-5 PR 4)` to the end of the class. That region forbids `try {`, forbids `logger.`, and pins `.eq('user_id', userId)` to exactly four occurrences. The new method brought all three violations.
   - Observed: `expect(received).not.toMatch(expected) / Expected pattern: not /\btry\s*\{/` at `lib/repositories/__tests__/SchedulingBookingRepository.webhook.test.ts:305`.
   - Expected: that suite green. It now is — the method lives at ~L3311, outside the guarded region.
   - Worth keeping in mind for the follow-up streams: that class has a region into which a repository method may not be appended.

2. **A second guard went red: the payment-repository client-default guard** — File: `lib/repositories/PaymentPlanSubscriptionRepository.ts` — Severity: **High** (red required gate) — **already fixed in-flight; verified green in the final gate.**
   - `paymentTablesWriteLockdownMigration.test.ts › every payment repository defaults to the service-role client` matches the source against `/supabase(Client)?: SupabaseClient = supabaseServer|=\s*supabaseServer|\(supabaseServer\)/`. The constructor added by SA item C2 was `constructor(supabaseClient?: SupabaseClient) { this.supabase = supabaseClient || supabaseServer; }`, which matches none of the three alternatives, so the guard failed.
   - Observed: `expect(received).toBe(expected) … Received: false` at `paymentTablesWriteLockdownMigration.test.ts:426`.
   - The in-flight fix (`constructor(supabaseClient: SupabaseClient = supabaseServer)`) satisfies the first alternative. This is the shape to use for C2-style additions to any payment repository.

3. **Six of the eleven new repository methods have no unit test, and nine invariants can be broken with the whole suite still green** — Files: `lib/repositories/ProposalRepository.ts`, `lib/repositories/SchedulingRepository.ts` — Severity: **Medium** (no live defect; a missing net on money-path code, and six of the nine are Rule 4 scopes)
   - `findAcceptedForBooking`, `stopAccepted`, `findPackageQuotesForBooking`, `withdrawOpenForBooking`, `findSaleMode` and `findCancellationState` are referenced by no test file in the repository other than through a service mock, so nothing asserts their queries.
   - These nine mutations survived. Each was then re-applied — in two batches, because some overlap textually — against **38 suites**: the 20 tier-1 suites plus every test in the repo that reads `ProposalRepository.ts`, `SchedulingRepository.ts`, `PaymentPlanRepository.ts`, `AgentRepository.ts` or `BookingLifecycleService.ts` as source text. **852 tests, all green, with every one of the nine applied.**

     | Mutation | What it would do in production |
     |---|---|
     | `stopAccepted` loses `.eq('status', 'accepted')` | a second press rewrites `stopped_at`; `declined` / `expired` / `withdrawn` / `superseded` get clobbered — exactly SA's D1 invariant |
     | `stopAccepted` loses `.eq('user_id', userId)` | **cross-tenant write** to `proposals` |
     | `withdrawOpenForBooking` loses `.in('status', OPEN_PROPOSAL_STATUSES)` | withdraws an **accepted** quote, which "money was created against" |
     | `withdrawOpenForBooking` loses `.eq('user_id', userId)` | **cross-tenant write** |
     | `findAcceptedForBooking` loses `.eq('user_id', userId)` | **cross-tenant read**, whose ids are then fed to an `.in('id', …)` update |
     | `findPackageQuotesForBooking` loses `.eq('user_id', userId)` | **cross-tenant read** that drives the package cascade |
     | `findSaleMode` loses `.eq('user_id', userId)` | the Rule 4 tightening this stream deliberately added, undone silently |
     | `findCancellationState` loses `.eq('user_id', userId)` | **cross-tenant read** |
     | `findCancellationState` selects `status` only | SA's D4 invariant: the cascade re-runs on a package whose outcome was recorded |
   - This is the same shape as the `stopBookingPlan` precedent SA cited in B4, and it is what the three test files that **do** exist were written to prevent. The remedy is the same: a unit test per method asserting the filters, in the style of `PaymentPlanRepository.bookingWrites.test.ts`. The `new-repository` checklist asks for it ("Unit tests cover each method's happy path + at least one error path"), and SA's B4 made it a per-slice completion condition.

4. **A new TypeScript error in the new test code** — File: `lib/services/__tests__/BookingLifecycleService.test.ts:1020` — Severity: **Low**
   - `error TS2322: Type 'null' is not assignable to type 'string | undefined'` at `booking({ service_id: null })`.
   - `SchedulingBooking.service_id` is declared `string` (`SchedulingRepository.ts:257`), and `20260722_create_scheduling_tables.sql:67` declares the column `UUID NOT NULL`. No migration drops that. So the test asserts a state both the type and the schema forbid.
   - This is the only error in any of the 13 touched files; the typecheck's other 1,922 errors are pre-existing and reproduce on the base commit.
   - Two honest fixes, and the choice is a schema question: if the live column really is nullable, declare `service_id: string | null` (and the error goes away); if it is not, drop `: null` and use an omitted / `undefined` `service_id`, which is what the baseline probe actually caught (`id=eq.undefined`). A `business-os-schema-check` settles it. See O1.

#### Performance

1. **Nothing regressed; the stream's own benefit is confirmed.** The three suites dropped 236 real HTTP attempts, and the probe shows the gate-wide total fell from 323 to 87. `findAcceptedForBooking` keeps the two-round-trip read (one extra round trip per cancellation) that SA left as an optional later optimisation.

#### Edge cases

1. **`BookingLifecycleService.test.ts`'s `SchedulingRepository` factory is still incomplete — this is SA Code Review item 5, and it is the one SA item still open.** It supplies 6 of the 11 members the service uses from that module (`delete`, `update`, `create`, `checkOverlap`, `schedulingServiceRepository.findById` are absent), while the file's own banner says the mocks "must therefore stay COMPLETE". Nothing reaches them today — the three new `deleteBooking` tests all refuse before the delete — but that is the exact trap the file's own header warns about (a missing key is a TypeError inside a logging `catch`). A future test that drives `deleteBooking` to completion here will pass for the wrong reason.
2. **`findAcceptedForBooking` now fails closed** where the old code failed partially: if either of the two equality reads errors, the method returns `{ data: null }` and the call site's `quotes ?? []` means **no quote is stopped at all**, where previously the other read's rows were still stopped. Rare (one of two reads failing), and arguably the safer direction, but it is a behaviour delta inside a commit described as a move.
3. **`withdrawOpenForBooking` now also writes `updated_at`**, which the old inline update did not. Benign, almost certainly an improvement, but likewise a delta in a move.
4. **`stampFirstPeriodInvoice` is the only one of the eleven new methods whose `catch` logs nothing.** Its caller does log the returned error, so nothing is lost; it is just inconsistent with its ten siblings.
5. **A test comment names a file that does not exist:** `BookingLifecycleService.planInvoice.test.ts` points the reader at `PaymentPlanRepository.stampFirstPeriodInvoice.test.ts`; the assertions it means are in `PaymentPlanRepository.bookingWrites.test.ts`.

### Rule 4 / tenant scoping

- **All eleven new methods carry exactly one `.eq('user_id', userId)`**: `existsWithTag`, `cancelOpenStagesForBooking`, `stampFirstPeriodInvoice`, `findLiveForBooking`, `findAnyForBooking`, `findAcceptedForBooking`, `stopAccepted`, `findPackageQuotesForBooking`, `withdrawOpenForBooking`, `findSaleMode`, `findCancellationState`. Checked method body by method body, and against the diff (11 added filter lines for 11 methods).
- **The `findSaleMode` tightening is safe.** Every production caller of `cancelBooking` / `deleteBooking` passes the booking owner's id, never a client's or an operator's: `app/api/book/manage/[token]/cancel/route.ts:388` passes `booking.user_id`; `app/api/scheduling/bookings/[id]/cancel/route.ts:66` and `…/[id]/route.ts:737` pass `user.id`; `lib/business-os/account/cancelBookingsForClosure.ts` passes the same `userId` it listed the bookings with; `MutateExecutor` passes `ctx.userId`; `app/api/payments/refunds/route.ts` passes the session `userId`. `scheduling_services` has no shared or template rows, and every other read of that table is owner-scoped. The only rows the new filter can exclude are rows the old query should never have been able to return.
- **But six of those scopes are unguarded** — see Bug 3. Rule 4 is satisfied in the code as written and unprotected against the next edit.

### `planFollowsItsStages` (question 5)

`lowerPlansForCancelledStages` has no client of its own: it declares a local `PlanWriter` interface and uses only the `db` parameter, so it can only reach the network if a caller hands it a live client — which `BookingLifecycleService` does (`supabaseServer`, L620), as do `cancelQuoteStages.ts:416` and `SchedulingRepository.ts:1686`. Mocking the module in the booking suite is therefore the right and only seam, and the measurement confirms it: 0 calls from that suite, and the helper's `payment_plan_installments` sibling read appears nowhere in the branch probe. The three remaining suites that touch the helper's callers (`cancelQuoteStages.test.ts`, `SchedulingRepository.secondAttempt.test.ts`, `BookingLifecycleService.plan.test.ts`) all replace `@/lib/supabaseServer` wholesale and measured 0 as well.

### Test outputs

```
# 1. the three suites, with my probe (current state)
Test Suites: 3 passed, 3 total   Tests: 107 passed, 107 total
QA_PROBE {"suite":"lib/services/__tests__/BookingLifecycleService.test.ts","fetch":0,"http":0,"socket":0}
QA_PROBE {"suite":"lib/business-os/channel-insights/__tests__/ChannelPerformanceService.test.ts","fetch":0,"http":0,"socket":0}
QA_PROBE {"suite":"lib/services/__tests__/packageAcceptance.test.ts","fetch":0,"http":0,"socket":0}

# the same probe on the base commit 0dca3b2c, in a second worktree
QA_PROBE {"suite":"…/BookingLifecycleService.test.ts","fetch":202,"http":0,"socket":202,
          "socketHosts":["test.supabase.co"]}
QA_PROBE {"suite":"…/ChannelPerformanceService.test.ts","fetch":22,…}
QA_PROBE {"suite":"…/packageAcceptance.test.ts","fetch":12,…}

# 2. the 20 tier-1 suites, clean, current state
Test Suites: 20 passed, 20 total   Tests: 378 passed, 378 total   (0 network in all 20)

# 3. the nine surviving mutations, all applied, against everything that could catch them
applied M15 M16 M17 M19 M20 M21 M22 … exit=0  restored=VERIFIED
applied M18 M23 …                      exit=0  restored=VERIFIED
Test Suites: 38 passed, 38 total   Tests: 852 passed, 852 total

# 4. typecheck (typeRoots at the parent node_modules, 12 GB heap)
1922 errors total; exactly one in the 13 touched files:
lib/services/__tests__/BookingLifecycleService.test.ts(1020,52): error TS2322:
  Type 'null' is not assignable to type 'string | undefined'.

# 5. full gate on the final state
Test Suites: 29 failed, 8 skipped, 1880 passed, 1909 of 1917 total
Tests:       169 failed, 65 skipped, 48324 passed, 48558 total
PASS lib/repositories/__tests__/paymentTablesWriteLockdownMigration.test.ts   # was the Bug 2 failure
PASS lib/repositories/__tests__/SchedulingBookingRepository.webhook.test.ts   # was the Bug 1 failure
probe: 1909 suites, 28 with outbound attempts, 87 fetch total (base commit: 32 / 323)
```

### Full gate, branch vs base commit

Run three times: the branch at the 19:1x state, the base commit `0dca3b2c` in a second detached worktree, and the branch again at the final state.

| Run | Suites | Tests |
|---|---|---|
| base commit `0dca3b2c` | 33 failed, 8 skipped, 1873 passed | 174 failed, 48276 passed |
| branch, 19:1x state | 31 failed, 8 skipped, 1877 passed | 171 failed, 48313 passed |
| **branch, final state** | **29 failed**, 8 skipped, 1880 passed | 169 failed, 48324 passed |

**On the final state there are no branch-only failures at all.** The 29 are a strict subset of the base commit's 33, and the network total is 87 fetch attempts across 28 suites against the base commit's 323 across 32.

**29 failing suites are identical in both runs** — pre-existing on `main`, not this stream's: the five `lib/pilot` / `agentkit` suites, `supabaseFetch`, `addressFormat`, `TokenBudgetManager`, `IntentClassifier`, the three `contact-drawer` guards, `AdminAreaField` ×2, `bookingNextStep`, the two onboarding suites, `freeSlotsComposesSharedRules`, `stripeDecidesConnectStatus`, `publicEndpointsAreThrottled`, `oneAddressPolicy`, `openaiPricingAdapter`, `stripePlanPriceScripts`, `aCancelledMeetingSaysWhetherItWasSent`, `bookingMailLandsOnTheJourney`. Four render suites (`jobsQueues.items`, `exchangeRatesTab`, `PlanUpgrade`, `upgradeModal.um2`) failed only on the base run and are flaky rather than fixed.

**Branch-only at the 19:1x state: exactly two**, Bugs 1 and 2 above. Both were fixed by the in-flight edit; the tier-1 re-run has `SchedulingBookingRepository.webhook.test.ts` green, and the final gate confirms `paymentTablesWriteLockdownMigration.test.ts`.

**Cross-check on §"Full-gate regression check".** The three branch-only failures recorded there (`app/admin/archiving/__tests__/page.render.test.tsx`, `app/admin/audit-trail/__tests__/auditTrail.table.render.test.tsx`, `app/api/admin/jobs-queues/__tests__/qa-slice5-pr2.route.test.ts`) **all passed in my three runs**, on both sides. Independently measured, in a different run, that supports the load-dependent-flake reading rather than a regression. My runs' own one-sided failures were a different four render suites, and in the other direction. Two things follow: the branch is clean, and the failing-suite list on this machine moves by ±4 suites between runs, so the diff is only readable when a named failure can be traced to a named cause — which is what Bugs 1 and 2 were.

### Observations (not defects)

- **O1 — the "`booking.service_id` is nullable" finding in §Outcome is not supported by the schema.** The column is `UUID NOT NULL` since `20260722_create_scheduling_tables.sql` and the TS type is `string`. What the baseline probe actually caught was `scheduling_services?select=sale_mode&id=eq.undefined` — a **fixture** that names no service, not a production row with a null one. The guard is still worth having (it stops the `eq.undefined` request), but the claim and the test that encodes it should be restated, and the type settled against the live schema.
- **O2 — SA's G3 "miscount" is confirmed resolved.** 202 + 22 + 12 = 236, and the branch's gate-wide drop is exactly 236.
- **O3 — where this pass sits against the SA code review.** It was run on the state *after* SA's blocking items 1–3 were fixed, so the "Code Approved for QA: Not yet" line below is stale with respect to what I tested. Of SA's remaining items: **4 is done** (`planInvoice.test.ts` now asserts `linkPaymentPlan` with its three arguments in order), **6 is done** (FU-D carries the invariants), **5 is still open** — see Edge case 1.
- **O4 — the worktree was edited by another session during this QA pass.** Everything above is pinned to the post-19:23:40 state by checksum, and the tree was verified byte-identical to that snapshot after every mutation. If further edits have landed since, the mutation results and the typecheck need re-running; the network and gate results are less sensitive.

### Final status

- [ ] All acceptance criteria pass — ready for commit
- [x] **Issues found — Dev must address before commit**
  - Bugs 1 and 2 are already fixed in the working tree; they must stay fixed, and both guards must be green in the PR run.
  - **Bug 3 is open** and is the one blocking item of substance: six new repository methods, nine breakable invariants, six of them `user_id` scopes on money-path writes. Unit tests in the style of the three that exist.
  - Bug 4 is open and one line — but settle the `service_id` nullability against the live schema before choosing which way to fix it.
  - SA Code Review item 5 (Edge case 1) is open: either complete that factory or narrow its banner.

Everything the stream set out to prove is proved: the 236 calls were real, they are gone, the gate is quieter by exactly that much, and the invariants that have tests are genuinely held by them. What is missing is a net under the six methods that have none — and those six are where the cross-tenant writes are.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-30 | Created | Site inventory, re-measured baseline, seven slices. Corrected the brief's `packageAcceptance` figures (12 calls not 168; subject already Rule 1 compliant). |
| 2026-10-30 | Slices 1-4 and 7 implemented | 236 measured calls to 0 across three suites; 13 new behaviour tests; slices 5-6 moved to their own stream on SA's ruling. See Outcome. |
| 2026-10-30 | SA code review round 2 | Fixed 3 SA blockers (red planInvoice suite, 3 displaced JSDoc blocks, a misleading method name) and 2 architecture-guard regressions found by diffing a full gate against a baseline worktree. |
| 2026-10-30 | QA round 3 | Closed the nine surviving mutations on six untested repository methods (2 new files, 22 tests, 9/9 now caught); corrected the `service_id`-is-nullable claim against the live schema (it is `uuid NOT NULL`). |
| 2026-10-30 | SA code review | FIX REQUIRED → then APPROVED WITH CHANGES. Moves are faithful and C0–C3 / D1–D5 met; blocking: `BookingLifecycleService.planInvoice.test.ts` is red (its `PaymentPlanRepository` mock lacks `stampFirstPeriodInvoice`) and its two stamp-scope assertions must be re-homed to the repository; three doc comments now head the wrong method; `cancelUnbilledStagesForBooking` is misnamed (it closes billed stages). G3 withdrawn as a miscount; `source_metadata` fix confirmed |
| 2026-10-30 | QA pass | Independent probe reproduces 202/22/12 on the base commit and 0/0/0 on the branch (gate-wide 323→87 fetch attempts). 28 mutations: 19 caught, 9 survived. Two branch-only gate failures found and already fixed in-flight; one open coverage gap (6 new repository methods untested, 9 breakable invariants) and one new TS error. See QA Report |
| 2026-10-30 | SA workplan review | APPROVED WITH CHANGES. Slices 5/6 out of the stream; `lowerPlansForCancelledStages` keeps its client (three callers, not two); L997 gains its `user_id` scope via a new `findSaleMode`, not `findById`; two PRs (Slice 1 alone, then 2–4 +7); no new repository class needed; invariants D1–D6 placed; corrections G1–G8 required in this document |

---

## Outcome

Implemented 2026-10-30 on `refactor/repository-routing-booking-cancel`.

### Result against the measurement

| Suite | Before | After |
|---|---|---|
| `BookingLifecycleService.test.ts` | 202 calls, 38 tests | **0 calls, 51 tests** |
| `ChannelPerformanceService.test.ts` | 22 calls, 22 tests | **0 calls, 27 tests** |
| `packageAcceptance.test.ts` | 12 calls, 27 tests | **0 calls, 29 tests** |

Exit criterion per SA: **no `.from(` in the file**, not "no `supabaseServer` import". `BookingLifecycleService.ts` has zero `.from(` and keeps the import solely to pass a client to `lowerPlansForCancelledStages`.

### What the removed calls were buying: nothing

Worth recording, because it is the justification for the whole slice. Before this change:

- **No test asserted mailbox-channel behaviour at all.** `hasInboxChannel` was only ever exercised by a real HTTP call to a host that does not resolve, landing in `catch { return false }`. The suite agreed on "no mailbox channel" by accident.
- **In `BookingLifecycleService`, the only assertions on any of these outcomes were the all-zero, all-false defaults** (`planLive: false`, `periodsRemaining: null`, `stagesClosed: 0`) - that is, the suite was asserting the swallowed-failure state. `deleteBooking` had no tests whatsoever, so its `ON DELETE RESTRICT` plan guard - the one whose failure mode is "the client has been emailed that their appointment is cancelled, for a booking that then survives" - was entirely uncovered.

So 236 real HTTP calls and roughly 54 s of wall-clock were buying zero coverage. 13 new behaviour tests now cover what they did not.

### Verification

- Every slice was mutation-tested; a green suite was not accepted as done (SA's hard rule). Caught: `existsWithTag` forced true, forced false, and error-treated-as-yes; `findAnyForBooking` gaining a live-only status filter (the RESTRICT bug); `findLiveForBooking` losing its status filter or its owner scoping; the reminder scheduling being removed.
- Typecheck run with `typeRoots` pointed at the parent repo's `node_modules` - this worktree has none, so a plain `npx tsc` silently reports only "cannot find type definition file for jest/node" and reads as clean. It also needs `--max-old-space-size`; at the default heap it dies with a V8 OOM and prints no diagnostics at all, which also reads as clean to a grep. Both are traps CLAUDE.md's ship drill warns about.

### Deviations from the plan, and why

1. **Slices 5 and 6 moved out of this stream, on SA's ruling.** They remove zero measured calls, nothing about them is perishable, and the cost is rewriting a 780-line and a 241-line filter-asserting Proxy-fake suite on the two paths that void invoices and close money rows. Shipping them here would mean the CI-flake fix and that regression risk revert together. **This narrows the scope the task named, so it is the user's call rather than ours** - raised at hand-back rather than quietly dropped. Two of slice 6's four sites now arrive pre-built (`findOwnedId` already existed; `findAnyForBooking` came from slice 3).
2. **`lowerPlansForCancelledStages` keeps its client parameter** (SA A1). The plan said it had two callers; it has **three** - the third is `SchedulingRepository.ts:1649`, passing `this.supabase`, so a signature change reaches into the repository layer itself. All three reach it by dynamic `import()`, which is already a mockable seam.
3. **L997 routed through a new narrow `findSaleMode`, not `findById`** (SA A2). `findById` is `select('*')` + `.single()` + an error log on a miss, which would turn every ordinary miss into a logged error and over-fetch every column on every cancellation. The new method adds the `user_id` scope the original read lacked (Rule 4).
4. **The `UPDATE` + `.or()` comment was rewritten, not copied** (SA). Its old justification cited `mutationOrSelect.guard` scanning to the end of a 242-line block, which stops being true once the read and the update are separate methods - a verbatim copy would have been a wrong comment in a new place.
5. **`PaymentPlanSubscriptionRepository` gained optional constructor injection.** It held `supabaseServer` as a field with no constructor, so it had no seam and no unit tests. The three existing no-argument call sites are unaffected.

### Found in passing

- **A pre-existing type error, fixed:** `AttributedContact` did not declare `source_metadata`, though the repository's `select()` has always fetched it and the service casts to read it. It was the only error in the whole typecheck. Declared on the interface (CLAUDE.md: fix TS errors `next.config.js` ignores anyway), which also let a new test fixture drop an `as any`.
- **`booking.service_id` is nullable** and the old read passed it straight into `.eq('id', ...)`. A null there is a PostgREST error, not an empty result - swallowed by the enclosing catch, so it read as "not a quoted service" rather than as a failed query. Now guarded, with a test.
- **The default `booking()` test fixture names no service,** so the `sale_mode` read could never have succeeded in this suite even without the network problem.
- **SA's G3 was a miscount.** The call-count table reconciles exactly; see the note under the slice table.
- **SA's G2 was right and the plan was wrong:** `inboxChannel.ts:233` and `inboxChannelRunner.ts:156` are *not* the same query as site 1 and are *not* covered by slice 1. Different column lists, and the runner adds `status='active'`, an `.or()` on `last_run` and a limit - and has **no `user_id` filter at all** (a cron over every account). Any follow-up there needs a `tenant-isolation-guard` pass and an `...AllAccounts` name, not a reuse of `existsWithTag`.

### Second round: SA code review, and two guard regressions it did not catch

The first implementation pass was reviewed and came back **FIX REQUIRED**. Three
blocking items, all fixed:

1. **`BookingLifecycleService.planInvoice.test.ts` was red** - a suite neither the
   plan nor the measurement had accounted for. Its `PaymentPlanRepository` mock
   exported only three methods, so `createBookingInvoice` hit a `TypeError` on
   `stampFirstPeriodInvoice` outside any `try` and 8 of its 10 tests failed.
   That suite also held the ONLY proof of the stamp's scoping, watched through
   its own `supabaseServer` Proxy. Both writes are now asserted as repository
   calls with their exact arguments (which also closes the argument-transposition
   risk, since `stampFirstPeriodInvoice` and `linkPaymentPlan` take their string
   arguments in different orders two statements apart), and the filter-level
   proof was re-homed - not dropped - into a new
   `PaymentPlanRepository.bookingWrites.test.ts`.
2. **Three JSDoc blocks had been left heading the wrong method.** Each new method
   was inserted between an existing doc comment and the method it documented.
   The worst was `PaymentPlanSubscriptionRepository`, where "Not user-scoped: the
   caller is a webhook... identified by a globally unique Stripe id" ended up
   heading the new owner-scoped `findLiveForBooking`, while
   `findBySubscriptionId` lost its tenant-isolation note. All three put back.
3. **`cancelUnbilledStagesForBooking` was misnamed** and the call-site comment
   said the opposite of what runs. The filter is `.not('status','in','(paid,cancelled)')`,
   which closes BILLED stages too - that is the whole point of it, and the fix
   for stages left reading `billed` on a cancelled booking. Renamed
   `cancelOpenStagesForBooking` and the comment corrected. A reader trusting the
   old name would have reintroduced the `pending`-only bug.

**Two regressions the review did not find, caught by running the full gate against a baseline worktree of the fork commit.** Both were architecture guards, and both were real:

- **`SchedulingBookingRepository.webhook.test.ts`** - `findCancellationState` had
  been inserted inside the "Stripe webhook and plan binding: owner-scoped"
  section, which is deliberately a narrow region: its guard forbids `try`/`catch`
  and `logger.` there and counts the `.eq('user_id', userId)` filters exactly
  against its four named methods. Moved out, up among the ordinary booking reads.
- **`paymentTablesWriteLockdownMigration.test.ts`** - the new constructor was
  written `constructor(supabaseClient?: SupabaseClient) { this.supabase = supabaseClient || supabaseServer }`,
  and the guard requires a defaulted parameter or an explicit service-role
  singleton. Rewritten as
  `constructor(supabaseClient: SupabaseClient = supabaseServer)`, which is the
  clearer shape anyway.

The lesson worth keeping: **a green run of the suites you touched is not a
regression check.** Three of the five problems above were in suites this change
never names, and two of them were only visible by diffing a full-gate run
against the same gate on the fork commit. The repo carries about 29 failing
suites on `main` already, so the failing-suite list is only meaningful as a
diff.

### Full-gate regression check

Run as a diff, because the failing-suite list means nothing on its own: this
repo carries about 32 failing suites on the fork commit already. A baseline
worktree was checked out at the exact fork commit (`0dca3b2c`) and the full gate
run on both sides.

| | Baseline (`0dca3b2c`) | This branch |
|---|---|---|
| Suites failing | 32 | 33 |
| Tests failing | 180 | 177 |
| Tests passing | 48,270 | 48,316 |

Diffing the two failing-suite lists:

- **Fail only on this branch (3):** `app/admin/archiving/__tests__/page.render.test.tsx`,
  `app/admin/audit-trail/__tests__/auditTrail.table.render.test.tsx`,
  `app/api/admin/jobs-queues/__tests__/qa-slice5-pr2.route.test.ts`.
- **Fail only on baseline (2):** `app/admin/finance/__tests__/exchangeRatesTab.render.test.tsx`,
  `components/business-os/settings/__tests__/upgradeModal.um2.qa.render.test.tsx`.

All three branch-only failures **pass in isolation** (86 tests, 3 suites green),
reference **none** of the changed modules, and are jsdom `render` / `waitFor`
suites. Failures appearing on one side and disappearing on the other, in both
directions, is the signature of load-dependent flakiness rather than of a
regression — and it is the same shape as the already-parked `next/font` and
admin-render flakes. **No suite that touches this change fails on either side.**

Of this change's own suites: 202 suites / 4,475 tests green across
`lib/services/__tests__/BookingLifecycleService*`, `lib/business-os/channel-insights`,
`lib/services/__tests__/packageAcceptance.test.ts`, all of `lib/repositories/__tests__`
and all of `lib/payments/__tests__`.

### Third round: QA, and the coverage gap neither Dev nor SA found

QA mutation-tested the branch independently (28 mutations, each applied alone to
a checksum-verified snapshot) and reported **nine survivors**. All nine were on
the **six methods that had no repository unit test**:
`ProposalRepository.{findAcceptedForBooking, stopAccepted, findPackageQuotesForBooking, withdrawOpenForBooking}`
and `SchedulingRepository.{findSaleMode, findCancellationState}`. QA re-applied
them against 38 suites - every test in the repo that reads any of the changed
files as source text - and **852 tests stayed green with every mutation
applied.** No test file anywhere named those six methods.

Four of the nine were cross-tenant reads or writes on `proposals` and
`scheduling_bookings`; one undid this stream's own Rule 4 tightening on
`findSaleMode`; one let a second press of Stop rewrite `stopped_at` and clobber
`declined`/`expired`/`withdrawn`/`superseded`; one withdrew an **accepted**
quote; one re-ran the package cascade on a booking whose outcome was already
recorded.

This was the right catch and it was a real gap in the work. It is the same shape
as the `stopBookingPlan` precedent SA cited in its ruling - a mutation that
dropped `.eq('booking_id')` from a read and passed all nine of that suite's
tests - and the lesson is the same: **moving a query behind a seam does not test
it; only asserting its filters does.**

Resolved by two new files, 22 tests:

- `lib/repositories/__tests__/ProposalRepository.bookingQuotes.test.ts`
- `lib/repositories/__tests__/SchedulingRepository.bookingCancelReads.test.ts`

All nine mutations re-run one at a time against them: **9 of 9 caught.**

**QA's second finding corrected a claim of mine.** I had written that
`booking.service_id` is nullable. It is not: checked against the live schema,
`scheduling_bookings.service_id` is `uuid NOT NULL`, and the TypeScript type
says `string`. What the baseline probe actually caught was
`scheduling_services?select=sale_mode&id=eq.undefined` - a **fixture** that
names no service, not a null column. The guard is still worth keeping, because
`id=eq.undefined` is a PostgREST error rather than an empty result and the
enclosing catch turns it into "not a quoted service"; but it guards the ABSENT
case, not a nullable one. The comment, the test name and the test body have all
been restated, and the test no longer passes `null` for a non-nullable typed
column (which was the only type error in the 15 touched files).

Also fixed from QA: the main suite's mock-completeness banner now says plainly
which `SchedulingRepository` members the factory omits and why (SA item 5), and
`planInvoice.test.ts` pointed readers at a test file that does not exist.

### Declared behaviour deltas

Two, both intentional, both to be named in the commit message:

1. `withdrawOpenForBooking` also sets `updated_at`, which the original inline
   update did not. Consistent with the existing `withdraw()`. SA raised no
   objection.
2. `findSaleMode` adds the `user_id` scope that the original read of
   `scheduling_services` lacked (Rule 4), plus a guard for an absent
   `service_id`.
3. `findAcceptedForBooking` now fails **closed**. The inline version issued two
   reads and carried on with whatever came back, so an error on the
   `package_booking_id` half silently stopped a package's quote and left the
   job's - acting on half a picture. One error now yields no ids, so nothing is
   stopped at all, and the caller logs it. Covered by a test.

### Follow-ups

| # | Item |
|---|---|
| FU-A | `lowerPlansForCancelledStages` client parameter - removable only by moving its two statements into `PaymentPlanRepository`, which creates a `SchedulingRepository` to `planFollowsItsStages` to `PaymentPlanRepository` layering whose only protection against a static cycle today is the dynamic `import()`. Needs its own design. |
| FU-B | `PaymentReminderService` - 11 direct queries on a constructor-injected client. The module exports `paymentReminderService = new PaymentReminderService(supabaseServer)`, bound at import, so the module mock is the only seam. Root cause of slice 7's 12 calls. |
| FU-C | `inboxChannel.ts:233` and `inboxChannelRunner.ts:156` - see "Found in passing"; the runner's missing `user_id` scope wants a `tenant-isolation-guard` pass. |
| FU-D | Slices 5 and 6, as `REPOSITORY_ROUTING_QUOTE_AND_PLAN_STOP`, with their own SA and QA cycle. **The call-site invariants that stream must carry across, because a combined repository method would destroy them:** in `cancelQuoteStages`, invoices are voided BEFORE stages are closed, so a crash leaves stages still `pending` - visibly unfinished and safe to re-run - where stages-first would leave a closed stage beside an invoice still chasing the client, which looks finished and is not; and its stage filter closes everything NOT SETTLED, the billed ones included. In `stopBookingPlan`, the order is read, then void, then close, because the invoices must be voided individually and a bulk update would leave nothing to iterate. Both orderings are decisions and stay at the call site. |

---

## SA Code Review

**Code Review by SA — 2026-10-30**
**Status:** 🔄 FIX REQUIRED → then APPROVED WITH CHANGES

The move itself is faithful. I compared every relocated query column-by-column and
filter-by-filter against the deleted code and found no unintended delta; C0–C3 and
D1–D5 are met, and the two new repository unit-test files are the best part of the
diff — `findAnyForBooking`'s `expect(calls.nots).toEqual([])` is exactly the device
D3 asked for, and `existsWithTag`'s per-filter assertions are the right answer to
"the shape of the answer does not change when a filter is dropped".

But the three suites named in the Outcome are not the three suites this change
touches. **`lib/services/__tests__/BookingLifecycleService.planInvoice.test.ts` is
red on this branch**, and two of its tests held D5's proof. That has to be fixed
before QA, so this pass is not an approval yet. Everything else below is small.

### Code Review Comments

1. **`BookingLifecycleService.planInvoice.test.ts` fails on this branch — blocking.** Priority: **High**.
   That suite's `jest.mock('@/lib/repositories/PaymentPlanRepository')` factory
   (its L34) exports only `{ create, findByServiceId, createInstallmentsForBooking }`.
   `createBookingInvoice` now calls `paymentPlanRepository.stampFirstPeriodInvoice(...)`
   at `BookingLifecycleService.ts:1962`, which is **not inside a try** — so every test
   that reaches the `if (plan)` branch throws
   `TypeError: paymentPlanRepository.stampFirstPeriodInvoice is not a function`.
   This is the G4 failure mode, one file over from where it was predicted.
   Required: add the key to that factory, **and** re-home its two stamp assertions
   (`planInvoice.test.ts` ~L243 and ~L262 — the payload, and
   `['booking_id','booking-1'] / ['user_id','owner-1'] / ['installment_number',1]`).
   They watched the update through that suite's `supabaseServer` Proxy and can no
   longer see it, because the stamp now goes through a mocked repository. Those
   filters are D5's entire content; they must land in a
   `PaymentPlanRepository.stampFirstPeriodInvoice` unit test, not disappear.
   Its sibling assertion ("links the booking to its plan") survives untouched —
   `SchedulingRepository` is not mocked in that suite, so `linkPaymentPlan` still
   runs against the Proxy.
   Then run the **whole** Jest suite, not the three measured ones. I statically
   cleared the other BookingLifecycleService consumers and they survive:
   `delete.test.ts`'s `supabaseServer` fake exposes `select→eq→eq→limit→maybeSingle`,
   which is `findAnyForBooking`'s chain exactly; `plan.test.ts` is saved only by the
   new null-`service_id` guard, because its booking fixture names no service and its
   own `SchedulingRepository` factory exports no `schedulingServiceRepository` — worth
   a one-line note in that file, since the day its fixture gains a `service_id` it
   TypeErrors. The three source-scanning guards over this file
   (`bookingInvoiceIsNotBornSent`, `timeOffIsRead`, `SchedulingRepository.secondAttempt`)
   read regions this diff does not touch.

2. **Three doc comments are now attached to the wrong method.** Priority: **High**.
   Each new method was inserted between an existing JSDoc block and the method it
   documented, so the old block now heads the new method and the old method has no doc:
   - `PaymentPlanRepository.ts:829` — "Cancel all pending installments for a plan
     application" now heads `cancelUnbilledStagesForBooking`; `cancelInstallments`
     (L947) is left bare.
   - `PaymentPlanSubscriptionRepository.ts:223` — "Find the plan a Stripe subscription
     belongs to. **Not user-scoped:** the caller is a webhook … globally unique Stripe
     id" now heads `findLiveForBooking`. This is the worst of the three: a
     `user_id`-scoped booking read now carries an unscoped-by-design banner, and
     `findBySubscriptionId` has lost the note that a `tenant-isolation-guard` pass
     reads to decide the method is deliberate.
   - `SchedulingRepository.ts:3568` — "`bindPlanSubscription`: tells a booking which
     plan it is sold under … (Fix-1b)" now heads `findCancellationState`;
     `linkPaymentPlan` is left bare.
   This is D1's rule applied to someone else's comment: a correct comment in the wrong
   place is worse than no comment. Move each new method below the orphaned block.

3. **`cancelUnbilledStagesForBooking` is misnamed, and the new call-site comment is
   false.** Priority: **High** (naming, on money code).
   The filter is `.not('status','in','(paid,cancelled)')` — it closes **billed**
   stages too, and its own doc says so in capitals ("EVERYTHING NOT SETTLED, not just
   `pending`. A stage that had been BILLED …"). The method name asserts the opposite,
   and `BookingLifecycleService.ts:581` now reads "why only the unbilled,
   non-subscription stages", which is wrong about the one behaviour that was a
   deliberate fix. Rename to `cancelOpenStagesForBooking` (the C0 name) or
   `cancelUnsettledStagesForBooking`, and correct that line. A reader who trusts the
   name will reintroduce the `pending`-only bug.

4. **Neither `createBookingInvoice` site has a call assertion (B4).** Priority: **Medium**.
   `stampFirstPeriodInvoice(planId, bookingId, userId, invoiceId)` is four positional
   strings with no type protection, and `linkPaymentPlan(bookingId, userId, planId)`
   right beneath it takes them in a **different order**. A transposition compiles,
   stamps the wrong scope, and produces precisely the double-invoicing the method's
   own doc describes. The repository unit test from item 1 covers the stamp; add a
   `toHaveBeenCalledWith` for the link in whichever suite drives that path.

5. **The main suite's "the mocks must stay COMPLETE" banner is not true of the
   `SchedulingRepository` factory.** Priority: **Medium**.
   `BookingLifecycleService` calls `schedulingBookingRepository.{cancel, findChildren,
   findCancellationState, linkPaymentPlan, findById, delete, update, create,
   checkOverlap}` and `schedulingServiceRepository.{findSaleMode, findById}`; the
   factory lists six of the eleven. Latent rather than live — all three new
   `deleteBooking` tests refuse before `delete` is reached — but the next happy-path
   delete test is a TypeError of exactly the class the banner warns about. Either add
   the keys or narrow the claim and name which are deliberately absent. (I checked the
   other three factories by grep: everything the subject calls on `proposalRepository`,
   `paymentPlanRepository` and `paymentPlanSubscriptionRepository` has a key, and every
   default returns the real `{ data, error }` shape. The new tests are not vacuous —
   they assert computed values, 7 / null / 0, and the arguments, not just the calls.)

6. **D6 has no artefact.** Priority: **Low**.
   FU-D names the stream but not the invariants the ruling said to carry across
   (`cancelQuoteStages`' void-before-close, `stopBookingPlan`'s read → void → close, and
   E2's "two of its four sites arrive pre-built"). Either stub
   `REPOSITORY_ROUTING_QUOTE_AND_PLAN_STOP` with them, or put them in the FU-D row.
   They exist nowhere else once this document is closed.

### Conditions walked against the diff

| Condition | Verdict |
|---|---|
| **C0** no new repository class | ✅ Every method is an addition to the existing owner. Names drifted from my table (`findCancellationState`, `stopAccepted`, `cancelUnbilledStages…`); only item 3's matters. |
| **C1** `existsWithTag` returns `{ data, error }` | ✅ `boolean \| null`, never `false` on error, filters byte-for-byte (`contains('tags',[tag])` + `is('deleted_at', null)`, no status filter), head-count preserved. The never-throws collapse stays in `hasInboxChannel`, in one place, with a comment saying so — and the test for a repository failure asserts on a real error, not on an ambiguous `false`. |
| **C2** constructor injection on `PaymentPlanSubscriptionRepository` | ✅ Added, defaulting to `supabaseServer`; three existing no-arg call sites unaffected; it is what made the new unit tests possible. |
| **C3** no fold into `cancelInstallments` | ✅ Separate method, booking-scoped, rows returned, patch fixed inside. No generic `updateInstallments`. |
| **D1** `UPDATE` + `.or()` → repository, comment rewritten | ✅ The stale `mutationOrSelect.guard` justification is gone, not copied. Two equality reads kept; UPDATE keeps `.in('id',…)` + `.select()`. The new claim "`latestForBooking` above uses the `.or()` form for the same two columns" is true (`ProposalRepository.ts:373`). I hand-ran the guard's scan over the new methods: the forward scan from each new `.update(` ends at its `try`'s brace and meets no `.or(`, so the guard stays green. |
| **D2** `installment_count` as a module constant | ◻️ Not done, and I am **not** asking for it. The list is named once, and the `Pick<PlanSubscription, …>` return gives no real `tsc` protection (the client is untyped, so `data` is cast rather than checked). What carries the invariant instead is the new unit test asserting the select contains `installment_count` and **not** `periods_total` — a stronger tripwire than the constant. Satisfied in substance. |
| **D3** live-vs-any as two named methods | ✅ Exactly as ruled. `findAnyForBooking` is genuinely unfiltered: `select('id, status')`, `eq(user_id)`, `eq(booking_id)`, `limit(1)`, `maybeSingle()` — no `.not`, no status, nothing else. `findLiveForBooking` derives from `PLAN_STOPPED_STATUSES` (verified `['completed','cancelled']`). No `liveOnly` flag. The "applies NO status filter at all" test is the one that makes a future consistency fix change a test on purpose. |
| **D4** both columns in the repository, predicate at the call site | ✅ `findCancellationState` fetches `status` + `meeting_status` and says why; `already?.status === 'cancelled' \|\| already?.meeting_status === 'cancelled'` stays in the cascade; the test drives the `confirmed` + `meeting_status: cancelled` row that a `status`-only guard would miss. (Doc placement: item 2.) |
| **D5** booking scope in the repository, ordering at the call site | ✅ All four filters and `installment_number = 1` fixed inside; the FIRST-before-Stripe comment stays at the call site. ⚠️ But its proof was orphaned — items 1 and 4. |
| **D6** call-site ordering invariants recorded | ◻️ Item 6. |
| **G4** complete mock factories | ⚠️ Items 1 and 5. |
| **G5** exit criterion per file | ✅ `BookingLifecycleService.ts`: zero `.from(`; `supabaseServer` survives only at L620, passed to `lowerPlansForCancelledStages`, with a comment saying exactly that. `ChannelPerformanceService.ts`: zero `.from(`, and the stale L18 comment is gone. |
| **Rule 4 / tenant isolation** | ✅ Every new method carries `.eq('user_id', userId)`. No new service-role path, no caller-supplied id used unscoped. `findSaleMode` adds the scope the old read lacked, and the null-`service_id` guard closes a latent `.eq('id', null)` that read as "not a quoted service". |
| **Logging** | ✅ No `console.*` in any touched file; `logger.error({ err, … }, '…')`; not-found neither thrown nor logged. `stampFirstPeriodInvoice` is the only new method that does not log its own error — acceptable, the call site logs it at error level with the ids. |

### Fidelity to the original queries

No unintended delta. Preserved exactly: `cancelled_by ?? 'owner'`, `next_retry_at: null`,
the `(paid,cancelled)` exclusion and `subscription_id IS NULL`, `stop_note?.trim() || null`,
the `status = 'accepted'` condition on both proposal writes, the empty-ids short-circuit
(the old code skipped the UPDATE when nothing matched; the new method returns `{ data: [] }`),
`OPEN_PROPOSAL_STATUSES`, `findPackageQuotesForBooking`'s `booking_id`-only direction,
`findAnyForBooking`'s `limit(1)`, and all four stamp filters.

**On `withdrawOpenForBooking` also setting `updated_at`: no objection.** It matches
`withdraw()`, the omission reads as an oversight rather than a decision, and the only
consequence is that a withdrawn quote now sorts as recently touched. Name it in the
commit message as a second declared behaviour delta, beside the `findSaleMode` scope —
same discipline, for the same reason.

### Your two claims about my workplan review

- **G3 — withdrawn, you are right and I miscounted.** 67 + 90 + 45 = 202, and + 22 = 224.
  The table reconciles. The second half of G3 (slice 4 spans `scheduling_bookings`,
  absent from the measured table) is factually true but is not a reconciliation
  failure — the plan already said those sites contributed 0 in tests. Strike the
  correction; no action.
- **`source_metadata` — confirmed, and the fix is the right one.**
  `ChannelAttributionRepository.ts:86` has always selected it and
  `ChannelPerformanceService.ts:425` reads it off the typed object, so the interface was
  genuinely wrong and declaring it (rather than casting, or dropping the column) is
  correct: dropping it would make the mailbox channel invisible on the card that exists
  to say where clients come from. I cannot confirm the "only error in the whole
  typecheck" half from this worktree — it has no `node_modules`, so I could not run
  `tsc` or Jest here; that part rests on your run, with the `--max-old-space-size` and
  `typeRoots` traps you documented.

### Optimisation suggestions (never blocking)

- The `UPDATE` + `.or()` comment says PostgREST "rejects it on an UPDATE". The live
  finding in `lib/repositories/__tests__/mutationOrSelect.guard.test.ts` is narrower:
  a mutation + `.or` + `.select` whose list omits the or-column. The shorthand is the
  one that was verified here, but a pointer to the guard would save the next reader the
  experiment.
- `existsWithTag` could carry `.limit(1)` alongside the head count; "any?" does not need
  an exact count over the whole tag index. Cosmetic.
- `ChannelPerformanceService` imports `AgentRepository` as a value and uses it only as a
  type; `import type` for that one name is tidier.

### Code Approved for QA: **Not yet** — items 1–3 first

Fix 1, 2 and 3 and re-run the full suite; items 4–6 may ride in the same commit or the
same PR. No second workplan pass, no re-review of the moves themselves: when item 1 is
green with the stamp assertion re-homed, and 2 and 3 are done, this is **APPROVED** and
QA may start. The scope narrowing (slices 5 and 6 out) is the user's call, not mine to
re-litigate — my ruling stands that they do not belong in this stream.
